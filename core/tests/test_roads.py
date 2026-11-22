"""The road model: Valhalla's edges laid on our line, a speed for each road, traffic lights, inferred
stop signs and intersection turns. Offline: the MCO drive's road data is a fixture."""
import json
import math
import os
import random
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.movement import geo, roads, snapper  # noqa: E402
from backend.movement.model import RoadEdge, Route, Segment, parse_route  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "mco-roads.json")
_LAT0 = 25.0


def _fixture():
    with open(FIXTURE, encoding="utf-8") as f:
        data = json.load(f)
    poly = [tuple(p) for p in data["polyline"]]
    return poly, data["edges"]


def _east(meters, step=10.0, lat=_LAT0, lon0=0.0):
    dlon = step / (geo.M_PER_DEG * math.cos(math.radians(lat)))
    return [(lat, lon0 + i * dlon) for i in range(int(meters / step) + 1)]


def _turning(arm=200.0, right=True, step=10.0):
    """East for `arm` m, then a 90 degree turn: south (a right turn) or north (left)."""
    east = _east(arm, step)
    lat, lon = east[-1]
    dlat = step / geo.M_PER_DEG
    sign = -1 if right else 1
    return east + [(lat + sign * j * dlat, lon) for j in range(1, int(arm / step) + 1)]


def _edge(s0, s1, cls="residential", **kw):
    return RoadEdge(s0=s0, s1=s1, road_class=cls, **kw)


