"""What the app drives: one phone, one active job at a time.

Starting anything stops whatever was running first. Stopping kills the job and clears every
location service we touched since the last clear (pmd3's DVT sim and the phone's CoreDevice sim
are separate services, so clearing one doesn't clear the other).

Route engines are pluggable. Both ship in core and both go through backend/device.py: `spoof`
(pmd3 DVT GPX replay, follows the route's timing but Life360 sees 0 mph) and `drive` (the
CoreDevice sim, real speed, backend/drive.py).
"""
import threading
import time
from collections import deque

from backend.device import DRY_RUN, Pmd3
from backend.drive import DriveEngine
from backend.routes import RouteError, build_gpx, route_path, thin


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
        self.register(DriveEngine())
        self.lock = threading.Lock()       # one phone action at a time
        self.job = None
        self.active = None                 # what's on the phone right now, for the UI
        self.busy = None                   # short description while an action is in flight
        self.dirty = set()                 # services that may still be holding a fake location
        self.closing = False               # set by shutdown(); queued actions then do nothing
        self.mounted = False
        self.readiness = ("checking", "")  # (state, message) for the connect screen, kept by _probe
        self._probe_at, self._probing = 0.0, False
        self.placer = None                 # optional engine with hold(lat, lon, log); see use_placer()
        self.logs = deque(maxlen=400)
        self.seq = 0
        self._devices, self._devices_at = [], 0.0

    # ---- plumbing ----
    def register(self, engine):
        self.engines[engine.id] = engine
        self.services[engine.service] = engine.clear

    def use_placer(self, engine):
        """Hold places / pins with a registered engine's hold() instead of pmd3's DVT one (the Mac
        app uses drive's CoreDevice hold, which hands off and exits instead of keeping a process)."""
        self.placer = engine

    def log(self, text: str, level: str = "sys"):
        self.seq += 1
        self.logs.append({"n": self.seq, "level": level, "text": text})
        print(f"[{time.strftime('%H:%M:%S')}] {text}", flush=True)   # → ~/Library/Logs/Waypoint.log

    def logs_since(self, n: int) -> list:
        return [l for l in self.logs if l["n"] > n]

    def devices(self) -> list:
        # each look is a whole pmd3 start (~0.3s of cpu), so once the phone is ready look less
        # often; an unplug still shows within ~10s
        every = 10 if self.readiness[0] == "ready" else 4
        if time.time() - self._devices_at > every:
            self._devices, self._devices_at = self.pmd3.list_devices(), time.time()
            if not self._devices:
                self.mounted = False   # unplugged / rebooted → the DDI has to go back on
        return self._devices

    def phone(self) -> dict:
        """Is the phone plugged in, unlocked and carrying the DDI? The lock comes live from
        lockdown (plain USB, no tunnel), so re-locking shows up too, and the DDI gets mounted once
        per plug-in. The check runs in the background so polling stays fast."""
        if not self.devices():
            self.readiness = ("checking", "")
            return {"state": "none", "message": ""}
        every = 2        # quick on the connect screen
        if self.readiness[0] == "ready":
            every = 6    # each check is a pmd3 start (~0.5s of cpu), so calmer once it's up
        if self.readiness[0] == "error":
            every = 10   # a failed mount (no internet, Developer Mode off) won't fix itself in 2s
        if self.active and self.active.get("kind") == "route":
            every = 20   # and quieter still while a route plays
        if not self._probing and time.time() - self._probe_at > every:
            self._probing = True
            threading.Thread(target=self._probe, daemon=True).start()
        state, message = self.readiness
        return {"state": state, "message": message}

    def _probe(self):
        try:
            devices = self._devices
            lock = self.pmd3.lock_state(devices[0]["udid"] if devices else None)
            if lock == "locked":
                self._set_readiness("locked", "unlock your iPhone")
            elif self.mounted:
                self._set_readiness("ready", "")
            elif self.lock.acquire(blocking=False):   # an action running mounts on its own
                try:   # unlocked, or lockdown didn't say: the mount tries and says what's wrong
                    self._ensure_mounted(quiet=self.readiness[0] not in ("checking", "locked"))
                finally:
                    self.lock.release()
        except Exception as e:
            self._set_readiness("error", f"{type(e).__name__}: {e}")
        finally:
            self._probe_at, self._probing = time.time(), False

    def _set_readiness(self, state: str, message: str):
        if state != self.readiness[0]:
            if state == "locked":
                self.log("phone is locked — unlock it to continue", "warn")
            elif state == "ready":
                self.log("phone unlocked and ready", "ok")
            elif state == "error":
                self.log(f"phone not ready: {message}", "warn")
        self.readiness = (state, message)

    def status(self) -> dict:
        active = dict(self.active) if self.active else None
        if active and self.job:
            code = self.job.poll()
            # pmd3 DVT jobs stay alive until stopped; CoreDevice calls hand off and exit 0.
            # Anything else exiting is a failure the UI should show.
            if code not in (None, 0):
                active["state"] = "failed"
                self.mounted = False   # most pmd3 failures are a missing/stale DDI — remount next time
        return {
            "devices": self.devices(),
            "phone": self.phone(),
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
                if self.closing:
                    return   # the app is quitting; don't put a new spoof on after the final clear
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

    def _clear_dirty(self, keep: str | None = None) -> bool:
        """Clear every service still holding a location, except `keep` (about to be reused).
        A service only counts as clean once its clear actually succeeds. True if all did."""
        for service in sorted(self.dirty - {keep}):
            self.log(f"clearing {service} location sim…", "dim")
            try:
                ok = self.services[service](lambda line: self.log(line, "dim"))
            except Exception as e:
                self.log(f"{type(e).__name__}: {e}", "warn")
                ok = False
            if ok:
                self.dirty.discard(service)
        left = self.dirty - {keep}
        if left:
            self.log(f"couldn't clear {', '.join(sorted(left))} — unlock the phone and hit stop again", "warn")
        return not left

    def _ensure_mounted(self, quiet: bool = False):
        """Mount the DDI if it isn't yet. `quiet` skips the console noise on connect-screen
        retries — a locked phone gets re-checked every few seconds."""
        if self.mounted:
            return
        log = (lambda line: None) if quiet else (lambda line: self.log(line, "dim"))
        log("mounting developer disk image (phone must be unlocked)…")
        before = self.readiness[0]
        if before != "error":   # error → error retries would only make it flicker
            self.readiness = ("checking", "putting the developer disk image on the phone, the first time takes a few minutes")
        state, message = self.pmd3.mount(log)
        if state != before or not quiet:
            if state == "locked":
                self.log("phone is locked — unlock it to continue", "warn")
            elif state == "ready":
                self.log("phone unlocked — developer disk image is on", "ok")
            elif state == "error":
                self.log(f"couldn't mount the developer disk image: {message}", "warn")
        self.readiness = (state, message)
        self.mounted = state == "ready"

    # ---- actions ----
    def set_location(self, lat: float, lon: float, label: str):
        def go():
            self._stop_job()
            service = self.placer.service if self.placer else "pmd3"
            self._clear_dirty(keep=service)
            self._ensure_mounted()   # both location sims come in with the DDI
            self.log(f"holding at {label} ({lat:.5f}, {lon:.5f})", "accent")
            holder = self.placer or self.pmd3
            self.job = holder.hold(lat, lon, lambda line: self.log(line, "dim"))
            self.dirty.add(service)
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
            if self._clear_dirty():
                self.log("cleared — phone is back on real GPS", "ok")
        self._in_background("clearing", go)

    def shutdown(self):
        """Blocking stop + clear, for app exit. Quitting must never leave a spoof running.
        Can take a while (an action in flight finishes first, then the clears), so don't call it
        from a UI thread."""
        self.closing = True
        with self.lock:
            self._stop_job()
            self.active = None
            self._clear_dirty()
