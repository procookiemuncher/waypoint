"""The `drive` route engine: routes with a real speed, so Life360 shows mph + the car icon.

Goes through the phone's CoreDevice location sim (backend.device.CoreDevice), the same service
Xcode's devicectl uses, but over pmd3, so no Xcode and it isn't Mac only. Unlike pmd3's DVT sim
(lat/lon only, CLLocation.speed == -1, Life360 shows 0 mph) it takes a speed: the emoji-test
route at 15.6 m/s read as 35 mph on another member's phone (2026-10-22, through devicectl).

The phone holds ONE speed per route call. So a typed mph is one steady call, and otherwise the
route is cut into a timed chain of calls (plan_chunks): pulls away, slows for bends, drifts
around cruise, stops.
"""
import json
import os
import random
import threading
import time

from backend.device import TEXT, CoreDevice
from backend.routes import BUILD_DIR, RouteError, haversine, thin
from backend.secret import load_json

MPH = 0.44704   # m/s per mph


def build_route_file(route_path: str, mph=None, log=print, interval: float = 1.0) -> str:
    """One steady-speed route request for the whole route, written to build/<name>.route.json."""
    from backend.device import write_route_input
    from backend.movement import load_route, snap_route
    route, warnings = snap_route(load_route(route_path), roads="off")   # one steady speed, no roads needed
    for w in warnings:
        log(f"  ! {w}")
    moving = [s for s in route.segments if s.waypoints]
    if not moving:
        raise RouteError(f"{route.name} has no moving segments")
    # same rule as the app's CRUISE stat: the first moving segment that has a speed (a walk to
    # the car usually doesn't)
    speed = mph * MPH if mph else next((s.speed_mps for s in moving if s.speed_mps), None)
    if not speed:
        raise RouteError("no speed on any of the route's moving segments, give it an mph")
    waypoints = []
    for s in moving:
        for lat, lon in s.waypoints:
            if not waypoints or waypoints[-1] != (lat, lon):
                waypoints.append((lat, lon))
    os.makedirs(BUILD_DIR, exist_ok=True)
    out = os.path.join(BUILD_DIR, f"{route.name}.route.json")
    write_route_input(out, waypoints, speed, interval)
    log(f"  wrote {out}: {len(waypoints)} points at {speed / MPH:.0f} mph")
    return out


# ---- varying speed ---------------------------------------------------------------------------
# The movement engine renders the route (each road at its own speed, red lights, stop signs,
# turns, bends), that gets cut into chunks of roughly steady speed, and a slow wander goes on top
# so a straight expressway doesn't sit on one number. Stops become a coordinate hold: the dwell at
# the end, and every wait at a light or a stop sign on the way (those stay "drive" legs).
CHUNK_MAX_S = 30          # Life360 samples rarely, so long chunks and few handoffs
CHUNK_MIN_S = 5
CHUNK_MIN_SLOW_S = 3      # near rest (pulling away, rolling up to a light) cut finer, so the ramp survives
SLOW_MPS = 5.0
CHUNK_SPREAD_MPS = 2.5    # cut a chunk early once the rendered speed moved this much (ramps, corners)
WANDER = (0.95, 1.05)     # cruise drifts within ±5% of the rendered speed (which already varies by road)...
WANDER_EVERY_S = (30, 60)  # ...picking a new target this often
MIN_MOVE_MPS = 1.0
MAX_MOVE_MPS = 33.5       # ~75 mph: the wander never pushes past it (Life360 flags 80+ as speeding)


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


def route_seed(route_path: str):
    """The route JSON's own "seed", or None. A route with one plays the same every Drive: same
    driver, lights, stops, jitter and wander (demo takes recorded side by side)."""
    seed = load_json(route_path).get("seed")
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int)):
        raise RouteError(f"{os.path.basename(route_path)}: seed should be a whole number, got {seed!r}")
    return seed


