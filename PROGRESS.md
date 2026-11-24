# PROGRESS LOG

Newest entry on top. After a work session, add a short entry: what changed, what was decided,
what broke, what's next. Keep about the last 10 entries here. When it grows past that, move the
oldest to `docs/progress-archive.md` as one-liners.

## Current state (2026-11-22)

- **App:** Waypoint Mac app. Dock app = keyless dev build, `release.command` = key-gated production build with auto-update. Live release: 0.1.0-beta.2 (build 2, still on Stadia's rate-limited map), two testers.
- **No Xcode needed:** pmd3 11.59 CoreDevice path does set / route-with-speed / clear. Same on Windows (mph + car confirmed 11-20).
- **UI:** globe + "Arrival plan" side panel are in the app (11-20), dry-run tested only. Owner hasn't tried it in the Dock app yet.
- **Map:** OpenFreeMap vector tiles through MapLibre (11-21), no key or rate limit. Checked in Chrome and the Windows WebView2 window, not the Mac window yet. Ships with the next release.
- **Windows:** Waypoint window runs from the repo (`windows-version\waypoint.cmd`, 11-20) and works with the phone (pin, Drive, Stop, quit clears). Life360 shows mph + car from a Windows Drive run.
- **Phone is on iOS 27.2.1** now (was 27.0.1); Developer Mode survived, pmd3 11.59 still mounts and drives.
- **Airplane mode is pmd3 now (11-21)**, Mac + Windows: `CoreDevice.airplane(on)` runs the phone's Shortcuts, `fly` toggles it itself (owner confirms), `fly airplane on|off`. Nothing calls devicectl any more.
- **Flight-test tool & fallback prep built (11-22)**: `core/tools/flight_test.py` + launchers (`mac-version/flight-test.command`, `windows-version/flight-test.cmd`). CoreDevice only. MIA→MCO: terminal dwell, stepped runway roll (45/55/65/75 m/s, each ≤100 m from the real runway, +10 m/s steps for accel >0.5), climb, then the flight itself flown offline (cruise, descent, final, braking roll, taxi-in; `--air`, default 40 min), landing hold airside at MCO (405 m from a runway). Runway coords come from Life360's own `runways.csv`, not OSM. Fallback geofence arrival `mco-geofence-arrival.json`. Dry-run tested end to end; cleanup turns airplane mode back off then clears.
- **Movement engine is road-aware (11-22):** each road at its own speed (Valhalla `trace_attributes`: limits, ramps, roundabouts), red lights rolled per drive, inferred stop signs, slower turns, gentle stops, pull-away that eases off with speed. Road data cached beside the snap cache (bundled in releases), offline falls back to one speed. Offline-tested only; not watched on Life360 yet.
- **LinkedIn demo prep (11-23):** pins `miami-beach` (Lummus Park) and `palm-jumeirah` (top of the trunk), and a short seeded drive `palm-trunk-to-atlantis` (2.1 km, ~4 min) that starts exactly on the Palm pin. A route JSON can carry `"seed"` so every Drive of it plays the same. Dry-run tested; the Dock app picks it up on its next launch.
- **Landing altitude gate resolved (11-22, smali):** the disputed sign in `g5g` is `altitude ≤ elevation+1000` — an upper bound a spoof at altitude 0 clears for free. `k5g` (the `flight-landed` upload) carries no altitude, so there's no second gate. No airplane-mode or mock-location check in `g5g`. (Still Android-only; iOS unseen.)

**Open:**
- **Active job: Life360's "landed" flight push** (owner's goal, 11-21). Handoff: `docs/handoff/flight-push.md`. Steps 1, 1b, 2, 3 complete; the landing-altitude sign is now settled (favorable).
  - Step 4 (when owner is back): set up spare iPhone (iOS 17+), positive control, run flight test on the spare with a test circle. Not the owner's phone in front of their real circle.
