"""Build-time road-snapping via Valhalla: `/route` for the line, `/trace_attributes` for the roads.

`/route` replaces a segment's hand-authored waypoints with a dense, road-following polyline so the
pin travels down real streets instead of straight lines. `/trace_attributes` then reads back what
each stretch of that line is: road class, Valhalla's speed, the tagged speed limit, traffic lights,
how much each intersection slows you, the roads that cross it. roads.py turns that into speeds,
red lights, stops and turns (docs/research/valhalla-road-snapping.md §2).

Both are fetched from the public FOSSGIS server once per route edit and cached on disk next to each
other (snap-cache/, which the release build bundles). Any failure falls back: no line = straight
segments, no road data = one cruise speed (the old behaviour).

No pymobiledevice3 here — this is offline build tooling. Set VALHALLA_BASE_URL to self-host.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import time
import urllib.error
import urllib.request

from .model import DRIVE, Route, Segment, STOP

DEFAULT_BASE_URL = "https://valhalla1.openstreetmap.de"
_COSTING = {"walk": "pedestrian", "drive": "auto"}
_CACHE_DIR = os.path.join(os.environ.get("VIDA_BUILD_DIR") or os.path.join(os.path.dirname(__file__), "..", "..", "build"),
                          "snap-cache")


class SnapError(Exception):
    """Snapping failed (no route, unreachable server, bad response). Caller should fall back."""


def _base_url() -> str:
    return os.environ.get("VALHALLA_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


_PACE_S = 1.0          # at most one request a second to the public server
_last_request = 0.0


def _post(url: str, body: dict, timeout: float) -> dict:
    """POST JSON to Valhalla, spaced out so a batch (warm_legs, gen_destinations) stays polite."""
    global _last_request
    wait = _last_request + _PACE_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json",
                 "User-Agent": "vida-360", "X-Client-Id": "vida-360"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    finally:
        _last_request = time.monotonic()


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

    body = {
        "locations": [{"lat": lat, "lon": lon, "radius": 30} for lat, lon in wp],
        "costing": costing,
        "directions_options": {"units": "kilometers"},
    }
    try:
        data = _post(f"{base_url or _base_url()}/route", body, timeout=25)
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


# ---- what the roads are -----------------------------------------------------------------------
# trace_attributes on the line /route gave us. "walk_or_snap": the exact edge walk fails on /route's
# own shape (it starts and ends part-way along an edge), the map-matching fallback doesn't. Edges come
# back as matched lengths, roads.map_edges lays them onto the polyline by distance.
_ROAD_ATTRS = [
    "edge.length", "edge.speed", "edge.speed_limit", "edge.road_class", "edge.use",
    "edge.begin_heading", "edge.end_heading", "edge.traffic_signal", "edge.roundabout",
    "edge.internal_intersection", "edge.drive_on_right",
    "node.traffic_signal", "node.stop_impact", "node.intersecting_edge.road_class",
    "node.intersecting_edge.driveability",
    "matched.type", "matched.begin_route_discontinuity", "matched.end_route_discontinuity",
]
ROADS_VERSION = 1      # bump when the compact edge format below changes (old cache files are refetched)
_RETRY_S = 300         # after a network failure, don't ask again for this long (per process)
_down_until = 0.0
_DRIVABLE = ("forward", "backward", "both")


class RoadsUnavailable(Exception):
    """No road data for this line right now (network). Not cached, try again later."""


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def _compact(e: dict) -> dict:
    """Just what roads.py reads, under short keys (a 100 km drive is ~500 edges)."""
    end = e.get("end_node") or {}
    return {
        "km": float(e.get("length") or 0.0),
        "kmh": _num(e.get("speed")),
        "limit": _num(e.get("speed_limit")),
        "cls": e.get("road_class") or "",
        "use": e.get("use") or "road",
        "h0": e.get("begin_heading"),
        "h1": e.get("end_heading"),
        "sig": bool(e.get("traffic_signal")) or bool(end.get("traffic_signal")),
        "impact": int(end.get("stop_impact") or 0),
        "cross": [x.get("road_class") or "" for x in end.get("intersecting_edges") or []
                  if x.get("driveability") in _DRIVABLE],
        "rb": bool(e.get("roundabout")),
        "internal": bool(e.get("internal_intersection")),
        "rhs": e.get("drive_on_right", True) is not False,
    }


def _roads_cache_path(polyline, costing) -> str:
    wp = [[round(lat, 6), round(lon, 6)] for lat, lon in polyline]
    key = hashlib.sha1(json.dumps(["roads", costing, wp]).encode()).hexdigest()[:16]
    return os.path.join(_CACHE_DIR, f"{key}.roads.json")


def road_edges(polyline, mode: str = DRIVE, base_url: str | None = None, network: bool = True):
    """The compact edges under `polyline` (see _compact), or None when Valhalla can't match it
    (that answer is cached too, so it isn't asked again). network=False only reads the cache and
    raises RoadsUnavailable on a miss; so does a network failure, which is retried after _RETRY_S."""
    global _down_until
    costing = _COSTING.get(mode)
    if costing is None or len(polyline) < 2:
        return None
    path = _roads_cache_path(polyline, costing)
    try:
        with open(path, encoding="utf-8") as f:
            cached = json.load(f)
        if cached.get("v") == ROADS_VERSION:
            return cached.get("edges")
    except (OSError, ValueError, AttributeError):
        pass
    if not network:
        raise RoadsUnavailable("not cached")
    if time.monotonic() < _down_until:
        raise RoadsUnavailable("Valhalla was unreachable a moment ago")

    body = {"shape": [{"lat": lat, "lon": lon} for lat, lon in polyline], "costing": costing,
            "shape_match": "walk_or_snap", "filters": {"attributes": _ROAD_ATTRS, "action": "include"}}
    why = None
    try:
        data = _post(f"{base_url or _base_url()}/trace_attributes", body, timeout=20)
    except urllib.error.HTTPError as e:
        if e.code >= 500 or e.code == 429:
            _down_until = time.monotonic() + _RETRY_S
            raise RoadsUnavailable(f"Valhalla answered {e.code}") from e
        data, why = None, f"Valhalla answered {e.code}"   # 400 = it can't match this line, won't change
    except Exception as e:   # unreachable, timeout, bad JSON
        _down_until = time.monotonic() + _RETRY_S
        raise RoadsUnavailable(f"Valhalla request failed: {e}") from e

    edges = None
    if data is not None:
        matched = data.get("matched_points") or []
        if any(m.get("type") == "unmatched" or m.get("begin_route_discontinuity")
               or m.get("end_route_discontinuity") for m in matched):
            why = "the match has a gap"
        elif not data.get("edges"):
            why = "no edges"
        else:
            edges = [_compact(e) for e in data["edges"]]
    os.makedirs(_CACHE_DIR, exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump({"v": ROADS_VERSION, "edges": edges, **({"why": why} if why else {})}, f)
    os.replace(path + ".tmp", path)
    return edges


def snap_route(route: Route, base_url: str | None = None, roads: str = "fetch") -> tuple[Route, list[str]]:
    """Return a copy of `route` with each snap-enabled move segment's waypoints replaced by a
    road-following polyline, and each snapped drive's `roads` filled in (unless it's `steady`).
    On a per-segment SnapError, keep the straight-line waypoints and record a warning (the offline
    fallback). roads: "fetch" (ask Valhalla on a cache miss), "cache" (read the cache only, for the
    app's route list) or "off". Returns (route, warnings)."""
    from .roads import map_edges   # roads.py is pure logic over model.py, no cycle at import time

    warnings: list[str] = []
    new_segments: list[Segment] = []
    for i, seg in enumerate(route.segments):
        if seg.mode == STOP or not seg.snap:
            new_segments.append(seg)
            continue
        try:
            snapped = snap_waypoints(seg.waypoints, seg.mode, base_url)
        except SnapError as e:
            warnings.append(f"segment {i} ({seg.mode}): snapping failed, using straight line — {e}")
            new_segments.append(seg)
            continue
        edges = None
        if seg.mode == DRIVE and not seg.steady and roads != "off":
            try:
                edges = map_edges(road_edges(snapped, seg.mode, base_url, network=roads == "fetch"), snapped)
            except RoadsUnavailable as e:
                if roads == "fetch":
                    warnings.append(f"segment {i} (drive): no road data, one cruise speed — {e}")
        new_segments.append(dataclasses.replace(seg, waypoints=snapped, roads=edges))
    return Route(name=route.name, description=route.description, segments=new_segments,
                 label=route.label, city=route.city), warnings
