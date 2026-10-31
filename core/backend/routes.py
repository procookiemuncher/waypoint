"""Route library helpers shared by the spoof CLI and the app: list core/routes/*.json, get a
road-snapped preview line, and render + validate a route into a GPX the phone can replay."""
import glob
import json
import math
import os

from backend.movement import load_route, RouteRenderer, validate, snap_route

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


def haversine(a, b) -> float:
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    h = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(h))


def summary(path: str, snap: bool = True) -> dict:
    """What the app's route list needs: id, name, description, the line to draw, distance,
    the first moving segment's speed and how long the route plays (moving + stops)."""
    route = load_route(path)
    if snap:
        route, _ = snap_route(route)   # cached on disk after the first time; falls back offline
    line, secs, speed = [], 0.0, None
    for seg in route.segments:
        if seg.waypoints:
            pts = list(seg.waypoints)
            if line and pts[0] == line[-1]:
                pts = pts[1:]
            line.extend(pts)
            speed = speed or seg.speed_mps
        secs += seg.dwell_s
    dist = sum(haversine(line[i], line[i + 1]) for i in range(len(line) - 1))
    if speed:
        secs += dist / speed
    return {
        "id": os.path.splitext(os.path.basename(path))[0],
        "name": route.name,
        "description": route.description,
        "line": [[round(lat, 6), round(lon, 6)] for lat, lon in line],
        "meters": round(dist),
        "speed_mps": speed,
        "seconds": round(secs),
        "modes": sorted({s.mode for s in route.segments}),
        "label": route.label,
        "city": route.city,
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
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("name") or os.path.basename(path), data.get("description", "")
