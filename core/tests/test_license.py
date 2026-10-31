"""The access key check (backend/license.py) and the server's key gate, against a fake key dashboard
on a free port. Stdlib unittest, no device, no internet."""
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["VIDA_DRY_RUN"] = "1"   # before backend imports: never touch a real phone

import uvicorn

from backend.license import License
from backend.server import create_app
from backend.session import Session

GOOD = {"WPT-AAAA-BBBB-CCCC-DDDD"}


class Dashboard(BaseHTTPRequestHandler):
    """Stands in for the Vercel key dashboard's /api/check. `down` = answer 500."""
    down = False

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if Dashboard.down:
            self.send_response(500)
            self.end_headers()
            return
        out = json.dumps({"ok": body.get("key") in GOOD}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LicenseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dash = HTTPServer(("127.0.0.1", free_port()), Dashboard)
        threading.Thread(target=cls.dash.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.dash.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.dash.shutdown()

    def setUp(self):
        Dashboard.down = False
        self.dir = tempfile.TemporaryDirectory()
        self.lic = License(self.url, os.path.join(self.dir.name, "license.json"))

    def tearDown(self):
        self.dir.cleanup()
        GOOD.clear()
        GOOD.add("WPT-AAAA-BBBB-CCCC-DDDD")

    def test_no_saved_key(self):
        self.lic.check()
        self.assertEqual(self.lic.state, "none")
        self.assertFalse(self.lic.ok())

    def test_good_key_unlocks_and_is_remembered(self):
        self.assertEqual(self.lic.activate("WPT-AAAA-BBBB-CCCC-DDDD")["state"], "ok")
        again = License(self.url, self.lic.path)   # next launch
        again.check()
        self.assertTrue(again.ok())

    def test_wrong_key(self):
        self.assertEqual(self.lic.activate("WPT-ZZZZ-ZZZZ-ZZZZ-ZZZZ")["state"], "bad")
        self.assertFalse(self.lic.ok())

    def test_deleting_the_key_locks_it(self):
        self.lic.activate("WPT-AAAA-BBBB-CCCC-DDDD")
        GOOD.clear()   # deleted in the dashboard
        self.lic.check()
        self.assertEqual(self.lic.state, "revoked")
        self.assertFalse(os.path.exists(self.lic.path))

    def test_dashboard_down_keeps_a_recent_key(self):
        self.lic.activate("WPT-AAAA-BBBB-CCCC-DDDD")
        Dashboard.down = True
        again = License(self.url, self.lic.path)
        again.check()
        self.assertTrue(again.ok())

    def test_offline_too_long_locks(self):
        with open(self.lic.path, "w") as f:
            json.dump({"key": "WPT-AAAA-BBBB-CCCC-DDDD", "last_ok": time.time() - 7 * 3600}, f)
        dead = License(f"http://127.0.0.1:{free_port()}", self.lic.path)   # nothing listening
        dead.check()
        self.assertEqual(dead.state, "offline")


class ServerGate(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.lic = License("http://127.0.0.1:1", os.path.join(self.dir.name, "license.json"))
        self.lic.state = "none"
        self.port = free_port()
        self.server = uvicorn.Server(uvicorn.Config(create_app(Session(), self.lic), host="127.0.0.1",
                                                    port=self.port, log_level="warning"))
        threading.Thread(target=self.server.run, daemon=True).start()
        while not self.server.started:
            time.sleep(0.02)

    def tearDown(self):
        self.server.should_exit = True
        self.dir.cleanup()

    def code(self, path, method="GET"):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method,
                                     data=b"{}" if method == "POST" else None,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code

    def test_locked_blocks_the_api_and_the_data(self):
        for path in ("/api/status", "/api/logs", "/api/routes", "/api/places", "/api/cities"):
            self.assertEqual(self.code(path), 402, path)
        self.assertEqual(self.code("/api/play", "POST"), 402)
        self.assertEqual(self.code("/api/place", "POST"), 402)

    def test_locked_still_serves_page_key_check_and_stop(self):
        self.assertEqual(self.code("/"), 200)
        self.assertEqual(self.code("/static/app.js"), 200)
        self.assertEqual(self.code("/api/license"), 200)
        self.assertEqual(self.code("/api/stop", "POST"), 200)

    def test_unlocked_opens_up(self):
        self.lic.state = "ok"
        self.assertEqual(self.code("/api/status"), 200)
        self.assertEqual(self.code("/api/routes"), 200)


if __name__ == "__main__":
    unittest.main()
