# PROGRESS LOG

Append-only dev log. **Newest entry on top.** After any work session, add an entry:
what changed, what was decided, what broke, what's next.

**This is the first thing to read after a memory/context reset.**

---

## 2026-07-08 — On-device: Paris/no-VPN confirmed · stutter is downstream, not the engine · flight-push manual-toggle idea

**Three findings from the owner's testing.**

**1. IP geolocation is NOT enforced — Paris spoof worked with NO VPN (CONFIRMED).** Owner spoofed
Paris from the normal Miami connection and Life360 showed Paris. So Life360 trusts the spoofed GPS
over the connection's IP city; no VPN needed. Retired the "IP is the one silent server-side tell"
worry in AGENTS.md (ground rule #3).

**2. The `miami-cruise` "stutter" is NOT the movement engine.** Owner reports the pin moves, then
freezes ~3 s, then moves — jerky, and suspects it blocks the driving (car) icon. Debugged the
engine output: the built GPX is a clean, regular **1 Hz** track during driving (684 one-second gaps;
the only 5 s gaps are the final parked dwell) with smooth per-step distances (0.3→8 m ramp, no
jumps). So the engine emits smooth motion — the stutter is introduced **downstream at the
device/observer layer**. Two candidates, not yet distinguished (needs an on-device measurement I
can't take from here):
  - **(likely) Life360's own pin-refresh cadence** — it does not render other members at 1 Hz; a
    few-seconds stepped update is normal for viewing someone else. Not fixable in the engine.
  - **(possible) userspace-tunnel `set()` latency** — if each `set()` round-trip is slow, the
    effective on-device update rate lags the 1 Hz GPX.
  **Distinguishing test for the owner:** (a) does `miami-cruise` playback take ~14 min (≈ the GPX
  duration → transport keeps up → it's Life360's refresh) or much longer (→ tunnel latency)? and
  (b) does **Find My** update smoothly while **Life360** steps (→ Life360 refresh), or do both step
  (→ transport)? No engine fix until this says which layer. **Bottom line: the movement engine's
  output is correct/smooth; this is a rendering/transport artifact.**

**3. Flight "landed" push — owner's manual airplane-mode idea added as an untested experiment.**
Confirmed the geofence "arrived at CDG" substitute + the flight-detection mechanism are already
documented (docs/research/life360-notification-triggers.md). The doc had marked the literal flight
push NO partly because "can't toggle airplane mode from the PC" — but the owner would toggle it **by
hand**, which overcomes that (and forces the post-landing reconnect). Added the owner's sequence
(spoof MIA → dwell → manual airplane-mode ON → teleport to CDG → manual airplane-mode OFF) to the
doc as **open gate `flight-push-manual-toggle`**; only the altitude/barometer requirement remains
unknown. Verdict stays NO-until-tried; geofence arrival is the reliable fallback.

**Next:** owner runs the stutter distinguishing test (duration + Find My vs Life360) so we fix the
right layer; the movement engine itself needs no change for smoothness.

---

## 2026-07-08 — Corner-aware speed realism (slow for turns) + miami-cruise street route

**Why:** the 80 mph `miami-drift` run moved the pin but Life360 showed **no mph** (an earlier slow
spoof showed ~10 mph). Diagnosis: Life360 derives speed from displacement between its own sparse
samples and **rejects implausible values** — a fast, corner-cutting track yields garbage speed. So
the realism lever is a *slow, smooth* drive that **slows for corners** like a real car. Owner wants
a believable 10-20 mph city drive that reads as natural driving. Full design + plan in
`docs/superpowers/specs/2026-07-08-corner-aware-speed-realism-design.md` and
`docs/superpowers/plans/2026-07-08-corner-aware-speed-realism.md`.

**Built (Increment 2 corner-aware slowing — DONE):**
- `plan_speeds()` in `backend/movement/renderer.py` — per-vertex speed plan from road curvature
  (Menger-radius cornering limit `v=sqrt(3.5·R)`), then a **backward pass** (brake *before* the
  corner) and **forward pass** (accelerate out, cap at cruise). Two new constants in `model.py`
  (`CORNER_LAT_ACCEL_MPS2=3.5`, `CORNER_MIN_SPEED_MPS=2.0`).
- The renderer's 1 Hz integrator now **follows the plan** instead of a flat cruise — slows into
  turns, speeds up on straights, still jerk-limited.
- **`data/routes/miami-cruise.json`** — downtown-Miami street loop, snapped to real roads, ~18 mph,
  slowing for every corner, then an arrival dwell. Run: `spoof.cmd miami-cruise`. (~14 min — the
  snapped street path is longer than crow-flies; kept because more Life360 sampling = better.)
- Tests: `tests/test_speed_planning.py` (unittest, stdlib) — 7 passing (straight holds cruise,
  corner dips *at the elbow* then recovers, plan is accel-feasible, sparse rest-to-rest legs ramp).

**Bug caught + fixed in the final review (Critical):** `plan_speeds` collapsed **2-waypoint
rest-to-rest** legs to `[0,0]` → the whole leg crawled at 0.4 m/s. This broke the non-snapped
routes (`miami-demo`, `demo-drive`) and every route's straight-line fallback. Root cause was plan
*resolution* — 2 vertices can't hold a ramp-up/cruise/ramp-down profile. Fixed by **densifying**
sparse legs to ~15 m spacing before planning (`_densify` in renderer.py). Re-validated all routes:
miami-demo 11.6 m/s, demo-drive 14.0, miami-drift 35.8 (unchanged), miami-cruise 8.1.

Executed via subagent-driven development (implementer + reviewer per task, opus final review).

**Deferred (unchanged):** Valhalla `trace_attributes` per-edge *speed* (timing half of Increment 2).

**Next (owner, on-device):** run `spoof.cmd miami-cruise` — watch Life360 for a smooth gliding pin,
a believable mph that **dips on corners and rises on straights** (~18 mph), and a clean arrival.
Report the mph reading: it confirms/refutes the speed-rejection diagnosis. If a smooth 18 mph drive
*still* shows no mph, the cause is Life360's own sample cadence (→ tune duration), not cornering.

---

## 2026-07-08 — First on-device movement result + road-snapping (Increment 2 geometry) + miami-drift

**Owner ran the miami-demo on the phone. Two firsts, one bug.** ✅ It teleported to Miami and
Life360 showed the **driving (car) emoji** — so **Life360's movement emoji IS speed-derived and
spoofable** (Phase A #1, effectively confirmed on-device). ❌ But then the pin sat at **0 mph and
didn't visibly move**.

**Root cause (debugged, not guessed).** The play pipeline is fine — read pmd3's `play_gpx_file`:
it walks every GPX point, sleeps the Δt, and calls `set()` per point (genuine continuous motion),
and the built GPX is real 1 Hz movement, not a teleport. The problem is **route design vs how
Life360 samples a physically-still phone**: miami-demo was short + slow (~26 mph, ~1.5 km moving,
~3 min) with a **3-min dead stop at the end**. Life360 derives speed/emoji from displacement
between its own **sparse** uploads (the phone's accelerometer says "still," so its background
location manager gets no motion wakeups and uploads on a slow timer). So the one big displacement
it caught was the **teleport** (→ car emoji), then its next sample landed in the final stop → 0 mph.
Fix = a **long, fast, continuous** route with no trailing stop.

**Built `data/routes/miami-drift.json`** — downtown Miami → MIA on the Dolphin Expressway (SR-836),
**Valhalla-snapped to real roads**, driven at **~80 mph** for **6.7 min** (~14 km). Validates OK
(2 warnings: the intended 80 mph "speeding" flag + one launch-ramp accel blip). Run it:
`spoof.cmd miami-drift` (or the menu).

**Increment 2 (road-snapping) — geometry half done.** New `backend/movement/snapper.py`: Valhalla
`/route` + polyline6 decode (**1e6**, not 1e5), opt-in per segment via `"snap": true`, on-disk
cache (`build/snap-cache/`), straight-line fallback on `SnapError`. Added `snap` to the `Segment`
model; wired `snap_route()` into `tools/build_route.py` + `spoof.py`. FOSSGIS reachable from here
(tested). **Deferred:** `trace_attributes` per-edge *speed* (timing still from `speed_mps`), and
**corner-aware slowing** — found that at 80 mph a 1 s step cuts sharp snapped turns and trips the
accel gate; worked around by routing the fast preset on expressway (few sharp turns). Both logged
in BUILD_PLAN.md Increment 2. Also fixed a latent Windows cp1252 crash (`⚠`/`✗` in `build_route.py`
prints → ASCII).

**Unverified (owner tests on-device):** whether sustained 80 mph now makes Life360 show a moving
pin + high mph. The Life360-sampling root cause is reasoned, not instrumented — this route is the
test. If it still reads 0, the next lever is an even longer run and/or checking whether iOS reports
`CLLocation.speed` at all for a DVT set (vs Life360 computing it from its own samples).

**Next:** owner plays `miami-drift` and reports what Life360 shows (moving pin? mph? emoji held?).
Then Phase A #0 (`isSimulatedBySoftware`) still gates the realism work.

---

## 2026-07-08 — Research docs: added machine-readable frontmatter (agent-legibility)

Owner asked how to format the research briefs so coding agents (Claude/Codex) parse them more
reliably. Diagnosed that prose *comprehension* isn't the bottleneck — the failure modes are
(1) an agent trusting a well-sourced but **untested** claim as fact, (2) reconciling the same
fact restated across AGENTS/ROADMAP/index/brief, (3) nuance getting dropped in context
compaction. Fix = structure the **metadata**, not the prose.

**Changed:** added YAML frontmatter to all 7 briefs + the index — `status`, `last_verified`,
`device_verified`, `open_gates`, `depends_on`, `source_tier`, `recheck_if`. The load-bearing
new field is **`device_verified`**: it separates "well-sourced" from "confirmed on our phone"
(everything except the transport survey is `device_verified: none` — the exact distinction that
caused the old "Life360 ignores the spoof" bug). Documented the schema in
docs/research/README.md and added a "Research doc conventions" section to AGENTS.md.

**Deliberately NOT done** (judged over-engineering for this corpus): claim IDs, and shredding
prose into key-value blocks — kept the "Bottom line → evidence → implications" shape intact.

**Next:** unchanged — Phase A #0 (`isSimulatedBySoftware`) still gates everything; SWE on
Increment 2 (Valhalla). When a gate is run, flip the relevant doc's `status`/`device_verified`.

---

## 2026-07-08 — Roadmap: added cable-free (wireless) operation to the v2 backlog

Owner asked about "cloud" spoofing (no phone connection). Clarified: **true cloud/untethered does
not exist** on non-jailbroken iOS 26.6 — the DVT session always needs a live host. But **cable-free
over local Wi-Fi is real**: pmd3 models a `"Network"` usbmux connection type (verified in
`usbmux.py` — `is_network`), so after a one-time USB pair + Wi-Fi sync the host can reach the phone
wirelessly (PC still on + same LAN). Added it to ROADMAP v2 backlog with the key caveats and an
**untested unknown** — whether the full iOS-17 tunnel + DDI + `simulate-location` runs over Wi-Fi
on our stack (verify: pair via USB → Wi-Fi sync → unplug → `usbmux list` shows `Network` + can we
hold a location). Pairs with the long-lived session (Phase C); ref `lvalen91/location_daemon.py`.

**Next:** unchanged — owner tests the driving engine at home, then the flight-noti experiment; SWE
on Increment 2 (Valhalla). Wireless is a backlog item to verify opportunistically.

---

## 2026-07-08 — Research: crash/landing/notification feasibility + OSS spoofer landscape

Owner asked whether we can trigger Life360's **crash** and **"landed at airport"** pushes, to
enumerate **all** Life360 notifications, and (heavy emphasis) what others have built. Read the
updated offline core (model/renderer/validator + build_route/play_route + routes) and ran a
4-front deep sweep. Two new docs: **docs/research/life360-notification-triggers.md** and
**docs/research/oss-spoofer-landscape.md**.

**Decisive correction:** dev mode does NOT let us "manipulate almost any var" — the DVT service
injects **lat/lon only**. Verified 4 ways (pmd3 #340; source read; **GPX playback discards
`<ele>`/altitude**; DVT `condition_inducer` only fakes network/thermal, not motion).

**Answers:**
- **#1 crash → NO.** Needs a real accelerometer G-spike (Arity/CoreMotion); no injection path (two
  independent walls). Also a safety no-go — it auto-escalates to the circle + 24/7 dispatch.
- **#2 "landed at airport" → NO** as the flight push (altitude + airplane-mode toggle + post-land
  network reconnect, none injectable). **Substitute: geofence "arrived at CDG"** via a
  **manually-saved Place** (airports are NOT auto-Places).
- **#3 catalog:** reachable = geofence arrive/leave + movement emoji + (indirect) severe weather;
  everything sensor/battery/manual/hardware/server is out of reach. Full matrix in the doc.

**OSS landscape:** everyone rides the same pmd3/DVT rails; **`iphonespoofer` names Find My +
Life360 explicitly** (corroborates our dual-app result). Nobody's published a believable-*movement*
Life360 arrival with triggered notifications — we're at the frontier. Borrowable: `locwarp` move
modes, `lvalen91`'s persistent-DVT daemon (Phase C), `iphonespoofer`'s IP/GPS mismatch warnings.

**Docs corrected (ground rule #3):** the "Life360 auto-recognizes airports, no manual Place
needed" claim in AGENTS.md + ROADMAP.md was wrong → reframed the end goal to a geofence "arrived at
CDG"; upgraded the arrival caveat from "likely not" to confirmed-not with primary sources.

**Next:** unchanged — Phase A #0 (`isSimulatedBySoftware`) still gates everything; SWE on
Increment 2 (Valhalla).

---

## 2026-07-08 — spoof.cmd is now a "where do you want to go?" launcher

Rewrote `spoof.py` (the thing `spoof.cmd` runs) into a single menu launcher, per owner request:
double-click `spoof.cmd` → pick a **route**, a **static preset**, or **clear**.

- **Data-driven menu:** routes are read from `data/routes/*.json` — drop a new route JSON in and
  it shows up automatically (no code change). Routes run through the movement engine (render →
  validate → GPX → `simulate-location play`); presets/coords hold a fixed point via `set`.
- **Direct args still work:** `spoof.cmd miami` (matches a route by name), `spoof.cmd eiffel`
  (preset), `spoof.cmd 48.8584 2.2945` (coord), `spoof.cmd clear`.
- Replaces the old crude inline walk/drive GPX generator — that logic now lives properly in
  `backend/movement`. Kept eiffel/dubai as static presets; `miami` now maps to the miami-demo
  route.
- `spoof.cmd` gained a friendly "set up the venv first" message if `.venv` is missing.
- Verified offline (`py`): route discovery, arg resolution, menu render/selection, and the
  miami-demo build (237 pts, 6.7 min, 42 km/h) all work. On-device play still needs the Apple
  Mobile Device Service (owner will test at home — see prior entry).

**Next:** owner runs the Miami demo at home once the Apple service is installed; then Increment 2
(Valhalla road-snapping).

---

## 2026-07-08 — Device-test setup: venv on 3.12, Miami demo built, blocked on Apple driver

Prepping the owner's first on-device movement test (a realistic Miami demo).

- **Env:** recreated `.venv` on **Python 3.12** via `uv` + installed `pymobiledevice3==9.33.1`
  (`... -m pymobiledevice3 version` → 9.33.1). ⚠ **Python 3.14 does NOT work** — `lzfse` and
  `pylzss` have no 3.14 wheels and need MSVC to build. Use 3.12/3.13. Noted in BUILD_PLAN.md.
- **Demo + runner:** added `data/routes/miami-demo.json` (grid-accurate downtown-Miami
  walk→drive→light→drive→arrive) and `tools/play_route.py` — a thin pmd3-CLI wrapper (mount DDI +
  `simulate-location play --userspace`), the interim device path before the formal
  `LocationBackend.play_route` (Inc 3). Built + validated offline: 237 fixes, 6.7 min, max
  11.7 m/s (42 km/h), max accel 1.82, OK.
- **⛔ Blocker (AGENTS.md failure mode #1):** phone is plugged in and Windows sees it ("Apple
  Mobile Device USB Composite Device" + "Apple iPhone"), but the **Apple Mobile Device Service
  (usbmuxd) is NOT installed** → `usbmux list` = "Failed to connect to usbmuxd socket". Need the
  **Apple Devices app (Store) or iTunes** to restore it. (It was present during the original M1.)

**Next:** owner installs Apple Mobile Device Support → `usbmux list` shows the device → play the
demo: `.venv\Scripts\python.exe tools\play_route.py build\miami-demo.gpx` (phone unlocked,
Developer Mode on, Auto-Lock = Never).

---

## 2026-07-08 — Installed the `research` skill; used it → Valhalla road-snapping brief

Installed mattpocock's **`research`** skill (`npx skills add … --skill research`; installer scan:
Safe / 0 alerts). It runs a background agent against primary sources and writes a cited MD into our
notes. Used it on the SWE's current blocker — Increment 2, Valhalla road-snapping → wrote
**docs/research/valhalla-road-snapping.md**.

Gist for the SWE: two build-time calls per segment — `/route` (costing `auto`/`pedestrian`/
`bicycle`) → road-following polyline (**polyline6 — decode with 1e6, not Google's 1e5**; or request
`geojson` to skip decoding), then **`trace_attributes`** (`shape_match:"edge_walk"`, `filters`) →
per-edge **`speed` (km/h ÷ 3.6 → m/s)** mapped onto shape vertices via `begin/end_shape_index`. Use
`trace_attributes` (not `trace_route`) for timing. FOSSGIS `valhalla1.openstreetmap.de`, no key,
1 call/user/s — cache the snapped result so it's hit ~once per route edit. Self-host
(`ghcr.io/valhalla/valhalla` + `valhalla_build_tiles`) is a one-line `VALHALLA_BASE_URL` switch.

Tooling note: the install dropped `.agents/` + `skills-lock.json` in the tree → gitignored them
(personal tooling, not project source).

**Next:** SWE can build `snapper.py` straight from the doc's call sequence.

---

## 2026-07-08 — Movement engine: folded the research realism findings into the core

Pulled the docs/research/ findings into the offline core (no phone needed). Validator
(`backend/movement/validator.py`) is now two-tier (errors reject / warnings review):
- **Acceleration gate** on a jitter-smoothed speed signal — rejects instantaneous velocity
  steps (>2.85 m/s²), the #1 synthetic tell the speed-only check was missing (warn >2.0).
- **Speed retuned to Life360's bands:** teleport hard-fail >53.6 m/s (120 mph, was 70), review
  >35.8 (80 mph), per-mode review caps. Raw step speed for the teleport check; smoothed speed
  for mode/accel (jitter makes instantaneous speed noisy — a real detector smooths too).
- Returns `ValidationResult(errors, warnings, max_step_speed, max_smoothed_speed, max_accel)`.

Renderer (`backend/movement/renderer.py`):
- **Jerk-limited S-curve ramps** (peak accel ≤~1.8, jerk ≤2 m/s³) instead of bang-bang accel.
- **Zero-speed dwell at every mode change** (decel to 0 into stops *and* mode switches) — kills
  the ~13 m/s velocity cliff a drive→walk boundary used to create.
- **Walk speed sampled ~N(1.34, 0.30)** clamped [0.75, 2.4] when unspecified.
- **Perpendicular-biased jitter** (σ≈5 m open-sky default): lateral wander dominant, along-track
  reduced — still a bounded walk that can't manufacture speed.

Constants centralized + tuned in `model.py` per the briefs. Verified on the demo
(drive→walk→stop): 418 fixes, 9.3 min, max 14 m/s, **max accel 1.83 m/s²**, validation OK.
Added negative tests — teleport (5559 m/s) and a mid-track velocity step (6.25 m/s²) are both
rejected; a clean ramp passes. Details/status in **docs/BUILD_PLAN.md** (Increment 1.5).

**Deferred (still queued):** Valhalla `trace_attributes` (Inc 2), `play_route` wrapper (Inc 3),
and the bigger research ideas (behavioral engine, `isSimulatedBySoftware` gate #0,
record-and-replay) as their own milestones.

**Next:** Increment 2 — Valhalla build-time road-snapping.

---

## 2026-07-08 — Research sweep: 4 cited briefs, 1 decisive finding, new docs/research/

Ran four parallel deep-research dives (Life360 detection/realism · activity-emoji vs CoreMotion ·
alternative spoof methods · behavioral-simulation prior art). All cited + adversarially verified;
written up under **docs/research/** — start at docs/research/README.md (index + TL;DR + a
"candidate engines / methods" menu).

**⚠ Decisive finding — new Phase A gate #0:** iOS 15+ exposes
`CLLocation.sourceInformation.isSimulatedBySoftware`. Xcode's GPX sim sets it `true`; consumer
"external provider" spoofer apps read `false`. Our pmd3 / `DVTSimulateLocation` path uses Apple's
*own* DVT service, so it may read `true` — **untested**. If it does, any app (Life360 included)
can detect the sim in one line and realism is moot. **Test this first, before anything else
on-device.**

**Other findings that changed the docs:**
- **Activity = two systems.** Life360's on-map *movement emoji* is speed-derived (likely
  spoofable); its *driver reports / crash / hard-braking* are Arity **CoreMotion** (not spoofable
  on a still phone). Re-scoped the goal in ROADMAP/AGENTS — target the emoji, not the reports.
- **Airport "landed" push** needs altitude + airborne speed + a post-landing network reconnect →
  likely **not** reproducible by a lat/lon ground sim. Aim for a plain **geofence arrival** near
  the airport; noted as a caveat.
- **Transport validated.** pmd3 is the reference impl of the only no-JB iOS 17+ mechanism; every
  serious tool (commercial incl.) rides the same DDI/DVT/RemoteXPC rails. `go-ios` is the sole
  peer → WATCH fallback. No untethered spoof without a jailbreak. iOS 18/26 detection hardening =
  standing risk.
- **New milestone M1.6 — behavioral / life-simulation engine** (EPR/TimeGeo "day planner" above
  the movement engine). Rich prior art incl. **`locwarp`** (a Windows + pymobiledevice3 analog), a
  portable Pokémon-Go jitter model, and concrete realism constants (accel ≤~2 m/s², walk N(1.34,
  0.30), teleport hard-fail >55 m/s, geofence dwell ≥2–5 min, Valhalla `trace_attributes` for
  per-edge speed).

**Docs touched (researcher lane):** added docs/research/{README, life360-detection-and-realism,
activity-emoji-coremotion, spoof-methods-survey, behavioral-engine-prior-art}.md; updated
ROADMAP.md (Phase A gates + #0, emoji scope, airport caveat, M1.6) and AGENTS.md (new "detection
surface & landscape" section). No code touched — SWE's offline core (`a85ff4f`) untouched.

**Next:** Phase A gates when the phone's around — start with **#0 `isSimulatedBySoftware`**. SWE
continues Increment 2 (Valhalla snapping) per docs/BUILD_PLAN.md.

---

## 2026-07-08 — Movement engine: built the offline core (model + renderer + validator + tool)

Implemented the device-independent core of Phase B — no phone needed to develop or verify it:

- `backend/movement/model.py` — `route.json` schema → `Route`/`Segment`/`LocationFix`, loader
  + input validation, per-mode default speeds / speed ceilings / accel.
- `backend/movement/renderer.py` — `RouteRenderer`: straight-line interpolation (no-network
  fallback for now), per-segment speed with accel/decel ramps into stops, bounded random-walk
  GPS jitter, and GPX output.
- `backend/movement/validator.py` — the offline gate: strictly-increasing time + per-mode /
  global speed ceilings; rejects impossible speeds / teleports before anything hits the device.
- `tools/build_route.py` — load → render → validate → write the cached GPX `play` eats.
- `data/routes/demo-drive.json` — smoke-test route.

**Verified offline:** `py tools/build_route.py data/routes/demo-drive.json` → 256 fixes, 5.0
min, max 14.6 m/s (52 km/h), validation OK. Eyeballed the GPX: clean ramp-up → cruise → decel
→ 60 s dwell. Caught + fixed a real bug in passing — IID per-point jitter was manufacturing
26 m/s speed spikes; switched to a bounded, correlated random-walk offset so jitter can't fake
speed. (This is exactly what the validator is for.)

**Deliberately not done yet:** Valhalla road-snapping (straight lines for now), the
`play_route` CLI wrapper, and the two phone-gated pieces (flight-gap branch, activity emoji) —
those wait on the Phase A on-device tests. SWE build roadmap + live status in
**docs/BUILD_PLAN.md**.

**Next:** Valhalla build-time snapping → `play_route` wrapper; Phase A gates when the phone's around.

---

## 2026-07-08 — Movement engine design locked; wrote docs/MOVEMENT_ENGINE.md

Design session for the movement engine (the confirmed gap). Decisions:

- **Approach:** author routes as **JSON** (waypoints + mode + speed + dwell) → snap to roads
  with **Valhalla at build time** → cache a dense **GPX** → replay with `simulate-location
  play`. Valhalla is build-time only, so the run path needs no network / no key. Ship the CDG
  arrival on this. The long-lived live-`set()` session is **deferred to a later phase** (Phase
  C) — build it only once an arrival is proven, to avoid taking on in-process tunnel ownership
  early.
- **Scope:** fixed cached presets for now; data model designed so arbitrary/drawable routes
  drop in later.
- **Verified against pmd3 upstream:** `simulate-location set` takes **only lat/lon** (no
  accuracy/altitude/speed/heading — see issue #340). ⟹ **iOS derives speed/heading from our
  position deltas**, so point spacing *is* the speed signal Life360 sees (spoofable). `play`
  derives speed from GPX time deltas and accepts an optional ± timing-noise arg. Recorded in
  AGENTS.md.
- **Two on-device gates come FIRST (Phase A), before engine code:** (1) CoreMotion test — a
  long constant "drive" to see if Life360's activity emoji is GPS-derived (spoofable) or
  CoreMotion-derived (not); (2) flight-gap test — does iOS revert to real GPS when we stop
  calling `set()`? That decides how we model the Miami→CDG gap without leaking the real (home)
  location. The doc writes both gap branches and marks the choice TODO-pending-test.

Full design (data model, interface, phases, risks, roadmap mapping): **docs/MOVEMENT_ENGINE.md**.

**Next:** run the Phase A on-device gates, then build Phase B (JSON→Valhalla→GPX→play).

---

## 2026-07-08 — Correction: Life360 DOES reflect the spoof; movement engine is the gap

**Owner correction to the M1 finding.** The earlier entry ("Life360 did NOT reflect the
spoof") was wrong. A static spoof *does* show up on Life360 — the member's pin moves to the
fake location, not just Find My. So Life360 is **not** ignoring CoreLocation, and there's no
home-Wi-Fi / IP / impossible-teleport blocker on a plain static set. The IP/VPN and
"non-CoreLocation signal" worries from the earlier entries are moot for a static set.

**What's actually missing: the movement engine.** Static "teleport to X" works everywhere.
What we don't have yet is believable *movement* — road-snapped routes, per-segment speed
profiles (walk / drive / stop), GPS jitter, and the flight "gap" — which is what a realistic
CDG arrival (and the driving/walking activity emoji) still needs. That's the next build.

**Process note:** stale docs caused this confusion. Added AGENTS.md ground rule #3 — the
moment a result is confirmed (works or fails), update the docs in the same session.

**Also (infra):** reconnected this working copy to `procookiemuncher/vida-360` (it was a ZIP
download with no `.git`) and set up SSH-signed commits + a pinned push key — commits now show
"Verified". Details in AGENTS.md → "Where & how to commit".

**Next:** design + build the movement engine (M1.5 / M2).

---

## 2026-07-07 — First movement: miami preset walks then drives 100mph

`spoof.cmd miami` now does a movement demo instead of a static hold: from downtown Miami it
walks ~12s (3 mph), then drives ~12s at 100 mph, then holds ~5 min. Built as a generated GPX
replayed via `simulate-location play --userspace` (one tunnel; `play` moves at
distance/time-delta between points, so per-second spacing sets the speed). Verified offline
with gpxpy: walk 1.40 m/s, drive 44.74 m/s. Static presets (eiffel/dubai) unchanged.

**Purpose:** first real test of whether Life360's activity emoji (walking/driving) is
GPS-speed-derived (spoofable) or CoreMotion-derived (not). 10–15s phases may be too short for
Life360 to register — the `*_SECS` constants at the top of spoof.py are easy to bump.

---

## 2026-07-07 — Correction: Life360 auto-detects airports; route + activity vision

**Correction (owner):** Life360 DOES auto-send an arrival notification when you land at a
major airport — no manually saved Place required (owner saw this on a real Paris trip). So
the notification MVP = believably arrive at CDG's area after a "flight gap".

**Route vision (owner's target):**
- "Airport route": realistic ~30–40 min drive CDG → 5-star Paris hotel.
- "Full Ride": multi-hour airport → hotel → mixed walking / driving / stops.
- Wants to trigger Life360's **activity emoji** (driving / walking).
  ⚠ RISK/UNKNOWN: iOS activity type often comes from CoreMotion (real accelerometer), which
  we cannot spoof (phone sits still). If Life360's emoji is GPS-speed-derived we can trigger
  it; if motion-derived, we can't. **Test this early** before promising it.
- Likely built as stored GPX routes replayed via `simulate-location play`, with speed profiles.

**UI:** wanted eventually, deferred.

---

## 2026-07-07 — Clarified end goal + Life360 strategy brainstorm

**End goal locked:** make Life360 send "Juan has arrived at &lt;place&gt;" to the group.
Higher bar than Find My — needs a real geofence **entry** at a saved Place, not a static pin.

**IP / VPN thinking**
- On iOS, Life360 CANNOT scan surrounding cell towers or nearby networks (Apple restricts
  it) → the "Miami cell tower" worry is moot. At most it can read the *currently connected*
  Wi-Fi, so being off home Wi-Fi / on cellular removes that tell.
- The only real server-side tell is **IP geolocation**. Uncertain if Life360 enforces it.
  **Plan: test a plain Paris spoof first**, kept running several minutes so Life360 polls.
  Add VPN only if that test shows IP is the giveaway.
- Free VPN reality: it runs on the **phone** (not the PC), can't be automated by our tool;
  France exists on some free tiers, **UAE essentially never** → Dubai-with-matching-IP is
  impractical for free; Paris is doable if needed.

**Realistic routes / arrival**
- Miami→Paris can't be "driven". Model it like real life: last real update in Miami → an
  update **gap** (like a flight) → reappear near CDG → simulate the short final approach so
  Life360 logs a clean "arrived at CDG" entry.
- Movement engine parts: road-snapped interpolation (free routing API), speed profiles
  (walk/drive), GPS jitter, and a cooldown/offline gap for the ocean leg.

**Next:** run the plain-Paris test; design the movement engine.

---

## 2026-07-07 — Added quick-run spoof script

`spoof.py` (+ `spoof.cmd` double-click wrapper) so we stop hand-typing commands. Takes a
preset (Eiffel / Dubai / Miami) or `lat lon`; mounts the DDI via the userspace tunnel, sets
the location, and holds until ENTER. `spoof.cmd clear` reverts. Presets are an inline dict
for now (→ JSON when we build M2). This is the seed of the eventual `LocationBackend`.

---

## 2026-07-07 — Enabled signed commits (SSH)

Commits + tags are now **SSH-signed** for the GitHub "Verified" badge — no GPG/Kleopatra.
- Signing key: `~/.ssh/vida360_signing` (ed25519, repo-local config only).
- `commit.gpgsign=true`, `gpg.format=ssh`. Public key registered on the procookiemuncher
  account as a **Signing Key**.
- Committer email `thegoatcodercookie@gmail.com` must stay a verified email on the account
  for the badge to show. Commits made before this date remain unverified (not worth
  rewriting pushed history).

---

## 2026-07-07 — M1 DONE: Find My spoof confirmed ✅

**Working sequence (userspace path — NO admin required):**
1. `amfi developer-mode-status` → `true` (Developer Mode already on).
2. **Phone unlocked + Auto-Lock set to Never** — the DDI mount fails with
   `{'Error': 'DeviceLocked'}` if the phone locks mid-upload.
3. `mounter auto-mount --userspace` → DeveloperDiskImage mounted.
4. `developer dvt simulate-location set --userspace <lat> <lon>` → sets the location and
   **holds the tunnel open** (shows "Press ENTER to exit"). Location stays only while this
   command runs; pressing ENTER tears down the tunnel and reverts.

Result: **Find My correctly showed the spoofed location (Paris).**

**Key learnings**
- `--userspace` (pure-Python tunnel) sidesteps admin + `wintun` entirely on Windows → this
  is our chosen transport. The elevated `remote tunneld` path is the fallback only.
- DDI mount needs the phone unlocked.
- The session process must stay alive to keep the tunnel + location. **Implication for M2:**
  the backend must hold a long-lived session, not fire one-shot commands.

**New problem — drives M1.5**
- **Life360 did NOT reflect the spoof** — still showed "home" while Find My showed Paris.
  Cause not yet diagnosed. Candidates: teleport / impossible-speed detection · Life360 using
  non-CoreLocation signals (home Wi-Fi SSID/BSSID, cell towers, or server-side IP
  geolocation) · stale background update. **Diagnose before building realism features.**

---

## 2026-07-07 — M1 started: toolchain proven, blocked on Apple driver

**Done**
- Created `.venv` (Python 3.13.5) and installed **`pymobiledevice3==9.33.1`** (pinned in `requirements.txt`).
- **Version risk resolved:** 9.33.1 already ships iOS 27+ commands (e.g. `remote pair-host`),
  so iOS 26.6 is comfortably supported. No need for git `main`.
- Verified the CLI exposes everything M1 needs:
  - `remote tunneld` / `remote start-tunnel` — the iOS 17+ tunnel.
  - `developer dvt simulate-location set / clear / play` — "iOS 17 and newer". `play` = GPX
    route replay, free for v2.
- Bonus: pmd3 pulls in `fastapi`, `uvicorn`, `gpxpy` as deps → M3 UI stack already present.

**Blocked**
- `pymobiledevice3 usbmux list` → *"Failed to connect to usbmuxd socket."* Windows has no
  Apple Mobile Device service. Must install **iTunes (apple.com)** or the **Apple Devices**
  app to get usbmuxd + the USB driver. (AGENTS.md failure mode #1.)

**Next (device-side — needs the phone + the user)**
1. Install Apple Mobile Device Support (iTunes / Apple Devices app).
2. Plug in iPhone, unlock, tap **Trust This Computer**.
3. Enable **Developer Mode** (Settings → Privacy & Security → Developer Mode; reboot + confirm).
4. Re-run `usbmux list` — device should appear.
5. Then: elevated `remote tunneld` → auto-mount DDI → `simulate-location set <lat> <lon>` →
   confirm the fake location in Maps.

---

## 2026-07-07 — Project kickoff

**Done**
- Brainstormed the architecture (details in AGENTS.md → "Key decisions").
- Connected the local repo to GitHub `procookiemuncher/vida-360` (private) over HTTPS.
  Commit identity set locally to `thegoatcodercookie@gmail.com` (machine's global git
  identity is a different account, so this is set per-repo).
- Created AGENTS.md, ROADMAP.md, PROGRESS.md, README.md, CLAUDE.md pointer, .gitignore.

**Decided**
- Python end-to-end. Host = Windows. Target = iPhone **iOS 26.6** → tunnel path only.
- Transport = `pymobiledevice3`, **hybrid**: elevated `tunneld` daemon + Python API for calls.
- UI = FastAPI + Leaflet local web page.
- Architecture = UI → `LocationBackend` interface → single `pymobiledevice3` adapter
  (all transport glue quarantined for version resilience).
- MVP = fixed location + presets + saved locations + status panel. Routes / GPX / macOS = v2.

**Open risks / unknowns**
- Whether the current released `pymobiledevice3` supports iOS 26.6, or if git `main` is needed.
- Windows tunnel bring-up (`wintun`, elevation) is unverified against the real device.

**Next**
- **M1 transport spike:** get one hardcoded coordinate onto the phone. De-risk before any UI.
