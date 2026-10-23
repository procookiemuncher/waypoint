"""What the app drives: one phone, one active job at a time.

Starting anything stops whatever was running first. Stopping kills the job and clears every
location service we touched since the last clear (pmd3's DVT sim and devicectl's CoreDevice sim
are separate services, so clearing one doesn't clear the other).

Route engines are pluggable: core ships `spoof` (pmd3 GPX replay, works everywhere); the Mac
app registers `drive` (devicectl, real speed) from mac-version/.
"""
import threading
import time
from collections import deque

from backend.device import DRY_RUN, Pmd3
from backend.routes import RouteError, build_gpx, route_path

MAX_TIMELINE_POINTS = 1500


def thin(points: list, limit: int = MAX_TIMELINE_POINTS) -> list:
    """Keep the first/last point and an even spread in between — plenty for drawing the pin."""
    if len(points) <= limit:
        return points
    step = (len(points) - 1) / (limit - 1)
    return [points[round(i * step)] for i in range(limit)]


class SpoofEngine:
    """pmd3 GPX replay — follows the route's speed changes and stops, but Life360 shows 0 mph."""
    id = "spoof"
    label = "Spoof"
    service = "pmd3"
    real_speed = False

    def __init__(self, pmd3: Pmd3):
        self.pmd3 = pmd3

    def available(self) -> bool:
        return True

    def prepare(self, path: str, mph, log) -> dict:
        gpx, fixes = build_gpx(path, log)
        t0 = fixes[0].t if fixes else 0
        return {"gpx": gpx, "timeline": thin([[round(f.t - t0, 1), f.lat, f.lon] for f in fixes])}

    def start(self, prepared: dict, log):
        return self.pmd3.play_gpx(prepared["gpx"], log)

    def clear(self, log) -> bool:
        return self.pmd3.clear(log)


class Session:
    def __init__(self):
        self.pmd3 = Pmd3()
        self.engines = {}
        self.services = {}                 # service name -> clear(log)
        self.register(SpoofEngine(self.pmd3))
        self.lock = threading.Lock()       # one phone action at a time
        self.job = None
        self.active = None                 # what's on the phone right now, for the UI
        self.busy = None                   # short description while an action is in flight
        self.dirty = set()                 # services that may still be holding a fake location
        self.mounted = False
        self.logs = deque(maxlen=400)
        self.seq = 0
        self._devices, self._devices_at = [], 0.0

    # ---- plumbing ----
    def register(self, engine):
        self.engines[engine.id] = engine
        self.services[engine.service] = engine.clear

    def log(self, text: str, level: str = "sys"):
        self.seq += 1
        self.logs.append({"n": self.seq, "level": level, "text": text})

    def logs_since(self, n: int) -> list:
        return [l for l in self.logs if l["n"] > n]

    def devices(self) -> list:
        if time.time() - self._devices_at > 4:
            self._devices, self._devices_at = self.pmd3.list_devices(), time.time()
        return self._devices

    def status(self) -> dict:
        active = dict(self.active) if self.active else None
        if active and self.job:
            code = self.job.proc.poll()
            # pmd3 jobs stay alive until stopped; devicectl hands off and exits 0. Anything
            # else exiting is a failure the UI should show.
            if code not in (None, 0):
                active["state"] = "failed"
        return {
            "devices": self.devices(),
            "active": active,
            "busy": self.busy,
            "engines": [{"id": e.id, "label": e.label, "real_speed": e.real_speed}
                        for e in self.engines.values() if e.available()],
            "dry_run": DRY_RUN,
            "now": time.time(),
        }

    def _in_background(self, label: str, fn):
        def go():
            with self.lock:
                self.busy = label
                try:
                    fn()
                except RouteError as e:
                    self.log(str(e), "warn")
                    self.active = None
                except Exception as e:  # keep the app alive; show it in the console
                    self.log(f"{type(e).__name__}: {e}", "warn")
                    self.active = None
                finally:
                    self.busy = None
        threading.Thread(target=go, daemon=True).start()

    def _stop_job(self):
        if self.job:
            self.job.stop()
            self.job = None

    def _clear_dirty(self, keep: str | None = None):
        """Clear every service still holding a location, except `keep` (about to be reused)."""
        for service in sorted(self.dirty - {keep}):
            self.log(f"clearing {service} location sim…", "dim")
            self.services[service](lambda line: self.log(line, "dim"))
            self.dirty.discard(service)

    def _ensure_mounted(self):
        if not self.mounted:
            self.log("mounting developer disk image (phone must be unlocked)…", "dim")
            self.mounted = self.pmd3.mount(lambda line: self.log(line, "dim"))

    # ---- actions ----
    def set_location(self, lat: float, lon: float, label: str):
        def go():
            self._stop_job()
            self._clear_dirty(keep="pmd3")
            self._ensure_mounted()
            self.log(f"holding at {label} ({lat:.5f}, {lon:.5f})", "accent")
            self.job = self.pmd3.hold(lat, lon, lambda line: self.log(line, "dim"))
            self.dirty.add("pmd3")
            self.active = {"kind": "place", "label": label, "lat": lat, "lon": lon,
                           "started": time.time(), "state": "running"}
        self._in_background(f"setting {label}", go)

    def play(self, route_id: str, engine_id: str, mph: float | None):
        engine = self.engines.get(engine_id)
        if not engine or not engine.available():
            raise RouteError(f"engine '{engine_id}' isn't available here")
        path = route_path(route_id)

        def go():
            self._stop_job()
            self.log(f"building {route_id} for {engine.label.lower()}…", "dim")
            prepared = engine.prepare(path, mph, lambda line: self.log(line, "dim"))
            self._clear_dirty(keep=engine.service)
            if engine.service == "pmd3":
                self._ensure_mounted()
            self.job = engine.start(prepared, lambda line: self.log(line, "dim"))
            self.dirty.add(engine.service)
            self.active = {"kind": "route", "route": route_id, "engine": engine.id,
                           "label": route_id, "started": time.time(), "state": "running",
                           "timeline": prepared["timeline"], "mph": prepared.get("mph")}
            self.log(f"playing {route_id} via {engine.label.lower()} — keep the phone unlocked", "accent")
        self._in_background(f"starting {route_id}", go)

    def stop(self):
        def go():
            self._stop_job()
            self.active = None
            self._clear_dirty()
            self.log("cleared — phone is back on real GPS", "ok")
        self._in_background("clearing", go)

    def shutdown(self):
        """Blocking stop + clear, for app exit. Quitting must never leave a spoof running."""
        with self.lock:
            self._stop_job()
            self.active = None
            self._clear_dirty()
