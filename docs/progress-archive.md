# Progress archive

Old PROGRESS.md entries, boiled down to one line each. The full text is in git history
(`git log -p -- PROGRESS.md`). Anything still true and important lives in AGENTS.md.

## Lessons worth keeping

- Dry runs skip pmd3, so they can't prove a compiled build works. `build.command` now runs `usbmux list` itself.
- An HFS+ DMG breaks the app signature (FinderInfo xattrs). Use APFS images.
- ~/Desktop is in iCloud, its xattrs make codesign fail. Release builds go to `~/Library/Caches/`.
- Nuitka needs `--no-deployment-flag=self-execution` so the app can run itself as `-m pymobiledevice3`.
- pywebview runs `closing` on the Cocoa main thread: anything slow there freezes the UI. Python signal handlers never run under the Cocoa loop (use a sigwait thread). End `main()` with `os._exit(0)` or a JS-bridge thread hangs shutdown.
- For CPU, measure in the real WebKit window. Headless Chromium tells a different story. A locked screen throttles WebKit to ~0.
- WebKit's cost is producing a frame plus a fixed cost per changing canvas, not what's drawn.
- Fresh installs pull deps newer than pmd3 expects and break the tunnel. Keep requirements.txt pinned exactly.
- Python 3.14 doesn't work (lzfse etc.). Use 3.12/3.13.
- Windows console is cp1252: no ⚠ ✗ — → in print/log lines.
- Sparse 2-waypoint legs collapsed to 0 speed in the planner. Fixed by densifying (today the renderer plans on a 5 m grid instead).
- At 80 mph a 1 s step cuts sharp snapped turns and trips the accel gate. Corner-aware slowing fixed it.
- Short, slow routes with a long dead stop don't register as movement on Life360. It samples displacement over time.
- Stadia's keyless localhost access is strictly rate limited and returns the error as a tile image.
- Valhalla `trace_attributes` with `edge_walk` fails on `/route`'s own shape (error 443). Use `walk_or_snap` and lay the edges on the line by matched length, not shape index.
- A bend's radius from three points reads a line that folds back on itself as straight (infinite radius). Real routes do U-turns; check the direction, not just the area.

## 2026-11

- 11-20 Side panel: 5 mockups (arrival plan, local clock, ledger, atlas, rail + sheet) in `docs/design/side-panel-mockups/`. Found `/api/routes` `seconds` under-reported walks (later fixed with rendered legs).
- 11-20 Globe effects on trial in the prototype: real star sky (`build_stars.py`, Yale BSC), night side from the real sun, depth, rim, UFOs. None picked yet.
- 11-20 World view: globe style A picked (solid silhouette, a colour per country on hover), `build_countries.py` (Natural Earth 1:110m), prototype in `docs/design/world-view-prototype/`.
- 11-19 Auto-update + `release.command` (Ed25519-signed manifest, Vercel Blob, swap on quit). Shipped 0.1.0-beta.2 = build 2.
- 11-19 Waypoint runs without Xcode: pmd3 11.59, `CoreDevice` set/route/clear in device.py, lock state from lockdown. Life360 showed mph + car on the phone.
- 11-18 Research + probe for dropping Xcode: devicectl's speed sim is phone-side (`dtlocationd`, RSD `com.apple.coredevice.locationservice`), pmd3 11.59 looked like it fixed the ApBoardID mount crash. `probe_coredevice_location.py` + `probe-no-xcode.command`, nothing on the phone yet.
- 11-04 Release app crashed every 4 s (pmd3 child segfault via inquirer3/editor under Nuitka), fixed by stubbing `editor`. Dock app became the keyless dev build with a DEV BUILD badge.
- 11-02 Stadia API key for map tiles via `/tiles/` redirect (`tiles.py`). Key in root `.env`, not in release builds.
- 11-02 "Account limit exceeded" on the map = Stadia keyless rate limit. `updateWhenZooming:false` cut tile use.
- 11-02 ⌘K: `go <address>` via Photon geocoding (`geocode.py`), flies there and drops a movable pin.
- 11-02 ⌘K command palette (`palette.js`), confirm step before anything reaches the phone.

## 2026-10

- 10-31 First tester DMG 0.1.0-beta.1 (later found broken, deleted 11-19).
- 10-31 Key screen redesigned twice (Silk shader + glass card).
- 10-31 Access keys: `license.py` + key dashboard (Next.js on Vercel, Upstash Redis), server 402s while locked.
- 10-31 Release build ships minified JS/CSS and XOR-obfuscated JSON (`secret.py`, `stage_assets.py`).
- 10-31 Closed a DNS rebinding hole: server only answers Host 127.0.0.1/localhost.
- 10-31 Nuitka release build of Waypoint.app builds, signs and launches.
- 10-30 App wouldn't reopen after closing: added a reopen handler + `os._exit(0)`.
- 10-30 CPU profiling: the window ring is nearly all the app's CPU. Speed gauge moved to `transform`.
- 10-30 45 s cinematic trailer (`cini videos/v2/trailer/`).
- 10-29 Launch polish: splash, glass intro, new app icon (the Leap), black-window and slow cold start fixes.
- 10-28 / 10-27 Idle resource check, performance/battery pass, ring burst on phone ready, 12 s sting video (`cini videos/v1/`).
- 10-24 Destinations catalog: 35 spots in 28 cities (`core/destinations.json` + `gen_destinations.py`).
- 10-24 Airplane mode from the Mac works via Shortcuts + `devicectl openURL`. No altitude spoofing tool exists.
- 10-23 Big UI day: Destinations panel, titlebar redesign, console takes commands, unplug goes back to connect screen.
- 10-23 Drive with changing speed (chained calls). Fixed miami-demo never playing on Drive.
- 10-23 Quit "crash" was a main-thread hang in pywebview's `closing`. Laggy window drag fixed.
- 10-23 pmd3 couldn't mount on iOS 27, switched the Mac to devicectl (undone 11-19).
- 10-22 Waypoint Mac app built (FastAPI + Leaflet in pywebview), connect screen.
- 10-22 Repo reorganized into mac-version/, windows-version/ and a shared core/.
- 10-22 Life360 shows real mph + the car icon via devicectl's speed-carrying location sim.

## 2026-07

- 07-10 Flight-arrival spoofer built (Miami to NYC): choreographer + routes + Observer arrival signal.
- 07-10 Emoji A/B done: Motion & Fitness setting makes no difference. Injected speed reads -1.
- 07-09 Life360 Observer built (auth, watch loop, JSONL logging, `correlate.py`), token login since the account is passwordless.
- 07-09 Research: flight detection needs altitude; motion injection is a hard wall without a jailbreak.
- 07-09 Map visualizer (first UI artifact).
- 07-08 Movement engine: design locked (`docs/MOVEMENT_ENGINE.md`), offline core built, road snapping (Valhalla), corner-aware speed.
- 07-08 On-device: Paris spoof works with no VPN (IP not checked). Stutter is downstream, not the engine.
- 07-08 Research sweep into `docs/research/` with frontmatter. Found the `isSimulatedBySoftware` risk.
- 07-08 Correction: Life360 does reflect the spoof. Movement is the missing piece.
- 07-07 M1 done: Find My spoof confirmed. Project kickoff, signed commits set up.
