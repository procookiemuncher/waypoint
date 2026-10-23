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
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                route_file = dc.build_route_file(path, mph)
        except SystemExit as e:              # devicectl_route reports problems via sys.exit
            raise RouteError(str(e.code))
        finally:
            for line in out.getvalue().splitlines():
                log(line)
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
        cmd = ["xcrun", "devicectl", "device", "simulate", "location", "route",
               "--device", self._device(), "--route-file", prepared["route_file"]]
        return Job(_dry(["", "", *cmd], True) if DRY_RUN else cmd, log, "drive")

    def clear(self, log) -> bool:
        cmd = ["xcrun", "devicectl", "device", "simulate", "location", "clear", "--device", self._device()]
        return run(_dry(["", "", *cmd], False) if DRY_RUN else cmd, log, timeout=30)
