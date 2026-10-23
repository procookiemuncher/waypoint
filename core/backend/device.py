"""The pymobiledevice3 adapter — the one place that talks to pmd3 (ground rule #5).

Everything goes through the pmd3 CLI as a subprocess, same commands spoof.py has always run
(`--userspace` tunnel, no admin). Nothing pmd3-shaped leaks out: callers get plain dicts,
bools and Job handles.

Set VIDA_DRY_RUN=1 to swap every phone command for a harmless stand-in — handy for working on
the app without moving your pin in front of the whole circle. Add VIDA_DRY_PHONE=slow to fake a
phone that shows up a few seconds in, locked, then gets unlocked (for the connect screen), or
VIDA_DRY_PHONE=none for one that never shows up, or VIDA_DRY_PHONE=flaky for one that's there,
gets unplugged 30s in and comes back 15s later (for the reconnect screen).
"""
import json
import os
import signal
import subprocess
import sys
import threading
import time

DRY_RUN = os.environ.get("VIDA_DRY_RUN") == "1"
DRY_SLOW = DRY_RUN and os.environ.get("VIDA_DRY_PHONE") == "slow"
DRY_NONE = DRY_RUN and os.environ.get("VIDA_DRY_PHONE") == "none"
DRY_FLAKY = DRY_RUN and os.environ.get("VIDA_DRY_PHONE") == "flaky"
WINDOWS = sys.platform == "win32"
_T0 = time.time()


def _pmd(*args) -> list[str]:
    return [sys.executable, "-m", "pymobiledevice3", *args]


def _dry(cmd: list[str], hold: bool) -> list[str]:
    """Stand-in for a phone command: print what would have run, and stay alive if it's a hold."""
    code = f"print('[dry run] ' + {' '.join(cmd[2:])!r}, flush=True)"
    if hold:
        code += "\nimport time\ntry:\n    while True: time.sleep(1)\nexcept KeyboardInterrupt: pass"
    return [sys.executable, "-c", code]


class Job:
    """A long-running phone command (hold a point / replay a route). Output lines go to `log`.
    pmd3 waits for SIGINT/SIGTERM on Mac and for ENTER on Windows before letting go, so stop()
    asks nicely first and only kills it if it hangs."""

    def __init__(self, cmd: list[str], log, label: str):
        self.label = label
        self.proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if WINDOWS else 0)
        threading.Thread(target=self._pump, args=(log,), daemon=True).start()

    def _pump(self, log):
        for line in self.proc.stdout:
            line = line.rstrip()
            if line:
                log(line)

    @property
    def running(self) -> bool:
        return self.proc.poll() is None

    def poll(self):
        return self.proc.poll()

    def stop(self):
        if not self.running:
            return
        try:
            if WINDOWS:
                self.proc.stdin.write("\n")
                self.proc.stdin.flush()
            else:
                self.proc.send_signal(signal.SIGINT)
            self.proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            self.proc.kill()
            self.proc.wait()


def run(cmd: list[str], log, timeout: float = 90) -> bool:
    """Run a short command to completion, streaming its output. True on exit code 0."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        log(f"  timed out: {' '.join(cmd[-4:])}")
        return False
    for line in (p.stdout + p.stderr).splitlines():
        if line.strip():
            log(line.rstrip())
    return p.returncode == 0


class Pmd3:
    """pmd3's DVT location sim: lat/lon only (Life360 sees 0 mph), works on Mac + Windows."""

    def list_devices(self) -> list[dict]:
        """Connected phones as {name, udid, ios, connection}. Empty list if none / no usbmuxd."""
        if DRY_RUN:
            if DRY_NONE or DRY_SLOW and time.time() - _T0 < 12 or DRY_FLAKY and 30 < time.time() - _T0 < 45:
                return []
            return [{"name": "Dry-run iPhone", "udid": "dry-run", "ios": "27.0", "connection": "USB"}]
        try:
            p = subprocess.run(_pmd("usbmux", "list"), capture_output=True, text=True, timeout=15)
            devices = json.loads(p.stdout or "[]")
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
            return []
        return [{"name": d.get("DeviceName"), "udid": d.get("UniqueDeviceID"),
                 "ios": d.get("ProductVersion"), "connection": d.get("ConnectionType")}
                for d in devices]

    def mount(self, log) -> tuple[str, str]:
        """Mount the Developer Disk Image, which only works on an unlocked phone — so this doubles
        as the unlock check. Returns (state, message), state being "ready", "locked" or "error".
        auto-mount exits 0 on most failures too, so go by what it prints."""
        cmd = _pmd("mounter", "auto-mount", "--userspace")
        if DRY_SLOW and time.time() - _T0 < 20:
            cmd = _pmd("mounter", "auto-mount", "--userspace", "# pretend: DeviceLocked")
        lines = []
        ok = run(_dry(cmd, False) if DRY_RUN else cmd, lambda line: (lines.append(line), log(line)))
        # pmd3's crash tracebacks quote its own source inside a box (│ ╭ ╰) — and that source
        # contains "mounted successfully". Only trust lines outside the box.
        said = [l for l in lines if l.strip()[:1] not in ("│", "╭", "╰")]
        out = "\n".join(said)
        if "DeviceLocked" in out or "PasswordProtected" in out:
            return "locked", "unlock your iPhone"
        if "Developer Mode is disabled" in out:
            return "error", "turn on Developer Mode (Settings → Privacy & Security)"
        if "already mounted" in out or "mounted successfully" in out or (DRY_RUN and ok):
            return "ready", ""
        return "error", (said[-1].strip() if said else "couldn't reach the phone")[:140]

    def hold(self, lat: float, lon: float, log) -> Job:
        cmd = _pmd("developer", "dvt", "simulate-location", "set", "--userspace", "--", str(lat), str(lon))
        return Job(_dry(cmd, True) if DRY_RUN else cmd, log, "hold")

    def play_gpx(self, gpx_path: str, log) -> Job:
        cmd = _pmd("developer", "dvt", "simulate-location", "play", "--userspace", gpx_path)
        return Job(_dry(cmd, True) if DRY_RUN else cmd, log, "route")

    def clear(self, log) -> bool:
        cmd = _pmd("developer", "dvt", "simulate-location", "clear", "--userspace")
        return run(_dry(cmd, False) if DRY_RUN else cmd, log, timeout=30)
