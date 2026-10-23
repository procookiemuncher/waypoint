"""The `drive` route engine for the app — devicectl's location sim, which carries a real speed
(Life360 shows mph + the car icon). Mac + Xcode only, so it lives here and mac-version/app.py
plugs it into the shared Session. The devicectl details stay in devicectl_route.py.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # devicectl_route

import devicectl_route as dc
from backend.device import DRY_RUN, Job, _dry, run
from backend.routes import RouteError, haversine
from backend.session import thin


class DriveEngine:
    id = "drive"
    label = "Drive"
    service = "devicectl"
    real_speed = True

    def __init__(self):
        self.udid = None

    def available(self) -> bool:
        return DRY_RUN or shutil.which("xcrun") is not None

    def _device(self) -> str:
        if DRY_RUN:
            return "dry-run"
        self.udid = self.udid or dc.find_device()
        if not self.udid:
            raise RouteError("devicectl can't see the phone — plug it in and unlock it")
        return self.udid

    def prepare(self, path: str, mph, log) -> dict:
        """A typed mph = one steady devicectl call (the setup proven on the phone). Otherwise the
        speed changes along the route: a chain of calls from dc.plan_chunks."""
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                if mph:
                    route_file = dc.build_route_file(path, mph)
                else:
                    name, chunks = dc.plan_chunks(path)
                    dc.write_chunks(name, chunks)
        except SystemExit as e:              # devicectl_route reports problems via sys.exit
            raise RouteError(str(e.code))
        finally:
            for line in out.getvalue().splitlines():
                log(line)
        if not mph:
            return {"chunks": chunks, "timeline": thin(chunk_timeline(chunks)), "mph": None}
        with open(route_file, encoding="utf-8") as f:
            data = json.load(f)
        # devicectl holds one speed for the whole list, so the timeline is just distance / speed.
        pts = [(w["latitude"], w["longitude"]) for w in data["waypoints"]]
        t, timeline = 0.0, [[0.0, *pts[0]]]
        for a, b in zip(pts, pts[1:]):
            t += haversine(a, b) / data["speed"]
            timeline.append([round(t, 1), *b])
        return {"route_file": route_file, "timeline": thin(timeline), "mph": data["speed"] / dc.MPH}

    def start(self, prepared: dict, log):
        if "chunks" in prepared:
            wrap = (lambda cmd: _dry(["", "", *cmd], False)) if DRY_RUN else (lambda cmd: cmd)
            return ChainJob(prepared["chunks"], self._device(), log, wrap)
        cmd = ["xcrun", "devicectl", "device", "simulate", "location", "route",
               "--device", self._device(), "--route-file", prepared["route_file"]]
        return Job(_dry(["", "", *cmd], True) if DRY_RUN else cmd, log, "drive")

    def hold(self, lat: float, lon: float, log):
        """Park the phone on one point (places / dropped pins). Used instead of pmd3's hold on the
        Mac — pmd3 9.33.1 can't mount the DDI on iOS 27, devicectl uses Xcode's."""
        cmd = ["xcrun", "devicectl", "device", "simulate", "location", "coordinate",
               "--device", self._device(), f"--latitude={lat}", f"--longitude={lon}"]   # = so -80.19 isn't read as a flag
        return Job(_dry(["", "", *cmd], True) if DRY_RUN else cmd, log, "hold")

    def clear(self, log) -> bool:
        cmd = ["xcrun", "devicectl", "device", "simulate", "location", "clear", "--device", self._device()]
        return run(_dry(["", "", *cmd], False) if DRY_RUN else cmd, log, timeout=30)


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


class ChainJob:
    """Plays a varying-speed drive (dc.play_chunks) on a thread. Same shape as backend.device.Job
    for the Session: stop() and poll(). stop() waits for the thread, so no chunk can start after
    the Session's clear."""

    def __init__(self, chunks, device, log, wrap):
        self.label = "drive"
        self.cancel = threading.Event()
        self.ok = None
        self.thread = threading.Thread(target=self._run, args=(chunks, device, log, wrap), daemon=True)
        self.thread.start()

    def _run(self, chunks, device, log, wrap):
        try:
            self.ok = dc.play_chunks(chunks, device, self.cancel, log, wrap)
        except Exception as e:   # a hung or missing xcrun shouldn't vanish silently
            log(f"drive stopped: {e}")
            self.ok = False

    @property
    def running(self) -> bool:
        return self.thread.is_alive()

    def poll(self):
        return None if self.running else (0 if self.ok else 1)

    def stop(self):
        self.cancel.set()
        self.thread.join(timeout=35)   # at most one devicectl call in flight (30s timeout)
