# Corner-aware Speed Realism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a low-speed city drive slow for corners and accelerate out of them, so Life360 reads it as natural driving and shows a believable speed.

**Architecture:** A pure `plan_speeds()` function computes a per-vertex speed ceiling from road curvature, then smooths it with a backward pass (brake *before* corners) and a forward pass (accelerate out, capped at cruise). The renderer's per-second integrator follows this speed plan instead of a flat cruise value. Slots between road-snapping and fix emission; nothing else in the pipeline changes.

**Tech Stack:** Python 3.12/3.13, stdlib only for the movement core (`math`, `random`, `unittest`). No new dependencies. Road-snapping (existing `snapper.py`) uses the network at build time only.

## Global Constraints

- **Movement core stays stdlib-only** — no new third-party deps in `backend/movement/`. Tests use `unittest`, not pytest.
- **Validator is the gate:** rendered trajectories must pass `validate()` — acceleration hard-fail `> 2.85 m/s²`, teleport hard-fail `> 53.6 m/s`, strictly-increasing time.
- **No pymobiledevice3 imports** in `backend/movement/` (transport stays below the `LocationBackend` interface).
- **Commit style:** human-authored voice, no AI attribution / co-author trailer (see AGENTS.md).
- New constants live in `backend/movement/model.py` with the other tuned constants.
- `plan_speeds` signature (relied on by every task): `plan_speeds(polyline: list[tuple[float, float]], cruise: float, v_entry: float, v_exit: float) -> list[float]`, returning one speed per polyline vertex.

---

### Task 1: `plan_speeds` — the curvature speed plan (pure function)

**Files:**
- Modify: `backend/movement/model.py` (add two constants)
- Modify: `backend/movement/renderer.py` (add `plan_speeds` + helpers)
- Modify: `backend/movement/__init__.py` (export `plan_speeds`)
- Create: `tests/test_speed_planning.py`

**Interfaces:**
- Consumes: `_haversine`, `_bracket`, `_M_PER_DEG`, `DEFAULT_ACCEL_MPS2` (already in `renderer.py` / `model.py`).
- Produces: `plan_speeds(polyline, cruise, v_entry, v_exit) -> list[float]` (len == len(polyline)); helpers `_local_xy`, `_corner_speed`, `_plan_at`.

- [ ] **Step 1: Add the two constants to `model.py`**

In `backend/movement/model.py`, after the `DEFAULT_JERK_MPS3` block (the "Motion smoothness" section), add:

```python
# --- Cornering (slow for turns like a real car) ---------------------------------
# Lateral-acceleration budget when cornering: v_corner = sqrt(CORNER_LAT_ACCEL * radius).
# 3.5 m/s^2 is brisk-but-believable street driving; exposed here so on-device feedback can tune
# it without touching code. Floor keeps the tightest hairpins crawling rather than stalling.
CORNER_LAT_ACCEL_MPS2 = 3.5
CORNER_MIN_SPEED_MPS = 2.0
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_speed_planning.py`:

```python
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `py tests/test_speed_planning.py -v`
Expected: FAIL — `ImportError: cannot import name 'plan_speeds'`.

- [ ] **Step 4: Implement `plan_speeds` and helpers in `renderer.py`**

In `backend/movement/renderer.py`, update the import from `.model` to add the two constants:

```python
from .model import (
    Route, LocationFix, WALK, STOP,
    DEFAULT_SPEED_MPS, DEFAULT_ACCEL_MPS2, DEFAULT_JERK_MPS3, DEFAULT_JITTER_M,
    WALK_SPEED_MEAN_MPS, WALK_SPEED_STD_MPS, WALK_SPEED_CLAMP,
    CORNER_LAT_ACCEL_MPS2, CORNER_MIN_SPEED_MPS,
)
```

Then add these module-level functions after `_heading_at` (before `class RouteRenderer`):

```python
def _local_xy(origin, p):
    """Meters (east, north) of point p relative to origin — equirectangular, fine at city scale."""
    de = (p[1] - origin[1]) * _M_PER_DEG * math.cos(math.radians(origin[0]))
    dn = (p[0] - origin[0]) * _M_PER_DEG
    return de, dn


