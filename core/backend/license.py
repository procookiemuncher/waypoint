"""Access keys. The key dashboard (the "key dashboard" folder next to this repo, on Vercel) makes
keys; this checks the one typed into Waypoint against it, at launch and every few minutes after.
Delete the key there and the next check here says no, and the server stops answering the API.

Only on when a dashboard URL is configured: the release build bakes one in (build.command,
LICENSE_URL), the dev app has none unless you set VIDA_LICENSE_URL. So day to day nothing changes.

Basic on purpose: the dashboard's answer isn't signed, so someone who fakes it on their own Mac
gets in, and so does anyone who patches the compiled app. It stops a key being used after you
delete it, which is the job.
"""
import hashlib
import json
import os
import platform
import subprocess
import sys
import threading
import time

import requests

RECHECK = 5 * 60         # seconds between checks while the app is open
GRACE = 6 * 60 * 60      # how long a key that checked out keeps working with no internet
TIMEOUT = 8


def license_url():
    """The dashboard to check keys against, or None (no key needed)."""
    try:
        import waypoint_build   # release builds only
        url = getattr(waypoint_build, "LICENSE_URL", "")
        if url:
            return url
    except ImportError:
        pass
    return os.environ.get("VIDA_LICENSE_URL") or None


def _store_path():
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support/Waypoint")
    else:
        base = os.path.join(os.path.expanduser("~"), ".waypoint")
    return os.path.join(base, "license.json")


def machine_id():
    """Same Mac -> same id, without sending the hardware UUID itself."""
    raw = ""
    if sys.platform == "darwin":
        try:
            out = subprocess.run(["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                                 capture_output=True, text=True, timeout=5).stdout
            for line in out.splitlines():
                if "IOPlatformUUID" in line:
                    raw = line.split('"')[-2]
        except (OSError, subprocess.SubprocessError, IndexError):
            pass
    if not raw:
        import uuid
        raw = f"{uuid.getnode()}-{platform.node()}"
    return hashlib.sha256(f"waypoint:{raw}".encode()).hexdigest()[:20]


class License:
    """state: checking -> ok | none (no key yet) | revoked (saved key got deleted) | bad (typed key
    is wrong) | offline (can't reach the dashboard and no recent ok)."""

    def __init__(self, url, path=None):
        self.url = url.rstrip("/") + "/api/check"
        self.path = path or _store_path()
        self.state = "checking"
        self.lock = threading.Lock()
        self.first = threading.Event()
        self._machine = None

    @classmethod
    def from_config(cls):
        url = license_url()
        return cls(url) if url else None

    # saved key ---------------------------------------------------------------
    def _load(self):
        try:
            with open(self.path) as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save(self, data):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w") as f:
            json.dump(data, f)
        os.chmod(self.path, 0o600)

    def _forget(self):
        try:
            os.remove(self.path)
        except OSError:
            pass

    # talking to the dashboard ----------------------------------------------------
    def _ask(self, key):
        """True / False from the dashboard, None if it couldn't be reached (or broke)."""
        if self._machine is None:
            self._machine = machine_id()
        try:
            r = requests.post(self.url, json={"key": key, "machine": self._machine}, timeout=TIMEOUT)
            if r.status_code != 200:
                return None   # the dashboard being down isn't the key being deleted
            return r.json().get("ok") is True
        except (requests.RequestException, ValueError):
            return None

    def check(self):
        """Re-check the saved key. Run at launch and every RECHECK."""
        saved = self._load()
        key = saved.get("key")
        if not key:
            with self.lock:
                self.state = "none"
            self.first.set()
            return
        answer = self._ask(key)
        with self.lock:
            if answer is True:
                self._save({"key": key, "last_ok": time.time()})
                self.state = "ok"
            elif answer is False:
                self._forget()
                self.state = "revoked"
            elif time.time() - saved.get("last_ok", 0) > GRACE:
                self.state = "offline"
            # else: offline but checked out recently, keep whatever we had (ok stays ok)
            elif self.state == "checking":
                self.state = "ok"
        self.first.set()

    def activate(self, key):
        """A key typed into the app. An empty key re-checks the saved one (the Try again button)."""
        key = (key or "").strip()
        if not key:
            self.check()
            return self.status()
        answer = self._ask(key)
        with self.lock:
            if answer is True:
                self._save({"key": key, "last_ok": time.time()})
                self.state = "ok"
            elif answer is False:
                self.state = "bad"
            else:
                self.state = "offline"
        return self.status()

    def start(self):
        def loop():
            while True:
                self.check()
                time.sleep(RECHECK)
        threading.Thread(target=loop, daemon=True).start()

    # what the server reads -------------------------------------------------------
    def ok(self):
        return self.state == "ok"

    def status(self, wait=0):
        if wait:
            self.first.wait(wait)
        return {"required": True, "state": self.state}
