# ROADMAP

## Vision

Personal GPS spoofer for the owner's own iPhone (iOS 26.6) from Windows.
**v1:** set a fixed fake location reliably. **v2:** simulate movement along routes.

MVP = **M1–M4**.

---

## Milestones

### M0 — Project setup  ✅ DONE
- [x] Brainstorm architecture (2026-07-07)
- [x] Connect git repo to GitHub `procookiemuncher/vida-360`
- [x] AGENTS.md / ROADMAP.md / PROGRESS.md
- [x] Python project skeleton + virtualenv + pinned `pymobiledevice3` (9.33.1)

### M1 — Transport spike  ✅ DONE (Find My confirmed)
Goal: push **one hardcoded coordinate** onto the iOS 26.6 phone from Windows and see it in
Maps / Find My. This de-risks everything else.
- [x] Verify prerequisites (device visible over USB, Developer Mode = `true`, trusted)
- [x] Bring up the tunnel — used **`--userspace`** (pure-Python, no admin / no `wintun`)
- [x] Auto-mount the personalized Developer Disk Image (needs phone unlocked)
- [x] Connect DVT, call `simulate-location set`, confirm on device
- [x] Record the exact working command sequence in PROGRESS.md
- **Exit criteria met:** Find My showed the spoofed location (Paris).

### M1.5 — Life360 airport arrival + realistic routes (the real end goal)  🔬 IN PROGRESS
**North star:** replicate the "Juan has arrived at Paris (CDG) airport" notification Life360
auto-sends when you land at a major airport. Life360 recognizes airports itself — no manual
Place needed.

- [x] **CONFIRMED: a static spoof reflects on Life360.** The member's pin moves to the fake
  location (not just Find My). The earlier "Life360 ignores the spoof" finding was wrong.
  So there's no home-Wi-Fi / IP / teleport blocker on a plain static set — **the gap is
  movement.**
- [x] **Movement engine designed** — see **docs/MOVEMENT_ENGINE.md** (2026-07-08). Chosen:
  JSON route defs → Valhalla road-snapping (build time) → cached GPX → `simulate-location
  play`; live-`set()` session deferred to a later phase.
- [ ] **Phase A on-device gates (do first, in order):**
  - **#0 `isSimulatedBySoftware` (DECISIVE):** does our pmd3 / `DVTSimulateLocation` tunnel path
    set `CLLocation.sourceInformation.isSimulatedBySoftware`? Xcode's GPX sim sets it `true`;
    consumer "external provider" spoofers read `false`; our path uses Apple's *own* DVT service,
    so it may read `true` — in which case any app (Life360 included) can detect the sim in one
    line and realism is moot. Test with a ~20-line app. → docs/research/life360-detection-and-realism.md.
  - **#1 CoreMotion / movement emoji:** a long constant-speed drive → does Life360's *movement
    emoji* flip? (The icon is speed-derived and likely spoofable; drive *reports* are Arity
    CoreMotion and are NOT — see docs/research/activity-emoji-coremotion.md.)
  - **#2 flight-gap:** does iOS revert to real GPS when we stop calling `set()`?
- [ ] **Build the movement engine** (Phase B — the missing piece; see M2 and the design doc).
  Believable movement: road-snapped interpolation, per-segment speed profiles (walk / drive /
  stop), GPS jitter, and the flight "gap".
- [ ] Confirm plain airport arrival fires the notification: after a Miami "gap", believably
  arrive into CDG's area (via the movement engine) and watch for the group notification.
  ⚠ Research note (docs/research/life360-detection-and-realism.md): the auto-**"landed"** flight
  push keys off altitude + airborne speed + a post-landing network reconnect — likely **not**
  reproducible by a lat/lon-only ground sim. Aim for a normal **geofence arrival** near the
  airport instead, and treat the exact "landed" notification as a stretch/unknown.
- [ ] Arrival must look real: no impossible-speed teleport, GPS drift present.

