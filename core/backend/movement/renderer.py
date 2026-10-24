"""RouteRenderer — turns a Route into a trajectory of LocationFix, and into GPX.

The only place that knows about speed profiles, jerk-limited ramps, and spatial jitter. Knows
nothing about pymobiledevice3. Straight-line interpolation between waypoints is the no-network
fallback; a Valhalla road-snapping step (build time) will later densify each segment's
waypoints into a road-following polyline *before* it reaches the renderer, so this code is
unchanged by that.

Realism choices are grounded in docs/research/ (see model.py for the tuned constants):
- jerk-limited accel (an instantaneous velocity step is the #1 synthetic tell),
- a zero-speed dwell at every mode change (park, then walk),
- walk speed sampled ~N(1.34, 0.30),
- GPS jitter as a bounded, perpendicular-biased random walk that can't manufacture speed.
See docs/MOVEMENT_ENGINE.md.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone

from .model import (
    Route, LocationFix, WALK, STOP,
    DEFAULT_SPEED_MPS, DEFAULT_ACCEL_MPS2, DEFAULT_JERK_MPS3, DEFAULT_JITTER_M,
    WALK_SPEED_MEAN_MPS, WALK_SPEED_STD_MPS, WALK_SPEED_CLAMP,
    CORNER_LAT_ACCEL_MPS2, CORNER_MIN_SPEED_MPS,
)

_DT = 1.0                  # emit one fix per second
_STOP_SAMPLE_S = 5.0       # during a dwell, drop a (jittered) fix this often
_MIN_CRAWL_MPS = 0.4       # floor so a decelerating segment can't numerically stall
_JITTER_STEP_MAX_M = 0.5   # max jitter offset change per second, per axis (bounds fake speed)
_JITTER_ALONG_FRAC = 0.35  # along-track jitter is smaller than cross-track (realistic + safe)
_PLAN_STEP_M = 15.0        # densify long gaps to this spacing so the speed plan can ramp
_GPX_EPOCH = datetime(2020, 1, 1, tzinfo=timezone.utc)
_M_PER_DEG = 111_111.0     # meters per degree latitude (good enough at city scale)
_EARTH_R = 6_371_000.0


def _haversine(a, b):
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_R * math.asin(math.sqrt(h))


def _bearing(a, b):
    """Compass bearing a->b in radians (clockwise from north)."""
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlon = math.radians(b[1] - a[1])
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return math.atan2(x, y)


def _cumulative(polyline):
    cum = [0.0]
    for i in range(1, len(polyline)):
        cum.append(cum[-1] + _haversine(polyline[i - 1], polyline[i]))
    return cum


def _bracket(cum, d):
    """Index i such that cum[i-1] <= d <= cum[i] (the polyline segment containing d)."""
    i = 1
    while i < len(cum) - 1 and cum[i] < d:
        i += 1
    return i


def _interp(polyline, cum, d):
    if d <= 0:
        return polyline[0]
    if d >= cum[-1]:
        return polyline[-1]
    i = _bracket(cum, d)
    d0, d1 = cum[i - 1], cum[i]
    (lat0, lon0), (lat1, lon1) = polyline[i - 1], polyline[i]
    f = (d - d0) / (d1 - d0) if d1 > d0 else 0.0
    return (lat0 + f * (lat1 - lat0), lon0 + f * (lon1 - lon0))


def _heading_at(polyline, cum, d):
    i = _bracket(cum, min(max(d, 0.0), cum[-1]))
    return _bearing(polyline[i - 1], polyline[i])


def _local_xy(origin, p):
    """Meters (east, north) of point p relative to origin — equirectangular, fine at city scale."""
    de = (p[1] - origin[1]) * _M_PER_DEG * math.cos(math.radians(origin[0]))
    dn = (p[0] - origin[0]) * _M_PER_DEG
    return de, dn


def _corner_speed(a, b, c, cruise):
    """Safe speed through vertex b given neighbors a and c: sqrt(a_lat * R), where R is the
    Menger radius of the circle through a, b, c. Collinear -> R=inf -> full cruise."""
    ax, ay = _local_xy(b, a)
    cx, cy = _local_xy(b, c)
    dab = math.hypot(ax, ay)
    dcb = math.hypot(cx, cy)
    dac = math.hypot(ax - cx, ay - cy)
    area2 = abs(ax * cy - ay * cx)          # twice the triangle area (b at the origin)
    if area2 < 1e-6 or dab < 1e-6 or dcb < 1e-6:
        return cruise
    radius = (dab * dcb * dac) / (2.0 * area2)   # (|ab||bc||ca|) / (4*area); 4*area == 2*area2
    v = math.sqrt(CORNER_LAT_ACCEL_MPS2 * radius)
    return max(CORNER_MIN_SPEED_MPS, min(cruise, v))


_BRAKE_MARGIN = 0.5   # fraction of DEFAULT_ACCEL the plan brakes at into the final stop (see plan_speeds)


def plan_speeds(polyline, cruise, v_entry, v_exit):
    """Per-vertex target speed that slows for corners and is feasible under longitudinal accel.
    (1) corner speed limit per interior vertex, (2) backward pass to brake *before* corners,
    (3) forward pass to cap acceleration out of them and hold cruise. See
    docs/superpowers/specs/2026-07-08-corner-aware-speed-realism-design.md."""
    n = len(polyline)
    if n == 0:
        return []
    if n == 1:
        return [min(cruise, max(v_entry, v_exit))]

    gap = [0.0] * n
    for i in range(1, n):
        gap[i] = _haversine(polyline[i - 1], polyline[i])   # distance from vertex i-1 to i

    v = [cruise] * n
    for i in range(1, n - 1):
        v[i] = _corner_speed(polyline[i - 1], polyline[i], polyline[i + 1], cruise)
    v[0] = min(v[0], v_entry)
    v[-1] = min(v[-1], v_exit)

    a_lon = DEFAULT_ACCEL_MPS2["drive"]
    for i in range(n - 2, -1, -1):                          # backward: decel into what's ahead
        v[i] = min(v[i], math.sqrt(v[i + 1] ** 2 + 2 * a_lon * gap[i + 1]))
    # the final stop gets a softer ramp: the jerk-limited tracker takes a couple of seconds to
    # reach full decel, so a full-a_lon plan arrives at the end still rolling (a velocity step
    # into the next segment). Corners keep full a_lon, a car does brake harder for those.
    a_brake, to_end = a_lon * _BRAKE_MARGIN, 0.0
    for i in range(n - 2, -1, -1):
        to_end += gap[i + 1]
        v[i] = min(v[i], math.sqrt(v[-1] ** 2 + 2 * a_brake * to_end))
    for i in range(1, n):                                   # forward: accel out, cap at cruise
        v[i] = min(v[i], math.sqrt(v[i - 1] ** 2 + 2 * a_lon * gap[i]))
    return v


def _densify(poly, max_step=_PLAN_STEP_M):
    """Subdivide long gaps so the speed plan has resolution to ramp up and down — a 2-waypoint
    rest-to-rest leg otherwise can't represent accelerate->cruise->decelerate and collapses to a
    crawl. Geometry-preserving: inserted points lie on the existing straight segments, so the
    path is unchanged; only the sampling density increases."""
    if len(poly) < 2:
        return list(poly)
    out = [poly[0]]
    for i in range(1, len(poly)):
        a, b = poly[i - 1], poly[i]
        d = _haversine(a, b)
        n = max(1, int(math.ceil(d / max_step)))
        for k in range(1, n + 1):
            f = k / n
            out.append((a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])))
    return out


def _plan_at(cum, vplan, d):
    """Planned speed at arc distance d along the polyline (linear between vertices)."""
    if d <= 0:
        return vplan[0]
    if d >= cum[-1]:
        return vplan[-1]
    i = _bracket(cum, d)
    d0, d1 = cum[i - 1], cum[i]
    f = (d - d0) / (d1 - d0) if d1 > d0 else 0.0
    return vplan[i - 1] + f * (vplan[i] - vplan[i - 1])


class RouteRenderer:
    """Render a Route to LocationFixes. Jitter + walk-speed sampling are seeded so rebuilding a
    preset yields the same GPX (diff-friendly cached artifacts)."""

    def __init__(self, seed: int = 0):
        self._rng = random.Random(seed)
        self._off_e = 0.0    # jitter offset (meters, east/north), evolves as a bounded walk
        self._off_n = 0.0

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
                v_entry = carry_v                                   # 0 unless continuing same mode
                next_same = i < len(segs) - 1 and segs[i + 1].mode == seg.mode
                v_exit = v_cruise if next_same else 0.0             # decel to 0 into stops/mode-changes
                new_fixes, last_t, pos = self._emit_move(
                    seg, t_cursor, v_entry, v_exit, v_cruise)
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
        The offset is correlated across points and its per-second change is capped, so jitter
        can never fabricate an implausible speed. When a heading is known, noise is biased
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
        dlat = self._off_n / _M_PER_DEG
        dlon = self._off_e / (_M_PER_DEG * math.cos(math.radians(lat)))
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
        fixes = []
        t = start_t
        end = start_t + seg.dwell_s
        while t < end:
            lat, lon = self._jit(at[0], at[1], jitter)
            fixes.append(LocationFix(lat, lon, t, STOP))
            t += _STOP_SAMPLE_S
        lat, lon = self._jit(at[0], at[1], jitter)
        fixes.append(LocationFix(lat, lon, end, STOP))
        return fixes, end

    def _emit_move(self, seg, start_t, v_entry, v_exit, v_cruise):
        poly = _densify(seg.waypoints)
        cum = _cumulative(poly)
        total = cum[-1]
        jitter = seg.jitter_m or DEFAULT_JITTER_M.get(seg.mode, 5.0)

        # zero-length move -> single fix (degenerate; keeps callers simple)
        if total <= 0:
            lat, lon = self._jit(poly[0][0], poly[0][1], jitter)
            return [LocationFix(lat, lon, start_t, seg.mode)], start_t, poly[-1]

        max_a = DEFAULT_ACCEL_MPS2.get(seg.mode, DEFAULT_ACCEL_MPS2["drive"])
        jerk = DEFAULT_JERK_MPS3.get(seg.mode, DEFAULT_JERK_MPS3["drive"])
        vplan = plan_speeds(poly, v_cruise, v_entry, v_exit)

        fixes = []
        t = start_t
        d = 0.0
        v = v_entry
        a = 0.0
        guard = 0
        max_steps = int(total / _MIN_CRAWL_MPS) + 200   # safety net; should never trip

        while True:
            pos = _interp(poly, cum, d)
            hdg = _heading_at(poly, cum, d)
            jlat, jlon = self._jit(pos[0], pos[1], jitter, hdg)
            fixes.append(LocationFix(jlat, jlon, t, seg.mode))
            if d >= total:
                break

            remaining = total - d
            # follow the pre-planned speed at this arc position: the backward pass already
            # lowered it on the approach to every corner, so tracking it brakes *before* turns.
            v_target = _plan_at(cum, vplan, d)
            if v < v_target - 1e-6:
                a_des = max_a
            elif v > v_target + 1e-6:
                a_des = -max_a
            else:
                a_des = 0.0
            # jerk-limit the change in acceleration (S-curve, no instantaneous velocity step)
            a = max(a - jerk * _DT, min(a + jerk * _DT, a_des))
            v = max(0.0, min(v_cruise, v + a * _DT))
            if remaining > 0 and v < _MIN_CRAWL_MPS:
                v = _MIN_CRAWL_MPS
            d = min(total, d + v * _DT)
            t += _DT
            guard += 1
            if guard > max_steps:
                pos = _interp(poly, cum, total)
                jlat, jlon = self._jit(pos[0], pos[1], jitter, hdg)
                fixes.append(LocationFix(jlat, jlon, t, seg.mode))
                break

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
