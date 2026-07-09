# Corner-aware speed realism — design spec

**Date:** 2026-07-08
**Status:** approved (brainstorm), pending implementation plan
**Owner area:** `backend/movement` (Core layer)

## Problem

On-device testing of the movement engine surfaced a realism gap in how Life360 reads a spoofed
drive:

- A **slow** spoof (~10 mph) → Life360 displayed a believable speed and a gliding pin.
- The **80 mph** `miami-drift` run → the pin **moved along the route**, but Life360 showed **no
  mph value at all**.

**Diagnosis (evidence-based, not verified inside Life360):** Life360 derives a member's speed from
the displacement between its own **sparse** location samples, and it **discards implausible
values**. At 80 mph the 1 Hz track jumps ~36 m/step and *cuts sharp snapped-road corners*, so the
displacement between two sparse Life360 samples yields a garbage speed → it shows nothing. At ~10
mph the motion is smooth and every sample-to-sample displacement looks like a real car → it shows
the speed.

**Therefore** the realism lever is not "more noise" — it is to keep **every sample-to-sample
displacement look like a real vehicle**: modest speed, smooth acceleration, and — the missing piece
— **slowing down for corners** instead of taking them at full speed.

This also retires a known bug: at speed, constant-velocity interpolation through a sharp snapped
turn cuts the corner and trips the validator's acceleration gate (logged in
`docs/BUILD_PLAN.md` Increment 2, "corner-aware slowing").

## Goal

Make a low-speed (10–20 mph) city drive read as **natural driving** in Life360: a smooth gliding
pin, a believable mph that rises and falls with the road, and a clean arrival. Scope is **movement
realism only** — not defeating a hidden spoof/"location inaccurate" flag (a separate, untested
concern; see `docs/research/life360-detection-and-realism.md`, Phase A #0
`isSimulatedBySoftware`).

**Non-goals (YAGNI for this work):**
- Per-road real speed limits via Valhalla `trace_attributes` (we intentionally cap at 10–20 mph, so
  real 35–45 mph arterial speeds would just be clamped away).
- Mid-route traffic-light / stop-sign stops.
- Play-timing noise (`simulate-location play <gpx> <noise_ms>`).

All three are easy to add later and are explicitly deferred.

## Approach (chosen: "drive like a human")

Add a **speed-planning pass** to the renderer that slows for corners and accelerates out of them,
capped at the segment's cruise speed. It slots between road-snapping and fix emission; nothing else
in the pipeline changes.

```
route.json → snap_route (dense road-following polyline)
           → plan_speeds(polyline, cruise, v_entry, v_exit)   ← NEW
           → integrate at 1 Hz following the plan (existing jerk-limited ramps + jitter)
           → validate → GPX → play
```

`plan_speeds` is a **pure function** (polyline + speeds in → per-vertex target speed out) — unit
testable with no device and no network.

### Algorithm — three steps

Given the dense polyline `P[0..n-1]`, a `cruise` speed, and entry/exit speeds:

1. **Corner speed limit per vertex.** For each interior vertex `P[i]`, estimate the turn radius
   `R[i]` of the circle through `P[i-1], P[i], P[i+1]` (circumscribed-circle radius
   `R = a·b·c / (4·area)`, with `a,b,c` the triangle side lengths from haversine distances). The
   safe cornering speed is:
   ```
   v_corner[i] = clamp( sqrt(CORNER_LAT_ACCEL * R[i]), CORNER_MIN_SPEED, cruise )
   ```
   - Straight / collinear road → `area ≈ 0` → `R → ∞` → `v_corner = cruise` (no slowing).
   - Sharp turn → small `R` → low `v_corner`, floored at `CORNER_MIN_SPEED` so hairpins crawl
     rather than stall.
   - Endpoints `v[0] = v_entry`, `v[n-1] = v_exit` (the renderer already decels to 0 into stops /
     mode changes; `plan_speeds` receives those as the boundary conditions).

2. **Backward pass** — spread braking out over the approach so the car is already slow *before* the
   turn, not braking *at* it. Iterate `i` from `n-2` down to `0`:
   ```
   v[i] = min( v[i], sqrt( v[i+1]^2 + 2 * A_LON * dist(P[i], P[i+1]) ) )
   ```

