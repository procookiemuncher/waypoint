"""Tests for core/tools/flight_test.py.

The flight test only matters if its coordinates actually satisfy Life360's gates, so these check
geometry against the same runway data and formula the app uses (a few hardcoded rows from the
decompiled runways.csv + a port of Runway.distanceFromMeters — the CSV itself is a third-party
binary and isn't committed), not just the order the calls happen in.
"""
import math
import os
import sys
import unittest
from unittest import mock

CORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CORE, "tools"))

import flight_test  # noqa: E402

MPH_100 = 44.704  # 100 mph in m/s


# A couple of rows from the APK's assets/runways.csv, to check the tool against the real data
# without committing the file. (airportCode, startLat, startLon, runwayN_m, runwayE_m, elevation_ft)
RUNWAYS = [
    ("MIA", 25.78610, -80.31484, 182.0, 3961.0, 1),
    ("MIA", 25.80290, -80.30154, 120.0, 2617.0, 1),
    ("MCO", 28.43561, -81.29588, -3056.0, 28.0, 28),
    ("MCO", 28.44833, -81.32231, -3669.0, 34.0, 28),
]


def dist_from_meters(rwy, lat, lon):
    """Independent re-implementation of Runway.distanceFromMeters (point to runway segment)."""
    _, slat, slon, north_m, east_m, _ = rwy
    cos_lon = math.cos(math.radians(lat)) * 111319.0
    length = math.hypot(east_m, north_m)
    dn = (lat - slat) * 111132.0
    de = (lon - slon) * cos_lon
    proj = (de * east_m + dn * north_m) / length
    if proj > length:
        dn -= north_m
        de -= east_m
    elif proj > 0:
        dn -= north_m * proj / length
        de -= east_m * proj / length
    return math.hypot(de, dn)


def nearest(airport, lat, lon):
    return min(dist_from_meters(r, lat, lon) for r in RUNWAYS if r[0] == airport)


class FakeCoreDevice:
    def __init__(self, events, sends_airplane=True):
        self.events = events
        self.sends_airplane = sends_airplane

    def hold(self, lat, lon, log):
        self.events.append(("hold", (round(lat, 5), round(lon, 5))))

    def route(self, route_file, log):
        self.events.append(("route", os.path.basename(route_file)))

    def airplane(self, on, log):
        self.events.append(("airplane", on))
        return self.sends_airplane

    def clear(self, log):
        self.events.append(("clear",))
        return True


class TestRunwayMath(unittest.TestCase):
    def test_distance_matches_independent_port(self):
        # flight_test.runway_distance should agree with the test's own port on a few points.
        for lat, lon in [(25.80, -80.30), (28.43, -81.30), (25.7861, -80.31484)]:
            self.assertAlmostEqual(
                flight_test.runway_distance(RUNWAYS[0], lat, lon),
                dist_from_meters(RUNWAYS[0], lat, lon), places=3)

    def test_runway_point_lands_on_the_centreline(self):
        for f in (0.0, 0.25, 0.5, 1.0):
            lat, lon = flight_test.runway_point(flight_test.MIA_RWY, f)
            self.assertLess(flight_test.runway_distance(flight_test.MIA_RWY, lat, lon), 1.0)


class TestGatesGeometry(unittest.TestCase):
    def test_mia_terminal_arms_the_candidate(self):
        # <=1000 m from a MIA runway so Life360 stores the nearby runway at the departure airport.
        self.assertLess(nearest("MIA", *flight_test.MIA_TERMINAL), 1000.0)

    def test_mco_landing_hold_clears_the_landing_gate(self):
        # <=1000 m from a MCO runway, or the landing never fires.
        self.assertLess(nearest("MCO", *flight_test.MCO_LANDING), 1000.0)

    def test_runways_far_enough_apart(self):
        # The app needs takeoff & landing runways >= 64,373.6 m apart.
        sep = flight_test.runway_distance(flight_test.MIA_RWY, *flight_test.MCO_RWY[1:3])
        self.assertGreaterEqual(sep, flight_test.SEP_MIN_M)


