"""Unit tests for the speed plan: corners, ramps, stops mid-drive. Stdlib unittest, no device, no network."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unittest import mock  # noqa: E402

from backend.movement import Route, Segment, RouteRenderer, plan_piece, roads, validate  # noqa: E402
from backend.movement.model import RoadEdge  # noqa: E402
from backend.movement.validator import _smoothed_speeds  # noqa: E402

_LAT0 = 25.0
_M_PER_DEG = 111_111.0


def _east(n, spacing_m=10.0):
    """n points heading due east from (_LAT0, 0), `spacing_m` apart."""
    dlon = spacing_m / (_M_PER_DEG * math.cos(math.radians(_LAT0)))
    return [(_LAT0, i * dlon) for i in range(n)]


def _l_shape(arm=15, spacing_m=10.0):
    """A right-angle 'L': `arm` points east, then `arm` points north (sharp 90 deg elbow)."""
    dlon = spacing_m / (_M_PER_DEG * math.cos(math.radians(_LAT0)))
    dlat = spacing_m / _M_PER_DEG
    east = [(_LAT0, i * dlon) for i in range(arm)]
    corner_lon = (arm - 1) * dlon
    north = [(_LAT0 + j * dlat, corner_lon) for j in range(1, arm)]
    return east + north


class TestPlanPiece(unittest.TestCase):
    """The per-piece plan: brake before what's ahead, pull away no harder than the driver can."""
    A, B, STOP_B = 1.8, 1.8, 1.3

    def _plan(self, caps, v_in, v_out, step=5.0):
        ss = [i * step for i in range(len(caps))]
        return ss, plan_piece(ss, caps, v_in, v_out, lambda v: self.A, self.B, self.STOP_B)

    def test_straight_line_holds_cruise(self):
        _, v = self._plan([8.0] * 40, 8.0, 8.0)
        for s in v:
            self.assertAlmostEqual(s, 8.0, places=6)

    def test_a_dip_brakes_before_and_recovers_after(self):
        caps = [12.0] * 60
        caps[30] = 4.0                                       # a turn
        _, v = self._plan(caps, 12.0, 12.0)
        self.assertAlmostEqual(v[30], 4.0)
        self.assertLess(v[25], 12.0)                         # already braking 25 m before it
        self.assertAlmostEqual(v[0], 12.0)
        self.assertAlmostEqual(v[-1], 12.0)

    def test_rest_to_rest_is_feasible(self):
        ss, v = self._plan([14.0] * 100, 0.0, 0.0)
        self.assertEqual(v[0], 0.0)
        self.assertEqual(v[-1], 0.0)
        self.assertGreater(max(v), 13.0)
        for i in range(1, len(ss)):
            implied = (v[i] ** 2 - v[i - 1] ** 2) / (2 * (ss[i] - ss[i - 1]))   # d(v^2)/(2 ds) = accel
            self.assertLessEqual(implied, self.A + 1e-6)
            self.assertGreaterEqual(implied, -self.B - 1e-6)

    def test_speed_dependent_pull_away(self):
        d = roads.Driver()
        ss = [i * 5.0 for i in range(200)]
        v = plan_piece(ss, [30.0] * 200, 0.0, 30.0, d.accel_at, d.brake, d.stop_brake)
        gain_low = v[10] ** 2 - v[0] ** 2                    # first 50 m
        gain_high = v[110] ** 2 - v[100] ** 2                # 50 m at speed
        self.assertGreater(gain_low, gain_high * 1.3)        # pulls hardest from rest


class TestRenderWithPlan(unittest.TestCase):
    def _render(self, waypoints, cruise=8.0):
        seg = Segment(mode="drive", waypoints=waypoints, speed_mps=cruise)
        return RouteRenderer(seed=1).render(Route(name="t", segments=[seg]))

    def test_corner_route_validates_and_slows(self):
        fixes = self._render(_l_shape(arm=40))
        res = validate(fixes)
        self.assertTrue(res.ok, res.errors)                 # no accel/teleport hard-fails
        self.assertLessEqual(res.max_accel, 2.85)
        self.assertLess(res.max_smoothed_speed, 8.0 + 0.5)  # never exceeds cruise
        # the slowdown must happen AT the corner region, not just anywhere (e.g. end decel)
        speeds = _smoothed_speeds(fixes)
        corner = min(speeds[30:70])          # region around the 90-degree elbow
        cruising = max(speeds[5:25])         # first straight, away from start ramp
        self.assertLess(corner, 6.0)         # genuinely slowed FOR THE CORNER
        self.assertGreater(cruising, 7.0)    # and was cruising on the straight before it

    def test_fast_drive_comes_to_rest_before_a_stop(self):
        # short fast drives into a dwell used to arrive still rolling (the jerk-limited tracker
        # lags a full-accel braking plan) -> a velocity step into the stop, validator hard-fail
        for pts, spacing in ((8, 20.0), (40, 10.0), (15, 20.0)):
            segs = [Segment(mode="drive", waypoints=_east(pts, spacing), speed_mps=17.0 if pts != 15 else 24.0),
                    Segment(mode="stop", dwell_s=60)]
            res = validate(RouteRenderer(seed=1).render(Route(name="t", segments=segs)))
            self.assertTrue(res.ok, (pts, spacing, res.errors))
            self.assertLess(res.max_accel, 2.0)

    def test_straight_route_reaches_cruise(self):
        fixes = self._render(_east(60))
        res = validate(fixes)
        self.assertTrue(res.ok, res.errors)
        self.assertGreater(res.max_smoothed_speed, 7.0)     # got up to ~cruise on the straight


