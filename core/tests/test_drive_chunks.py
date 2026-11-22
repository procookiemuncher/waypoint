"""Drive's chunks for the phone: a wait at a red light is a parked call that's still part of the
drive, the pull-away from it stays a ramp, nothing is shorter than a phone call, nothing over 75 mph.
Offline: the road plan is patched in, the route is written to a temp file."""
import json
import math
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["VIDA_DRY_RUN"] = "1"   # before backend imports: never touch a real phone

import backend.movement as movement  # noqa: E402
from backend import drive  # noqa: E402
from backend.movement import roads  # noqa: E402
from backend.movement.model import RoadEdge  # noqa: E402

_M_PER_DEG = 111_111.0


def _east(meters, lat=25.0):
    dlon = 10.0 / (_M_PER_DEG * math.cos(math.radians(lat)))
    return [[lat, i * dlon] for i in range(int(meters / 10) + 1)]


class DriveChunksTest(unittest.TestCase):
    def _chunks(self, controls, cruise=15.0, meters=2000, seed=3):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = os.path.join(tmp.name, "t.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"name": "t", "segments": [{"mode": "drive", "speed_mps": cruise, "waypoints": _east(meters)},
                                                 {"mode": "stop", "dwell_s": 120}]}, f)
        real_snap = movement.snap_route

        def snap_with_roads(route, *a, **kw):
            route, w = real_snap(route, *a, **kw)
            route.segments[0].roads = [RoadEdge(s0=0.0, s1=meters, road_class="primary")]
            return route, w
        spans = [(0.0, meters + 10.0, cruise)]
        with mock.patch.object(movement, "snap_route", side_effect=snap_with_roads), \
                mock.patch.object(roads, "plan", return_value=(spans, controls)):
            return drive.plan_chunks(path, seed=seed, log=lambda *_: None)[1]

    def test_a_red_light_is_a_wait_inside_the_drive(self):
        chunks = self._chunks([roads.Control(900.0, "light", dwell_s=40.0)])
        waits = [c for c in chunks if c["kind"] == "stop" and c["mode"] == "drive"]
        self.assertEqual(len(waits), 1)
        self.assertAlmostEqual(waits[0]["secs"], 40.0, delta=1.0)
        self.assertEqual([c for c in chunks if c["kind"] == "stop"][-1]["mode"], "stop")   # the dwell at the end
        legs = drive.chunk_legs(chunks)
        self.assertEqual([g[2] for g in legs], ["drive", "stop"])    # the live card never says "parked" at a light

    def test_the_pull_away_stays_a_ramp(self):
        chunks = self._chunks([roads.Control(900.0, "light", dwell_s=40.0)])
        k = next(i for i, c in enumerate(chunks) if c["kind"] == "stop" and c["mode"] == "drive")
        after = [c for c in chunks[k + 1:k + 4]]
        self.assertTrue(all(c["kind"] == "move" for c in after))
        self.assertLess(after[0]["speed"], 5.0)                       # crawling off the line...
        self.assertLess(after[0]["speed"], after[1]["speed"])         # ...then picking up
        self.assertLess(after[1]["speed"], after[2]["speed"] + 0.5)
        before = chunks[k - 1]
        self.assertLess(before["speed"], 6.0)                         # and it rolled up slowly

    def test_no_chunk_shorter_than_a_phone_call(self):
        chunks = self._chunks([roads.Control(500.0, "stop", dwell_s=2.0), roads.Control(1100.0, "light", dwell_s=30.0),
                               roads.Control(1500.0, "turn", v_cap=4.0)])
        for c in chunks:
            if c["kind"] == "move":
                self.assertGreaterEqual(c["secs"], 2.0, c)

    def test_never_over_75_mph(self):
        for seed in range(6):
            chunks = self._chunks([], cruise=33.0, meters=6000, seed=seed)
            self.assertLessEqual(max(c["speed"] for c in chunks if c["kind"] == "move"), drive.MAX_MOVE_MPS)

    def test_timeline_and_legs_agree(self):
        chunks = self._chunks([roads.Control(900.0, "light", dwell_s=40.0)])
        self.assertAlmostEqual(drive.chunk_legs(chunks)[-1][1], drive.chunk_timeline(chunks)[-1][0], delta=0.5)


if __name__ == "__main__":
    unittest.main()
