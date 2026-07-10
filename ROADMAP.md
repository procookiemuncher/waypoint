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
**North star (corrected 2026-07-08):** get Life360 to push **"Juan arrived at CDG"** to the group.
The *literal* flight-detection "landed" push is **confirmed NOT reproducible** on a lat/lon-only
stack (needs real altitude + an airplane-mode toggle + a post-landing network reconnect), and
**airports are NOT auto-Places** — so the achievable, equivalent goal is a **geofence arrival at a
manually-saved CDG Place**. Full analysis, the complete notification catalog, and the trigger
method: **docs/research/life360-notification-triggers.md**.

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
  - [x] **#1 CoreMotion / movement emoji — RESOLVED NO (2026-07-10, Observer-instrumented, both
    Motion & Fitness ON and OFF legs).** The emoji/speed/driving-flag does NOT reliably trigger on
    a physically-still spoofed phone; toggling Motion & Fitness made no measurable difference in
    either direction. Leading suspect is Life360's own sparse server-side position-update cadence
    (~60-75s median in both legs), not the permission. See
    docs/research/activity-emoji-coremotion.md for the full data.
  - **#2 flight-gap:** does iOS revert to real GPS when we stop calling `set()`?
- [ ] **Build the movement engine** (Phase B — the missing piece; see M2 and the design doc).
  Believable movement: road-snapped interpolation, per-segment speed profiles (walk / drive /
  stop), GPS jitter, and the flight "gap".
- [ ] Confirm airport arrival fires: **save CDG as a Life360 Place**, then after a Miami "gap"
  believably drive the pin into that Place and dwell (≥5–10 min) → watch for "arrived at CDG".
  ✅ **Confirmed (primary sources, docs/research/life360-notification-triggers.md):** the auto
  **"landed"** flight push is NOT reproducible (needs altitude + airplane-mode toggle + network
  reconnect), and airports are NOT auto-Places. Target the **geofence arrival** — same family
  alert to the circle, no plane icon. (Upgraded from last week's "likely not" to confirmed.)
- [ ] Arrival must look real: no impossible-speed teleport, GPS drift present.

**Route presets (the movement engine):**
- [~] **Flight-arrival spoofer BUILT (offline) — 2026-07-10.** `fly.cmd` choreographs a full
  airplane-mode "flight" that fires "arrived at <destination>": drive to departure airport → manual
  airplane-mode gap (offline, so Life360 never sees the compressed hop) → drive from arrival airport
  into a saved Place → dwell. First trip: **`nyc`** (Miami → Manhattan hotel), with `mia-departure`
  + `jfk-to-hotel` routes and an Observer arrival signal (`place_name` / `--places`). Repeatable
  per city. Design: docs/superpowers/specs/2026-07-10-flight-arrival-spoofer-design.md. **Pending
  on-device:** Step 0 tunnel-survives-airplane-mode gate, then a real run with a 2nd member watching.
- [ ] "Airport route" — believable ~30–40 min drive airport → a 5-star hotel. *(The `nyc` trip's
  `jfk-to-hotel` leg is the first instance; CDG → Paris hotel is a coord swap.)*
- [ ] "Full Ride" — multi-hour: airport → hotel, then mixed walking / driving / stops.
- [ ] Trigger Life360's **movement emoji** (walk / drive icon). ❌ **RESOLVED NO (2026-07-10,
  Phase A #1):** on-device testing (both Motion & Fitness ON and OFF, Observer-instrumented) shows
  the emoji/speed/driving-flag does NOT reliably trigger on a still spoofed phone in either
  condition — see docs/research/activity-emoji-coremotion.md. Deprioritize this goal unless a new
  lever surfaces (e.g. a much longer sustained run, or evidence the server cadence itself is
  fixable).
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
- **Cable-free (wireless) operation:** drive the phone over **local Wi-Fi** instead of USB —
  pmd3 already models a `"Network"` connection type, so once the phone is **paired over USB once
  (Trust)** and **Wi-Fi sync** is on, the host can reach it wirelessly (phone untethered, anywhere
  on the LAN). Ideal for holding a **static "one place"** indefinitely; works for routes too.
  ⚠ **This is NOT "cloud":** the host PC must still be **on and on the same network** — there is
  **no untethered/remote spoof** on non-jailbroken iOS 26.6 (kill the host → it reverts; the
  commercial "stays after disconnect" is a stale dot iOS 18+ wipes). **Untested unknown:** whether
  the full iOS-17 RemoteXPC tunnel + DDI mount + `simulate-location` runs over Wi-Fi on our
  Windows / iOS-26.6 stack (the initial handshake sometimes wants USB) → **verify first** (pair via
  USB → enable Wi-Fi sync → unplug → does `usbmux list` still show it as `Network`, and can we
  hold/replay a location?). Pairs with the long-lived session (Route simulation, above);
  reference impl: `lvalen91/location_daemon.py` (docs/research/oss-spoofer-landscape.md).
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
