"""RouteRenderer — turns a Route into a trajectory of LocationFix, and into GPX.

The only place that knows about speed profiles and spatial jitter. Knows nothing about
pymobiledevice3. How a move segment becomes fixes:

1. **A speed cap every few meters.** The road's own speed when the drive has road data (roads.py,
   from Valhalla: speed limits, ramps, roundabouts) or the segment's one cruise speed otherwise; the
   bend, from the circle through the points 10 m either side (so map-digitizing kinks don't brake
   the car); and the controls: turns at intersections, slow rolls.
2. **Every full stop splits the drive.** A red light, a stop sign and the segment's end each become
   a piece boundary, so every piece starts and ends at rest.
3. **A plan the car can actually drive.** Per piece, a backward pass brakes *before* every cap and
   stop (firmly for bends and slower roads, gently into a stop), and a forward pass pulls away no
   harder than the driver's acceleration, which falls off with speed like a real car's.
4. **Timed exactly.** Constant acceleration between grid points, sampled once a second, so the car
   arrives at rest right on the stop line instead of still rolling into the next segment.
5. **Waits hold on the spot.** A red light or a stop sign is held with still-phone jitter and the
   fixes are flagged `hold`, so Drive turns them into a parked call instead of a crawl.

A Driver (roads.py) is sampled per render, so pace, acceleration and braking differ drive to
drive. Walks use the same pipeline with walking accelerations and no road data. Jitter is a
bounded, perpendicular-biased random walk that can't manufacture speed. See docs/MOVEMENT_ENGINE.md.
"""
from __future__ import annotations

import bisect
import math
import random
from datetime import datetime, timedelta, timezone

from . import geo, roads
from .model import (
    Route, LocationFix, DRIVE, WALK, STOP,
    DEFAULT_SPEED_MPS, DEFAULT_ACCEL_MPS2, DEFAULT_JITTER_M,
    WALK_SPEED_MEAN_MPS, WALK_SPEED_STD_MPS, WALK_SPEED_CLAMP,
    CORNER_MIN_SPEED_MPS,
)

_DT = 1.0                  # emit one fix per second while moving
_STOP_SAMPLE_S = 5.0       # during a dwell or a wait, drop a (jittered) fix this often
_GRID_M = 5.0              # speed plan resolution along the path
_CURVE_HALF_M = 10.0       # a bend's radius is measured over this much either side of the point
_CAP_HALF_M = 4.0          # a point cap (turn, slow roll) holds over this much either side
_UTURN_COS = 0.5           # the line turning back more than 120 deg within _CURVE_HALF_M is a U-turn...
_UTURN_MPS = 2.5           # ...taken at a crawl (map U-turns are tighter than a car can turn)
_JITTER_STEP_MAX_M = 0.5   # max jitter offset change per fix, per axis (bounds fake speed)
_JITTER_ALONG_FRAC = 0.35  # along-track jitter is smaller than cross-track (realistic + safe)
_GPX_EPOCH = datetime(2020, 1, 1, tzinfo=timezone.utc)

# kept for callers that used the renderer's own helpers
_haversine = geo.haversine


def plan_piece(ss, caps, v_in, v_out, accel_at, brake, stop_brake):
    """Speed at each grid position `ss` (meters, increasing) of a piece that starts at v_in and ends
    at v_out, no faster than `caps`. Backward passes brake before what's ahead (`brake` m/s^2 for
    caps, the softer `stop_brake` into the piece's end), then a forward pass caps the pull-away at
    accel_at(v) m/s^2. Every step it returns is drivable at those rates."""
    n = len(ss)
    v = list(caps)
    v[-1] = min(v[-1], v_out)
    end = ss[-1]
    for k in range(n - 2, -1, -1):
        ds = ss[k + 1] - ss[k]
        v[k] = min(v[k], math.sqrt(v[k + 1] ** 2 + 2 * brake * ds),
                   math.sqrt(v_out ** 2 + 2 * stop_brake * (end - ss[k])))
    v[0] = min(v[0], v_in)
    for k in range(1, n):
        ds = ss[k] - ss[k - 1]
        v[k] = min(v[k], math.sqrt(v[k - 1] ** 2 + 2 * accel_at(v[k - 1]) * ds))
    return v


def _timing(ss, v):
    """Seconds from the piece's start to each grid position, at constant acceleration per cell."""
    t = [0.0]
    for k in range(1, len(ss)):
        ds, both = ss[k] - ss[k - 1], v[k - 1] + v[k]
        t.append(t[-1] + (2 * ds / both if both > 1e-9 else 0.0))
    return t


def _position(ss, v, t, at):
    """Where the car is `at` seconds into the piece."""
    k = max(0, min(len(t) - 2, bisect.bisect_right(t, at) - 1))
    ds = ss[k + 1] - ss[k]
    tau = at - t[k]
    a = (v[k + 1] ** 2 - v[k] ** 2) / (2 * ds) if ds > 0 else 0.0
    return min(ss[k + 1], ss[k] + v[k] * tau + 0.5 * a * tau * tau)


