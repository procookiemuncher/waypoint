"""The pymobiledevice3 adapter — the one place that talks to pmd3 (ground rule #5).

Everything goes through the pmd3 CLI as a subprocess, same commands spoof.py has always run
(`--userspace` tunnel, no admin). Nothing pmd3-shaped leaks out: callers get plain dicts,
bools and Job handles.

Set VIDA_DRY_RUN=1 to swap every phone command for a harmless stand-in — handy for working on
the app without moving your pin in front of the whole circle.
"""
import json
import os
import signal
import subprocess
import sys
import threading

DRY_RUN = os.environ.get("VIDA_DRY_RUN") == "1"
WINDOWS = sys.platform == "win32"


def _pmd(*args) -> list[str]:
    return [sys.executable, "-m", "pymobiledevice3", *args]


def _dry(cmd: list[str], hold: bool) -> list[str]:
    """Stand-in for a phone command: print what would have run, and stay alive if it's a hold."""
    code = f"print('[dry run] ' + {' '.join(cmd[2:])!r}, flush=True)"
    if hold:
        code += "\nimport time\nwhile True: time.sleep(1)"
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
            return [{"name": "Dry-run iPhone", "udid": "dry-run", "ios": "27.0", "connection": "USB"}]
        try:
            p = subprocess.run(_pmd("usbmux", "list"), capture_output=True, text=True, timeout=15)
            devices = json.loads(p.stdout or "[]")
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
            return []
        return [{"name": d.get("DeviceName"), "udid": d.get("UniqueDeviceID"),
                 "ios": d.get("ProductVersion"), "connection": d.get("ConnectionType")}
                for d in devices]

    def mount(self, log) -> bool:
        """Mount the Developer Disk Image. Needs the phone unlocked; harmless if already mounted."""
        cmd = _pmd("mounter", "auto-mount", "--userspace")
        ok = run(_dry(cmd, False) if DRY_RUN else cmd, log)
        if not ok:
            log("  (ignore if already mounted; if it says DeviceLocked, unlock the phone and retry)")
        return ok

    def hold(self, lat: float, lon: float, log) -> Job:
        cmd = _pmd("developer", "dvt", "simulate-location", "set", "--userspace", "--", str(lat), str(lon))
        return Job(_dry(cmd, True) if DRY_RUN else cmd, log, "hold")

    def play_gpx(self, gpx_path: str, log) -> Job:
        cmd = _pmd("developer", "dvt", "simulate-location", "play", "--userspace", gpx_path)
        return Job(_dry(cmd, True) if DRY_RUN else cmd, log, "route")

    def clear(self, log) -> bool:
        cmd = _pmd("developer", "dvt", "simulate-location", "clear", "--userspace")
        return run(_dry(cmd, False) if DRY_RUN else cmd, log)