3. **Forward pass** — cap how quickly speed rises leaving a corner, and never exceed cruise.
   Iterate `i` from `1` to `n-1`:
   ```
   v[i] = min( v[i], sqrt( v[i-1]^2 + 2 * A_LON * dist(P[i-1], P[i]) ), cruise )
   ```

Output: a per-vertex speed plan `v[]` that dips smoothly into each turn and rises out, feasible
under longitudinal accel `A_LON`. Because the backward pass has already pushed the low corner speed
*upstream*, the plan's speed is falling on the approach — so an integrator that simply follows the
plan brakes *before* the corner.

### Renderer integration

`RouteRenderer._emit_move` currently integrates along the polyline arc length at 1 Hz toward a
scalar `v_cruise`, with jerk-limited acceleration and a single look-ahead for the final decel to
`v_exit`. Change: replace the scalar cruise target with the **planned speed sampled at the current
arc position** — i.e., build a `v_plan(d)` lookup (per-vertex `v[]` mapped onto cumulative arc
distance, linearly interpolated), and at each step ramp the current speed toward `v_plan(d)` under
the existing jerk limit. The final-decel look-ahead can be dropped (the plan's `v_exit` boundary +
backward pass already handle deceleration into the end), or kept as a floor — implementation
detail for the plan.

Walk segments run through the same path; at walk speed the corner limit rarely binds, so behavior
is effectively unchanged. Stop segments are untouched.

### Parameters (new constants in `backend/movement/model.py`)

| Constant | Value | Meaning |
|---|---|---|
| `CORNER_LAT_ACCEL_MPS2` | `3.5` | Lateral-acceleration budget for cornering (brisk-but-believable). |
| `CORNER_MIN_SPEED_MPS` | `2.0` | Floor speed through the tightest corners (no stall). |

Longitudinal accel/decel in the plan (`A_LON`) reuses the existing drive
`DEFAULT_ACCEL_MPS2["drive"] = 1.8` (and matching jerk `2.0`) so the plan stays followable by the
current integrator and keeps passing the validator.

## The route

`data/routes/miami-cruise.json` — a real **downtown-Miami street loop**, `"snap": true`, drive
cruise **~8 m/s (≈18 mph)**, ending in an arrival **stop dwell of ~2–3 min**. Now that speed is low,
surface streets validate cleanly, so the route genuinely winds through the city grid rather than
sticking to the expressway.

## Testing

**Offline (TDD, no device):**
- `plan_speeds` unit tests:
  - straight-line polyline → plan is constant `cruise` throughout.
  - a right-angle corner → speed dips at the corner and recovers after; the dip respects
    `CORNER_MIN_SPEED`.
  - feasibility: no step in the plan implies longitudinal accel above `A_LON` (within tolerance).
- Rendered `miami-cruise` route validates OK — `max_accel` under the hard-fail (2.85), speeds in
  the 10–20 mph band, monotonic time.
- Regression: `miami-drift` (expressway) still builds and validates.

**On-device (owner):** `spoof.cmd miami-cruise` → watch for a smooth gliding pin, a believable mph
that rises/falls with the road (corners slower, straights ~18 mph), and a clean arrival + dwell.

## Files touched

- `backend/movement/model.py` — two new constants.
- `backend/movement/renderer.py` — `plan_speeds()` + integrate-along-plan in `_emit_move`.
- `backend/movement/__init__.py` — export `plan_speeds` (for tests).
- `data/routes/miami-cruise.json` — new route.
- tests — `plan_speeds` + route validation (location per the implementation plan; repo has no test
  suite yet, so this establishes one).
- `docs/BUILD_PLAN.md` — tick the Increment 2 "corner-aware slowing" item.

## Risks / open questions

- **Radius estimate at near-collinear vertices** can be numerically unstable (tiny `area`). Guard
  with an epsilon → treat as straight (`v_corner = cruise`).
- **Snapped-vertex spacing** is uneven; the arc-distance interpolation of `v_plan(d)` must be robust
  to that (already how the renderer treats geometry).
- **`a_lat = 3.5` is a guess** at "believable"; exposed as a constant so on-device feedback can tune
  it without code changes.
- The Life360 speed-rejection diagnosis is **reasoned, not instrumented** — this route is the test.
  If a smooth ~18 mph drive *still* shows no mph, the next hypothesis is that iOS reports
  `CLLocation.speed = -1` for a DVT-set location and Life360's own sample cadence is the sole
  factor (→ tune duration / sampling, not cornering).
