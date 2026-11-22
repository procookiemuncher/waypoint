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
- **Flight-test tool & fallback prep built (11-22)**: `core/tools/flight_test.py` + launchers (`mac-version/flight-test.command`, `windows-version/flight-test.cmd`). CoreDevice only. MIA→MCO: terminal dwell, stepped runway roll (45/55/65/75 m/s, each ≤100 m from the real runway, +10 m/s steps for accel >0.5), climb, airplane-mode gap, landing hold airside at MCO (405 m from a runway). Runway coords come from Life360's own `runways.csv`, not OSM. Fallback geofence arrival `mco-geofence-arrival.json`. Dry-run tested end to end; cleanup turns airplane mode back off then clears.
- **Landing altitude gate resolved (11-22, smali):** the disputed sign in `g5g` is `altitude ≤ elevation+1000` — an upper bound a spoof at altitude 0 clears for free. `k5g` (the `flight-landed` upload) carries no altitude, so there's no second gate. No airplane-mode or mock-location check in `g5g`. (Still Android-only; iOS unseen.)

**Open:**
- **Active job: Life360's "landed" flight push** (owner's goal, 11-21). Handoff: `docs/handoff/flight-push.md`. Steps 1, 1b, 2, 3 complete; the landing-altitude sign is now settled (favorable).
  - Step 4 (when owner is back): set up spare iPhone (iOS 17+), positive control, run flight test on the spare with a test circle. Not the owner's phone in front of their real circle.
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

---

## 2026-11-20 — Docs cleanup: progress log trimmed

- PROGRESS.md was 171 KB / 99 entries (~43k tokens read at the start of every session). Now it's a "Current state" block + entries from 11-18 on. Everything older is one-liners + a lessons list in `docs/progress-archive.md`, full text in git history.
- CLAUDE.md and AGENTS.md ground rules updated to match. Dropped AGENTS.md's stale "Windows only, v2 will move" intro and the "Download ZIP" note.
- AGENTS.md rewritten: fixed stale claims (tunneld/admin/wintun, iOS 26.6, "no JS", "movement engine is the missing piece"), the speed history collapsed into a DVT vs CoreDevice table, Running it split into sections, git part trimmed. 28 KB to 18 KB. `docs/handoff/` deleted (finished jobs).
- ROADMAP.md rewritten around the owner's four paths: 1 finish Windows, 2 keep adding to the UI, 3 start getting users, 4 improve the motion engine. Old M0-M4 milestones collapsed into a "Done so far" list; the emoji goal is marked done (drive path), stale iOS 26.6 / Windows-only vision gone.

---

## 2026-11-22 — Flight-detection: pass-2 Android RE checked, one sign disputed, not resolved

- Owner ran a local model over `~/Desktop/life360-re` (decompiled APK, `com.life360.android.safetymapd-26.44.0`) for a follow-up static pass on the flight-detection algorithm. Read the same source myself (`g5g.java`) before writing anything down.
- **Confirmed matches my own read:** the takeoff state machine (accuracy ≤400m arms a candidate within 1000m of a runway; fires at accuracy ≤100m, speed ≥100mph, within 100m of the runway, acceleration >0.5 m/s² from a 3-6s-prior buffered sample, 20-min debounce; altitude fallback to FLYING at elevation+5000m is an OR, not required). No `AIRPLANE_MODE` or `isFromMockProvider`/`isMock` reference anywhere in `g5g.java` — this specific feature doesn't appear to gate on either, on Android.
- **Disputed:** pass-2 said the landing altitude check is `altitude <= elevation+1000` (an upper bound, satisfiable at altitude 0). My own read of the same branch shows `altitude > elevation+1000` — the opposite sign. This is the one thing that decides whether the literal "landed" push is worth another on-device attempt or stays a confirmed no. Could be a jadx decompiler artifact (the surrounding control flow is heavily obfuscated/flattened) or pass-2 misreading it — not resolved either way.
- Also found: `is_mocked_flying_user_activity_enabled` behind a `p72.f129539a` flag — an internal Life360 debug toggle for mocked flying activity, unrelated to our spoof, not previously documented.
- Full analysis + plan: `docs/research/life360-flight-detection-pass2-android-re.md`. `life360-flight-detection.md` status flipped to `under re-evaluation` — did **not** touch its NO conclusion or AGENTS.md's "not reproducible" line, since nothing here is device-verified and the core caveat stands: this is all Android, our target is iPhone, there's no decompiled iOS build in `life360-re/`.
- Next: a smali-level check of `apktool/.../g5g.smali` around the landing-altitude comparison (not jadx) to settle the sign, and check whether a second, later altitude gate exists before the real `/v1/ingest` POST (possibly in `k5g.java`) — before any route code gets written. If it confirms the high-altitude reading, this closes back to NO and the useful parts (confirmed takeoff state machine, the reset condition) fold into the geofence/realism work instead.

