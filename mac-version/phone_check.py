"""Is the phone unlocked? — the Mac app's answer, from devicectl instead of a pmd3 DDI mount.

pmd3 9.33.1 can't mount the DDI on iOS 27 (auto-mount dies with KeyError 'ApBoardID'), so the core
mount-based check never says ready here. devicectl reads the real lock state in well under a
second and also tells us whether Xcode's DDI is on the phone. mac-version/app.py plugs this into
the Session with use_readiness().
"""
import json
import os
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor


def _info(what: str, udid: str, timeout: float) -> dict:
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    t = time.time()
    try:
        subprocess.run(["xcrun", "devicectl", "device", "info", what, "--device", udid, "-q", "-j", path],
                       capture_output=True, timeout=timeout)
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("result", {})
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {}
    finally:
        os.remove(path)
        took = time.time() - t
        if took > 2:   # slow ones only, so a cold start shows up in ~/Library/Logs/Waypoint.log
            print(f"[{time.strftime('%H:%M:%S')}] devicectl {what} took {took:.1f}s", flush=True)


class DevicectlReadiness:
    def __init__(self):
        self.ddi_ok = set()   # udids whose DDI we've already seen usable (that check takes ~5s)
        self._ddi = {}        # udid -> the DDI look running in the background
        self._pool = ThreadPoolExecutor(1)

    def __call__(self, udid: str) -> tuple[str, str]:
        # the slow DDI look starts alongside the first lock one, so an unlocked phone isn't kept waiting
        if udid not in self.ddi_ok and udid not in self._ddi:
            self._ddi[udid] = self._pool.submit(_info, "ddiServices", udid, 30)
        lock = _info("lockState", udid, timeout=10)
        if "passcodeRequired" not in lock:
            return "checking", ""   # devicectl hasn't picked the phone up yet
        if lock["passcodeRequired"]:
            return "locked", "unlock your iPhone"
        if udid not in self.ddi_ok:
            ddi = self._ddi.pop(udid).result().get("ddiMetadata", {})
            if not ddi.get("isUsable"):
                # that look may have started before devicectl had the phone, so ask again before saying no
                ddi = _info("ddiServices", udid, timeout=30).get("ddiMetadata", {})
            if not ddi.get("isUsable"):
                return "error", "Xcode's developer disk image isn't on the phone — open Xcode with it plugged in"
            self.ddi_ok.add(udid)
        return "ready", ""
