"""Play a route with a REAL speed from the terminal (Life360 shows mph + the car icon).

Same engine as the app's Drive (backend/drive.py): the phone's CoreDevice location sim over pmd3,
no Xcode. Mounts the developer disk image first if it isn't on yet.

    ./mac-version/drive.command emoji-test              # steady, the route's own speed
    ./mac-version/drive.command emoji-test --vary       # changing speed, stop with Ctrl+C
    ./mac-version/drive.command emoji-test --vary --write-only   # print the chunk plan
    ./mac-version/drive.command miami-cruise --mph 25
    ./mac-version/drive.command --clear

(or .venv/bin/python core/tools/drive.py ... on any platform)
"""
import argparse
import os
import signal
import subprocess
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # core/, for `backend`

from backend.device import CoreDevice, Pmd3  # noqa: E402
from backend.drive import MPH, build_route_file, plan_chunks, play_chunks, write_chunks  # noqa: E402
from backend.routes import ROUTES_DIR, RouteError  # noqa: E402


def resolve_route(arg):
    """A route path, or a name like `emoji-test` / `miami` matched against core/routes/."""
    if os.path.isfile(arg):
        return arg
    names = sorted(f for f in os.listdir(ROUTES_DIR) if f.endswith(".json"))
    exact = [f for f in names if f[:-5] == arg]
    hits = exact or [f for f in names if arg.lower() in f.lower()]
    if len(hits) != 1:
        sys.exit(f"no single route matches '{arg}' — have: {', '.join(n[:-5] for n in names)}")
    return os.path.join(ROUTES_DIR, hits[0])


def main():
    ap = argparse.ArgumentParser(description="Play a route with a real speed (no Xcode).")
    ap.add_argument("route", nargs="?", help="route name (e.g. emoji-test) or path to a .json")
    ap.add_argument("--mph", type=float, help="override the speed (default: the route's)")
    ap.add_argument("--vary", action="store_true",
                    help="realistic changing speed (corners, stops, drifting cruise) instead of one steady speed")
    ap.add_argument("--seed", type=int, help="with --vary: repeat the same drive")
    ap.add_argument("--write-only", action="store_true", help="just write the route file(s)")
    ap.add_argument("--clear", action="store_true", help="stop the location sim")
    args = ap.parse_args()

    if not args.clear and not args.route:
        ap.error("give a route, or --clear")
    if args.vary and args.mph:
        ap.error("--vary takes its speeds from the route, leave out --mph")
    cd = CoreDevice()
    route_file = chunks = None
    try:
        if args.vary:
            name, chunks = plan_chunks(resolve_route(args.route), args.seed)
            write_chunks(name, chunks)
            if args.write_only:
                for k, c in enumerate(chunks):
                    what = f"{c['speed'] / MPH:4.0f} mph  {len(c['waypoints']):3d} pts" if c["kind"] == "move" else "  stop"
                    print(f"   {k + 1:3d}  {what}  {c['secs']:5.0f}s")
        elif not args.clear:
            route_file = build_route_file(resolve_route(args.route), args.mph)
    except RouteError as e:
        sys.exit(str(e))
    if args.write_only:
        return

    if args.clear:
        sys.exit(0 if cd.clear(print) else 1)
    state, message = Pmd3().mount(print)
    if state != "ready":
        sys.exit(f"phone isn't ready: {message}")
    if chunks:
        # --clear from another window would only clear the chunk playing now, then the next one
        # starts. So this window owns the stop: Ctrl+C, closing the window or a kill all clear.
        def interrupt(*_):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, interrupt)
        if hasattr(signal, "SIGHUP"):
            signal.signal(signal.SIGHUP, interrupt)
        print("> Playing. Keep the phone unlocked. Stop it with Ctrl+C in THIS window.")
        cancel = threading.Event()
        try:
            ok = play_chunks(chunks, cd, cancel)
        except KeyboardInterrupt:
            print("> stopped — clearing")
            cd.clear(print)
            return
        print("> done" if ok else "> the phone refused a chunk, see above")
        return
    print("> Playing. Keep the phone unlocked. Stop it with:  ./mac-version/drive.command --clear")
    sys.exit(subprocess.run(cd.route_cmd(route_file)).returncode)


if __name__ == "__main__":
    main()