class MapEdgesTest(unittest.TestCase):
    def test_fixture_edges_cover_the_line_in_order(self):
        poly, raw = _fixture()
        edges = roads.map_edges(raw, poly)
        total = geo.cumulative(poly)[-1]
        self.assertEqual(len(edges), len(raw))
        self.assertEqual(edges[0].s0, 0.0)
        self.assertEqual(edges[-1].s1, total)
        for a, b in zip(edges, edges[1:]):
            self.assertAlmostEqual(a.s1, b.s0)
            self.assertLessEqual(a.s0, a.s1)
        self.assertTrue(any(e.signal for e in edges))
        self.assertTrue(any(e.limit_kmh for e in edges))

    def test_a_different_line_is_refused(self):
        poly, raw = _fixture()
        self.assertIsNone(roads.map_edges(raw, poly[: len(poly) // 2]))   # half the road: not this line
        self.assertIsNone(roads.map_edges([], poly))
        self.assertIsNone(roads.map_edges(None, poly))


class SpeedTest(unittest.TestCase):
    d = roads.Driver()

    def test_the_tagged_limit_wins(self):
        e = _edge(0, 100, "primary", kmh=60, limit_kmh=72)        # Semoran Blvd, 45 mph
        self.assertAlmostEqual(roads.edge_mps(e, self.d), 72 / 3.6, places=3)

    def test_untagged_roads_clamp_into_their_class(self):
        slow = _edge(0, 100, "residential", kmh=12)
        fast = _edge(0, 100, "residential", kmh=90)
        self.assertAlmostEqual(roads.edge_mps(slow, self.d), 25 / 3.6, places=3)
        self.assertAlmostEqual(roads.edge_mps(fast, self.d), 40 / 3.6, places=3)

    def test_ramps_roundabouts_and_lots_are_slow(self):
        self.assertLessEqual(roads.edge_mps(_edge(0, 100, "motorway", kmh=105, use="ramp"), self.d), 60 / 3.6 + 1e-6)
        self.assertLessEqual(roads.edge_mps(_edge(0, 100, "primary", kmh=60, roundabout=True), self.d), 28 / 3.6 + 1e-6)
        self.assertLessEqual(roads.edge_mps(_edge(0, 100, "service_other", kmh=20, use="parking_aisle"), self.d),
                             roads.MIN_MPS + 1e-6)

    def test_never_over_the_cap(self):
        autoroute = _edge(0, 100, "motorway", kmh=130, limit_kmh=130)
        fast_driver = roads.Driver(pace_fast=1.10)
        self.assertEqual(roads.edge_mps(autoroute, fast_driver), roads.MAX_MPS)

    def test_a_short_slow_connector_doesnt_dip(self):
        edges = [_edge(0, 300, "primary", limit_kmh=72), _edge(300, 315, "residential", internal=True),
                 _edge(315, 600, "primary", limit_kmh=72)]
        spans = roads.speed_spans(edges, self.d)
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0][:2], (0, 600))

    def test_drivers_differ(self):
        a, b = roads.Driver.sample(random.Random(1)), roads.Driver.sample(random.Random(2))
        self.assertNotEqual(a, b)
        for d in (a, b):
            self.assertLess(d.accel, 2.0)              # under the validator's review line
            self.assertGreater(d.accel_at(0), d.accel_at(25))


class LightTest(unittest.TestCase):
    def setUp(self):
        self.poly, raw = _fixture()
        self.edges = roads.map_edges(raw, self.poly)
        self.cum = geo.cumulative(self.poly)

    def _plans(self, n=300):
        for seed in range(n):
            yield roads.plan(self.edges, self.poly, self.cum, roads.Driver(), random.Random(seed))[1]

    def test_a_dual_carriageway_gets_one_roll(self):
        # the fixture has signal pairs ~20 m apart (one per carriageway): never two light controls that close
        for controls in self._plans():
            lights = [c.s for c in controls if c.kind == "light"]
            for a, b in zip(lights, lights[1:]):
                self.assertGreaterEqual(b - a, roads.TURN_MERGE_M)

    def test_some_reds_some_greens(self):
        clusters = 0
        last = -1e9
        for e in self.edges[:-1]:
            if e.signal:
                if e.s1 - last >= roads.LIGHT_MERGE_M:
                    clusters += 1
                last = e.s1
        reds = [sum(1 for c in cs if c.kind == "light" and c.dwell_s > 0) for cs in self._plans()]
        mean = sum(reds) / len(reds)
        self.assertGreater(mean, 0.2 * clusters)
        self.assertLess(mean, 0.6 * clusters)
        self.assertGreater(max(reds), min(reds))      # it varies drive to drive

    def test_red_waits_are_believable(self):
        for controls in self._plans():
            for c in controls:
                if c.kind == "light" and c.dwell_s:
                    self.assertGreaterEqual(c.dwell_s, roads.ROLL_UNDER_S)
                    self.assertLessEqual(c.dwell_s, roads.LIGHT_SIDE[1])

    def test_same_seed_same_drive(self):
        a = roads.plan(self.edges, self.poly, self.cum, roads.Driver(), random.Random(7))
        b = roads.plan(self.edges, self.poly, self.cum, roads.Driver(), random.Random(7))
        self.assertEqual(a, b)

    def test_nothing_right_at_the_ends(self):
        total = self.cum[-1]
        for controls in self._plans(50):
            for c in controls:
                self.assertTrue(roads.EDGE_GAP_M <= c.s <= total - roads.EDGE_GAP_M)


class StopTest(unittest.TestCase):
    def _stop(self, e, nxt, seeds=200):
        return [roads._stop_for(e, nxt, e.s1, random.Random(s)) for s in range(seeds)]

    def test_side_street_onto_a_main_road_always_stops_or_rolls(self):
        e = _edge(0, 200, "residential", cross=["primary"])
        for c in self._stop(e, _edge(200, 400, "primary")):
            self.assertIsNotNone(c)
            self.assertTrue(c.dwell_s >= 1 or (c.v_cap and c.v_cap <= 3.0), c)

    def test_the_main_road_doesnt_stop_for_side_streets(self):
        e = _edge(0, 200, "primary", cross=["residential", "residential"])
        self.assertEqual(set(self._stop(e, _edge(200, 400, "primary"))), {None})

    def test_ramps_motorways_and_bends_never_stop(self):
        ramp = _edge(0, 200, "motorway", use="ramp", cross=["primary"])
        motorway = _edge(0, 200, "motorway", cross=["primary"])
        bend = _edge(0, 200, "residential")                     # nothing joins: not an intersection
        for e in (ramp, motorway, bend):
            self.assertEqual(set(self._stop(e, _edge(200, 400, "primary"))), {None})

    def test_pulling_out_of_a_lot_stops(self):
        lot = _edge(0, 80, "service_other", use="parking_aisle", cross=["tertiary"])
        for c in self._stop(lot, _edge(80, 400, "tertiary")):
            self.assertGreaterEqual(c.dwell_s, 2)

    def test_roundabout_entry_gives_way(self):
        e = _edge(0, 200, "tertiary", cross=["tertiary"])
        for c in self._stop(e, _edge(200, 260, "tertiary", roundabout=True)):
            self.assertTrue(c.dwell_s >= 1 or c.v_cap <= 5.0)

    def test_close_stops_merge(self):
        cs = [roads.Control(100, "stop", v_cap=5.0), roads.Control(110, "stop", dwell_s=2.0),
              roads.Control(300, "stop", v_cap=4.0)]
        merged = roads._merge_close(cs)
        self.assertEqual([(c.s, c.dwell_s) for c in merged], [(100, 2.0), (300, 0.0)])


class TurnTest(unittest.TestCase):
    def _turn(self, right, rhs=True):
        poly = _turning(right=right)
        cum = geo.cumulative(poly)
        corner = cum[len(_east(200.0)) - 1]
        edges = [_edge(0, corner, "residential", cross=["residential"], drive_on_right=rhs),
                 _edge(corner, cum[-1], "residential", drive_on_right=rhs)]
        turns = [c for c in roads._turns(edges, poly, cum, random.Random(3)) if c.kind == "turn"]
        self.assertEqual(len(turns), 1)
        self.assertAlmostEqual(turns[0].s, corner, delta=1)
        return turns[0]

    def test_a_right_turn_is_slow_and_tighter_than_a_left(self):
        right, left = self._turn(True), self._turn(False)
        self.assertIn("right", right.why)
        self.assertIn("left", left.why)
        self.assertLess(right.v_cap, 6.0)       # ~10 mph
        self.assertLess(right.v_cap, left.v_cap)

    def test_driving_on_the_left_flips_it(self):
        self.assertGreater(self._turn(True, rhs=False).v_cap, self._turn(False, rhs=False).v_cap)

    def test_a_straight_road_has_no_turns(self):
        poly = _east(400.0)
        cum = geo.cumulative(poly)
        edges = [_edge(0, 200, "residential", cross=["residential"]), _edge(200, cum[-1], "residential")]
        self.assertEqual(roads._turns(edges, poly, cum, random.Random(1)), [])


class SnapperRoadsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = mock.patch.object(snapper, "_CACHE_DIR", tmp.name)
        p.start()
        self.addCleanup(p.stop)

    def test_compact_keeps_what_roads_reads(self):
        raw = {"length": 0.065, "speed": 46, "road_class": "tertiary", "use": "road", "begin_heading": 269,
               "end_heading": 270, "traffic_signal": False, "drive_on_right": True,
               "end_node": {"traffic_signal": True, "stop_impact": 5,
                            "intersecting_edges": [{"driveability": "both", "road_class": "primary"},
                                                   {"driveability": "no", "road_class": "service_other"}]}}
        c = snapper._compact(raw)
        self.assertEqual(c["km"], 0.065)
        self.assertIsNone(c["limit"])          # no speed_limit key: untagged
        self.assertTrue(c["sig"])              # the end node's light counts
        self.assertEqual(c["cross"], ["primary"])
        self.assertEqual(c["impact"], 5)

    def test_cache_only_never_asks(self):
        with mock.patch.object(snapper, "_post", side_effect=AssertionError("network")):
            with self.assertRaises(snapper.RoadsUnavailable):
                snapper.road_edges(_east(300.0), network=False)

    def test_answers_are_cached_including_no_match(self):
        poly = _east(300.0)
        answer = {"edges": [{"length": 0.3, "speed": 30, "road_class": "residential"}], "matched_points": []}
        with mock.patch.object(snapper, "_post", return_value=answer) as post:
            first = snapper.road_edges(poly)
            again = snapper.road_edges(poly)
        self.assertEqual(post.call_count, 1)
        self.assertEqual(first, again)
        gap = {"edges": answer["edges"], "matched_points": [{"type": "matched", "begin_route_discontinuity": True}]}
        with mock.patch.object(snapper, "_post", return_value=gap) as post:
            self.assertIsNone(snapper.road_edges(_east(500.0)))
            self.assertIsNone(snapper.road_edges(_east(500.0)))
        self.assertEqual(post.call_count, 1)

    def test_a_network_failure_is_not_cached_and_backs_off(self):
        with mock.patch.object(snapper, "_post", side_effect=OSError("offline")) as post, \
                mock.patch.object(snapper, "_down_until", 0.0):
            for _ in range(3):
                with self.assertRaises(snapper.RoadsUnavailable):
                    snapper.road_edges(_east(300.0))
        self.assertEqual(post.call_count, 1)    # asked once, then backed off

    def test_steady_and_off_skip_roads(self):
        poly = _east(300.0)
        route = parse_route({"name": "t", "segments": [
            {"mode": "drive", "snap": True, "waypoints": [list(poly[0]), list(poly[-1])], "speed_mps": 15.6, "steady": True},
            {"mode": "drive", "snap": True, "waypoints": [list(poly[0]), list(poly[-1])]}]})
        with mock.patch.object(snapper, "snap_waypoints", return_value=poly), \
                mock.patch.object(snapper, "road_edges", return_value=[{"km": 0.3, "cls": "residential"}]) as re_:
            snapped, _ = snapper.snap_route(route)
            self.assertIsNone(snapped.segments[0].roads)           # steady: never asked
            self.assertEqual(len(snapped.segments[1].roads), 1)
            self.assertEqual(re_.call_count, 1)
            off, _ = snapper.snap_route(route, roads="off")
            self.assertIsNone(off.segments[1].roads)


if __name__ == "__main__":
    unittest.main()
