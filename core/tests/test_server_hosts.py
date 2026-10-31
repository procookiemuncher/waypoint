"""The local server only answers requests addressed to 127.0.0.1 / localhost (DNS rebinding) and
refuses cross-origin writes. Stdlib unittest against a real server on a free port, no device."""
import os
import socket
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["VIDA_DRY_RUN"] = "1"   # before backend imports: never touch a real phone

import uvicorn

from backend.server import create_app
from backend.session import Session


class ServerHosts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            cls.port = s.getsockname()[1]
        cls.server = uvicorn.Server(uvicorn.Config(create_app(Session()), host="127.0.0.1",
                                                   port=cls.port, log_level="warning"))
        threading.Thread(target=cls.server.run, daemon=True).start()
        while not cls.server.started:
            time.sleep(0.02)

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True

    def call(self, path, host, method="GET", origin=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method,
                                     data=b"" if method == "POST" else None)
        req.add_header("Host", host)
        if origin:
            req.add_header("Origin", origin)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code

    def test_own_hosts_allowed(self):
        for name in ("127.0.0.1", "localhost"):
            self.assertEqual(self.call("/api/status", f"{name}:{self.port}"), 200)

    def test_rebound_host_refused(self):
        evil = f"evil.example:{self.port}"
        self.assertEqual(self.call("/api/status", evil), 403)
        self.assertEqual(self.call("/api/stop", evil, "POST", f"http://{evil}"), 403)

    def test_cross_origin_post_refused(self):
        own = f"127.0.0.1:{self.port}"
        self.assertEqual(self.call("/api/stop", own, "POST", "http://evil.example"), 403)
        self.assertEqual(self.call("/api/stop", own, "POST", f"http://{own}"), 200)


if __name__ == "__main__":
    unittest.main()
