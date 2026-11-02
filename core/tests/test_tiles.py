"""Map tiles: the server redirects to Stadia, with the key when there is one. Real server, no device, no network."""
import http.client
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["VIDA_DRY_RUN"] = "1"   # before backend imports: never touch a real phone

import uvicorn

from backend import tiles
from backend.server import create_app
from backend.session import Session


def serve(key):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    with mock.patch("backend.server.load_key", return_value=key):
        app = create_app(Session())
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.02)
    return server, port


def get(port, path):
    c = http.client.HTTPConnection("127.0.0.1", port)
    c.request("GET", path)
    r = c.getresponse()
    r.read()
    return r.status, r.getheader("location")


class Key(unittest.TestCase):
    def test_from_env_file(self):
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as f:
            f.write("OTHER=1\nVIDA_STADIA_KEY= abc \n")
        self.addCleanup(os.unlink, f.name)
        with mock.patch.dict(os.environ):
            os.environ.pop("VIDA_STADIA_KEY", None)
            self.assertEqual(tiles.load_key(f.name), "abc")

    def test_env_var_wins(self):
        with mock.patch.dict(os.environ, {"VIDA_STADIA_KEY": "from-env"}):
            self.assertEqual(tiles.load_key("/no/such/file"), "from-env")

    def test_no_key(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("VIDA_STADIA_KEY", None)
            self.assertIsNone(tiles.load_key("/no/such/file"))


class Route(unittest.TestCase):
    def setUp(self):
        self.server, self.port = None, None

    def start(self, key):
        self.server, self.port = serve(key)
        self.addCleanup(setattr, self.server, "should_exit", True)

    def test_redirects_with_the_key(self):
        self.start("test-key")
        status, loc = get(self.port, "/tiles/13/2262/3473@2x.png")
        self.assertEqual(status, 302)
        self.assertEqual(loc, f"{tiles.STYLE}/13/2262/3473@2x.png?api_key=test-key")

    def test_redirects_without_a_key(self):
        self.start(None)
        self.assertEqual(get(self.port, "/tiles/13/2262/3473.png"), (302, f"{tiles.STYLE}/13/2262/3473.png"))

    def test_only_tile_names(self):
        self.start("test-key")
        for path in ("/tiles/13/2262/x.png", "/tiles/13/2262/3473.png.evil", "/tiles/a/2262/3473.png"):
            self.assertIn(get(self.port, path)[0], (404, 422), path)


if __name__ == "__main__":
    unittest.main()
