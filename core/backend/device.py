"""The pymobiledevice3 adapter — the one place that talks to pmd3 (ground rule #5).

Everything goes through a subprocess, same as spoof.py has always done (`--userspace` tunnel, no
admin): the pmd3 CLI where it has the command, and for the CoreDevice location sim, which the CLI
doesn't cover, `python -c` into coredevice_child() below. Nothing pmd3-shaped leaks out: callers
get plain dicts, bools and Job handles.

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
CORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_T0 = time.time()


def _pmd(*args) -> list[str]:
    return [sys.executable, "-m", "pymobiledevice3", *args]


def _dry(cmd: list[str], hold: bool, label: str | None = None) -> list[str]:
    """Stand-in for a phone command: print what would have run, and stay alive if it's a hold."""
    code = f"print('[dry run] ' + {label or ' '.join(cmd[2:])!r}, flush=True)"
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

    def lock_state(self, udid: str | None = None) -> str | None:
        """"locked" or "unlocked", live, from lockdown's PasswordProtected value. It follows the lock
        screen the same way devicectl's passcodeRequired does (checked both ways on the phone,
        2026-11-19), and it's plain USB lockdown: no tunnel, no DDI, ~0.6s. None when lockdown
        didn't answer (just plugged in, not trusted yet, ...), then the mount gets to explain."""
        if DRY_RUN:
            return "locked" if DRY_SLOW and time.time() - _T0 < 20 else "unlocked"
        cmd = _pmd("lockdown", "get", *(["--udid", udid] if udid else []), "", "PasswordProtected")
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        except (subprocess.TimeoutExpired, OSError):
            return None
        said = p.stdout.strip().lower()   # JSON, so true / false (seen as True / False too)
        if said in ("true", "false"):
            return "locked" if said == "true" else "unlocked"
        if "PasswordProtected" in p.stderr or "PasswordRequired" in p.stderr:
            return "locked"
        return None

    def mount(self, log) -> tuple[str, str]:
        """Mount the Developer Disk Image if it isn't on yet. Only works on an unlocked phone.
        Returns (state, message), state being "ready", "locked" or "error". The first mount on a
        phone downloads + personalizes the image and sends it over the slow userspace tunnel, so
        it gets minutes, not seconds."""
        cmd = _pmd("mounter", "auto-mount", "--userspace")
        if DRY_SLOW and time.time() - _T0 < 20:
            cmd = _pmd("mounter", "auto-mount", "--userspace", "# pretend: DeviceLocked")
        lines = []
        ok = run(_dry(cmd, False) if DRY_RUN else cmd, lambda line: (lines.append(line), log(line)), timeout=900)
        # pmd3's crash tracebacks quote its own source inside a box (│ ╭ ╰) — and that source
        # contains "mounted successfully". Only trust lines outside the box.
        said = [l for l in lines if l.strip()[:1] not in ("│", "╭", "╰")]
        out = "\n".join(said)
        if "DeviceLocked" in out or "PasswordProtected" in out or "PasswordRequired" in out:
            return "locked", "unlock your iPhone"
        if "Developer Mode is disabled" in out or "DeveloperModeIsNotEnabled" in out:
            return "error", "turn on Developer Mode (Settings → Privacy & Security)"
        if ok and ("already mounted" in out or "mounted successfully" in out) or (DRY_RUN and ok):
            return "ready", ""   # since 11.x auto-mount's exit code means something, so want both
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


# ---- CoreDevice location sim -----------------------------------------------------------------
# What Xcode's `devicectl device simulate location` drives, minus Xcode: a service on the phone
# (/usr/libexec/dtlocationd, comes with the DDI) that pmd3 reaches over the userspace tunnel.
# Unlike the DVT sim above it takes a speed, so Life360 shows mph + the car. Shapes proven on the
# phone 2026-11-18 (iOS 27.0.1), see docs/research/no-xcode-speed-sim.md. Every call opens its own
# tunnel, sends one request and exits; the phone keeps holding / playing the route after that.
CD_SERVICE = "com.apple.coredevice.locationservice"
CD_FEATURE = "com.apple.coredevice.feature.simulatelocation"
CD_ACTIONS = {"set": "setsimulatedlocation", "route": "startlocationsimulation",
              "clear": "clearsimulatedlocation", "scenarios": "availablelocationscenarios"}
_CHILD = f"import sys; sys.path.insert(0, {CORE!r}); from backend.device import coredevice_child; coredevice_child()"


def cd_point(lat, lon) -> dict:
    # floats on purpose: an int goes over XPC as int64 and the phone wants a double
    return {"latitude": float(lat), "longitude": float(lon)}


