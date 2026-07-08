"""RouteRenderer — turns a Route into a trajectory of LocationFix, and into GPX.

The only place that knows about speed profiles, accel/decel ramps, and spatial jitter. Knows
nothing about pymobiledevice3. Straight-line interpolation between waypoints is the no-network
fallback; a Valhalla road-snapping step (build time) will later densify each segment's
waypoints into a road-following polyline *before* it reaches the renderer, so this code is
unchanged by that. See docs/MOVEMENT_ENGINE.md.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone

from .model import Route, LocationFix, STOP, DEFAULT_ACCEL_MPS2

_DT = 1.0                 # emit one fix per second
_STOP_SAMPLE_S = 5.0      # during a dwell, drop a (jittered) fix this often
_MIN_CRAWL_MPS = 0.4      # floor so a decelerating segment can't numerically stall
_JITTER_STEP_MAX_M = 0.5  # max jitter offset change per second, per axis (bounds fake speed)
_GPX_EPOCH = datetime(2020, 1, 1, tzinfo=timezone.utc)
_M_PER_DEG = 111_111.0    # meters per degree latitude (good enough at city scale)
_EARTH_R = 6_371_000.0


def _haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_R * math.asin(math.sqrt(h))


def _cumulative(polyline: list[tuple[float, float]]) -> list[float]:
    cum = [0.0]
    for i in range(1, len(polyline)):
        cum.append(cum[-1] + _haversine(polyline[i - 1], polyline[i]))
    return cum


def _interp(polyline, cum, d):
    """Position at distance d (meters) along the polyline (linear between vertices)."""
    if d <= 0:
        return polyline[0]
    if d >= cum[-1]:
        return polyline[-1]
    i = 1
    while i < len(cum) and cum[i] < d:
        i += 1
    d0, d1 = cum[i - 1], cum[i]
    (lat0, lon0), (lat1, lon1) = polyline[i - 1], polyline[i]
    f = (d - d0) / (d1 - d0) if d1 > d0 else 0.0
    return (lat0 + f * (lat1 - lat0), lon0 + f * (lon1 - lon0))


class RouteRenderer:
    """Render a Route to LocationFixes. Jitter is seeded so rebuilding a preset yields the
    same GPX (diff-friendly cached artifacts)."""

    def __init__(self, seed: int = 0):
        self._rng = random.Random(seed)
        self._off_lat_m = 0.0    # current jitter offset (meters), evolves as a bounded walk
        self._off_lon_m = 0.0

    def render(self, route: Route) -> list[LocationFix]:
        fixes: list[LocationFix] = []
        t_cursor = 0.0          # time for the NEXT fix to emit
        pos: tuple[float, float] | None = None
        segs = route.segments

        for i, seg in enumerate(segs):
            if seg.mode == STOP:
                at = seg.at or pos
                if at is None:
                    raise ValueError("a stop with no 'at' cannot be the first segment")
                new_fixes, last_t = self._emit_stop(at, seg, t_cursor)
                pos = at
            else:
                prev_stop = i == 0 or segs[i - 1].mode == STOP
                next_stop = i == len(segs) - 1 or segs[i + 1].mode == STOP
                new_fixes, last_t, pos = self._emit_move(seg, t_cursor, prev_stop, next_stop)
            fixes.extend(new_fixes)
            t_cursor = last_t + _DT     # keep timestamps strictly increasing across segments

        return fixes

    # -- helpers ---------------------------------------------------------------

    def _jit(self, lat, lon, jitter_m):
        """Nudge the point by a bounded random-walk offset so the track wanders like real
        GPS. The offset is *correlated* across points and its per-second change is capped, so
        jitter can never fabricate an implausible inter-point speed (a bug the IID-noise first
        cut had). Offset magnitude stays within ~jitter_m; state carries across segments so
        there's no discontinuity at boundaries."""
        if jitter_m <= 0:
            return lat, lon
        self._off_lat_m = self._walk_axis(self._off_lat_m, jitter_m)
        self._off_lon_m = self._walk_axis(self._off_lon_m, jitter_m)
        dlat = self._off_lat_m / _M_PER_DEG
        dlon = self._off_lon_m / (_M_PER_DEG * math.cos(math.radians(lat)))
        return lat + dlat, lon + dlon

    def _walk_axis(self, off, cap):
        step = _JITTER_STEP_MAX_M
        target = max(-cap, min(cap, off + self._rng.uniform(-step, step)))
        delta = max(-step, min(step, target - off))   # cap per-step change even if cap shrank
        return off + delta

    def _emit_stop(self, at, seg, start_t):
        fixes = []
        t = start_t
        end = start_t + seg.dwell_s
        while t < end:
            lat, lon = self._jit(at[0], at[1], seg.jitter_m)
            fixes.append(LocationFix(lat, lon, t, STOP))
            t += _STOP_SAMPLE_S
        lat, lon = self._jit(at[0], at[1], seg.jitter_m)
        fixes.append(LocationFix(lat, lon, end, STOP))
        return fixes, end

    def _emit_move(self, seg, start_t, prev_stop, next_stop):
        poly = seg.waypoints
        cum = _cumulative(poly)
        total = cum[-1]
        jitter = seg.jitter_m

        # zero-length move -> single fix (degenerate; keeps callers simple)
        if total <= 0:
            lat, lon = self._jit(poly[0][0], poly[0][1], jitter)
            return [LocationFix(lat, lon, start_t, seg.mode)], start_t, poly[-1]

        v_cruise = seg.cruise_speed()
        accel = DEFAULT_ACCEL_MPS2.get(seg.mode, DEFAULT_ACCEL_MPS2["drive"])
        v = 0.0 if prev_stop else v_cruise            # ramp up from a stop, else continue
        v_exit = 0.0 if next_stop else v_cruise        # ramp down into a stop, else continue

        fixes = []
        t = start_t
        d = 0.0
        guard = 0
        max_steps = int(total / _MIN_CRAWL_MPS) + 100  # safety net; should never trip

        while True:
            lat, lon = _interp(poly, cum, d)
            jlat, jlon = self._jit(lat, lon, jitter)
            fixes.append(LocationFix(jlat, jlon, t, seg.mode))
            if d >= total:
                break
            remaining = total - d
            # distance we'd need to bleed off to hit v_exit at the end
            decel_dist = max(0.0, (v * v - v_exit * v_exit) / (2 * accel))
            if remaining <= decel_dist:
                v = max(v_exit, v - accel * _DT)
            else:
                v = min(v_cruise, v + accel * _DT)
            v = max(v, _MIN_CRAWL_MPS)
            d = min(total, d + v * _DT)
            t += _DT
            guard += 1
            if guard > max_steps:
                lat, lon = _interp(poly, cum, total)
                jlat, jlon = self._jit(lat, lon, jitter)
                fixes.append(LocationFix(jlat, jlon, t, seg.mode))
                break

        return fixes, t, poly[-1]

    @staticmethod
    def to_gpx(fixes: list[LocationFix], creator: str = "vida-360") -> str:
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