## 2026-11-20 — Side panel built: the arrival plan, the globe in the app

- Owner picked **design 1, Arrival plan**, and said to put it in the app. Built on a worktree (`panel-work`).
- **Catalog:** one colour per country (`"countries"` in destinations.json, the prototype's HUE table with vibe names), per-city colours and the flags removed. `/api/cities` adds the airport name, base hotel, colour and vibe; spots carry `note`/`access`; places.json presets say `saved`.
- **Route times fixed:** `/api/routes` `seconds` + new `legs` come from the seed 0 render (what Spoof plays), so walks count (Dorchester → Sexy Fish: 10 min before, 19 now). ~12 s to render all 40, so it's a thread after launch (`warm_route_legs`, both the Mac app and server.py) with a disk cache in `<build>/legs-cache/`, estimates + `exact: false` until then (estimates run 3-30% short, the renderer brakes for bends). Generated routes send `from`/`to`. Spoof and Drive send `legs` for the playing run on its timeline's clock. Tests: `core/tests/test_route_legs.py`, 80/80 pass.
- **The page:** `globe.js` + `countries.json` in `core/web/static/` (globe.js added to MINIFY_JS). World list grouped by continent turns the globe on hover; a click zooms the globe in and fades it out over the street map, framed on the country underneath; back fades it in. While something plays the globe lights that country. A country is its cities' arrivals (airport → hotel → spot, branches when a hotel has 2+ ways out), test routes and saved places under "Also in". The dock (picked card + live card) replaced the hero and now-playing cards: "Leave now, at the door 9:14 pm" and open/closed then, walk/drive/parked columns, Drive/Spoof, mph, Play; live card from the server's timeline and legs. Pins: map click or ⌘K go (opens the address's country), with an ✕ to drop them. Console in Inter, help/ls in columns. ⌘K opens countries (a city name finds its country), colour dots instead of flags. City cards, map thumbnails, emoji flags gone.
- Skill `lint.mjs --app core/web`: **19 FAIL / 120 WARN before, 10 FAIL / 89 WARN after.** What's left is outside the panel: the window's ring/frame, map sweep, status bar gauge, CRT overlay, connect + key screens (gradients, glass, mono HUD chips).
- **Tested, dry run only, Chromium 1440×900:** world/France/Japan/route/playing/place/pin screenshots read; scripted checks pass for a globe click opening France, back, ⌘K open + play from the world list, typed mph surviving status polls, world list showing the live country, Follow from the world list, Esc stops, `go place vendome paris` (opens France, named pin), `ls`, `reset`, no false "lost the local server". Release staging (`stage_assets.py` to a temp dir) minifies app/globe/palette and they pass `node --check`.
- **Not tested:** the Mac window itself (WKWebView; Playwright's WebKit build didn't match), a real phone, a release build, Windows. The CRT scanlines still sit over the new panel; say if they should go.
- Next: owner opens the Dock app and tries it. Then maybe the globe effects (stars/night) once picked, and a structured season field so Club 55 can say it's out of season.

---

## 2026-11-20 — Side panel: 5 mockups to pick from

- Brainstormed nine directions, mocked five that are different answers to what the panel *is*: **1 Arrival plan** (a city as airport → hotel → spot, the pick says when you'd be at the door and if it's open then), **2 Local clock** (world list by local time, a city as a strip from 30 min back to 3.5 h ahead with routes as bars in their legs and spots in their hours), **3 Ledger** (sortable tables), **4 Atlas** (index in large type, a cover in the country's colour, every route drawn as its own line, bends the no-thumbnails rule), **5 Rail + sheet** (questions the frame: country rail + preview-on-hover sheet, the phone's live state moved to a strip under the map). Each covers world/France/Japan/route/playing plus place and pin. `docs/design/side-panel-mockups/` (README there), same globe and colours, `?d=&s=&now=` in the URL.
- New `dump-data.py` there: lib.js + airport names, base hotels, spot notes, `generated`, each generated route's ends, and per-route walk/drive/parked legs from the renderer at seed 0. **Found: `/api/routes` `seconds` under-reports walks** (distance ÷ first moving speed, walk-only routes get none): The Dorchester → Sexy Fish London says 10 min, plays 19. The build should send legs or the rendered total. `generated`, spot `note` and `access` aren't in the API either.
- Spot notes are free text, printed as written, never turned into open/closed. A structured season/days field would let the panel say Club 55 is out of season in November.
- Skill `lint.mjs --app` on the mockups: 0 FAIL, 19 WARN (1px inset outlines, clock zero-padding, the app's own em dashes in console lines). `inspect.mjs --app` passes at 1440; fails at 768/390 (mockup switch bar, the 60/40 frame doesn't fold), not worked on.
- Another session was working in the main checkout at the same time (star sky on the prototype globe), so this went on a worktree (`sidepanel-work`). The screenshots are gitignored (`shots/`, contact sheet at `shots/index.html`).
- Next: owner picks (or mixes) a design. Then the build listed in the brief, with the route-time fix above.

---

## 2026-11-20 — Globe: stars, depth, night side (on trial in the prototype)

- Owner wanted the globe to feel less basic, suggested realistic stars. Built four effects as switches in the world-view prototype's bar (`docs/design/world-view-prototype/`), all off in `globe.js` unless turned on, so style A is still the baseline: **Stars**, **Depth**, **Night**, **Rim**. Nothing picked yet, nothing in `core/web/`.
- Stars are real: new `core/tools/build_stars.py` → `stars.json` (Yale Bright Star Catalog via brettonw's MIT JSON, 8,404 stars to mag 6.5, 172 KB). `sky.js` draws them on their own canvas under the globe: gnomonic lens, RA turned by sidereal time so the stars behind the globe are the real ones, size/alpha from magnitude, a faint tint from temperature, soft halo on the bright ones, no twinkle. Sky Drifts (12% of the globe's turn) vs Real (all of it).
- Night uses the real sun position (subsolar point from UTC), soft over 18° of twilight. Depth is limb darkening. Both go on as one overlay worked out at 192 px and stretched. The hovered country is now drawn over the overlay, otherwise Miami pink went dull wine on the night side.
- Banding: the overlay's dark gradient (about a dozen 8-bit levels across hundreds of px) came out as stripes. Grain added after the blend did nothing (the steps were already baked in); it has to be in the overlay before it's blended, so the overlay is stretched to full device resolution on a second canvas and grained there. Checked with column averages: staircase gone. About 3 ms a frame with everything on.
- **For the app later:** CDS's own server (cdsarc) failed TLS from here, hence the GitHub copy. Rim uses a canvas radial gradient (the lint flags gradients, it'd be a deliberate exception). stars.json could be packed smaller if 172 KB matters for the DMG.
- Next: owner flips the switches and picks; then it goes in with the rest of the globe build.
- Later the same day: night colour is a navy now (black made the night side darker than the page and the globe's edge vanished), and the overlay buffer only grows (it was being rebuilt every zoom frame).
- **UFOs**, owner asked for "UFOs and flying aliens every once in a while": `visitors.js`, four kinds (hovering saucer with beam that zips off, saucer lapping the globe behind/in front, tumbling alien that waves, three lights that go out one by one), one at a time every 45-120 s, clipped by the globe when behind it, click one and it flees with a line in the bar. Summon button / U key cycles through all four. Off by itself under reduced motion. Tested headless: each kind on screen, click-to-flee, auto timer schedules the next, switching off stops it, a click on Paris still opens France.

---

## 2026-11-20 — World view: globe picked, side panel next

- Prototyped the globe outside the app. Owner picked **style A, solid silhouette** (sphere one tone, land one step lighter, no borders/texture/glow/grid) and then **a colour per country, shown on hover only**: at rest the globe is one tone, the hovered/open country fills with its own colour. 21 colours picked per place (Miami neon pink, Provence lavender, Majorelle blue...), all near the same OKLCH lightness and chroma, every one at least 3:1 against the land. Table is `HUE` in the prototype's `index.html`. List rows carry a dot in the country's colour, replacing the emoji flags (Windows can't draw them).
- New `core/tools/build_countries.py`: Natural Earth 1:110m countries (public domain) → a 148 KB JSON of outlines (2 dp, long edges filled in every 1.5°), named with our catalog's country names. St. Barths, Monaco, Singapore, Maldives and French Polynesia aren't in 1:110m at all, so they're dots at their city. Any other catalog country with no shape stops the tool.
- Prototype committed at `docs/design/world-view-prototype/` (README there): `globe.js` (orthographic projection on a canvas, no d3; still when idle, eases on a critically damped spring; points behind the globe pushed onto the rim, checked at the US/Brazil/Antarctica/Pacific edges), the app's real routes/places in `lib.js` (from `dump-lib.mjs` against a dry-run app), the country list and country panel. Not in `core/web/` yet.
- Numbers worth knowing: 19 of the 21 countries have routes (Maldives, French Polynesia are pin-only). France has 5 routes because "Demo mixed" lands in Paris. Hovering France also lights French Guiana, and the US lights Alaska + Hawaii (that's NE's shapes).
- Skill `lint.mjs` on `core/web` before any change: **19 FAIL / 120 WARN** (16 gradient, 3 emoji; 46 shadow, 39 mono, 14 glass...).
- Undecided: list grouped by continent or sorted by routes. The side panel reads as too basic; next session brainstorms it and mocks 5 designs. After that: the build (globe into the app, country colours into destinations.json, browse rewrite, globe → Leaflet crossfade, drop flags, lint after).

---

## 2026-11-19 — Auto-update + release.command, beta.2 is out

- Owner has a second tester (a friend, free key, daily use). Wanted updates without new DMGs, no update screen, only when the owner says to release (not every push). How it works is in AGENTS.md → "Releases + auto-update".
- New: `core/backend/updater.py` (+ `tests/test_updater.py`, 10 tests, real ditto/codesign/swap on a fake app), `mac-version/release/release.command`, BUILD in `build.command` (+ a compiled check that the signature code loads), dashboard `POST /api/update` (key → manifest) and `GET/PUT /api/release` (bearer admin password). Vercel Blob store `waypoint-releases` (public) on the dashboard project. Signing key `~/.config/waypoint/update_ed25519.pem`, **back it up**.
- **Shipped 0.1.0-beta.2 = build 2**, live on the dashboard, tag `v0.1.0-beta.2`, `~/Desktop/Waypoint-0.1.0-beta.2.dmg` (84 MB).
- Tested end to end against the live dashboard: a throwaway build 1 in a scratch HOME with a temp key found beta.2 at launch+90 s, downloaded and verified it, swapped on quit (SIGTERM path), the result passes codesign --strict, reports 0.1.0-beta.2 / 2, launches, and doesn't try to update again. Temp key deleted afterwards.
- make-dmg's `hdiutil attach` failed once ("Resource temporarily unavailable"), now retries. `SKIP_BUILD=1` resumes a release without recompiling.
- **Not tested:** the swap after a normal window quit (same function as SIGTERM, but not run), a phone moving from a compiled build (still), a Mac with no Xcode, Intel Macs (build is arm64 only).
- Open: old zips stay in Blob (about 70 MB each), delete old ones once there are a few. The Stadia key still isn't in release builds, so a daily user will hit the map's rate limit.

---

## 2026-11-19 — Waypoint runs without Xcode

- pmd3 9.33.1 → **11.59.0**, re-pinned exactly (pmd-pytcp 0.3.9, pmd-net-addr/proto 0.0.3, qh3 1.9.4, construct 2.10.70, plus fastapi/starlette/pydantic/uvicorn/requests since the app imports them). Existing CLI calls all still work. Built on branch `no-xcode-work` in a worktree (`../vida-360-no-xcode`) so the Dock app kept running main.
- `device.py` got `CoreDevice` (set / route with speed / clear) through a `python -c` helper, since pmd3's CLI has no command for it. Drive moved to `core/backend/drive.py` (same planning) and the Session registers it on every platform. Terminal: `core/tools/drive.py` (`drive.command`). `devicectl_route.py`, `drive_engine.py`, `phone_check.py` are gone.
- Connect screen: CoreDevice `getlockstate` is refused on iOS 27, so the lock comes from lockdown `PasswordProtected` (plain USB, flips with the lock screen like devicectl's, checked both ways). `auto-mount` once per plug-in, 15 min timeout. No more "open Xcode" message.
- **On the phone, with the owner:** reboot didn't leave the DDI off (Xcode's CoreDeviceService on this Mac put it back), so unmounted it with pmd3, it stayed off, then the app's connect path mounted pmd3's own Cryptex1 DDI in 10s. Eiffel pin showed in Maps and held after the helper exited. Steady 30 mph emoji-test: **Life360 showed mph + the car**. Varying chain (17 chunks in 2 min, ~0.8s a call): mph changed. Clear worked. Locked phone shows "locked" without a mount attempt.
- Release build (`LICENSE_URL` set, not --test, built to `~/Library/Caches/Waypoint-release-noxcode`): codesign ok, `usbmux list` ok, and the new coredevice `selftest` check in build.command ok. The compiled binary also read the lock and did a real (read-only) `scenarios` call to the phone. No DMG made.
- Tests: `core/tests/test_coredevice.py` (21), 59/59 pass.
- **Not tested:** the actual Waypoint window on this branch (owner signed off on the Session-level runs), a compiled build moving the pin, Windows at all, a Mac with no Xcode installed (this Mac still has it and CoreDeviceService runs; the unmount test stands in for it).
- **Seen once:** after clearing the steady route, Maps kept a grey dot on the last point until Location Services was toggled off/on. The next clear (after the varying drive) went back to real GPS fine. Watch for it.
- Next: rebuild the tester DMG from this, try the window, check `core-device launch-application` for the airplane Shortcut so devicectl can go completely.