def cd_route_input(points, speed: float, interval: float = 1.0) -> dict:
    """startlocationsimulation's input. `points` are (lat, lon) pairs or {latitude, longitude}
    dicts, speed is m/s. pacing is a Swift enum, encoded {"interval": {"_0": seconds}} (the
    phone refuses {"interval": {"interval": ...}} with "Expected to find key _0")."""
    pts = [cd_point(p["latitude"], p["longitude"]) if isinstance(p, dict) else cd_point(*p) for p in points]
    if len(pts) < 2:
        raise ValueError("a route needs at least two points")
    return {"waypoints": pts, "speed": float(speed), "pacing": {"interval": {"_0": float(interval)}}}


def cd_input(action: str, data: dict) -> dict:
    """Normalise a request for `action` (set / route / clear / scenarios) into what the phone takes."""
    if action == "set":
        return cd_point(data["latitude"], data["longitude"])
    if action == "route":
        interval = (data.get("pacing") or {}).get("interval", {}).get("_0", 1.0)
        return cd_route_input(data["waypoints"], data["speed"], interval)
    if action in CD_ACTIONS:
        return {}
    raise ValueError(f"unknown coredevice action {action!r}")


def write_route_input(path: str, points, speed: float, interval: float = 1.0):
    """Write a route request to a file for CoreDevice.route() — a long route won't fit on a
    Windows command line."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cd_route_input(points, speed, interval), f)


def _cd_error(e: Exception) -> str:
    info = getattr(e, "user_info", None) or {}
    text = info.get("NSLocalizedDescription") or info.get("NSDebugDescription")
    if not text:
        import re
        m = re.search(r"NSDebugDescription': [\"'](.+?)[\"'],", str(e))
        text = m.group(1) if m else str(e)
    return f"{type(e).__name__}: {text}"[:300]


async def _cd_send(action: str, inp: dict):
    from pymobiledevice3.remote.core_device.core_device_service import CoreDeviceService
    from pymobiledevice3.remote.userspace_tunnel import UserspaceRsdTunnel
    async with UserspaceRsdTunnel(serial=os.environ.get("PYMOBILEDEVICE3_UDID") or None) as rsd:
        if CD_SERVICE not in rsd.peer_info.get("Services", {}):
            raise LookupError("the phone has no location service yet, the developer disk image isn't mounted")
        async with CoreDeviceService(rsd, CD_SERVICE) as svc:
            return await svc.invoke(CD_FEATURE, inp, action_identifier="com.apple.coredevice.action." + CD_ACTIONS[action])


def coredevice_child():
    """Entry point of the helper process: `python -c <_CHILD> <action> [json | @file]`. Runs in a
    process of its own because pmd3's userspace tunnel is one per process. Exit 0 = the phone took
    it. `selftest` only loads the tunnel + CoreDevice code (the release build checks it compiled in)."""
    import asyncio
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action == "selftest":
        from pymobiledevice3.remote.core_device.core_device_service import CoreDeviceService  # noqa: F401
        from pymobiledevice3.remote.userspace_tunnel import UserspaceRsdTunnel  # noqa: F401
        print("coredevice helper ok", flush=True)
        return
    try:
        arg = sys.argv[2] if len(sys.argv) > 2 else "{}"
        if arg.startswith("@"):
            with open(arg[1:], encoding="utf-8") as f:
                data = json.load(f)
        else:
            data = json.loads(arg)
        inp = cd_input(action, data)
        out = asyncio.run(_cd_send(action, inp))
    except Exception as e:
        print(f"coredevice {action} failed: {_cd_error(e)}", flush=True)
        sys.exit(1)
    if action == "scenarios":
        print(json.dumps(out, default=str), flush=True)
    sys.exit(0)


class CoreDevice:
    """Hold / route / clear through the CoreDevice sim. Each method's call returns as soon as the
    phone has it (like devicectl), so the Jobs here finish on their own with exit 0."""

    def set_cmd(self, lat: float, lon: float) -> list[str]:
        cmd = [sys.executable, "-c", _CHILD, "set", json.dumps(cd_point(lat, lon))]
        return _dry(cmd, False, f"coredevice set {lat:.5f} {lon:.5f}") if DRY_RUN else cmd

    def route_cmd(self, route_file: str) -> list[str]:
        cmd = [sys.executable, "-c", _CHILD, "route", "@" + route_file]
        return _dry(cmd, False, f"coredevice route {os.path.basename(route_file)}") if DRY_RUN else cmd

    def clear_cmd(self) -> list[str]:
        cmd = [sys.executable, "-c", _CHILD, "clear"]
        return _dry(cmd, False, "coredevice clear") if DRY_RUN else cmd

    def hold(self, lat: float, lon: float, log) -> Job:
        return Job(self.set_cmd(lat, lon), log, "hold")

    def route(self, route_file: str, log) -> Job:
        return Job(self.route_cmd(route_file), log, "drive")

    def clear(self, log) -> bool:
        return run(self.clear_cmd(), log, timeout=30)
