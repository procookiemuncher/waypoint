# Movement Engine — build plan & status (SWE)

> Implementation companion to **docs/MOVEMENT_ENGINE.md** (the design). That doc decides
> *what/why*; this one tracks *what's built* and in what order. The researcher owns the design
> doc; the SWE owns this one. Update the checkboxes as things land.

## Verify offline (no phone)

```
py tools/build_route.py data/routes/demo-drive.json
```
Loads a route → renders the trajectory → validates it → writes a cached GPX. This is the gate
that must pass before anything is played on the device.

## Environment

- **Offline core** (model/renderer/validator/build_route) is stdlib-only — run with any Python.
- **Device path** needs `pymobiledevice3` in a venv on **Python 3.12 or 3.13 — NOT 3.14** (two
  native deps, `lzfse` + `pylzss`, have no 3.14 wheels and need MSVC to build):
  `uv venv --python 3.12 && uv pip install -r requirements.txt`.
- **Apple Mobile Device Service** (usbmuxd) must be installed on Windows — via the **Apple
  Devices** app (Microsoft Store) or **iTunes** — or `usbmux list` fails with a socket error.
- Play a built route on the phone: `.venv\Scripts\python.exe tools\play_route.py <gpx>`.

## Build order

Each increment is independently verifiable **offline**. Phone-gated items are called out.

### Increment 1 — offline core  ✅ DONE (2026-07-08)
- [x] `backend/movement/model.py` — `route.json` schema → `Route`/`Segment`/`LocationFix`,
  loader + input validation, per-mode default speeds / speed ceilings / accel.
- [x] `backend/movement/renderer.py` — `RouteRenderer`: straight-line interpolation
  (no-network fallback), per-segment speed with accel/decel ramps into stops, bounded
  random-walk GPS jitter, GPX output.
- [x] `backend/movement/validator.py` — strictly-increasing time + per-mode / global speed
  ceilings (rejects impossible speeds & teleports before they reach the device).
- [x] `tools/build_route.py` — CLI: load → render → validate → write GPX.
- [x] `data/routes/demo-drive.json` — smoke-test route. Verified: 256 fixes, 5.0 min,
  max 14.6 m/s, validation OK.

### Increment 1.5 — research-backed realism  ✅ DONE (2026-07-08)
Folded docs/research/ findings into the core:
- [x] **Validator: two-tier** (errors reject / warnings review) + **acceleration gate** on a
  jitter-smoothed speed signal (reject >2.85 m/s², the #1 tell the speed-only check missed).
- [x] **Speed bands** retuned to Life360's numbers: teleport hard-fail >53.6 m/s (was 70),
  review >35.8, per-mode review caps.
- [x] **Renderer: jerk-limited S-curve ramps** (accel ≤~1.8, jerk ≤2 m/s³).
- [x] **Zero-speed dwell at every mode change** (no drive→walk velocity cliff).
- [x] **Walk speed** sampled ~N(1.34, 0.30); **perpendicular-biased jitter** (σ≈5 m default).
- [x] Negative tests: teleport + mid-track velocity step both rejected; clean ramp passes.

### Increment 2 — Valhalla road-snapping (build time)  🟡 GEOMETRY DONE (2026-07-08)
- [x] Snap each segment's waypoints to a road-following polyline via the FOSSGIS public
  Valhalla (`pedestrian`/`auto` costing per mode) *before* the renderer runs.
  `backend/movement/snapper.py` — `/route` + polyline6 decode (1e6), opt-in per segment via
  `"snap": true`. Wired into `tools/build_route.py` and `spoof.py` (`snap_route`).
- [x] Keep the straight-line path as the offline/no-network fallback (per-segment `SnapError`
  → keep hand-authored waypoints + warn).
- [x] Cache the snapped result (`build/snap-cache/<hash>.json`, keyed on waypoints+costing) so a
  build needs the network at most once per route edit.
- [ ] **Per-edge speed via `trace_attributes`** (the *timing* half) — NOT done. Geometry is
  snapped but timing still comes from the segment's `speed_mps` / renderer. Needed for
  auto-realistic per-road speeds.
- [x] **Corner-aware slowing** — known gap surfaced building `miami-drift`: at ~80 mph a 1 s
  step (~36 m) *cuts* sharp snapped-road turns, so measured speed dips→recovers and the accel
  gate flags it (real cars slow for turns; the renderer doesn't). Worked around for now by
  routing the fast preset on limited-access expressway (few sharp turns). Add a curvature/
  lateral-accel speed cap to the renderer so surface-street fast routes validate + look real. — DONE 2026-07-08: `plan_speeds()` in renderer.py (curvature limit + backward/forward pass); `miami-cruise` drives real streets at ~18 mph slowing for corners.

### Increment 3 — `play_route` (device)
- [ ] `LocationBackend.play_route(gpx_path, timing_noise_ms=0)` wrapping
  `simulate-location play --userspace <gpx> [noise_ms]` (shell out, like `spoof.py`; the
  full pmd3 Python-API adapter is M2, not needed for `play`).
- [ ] pmd3 types/errors stay quarantined below the interface (AGENTS.md ground rule #5).

### Increment 4 — the CDG arrival deliverable (phone-gated)
- [ ] Author the CDG final-approach route; play it after a (Phase-A-informed) gap; confirm
  Life360 fires the airport-arrival notification.
- [ ] Route presets: "Airport route" (CDG → hotel), "Full Ride".

## Blocked on Phase A on-device tests (need the phone + owner)

These can't be built until the two gates in MOVEMENT_ENGINE.md run:
- [ ] **Flight-gap branch** (A "hold, go silent, resume" vs. B "hold, then jump") — depends on
  whether iOS reverts to real GPS when we stop calling `set()`.
- [ ] **Activity-emoji features** — depend on whether Life360's walking/driving emoji is
  GPS-speed-derived (spoofable) or CoreMotion-derived (not).

## Coordination

Two agents (researcher + SWE) push to `main`. SWE **fetches + rebases before every push**.
To reduce collisions: SWE edits code + this file; researcher edits AGENTS/ROADMAP/design docs.
Both append to PROGRESS.md (newest on top) — resolve at rebase if we land together.