class TestTakeoffChunks(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.join(CORE, "build", "test_flight")
        self.chunks = flight_test.build_flight_chunks(quick=False, build_dir=self.tmp)
        self.by_name = {c["name"]: c for c in self.chunks}

    def test_files_written(self):
        for c in self.chunks:
            self.assertTrue(os.path.exists(c["file"]), c["name"])

    def test_takeoff_points_within_100m_of_runway(self):
        # Every on-runway leg's endpoints must be <=100 m from the MIA runway (the takeoff gate).
        for name in ("roll", "accel1", "accel2", "accel3", "rotate"):
            for lat, lon in self.by_name[name]["waypoints"]:
                self.assertLess(flight_test.runway_distance(flight_test.MIA_RWY, lat, lon), 100.0,
                                f"{name} point {lat},{lon}")

    def test_accel_legs_above_100mph(self):
        for name in ("accel1", "accel2", "accel3", "rotate"):
            self.assertGreaterEqual(self.by_name[name]["speed"], MPH_100, name)

    def test_acceleration_windows_exceed_half_mps2(self):
        # Consecutive high-speed steps must give accel > 0.5 m/s2 over the buffered (3-6 s) window.
        steps = ["accel1", "accel2", "accel3", "rotate"]
        for lo, hi in zip(steps, steps[1:]):
            a, b = self.by_name[lo], self.by_name[hi]
            accel = (b["speed"] - a["speed"]) / a["real_secs"]
            self.assertGreater(accel, 0.5, f"{lo}->{hi}")

    def test_each_leg_held_for_its_distance(self):
        # The real wait for a leg is at least distance/speed, so the next call can't teleport past it.
        for c in self.chunks:
            self.assertGreaterEqual(c["real_secs"] + 1e-9, c["dist"] / c["speed"])

    def test_quick_shrinks_the_wait_not_the_geometry(self):
        quick = flight_test.build_flight_chunks(quick=True, build_dir=self.tmp)
        for c in quick:
            self.assertLessEqual(c["secs"], flight_test.QUICK_SECS)
            self.assertGreater(c["dist"], 0)


class TestAirplanePrompt(unittest.TestCase):
    def test_confirmed_flip(self):
        events = []
        cd = FakeCoreDevice(events, sends_airplane=True)
        with mock.patch("flight_test._safe_input", return_value="y"), mock.patch("builtins.print"):
            self.assertTrue(flight_test.prompt_airplane(True, cd))
        self.assertEqual(events, [("airplane", True)])

    def test_unconfirmed_falls_back_to_manual(self):
        events = []
        cd = FakeCoreDevice(events, sends_airplane=True)
        prompts = []

        def fake_input(prompt=""):
            prompts.append(prompt)
            return "n" if len(prompts) == 1 else ""

        with mock.patch("flight_test._safe_input", fake_input), mock.patch("builtins.print"):
            self.assertTrue(flight_test.prompt_airplane(False, cd))
        self.assertEqual(events, [("airplane", False)])
        self.assertIn("by hand", prompts[1])

    def test_failed_send_falls_back_to_manual(self):
        events = []
        cd = FakeCoreDevice(events, sends_airplane=False)
        with mock.patch("flight_test._safe_input", return_value="") as _, mock.patch("builtins.print"):
            self.assertTrue(flight_test.prompt_airplane(True, cd))
        self.assertEqual(events, [("airplane", True)])


class TestRunFlightTest(unittest.TestCase):
    def test_full_sequence(self):
        events = []
        cd = FakeCoreDevice(events, sends_airplane=True)
        with mock.patch("flight_test._safe_input", return_value="y"), \
                mock.patch("flight_test.DRY_RUN", True), \
                mock.patch("flight_test.play_chunks", return_value=True) as played, \
                mock.patch("builtins.print"), mock.patch("time.sleep"):
            flight_test.run_flight_test(quick=True, cd=cd)
        self.assertTrue(played.called)
        kinds = [e[0] for e in events]
        self.assertEqual(kinds, ["hold", "airplane", "hold", "airplane", "clear"])
        self.assertEqual(events[0][1], (round(flight_test.MIA_TERMINAL[0], 5), round(flight_test.MIA_TERMINAL[1], 5)))
        self.assertEqual(events[1], ("airplane", True))
        self.assertEqual(events[2][1], (round(flight_test.MCO_LANDING[0], 5), round(flight_test.MCO_LANDING[1], 5)))
        self.assertEqual(events[3], ("airplane", False))
        self.assertEqual(events[-1], ("clear",))

    def test_interrupt_during_the_flight_turns_airplane_back_off(self):
        # Ctrl+C mid-flight (airplane ON, the offline legs playing): cleanup must toggle it OFF
        # and then clear — never leave the phone offline on a fake location.
        events = []
        cd = FakeCoreDevice(events, sends_airplane=True)
        with mock.patch("flight_test._safe_input", return_value="y"), \
                mock.patch("flight_test._wait_air", side_effect=KeyboardInterrupt), \
                mock.patch("flight_test.DRY_RUN", True), \
                mock.patch("flight_test.play_chunks", return_value=True), \
                mock.patch("builtins.print"), mock.patch("time.sleep"):
            with self.assertRaises(KeyboardInterrupt):
                flight_test.run_flight_test(quick=True, cd=cd)
        self.assertIn(("airplane", True), events)
        airplane_events = [e for e in events if e[0] == "airplane"]
        self.assertEqual(airplane_events[-1], ("airplane", False))
        self.assertEqual(events[-1], ("clear",))
        # never reached the MCO hold
        self.assertEqual([e for e in events if e[0] == "hold"], [events[0]])

    def test_flight_plays_offline_legs_after_takeoff(self):
        played = []
        events = []
        cd = FakeCoreDevice(events, sends_airplane=True)

        def fake_play(chunks, *a, **k):
            played.append([c["name"] for c in chunks])
            return True

        with mock.patch("flight_test._safe_input", return_value="y"), \
                mock.patch("flight_test.DRY_RUN", True), \
                mock.patch("flight_test.play_chunks", fake_play), \
                mock.patch("builtins.print"), mock.patch("time.sleep"):
            flight_test.run_flight_test(quick=True, cd=cd)
        self.assertEqual(len(played), 2)
        self.assertEqual(played[0][0], "taxi")
        self.assertEqual(played[1][0], "turnout")
        self.assertEqual(played[1][-1], "taxi_in")

    def test_interrupt_during_the_ON_confirm_still_cleans_up(self):
        # If Ctrl+C lands on the "is the airplane icon showing?" confirm (airplane already sent,
        # the KeyboardInterrupt _safe_input doesn't swallow), cleanup must still toggle it OFF and
        # clear — airplane_on is marked before the toggle for exactly this.
        events = []
        cd = FakeCoreDevice(events, sends_airplane=True)

        def fake_input(prompt=""):
            if "airplane icon" in prompt:   # the ON confirm
                raise KeyboardInterrupt
            return "y"

        with mock.patch("flight_test._safe_input", fake_input), \
                mock.patch("flight_test.DRY_RUN", True), \
                mock.patch("flight_test.play_chunks", return_value=True), \
                mock.patch("builtins.print"), mock.patch("time.sleep"):
            with self.assertRaises(KeyboardInterrupt):
                flight_test.run_flight_test(quick=True, cd=cd)
        self.assertIn(("airplane", True), events)
        airplane_events = [e for e in events if e[0] == "airplane"]
        self.assertEqual(airplane_events[-1], ("airplane", False))
        self.assertEqual(events[-1], ("clear",))


class TestAirChunks(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.mkdtemp()
        flight_test.build_flight_chunks(build_dir=self.tmp)
        self.chunks, self.cruise = flight_test.build_air_chunks(40, build_dir=self.tmp)

    def fixes(self):
        """Every waypoint with the speed it's flown at (the speed of the leg arriving there)."""
        for c in self.chunks:
            for p in c["waypoints"]:
                yield c["name"], p, c["speed"]

    def test_air_time_matches_the_request(self):
        mins = sum(c["real_secs"] for c in self.chunks) / 60
        self.assertAlmostEqual(mins, 40, delta=0.5)

    def test_cruise_speed_believable(self):
        self.assertGreaterEqual(self.cruise, 110)
        self.assertLessEqual(self.cruise, 240)
        _, fast = flight_test.build_air_chunks(10, build_dir=self.tmp)
        self.assertEqual(fast, flight_test.CRUISE_MAX)   # clamped, not 500 m/s

    def test_flight_starts_where_the_climb_ends_and_ends_at_the_hold(self):
        climb_end = flight_test.runway_point(flight_test.MIA_RWY, flight_test.TAKEOFF_LEGS[-1][2])
        self.assertEqual(self.chunks[0]["waypoints"][0], climb_end)
        self.assertEqual(self.chunks[-1]["waypoints"][-1], flight_test.MCO_LANDING)

    def test_no_leg_jumps(self):
        for c in self.chunks:
            for a, b in zip(c["waypoints"], c["waypoints"][1:]):
                self.assertLess(flight_test.haversine(a, b), 10000, c["name"])
        for x, y in zip(self.chunks, self.chunks[1:]):
            self.assertLess(flight_test.haversine(x["waypoints"][-1], y["waypoints"][0]), 1, y["name"])

    def test_landing_only_fires_on_the_roll_out(self):
        # A fix <=100 mph within 1000 m of an MCO runway is the landing. None before the brakes,
        # and at least one on the roll-out itself (not just the parked hold).
        slow_near = [n for n, (lat, lon), v in self.fixes()
                     if v <= MPH_100 and nearest("MCO", lat, lon) <= 1000]
        self.assertTrue(slow_near)
        self.assertEqual(slow_near[0], "brake2")

    def test_no_slow_fix_anywhere_else(self):
        # Away from MCO everything is >100 mph, so it can't land anywhere on the way.
        for n, (lat, lon), v in self.fixes():
            if nearest("MCO", lat, lon) > 1000:
                self.assertGreater(v, MPH_100, n)

    def test_quick_shrinks_only_the_wait(self):
        quick, _ = flight_test.build_air_chunks(40, quick=True, build_dir=self.tmp)
        self.assertTrue(all(c["secs"] == flight_test.QUICK_SECS for c in quick))
        self.assertEqual([c["dist"] for c in quick], [c["dist"] for c in self.chunks])


class TestGeofenceArrival(unittest.TestCase):
    def test_playback_and_clear(self):
        events = []
        cd = FakeCoreDevice(events)
        fake_chunks = [{"kind": "move", "file": "x", "speed": 18.0, "secs": 1.0},
                       {"kind": "stop", "at": flight_test.MCO_LANDING, "secs": 1.0}]
        with mock.patch("flight_test._safe_input", return_value=""), \
                mock.patch("flight_test.DRY_RUN", True), \
                mock.patch("flight_test.plan_chunks", return_value=("mco-geofence-arrival", fake_chunks)), \
                mock.patch("flight_test.write_chunks"), \
                mock.patch("flight_test.play_chunks", return_value=True) as played, \
                mock.patch("builtins.print"):
            flight_test.run_geofence_arrival(quick=True, cd=cd)
        self.assertTrue(played.called)
        self.assertIn(("clear",), events)


if __name__ == "__main__":
    unittest.main()
