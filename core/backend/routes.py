"""Route library helpers shared by the spoof CLI and the app: list core/routes/*.json, get a
road-snapped preview line, and render + validate a route into a GPX the phone can replay."""
import dataclasses
import glob
import hashlib
import json
import math
import os

from backend.destinations import route_ends
from backend.movement import load_route, RouteRenderer, validate, snap_route
from backend.movement.model import STOP, WALK_SPEED_MEAN_MPS
from backend.secret import load_json

CORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTES_DIR = os.path.join(CORE, "routes")
# generated GPX + snap cache. The packaged app points this at ~/Library/Application Support/Waypoint
# since its own bundle is read-only.
BUILD_DIR = os.environ.get("VIDA_BUILD_DIR") or os.path.join(CORE, "build")


class RouteError(Exception):
    pass


def route_files() -> list[str]:
    return sorted(glob.glob(os.path.join(ROUTES_DIR, "*.json")))


def route_path(route_id: str) -> str:
    """core/routes/<id>.json, refusing anything that isn't a plain file name in there."""
    path = os.path.join(ROUTES_DIR, os.path.basename(route_id) + ".json")
    if not os.path.isfile(path):
        raise RouteError(f"no route called '{route_id}'")
    return path


MAX_TIMELINE_POINTS = 1500


def thin(points: list, limit: int = MAX_TIMELINE_POINTS) -> list:
    """Keep the first/last point and an even spread in between — plenty for drawing the pin."""
    if len(points) <= limit:
        return points
    step = (len(points) - 1) / (limit - 1)
    return [points[round(i * step)] for i in range(limit)]


def haversine(a, b) -> float:
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    h = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(h))


# How long each part of a route plays: [{mode, s, m}] (walk / drive / stop, seconds, meters), in order,
# runs of one mode merged. Rendered at seed 0, which is exactly the GPX Spoof plays (Drive starts from
# a new seed with a slow wander on top, so it lands within a minute or two of it). Rendering all the
# routes takes ~12 s, too long for the app's boot, so each one is rendered once in the background
# (warm_legs) and kept on disk; until then the summary carries an estimate and "exact": false.
LEGS_DIR = os.path.join(BUILD_DIR, "legs-cache")
LEGS_VERSION = 1   # bump when the renderer changes how long things take


def _legs_key(route) -> str:
    blob = json.dumps([LEGS_VERSION, dataclasses.asdict(route)], sort_keys=True, default=str)
    return hashlib.sha1(blob.encode()).hexdigest()


def _merge(legs: list, mode: str, s: float, m: float):
    if legs and legs[-1]["mode"] == mode:
        legs[-1]["s"] += s
        legs[-1]["m"] += m
    else:
        legs.append({"mode": mode, "s": s, "m": m})


def _rounded(legs: list) -> list:
    return [{"mode": g["mode"], "s": round(g["s"]), "m": round(g["m"])} for g in legs]


def render_legs(route) -> list:
    """The legs of a (snapped) route as it really plays, from the renderer at seed 0."""
    fixes = RouteRenderer(0).render(route)
    legs = []
    for a, b in zip(fixes, fixes[1:]):
        _merge(legs, b.mode, b.t - a.t, 0.0 if b.mode == STOP else haversine((a.lat, a.lon), (b.lat, b.lon)))
    return _rounded(legs)


def estimate_legs(route) -> list:
    """Distance / speed per segment (walks at the mean walking pace) + the stops. Comes out a few
    percent short of the render, more on winding roads (the renderer brakes for bends)."""
    legs = []
    for seg in route.segments:
        if seg.mode == STOP:
            _merge(legs, STOP, seg.dwell_s, 0.0)
            continue
        m = sum(haversine(seg.waypoints[i], seg.waypoints[i + 1]) for i in range(len(seg.waypoints) - 1))
        _merge(legs, seg.mode, m / (seg.speed_mps or WALK_SPEED_MEAN_MPS) + seg.dwell_s, m)
    return _rounded(legs)