class TestStopsMidDrive(unittest.TestCase):
    """A red light / stop sign is a full stop inside a drive: arrive at rest, wait, pull away."""

    def _render(self, controls, cruise=15.0, meters=1500, seed=1):
        pts = _east(int(meters / 10) + 1)
        seg = Segment(mode="drive", waypoints=pts, speed_mps=cruise,
                      roads=[RoadEdge(s0=0.0, s1=meters, road_class="primary", limit_kmh=cruise * 3.6)])
        spans = [(0.0, meters + 10, cruise)]
        with mock.patch.object(roads, "plan", return_value=(spans, controls)):
            return RouteRenderer(seed=seed).render(Route(name="t", segments=[seg, Segment(mode="stop", dwell_s=60)]))

    def test_red_light_arrives_at_rest_and_waits(self):
        fixes = self._render([roads.Control(600.0, "light", dwell_s=30.0)])
        res = validate(fixes)
        self.assertTrue(res.ok, res.errors)
        self.assertLess(res.max_accel, 2.0)
        held = [f for f in fixes if f.hold]
        self.assertTrue(held)
        self.assertEqual({f.mode for f in held}, {"drive"})          # still driving, not parked
        first = fixes.index(held[0])
        arrive = fixes[first - 1]
        self.assertAlmostEqual(held[-1].t - arrive.t, 30.0, delta=0.01)
        before = fixes[first - 2]
        from backend.movement.geo import haversine
        self.assertLess(haversine((before.lat, before.lon), (arrive.lat, arrive.lon)), 2.5)   # crawled the last second
        for a, b in zip(fixes, fixes[1:]):
            self.assertGreater(b.t, a.t)

    def test_fast_road_with_stops_validates(self):
        for seed in range(5):
            fixes = self._render([roads.Control(400.0, "stop", dwell_s=2.0),
                                  roads.Control(900.0, "light", dwell_s=45.0),
                                  roads.Control(1200.0, "turn", v_cap=4.5)], cruise=24.0, seed=seed)
            res = validate(fixes)
            self.assertTrue(res.ok, res.errors)
            self.assertLess(res.max_accel, 2.0)
            self.assertEqual(sum(1 for a, b in zip(fixes, fixes[1:]) if b.hold and not a.hold), 2)

    def test_steady_ignores_the_roads(self):
        pts = _east(100)
        seg = Segment(mode="drive", waypoints=pts, speed_mps=15.6, steady=True,
                      roads=[RoadEdge(s0=0.0, s1=990.0, road_class="residential", signal=True)])
        with mock.patch.object(roads, "plan", side_effect=AssertionError("steady drives skip roads")):
            fixes = RouteRenderer(seed=1).render(Route(name="t", segments=[seg]))
        self.assertFalse(any(f.hold for f in fixes))
        self.assertGreater(max(_smoothed_speeds(fixes)), 15.0)


class TestUTurn(unittest.TestCase):
    def test_a_u_turn_is_a_crawl(self):
        out = _east(30)                                        # 290 m east...
        lat, lon = out[-1]
        dlat = 2.0 / _M_PER_DEG                                # ...a couple of meters across...
        back = [(lat + dlat, p[1]) for p in reversed(out)]     # ...and back west
        seg = Segment(mode="drive", waypoints=out + back, speed_mps=14.0)
        fixes = RouteRenderer(seed=2).render(Route(name="t", segments=[seg]))
        res = validate(fixes)
        self.assertTrue(res.ok, res.errors)
        self.assertEqual(res.warnings, [])
        from backend.movement.geo import haversine
        tip = min(range(len(fixes)), key=lambda i: haversine((fixes[i].lat, fixes[i].lon), (lat + dlat / 2, lon)))
        sp = _smoothed_speeds(fixes)
        self.assertLess(min(sp[tip - 3:tip + 4]), 4.0)
        self.assertGreater(max(sp), 12.0)


class TestRestToRestRamp(unittest.TestCase):
    """Regression: a sparse (2-waypoint) rest-to-rest drive leg must accelerate to cruise,
    not collapse to a crawl. Guards the densify fix."""

    def _render_leg(self, end_lon, cruise):
        seg = Segment(mode="drive", waypoints=[(25.0, 0.0), (25.0, end_lon)], speed_mps=cruise)
        return RouteRenderer(seed=1).render(Route(name="t", segments=[seg]))

    def test_two_waypoint_city_leg_reaches_cruise(self):
        fixes = self._render_leg(0.01, 8.0)          # ~1.0 km straight, 18 mph
        res = validate(fixes)
        self.assertTrue(res.ok, res.errors)
        self.assertGreater(res.max_smoothed_speed, 7.0)   # got up to ~cruise, not crawling

    def test_two_waypoint_fast_leg_reaches_cruise(self):
        fixes = self._render_leg(0.08, 35.7)         # ~8 km straight, 80 mph
        res = validate(fixes)
        self.assertTrue(res.ok, res.errors)
        self.assertGreater(res.max_smoothed_speed, 34.0)


if __name__ == "__main__":
    unittest.main()