**Route presets (the movement engine):**
- [ ] "Airport route" — believable ~30–40 min drive CDG → a 5-star Paris hotel.
- [ ] "Full Ride" — multi-hour: airport → hotel, then mixed walking / driving / stops.
- [ ] Trigger Life360's **movement emoji** (walk / drive icon). Research
  (docs/research/activity-emoji-coremotion.md) finds this icon is **speed-derived → likely
  spoofable** (Life360 defines it by speed thresholds, and its icon set includes flying/boating
  which can't be accelerometer-based); confirm in Phase A #1.
  - ⚠ **Out of scope:** Life360 **driver reports / hard-braking / crash detection** are Arity
    **CoreMotion** (real accelerometer + gyro) and are **not** reproducible on a physically still
    phone. Don't promise them.
- Likely implementation: stored **GPX routes** replayed (pymobiledevice3 has
  `simulate-location play`), with per-segment speed profiles for walk / drive / stop.

**UI:** wanted later, deferred.

### M1.6 — Behavioral / life-simulation engine  💡 NEW (stretch, builds on M1.5)
A layer **above** the movement engine that makes location *history* look like a real person's
life over hours/days (home → work → errand → home, believable dwell + circadian rhythm), instead
of one-off routes. The movement engine renders legs; this engine decides *where & when*. Full
prior-art survey + design + data model in **docs/research/behavioral-engine-prior-art.md**.
- [ ] Vendor a per-point **jitter/step model** (Pokémon-Go `step_walker`, MIT) into the renderer.
- [ ] **Speed/timing profiler**: encode per-mode speed via point spacing; jerk-limited ramps
  (≤~2 m/s², jerk ≤~2 m/s³); zero-speed dwell between mode changes.
- [ ] Wire **Valhalla `trace_attributes`** for real per-edge speeds at build time — API details,
  call sequence, and the polyline6 decode pitfall in docs/research/valhalla-road-snapping.md.
- [ ] **Template day planner** (17-motif sampler + Zipf-weighted anchors + power-law dwell) →
  `(place, arrive, depart)` day-script → full-day GPX. Optional **scikit-mobility** (EPR/DITRAS)
  backend later.
- [ ] **Record-and-replay**: import a real self-recorded GPX / OSM `identifiable` trace as a
  realism baseline + regression corpus. (Not Strava — its 2026 API policy forbids it.)
- [ ] Offline **realism acceptance tests** (heavy-tailed jumps, no speed cliffs, overnight = home
  + jitter) extending the existing validator.
- Reference tool on our exact stack: **`locwarp`** (Windows + pymobiledevice3) — study, don't fork.

### M2 — Backend core
- [ ] `LocationBackend` interface — `ensure_ready()` / `set_location()` / `clear()` / `status()`
- [ ] `pymobiledevice3` adapter (all transport glue lives here)
- [ ] Managed tunnel helper (handles elevation)
- [ ] Status/health reporting (device · tunnel · DDI · dev-mode · current coord)

### M3 — Local web UI
- [ ] FastAPI app serving the static Leaflet page
- [ ] Map click-to-set + location label
- [ ] Landmark presets (Eiffel Tower, Dubai, Miami, …)
- [ ] Save / reuse named locations (local JSON)
- [ ] Status panel + Set / Clear controls

### M4 — MVP polish
- [ ] Prerequisite checks surfaced in the UI with fixes
- [ ] One-command launcher
- [ ] Basic error surfacing

---

## v2 — Backlog & Ideas (parking lot)

- **Route simulation:** hold the DVT session open, interpolate along a drawn polyline,
  `set()` on a ~1s timer, with speed control (smoother than one-shot GPX play).
- GPX import / export.
- Small positional **jitter** for realism.
- **macOS support** — mostly free once the adapter is isolated; the tunnel is easier there.
- Auto-reconnect / tunnel self-healing.
- Keep-awake helper while spoofing.
- Preset packs / shareable location files.

---

## Current focus

→ Finish **M0**, then start the **M1 transport spike**. Do not build UI until M1's exit
criteria are met.
