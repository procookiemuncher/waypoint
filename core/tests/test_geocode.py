"""Address lookup: Photon's answer gets normalized, and failures come out readable. Photon is stubbed."""
import json
import os
import socket
import sys
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["VIDA_DRY_RUN"] = "1"   # before backend imports: never touch a real phone

import requests
import uvicorn

from backend import geocode
from backend.license import License
from backend.server import create_app
from backend.session import Session

WHITE_HOUSE = {
    "geometry": {"type": "Point", "coordinates": [-77.0365525, 38.8976387]},
    "properties": {"name": "White House", "housenumber": "1600", "street": "Pennsylvania Avenue Northwest",
                   "city": "Washington", "state": "DC", "country": "United States",
                   "extent": [-77.0368541, 38.8977959, -77.0362509, 38.8974904]},
}
NO_NAME = {
    "geometry": {"coordinates": [2.2945, 48.8584]},
    "properties": {"housenumber": "5", "street": "Avenue Anatole France", "city": "Paris", "country": "France"},
}


def photon(*features):
    answer = mock.Mock()
    answer.json.return_value = {"features": list(features)}
    return mock.patch("backend.geocode.requests.get", return_value=answer)


class Geocode(unittest.TestCase):
    def setUp(self):
        geocode._lookup.cache_clear()

    def test_normalizes_photon_order(self):
        with photon(WHITE_HOUSE):
            r = geocode.search("1600 pennsylvania")[0]
        self.assertEqual((r["lat"], r["lon"]), (38.8976387, -77.0365525))
        self.assertEqual(r["bounds"], [[38.8974904, -77.0368541], [38.8977959, -77.0362509]])
        self.assertEqual(r["name"], "White House")
        self.assertEqual(r["sub"], "1600 Pennsylvania Avenue Northwest, Washington, DC, United States")

    def test_street_is_the_name_when_there_is_none(self):
        with photon(NO_NAME):
            r = geocode.search("5 avenue anatole")[0]
        self.assertEqual(r["name"], "5 Avenue Anatole France")
        self.assertEqual(r["sub"], "Paris, France")
        self.assertIsNone(r["bounds"])

    def test_bad_features_are_skipped_and_duplicates_dropped(self):
        broken = {"geometry": {"coordinates": ["x"]}, "properties": {"name": "Nope"}}
        off_map = {"geometry": {"coordinates": [0, 95]}, "properties": {"name": "Off the map"}}
        with photon(broken, off_map, "junk", WHITE_HOUSE, WHITE_HOUSE):
            self.assertEqual(len(geocode.search("white house")), 1)

    def test_short_query_never_calls_out(self):
        with photon() as get:
            self.assertEqual(geocode.search("  a  "), [])
        get.assert_not_called()

    def test_failure_is_not_cached(self):
        with mock.patch("backend.geocode.requests.get", side_effect=requests.ConnectionError):
            with self.assertRaises(geocode.GeocodeError):
                geocode.search("white house")
        with photon(WHITE_HOUSE):
            self.assertEqual(len(geocode.search("white house")), 1)


def serve(app):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.02)
    return server, port


def get(port, q):
    url = f"http://127.0.0.1:{port}/api/geocode?" + urllib.parse.urlencode({"q": q})
    try:
        with urllib.request.urlopen(url) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


class Endpoint(unittest.TestCase):
    def setUp(self):
        geocode._lookup.cache_clear()
        self.server, self.port = serve(create_app(Session()))
        self.addCleanup(setattr, self.server, "should_exit", True)

    def test_answers(self):
        with photon(WHITE_HOUSE):
            status, body = get(self.port, "white house")
        self.assertEqual(status, 200)
        self.assertEqual(body[0]["name"], "White House")

    def test_unreachable_is_a_502_with_a_reason(self):
        with mock.patch("backend.geocode.requests.get", side_effect=requests.Timeout):
            status, body = get(self.port, "white house")
        self.assertEqual(status, 502)
        self.assertIn("isn't reachable", body["detail"])

    def test_behind_the_key_gate(self):
        locked = mock.Mock(spec=License)
        locked.ok.return_value = False
        server, port = serve(create_app(Session(), locked))
        self.addCleanup(setattr, server, "should_exit", True)
        with photon(WHITE_HOUSE) as photon_get:
            self.assertEqual(get(port, "white house")[0], 402)
        photon_get.assert_not_called()


if __name__ == "__main__":
    unittest.main()