def plan_chunks(route_path: str, seed=None, log=print):
    """[{kind: move, waypoints, speed, secs, mode} | {kind: stop, at, secs, mode}] for play_chunks().
    A stop's mode is "stop" for the route's own dwell and "drive" for a wait on the way (a red
    light). A new seed each time unless one is given or the route has its own "seed", so no two
    drives come out the same. Every random draw (renderer and wander) comes off this one seed."""
    from backend.movement import RouteRenderer, load_route, snap_route
    from backend.movement.model import STOP
    if seed is None:
        seed = route_seed(route_path)
    route, warnings = snap_route(load_route(route_path))
    for w in warnings:
        log(f"  ! {w}")
    if seed is not None:
        log(f"  fixed seed {seed}: plays the same every time")
    rng = random.Random(seed)
    fixes = RouteRenderer(rng.randrange(1 << 30)).render(route)
    if len(fixes) < 2:
        raise RouteError(f"{route.name} has nothing to drive")
    pts = [(f.lat, f.lon) for f in fixes]
    n = len(fixes)

    def v(k):   # rendered speed around fix k, over a few seconds so GPS jitter doesn't count
        a, b = max(0, k - 2), min(n - 1, k + 2)
        dt = fixes[b].t - fixes[a].t
        return sum(haversine(pts[m], pts[m + 1]) for m in range(a, b)) / dt if dt else 0.0

    def still(f):
        return f.mode == STOP or f.hold

    wander = _wander(rng, fixes[-1].t)
    chunks, i = [], 0
    while i < n - 1:
        j = i + 1
        if still(fixes[j]):
            held = fixes[j].hold
            while j + 1 < n and still(fixes[j + 1]) and fixes[j + 1].hold == held:
                j += 1
            chunks.append({"kind": "stop", "at": pts[i], "secs": fixes[j].t - fixes[i].t,
                           "mode": fixes[j].mode if held else STOP})
            i = j
            continue
        v_i = v(i)
        while j + 1 < n and not still(fixes[j + 1]) and fixes[j].t - fixes[i].t < CHUNK_MAX_S:
            took = fixes[j].t - fixes[i].t
            least = CHUNK_MIN_SLOW_S if min(v_i, v(j)) < SLOW_MPS else CHUNK_MIN_S
            if took >= least and abs(v(j) - v_i) >= CHUNK_SPREAD_MPS:
                break
            j += 1
        dist = sum(haversine(pts[m], pts[m + 1]) for m in range(i, j))
        took = fixes[j].t - fixes[i].t
        prev = chunks[-1] if chunks else None
        creeping = took > 0 and dist / took < MIN_MOVE_MPS
        if prev and prev["kind"] == "move" and (took < CHUNK_MIN_SLOW_S or creeping) and prev["mode"] == fixes[j].mode:
            # the last second or two before a stop (or a creep the 1 m/s floor would squash into one):
            # shorter than a phone call, so fold it into the chunk before
            prev["waypoints"] += pts[i + 1:j + 1]
            prev["dist"] += dist
            prev["took"] += took
        else:
            chunks.append({"kind": "move", "waypoints": pts[i:j + 1], "dist": dist, "took": took,
                           "mode": fixes[(i + j + 1) // 2].mode})
        i = j
    # a short move that couldn't fold backwards (right after a stop) folds into the move after it
    k = 0
    while k < len(chunks) - 1:
        c, nxt = chunks[k], chunks[k + 1]
        if (c["kind"] == "move" and c["took"] < CHUNK_MIN_SLOW_S and nxt["kind"] == "move"
                and nxt["mode"] == c["mode"]):
            nxt["waypoints"] = c["waypoints"][:-1] + nxt["waypoints"]
            nxt["dist"] += c["dist"]
            nxt["took"] += c["took"]
            del chunks[k]
            continue
        k += 1
    for c in chunks:
        if c["kind"] == "move":
            c["speed"] = c["dist"] / c.pop("took")
    # the odd bend still reads as 18-31-18 mph in short chunks; ease each chunk a little toward its
    # neighbours so it reads as easing off. Not next to a stop, a wait or the start: that's a pull-away
    # or the roll up to a light, and it has to stay a ramp. The wander goes on last.
    raw = [c.get("speed") for c in chunks]
    t = 0.0
    out = []
    for k, c in enumerate(chunks):
        if c["kind"] == "move":
            near = [raw[m] for m in (k - 1, k + 1) if 0 <= m < len(chunks)]
            speed = raw[k]
            if len(near) == 2 and None not in near:
                eased = (3 * raw[k] + sum(near)) / 5
                if c["dist"] / eased >= 2.0:   # easing a slow turn chunk up mustn't make it a sliver
                    speed = eased
            secs = c["dist"] / speed if speed > 0 else 0.0
            # the wander never takes a chunk over 75 mph; a route written faster (miami-drift) keeps its own
            speed = min(speed * wander(t + secs / 2), max(MAX_MOVE_MPS, speed))
            c["speed"] = max(MIN_MOVE_MPS, speed)
            c["secs"] = c.pop("dist") / c["speed"]
            if c["secs"] < 1:   # skip slivers, not worth a phone call
                continue
        t += c["secs"]
        out.append(c)
    return route.name, out


def write_chunks(name: str, chunks, log=print, interval: float = 1.0):
    """One route request file per moving chunk, under build/<name>.vary/."""
    from backend.device import write_route_input
    out = os.path.join(BUILD_DIR, f"{name}.vary")
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        os.remove(os.path.join(out, old))
    for k, c in enumerate(chunks):
        if c["kind"] == "move":
            c["file"] = os.path.join(out, f"{k:03d}.json")
            write_route_input(c["file"], c["waypoints"], c["speed"], interval)
    moving = [c for c in chunks if c["kind"] == "move"]
    mph = [c["speed"] / MPH for c in moving] or [0]
    mins = sum(c["secs"] for c in chunks) / 60
    waits = sum(1 for c in chunks if c["kind"] == "stop" and c.get("mode") not in (None, "stop"))
    log(f"  wrote {out}: {len(moving)} moving chunks, {waits} waits, {len(chunks) - len(moving) - waits} stops, "
        f"{min(mph):.0f}-{max(mph):.0f} mph, ~{mins:.1f} min")


def chunk_cmd(c, cd: CoreDevice) -> list[str]:
    if c["kind"] == "move":
        return cd.route_cmd(c["file"])
    return cd.set_cmd(*c["at"])


def play_chunks(chunks, cd: CoreDevice, cancel, log=print) -> bool:
    """Launch each chunk on time (against one start clock, so call latency doesn't add up).
    Returns False if the phone refused one. `cancel` (a threading.Event) is checked right
    before every launch, so nothing starts after a stop."""
    import subprocess
    t0, at = time.monotonic(), 0.0
    for k, c in enumerate(chunks):
        if cancel.wait(max(0.0, t0 + at - time.monotonic())):
            return True
        late = time.monotonic() - (t0 + at)
        p = subprocess.run(chunk_cmd(c, cd), capture_output=True, **TEXT, timeout=30)
        took = time.monotonic() - (t0 + at) - late
        if p.returncode:
            for line in (p.stdout + p.stderr).splitlines():
                log(line)
            return False
        what = (f"{c['speed'] / MPH:.0f} mph" if c["kind"] == "move"
                else "waiting" if c.get("mode") not in (None, "stop") else "stopped")
        # late/call: each call is a pmd3 start + tunnel (~1s), short chunks spend a lot of it handing off
        log(f"  [{k + 1}/{len(chunks)}] {what} for {c['secs']:.0f}s  (late {late:.1f}s, call {took:.1f}s)")
        at += c["secs"]
    return True


def chunk_timeline(chunks) -> list:
    """[t, lat, lon] for the app's moving pin, timed the way play_chunks will play them."""
    t, out = 0.0, []
    for c in chunks:
        if c["kind"] == "stop":
            out += [[round(t, 1), *c["at"]], [round(t + c["secs"], 1), *c["at"]]]
            t += c["secs"]
            continue
        pts = c["waypoints"]
        out.append([round(t, 1), *pts[0]])
        for a, b in zip(pts, pts[1:]):
            t += haversine(a, b) / c["speed"]
            out.append([round(t, 1), *b])
    return out


def merge_legs(spans) -> list:
    """[(start, end, mode)] -> [[start, end, mode]] with runs of one mode joined, rounded to 0.1 s."""
    out = []
    for a, b, mode in spans:
        if out and out[-1][2] == mode:
            out[-1][1] = b
        else:
            out.append([a, b, mode])
    return [[round(a, 1), round(b, 1), m] for a, b, m in out]


def chunk_legs(chunks) -> list:
    """When each walk / drive / stop starts and ends, on the same clock as chunk_timeline, for the
    app's live card ("Parked at the door"). A stop on a generated route is the 10 min at the door; a
    wait at a red light is part of the drive."""
    t, spans = 0.0, []
    for c in chunks:
        secs = c["secs"] if c["kind"] == "stop" else sum(
            haversine(a, b) for a, b in zip(c["waypoints"], c["waypoints"][1:])) / c["speed"]
        spans.append((t, t + secs, c.get("mode") or ("stop" if c["kind"] == "stop" else "drive")))
        t += secs
    return merge_legs(spans)


class ChainJob:
    """Plays a varying-speed drive (play_chunks) on a thread. Same shape as backend.device.Job
    for the Session: stop() and poll(). stop() waits for the thread, so no chunk can start after
    the Session's clear."""

    def __init__(self, chunks, cd: CoreDevice, log):
        self.label = "drive"
        self.cancel = threading.Event()
        self.ok = None
        self.thread = threading.Thread(target=self._run, args=(chunks, cd, log), daemon=True)
        self.thread.start()

    def _run(self, chunks, cd, log):
        try:
            self.ok = play_chunks(chunks, cd, self.cancel, log)
        except Exception as e:   # a hung helper shouldn't vanish silently
            log(f"drive stopped: {e}")
            self.ok = False

    @property
    def running(self) -> bool:
        return self.thread.is_alive()

    def poll(self):
        return None if self.running else (0 if self.ok else 1)

    def stop(self):
        self.cancel.set()
        self.thread.join(timeout=35)   # at most one call in flight (30s timeout)


class DriveEngine:
    id = "drive"
    label = "Drive"
    service = "coredevice"
    real_speed = True

    def __init__(self, cd: CoreDevice | None = None):
        self.cd = cd or CoreDevice()

    def available(self) -> bool:
        return True   # pure pmd3, same as spoof

    def prepare(self, path: str, mph, log) -> dict:
        """A typed mph = one steady call (the setup proven on the phone). Otherwise the speed
        changes along the route: a chain of calls from plan_chunks."""
        if not mph:
            name, chunks = plan_chunks(path, log=log)
            write_chunks(name, chunks, log=log)
            return {"chunks": chunks, "timeline": thin(chunk_timeline(chunks)), "legs": chunk_legs(chunks), "mph": None}
        route_file = build_route_file(path, mph, log=log)
        with open(route_file, encoding="utf-8") as f:
            data = json.load(f)
        # one speed for the whole list, so the timeline is just distance / speed
        pts = [(w["latitude"], w["longitude"]) for w in data["waypoints"]]
        t, timeline = 0.0, [[0.0, *pts[0]]]
        for a, b in zip(pts, pts[1:]):
            t += haversine(a, b) / data["speed"]
            timeline.append([round(t, 1), *b])
        # one steady speed, no stops: a single drive leg
        return {"route_file": route_file, "timeline": thin(timeline), "legs": [[0.0, round(t, 1), "drive"]],
                "mph": data["speed"] / MPH}

    def start(self, prepared: dict, log):
        if "chunks" in prepared:
            return ChainJob(prepared["chunks"], self.cd, log)
        return self.cd.route(prepared["route_file"], log)

    def hold(self, lat: float, lon: float, log):
        """Park the phone on one point (places / dropped pins)."""
        return self.cd.hold(lat, lon, log)

    def clear(self, log) -> bool:
        return self.cd.clear(log)
