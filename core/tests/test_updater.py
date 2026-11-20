"""backend/updater.py against a fake dashboard + download server on a free port, with a tiny ad-hoc
signed .app standing in for Waypoint. Does the real ditto / codesign / swap, all in a temp dir."""
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization as ser

from backend import updater as U

KEY = "WPT-AAAA-BBBB-CCCC-DDDD"


def make_app(where, marker):
    app = os.path.join(where, "Waypoint.app")
    macos = os.path.join(app, "Contents", "MacOS")
    os.makedirs(macos)
    with open(os.path.join(app, "Contents", "Info.plist"), "w") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>'
                '<key>CFBundleExecutable</key><string>Waypoint</string>'
                '<key>CFBundleIdentifier</key><string>test.waypoint</string></dict></plist>')
    exe = os.path.join(macos, "Waypoint")
    with open(exe, "w") as f:
        f.write(f"#!/bin/sh\necho {marker}\n")
    os.chmod(exe, 0o755)
    subprocess.run(["codesign", "-s", "-", "--force", app], check=True, capture_output=True)
    return app


class Server(BaseHTTPRequestHandler):
    release = None   # what /api/update hands a good key
    blob = b""

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        out = {"ok": body.get("key") == KEY,
               "release": Server.release if body.get("key") == KEY else None}
        self._send(json.dumps(out).encode())

    def do_GET(self):
        self._send(Server.blob)

    def _send(self, data):
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


class UpdaterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = HTTPServer(("127.0.0.1", 0), Server)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.http.server_port}"
        cls.priv = Ed25519PrivateKey.generate()
        cls.pub = base64.b64encode(cls.priv.public_key().public_bytes(
            ser.Encoding.Raw, ser.PublicFormat.Raw)).decode()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.apps = os.path.join(self.tmp, "Applications")
        os.makedirs(self.apps)
        self.installed = make_app(self.apps, "old")
        newdir = os.path.join(self.tmp, "new")
        os.makedirs(newdir)
        new = make_app(newdir, "new")
        zpath = os.path.join(self.tmp, "new.zip")
        subprocess.run(["ditto", "-c", "-k", "--keepParent", new, zpath], check=True)
        with open(zpath, "rb") as f:
            Server.blob = f.read()
        self.sha = hashlib.sha256(Server.blob).hexdigest()
        self.release(5)

    def tearDown(self):
        subprocess.run(["rm", "-rf", self.tmp])

    def release(self, build, sha=None, signer=None):
        sha = sha or self.sha
        sig = base64.b64encode((signer or self.priv).sign(U.signed_message(build, sha))).decode()
        Server.release = {"build": build, "version": f"0.1.0-beta.{build}", "url": self.base + "/zip",
                          "size": len(Server.blob), "sha256": sha, "sig": sig}

    def updater(self, build=4, key=KEY):
        return U.Updater(self.base, build, lambda: key, app=self.installed,
                         root=os.path.join(self.tmp, "support"), public_key=self.pub)

    def run_app(self):
        return subprocess.run([os.path.join(self.installed, "Contents/MacOS/Waypoint")],
                              capture_output=True, text=True).stdout.strip()

    def wait_swap(self, proc):
        proc.wait(timeout=30)

    def test_newer(self):
        self.assertTrue(U.newer(3, 2))
        self.assertFalse(U.newer(2, 2))
        self.assertFalse(U.newer(1, 2))
        self.assertFalse(U.newer(None, 2))
        self.assertFalse(U.newer("x", 2))

    def test_full_update_swaps_after_quit(self):
        u = self.updater()
        self.assertTrue(u.check())
        self.assertEqual(u.ready()["build"], 5)
        self.assertEqual(self.run_app(), "old")   # nothing touched while running
        stand_in = subprocess.Popen(["sleep", "1"])   # "the app", quits a second later
        helper = u.install_on_exit(pid=stand_in.pid)
        stand_in.wait()
        self.wait_swap(helper)
        self.assertEqual(self.run_app(), "new")
        subprocess.run(["codesign", "--verify", "--deep", "--strict", self.installed], check=True)
        self.assertIsNone(u.ready())
        self.assertFalse(os.path.exists(self.installed + ".updating-old"))

    def test_same_or_older_build_ignored(self):
        self.assertFalse(self.updater(build=5).check())
        self.assertFalse(self.updater(build=9).check())
        self.assertIsNone(self.updater(build=5).install_on_exit(pid=1))

    def test_wrong_signer_refused(self):
        self.release(5, signer=Ed25519PrivateKey.generate())
        u = self.updater()
        self.assertFalse(u.check())
        self.assertIsNone(u.ready())

    def test_signature_bound_to_build(self):
        # a real signature for build 5 can't be replayed as build 50
        self.release(5)
        Server.release["build"] = 50
        self.assertFalse(self.updater().check())

    def test_tampered_download_refused(self):
        self.release(5, sha="0" * 64)   # signed, but not the bytes being served
        u = self.updater()
        self.assertFalse(u.check())
        self.assertIsNone(u.ready())

    def test_no_key_no_check(self):
        self.assertFalse(self.updater(key=None).check())
        self.assertFalse(self.updater(key="WPT-NOPE").check())

    def test_translocated_or_dmg_not_replaced(self):
        self.assertFalse(U.can_replace("/private/var/folders/x/AppTranslocation/y/d/Waypoint.app"))
        self.assertFalse(U.can_replace("/Volumes/Waypoint/Waypoint.app"))
        self.assertFalse(U.can_replace(None))
        self.assertTrue(U.can_replace(self.installed))

    def test_bundle_path(self):
        self.assertEqual(U.bundle_path("/Applications/Waypoint.app/Contents/MacOS/Waypoint"),
                         "/Applications/Waypoint.app")
        self.assertIsNone(U.bundle_path("/usr/bin/python3"))

    def test_baked_key_is_valid(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        Ed25519PublicKey.from_public_bytes(base64.b64decode(U.PUBLIC_KEY))


if __name__ == "__main__":
    unittest.main()
