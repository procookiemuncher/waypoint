"""fly's airplane-mode steps: the toggle happens while a hold is running, and anything short of a
confirmed flip falls back to doing it by hand. No phone, everything faked."""
import os
import sys
import unittest
from unittest import mock

CORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CORE, "tools"))

import fly  # noqa: E402


class FakeJob:
    def __init__(self, events, at):
        self.events, self.at, self.running = events, at, True

    def stop(self):
        if self.running:
            self.events.append(("stop", self.at))
        self.running = False


class FakeCD:
    def __init__(self, events, sends=True):
        self.events, self.sends, self.holding = events, sends, None

    def airplane(self, on, log):
        self.events.append(("airplane", on, self.holding() if self.holding else None))
        return self.sends


class TestAirplaneStep(unittest.TestCase):
    def _run(self, sends, answers):
        asked = []

        def fake_input(prompt=""):
            asked.append(prompt)
            return answers.pop(0) if answers else ""
        with mock.patch("builtins.input", fake_input), mock.patch("builtins.print"):
            fly.airplane(True, FakeCD([], sends))
        return asked

    def test_confirmed_flip_needs_no_hand(self):
        asked = self._run(True, ["y"])
        self.assertEqual(len(asked), 1)
        self.assertIn("airplane icon", asked[0])

    def test_a_no_falls_back_to_by_hand(self):
        asked = self._run(True, ["n"])
        self.assertEqual(len(asked), 2)
        self.assertIn("by hand", asked[1])

    def test_just_enter_is_not_a_yes(self):
        asked = self._run(True, [""])
        self.assertIn("by hand", asked[-1])

    def test_failed_send_falls_back_to_by_hand(self):
        asked = self._run(False, [])
        self.assertEqual(len(asked), 1)
        self.assertIn("by hand", asked[0])


class TestDryRun(unittest.TestCase):
    def test_play_doesnt_touch_the_phone(self):
        with mock.patch.object(fly, "DRY_RUN", True), mock.patch.object(fly, "pmd") as pmd, \
                mock.patch("builtins.print"):
            fly.play("/x/mia-departure.gpx")
        pmd.assert_not_called()


class TestTrip(unittest.TestCase):
    TRIP = {"label": "test", "depart_route": "a", "depart_hold": (1.0, 2.0),
            "arrive_hold": (3.0, 4.0), "arrive_route": "b"}

    def _trip(self, fake_input):
        events, jobs = [], []
        cd = FakeCD(events)
        cd.holding = lambda: next((j.at for j in jobs if j.running), None)

        def fake_hold(lat, lon):
            events.append(("hold", (lat, lon)))
            jobs.append(FakeJob(events, (lat, lon)))
            return jobs[-1]
        with mock.patch.object(fly, "build_gpx", side_effect=lambda p: os.path.basename(p)), \
                mock.patch.object(fly, "ensure_mounted"), \
                mock.patch.object(fly, "play", side_effect=lambda gpx: events.append(("play", gpx))), \
                mock.patch.object(fly, "hold", side_effect=fake_hold), \
                mock.patch.object(fly, "CoreDevice", return_value=cd), \
                mock.patch("builtins.input", fake_input), mock.patch("builtins.print"):
            try:
                fly.run_trip(self.TRIP)
            except KeyboardInterrupt:
                pass
        return events, jobs

    def test_each_flip_happens_while_its_hold_runs(self):
        events, _ = self._trip(lambda prompt="": "y")
        self.assertEqual(events, [
            ("play", "a.json"),
            ("hold", (1.0, 2.0)),
            ("airplane", True, (1.0, 2.0)),      # still held at the departure airport
            ("stop", (1.0, 2.0)),
            ("hold", (3.0, 4.0)),
            ("airplane", False, (3.0, 4.0)),     # held at the arrival airport as it reconnects
            ("stop", (3.0, 4.0)),
            ("play", "b.json"),
        ])

    def test_ctrl_c_at_landing_lets_go_of_the_hold(self):
        def fake_input(prompt=""):
            if "land" in prompt:
                raise KeyboardInterrupt
            return "y"
        events, jobs = self._trip(fake_input)
        self.assertFalse(any(j.running for j in jobs))
        self.assertNotIn(("play", "b.json"), events)


if __name__ == "__main__":
    unittest.main()
