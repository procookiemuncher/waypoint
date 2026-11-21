"""The no-Xcode path: CoreDevice location inputs, the helper process, lock state, the chunk
player and the connect-screen readiness. Stdlib unittest, no phone, no network."""
import json
import os
import plistlib
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import device  # noqa: E402
from backend.device import CoreDevice, Pmd3, cd_input, cd_launch_input, cd_point, cd_route_input, write_route_input  # noqa: E402
from backend.drive import chunk_cmd, chunk_timeline, play_chunks  # noqa: E402
from backend.session import Session  # noqa: E402


class TestInputs(unittest.TestCase):
    def test_point_is_floats(self):
        p = cd_point(48, 2)
        self.assertEqual(p, {"latitude": 48.0, "longitude": 2.0})
        self.assertIsInstance(p["latitude"], float)   # an int would go over XPC as int64

    def test_route_shape_matches_what_the_phone_took(self):
        inp = cd_route_input([(48.85837, 2.29448), {"latitude": 48.8562, "longitude": 2}], 13)
        self.assertEqual(inp, {
            "waypoints": [{"latitude": 48.85837, "longitude": 2.29448}, {"latitude": 48.8562, "longitude": 2.0}],
            "speed": 13.0,
            "pacing": {"interval": {"_0": 1.0}},
        })
        self.assertIsInstance(inp["speed"], float)
        self.assertIsInstance(inp["pacing"]["interval"]["_0"], float)

    def test_route_needs_two_points(self):
        with self.assertRaises(ValueError):
            cd_route_input([(1, 2)], 5)

    def test_cd_input_normalises_each_action(self):
        self.assertEqual(cd_input("set", {"latitude": 25, "longitude": -80}), {"latitude": 25.0, "longitude": -80.0})
        self.assertEqual(cd_input("clear", {"junk": 1}), {})
        self.assertEqual(cd_input("scenarios", {}), {})
        route = cd_input("route", {"waypoints": [[1, 2], [3, 4]], "speed": 9, "pacing": {"interval": {"_0": 2}}})
        self.assertEqual(route["pacing"], {"interval": {"_0": 2.0}})
        with self.assertRaises(ValueError):
            cd_input("teleport", {})

    def test_launch_input_carries_the_url_as_payload(self):
        url = "shortcuts://run-shortcut?name=vida-ping"
        inp = cd_launch_input("com.apple.shortcuts", url)
        self.assertEqual(inp["applicationSpecifier"], {"bundleIdentifier": {"_0": "com.apple.shortcuts"}})
        opts = inp["options"]
        self.assertEqual(opts["payloadURL"], {"relative": url})   # the shape the phone ran 2026-11-21
        self.assertTrue(opts["terminateExisting"])
        self.assertEqual(opts["user"], {"active": True})
        self.assertEqual(plistlib.loads(opts["platformSpecificOptions"]), {})
        self.assertEqual(cd_input("openurl", {"bundle": "com.apple.shortcuts", "url": url}), inp)

    def test_route_file_round_trips(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "r.json")
            write_route_input(path, [(25.78, -80.19), (25.79, -80.18)], 15.6)
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        self.assertEqual(cd_input("route", data), cd_route_input([(25.78, -80.19), (25.79, -80.18)], 15.6))


class TestHelperProcess(unittest.TestCase):
    def _child(self, *args):
        cmd = [sys.executable, "-c", device._CHILD, *args]
        return subprocess.run(cmd, capture_output=True, text=True, timeout=60)

    def test_selftest_loads_the_tunnel_code(self):
        p = self._child("selftest")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("coredevice helper ok", p.stdout)

    def test_bad_request_fails_cleanly_without_touching_the_phone(self):
        p = self._child("set", "{not json")
        self.assertEqual(p.returncode, 1)
        self.assertIn("coredevice set failed", p.stdout)

    def test_openurl_without_a_url_fails_cleanly(self):
        p = self._child("openurl", json.dumps({"bundle": "com.apple.shortcuts"}))
        self.assertEqual(p.returncode, 1)
        self.assertIn("coredevice openurl failed", p.stdout)

    def test_airplane_runs_the_matching_shortcut(self):
        sent = []
        with mock.patch.object(device, "DRY_RUN", False), \
                mock.patch.object(device, "run", side_effect=lambda cmd, log, timeout: sent.append(cmd) or True):
            self.assertTrue(CoreDevice().airplane(True, print))
            self.assertTrue(CoreDevice().airplane(False, print))
        self.assertEqual([c[3] for c in sent], ["openurl", "openurl"])
        self.assertEqual([json.loads(c[4]) for c in sent], [
            {"bundle": "com.apple.shortcuts", "url": "shortcuts://run-shortcut?name=vida-airplane-on"},
            {"bundle": "com.apple.shortcuts", "url": "shortcuts://run-shortcut?name=vida-airplane-off"},
        ])

    def test_negative_longitude_is_not_a_flag(self):
        cmd = CoreDevice().set_cmd(25.7617, -80.1918)
        self.assertEqual(json.loads(cmd[-1]), {"latitude": 25.7617, "longitude": -80.1918})

    def test_dry_run_commands_are_harmless_and_readable(self):
        with mock.patch.object(device, "DRY_RUN", True):
            cd = CoreDevice()
            for cmd, label in [(cd.set_cmd(1, 2), "coredevice set 1.00000 2.00000"),
                               (cd.route_cmd("/x/emoji.json"), "coredevice route emoji.json"),
                               (cd.clear_cmd(), "coredevice clear"),
                               (cd.open_url_cmd("shortcuts://run-shortcut?name=vida-airplane-on", "com.apple.shortcuts"),
                                "coredevice openurl shortcuts://run-shortcut?name=vida-airplane-on")]:
                self.assertNotIn(device._CHILD, cmd)
                p = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                self.assertEqual(p.stdout.strip(), "[dry run] " + label)


