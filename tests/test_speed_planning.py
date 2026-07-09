"""Unit tests for the corner-aware speed plan. Stdlib unittest, no device, no network."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.movement.renderer import plan_speeds, _haversine  # noqa: E402
from backend.movement.model import CORNER_MIN_SPEED_MPS  # noqa: E402

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


class TestPlanSpeeds(unittest.TestCase):
    def test_straight_line_holds_cruise(self):
        v = plan_speeds(_east(20), cruise=8.0, v_entry=8.0, v_exit=8.0)
        self.assertEqual(len(v), 20)
        for s in v:
            self.assertAlmostEqual(s, 8.0, places=6)

    def test_corner_dips_then_recovers(self):
        poly = _l_shape()
        v = plan_speeds(poly, cruise=8.0, v_entry=8.0, v_exit=8.0)
        self.assertEqual(len(v), len(poly))
        self.assertLess(min(v), 8.0)                       # it slowed for the corner
        self.assertGreaterEqual(min(v), CORNER_MIN_SPEED_MPS)  # but not below the floor
        self.assertAlmostEqual(v[0], 8.0, places=1)        # cruising on the straights
        self.assertAlmostEqual(v[-1], 8.0, places=1)

    def test_plan_is_accel_feasible(self):
        poly = _l_shape()
        v = plan_speeds(poly, cruise=8.0, v_entry=8.0, v_exit=8.0)
        a_lon = 1.8
        for i in range(1, len(poly)):
            d = _haversine(poly[i - 1], poly[i])
            if d <= 0:
                continue
            implied = abs(v[i] ** 2 - v[i - 1] ** 2) / (2 * d)  # |d(v^2)|/(2 ds) = |accel|
            self.assertLessEqual(implied, a_lon + 0.05)


if __name__ == "__main__":
    unittest.main()
