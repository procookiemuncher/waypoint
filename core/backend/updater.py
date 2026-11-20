"""Auto-update for the release app. No screen: it checks, downloads and gets the new app ready in the
background, and swaps it in after the app quits, so nothing changes under someone mid-drive.

How a release gets here: mac-version/release/release.command builds the app, zips it with ditto,
signs it with the key in ~/.config/waypoint/update_ed25519.pem, uploads it to Vercel Blob and tells
the key dashboard about it. The app asks the dashboard (POST /api/update with its access key) every
few hours. A valid key gets the manifest {build, version, url, size, sha256, sig}.

Checks before anything is swapped:
- build has to be bigger than ours (an integer baked in by build.command, never goes down)
- sha256 of the download matches, and the Ed25519 signature over "waypoint:<build>:<sha256>" checks
  out against PUBLIC_KEY, so the dashboard or the blob store alone can't push an app
- the unzipped app passes codesign --verify --deep --strict

Only in release builds (waypoint_build importable), never the dev app. Test builds can point it
elsewhere with VIDA_UPDATE_URL.
"""
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time

import requests

PUBLIC_KEY = "Cp3ktuCYr7PU1VRqsFreJvp05ecAVM5LX8oA9Zps+VM="
FIRST_CHECK = 90             # seconds after launch, the phone connect gets the network first
CHECK_EVERY = 3 * 60 * 60
TIMEOUT = 15


def log(msg):
    print(f"update: {msg}", flush=True)


def newer(remote, ours):
    try:
        return int(remote) > int(ours)
    except (TypeError, ValueError):
        return False


def signed_message(build, sha256):
    return f"waypoint:{int(build)}:{sha256}".encode()


def verify(build, sha256, sig, public_key=PUBLIC_KEY):
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    try:
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key))
        key.verify(base64.b64decode(sig), signed_message(build, sha256))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def bundle_path(executable=None):
    """The .app we're running from, or None (not a bundle)."""
    path = os.path.realpath(executable or sys.executable)
    while path not in ("/", ""):
        if path.endswith(".app"):
            return path
        path = os.path.dirname(path)
    return None


def can_replace(app):
    """Running off the DMG or from App Translocation (a read-only random path) can't be swapped."""
    if not app or "/AppTranslocation/" in app or app.startswith("/Volumes/"):
        return False
    return os.access(os.path.dirname(app), os.W_OK) and os.access(app, os.W_OK)


def _support():
    return os.path.expanduser("~/Library/Application Support/Waypoint/update")


