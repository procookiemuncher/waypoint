# PROGRESS LOG

Append-only dev log. **Newest entry on top.** After any work session, add an entry:
what changed, what was decided, what broke, what's next.

**This is the first thing to read after a memory/context reset.**

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
