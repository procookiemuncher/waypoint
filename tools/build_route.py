"""Build a route.json into a validated, cached GPX (the file `simulate-location play` eats).

Offline: straight-line interpolation between waypoints (the no-network fallback). A Valhalla
road-snapping step will slot in here later. Run this before any on-device play — it validates
the trajectory and refuses to write a GPX that would look impossible to Life360.

    py tools/build_route.py data/routes/demo-drive.json
    py tools/build_route.py data/routes/demo-drive.json --out build/demo-drive.gpx --seed 7
"""
import argparse
import math
import os
import sys

# make `backend` importable when run from the repo root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.movement import load_route, RouteRenderer, validate  # noqa: E402


def _speed(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lon, b.lat, b.lon))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    dist = 2 * 6_371_000.0 * math.asin(math.sqrt(h))
    return dist / (b.t - a.t)


def main():
    ap = argparse.ArgumentParser(description="Render a route.json to a validated GPX.")
    ap.add_argument("route", help="path to a route .json")
    ap.add_argument("--out", help="output .gpx path (default: alongside the route)")
    ap.add_argument("--seed", type=int, default=0, help="jitter seed (reproducible builds)")
    args = ap.parse_args()

    route = load_route(args.route)
    fixes = RouteRenderer(seed=args.seed).render(route)
    issues = validate(fixes)

    dur = fixes[-1].t - fixes[0].t if fixes else 0
    speeds = [_speed(fixes[i - 1], fixes[i]) for i in range(1, len(fixes))
              if fixes[i].t > fixes[i - 1].t]
    print(f"route:     {route.name} — {route.description}")
    print(f"segments:  {len(route.segments)}")
    print(f"fixes:     {len(fixes)}")
    print(f"duration:  {dur:.0f}s ({dur / 60:.1f} min)")
    if speeds:
        print(f"max speed: {max(speeds):.1f} m/s ({max(speeds) * 3.6:.0f} km/h)")

    if issues:
        print("\nVALIDATION FAILED:")
        for p in issues:
            print(f"  - {p}")
        sys.exit(1)
    print("validation: OK")

    out = args.out or os.path.splitext(args.route)[0] + ".gpx"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(RouteRenderer.to_gpx(fixes))
    print(f"wrote:     {out}")


if __name__ == "__main__":
    main()