class RouteRenderer:
    """Render a Route to LocationFixes. Seeded (jitter, walk speed, driver, red lights), so rebuilding
    a preset yields the same GPX (diff-friendly cached artifacts)."""

    def __init__(self, seed: int = 0):
        self._rng = random.Random(seed)
        self._off_e = 0.0    # jitter offset (meters, east/north), evolves as a bounded walk
        self._off_n = 0.0
        self.driver = roads.Driver.sample(self._rng)

    def render(self, route: Route) -> list[LocationFix]:
        fixes: list[LocationFix] = []
        t_cursor = 0.0          # time for the NEXT fix to emit
        pos = None
        carry_v = 0.0           # speed carried into the next segment (0 after stop / mode change)
        segs = route.segments

        for i, seg in enumerate(segs):
            if seg.mode == STOP:
                at = seg.at or pos
                if at is None:
                    raise ValueError("a stop with no 'at' cannot be the first segment")
                new_fixes, last_t = self._emit_stop(at, seg, t_cursor)
                pos, carry_v = at, 0.0
            else:
                v_cruise = self._cruise_for(seg)
                next_same = i < len(segs) - 1 and segs[i + 1].mode == seg.mode
                v_exit = v_cruise if next_same else 0.0             # come to rest into stops/mode-changes
                new_fixes, last_t, pos = self._emit_move(seg, t_cursor, carry_v, v_exit, v_cruise)
                carry_v = v_exit
            fixes.extend(new_fixes)
            t_cursor = last_t + _DT     # keep timestamps strictly increasing across segments

        return fixes

    # -- speed ----------------------------------------------------------------

    def _cruise_for(self, seg):
        if seg.speed_mps is not None:
            return seg.speed_mps
        if seg.mode == WALK:
            lo, hi = WALK_SPEED_CLAMP
            return max(lo, min(hi, self._rng.gauss(WALK_SPEED_MEAN_MPS, WALK_SPEED_STD_MPS)))
        return DEFAULT_SPEED_MPS.get(seg.mode, DEFAULT_SPEED_MPS["drive"])

    # -- jitter ---------------------------------------------------------------

    def _jit(self, lat, lon, jitter_m, heading=None):
        """Nudge the point by a bounded random-walk offset so the track wanders like real GPS.
        The offset is correlated across points and its per-fix change is capped, so jitter can
        never fabricate an implausible speed. When a heading is known, noise is biased
        perpendicular to travel (lateral wander, like real GPS hugging a road) with reduced
        along-track noise. State carries across segments — no discontinuity at boundaries."""
        if jitter_m <= 0:
            return lat, lon
        step = _JITTER_STEP_MAX_M
        if heading is None:
            de = self._rng.uniform(-step, step)
            dn = self._rng.uniform(-step, step)
        else:
            s, c = math.sin(heading), math.cos(heading)
            tdir_e, tdir_n = s, c            # travel direction (east, north)
            perp_e, perp_n = c, -s           # right of travel
            cross = self._rng.uniform(-step, step)
            along = self._rng.uniform(-step, step) * _JITTER_ALONG_FRAC
            de = cross * perp_e + along * tdir_e
            dn = cross * perp_n + along * tdir_n
        self._off_e = self._walk_axis(self._off_e, de, jitter_m)
        self._off_n = self._walk_axis(self._off_n, dn, jitter_m)
        dlat = self._off_n / geo.M_PER_DEG
        dlon = self._off_e / (geo.M_PER_DEG * math.cos(math.radians(lat)))
        return lat + dlat, lon + dlon

    @staticmethod
    def _walk_axis(off, delta, cap):
        step = _JITTER_STEP_MAX_M
        target = max(-cap, min(cap, off + delta))
        d = max(-step, min(step, target - off))   # cap per-step change even if cap shrank
        return off + d

    # -- emitters -------------------------------------------------------------

    def _emit_stop(self, at, seg, start_t):
        jitter = seg.jitter_m or DEFAULT_JITTER_M[STOP]
        return self._hold(at, seg.dwell_s, start_t, jitter, STOP, False)

    def _hold(self, at, secs, start_t, jitter, mode, hold):
        """Still on one spot from start_t for `secs`: a fix now, every _STOP_SAMPLE_S, and at the end."""
        fixes = []
        t, end = start_t, start_t + secs
        while t < end:
            lat, lon = self._jit(at[0], at[1], jitter)
            fixes.append(LocationFix(lat, lon, t, mode, hold))
            t += _STOP_SAMPLE_S
        lat, lon = self._jit(at[0], at[1], jitter)
        fixes.append(LocationFix(lat, lon, end, mode, hold))
        return fixes, end

    def _emit_move(self, seg, start_t, v_entry, v_exit, v_cruise):
        poly = list(seg.waypoints)
        cum = geo.cumulative(poly)
        total = cum[-1]
        jitter = seg.jitter_m or DEFAULT_JITTER_M.get(seg.mode, 5.0)

        # zero-length move -> single fix (degenerate; keeps callers simple)
        if total <= 0:
            lat, lon = self._jit(poly[0][0], poly[0][1], jitter)
            return [LocationFix(lat, lon, start_t, seg.mode)], start_t, poly[-1]

        drive = seg.mode == DRIVE
        drift = None
        if drive and seg.roads and not seg.steady:
            spans, controls = roads.plan(seg.roads, poly, cum, self.driver, self._rng)
            drift = self.driver.drift(self._rng, total)
        else:
            spans, controls = [(0.0, total, v_cruise)], []
        if drive:
            d = self.driver
            accel_at, brake, stop_brake, lateral = d.accel_at, d.brake, d.stop_brake, d.corner_lat
        else:
            walk_a = DEFAULT_ACCEL_MPS2.get(seg.mode, DEFAULT_ACCEL_MPS2[WALK])
            accel_at, brake, stop_brake, lateral = (lambda v: walk_a), walk_a, walk_a, None

        # full stops split the drive; at least a meter between them and from the ends
        stops, last = [], 0.0
        for c in controls:
            if c.dwell_s > 0 and c.s - last >= 1.0 and total - c.s >= 1.0:
                stops.append(c)
                last = c.s
        points = sorted((c.s, c.v_cap) for c in controls if c.dwell_s <= 0 and c.v_cap)
        span_starts = [s0 for s0, _, _ in spans]
        point_s = [s for s, _ in points]

        def cap_at(s):
            v = spans[max(0, bisect.bisect_right(span_starts, s) - 1)][2]
            if drift:
                v = min(roads.MAX_MPS, v * drift(s))
            if lateral:
                pa = geo.interp(poly, cum, s - _CURVE_HALF_M)
                pb = geo.interp(poly, cum, s)
                pc = geo.interp(poly, cum, s + _CURVE_HALF_M)
                v = min(v, max(CORNER_MIN_SPEED_MPS, math.sqrt(lateral * geo.menger_radius(pa, pb, pc))))
                ax, ay = geo.local_xy(pb, pa)
                cx, cy = geo.local_xy(pb, pc)
                norm = math.hypot(ax, ay) * math.hypot(cx, cy)
                if norm > 0 and (ax * cx + ay * cy) / norm > _UTURN_COS:   # in and out point the same way
                    v = min(v, _UTURN_MPS)
            lo = bisect.bisect_left(point_s, s - _CAP_HALF_M)
            hi = bisect.bisect_right(point_s, s + _CAP_HALF_M)
            for k in range(lo, hi):
                v = min(v, points[k][1])
            return v

        start = geo.interp(poly, cum, 0.0)
        lat, lon = self._jit(start[0], start[1], jitter, geo.heading_at(poly, cum, 0.0))
        fixes = [LocationFix(lat, lon, start_t, seg.mode)]
        t, v_in = start_t, v_entry
        bounds = [0.0] + [c.s for c in stops] + [total]
        for p in range(len(bounds) - 1):
            a, b = bounds[p], bounds[p + 1]
            last_piece = p == len(bounds) - 2
            n = max(2, int(math.ceil((b - a) / _GRID_M)))
            ss = sorted({a + (b - a) * j / n for j in range(n + 1)}
                        | {s for s in point_s if a < s < b})
            v = plan_piece(ss, [cap_at(s) for s in ss], v_in, v_exit if last_piece else 0.0,
                           accel_at, brake, stop_brake)
            times = _timing(ss, v)
            k = 1
            while k < times[-1]:
                s = _position(ss, v, times, k)
                pt = geo.interp(poly, cum, s)
                lat, lon = self._jit(pt[0], pt[1], jitter, geo.heading_at(poly, cum, s))
                fixes.append(LocationFix(lat, lon, t + k, seg.mode))
                k += 1
            t += max(1, math.ceil(times[-1]))
            pt = geo.interp(poly, cum, b)
            lat, lon = self._jit(pt[0], pt[1], jitter, geo.heading_at(poly, cum, b))
            fixes.append(LocationFix(lat, lon, t, seg.mode))
            if not last_piece:   # wait at the light / stop sign, then pull away from rest
                wait = max(1, round(stops[p].dwell_s))
                first = min(_STOP_SAMPLE_S, wait)   # the arrival fix above already stands at t
                held, t = self._hold(pt, wait - first, t + first, DEFAULT_JITTER_M[STOP], seg.mode, True)
                fixes.extend(held)
                v_in = 0.0
        return fixes, t, poly[-1]

    # -- output ---------------------------------------------------------------

    @staticmethod
    def to_gpx(fixes, creator="vida-360"):
        """Render fixes to a GPX string — the format `simulate-location play` consumes.
        Whole-second resolution; the renderer emits integer timestamps so none collide."""
        lines = ['<?xml version="1.0" encoding="UTF-8"?>',
                 f'<gpx version="1.1" creator="{creator}"><trk><trkseg>']
        for fx in fixes:
            ts = (_GPX_EPOCH + timedelta(seconds=fx.t)).strftime("%Y-%m-%dT%H:%M:%SZ")
            lines.append(
                f'  <trkpt lat="{fx.lat:.6f}" lon="{fx.lon:.6f}"><time>{ts}</time></trkpt>'
            )
        lines.append("</trkseg></trk></gpx>")
        return "\n".join(lines)
