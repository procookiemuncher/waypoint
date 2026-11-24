"""A route's own "seed" makes every Drive of it the same: same red lights, stops, jitter, wander and
timing, down to the files the phone is sent. Without one every drive still comes out different.
Offline: road data is patched in (real roads.plan, so the lights and stops are really rolled)."""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["VIDA_DRY_RUN"] = "1"   # before backend imports: never touch a real phone

import backend.movement as movement  # noqa: E402
from backend import drive  # noqa: E402
from backend.movement.model import RoadEdge  # noqa: E402
from backend.routes import RouteError  # noqa: E402

_M_PER_DEG = 111_111.0
METERS = 4000


def _line():
    # 2 km east, then 2 km north: a corner for the turn logic as well
    import math
    dlon = 10.0 / (_M_PER_DEG * math.cos(math.radians(25.0)))
    east = [[25.0, i * dlon] for i in range(201)]
    north = [[25.0 + i * 10.0 / _M_PER_DEG, 200 * dlon] for i in range(1, 201)]
    return east + north


def _edges():
    # 400 m blocks, a light every other block and side streets at the rest, so lights and stop signs both roll
    out = []
    for k in range(METERS // 400):
        h = 90.0 if k < 5 else 0.0
        out.append(RoadEdge(s0=k * 400.0, s1=(k + 1) * 400.0, road_class="primary", kmh=60.0, limit_kmh=60.0,
                            h0=h, h1=h, signal=k % 2 == 0, stop_impact=3, cross=["residential"]))
    return out


class RouteSeedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        real_snap = movement.snap_route

        def snap_with_roads(route, *a, **kw):
            route, w = real_snap(route, *a, **kw)
            route.segments[0].roads = _edges()
            return route, w
        p = mock.patch.object(movement, "snap_route", side_effect=snap_with_roads)
        p.start()
        self.addCleanup(p.stop)
        b = mock.patch.object(drive, "BUILD_DIR", self.tmp.name)
        b.start()
        self.addCleanup(b.stop)

    def _route(self, name, **extra):
        path = os.path.join(self.tmp.name, name + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"name": name, **extra, "segments": [{"mode": "drive", "speed_mps": 15.0, "waypoints": _line()},
                                                           {"mode": "stop", "dwell_s": 60}]}, f)
        return path

    def _plan(self, path, seed=None):
        return drive.plan_chunks(path, seed=seed, log=lambda *_: None)[1]

    def _sent(self, path):
        """What a Drive of it would send the phone: each call in order with its start time, and the
        contents of every route file (points, speed, pacing)."""
        prepared = drive.DriveEngine().prepare(path, None, lambda *_: None)
        out, t = [], 0.0
        for c in prepared["chunks"]:
            if c["kind"] == "move":
                with open(c["file"], encoding="utf-8") as f:
                    out.append(["route", round(t, 6), json.load(f)])
            else:
                out.append(["set", round(t, 6), list(c["at"]), c["mode"]])
            t += c["secs"]
        return out, prepared["timeline"], prepared["legs"]

    def test_a_seeded_route_sends_the_same_every_drive(self):
        path = self._route("seeded", seed=16)
        first, second = self._sent(path), self._sent(path)
        self.assertEqual(json.dumps(first), json.dumps(second))
        calls = first[0]
        self.assertGreater(len(calls), 10)
        self.assertEqual(calls[-1][0], "set")   # ends parked on the last point, nothing clears it

    def test_the_seed_covers_the_lights(self):
        # the seed has to be doing the work: different seeds roll different lights and timing
        a, b = self._route("a", seed=1), self._route("b", seed=2)
        waits = lambda cs: [(round(c["secs"], 3)) for c in cs if c["kind"] == "stop" and c["mode"] != "stop"]
        plans = [self._plan(a), self._plan(b)]
        self.assertTrue(any(waits(p) for p in plans), "no red light rolled at all, the test proves nothing")
        self.assertNotEqual(json.dumps(plans[0]), json.dumps(plans[1]))

    def test_an_unseeded_route_still_varies(self):
        path = self._route("free")
        plans = {json.dumps(self._plan(path)) for _ in range(4)}
        self.assertGreater(len(plans), 1)

    def test_a_given_seed_beats_the_routes_own(self):
        own, other = self._route("own", seed=16), self._route("other", seed=17)
        self.assertEqual(json.dumps(self._plan(own, seed=17)), json.dumps(self._plan(other)))

    def test_a_bad_seed_is_refused(self):
        for bad in ("16", True, 1.5):
            with self.assertRaises(RouteError):
                self._plan(self._route("bad", seed=bad))

    def test_the_demo_route_carries_a_seed(self):
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes",
                            "palm-trunk-to-atlantis.json")
        self.assertIsInstance(drive.route_seed(path), int)


if __name__ == "__main__":
    unittest.main()
