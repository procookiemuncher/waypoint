"""Build-time road-snapping via Valhalla `/route` (Increment 2).

Replaces a segment's hand-authored waypoints with a dense, road-following polyline so the pin
travels down real streets instead of straight lines. **Geometry only** for now — the timing
(speed) still comes from the renderer / the segment's `speed_mps`; per-edge `trace_attributes`
speed is a later step (see docs/research/valhalla-road-snapping.md §2). Build-time only: hits the
public FOSSGIS server once per route edit, caches the result, and the caller falls back to the
straight-line renderer if the network / a route is unavailable.

No pymobiledevice3 here — this is offline build tooling. Set VALHALLA_BASE_URL to self-host.
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.request

from .model import Route, Segment, STOP

DEFAULT_BASE_URL = "https://valhalla1.openstreetmap.de"
_COSTING = {"walk": "pedestrian", "drive": "auto"}
_CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "build", "snap-cache")


class SnapError(Exception):
    """Snapping failed (no route, unreachable server, bad response). Caller should fall back."""


def _base_url() -> str:
    return os.environ.get("VALHALLA_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def decode_polyline6(s: str, precision: int = 6) -> list[tuple[float, float]]:
    """Decode a Valhalla encoded polyline. Valhalla uses 1e6 precision, NOT Google's 1e5 —
    decoding with 1e5 puts every point 10x off (docs/research/valhalla-road-snapping.md §1)."""
    inv = 1.0 / (10 ** precision)
    coords: list[tuple[float, float]] = []
    index = lat = lon = 0
    while index < len(s):
        for is_lon in (False, True):
            shift = result = 0
            while True:
                b = ord(s[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lon:
                lon += delta
            else:
                lat += delta
        coords.append((lat * inv, lon * inv))
    return coords


def _cache_path(waypoints, costing) -> str:
    key = hashlib.sha1(json.dumps([costing, waypoints], sort_keys=True).encode()).hexdigest()[:16]
    return os.path.join(_CACHE_DIR, f"{key}.json")


def snap_waypoints(waypoints, mode, base_url: str | None = None) -> list[tuple[float, float]]:
    """Snap ordered (lat, lon) waypoints to a road-following polyline for `mode`. Cached on disk
    by (waypoints, costing). Raises SnapError on any failure so the caller can fall back."""
    costing = _COSTING.get(mode)
    if costing is None:
        raise SnapError(f"no costing model for mode {mode!r}")

    wp = [[round(lat, 6), round(lon, 6)] for lat, lon in waypoints]
    cache = _cache_path(wp, costing)
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            return [tuple(p) for p in json.load(f)]

    body = json.dumps({
        "locations": [{"lat": lat, "lon": lon, "radius": 30} for lat, lon in wp],
        "costing": costing,
        "directions_options": {"units": "kilometers"},
    }).encode()
    req = urllib.request.Request(
        f"{base_url or _base_url()}/route", data=body,
        headers={"Content-Type": "application/json",
                 "User-Agent": "vida-360", "X-Client-Id": "vida-360"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            data = json.loads(r.read())
    except Exception as e:  # network, HTTP, JSON — all non-recoverable here
        raise SnapError(f"Valhalla request failed: {e}") from e

    trip = data.get("trip", {})
    if trip.get("status") != 0:
        raise SnapError(f"Valhalla: {trip.get('status_message', 'no route')}")

    # Concatenate each leg's decoded shape, dropping the duplicated join vertex between legs.
    poly: list[tuple[float, float]] = []
    for leg in trip.get("legs", []):
        pts = decode_polyline6(leg["shape"])
        if poly and pts and pts[0] == poly[-1]:
            pts = pts[1:]
        poly.extend(pts)
    if len(poly) < 2:
        raise SnapError("Valhalla returned a degenerate shape")

    os.makedirs(_CACHE_DIR, exist_ok=True)
    with open(cache, "w", encoding="utf-8") as f:
        json.dump([[lat, lon] for lat, lon in poly], f)
    return poly


def snap_route(route: Route, base_url: str | None = None) -> tuple[Route, list[str]]:
    """Return a copy of `route` with each snap-enabled move segment's waypoints replaced by a
    road-following polyline. On a per-segment SnapError, keep the straight-line waypoints and
    record a warning (the offline fallback). Returns (route, warnings)."""
    warnings: list[str] = []
    new_segments: list[Segment] = []
    for i, seg in enumerate(route.segments):
        if seg.mode == STOP or not seg.snap:
            new_segments.append(seg)
            continue
        try:
            snapped = snap_waypoints(seg.waypoints, seg.mode, base_url)
            new_segments.append(Segment(
                mode=seg.mode, waypoints=snapped, speed_mps=seg.speed_mps,
                jitter_m=seg.jitter_m, snap=seg.snap))
        except SnapError as e:
            warnings.append(f"segment {i} ({seg.mode}): snapping failed, using straight line — {e}")
            new_segments.append(seg)
    return Route(name=route.name, description=route.description, segments=new_segments,
                 label=route.label, city=route.city), warnings
