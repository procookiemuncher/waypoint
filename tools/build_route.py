"""Build a route.json into a validated, cached GPX (the file `simulate-location play` eats).

Offline: straight-line interpolation between waypoints (the no-network fallback). A Valhalla
road-snapping step will slot in here later. Run this before any on-device play — it validates
the trajectory and refuses to write a GPX that would look impossible to Life360. Warnings are
printed but don't block; errors do.

    py tools/build_route.py data/routes/demo-drive.json
    py tools/build_route.py data/routes/demo-drive.json --out build/demo-drive.gpx --seed 7
"""
import argparse
import os
import sys

# make `backend` importable when run from the repo root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.movement import load_route, RouteRenderer, validate  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Render a route.json to a validated GPX.")
    ap.add_argument("route", help="path to a route .json")
    ap.add_argument("--out", help="output .gpx path (default: alongside the route)")
    ap.add_argument("--seed", type=int, default=0, help="jitter seed (reproducible builds)")
    args = ap.parse_args()

    route = load_route(args.route)
    fixes = RouteRenderer(seed=args.seed).render(route)
    result = validate(fixes)

    dur = fixes[-1].t - fixes[0].t if fixes else 0
    print(f"route:      {route.name} — {route.description}")
    print(f"segments:   {len(route.segments)}")
    print(f"fixes:      {len(fixes)}")
    print(f"duration:   {dur:.0f}s ({dur / 60:.1f} min)")
    print(f"max speed:  {result.max_step_speed:.1f} m/s step / "
          f"{result.max_smoothed_speed:.1f} m/s smoothed "
          f"({result.max_smoothed_speed * 3.6:.0f} km/h)")
    print(f"max accel:  {result.max_accel:.2f} m/s^2")

    for w in result.warnings:
        print(f"  ⚠ {w}")

    if not result.ok:
        print("\nVALIDATION FAILED:")
        for e in result.errors:
            print(f"  ✗ {e}")
        sys.exit(1)
    print("validation: OK" + (f" ({len(result.warnings)} warning(s))" if result.warnings else ""))

    out = args.out or os.path.splitext(args.route)[0] + ".gpx"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(RouteRenderer.to_gpx(fixes))
    print(f"wrote:      {out}")


if __name__ == "__main__":
    main()