class TestLockState(unittest.TestCase):
    def _with(self, stdout="", stderr=""):
        done = subprocess.CompletedProcess([], 0, stdout, stderr)
        with mock.patch.object(device, "DRY_RUN", False), mock.patch.object(device.subprocess, "run", return_value=done):
            return Pmd3().lock_state("udid")

    def test_parses_lockdown_answers(self):
        self.assertEqual(self._with("true\n"), "locked")
        self.assertEqual(self._with("false\n"), "unlocked")
        self.assertEqual(self._with("False\n"), "unlocked")
        self.assertEqual(self._with("", "PasswordRequiredError: ..."), "locked")
        self.assertIsNone(self._with("", "NoDeviceConnectedError"))


class FakeCD:
    def __init__(self):
        self.calls = []

    def route_cmd(self, path):
        self.calls.append(("route", path))
        return [sys.executable, "-c", "pass"]

    def set_cmd(self, lat, lon):
        self.calls.append(("set", lat, lon))
        return [sys.executable, "-c", "pass"]


class TestChunks(unittest.TestCase):
    CHUNKS = [
        {"kind": "move", "waypoints": [(25.0, -80.0), (25.0, -79.9999)], "speed": 10.0, "secs": 0.05, "file": "/a.json"},
        {"kind": "stop", "at": (25.0, -79.9999), "secs": 0.05},
        {"kind": "move", "waypoints": [(25.0, -79.9999), (25.0001, -79.9999)], "speed": 10.0, "secs": 0.05, "file": "/b.json"},
    ]

    def test_chunk_cmd_routes_moves_and_holds_stops(self):
        cd = FakeCD()
        chunk_cmd(self.CHUNKS[0], cd)
        chunk_cmd(self.CHUNKS[1], cd)
        self.assertEqual(cd.calls, [("route", "/a.json"), ("set", 25.0, -79.9999)])

    def test_play_chunks_plays_all_in_order(self):
        cd, lines = FakeCD(), []
        self.assertTrue(play_chunks(self.CHUNKS, cd, threading.Event(), lines.append))
        self.assertEqual([c[0] for c in cd.calls], ["route", "set", "route"])
        self.assertEqual(len(lines), 3)

    def test_cancel_stops_before_the_next_call(self):
        cd, cancel = FakeCD(), threading.Event()
        cancel.set()
        self.assertTrue(play_chunks(self.CHUNKS, cd, cancel, lambda _: None))
        self.assertEqual(cd.calls, [])

    def test_refused_chunk_reports_false(self):
        class Refusing(FakeCD):
            def route_cmd(self, path):
                return [sys.executable, "-c", "print('coredevice route failed: nope'); raise SystemExit(1)"]
        lines = []
        self.assertFalse(play_chunks(self.CHUNKS, Refusing(), threading.Event(), lines.append))
        self.assertIn("coredevice route failed: nope", lines)

    def test_timeline_holds_still_through_a_stop(self):
        tl = chunk_timeline(self.CHUNKS)
        self.assertEqual(tl[0][0], 0.0)
        stop = [p for p in tl if p[1:] == [25.0, -79.9999]]
        self.assertGreaterEqual(len(stop), 2)
        self.assertTrue(all(b[0] >= a[0] for a, b in zip(tl, tl[1:])))


class FakePmd3:
    def __init__(self):
        self.lock, self.mount_says, self.mounts = "unlocked", ("ready", ""), 0

    def list_devices(self):
        return [{"name": "Test", "udid": "u1", "ios": "27.0.1", "connection": "USB"}]

    def lock_state(self, udid=None):
        return self.lock

    def mount(self, log):
        self.mounts += 1
        return self.mount_says

    def clear(self, log):
        return True


class TestReadiness(unittest.TestCase):
    def setUp(self):
        self.s = Session()
        self.fake = self.s.pmd3 = FakePmd3()
        self.s.devices()   # first look happens straight away

    def test_locked_phone_says_locked_and_doesnt_mount(self):
        self.fake.lock = "locked"
        self.s._probe()
        self.assertEqual(self.s.readiness, ("locked", "unlock your iPhone"))
        self.assertEqual(self.fake.mounts, 0)

    def test_unlocked_mounts_once_then_stays_ready(self):
        self.s._probe()
        self.s._probe()
        self.assertEqual(self.s.readiness[0], "ready")
        self.assertEqual(self.fake.mounts, 1)

    def test_relock_after_ready_is_noticed(self):
        self.s._probe()
        self.fake.lock = "locked"
        self.s._probe()
        self.assertEqual(self.s.readiness[0], "locked")
        self.fake.lock = "unlocked"
        self.s._probe()
        self.assertEqual(self.s.readiness[0], "ready")
        self.assertEqual(self.fake.mounts, 1)   # the DDI stayed on, no second mount

    def test_unknown_lock_lets_the_mount_explain(self):
        self.fake.lock, self.fake.mount_says = None, ("error", "turn on Developer Mode (Settings → Privacy & Security)")
        self.s._probe()
        self.assertEqual(self.s.readiness[0], "error")
        self.assertIn("Developer Mode", self.s.readiness[1])

    def test_no_mount_while_an_action_holds_the_lock(self):
        with self.s.lock:
            self.s._probe()
        self.assertEqual(self.fake.mounts, 0)

    def test_drive_is_registered_everywhere(self):
        self.assertIn("drive", self.s.engines)
        self.assertIn("coredevice", self.s.services)


if __name__ == "__main__":
    unittest.main()
