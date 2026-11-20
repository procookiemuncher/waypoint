# PROGRESS LOG

Newest entry on top. After a work session, add a short entry: what changed, what was decided,
what broke, what's next. Keep about the last 10 entries here. When it grows past that, move the
oldest to `docs/progress-archive.md` as one-liners.

## Current state (2026-11-20)

- **App:** Waypoint Mac app. Dock app = keyless dev build, `release.command` = key-gated production build with auto-update. Live release: 0.1.0-beta.2 (build 2), two testers.
- **No Xcode needed:** pmd3 11.59 CoreDevice path does set / route-with-speed / clear. Drive is in core, so Windows should get real speed too (untested).
- **UI:** globe + "Arrival plan" side panel are in the app (11-20), dry-run tested only. Owner hasn't tried it in the Dock app yet.

**Open:**
- Stadia key isn't in release builds, so testers hit the map rate limit. Proxy via the key dashboard or bake it in.
- Never tested: a compiled build moving the pin on a real phone, a Mac with no Xcode, Intel Macs, anything on Windows.
- Airplane-mode Shortcut is the last devicectl call. Check pmd3 `core-device launch-application`.
- `fly` has no API in the app (launcher only), so it's not in the palette.
- Globe effects (stars/depth/night/rim/UFOs) are switches in the prototype, none picked yet.
- CRT scanlines sit over the new panel. Keep or drop?
- Old release zips pile up in Vercel Blob (~70 MB each).
- `isSimulatedBySoftware` still untested (see AGENTS.md).

---

## 2026-11-20 — Docs cleanup: progress log trimmed

- PROGRESS.md was 171 KB / 99 entries (~43k tokens read at the start of every session). Now it's a "Current state" block + entries from 11-18 on. Everything older is one-liners + a lessons list in `docs/progress-archive.md`, full text in git history.
- CLAUDE.md and AGENTS.md ground rules updated to match. Dropped AGENTS.md's stale "Windows only, v2 will move" intro and the "Download ZIP" note.
- AGENTS.md rewritten: fixed stale claims (tunneld/admin/wintun, iOS 26.6, "no JS", "movement engine is the missing piece"), the speed history collapsed into a DVT vs CoreDevice table, Running it split into sections, git part trimmed. 28 KB to ~19 KB. `docs/handoff/` deleted (finished jobs).

---

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

---

## 2026-11-18 — Can we drop Xcode? (research + probe, not on-device yet)

- Goal: users shouldn't need Xcode. Today it's needed for devicectl (drive speed, pins, clear, lock state, airplane Shortcut) and because pmd3 9.33.1 can't mount the DDI on iOS 27.
- Found: devicectl's speed sim is a phone-side service (`dtlocationd` → RSD `com.apple.coredevice.locationservice`, feature `simulatelocation`, actions `setsimulatedlocation` / `startlocationsimulation {waypoints, speed, pacing}` / `clearsimulatedlocation`). pmd3 speaks CoreDevice already and has a stub for this service. pmd3 11.59 looks like it fixes the ApBoardID mount crash. Details: docs/research/no-xcode-speed-sim.md.
- Added `core/tools/probe_coredevice_location.py` + `mac-version/probe-no-xcode.command` (own venv, newest pmd3, app venv untouched). Checked that it installs and starts. Nothing tested on the phone yet, it wasn't connected.
- If it works, the speed path also works on Windows and drive can move into core.
- **Next:** reboot phone → run the probe → put the accepted input shapes into device.py → find a pmd3 way to open the `shortcuts://` URL → upgrade pmd3 in the app and get it through the Nuitka build check.
