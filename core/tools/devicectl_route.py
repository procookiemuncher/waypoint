"""Play a route through Xcode's CoreDevice location sim (`xcrun devicectl`) — Mac only.

Unlike pmd3's DVT simulate-location (lat/lon only -> CLLocation.speed == -1 -> Life360 shows 0 mph),
devicectl's `simulate location route` takes a real speed, and Life360 shows it: the emoji-test
route at 15.6 m/s read as 35 mph on another member's phone (2026-10-22).

devicectl takes ONE constant speed per call, so this flattens the route's moving segments into a
single waypoint list at one speed (the first moving segment's, or --mph). No dwell, no corner slowdowns.

    .venv/bin/python tools/devicectl_route.py data/routes/emoji-test.json            # write + play
    .venv/bin/python tools/devicectl_route.py data/routes/miami-cruise.json --mph 25
    .venv/bin/python tools/devicectl_route.py data/routes/emoji-test.json --write-only
    .venv/bin/python tools/devicectl_route.py --clear
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)                       # make `backend` importable
BUILD_DIR = os.path.join(ROOT, "build")

MPH = 0.44704   # m/s per mph


def devicectl(*args):
    return subprocess.run(["xcrun", "devicectl", *args])


def find_device():
    """UDID of the first connected physical device, or None."""
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        subprocess.run(["xcrun", "devicectl", "list", "devices", "-q", "-j", path],
                       capture_output=True)
        with open(path, encoding="utf-8") as f:
            devices = json.load(f).get("result", {}).get("devices", [])
    except (OSError, json.JSONDecodeError):
        return None
    finally:
        os.remove(path)
    for d in devices:
        if d.get("connectionProperties", {}).get("tunnelState") == "connected" or \
           d.get("deviceProperties", {}).get("bootState") == "booted":
            return d.get("hardwareProperties", {}).get("udid") or d.get("identifier")
    return devices[0].get("hardwareProperties", {}).get("udid") if devices else None


def build_route_file(route_path, mph=None, interval=1.0):
    from backend.movement import load_route, snap_route
    route, warnings = snap_route(load_route(route_path))
    for w in warnings:
        print(f"  ! {w}")
    moving = [s for s in route.segments if s.waypoints]
    if not moving:
        sys.exit(f"{route.name} has no moving segments")
    speed = mph * MPH if mph else moving[0].speed_mps
    if not speed:
        sys.exit("no speed on the route's first moving segment — pass --mph")
    waypoints = []
    for s in moving:
        for lat, lon in s.waypoints:
            if not waypoints or waypoints[-1] != {"latitude": lat, "longitude": lon}:
                waypoints.append({"latitude": lat, "longitude": lon})
    os.makedirs(BUILD_DIR, exist_ok=True)
    out = os.path.join(BUILD_DIR, f"{route.name}.devicectl.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"mode": "interval", "interval": interval, "speed": speed,
                   "waypoints": waypoints}, f)
    print(f"  wrote {out}: {len(waypoints)} points at {speed / MPH:.0f} mph")
    return out


def main():
    ap = argparse.ArgumentParser(description="Play a route via xcrun devicectl (real speed).")
    ap.add_argument("route", nargs="?", help="path to a route .json")
    ap.add_argument("--mph", type=float, help="override the speed (default: the route's)")
    ap.add_argument("--device", help="device UDID (default: first connected device)")
    ap.add_argument("--write-only", action="store_true", help="just write the route file")
    ap.add_argument("--clear", action="store_true", help="stop any devicectl location sim")
    args = ap.parse_args()

    if not args.clear and not args.route:
        ap.error("give a route, or --clear")
    route_file = None if args.clear else build_route_file(args.route, args.mph)
    if args.write_only:
        return

    device = args.device or find_device()
    if not device:
        sys.exit("no device found — plug in + unlock the phone (xcrun devicectl list devices)")
    if args.clear:
        devicectl("device", "simulate", "location", "clear", "--device", device)
        return
    print("> Playing. Keep the phone unlocked. Stop it with:  "
          ".venv/bin/python tools/devicectl_route.py --clear")
    devicectl("device", "simulate", "location", "route", "--device", device,
              "--route-file", route_file)


if __name__ == "__main__":
    main()