- Watch a road-aware Drive on Life360 (second member's phone): first, does the car + mph survive a red-light wait (a mid-drive CoreDevice `set` hold)? Then, do the waits show through its sampling? Tune the red-light odds from that.
- Owner opens the Dock app on the Mac and looks at the new map (WKWebView) before the next release.
- Never tested: a compiled build moving the pin on a real phone, a Mac with no Xcode, Intel Macs, a Windows installer (none yet).
- `fly` Step 0, hold half: does a running hold keep the spoof through the airplane toggle? Then a full `fly nyc` run.
- `fly` on the Mac: pmd3's DVT `play` waits for Ctrl+C after the route, which also cancels fly (from pmd3's source, not run).
- `fly` has no API in the app (launcher only), so it's not in the palette.
- Globe effects (stars/depth/night/rim/UFOs) are switches in the prototype, none picked yet.
- CRT scanlines sit over the new panel. Keep or drop?
- Old release zips pile up in Vercel Blob (~70 MB each).
- `isSimulatedBySoftware` still untested (see AGENTS.md).

---

## 2026-11-23 — Demo pins, a short seeded Palm drive, route seeds

- Owner's LinkedIn demo: phone at Miami Beach, ⌘K "Palm" Enter Enter jumps it to the Palm, then a Drive from that same spot, recorded three times (Find My, Life360, Snap Map) side by side, so the drives must match.
- `places.json`: `miami-beach` = Lummus Park, 25.780613, -80.129893 (OSM way 76677464), zoom 12 shows Miami Beach and Miami across the bay. `palm-jumeirah` = 25.125269, 55.123965, zoom 13 frames the whole palm. It is the snapped first point of the drive below. `region` decides the colour in the page (`cityColor`), the `accent` field is only kept for the record.
- `routes/palm-trunk-to-atlantis.json`: started at the base of the trunk (6.2 km, ~9 min); the owner wanted it shorter and from inside the Palm, so it now starts mid-span on the last stretch of the trunk's outbound carriageway (OSM way 498598212, oneway, no junction near), through the tunnel and round the crescent to the Atlantis driveway (way 94827855), 30 s stop. 2,148 m, Drive 3:29 + 0:31 = 4:00. The snapped line sits exactly on the old `palm-jumeirah-drive` line that already played on the phone (0.0 m off), no turns over 100°. No traffic lights on the Palm, so no red-light waits for any seed.
- **Route seeds:** `plan_chunks` takes the route JSON's `"seed"` when no seed is passed (`route_seed()`); `drive --seed` and the flight test's 42 still win, routes without one stay random. Every random draw on the Drive path (driver, lights, stop signs, turns, drift, jitter, wander) already came off that one `rng`. Swept 60 seeds, all validate clean; picked 16 (fewest phone calls, 14).
- **Proof:** planned the seeded route in two processes (different PYTHONHASHSEED) → identical calls, start times and route-file payloads, and identical to the 13 files the dry-run app wrote. Two unseeded plans of `palm-jumeirah-drive` differ. `tests/test_route_seed.py` (+6, 163 pass). Only call latency (~0.8 s per call on the Mac) varies between takes.
- Dry run: ⌘K "Miami Beach" → only the new pin; "Palm" → pin first, the new drive second, the old route fourth; `play palm` ↵ ↵ ↵ plays it via Drive (Drive is preselected). Leave ~¼ s between Enters (`CONFIRM_GUARD_MS`). First coordinate sent is 0.3 m from the pin.
- Found: the Dock app wasn't running when this session started; its log ends 18:57 with "coredevice clear failed: Device is not connected" (quit while unplugged), so the phone's state then was unknown. Didn't touch the phone or the real app.
- Next: owner relaunches the Dock app (code + the page's place list both need it), plugs in, records.

---

## 2026-11-22 — Flight test flies the whole way now (no more jump to MCO)

- Owner's first real run: airplane mode was on ~20 s before the landing. The tool also jumped the spoof straight to the MCO hold the moment airplane mode went on, so Life360 would have seen a ~310 km flight that took a minute. From `g5g`: the stored takeoff time is refreshed to the latest MIA fix every >3 min at the airport, the landing time is the phone's clock at the landing fix, and the upload carries both times (no flight number). So a realistic air time matters.
- `flight_test.py`: after the climb, a turn-out, cruise, descent, a 15 km straight-in final from the south onto the MCO runway, a braking roll and taxi-in to the airside hold play **offline**, fix by fix, starting straight from the climb (airplane ON is sent while the turn-out plays). `--air MIN` (default 40) sets it; the cruise speed is solved to fit, clamped 110-240 m/s (~25-48 min fits). Airplane OFF goes out on its own once it's taxied in. Every fix within 1000 m of an MCO runway is >100 mph until the 67 mph `brake2` leg, so landing fires on the roll-out; fast fixes near MCO don't overwrite the MIA record (g5g only refreshes it for the same airport).
- Tests: 156 pass (+8: air time, cruise clamp, no jumps, landing only on the roll-out, nothing slow anywhere else, mid-flight Ctrl+C turns airplane off). `VIDA_DRY_RUN=1 ... --quick` clean.
- **Mistake, 16:30:** I ran a `--quick` check with the wrong dry-run variable (`DRY=1`), so it hit the real phone: MIA hold, 1 s per leg, MCO hold, then clear, about 15 s total. The airplane-on Shortcut failed ("The application failed to launch", probably phone locked) so airplane mode was most likely never toggled. Cleared by hand straight after (`clear` returned True). The dry-run variable is `VIDA_DRY_RUN=1`.
- Next: owner's run with Life360 in the foreground the whole time, `--wait 20 --air 40`.

---

## 2026-11-22 — Flight test shortened (owner wants to fly MIA -> MCO on their own phone)

- Owner dropped the "arrived at a Place" drive test: the goal is only the airport "landed" push. They want to run the flight on their own phone and circle now, not the spare.
- `flight_test.py`: the MIA terminal hold (was 20 min) and the post-landing hold (was 12 min) are now `--wait` / `--land-wait` in minutes, both default 5. The offline gap is still ENTER-gated; it prints when it went offline and a "land around HH:MM" hint (35 min, about a real MIA -> MCO airtime). Total run is about 45 min now, not 1.5 h.
- Tested: 148 tests pass, dry-run `--quick` flight clean before the change. Not run on the phone yet.
- **On the phone (first real flight run, 14:35):** the MIA hold landed (Find My moved) but Life360 on the circle kept showing home, "3 min ago", until the owner opened Life360 in the foreground on the spoofed phone. Then it updated straight away. So a CoreDevice jump doesn't wake a backgrounded Life360; keep Life360 open on screen for any hold or drive that has to be seen, above all the ~30 s takeoff burst. First run ended when the Terminal window got closed by accident; rerun from 14:41.

---

## 2026-11-22 — Movement engine: lights, stop signs, a speed per road

- Task (owner): make driving realistic before the flight test; it never teleported but flew through every light at one speed. Did all four: per-road speeds, lights + stop signs, real turns, smoother ramps. Phone not touched.
- **Data:** `snapper.road_edges` asks Valhalla `/trace_attributes` what the snapped line runs over. `edge_walk` fails on `/route`'s own shape (error 443), `walk_or_snap` works (105 km in 1.4 s). Edges are laid on our line by matched length (`roads.map_edges`). Cached as `snap-cache/<key>.roads.json` so `build.command` bundles it; route list is cache-only, `warm_legs` fetches, 1 req/s, network failures back off 5 min. All 34 road-aware drives are cached on this Mac.
- **Stop signs are inferred** from the road hierarchy: Valhalla has no stop-sign field and Overpass answered 502 "at capacity, for human-operated tools". Lights are real OSM signals (via Valhalla), dual-carriageway pairs merged.
- **Renderer rewritten:** a speed cap every 5 m (road speed × a per-drive driver pace + a few % drift, bends over ±10 m, turn caps, U-turn crawl), split at every full stop, backward/forward passes with speed-dependent pull-away and gentle stop braking, timed exactly. Waits are `LocationFix.hold`. Found + fixed on the way: the bend formula read a line folding back on itself as straight (the JFK route has real U-turns), so U-turns are now caught by the bend check itself (>120° within ±10 m → 2.5 m/s).
- **Drive:** waits are parked `set` calls that stay "drive" legs (live card doesn't say parked), 3 s chunks near rest, slivers folded, no averaging across stops, wander ±12% → ±5% and kept under 75 mph (miami-drift keeps its 80).
- `emoji-test` and `miami-drift` are `"steady": true` (one variable each, on purpose). Generated routes' `speed_mps` is now only the offline fallback.
- **Numbers (all 39 routes, offline, seed 0):** 0 errors; validator warnings 27 → 1 (miami-drift's deliberate 80 mph); peak accel 2.69 → 1.98; rendering all routes 23 s → 2 s; 158 waits; drive times median +3.5% (JFK → Manhattan +46% with 26 lights). `LEGS_VERSION` 2, so the app re-times every route.
- **Seed sweep (31 seeds × 39 routes, since Drive rolls a new seed each run):** seed 0 was a lucky draw, ~12% of renders grazed the 2.0 accel review line. Brought the driver's accel/brake ranges down a little (jitter adds ~0.2) and fixed rounded U-turns + a few chunk slivers: now 0 errors, 1.4% of renders with one or two fixes at 2.00-2.09 (hard fail is 2.85), and no move chunk under ~1.9 s.
- **Tested:** 148 tests (+38: `test_roads.py` off a saved MCO road-data fixture, `test_drive_chunks.py`, rewritten `test_speed_planning.py`). `gen_destinations.py --check` 33/33. Dry-run Drive of faena → LIV (waits logged as "waiting", one drive leg), dry-run `flight_test.py geofence --quick`.
- **Not tested:** any of it on the phone / Life360. Unknown: what iOS reports for speed during a mid-drive `set` hold (0 or -1), whether Life360 keeps the car + mph through a 40-75 s red light or ends the trip, whether its sampling shows the stops at all. Stop-sign holds of 1-2 s are shorter than a Windows call (~1.5 s), harmless. Spoof's GPX is seed 0, so it hits the same lights every time; Drive rolls new ones per run.
- Next: watch one road-aware Drive on a second member's phone; then the flight test (Step 4) as planned. The flight test itself doesn't use the road engine, only its geofence fallback does.

---

## 2026-11-22 — Flight tools: offline review + cleanup-safety fixes

- Task: review the flight-test work for bugs, offline (phone not connected). Re-verified every takeoff/landing coordinate in `flight_test.py` against the real decompiled `runways.csv` + a fresh port of `Runway.distanceFromMeters`, and re-traced the Android gate state machine in both jadx and smali (`g5g`/`k5g`, 26.44.0). **Geometry and the gate logic hold up** — the takeoff candidate arms at the MIA terminal (703 m from the nearest runway), the stepped roll fires takeoff with real acceleration, and the MCO reconnect hold reaches the landing-fire branch (altitude ≤ elev+1000, runways 310 km apart). No functional bug in the happy path.
- **Fixed — the "never leave the phone offline" invariant had holes:**
  - `flight_test.py`: `airplane_on` was set *after* the ON toggle, so a Ctrl+C during the "is the airplane icon showing?" confirm (a `KeyboardInterrupt`, which `_safe_input` doesn't swallow) skipped the airplane-off cleanup. Marked on before the toggle now (the shortcut send goes first anyway).
  - `flight_test.py`: wrapped both teardown blocks in a `_shield_signals()` context manager (SIGINT/SIGTERM/SIGHUP → SIG_IGN, main-thread only) so a *second* interrupt can't abort cleanup mid-way and strand the phone offline / on a fake fix.
  - `fly.py`: cancelling after take-off (the normal Ctrl+C path, which its own test exercises) never turned airplane mode back off — it left the phone stuck offline. Now tracks `airplane_on` and flips it back off in `finally`, same as flight_test.
- Fixed a comment/print that said the MIA terminal is "703 m from MIA_RWY" — it's 855 m from MIA_RWY (the 09/27 roll); 703 m is to the *nearest* MIA runway, which is what actually arms the candidate.
- Tests: +2 (`test_interrupt_during_the_ON_confirm_still_cleans_up`, `test_ctrl_c_after_takeoff_turns_airplane_back_off`). **110 pass**; all dry-run modes clean. Nothing touched the phone.
- Next: unchanged — Step 4 still needs the spare iPhone + test circle.

---

## 2026-11-22 — Flight push: flight-test tool + fallback built, landing-altitude sign settled (steps 1b/2/3)

- Task: continue the flight-push job from `docs/handoff/flight-push.md` (a local model had drafted the tool). Settled the one disputed RE number, then reviewed and fixed the tool before calling steps 2 & 3 done.
- **RE, smali-confirmed (`g5g.smali`, 26.44.0):** the landing altitude comparison is `getAltitude() > elevation+1000 → skip` — i.e. the gate is `altitude ≤ elevation+1000`, an upper bound a spoof at altitude 0 clears. So the earlier "pass 2" reading was right and my own re-read was wrong. `k5g.java` (the `com.life360.device.device-flight-landed.v1` upload) carries only takeoff/landing airport codes + times, **no altitude** — no second gate. No airplane-mode / mock-location check anywhere in `g5g`. The landing path only needs the loose ≤1000 m "nearby runway" record set at airport A, not a confirmed >100 mph takeoff. Net: on Android every gate is satisfiable on our stack at altitude 0. Still Android-only; the iOS build is unseen. Writeup: `docs/research/life360-flight-detection.md` (2026-11-22 smali update).
- **Flight-test tool (`core/tools/flight_test.py`), CoreDevice only (no DVT speed −1):** MIA→MCO (~310 km / 193 mi; runways ~310 km apart, well past the 40 mi gate).
  - Runway geometry is pulled from Life360's own bundled `runways.csv` rows + a port of `Runway.distanceFromMeters`, so proximity is measured the way the app measures it. The MIA 09/27 runway (start `25.78610,-80.31484`, 3963 m) is the takeoff roll.
  - Sequence: dwell at the MIA terminal (855 m from the runway → arms the ≤1000 m candidate) → taxi → **stepped** roll 45/55/65/75 m/s, every point ≤100 m from the centreline, each +10 m/s step over ~5 s so accel ≈2 m/s² (>0.5 gate) → climb pulling east off the runway → airplane ON → move offline to the MCO landing hold (`28.4336,-81.3000`, 405 m from an MCO runway — the main terminal is ~1200 m and misses the gate) → airplane OFF → post-landing dwell → clear.
  - Each leg is played with `backend.drive.play_chunks`, so it's held for its own distance/speed (the earlier draft fired a route then slept a few seconds, teleporting past km-long legs). `--quick` shrinks only the waits. Cleanup (Ctrl+C / error) turns airplane mode back **off** if it was on, then clears — never leaves the phone offline on a fake fix.
  - Launchers: `mac-version/flight-test.command`, `windows-version/flight-test.cmd`.
- **Fallback geofence trip (`core/routes/mco-geofence-arrival.json`):** approach drive into the saved MCO Place at varying road speed (real mph + car icon), 300 s dwell. Run via `flight_test.py geofence`.
- **Tested:** rewrote `test_flight_test.py` to check geometry against the runway formula (firing points ≤100 m from the runway, accel steps >0.5, both holds ≤1000 m, runways ≥64,373.6 m apart, each leg held ≥ its distance) plus the interrupt→airplane-off cleanup. **108 tests pass** (`.venv/bin/python -m unittest discover -s core/tests`). End-to-end dry run across every mode (`flight`/`geofence --quick`, `airplane on`, `--clear`, `status`) with piped answers.
- Git identity set up on this Mac: committing as `juanmendoza <juanmendoza6159@gmail.com>`, signing with `~/.ssh/id_ed25519.pub` (registered as a GitHub signing key "Mac-waypoint"), so commits verify.
- Next: Step 4 (owner back): spare iPhone setup, positive control, run the flight on the spare.

---

## 2026-11-21 — Flight push: dtlocationd looked at, handoff updated

- Task: prep for the "landed" flight push while the owner's away. Nothing built, phone not touched.
- Cached DDI has `dtlocationd` + `CoreDeviceUtilities`; 7-Zip reads the APFS images on Windows. Installed Ghidra 12.2 + jadx 1.5.7 under `C:\Users\superCookie\tools` (hashes match GitHub), extracted to `C:\Users\superCookie\work` (outside the repo).
- **Strings result:** `dtlocationd` wraps `CLSimulationManager` and only reads `latitude`/`longitude` (`initWithLatitude:longitude:`, one speed per run). No altitude anywhere in it or `CoreDeviceUtilities`. So `set`/`start` can't carry altitude. The scenario-from-URL path (`SetLocationScenario.Input.fromURL`) is the one open lead; that logic is in CoreLocation (shared cache), not the DDI.
- Owner widened access in chat: full phone access, tokens OK (no `.env` on this PC yet). Rules kept in the handoff.
- Next: Ghidra pass, APK static analysis, flight-test tool. All in `docs/handoff/flight-push.md`.

---

## 2026-11-21 — Airplane mode without Xcode (Windows)

- Task: toggle airplane mode without devicectl so it works on Windows (ROADMAP path 1, the last devicectl call).
- **Found, on the phone from Windows:** no CoreDevice feature opens a URL (85 RSD services; appservice's 15 features, none for URLs). What works: `launchapplication` for `com.apple.shortcuts` with `options.payloadURL = {"relative": url}`, devicectl's `--payload-url` field. Shape from DIYgod/pinky's Go driver. pmd3's `launch_application` can't carry it, so our helper builds the input. No pmd3 upgrade. devicectl itself wasn't captured (Windows).
- Harmless checks first: `open-shortcut?name=vida-airplane-on` opened the editor; a throwaway `vida-ping` (Vibrate) Shortcut ran silently, no prompt, from cold and with Shortcuts open, terminateExisting false and true (3/3 in a row with true).
- **Gate 0, transport half, passed:** with airplane mode on and Wi-Fi off, usbmuxd still lists the phone on USB, tunnels come up in ~0.23 s, CoreDevice calls work, airplane-off goes out the same way. 3 on/off runs, the last through the built `fly airplane on|off`. A second tunnel works while another process holds one open. **Hold half untested** (owner chose no hold).
- The launch reply is a processToken that comes back before the Shortcut runs, so success = "sent", not "toggled".
- Built: `device.py` `cd_launch_input`, helper action `openurl` (on the appservice), `CoreDevice.open_url` / `airplane(on)`, dry-run stand-in, terminateExisting on. `fly.py`: the airport holds are background `Pmd3.hold` Jobs so each toggle fires while the hold runs; ENTER = take off / land; the owner answers y to confirm the flip, anything else → toggle by hand + ENTER; Ctrl+C lets go of the hold. Tests: 3 new in `test_coredevice.py`, new `test_fly.py` (7). **91 run, 10 skipped.** A dry `fly nyc` touches nothing (drives, mount, holds, toggles all dry), checked end to end with piped answers.
- Found, not fixed (both there before): pmd3 11.59's DVT `play` doesn't exit after the route, it waits for ENTER (Windows) / Ctrl+C (Mac), so on the Mac that Ctrl+C cancels fly (from source, not run). And there's a ~1-2 s gap between DVT processes (drive → airport hold, arrival hold → drive-in) with nothing held while online.
- Windows: usbmuxd (Apple Devices' `AppleMobileDeviceProcess`) wasn't running. Opening Apple Devices started it; the phone listed only after a replug.
- Not in the app (fly has no API), noted in ROADMAP path 2. No release.
- **Not tested:** a full `fly nyc` run, a running hold through the toggle, any of it on the Mac.
- Next: Step 0 hold half (hold a point, toggle, owner checks Maps), then a real flight with a second member watching.
- Later the same day, the owner picked the goal: **Life360's "landed" flight push**, not the drive and not the geofence arrival. Worked out:
  - `fly`'s DVT drives report speed −1, so they can never pass the >100 mph gate. The flight test has to be CoreDevice.
  - pmd3 has screenshot commands for the phone (untested on iOS 27).
  - The Observer can't see pushes and has no token on this PC.
  - An Xcode simulator can't run Life360, so there's no "other phone" without hardware. The owner has a spare iPhone (Lightning; needs iOS 17+) to set up as a test traveler.
  - The owner OK'd static analysis of Life360's Android app. Plan + rules: `docs/handoff/flight-push.md`.

---

## 2026-11-21 — Map off Stadia, onto OpenFreeMap

- Task was getting the Stadia key into release builds. Checked first: Stadia's Free plan is non-commercial (Starter $20/mo for a paid app), desktop apps use an API key with no domain setup, and their limits page bans proxying tiles (so the Vercel proxy idea was out on terms too). Owner asked for a free alternative instead. Only OpenFreeMap is free + commercial + keyless + uncapped. CARTO gives 1M free commercial tiles but its key "must not be shared", MapTiler/Protomaps free tiers are non-commercial. OpenFreeMap is vector only, so the app draws the map itself.
- Side-by-side test page (throwaway, scratch dir): stock OpenFreeMap dark was much darker and flatter than Stadia; a quick recolour got close. Owner picked it.
- Built: MapLibre GL 5.24.1 + `leaflet-maplibre-gl` 0.1.4 vendored in `core/web/static/maplibre/` (copied untouched into the release, like Leaflet). `core/tools/build_map_style.py` → `core/web/static/map-style.json` (their dark style + the test page's colours; it also drops 3 images their sprite doesn't have; stops if a recoloured layer disappears upstream). `app.js` swaps the one `L.tileLayer` for `L.maplibreGL`; `maxZoom:20` moved onto the map. `tilesReady` now waits for a real tile, because MapLibre's `load` fired with OpenFreeMap blocked and the card said "Tiles loaded".
- No dashboard change, no Vercel env var, no Stadia account needed.
- **Tested (dry run):** Chrome headless (software GL): map ready ~2.7-3.9 s after page load (Stadia raster was ~0.6 s), boot step still `[ OK ]` since it runs ~11 s in; blocked OpenFreeMap → `[ OFFLINE ]` + card "Loading…" (same as Stadia blocked); France / Paris z15 / Miami route preview, route lines sit on the same roads as on Stadia; resize; real mouse on the street map (hover POS, drag pans, wheel zooms, click drops the pin + "Set location here"); license-gated server against a local `/api/check` stub (map files 200 while the API is 402, map full size after unlock). **Windows WebView2 window** (RTX 2060, D3D11): map draws, Paris → Saint-Tropez flyTo worst frame 7 ms, no console errors, closes cleanly. Release staging (`stage_assets.py` to a temp dir): minified app.js passes `node --check`, maplibre + style copied as is.
- Tests: `test_map_style.py` (7), locked-state test in `test_license.py` also asks for the map files. 87 run, 10 skipped (updater, Mac only).
- **Not tested:** the Mac window (WKWebView, WebGL should be fine), a compiled release build, the look next to Stadia on a real Retina screen.
- Found: `stage_assets.py` opens files without `encoding=`, so on Windows it dies on cp1252 (fine on the Mac; `PYTHONUTF8=1` works). Matters only when Windows gets a release build.
- Not in yet vs Stadia: road-number shields (A4201, I-95), slightly smaller labels. Both are style edits in the tool if wanted.
- Owner OK'd it, so the old Stadia redirect is gone (`/tiles/` route, `tiles.py`, `test_tiles.py`): 81 run, 10 skipped. `VIDA_STADIA_KEY` in the Mac's `.env` does nothing now.
- Next: owner looks at it in the Dock app (`git pull`, no rebuild, it runs the repo), then a release when they say.

---

## 2026-11-20 — Windows: the Waypoint window

- Owner's goal today: a working Windows version, run from the repo folder (no installer). Checked this PC first: Apple Devices app installed, usbmuxd up, `.venv` on 3.12 + pmd3 11.59, test suite 80 run / 10 skipped (updater, Mac only), `server.py` serves the page in dry run with both engines.
- New `windows-version/app.py`: same flow as the Mac app (uvicorn thread, frameless pywebview window on Edge WebView2, `use_placer(drive)`, closing hides, clears the phone, then exits). Titlebar drag = `ReleaseCapture` + `WM_NCLBUTTONDOWN`/`HTCAPTION` on the form's thread, so it's native and the window follows the cursor exactly. No splash (it's AppKit), no updater. Under pythonw stdout goes to `%LOCALAPPDATA%\Waypoint\Waypoint.log`; pmd3 run from pythonw still returns its output.
- `waypoint.cmd` (pythonw, no console) and `drive.cmd`. pywebview + pythonnet + clr-loader pinned for win32 in requirements.txt.
- Dry-run hold stand-in now waits on stdin, so Windows' Stop (ENTER) ends it at once; it used to sit 5 s then get killed. Mac's SIGINT still ends it.
- Page shows Ctrl+K / Ctrl+V off a Mac (was the cmd symbol).
- **Tested, dry run, on this PC:** window opens with globe + panel, Ctrl+K opens the palette in WebView2, titlebar drag moved the window exactly with the mouse, page x and WM_CLOSE both exit in 2-3 s, pin + route + Stop through the API (Stop ~60 ms).
- **Then with the phone (iOS 27.2.1, USB):** connect probe ready in ~7 s (DDI already mounted). `server.py`: Eiffel DVT hold, Stop sent ENTER, pmd3 exited, clear ok in ~3 s. Drive `emoji-test`: 16 of 48 speed chunks over 2.5 min, all accepted, none late, ~1.5 s a call (Mac ~0.8 s), Stop cleared the CoreDevice sim. The window: Live, map on the Eiffel pin (through Drive's placer), page x with the pin on exited in 4.7 s after the clear (no warning). `drive.py --clear` exit 0.
- Owner confirmed afterwards: **Life360 showed mph + the car** during the Windows drive.
- **Not tested:** the key gate, other DPI scales, `fly` on Windows.
- Commits now go out as juanmendoza (AGENTS.md, Git).
- Next: the Stadia map key for release builds (owner wants it in a fresh session). Windows packaging only once Windows testers are wanted.