def _corner_speed(a, b, c, cruise):
    """Safe speed through vertex b given neighbors a and c: sqrt(a_lat * R), where R is the
    Menger radius of the circle through a, b, c. Collinear -> R=inf -> full cruise."""
    ax, ay = _local_xy(b, a)
    cx, cy = _local_xy(b, c)
    dab = math.hypot(ax, ay)
    dcb = math.hypot(cx, cy)
    dac = math.hypot(ax - cx, ay - cy)
    area2 = abs(ax * cy - ay * cx)          # twice the triangle area (b at the origin)
    if area2 < 1e-6 or dab < 1e-6 or dcb < 1e-6:
        return cruise
    radius = (dab * dcb * dac) / (2.0 * area2)   # (|ab||bc||ca|) / (4*area); 4*area == 2*area2
    v = math.sqrt(CORNER_LAT_ACCEL_MPS2 * radius)
    return max(CORNER_MIN_SPEED_MPS, min(cruise, v))


def plan_speeds(polyline, cruise, v_entry, v_exit):
    """Per-vertex target speed that slows for corners and is feasible under longitudinal accel.
    (1) corner speed limit per interior vertex, (2) backward pass to brake *before* corners,
    (3) forward pass to cap acceleration out of them and hold cruise. See
    docs/superpowers/specs/2026-07-08-corner-aware-speed-realism-design.md."""
    n = len(polyline)
    if n == 0:
        return []
    if n == 1:
        return [min(cruise, max(v_entry, v_exit))]

    gap = [0.0] * n
    for i in range(1, n):
        gap[i] = _haversine(polyline[i - 1], polyline[i])   # distance from vertex i-1 to i

    v = [cruise] * n
    for i in range(1, n - 1):
        v[i] = _corner_speed(polyline[i - 1], polyline[i], polyline[i + 1], cruise)
    v[0] = min(v[0], v_entry)
    v[-1] = min(v[-1], v_exit)

    a_lon = DEFAULT_ACCEL_MPS2["drive"]
    for i in range(n - 2, -1, -1):                          # backward: decel into what's ahead
        v[i] = min(v[i], math.sqrt(v[i + 1] ** 2 + 2 * a_lon * gap[i + 1]))
    for i in range(1, n):                                   # forward: accel out, cap at cruise
        v[i] = min(v[i], math.sqrt(v[i - 1] ** 2 + 2 * a_lon * gap[i]), cruise)
    return v


def _plan_at(cum, vplan, d):
    """Planned speed at arc distance d along the polyline (linear between vertices)."""
    if d <= 0:
        return vplan[0]
    if d >= cum[-1]:
        return vplan[-1]
    i = _bracket(cum, d)
    d0, d1 = cum[i - 1], cum[i]
    f = (d - d0) / (d1 - d0) if d1 > d0 else 0.0
    return vplan[i - 1] + f * (vplan[i] - vplan[i - 1])
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `py tests/test_speed_planning.py -v`
Expected: PASS (3 tests: straight/corner/feasible).

- [ ] **Step 6: Export `plan_speeds` from the package**

In `backend/movement/__init__.py`, add `plan_speeds` to the renderer import and `__all__`:

```python
from .renderer import RouteRenderer, plan_speeds
```
and add `"plan_speeds"` to the `__all__` list.

- [ ] **Step 7: Commit**

```bash
git add backend/movement/model.py backend/movement/renderer.py backend/movement/__init__.py tests/test_speed_planning.py
git commit -m "Add curvature-based speed planning (slow for corners)"
```

---

### Task 2: Wire the plan into the renderer's integrator

**Files:**
- Modify: `backend/movement/renderer.py` (`RouteRenderer._emit_move`)
- Modify: `tests/test_speed_planning.py` (add render+validate tests)

**Interfaces:**
- Consumes: `plan_speeds`, `_plan_at` (Task 1).
- Produces: no new public API — `RouteRenderer.render()` now produces corner-slowed trajectories.

- [ ] **Step 1: Write the failing render tests**

Append to `tests/test_speed_planning.py` (after the existing class), and add these imports at the top (next to the existing imports):

```python
from backend.movement import Route, Segment, RouteRenderer, validate  # noqa: E402
from backend.movement.validator import _smoothed_speeds  # noqa: E402
```