def _legs_file(route) -> str:
    return os.path.join(LEGS_DIR, os.path.basename(route.name) + ".json")


def cached_legs(route):
    """The rendered legs if they're on disk for this exact route, else None."""
    try:
        with open(_legs_file(route), encoding="utf-8") as f:
            data = json.load(f)
        return data["legs"] if data.get("key") == _legs_key(route) else None
    except (OSError, ValueError, KeyError):
        return None


def store_legs(route, legs: list):
    os.makedirs(LEGS_DIR, exist_ok=True)
    path = _legs_file(route)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump({"key": _legs_key(route), "legs": legs}, f)
    os.replace(path + ".tmp", path)


def warm_legs(log=print) -> int:
    """Render and keep the legs of every route that doesn't have them on disk yet. Returns how many."""
    done = 0
    for path in route_files():
        try:
            route, _ = snap_route(load_route(path))
            if cached_legs(route) is None:
                store_legs(route, render_legs(route))
                done += 1
        except (ValueError, OSError) as e:
            log(f"legs for {os.path.basename(path)}: {e}")
    return done


def summary(path: str, snap: bool = True) -> dict:
    """What the app's route list needs: id, name, label, city, the line to draw, distance, the
    first moving segment's speed, the legs (see LEGS_DIR) and how long it plays in all, whether
    it was generated from the catalog and, if so, where it starts and ends."""
    route = load_route(path)
    if snap:
        route, _ = snap_route(route)   # cached on disk after the first time; falls back offline
    line, speed = [], None
    for seg in route.segments:
        if seg.waypoints:
            pts = list(seg.waypoints)
            if line and pts[0] == line[-1]:
                pts = pts[1:]
            line.extend(pts)
            speed = speed or seg.speed_mps
    dist = sum(haversine(line[i], line[i + 1]) for i in range(len(line) - 1))
    legs = cached_legs(route)
    exact = legs is not None
    if not exact:
        legs = estimate_legs(route)
    rid = os.path.splitext(os.path.basename(path))[0]
    generated = bool(load_json(path).get("generated"))
    start, end = route_ends().get(rid, (None, None)) if generated else (None, None)
    return {
        "id": rid,
        "name": route.name,
        "description": route.description,
        "line": [[round(lat, 6), round(lon, 6)] for lat, lon in line],
        "meters": round(dist),
        "speed_mps": speed,
        "seconds": sum(g["s"] for g in legs),
        "legs": legs,
        "exact": exact,
        "modes": sorted({s.mode for s in route.segments}),
        "label": route.label,
        "city": route.city,
        "generated": generated,
        "from": start,
        "to": end,
    }


def build_gpx(path: str, log=print):
    """Render + validate a route into build/<name>.gpx. Returns (gpx_path, fixes); raises
    RouteError if it fails validation (we never play a route that would look fake)."""
    route = load_route(path)
    route, snap_warnings = snap_route(route)
    for w in snap_warnings:
        log(f"  ! {w}")
    fixes = RouteRenderer().render(route)
    result = validate(fixes)
    for w in result.warnings:
        log(f"  ! {w}")
    if not result.ok:
        raise RouteError("route failed validation: " + "; ".join(result.errors))
    os.makedirs(BUILD_DIR, exist_ok=True)
    out = os.path.join(BUILD_DIR, f"{route.name}.gpx")
    with open(out, "w", encoding="utf-8") as f:
        f.write(RouteRenderer.to_gpx(fixes))
    mins = (fixes[-1].t - fixes[0].t) / 60 if fixes else 0
    log(f"  built '{route.name}': {len(fixes)} points, ~{mins:.1f} min, "
        f"top {result.max_smoothed_speed * 3.6:.0f} km/h")
    return out, fixes


def read_name(path: str) -> tuple[str, str]:
    """(name, description) without validating the whole route — for quick menus."""
    data = load_json(path)
    return data.get("name") or os.path.basename(path), data.get("description", "")
