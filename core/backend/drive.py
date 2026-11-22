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
# The movement engine renders the route (ramps, slowing for corners, stops), that gets cut into
# chunks of roughly steady speed, and a slow wander goes on top so a straight expressway doesn't
# sit on one number. Stops become a coordinate hold.
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


def plan_chunks(route_path: str, seed=None, log=print):
    """[{kind: move, waypoints, speed, secs} | {kind: stop, at, secs}] for play_chunks().
    A new seed each time unless one is given, so no two drives come out the same."""
    from backend.movement import RouteRenderer, load_route, snap_route
    from backend.movement.model import STOP
    route, warnings = snap_route(load_route(route_path))
    for w in warnings:
        log(f"  ! {w}")
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
        if dist / speed >= 1:   # skip slivers, not worth a phone call
            chunks.append({"kind": "move", "waypoints": pts[i:j + 1], "speed": speed, "dist": dist,
                           "mode": fixes[(i + j + 1) // 2].mode})
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
    log(f"  wrote {out}: {len(moving)} moving chunks, {len(chunks) - len(moving)} stops, "
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
        what = f"{c['speed'] / MPH:.0f} mph" if c["kind"] == "move" else "stopped"
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
    app's live card ("Parked at the door"). A stop on a generated route is the 10 min at the door."""
    t, spans = 0.0, []
    for c in chunks:
        secs = c["secs"] if c["kind"] == "stop" else sum(
            haversine(a, b) for a, b in zip(c["waypoints"], c["waypoints"][1:])) / c["speed"]
        spans.append((t, t + secs, "stop" if c["kind"] == "stop" else c.get("mode") or "drive"))
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