```python
class TestRenderWithPlan(unittest.TestCase):
    def _render(self, waypoints, cruise=8.0):
        seg = Segment(mode="drive", waypoints=waypoints, speed_mps=cruise)
        return RouteRenderer(seed=1).render(Route(name="t", segments=[seg]))

    def test_corner_route_validates_and_slows(self):
        fixes = self._render(_l_shape())
        res = validate(fixes)
        self.assertTrue(res.ok, res.errors)                 # no accel/teleport hard-fails
        self.assertLessEqual(res.max_accel, 2.85)
        self.assertLess(res.max_smoothed_speed, 8.0 + 0.5)  # never exceeds cruise
        # it actually slowed somewhere in the middle (the corner), below the straight cruise
        speeds = _smoothed_speeds(fixes)
        self.assertLess(min(speeds), 7.0)

    def test_straight_route_reaches_cruise(self):
        fixes = self._render(_east(60))
        res = validate(fixes)
        self.assertTrue(res.ok, res.errors)
        self.assertGreater(res.max_smoothed_speed, 7.0)     # got up to ~cruise on the straight
```

- [ ] **Step 2: Run the tests to verify the corner test fails**

Run: `py tests/test_speed_planning.py -v`
Expected: `test_corner_route_validates_and_slows` FAILS — the current integrator drives the corner at full cruise, so `min(mid)` is not below 7.0 (and `max_accel` may exceed 2.85 from the corner-cut). The straight test may already pass.

- [ ] **Step 3: Update `_emit_move` to follow the plan**

In `backend/movement/renderer.py`, inside `RouteRenderer._emit_move`, after `jerk = DEFAULT_JERK_MPS3...` compute the plan:

```python
        max_a = DEFAULT_ACCEL_MPS2.get(seg.mode, DEFAULT_ACCEL_MPS2["drive"])
        jerk = DEFAULT_JERK_MPS3.get(seg.mode, DEFAULT_JERK_MPS3["drive"])
        vplan = plan_speeds(poly, v_cruise, v_entry, v_exit)
```

Then replace the speed-target block inside the `while True:` loop. Replace this existing code:

```python
            remaining = total - d
            # distance to bleed v down to v_exit at peak decel, + a margin for the jerk ramp
            decel_dist = max(0.0, (v * v - v_exit * v_exit) / (2 * max_a)) + v * (max_a / jerk)
            if remaining <= decel_dist:
                a_des = -max_a
            elif v < v_cruise - 1e-6:
                a_des = max_a
            else:
                a_des = 0.0
```

with:

```python
            remaining = total - d
            # follow the pre-planned speed at this arc position: the backward pass already
            # lowered it on the approach to every corner, so tracking it brakes *before* turns.
            v_target = _plan_at(cum, vplan, d)
            if v < v_target - 1e-6:
                a_des = max_a
            elif v > v_target + 1e-6:
                a_des = -max_a
            else:
                a_des = 0.0
```

