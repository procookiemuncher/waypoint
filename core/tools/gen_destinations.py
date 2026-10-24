"""Write the routes for every city in core/destinations.json into core/routes/.

Per city, starting at the arrival airport so it chains onto a flight:
  - airport -> base hotel, then base hotel -> each other spot   (city has a "base")
  - airport -> each spot                                        (no base)
Each route is: walk out to the road (if the start is set back from it), a Valhalla-snapped drive,
walk in to the door, then a 10 min dwell so a saved Life360 Place sees a real arrival.
Spots with "access": "boat" (Maldives, Bora Bora) get no route, only their pin.

Every route is snapped + rendered + validated before it's written; one that fails is skipped and
reported, never written. Generated files carry "generated": true so a rerun can prune stale ones.

    .venv/bin/python core/tools/gen_destinations.py              # all cities, prune stale
    .venv/bin/python core/tools/gen_destinations.py Miami Paris  # just these
    .venv/bin/python core/tools/gen_destinations.py --check      # build + validate, write nothing
"""
import argparse
import glob
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.destinations import load_catalog  # noqa: E402
from backend.movement import RouteRenderer, SnapError, parse_route, snap_route, snap_waypoints, validate  # noqa: E402
from backend.movement.snapper import _cache_path  # noqa: E402
from backend.routes import ROUTES_DIR, haversine  # noqa: E402

DWELL_S = 600          # parked at the door long enough for a Place arrival (geofence-arrival-mechanics.md)
WALK_MIN_M = 25        # closer than this to the road, skip the walk leg
WALK_WARN_M = 500      # a walk-in longer than this usually means a bad coordinate


def drive_speed(meters: float) -> float:
    """One cruise speed per drive (the renderer still slows for corners): town, suburbs, highway."""
    if meters < 15_000:
        return 11.0     # ~25 mph
    if meters < 60_000:
        return 17.0     # ~38 mph
    return 24.0         # ~54 mph


def snap_drive(a, b):
    cached = os.path.exists(_cache_path([[round(x, 6) for x in a], [round(x, 6) for x in b]], "auto"))
    poly = snap_waypoints([tuple(a), tuple(b)], "drive")
    if not cached:
        time.sleep(1.0)  # be polite to the public FOSSGIS server
    return poly


def make_route(rid, label, city, start, end, end_name, from_name):
    """-> (route dict, notes, road meters). Raises SnapError if there's no road between them."""
    poly = snap_drive(start, end)
    meters = sum(haversine(poly[i], poly[i + 1]) for i in range(len(poly) - 1))
    notes, segs = [], []
    out_m, in_m = haversine(start, poly[0]), haversine(poly[-1], end)
    if out_m > WALK_MIN_M:
        segs.append({"mode": "walk", "waypoints": [list(start), [round(x, 6) for x in poly[0]]]})
    segs.append({"mode": "drive", "speed_mps": drive_speed(meters), "snap": True,
                 "waypoints": [list(start), list(end)]})
    if in_m > WALK_MIN_M:
        segs.append({"mode": "walk", "waypoints": [[round(x, 6) for x in poly[-1]], list(end)]})
    # no walk-in = park where the drive ends; an `at` a few meters off would be a jump
    segs.append({"mode": "stop", "dwell_s": DWELL_S, **({"at": list(end)} if in_m > WALK_MIN_M else {})})
    for what, m in (("walk out", out_m), ("walk in", in_m)):
        if m > WALK_WARN_M:
            notes.append(f"{what} is {m:.0f} m — check the coordinate")
    route = {
        "name": rid, "label": label, "city": city, "generated": True,
        "description": f"{from_name} to {end_name}, {meters / 1000:.1f} km by road, then {DWELL_S // 60} min "
                       f"parked at the door. Generated from core/destinations.json, edit that and rerun "
                       f"core/tools/gen_destinations.py instead of this file.",
        "segments": segs,
    }
    return route, notes, meters


def check(route: dict) -> list[str]:
    """Snap + render + validate like build_gpx does. Returns the errors (empty = good)."""
    r, warnings = snap_route(parse_route(route))
    if warnings:
        return warnings
    return validate(RouteRenderer().render(r)).errors


def plan(city: str, c: dict):
    """-> list of (id, label, start, end, end_name, from_name) for one city."""
    spots = [s for s in c.get("spots", []) if s.get("access", "road") == "road"]
    ap = c.get("airport")
    if not ap or not spots:
        return []
    by_id = {s["id"]: s for s in spots}
    base = by_id.get(c.get("base"))
    legs = []
    if base:
        legs.append((f'{ap["code"].lower()}-to-{base["id"]}', f'{ap["code"]} → {base["name"]}',
                     ap["at"], base["at"], base["name"], ap["name"]))
        for s in spots:
            if s is not base:
                legs.append((f'{base["id"]}-to-{s["id"]}', f'{base["name"]} → {s["name"]}',
                             base["at"], s["at"], s["name"], base["name"]))
    else:
        for s in spots:
            legs.append((f'{ap["code"].lower()}-to-{s["id"]}', f'{ap["code"]} → {s["name"]}',
                         ap["at"], s["at"], s["name"], ap["name"]))
    return legs


def main():
    ap = argparse.ArgumentParser(description="Generate destination routes from core/destinations.json.")
    ap.add_argument("cities", nargs="*", help="only these cities (default: all, and prune stale files)")
    ap.add_argument("--check", action="store_true", help="build + validate only, write nothing")
    args = ap.parse_args()

    catalog = load_catalog()
    unknown = [c for c in args.cities if c not in catalog]
    if unknown:
        sys.exit(f"not in the catalog: {', '.join(unknown)}  (have: {', '.join(catalog)})")

    written, failed = set(), []
    for city, c in catalog.items():
        if args.cities and city not in args.cities:
            continue
        for rid, label, start, end, end_name, from_name in plan(city, c):
            try:
                route, notes, meters = make_route(rid, label, city, start, end, end_name, from_name)
                errors = check(route)
            except SnapError as e:
                errors = [f"no road: {e}"]
            if errors:
                failed.append(rid)
                print(f"  x {rid}: {'; '.join(errors)}")
                continue
            written.add(rid)
            print(f"  ✓ {rid}  ({meters / 1000:.1f} km){'  ! ' + '; '.join(notes) if notes else ''}")
            if not args.check:
                with open(os.path.join(ROUTES_DIR, rid + ".json"), "w", encoding="utf-8") as f:
                    json.dump(route, f, indent=2, ensure_ascii=False)
                    f.write("\n")

    if not args.cities and not args.check:
        for path in glob.glob(os.path.join(ROUTES_DIR, "*.json")):
            rid = os.path.splitext(os.path.basename(path))[0]
            try:
                with open(path, encoding="utf-8") as f:
                    generated = json.load(f).get("generated")
            except (OSError, json.JSONDecodeError):
                continue
            if generated and rid not in written and rid not in failed:
                os.remove(path)
                print(f"  - removed stale {rid}")

    print(f"\n{len(written)} routes ok, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
