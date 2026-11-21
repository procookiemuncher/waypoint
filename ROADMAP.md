# ROADMAP

## Vision

**Waypoint** spoofs your own iPhone's location from a Mac or Windows PC, believably enough that
Life360 shows it: fixed points, real-speed drives (mph + car icon), and full trips that end in a
geofence "arrived at" push. Sold to a small set of users with access keys.

How it works and why: AGENTS.md. Current state: PROGRESS.md.

---

## Done so far

- **Transport:** pmd3 `--userspace` tunnel, DDI auto-mount, DVT set/play. No admin, no Xcode
  (pmd3 11.59 since 2026-11-19).
- **On Life360:** a static spoof shows up; no VPN needed. The drive path (CoreDevice location
  service) shows real mph + the car icon, including changing speeds.
- **Movement engine:** JSON routes → Valhalla road snapping → per-segment speed profiles, corner
  slowdowns, GPS jitter → validated GPX (docs/MOVEMENT_ENGINE.md). Destinations catalog: 35 spots
  in 28 cities, generated airport → hotel → spot routes.
- **Flight choreographer:** `fly <trip>` (drive out, airplane-mode gap, drive into a Place, dwell),
  airplane mode toggled over pmd3. Built, not yet run end to end on the phone.
- **Life360 Observer:** reads the circle's server-side view (`core/tools/observe.py`).
- **Waypoint app (Mac):** map + globe UI, arrival-plan side panel, ⌘K palette, connect screen,
  dev and release builds, access keys + key dashboard, auto-update. 0.1.0-beta.2 is out to testers.

---

## The four paths

Numbered in the owner's order. When it isn't clear which one to work on, ask.

### 1. Finish the Windows version

Windows has the launchers (spoof, drive, fly, setup) and the Waypoint window (`waypoint.cmd`,
2026-11-20), both checked on the phone.

- [x] Real speed on Windows: Life360 shows mph + the car from a Windows Drive run (2026-11-20).
- [x] Waypoint window with the real phone: connect, pin, Drive route, Stop, quit clears
  (2026-11-20). `Job.stop()`'s ENTER path works.
- [x] A Waypoint window on Windows (`windows-version/app.py`, 2026-11-20). The key gate
  (`VIDA_LICENSE_URL`) isn't tried there yet.
- [ ] Packaging: a compiled Windows build + installer. The updater is Mac-only today (ditto,
  codesign), so Windows needs its own swap and signature check.
- [x] Airplane mode without devicectl (2026-11-21): CoreDevice `launchapplication` with the
  Shortcut URL as `payloadURL`, `CoreDevice.airplane(on)` in device.py. `fly` toggles it itself
  (you confirm), `fly airplane on|off` on its own. Checked on the phone from Windows. Nothing calls
  devicectl any more.
- [ ] Keep log and print lines ASCII-safe (cp1252 crashes have bitten twice).

### 2. Keep adding to the UI

- [ ] Owner tries the new globe + side panel in the Dock app (only dry-run tested in Chromium).
- [ ] Pick the globe effects (stars, depth, night, rim, UFOs) in the prototype, then build them in.
- [ ] Decide on the CRT scanlines over the new panel.
- [ ] The lint leftovers (10 FAIL / 89 WARN): window ring/frame, map sweep, status bar gauge,
  CRT overlay, connect + key screens.
- [ ] Save / rename / delete places from the UI (presets are hand-edited JSON today).
- [ ] Flights in the app: a flight API + `fly` in the palette, with the airplane-mode steps. The
  toggle is ready in device.py (`CoreDevice.airplane`); the app still needs the confirm step.
- [ ] A structured season/days field for spots, so the panel can say Club 55 is out of season.
- [ ] Prerequisite checks with fixes (Developer Mode, Trust, driver) and clearer errors.

### 3. Start getting users

- [x] **Map without a rate limit (2026-11-21).** Stadia's free plan is non-commercial and keyless
  access is rate limited, so the map moved to OpenFreeMap vector tiles (free, commercial OK, no
  key). Nothing for release builds to carry. Owner still has to see it in the Mac Dock app.
- [ ] Prove a compiled build moves the pin on a real phone (only dry runs + read-only calls so
  far). Also: a Mac with no Xcode installed, and the update swap after a normal window quit.
- [ ] Intel Macs: the release build is arm64 only.
- [ ] Gatekeeper: stay on "Open Anyway", or pay for the Apple developer account and notarize.
- [ ] How keys get sold and paid for (today they're made by hand on the dashboard).
- [ ] First-run onboarding for a new user: Developer Mode, Trust, keep unlocked.
- [ ] Harden keys if abuse shows up: signed answers, one Mac per key.
- [ ] Housekeeping: delete old release zips in Vercel Blob (~70 MB each).

### 4. Improve the motion engine

- [ ] **Gate #0, `isSimulatedBySoftware`:** does our path set it? If yes, any app can detect
  the sim in one line. Test with a ~20-line app (docs/research/life360-detection-and-realism.md).
- [ ] **Geofence arrival end to end:** save a Place, drive in, dwell 5–10 min, confirm Life360
  pushes "arrived at" to another member's phone.
- [ ] **Flight run:** `fly` Step 0 (new tunnels over the cable work in airplane mode, passed
  2026-11-21; a running hold keeping the spoof through the toggle is still open), then a real run
  with a second member watching. Gate #2: does iOS go back to real GPS when we stop setting?
- [ ] Retry Life360's >100 mph flight-detection gate now that speed is real (expected to still
  fail without altitude, but cheap to check).
- [ ] Drive parity: Drive lands within a minute or two of Spoof's timing; make the CoreDevice
  path follow the renderer's corner slowdowns and dwell exactly.
- [ ] Realism: per-edge speeds from Valhalla `trace_attributes`, jerk-limited ramps, a per-point
  jitter/step model, offline realism tests in the validator.
- [ ] **Behavioral engine** (stretch): a day planner above the movement engine (home → work →
  errand → home, believable dwell) that renders a full-day route. Record-and-replay of real
  traces as a baseline. Prior art: docs/research/behavioral-engine-prior-art.md.

---

## Backlog (parking lot)

- **Wireless:** drive the phone over local Wi-Fi after one USB pairing. The host still has to be
  on and on the same network (no untethered spoof without a jailbreak). Untested on iOS 27;
  airplane mode doesn't work over Wi-Fi pairing. Reference: `lvalen91/location_daemon.py`.
- **Long-lived live session:** hold the sim open and set on a ~1 s timer for live control.
- GPX import / export.
- Auto-reconnect / tunnel self-healing.
- Keep-awake helper while spoofing.
- Preset packs / shareable location files.

**Out of scope:** Life360 driver reports, hard braking and crash detection (real CoreMotion
sensors), and the literal "landed" flight push (needs real altitude).