Leave the rest of the loop (the jerk-limit line, `v = max(0.0, min(v_cruise, v + a * _DT))`, the crawl floor, `d` update, guard) unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `py tests/test_speed_planning.py -v`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/movement/renderer.py tests/test_speed_planning.py
git commit -m "Have the renderer follow the corner-aware speed plan"
```

---

### Task 3: The `miami-cruise` route + verification + docs

**Files:**
- Create: `data/routes/miami-cruise.json`
- Modify: `docs/BUILD_PLAN.md` (tick the corner-aware-slowing item)

**Interfaces:**
- Consumes: the full build pipeline (`load_route` → `snap_route` → `RouteRenderer` → `validate`), unchanged.
- Produces: a playable route + a validated `build/miami-cruise.gpx`.

- [ ] **Step 1: Create the route**

Create `data/routes/miami-cruise.json`:

```json
{
  "name": "miami-cruise",
  "description": "Relaxed ~18 mph cruise through the downtown-Miami street grid (Valhalla-snapped to real roads), slowing for each corner like a real car, then arriving and parking for a few minutes. Built to read as natural driving in Life360 - believable speed, smooth gliding pin, clean arrival.",
  "segments": [
    {
      "mode": "drive",
      "speed_mps": 8.0,
      "snap": true,
      "waypoints": [
        [25.76490, -80.19180],
        [25.77400, -80.19000],
        [25.78050, -80.19600],
        [25.78300, -80.20600]
      ]
    },
    {
      "mode": "stop",
      "dwell_s": 150
    }
  ]
}
```

- [ ] **Step 2: Build it and verify it validates (needs network for snapping)**

Run: `.venv\Scripts\python.exe tools\build_route.py data\routes\miami-cruise.json --out build\miami-cruise.gpx`

Expected output: `validation: OK` (warnings allowed), a duration in the ~5-9 min range, and `max speed` reported around `8 m/s` / `~29 km/h` (≈18 mph), NOT above it. If snapping printed a `! ... snapping failed` warning, the FOSSGIS server was unreachable — re-run once; the straight-line fallback still validates but won't follow streets.

- [ ] **Step 3: Confirm corners actually slowed the pin (spot check)**

Run:
```bash
.venv\Scripts\python.exe -c "from backend.movement import load_route, snap_route, RouteRenderer, validate; r=load_route('data/routes/miami-cruise.json'); r,_=snap_route(r); f=RouteRenderer().render(r); from backend.movement.validator import _smoothed_speeds; s=_smoothed_speeds(f); print('min %.1f max %.1f mps  (cruise 8.0)'%(min(x for x in s if x>0), max(s)))"
```
Expected: `max` near `8.0` and `min` clearly below it (the corners) — evidence the plan is slowing turns, not driving them flat.

- [ ] **Step 4: Tick the BUILD_PLAN item**

In `docs/BUILD_PLAN.md`, change the Increment 2 line
`- [ ] **Corner-aware slowing** — known gap surfaced building \`miami-drift\`:`
to `- [x]` and append: ` — DONE 2026-07-08: \`plan_speeds()\` in renderer.py (curvature limit + backward/forward pass); \`miami-cruise\` drives real streets at ~18 mph slowing for corners.`

- [ ] **Step 5: Commit**

```bash
git add data/routes/miami-cruise.json docs/BUILD_PLAN.md
git commit -m "Add the miami-cruise street route and mark corner-slowing done"
```

- [ ] **Step 6: On-device test (owner, manual — not blocking)**

Run `spoof.cmd miami-cruise` with the phone unlocked + Developer Mode on. Watch Life360 for: a smooth gliding pin, a believable mph that dips on corners and rises on straights (~18 mph), and a clean arrival + park. Report back what the mph reads — that confirms or refutes the speed-rejection diagnosis in the spec.

---

## Self-Review

**Spec coverage:**
- Curvature corner limit → Task 1 `_corner_speed`. ✓
- Backward/forward smoothing passes → Task 1 `plan_speeds`. ✓
- Renderer follows the plan → Task 2. ✓
- Two new constants (`CORNER_LAT_ACCEL_MPS2=3.5`, `CORNER_MIN_SPEED_MPS=2.0`) → Task 1 Step 1. ✓
- `A_LON` reuses drive `1.8` → Task 1 `plan_speeds` (`a_lon = DEFAULT_ACCEL_MPS2["drive"]`). ✓
- `miami-cruise.json`, ~18 mph, arrival dwell → Task 3. ✓
- Offline tests: straight=cruise, corner dip+recover+floor, feasibility, route validates, regression (straight reaches cruise) → Tasks 1-2. ✓
- On-device test → Task 3 Step 6. ✓
- BUILD_PLAN tick → Task 3 Step 4. ✓

**Placeholder scan:** none — every code and command step is complete.

**Type consistency:** `plan_speeds(polyline, cruise, v_entry, v_exit) -> list[float]` used identically in Task 1 (definition + tests) and Task 2 (`vplan = plan_speeds(poly, v_cruise, v_entry, v_exit)`). `_plan_at(cum, vplan, d)` defined in Task 1, used in Task 2. `_smoothed_speeds` referenced from `backend.movement.validator` (exists). Constants named identically across model.py, renderer.py import, and tests.

**Note on the miami-drift regression:** it can't be a unit test (needs the network for snapping). It's covered implicitly — `plan_speeds` caps at `cruise`, and at drive cruise on a gentle expressway the corner limit rarely binds, so behavior is unchanged. The owner can re-run `spoof.cmd miami-drift` if desired; not a blocking step.
