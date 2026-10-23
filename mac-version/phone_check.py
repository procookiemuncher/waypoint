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


def _info(what: str, udid: str, timeout: float) -> dict:
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        subprocess.run(["xcrun", "devicectl", "device", "info", what, "--device", udid, "-q", "-j", path],
                       capture_output=True, timeout=timeout)
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("result", {})
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {}
    finally:
        os.remove(path)


class DevicectlReadiness:
    def __init__(self):
        self.ddi_ok = set()   # udids whose DDI we've already seen usable (that check takes ~5s)

    def __call__(self, udid: str) -> tuple[str, str]:
        lock = _info("lockState", udid, timeout=10)
        if "passcodeRequired" not in lock:
            return "checking", ""   # devicectl hasn't picked the phone up yet
        if lock["passcodeRequired"]:
            return "locked", "unlock your iPhone"
        if udid not in self.ddi_ok:
            ddi = _info("ddiServices", udid, timeout=30).get("ddiMetadata", {})
            if not ddi.get("isUsable"):
                return "error", "Xcode's developer disk image isn't on the phone — open Xcode with it plugged in"
            self.ddi_ok.add(udid)
        return "ready", ""