class Updater:
    def __init__(self, url, build, key_source, app=None, root=None, public_key=PUBLIC_KEY):
        self.url = url.rstrip("/") + "/api/update"
        self.build = int(build)
        self.key_source = key_source      # () -> saved access key or None
        self.app = app or bundle_path()
        self.root = root or _support()
        self.public_key = public_key
        self.lock = threading.Lock()

    @classmethod
    def from_config(cls, lic):
        try:
            import waypoint_build
        except ImportError:
            return None   # dev app
        build = getattr(waypoint_build, "BUILD", 0)
        url = getattr(waypoint_build, "LICENSE_URL", "")
        if getattr(waypoint_build, "TEST", False):
            url = os.environ.get("VIDA_UPDATE_URL") or url
        if not url or not build or lic is None:
            return None
        return cls(url, build, lic.saved_key)

    # state on disk -------------------------------------------------------------
    @property
    def ready_file(self):
        return os.path.join(self.root, "ready.json")

    @property
    def staged_app(self):
        return os.path.join(self.root, "staged", "Waypoint.app")

    def ready(self):
        """The staged update, if there's one newer than us that's still on disk."""
        try:
            with open(self.ready_file) as f:
                info = json.load(f)
        except (OSError, ValueError):
            return None
        if newer(info.get("build"), self.build) and os.path.isdir(self.staged_app):
            return info
        return None

    # checking + downloading ----------------------------------------------------------
    def ask(self):
        key = self.key_source()
        if not key:
            return None
        from backend.license import machine_id
        r = requests.post(self.url, json={"key": key, "build": self.build, "machine": machine_id()},
                          timeout=TIMEOUT)
        if r.status_code != 200:
            return None
        data = r.json()
        return data.get("release") if data.get("ok") else None

    def check(self):
        """One round: ask, and if there's something newer, download + verify + stage it."""
        with self.lock:
            try:
                rel = self.ask()
            except (requests.RequestException, ValueError) as e:
                log(f"couldn't ask the dashboard ({e.__class__.__name__})")
                return False
            if not rel or not newer(rel.get("build"), self.build):
                return False
            have = self.ready()
            if have and int(have["build"]) >= int(rel["build"]):
                return True
            try:
                self.stage(rel)
                return True
            except Exception as e:   # anything wrong with a download just means no update this time
                log(f"build {rel.get('build')} not staged: {e}")
                return False

    def stage(self, rel):
        build, sha, sig = int(rel["build"]), rel["sha256"], rel["sig"]
        if not verify(build, sha, sig, self.public_key):
            raise ValueError("bad signature in the manifest")
        os.makedirs(self.root, exist_ok=True)
        zpath = os.path.join(self.root, f"Waypoint-{build}.zip")
        part = zpath + ".part"
        h = hashlib.sha256()
        with requests.get(rel["url"], stream=True, timeout=TIMEOUT) as r:
            r.raise_for_status()
            with open(part, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
                    h.update(chunk)
        if h.hexdigest() != sha:
            os.remove(part)
            raise ValueError("download doesn't match its sha256")
        os.replace(part, zpath)

        staged = os.path.dirname(self.staged_app)
        shutil.rmtree(staged, ignore_errors=True)
        _forget(self.ready_file)
        os.makedirs(staged)
        # ditto, not zipfile: Nuitka's data files keep their signatures in xattrs and zipfile drops them
        subprocess.run(["ditto", "-x", "-k", zpath, staged], check=True, capture_output=True)
        os.remove(zpath)
        if not os.path.isdir(self.staged_app):
            raise ValueError("zip has no Waypoint.app in it")
        for attr in ("com.apple.provenance", "com.apple.quarantine"):
            subprocess.run(["xattr", "-dr", attr, self.staged_app], capture_output=True)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", self.staged_app],
                       check=True, capture_output=True)
        with open(self.ready_file, "w") as f:
            json.dump({"build": build, "version": rel.get("version", "")}, f)
        log(f"{rel.get('version') or build} downloaded, goes in when Waypoint quits")

    def start(self):
        def loop():
            time.sleep(FIRST_CHECK)
            while True:
                self.check()
                time.sleep(CHECK_EVERY)
        threading.Thread(target=loop, daemon=True).start()

    # swapping ---------------------------------------------------------------------
    def install_on_exit(self, pid=None):
        """Called after the phone's been cleared on quit. Hands the swap to a shell that waits for
        this process to be gone, then puts the staged app where ours is (old one back if that fails).
        Returns the helper's Popen, or None."""
        info = self.ready()
        if not info:
            return None
        if not can_replace(self.app):
            log(f"can't replace {self.app} (read-only or translocated), leaving the update staged")
            return None
        logf = os.path.expanduser("~/Library/Logs/Waypoint.log")
        os.makedirs(os.path.dirname(logf), exist_ok=True)
        out = open(logf, "a")
        log(f"installing {info.get('version') or info['build']} once Waypoint has quit")
        return subprocess.Popen(
            ["/bin/sh", "-c", SWAP, "swap", str(pid or os.getpid()), self.staged_app, self.app,
             self.ready_file],
            stdin=subprocess.DEVNULL, stdout=out, stderr=out, start_new_session=True, close_fds=True)


SWAP = r'''
pid="$1"; new="$2"; app="$3"; ready="$4"; old="$app.updating-old"
i=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.5; i=$((i+1))
  [ "$i" -gt 240 ] && { echo "update: Waypoint never quit, not swapping"; exit 1; }
done
rm -rf "$old"
mv "$app" "$old" || { echo "update: couldn't move the old app aside"; exit 1; }
if mv "$new" "$app"; then
  rm -rf "$old"; rm -f "$ready"; echo "update: installed"
else
  mv "$old" "$app"; echo "update: swap failed, old app put back"
fi
'''


def _forget(path):
    try:
        os.remove(path)
    except OSError:
        pass
