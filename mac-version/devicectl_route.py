"""Play a route through Xcode's CoreDevice location sim (`xcrun devicectl`) — Mac only.

Unlike pmd3's DVT simulate-location (lat/lon only -> CLLocation.speed == -1 -> Life360 shows 0 mph),
devicectl's `simulate location route` takes a real speed, and Life360 shows it: the emoji-test
route at 15.6 m/s read as 35 mph on another member's phone (2026-10-22).

devicectl takes ONE constant speed per call, so this flattens the route's moving segments into a
single waypoint list at one speed (the first moving segment with a speed, or --mph). No dwell, no corner slowdowns.
--vary chains many calls instead, each with its own speed (see plan_chunks): pulls away, slows
for bends, drifts around cruise, stops. Not tried on the phone yet.

    ./mac-version/drive.command emoji-test              # write + play (route name or path)
    ./mac-version/drive.command emoji-test --vary       # changing speed, stop with Ctrl+C
    ./mac-version/drive.command emoji-test --vary --write-only   # print the chunk plan
    ./mac-version/drive.command miami-cruise --mph 25
    ./mac-version/drive.command emoji-test --write-only
    ./mac-version/drive.command --clear
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

CORE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "core")
sys.path.insert(0, CORE)                       # make `backend` importable
from backend.routes import BUILD_DIR, ROUTES_DIR   # noqa: E402 (same dirs the app uses, packaged or not)

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


def build_route_file(route_path, mph=None, interval=1.0):
    from backend.movement import load_route, snap_route
    route, warnings = snap_route(load_route(route_path))
    for w in warnings:
        print(f"  ! {w}")
    moving = [s for s in route.segments if s.waypoints]
    if not moving:
        sys.exit(f"{route.name} has no moving segments")
    # same rule as the app's CRUISE stat: the first moving segment that has a speed (a walk to
    # the car usually doesn't)
    speed = mph * MPH if mph else next((s.speed_mps for s in moving if s.speed_mps), None)
    if not speed:
        sys.exit("no speed on any of the route's moving segments — pass --mph")
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


# ---- varying speed (--vary) ----------------------------------------------------------------
# devicectl holds one speed per call, so a varying drive is a chain of calls. The movement
# engine renders the route (ramps, slowing for corners, stops), that gets cut into chunks of
# roughly steady speed, and a slow wander goes on top so a straight expressway doesn't sit on
# one number. Stops become a coordinate hold.
CHUNK_MAX_S = 30          # Life360 samples rarely, so long chunks and few handoffs
CHUNK_MIN_S = 5
CHUNK_SPREAD_MPS = 2.5    # cut a chunk early once the rendered speed moved this much (ramps, corners)
WANDER = (0.88, 1.12)     # cruise drifts within ±12% of the route's speed...
WANDER_EVERY_S = (30, 60)  # ...picking a new target this often
MIN_MOVE_MPS = 1.0


def _wander(rng, total_s):
    """Speed factor over time: random targets every 30-60s, straight lines between them."""
    knots, t = [(0.0, rng.uniform(*WANDER))], 0.0
    while t < total_s:
        t += rng.uniform(*WANDER_EVERY_S)
        knots.append((t, rng.uniform(*WANDER)))

    def at(x):
        for (t0, f0), (t1, f1) in zip(knots, knots[1:]):
            if x <= t1:
                return f0 + (f1 - f0) * (x - t0) / (t1 - t0)
        return knots[-1][1]
    return at


def plan_chunks(route_path, seed=None):
    """[{kind: move, waypoints, speed, secs} | {kind: stop, at, secs}] for play_chunks().
    A new seed each time unless one is given, so no two drives come out the same."""
    import random
    from backend.movement import RouteRenderer, load_route, snap_route
    from backend.movement.model import STOP
    from backend.routes import haversine
    route, warnings = snap_route(load_route(route_path))
    for w in warnings:
        print(f"  ! {w}")
    rng = random.Random(seed)
    fixes = RouteRenderer(rng.randrange(1 << 30)).render(route)
    if len(fixes) < 2:
        sys.exit(f"{route.name} has nothing to drive")
    pts = [(f.lat, f.lon) for f in fixes]
    n = len(fixes)

    def v(k):   # rendered speed around fix k, over a few seconds so GPS jitter doesn't count
        a, b = max(0, k - 2), min(n - 1, k + 2)
        dt = fixes[b].t - fixes[a].t
        return sum(haversine(pts[m], pts[m + 1]) for m in range(a, b)) / dt if dt else 0.0

    wander = _wander(rng, fixes[-1].t)
    chunks, i = [], 0
    while i < n - 1:
        j = i + 1
        if fixes[j].mode == STOP:
            while j + 1 < n and fixes[j + 1].mode == STOP:
                j += 1
            chunks.append({"kind": "stop", "at": pts[i], "secs": fixes[j].t - fixes[i].t})
            i = j
            continue
        while (j + 1 < n and fixes[j + 1].mode != STOP and fixes[j].t - fixes[i].t < CHUNK_MAX_S
               and (fixes[j].t - fixes[i].t < CHUNK_MIN_S or abs(v(j) - v(i)) < CHUNK_SPREAD_MPS)):
            j += 1
        dist = sum(haversine(pts[m], pts[m + 1]) for m in range(i, j))
        speed = dist / (fixes[j].t - fixes[i].t) * wander((fixes[i].t + fixes[j].t) / 2)
        speed = max(MIN_MOVE_MPS, speed)
        if dist / speed >= 1:   # skip slivers, not worth a devicectl call
            chunks.append({"kind": "move", "waypoints": pts[i:j + 1], "speed": speed, "dist": dist})
        i = j
    # the renderer brakes for every bend, which in short chunks reads as 18-31-18 mph; average
    # each chunk with its neighbours (not across a stop) so it reads as easing off instead
    raw = [c.get("speed") for c in chunks]
    for k, c in enumerate(chunks):
        if c["kind"] == "move":
            near = [raw[m] for m in (k - 1, k + 1) if 0 <= m < len(chunks) and raw[m] is not None]
            c["speed"] = max(MIN_MOVE_MPS, (2 * raw[k] + sum(near)) / (2 + len(near)))
            c["secs"] = c.pop("dist") / c["speed"]
    return route.name, chunks


def write_chunks(name, chunks, interval=1.0):
    """One devicectl route file per moving chunk, under build/<name>.vary/."""
    out = os.path.join(BUILD_DIR, f"{name}.vary")
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        os.remove(os.path.join(out, old))
    for k, c in enumerate(chunks):
        if c["kind"] == "move":
            c["file"] = os.path.join(out, f"{k:03d}.json")
            with open(c["file"], "w", encoding="utf-8") as f:
                json.dump({"mode": "interval", "interval": interval, "speed": c["speed"],
                           "waypoints": [{"latitude": la, "longitude": lo} for la, lo in c["waypoints"]]}, f)
    moving = [c for c in chunks if c["kind"] == "move"]
    mph = [c["speed"] / MPH for c in moving]
    mins = sum(c["secs"] for c in chunks) / 60
    print(f"  wrote {out}: {len(moving)} moving chunks, {len(chunks) - len(moving)} stops, "
          f"{min(mph):.0f}-{max(mph):.0f} mph, ~{mins:.1f} min")


def chunk_cmd(c, device):
    if c["kind"] == "move":
        return ["xcrun", "devicectl", "device", "simulate", "location", "route",
                "--device", device, "--route-file", c["file"]]
    lat, lon = c["at"]
    return ["xcrun", "devicectl", "device", "simulate", "location", "coordinate",
            "--device", device, f"--latitude={lat}", f"--longitude={lon}"]   # = so -80.19 isn't a flag


def play_chunks(chunks, device, cancel, log=print, wrap=lambda cmd: cmd):
    """Launch each chunk on time (against one start clock, so call latency doesn't add up).
    Returns False if devicectl refused one. `cancel` (a threading.Event) is checked right
    before every launch, so nothing starts after a stop."""
    t0, at = time.monotonic(), 0.0
    for k, c in enumerate(chunks):
        if cancel.wait(max(0.0, t0 + at - time.monotonic())):
            return True
        late = time.monotonic() - (t0 + at)
        p = subprocess.run(wrap(chunk_cmd(c, device)), capture_output=True, text=True, timeout=30)
        took = time.monotonic() - (t0 + at) - late
        if p.returncode:
            for line in (p.stdout + p.stderr).splitlines():
                log(line)
            return False
        what = f"{c['speed'] / MPH:.0f} mph" if c["kind"] == "move" else "stopped"
        # late/call: if devicectl takes ~1s per call, short chunks spend a lot of time handing off
        log(f"  [{k + 1}/{len(chunks)}] {what} for {c['secs']:.0f}s  (late {late:.1f}s, call {took:.1f}s)")
        at += c["secs"]
    return True


def main():
    ap = argparse.ArgumentParser(description="Play a route via xcrun devicectl (real speed).")
    ap.add_argument("route", nargs="?", help="route name (e.g. emoji-test) or path to a .json")
    ap.add_argument("--mph", type=float, help="override the speed (default: the route's)")
    ap.add_argument("--device", help="device UDID (default: first connected device)")
    ap.add_argument("--vary", action="store_true",
                    help="realistic changing speed (corners, stops, drifting cruise) instead of one steady speed")
    ap.add_argument("--seed", type=int, help="with --vary: repeat the same drive")
    ap.add_argument("--write-only", action="store_true", help="just write the route file(s)")
    ap.add_argument("--clear", action="store_true", help="stop any devicectl location sim")
    args = ap.parse_args()

    if not args.clear and not args.route:
        ap.error("give a route, or --clear")
    if args.vary and args.mph:
        ap.error("--vary takes its speeds from the route, leave out --mph")
    route_file = chunks = None
    if args.vary:
        name, chunks = plan_chunks(resolve_route(args.route), args.seed)
        write_chunks(name, chunks)
        if args.write_only:
            for k, c in enumerate(chunks):
                what = f"{c['speed'] / MPH:4.0f} mph  {len(c['waypoints']):3d} pts" if c["kind"] == "move" else "  stop"
                print(f"   {k + 1:3d}  {what}  {c['secs']:5.0f}s")
    elif not args.clear:
        route_file = build_route_file(resolve_route(args.route), args.mph)
    if args.write_only:
        return

    device = args.device or find_device()
    if not device:
        sys.exit("no device found — plug in + unlock the phone (xcrun devicectl list devices)")
    if args.clear:
        devicectl("device", "simulate", "location", "clear", "--device", device)
        return
    if chunks:
        import signal
        import threading
        # --clear from another window would only clear the chunk playing now, then the next one
        # starts. So this window owns the stop: Ctrl+C, closing the window or a kill all clear.
        def interrupt(*_):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, interrupt)
        signal.signal(signal.SIGHUP, interrupt)
        print("> Playing. Keep the phone unlocked. Stop it with Ctrl+C in THIS window.")
        cancel = threading.Event()
        try:
            ok = play_chunks(chunks, device, cancel)
        except KeyboardInterrupt:
            print("> stopped — clearing")
            devicectl("device", "simulate", "location", "clear", "--device", device)
            return
        print("> done" if ok else "> devicectl refused a chunk, see above")
        return
    print("> Playing. Keep the phone unlocked. Stop it with:  ./mac-version/drive.command --clear")
    devicectl("device", "simulate", "location", "route", "--device", device,
              "--route-file", route_file)


if __name__ == "__main__":
    main()
