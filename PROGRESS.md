# PROGRESS LOG

Append-only dev log. **Newest entry on top.** After any work session, add an entry:
what changed, what was decided, what broke, what's next.

**This is the first thing to read after a memory/context reset.**

---

## 2026-10-29 — Waypoint: native launch splash

**Model: Claude Opus 5.5 (Claude Code).** Owner picked the native logo splash from a throwaway preview of the options.
- `mac-version/splash.py`, hooked up in `app.py` with `splash.attach(window)`. On pywebview's `before_show` (main
  thread, window and WKWebView made, page not loading yet) it puts the webview in a plain container with the splash
  on top and makes that the content view. pywebview only moves the webview in when `webview.window()` is nil, so it
  leaves this alone. The page loads under the splash. On `loaded` the splash fades out (0.3 s) and is removed.
- Look: Waypoint.icns at a 150 pt tile, a radial lavender glow plus a shadow pulse (Core Animation, 1.2 s,
  autoreverse, so no Python per frame), "Waypoint" in the system semibold. "starting…" shows after 2.5 s. Reduced
  motion turns the pulse off. The splash drops after 30 s even if `loaded` never comes. Any error while building it
  is printed, and the app opens as it did before.
- Checked in the real window (dry run): splash from the window's first frame, crossfade at `loaded`, JS bridge
  (`pywebview.api.*`) still there, webview is first responder, one subview left after the fade.
- Side note: the all-black `screencapture -l` frames earlier in the day were the window before pywebview put the
  webview in, not a capture problem.

---

## 2026-10-29 — Waypoint: black window on start

**Model: Claude Opus 5.5 (Claude Code).** Owner still saw ~10 s of black window at launch.
- Cause: pywebview (cocoa) only puts the WKWebView into the window in `webView_didFinishNavigation_`, so the window
  shows its `background_color` until the page's `load` event. `load` waits on every image, and the Stadia map tiles
  were added to the map before it. So the black lasted as long as the internet tiles took, and the boot log typed
  where nobody could see it.
- Measured in the real window (dry run, warm, with a temporary load beacon): `load` at +1.27 s before, +0.88 s
  after (~0.1 s after the HTML). Cold tiles took up to ~3.5 s in Chromium even warm-ish. Cold DNS/TLS/VPN can make
  that the 10 s.
- Fix: `initMap()` adds the tile layer after `load`. The "starting map engine" step still waits up to 2 s on the
  first tiles as before.
- Python side was already fast on the owner's launch: `startup +0.53s server up` in Waypoint.log.
- Not checked: a real cold boot after a reboot. If there's still black, the next suspect is the WebKit
  WebContent process starting cold.

---

## 2026-10-29 — Waypoint: slow cold start

**Model: Claude Opus 5.5 (Claude Code).** Owner said the app takes a while to load, worse on a cold start.
- Warm, nothing here is slow: imports ~0.2 s (fastapi is most of it), first `/api/status` 0.55 s (a `pmd3 usbmux list`
  spawn), cold `xcrun` cache 0.64 s. No phone was plugged in, so devicectl against the phone wasn't measured.
- The real problem was the order. The phone was only looked at once the boot log reached "looking for the iphone"
  (~3 s of typing plus up to 2 s waiting on map tiles). Only then did usbmux run, then `lockState`, then
  `ddiServices` (~5 s, every launch, since `ddi_ok` is in memory). On a cold start each devicectl call is slower
  and CoreDevice may need a few polls to reach the phone.
- Fixes: `app.py` starts `session.phone()` as soon as the server is up. `boot()` fetches the library and status
  at the start. `DevicectlReadiness` runs the DDI look in the background next to the first lock look, and a locked
  poll doesn't wait on it. If it says not usable, it asks once more before showing the error.
- Startup timings now go to `~/Library/Logs/Waypoint.log` (`startup +Xs imports done / server up`, plus any
  devicectl call over 2 s). The clock starts when app.py loads, so interpreter start isn't counted.
- Not changed: the 1.8 s lit wire + ~3.7 s rings (on purpose). iCloud: "Optimize Mac Storage" is on and the
  14k-file `.venv` sits on the synced Desktop (1048 `* 2` conflict copies in it, all evicted). Could slow a cold
  first read; not measured. Fix would be moving the venv out of the Desktop, not done without asking.
- **Next:** owner does a reboot + launch with the phone plugged in and unlocked, then read the log.

---

## 2026-10-29 — Waypoint: smoother "Continue without phone"

**Model: Claude Opus 5.5 (Claude Code).** Owner said the skip click lagged on a real (not dry) run with no phone.
- Cause: `skipLink()` ran `layoutApp()` (browse cards + map framing) on the click itself, right as the rings started.
  Measured in headless Chromium, no phone, real mode: a 90 ms long task on the click, frame gaps of 125 ms and 92 ms.
- Fix: on first boot `linkPhone()` now lays the app out under the card 700 ms after it shows (once its fade-in is done).
  The skip and phone paths both find it already done.
- After: 0 long tasks over 3 runs, one ~30 ms frame as the rings first composite. Phone path not re-checked on device.

---

## 2026-10-28 — Waypoint idle resource check

**Model: Claude Opus 5.5 (Claude Code).** Owner asked how heavy the app is when it's just sitting there. Measured with
`top` (5 s samples, ~60 s per state) on an M1 Pro, `VIDA_DRY_RUN=1`, app idle on the main screen. CPU is % of ONE core.

| state | python (app + uvicorn) | WebKit WebContent | WebKit GPU | total |
|---|---|---|---|---|
| window not focused | ~0.3% | ~0.3% | ~0.2% | **<1%**, ~450 MB |
| window frontmost | ~9% | ~15% | ~13% | **~35–40% of a core** (~4% of the machine), ~600 MB |

- The gap is the background ring (`core/web/static/ring.js`): 30 fps full-window 2D canvas at retina dpr with radial
  gradients per dot. It already stops on blur, which is why the unfocused number is near zero.
- WebContent holds 300–490 MB (map tiles + the full-size canvas). That's the biggest memory cost.
- Status/log polling (2 s / 1 s) keeps going while unfocused because it only checks `document.hidden`, which an occluded
  window doesn't set. Cheap (~0.3%), not worth touching.
- Dry run skips the devicectl/usbmux readiness polling, so a real run adds a short `xcrun` spawn every 6–10 s on top.
- Didn't change anything. If foreground cost matters: drop the ring to ~15 fps or render it at dpr 1.

---

## 2026-10-27 — Waypoint: ring burst when the phone passes its checks

**Model: Claude Opus 5.5 (Claude Code).** The owner pasted a React/three.js/shadcn "ShaderAnimation" component and asked
for it when you clear the checks and load into the tool.

- The app has no React, Tailwind, TS or build step, so I didn't set up shadcn or install three. Its GLSL is ported as is
  to plain WebGL on one fullscreen triangle in `core/web/static/warp.js` (~100 lines, no dependency, works offline).
- **When:** first boot only, after the connect screen goes green and shows the lit wire for 1.8 s. The rings fade in over
  the card (0.5 s), the app is laid out underneath, they hold 1.4 s, then fade out (0.8 s). One ring wave sweeps from the
  center past the corners in about that time. It doesn't play for "Continue without phone", a phone reconnect after boot,
  reduced motion, or when WebGL is missing.
- Time runs at 3/s from the clock, which is the original's 0.05 per frame at 60 fps, without the frame-rate dependence.
- Bug found while checking: `linkPhone()` awaited its promise without returning it, so callers always got `undefined`.
- Checked in headless Chromium against a dry-run server: rings on screen, then the app, and no warp on the skip path.
- **Smoothness pass (same day, owner said it lagged):** measured with a longtask observer and rAF frame gaps. The rings
  dropped 125–270 ms frames because the app was building behind them: the 1.1 s map fly-to fetched tiles every frame,
  the browse cards were built then, and the shader compiled on the frame its fade started. Now `layoutApp()` builds the
  cards and jumps the map straight to its framing (`frameBrowse(_, instant)`), and `Warp.prep()` compiles the shader.
  Both run under the connect card as it turns green. The panel rise and sweep start as the rings fade out. Result: zero
  gaps while the rings play. The remaining ~90 ms stall happens under the card at the moment it turns green.
  Skipping during the green moment no longer plays the rings or leaves the prepped canvas in the page.
- **Brand moment (same day):** the rings now carry the logo and the word. The app icon's tile (its grid lines dropped,
  too small to read) sharpens in from a blur with a lavender glow. Then "Waypoint" (Inter 600, −0.02em, matching
  the sting's S8) rises letter by letter, and one light shimmer passes across it. A soft dark radial sits behind them for
  contrast. The hold went from 1.4 to 2.4 s (`Warp.hold`), so the rings are up about 3.7 s in all. The ring wave
  leaves the screen at about 2 s, so the second half is the lockup on near-black. Keyframes stay on through `.out` so
  nothing snaps when the fade starts. Still zero dropped frames while it plays.
- **Skip gets it too (2026-10-28):** "Continue without phone" on first boot now plays the same rings + brand moment
  (`skipLink()`), the app lays out under the card first like the phone path. `Warp.prep()` now runs as soon as the
  connect card shows on first boot so the click doesn't wait on the shader compile. `linkLeaving` stops a skip during
  the rings from starting them twice. Later visits to the connect card (phone unplugged) still skip straight out.

---

## 2026-10-27 — Waypoint sting (v1 cinematic video): the full film

**Model: Claude Opus 5.5 (Claude Code).** Owner OK'd the four stills, so I built S4, S5, S7, S8 and the sound, then
rendered the film.

**Output:** `cini videos/v1/sting/out/waypoint-sting.mp4` (gitignored). 1080x1080, 720 frames at 60000/1001, H.264
High yuv420p. The RGB to YUV conversion uses the BT.709 matrix the file is tagged with. AAC 320k at 48 kHz. The video is
12.012 s; the audio's edit list makes it exactly 12.075 s. Measured on the mp4's own audio: −14.0 LUFS, −1.4 dBTP.
- `./film.sh` renders four frame ranges in parallel, builds the sound and encodes. The frames go to
  `$TMPDIR/waypoint-sting-frames`, not the project. The Desktop is iCloud-synced: rendering there uploaded ~500 MB
  every pass and left `00083 2.png` conflict copies. `./film.sh encode` only re-encodes.
- `node audio/build.mjs` writes `out/audio/sting.wav` plus stems. `node audio/analyze.mjs <file>` prints the tempo and
  a bar-by-bar energy map.
- `prep/osm.py nyc mnh` adds the S4 map (49 m/px; roads come in 2x2 tiles because one query times out; only the
  five boroughs are outlined) and the S5 Manhattan cover (every street).

**Decisions**
- **Tempo:** "Rising Forest" already measures 124.00 BPM as published, so it plays at its own speed with no stretch.
  The edit starts at 43.987 s in the track, so bar 24's kick lands on beat 5 (2.467 s). That kick is the big drop
  after the eight-bar build, and the soft intro is the tail of that build. Every kick on the final mix is within ~9 ms
  of 0.048 + 0.4838k. A 2 ms de-click at sample 0, because the cut starts mid-bar. The last 60 ms is the only fade.
- **SFX** are synthesized in `audio/build.mjs` from a seeded PRNG: a soft impact at 0.10 s; whooshes peaking on the
  f72/f101/f159/f301 cuts; hits on 6.240 and 8.175 s; clicks at 2.33 and 3.83 s; one key tick per typed character (the
  frames where the console text grows); a shimmer at 10.05 s; a small Freeverb on the SFX bus. Levels were set by
  meter, not by ear: `node audio/cues.mjs` compares each cue with the music inside the cue's own band. Broadband
  numbers hid that the ticks were 18 dB under the hats. Now the clicks, whooshes, hits and shimmer sit at 0 to +6 dB
  in band, and the "very quiet" ticks at −3 dB.
- **The Plaza pin** gets an arrival ping ring (f179–192, peak 0.3 opacity) as the line reaches it. Not in the brief.
- **S4:** one Web Mercator fit, least squares on the brief's anchors: JFK T4 lands at (791,894), The Plaza at (359,526).
  The map stays north-up, so both anchors can't be exact. On f159 the blur is 16 px round plus the speed smear, about
  24 px along the motion. With 24 px round blur under the .30 flash, f159 was a flat lavender frame, and the brief's
  gotcha allows lowering it. The S4 map (`NIGHT` in s4.js) is reused by S5 and keeps creeping under the card (−20 px
  by f214), so nothing freezes. In S5 the cursor stays on top of the card, drifts right and fades by f191.
- **S8:** "Waypoint" is Inter 600 at −0.02em. The ink width is measured after the fonts load. The width follows a
  monotone spline through the brief's table. 24 streak copies are used, with a horizontal smear on the opening frames only.
- **Grain on the S3 console glass:** the backdrop blur smoothed the wallpaper's dither flat, and H.264 stepped it.
  Found by amplifying mp4 frames ×7. The S1 haze, the S3 wallpaper and the S8 radial were already clean.
- **S3 drift:** eased in from f136, because f138 and f138.5 were identical. The only repeated frames now are the S7
  hold, f269–f287 (hash-checked).
- **render.mjs fix:** `--frames a-b` was dropping the last half frame of each range.

**Checks done:** mp4 frames 143/144, 201/202 and 317/318 straddle the f72/f101/f159 cuts exactly. Both streams start
at pts 0. Contact sheets were checked across every cut. Overpass mirrors were 502/504 for a long stretch; the cache
in `cache/osm/` means it never has to be fetched again.
**Next:** owner review of the film.

---

## 2026-10-27 — Waypoint sting (v1 cinematic video): stills checkpoint

**Model: Claude Opus 5.5 (Claude Code).** Owner pasted the v1 video brief (`cini videos/v1/prompt.txt`): a 12s
1080x1080 product sting, drawn by `seek(f)` as a pure function of the frame and screenshotted with Playwright.

**Where:** `cini videos/v1/sting/`. It's not `build/` because the root .gitignore ignores every `build/` folder.
node_modules, frames/, out/ and cache/ are ignored there.
- `prep/routes.py` (run with the .venv python): loads the routes with the app's own loader and snap cache, no network,
  and writes the snapped road polylines to `data/routes.js` (JFK to Plaza is 974 points, the JSON alone only has the ends).
- `prep/osm.py` (.venv python, the system python3's LibreSSL fails the TLS handshake): Overpass gives coastline joined
  into land polygons, plus water, parks, roads and county lines, written to `data/maps.js`. Raw answers are cached in
  `cache/osm/`. Regions so far: nyc_thumb, mia, stt. The big S4 New York region isn't fetched yet.
- `prep/assets.py` inlines `mac-version/app/icon.svg` into `data/icon.js`.
- `node render.mjs --stills 40,86,150,230` writes `out/stills/`. `./sheet.sh <name> "f,f,..."` makes contact sheets.

**Gotchas**
- The repo's Inter / JetBrains Mono latin woff2 subsets have **no → (U+2192) and no ▸ (U+25B8)** (checked the
  cmap), so both are drawn as SVG. A browser width test claims they're there, but that's macOS system fallback and it's wrong.
- Playwright 1.55's chromium unzip hangs under Node 26. Unzipped by hand with `ditto` and added the
  `INSTALLATION_COMPLETE` marker. The renderer launches `channel: 'chromium'`.
- Stroking Inter text traces its overlapping contours (inside S and z). The glass title edge uses an alpha erode filter instead.
- overpass-api.de throws 502/504 a lot. The script rotates mirrors.

**State:** S1, S2, S3 and S6 are built. Stills f40, f86, f150 and f230 are rendered for the owner to review.
**Next, once the look is OK'd:** S4 map (fetch the big NYC region), S5 hero card, S7 disc, S8 end card, audio
(Mixkit "Rising Forest" by Diego Nava, stretched to 124 BPM, synthesized SFX, mastered to -14 LUFS), then the full
720-frame 59.94 render and mux.

---

## 2026-10-27 — App performance / battery pass (Waypoint UI)

**Model: Claude Opus 5.5 (Claude Code).** Owner asked for a smoother app that's lighter on the laptop battery.

**Measured** with the real app (pywebview/WebKit, dry run, window focused): `top` over 40s, all WebKit processes summed.
Idle on the gallery: **~60% of a core → ~20%**. A route playing: **~57% → ~47%** after the tick fix (that was measured
before the ring rewrite below, which saved another ~15% at idle). Headless Chrome doesn't show these costs, you have to measure WebKit.
Run-to-run noise is about ±5%, and the window has to be in front: an occluded window reads ~0 because WebKit throttles it.

**Changed**
- `ring.js` (the rainbow border) was almost all of it. It redrew a full-window canvas every vsync forever, in the background
  too. Now 30fps on a timer (not skipped rAFs), it stops on window blur / hidden, and it freezes while `#browse` scrolls
  (like it already did for map panning). The comet tail was ~60 chunks x 3 strokes a frame, and the stroke *count* was the
  cost, not gradient vs solid colour. Each straight edge is now one stroke per pass, with a linear gradient carrying the colour + fade.
  Bloom dots are cached per colour (96). Pixel-diffed against the old ring at 5 times: the only change is the old 10px
  banding along the tail is gone. `S` (the tuned look) is untouched.
- Live route `tick()`: 30fps, rebuilds the finished line only when it passes a timeline point (a 2-point `lineHead`
  covers the rest), readouts 4x/s, the blurred glow in its own `glow` pane (z 399) so it isn't re-blurred per frame.
- Marker ping animates `transform` (was width/height). The hero card sweep rotates a fixed conic gradient (was an animated
  `@property --ang`, a main-thread repaint every frame). Both render the same as before (old/new screenshot diff).
- Card map tiles `decoding="async"`; status/log polls pause while the page is hidden.
- Holding a place (or after a route arrives) the map loop wakes 4x/s instead of 30, since nothing moves. Live route
  rendering checked in headless Chrome after these changes: glow, dim line, done line meeting the marker, readouts all fine.
- Backend: once the phone is ready, `usbmux list` runs every 10s (was 4s, ~0.3s of CPU per spawn) and the devicectl lock
  check every 6s (was 2s). The connect screen is unchanged.

**Tried, not kept:** plain-alpha `#crt` instead of `mix-blend-mode: overlay`, and dropping `backdrop-filter` in the list.
Neither showed a measurable WebKit difference (scrolling is ~2% WebKit, the compositor does it), so the look stays.
**Not verified:** anything on the real phone (no need: UI + poll timing only). Whether WKWebView fires `visibilitychange`
on minimise is untested. `blur`/`focus` (which does fire) covers the ring either way.

---

## 2026-10-24 — Destinations catalog: 35 LARP spots, every continent but Antarctica

**Model: Claude Opus 5.5 (Claude Code), in the `larp` worktree (another agent was on main).** Owner wants
way more routes: the top 20-30 exclusive places to be seen at, worldwide (e.g. Sexy Fish Miami).

**Built a system, not 90 hand-written files**
- `core/destinations.json`: 28 cities / 35 spots. NA: Miami (Faena, Sexy Fish, LIV), NYC (Plaza, Polo Bar),
  LA (Beverly Hills Hotel, Nobu Malibu), Vegas (Wynn, XS), Aspen, Los Cabos, St. Barths (Nikki Beach).
  Europe: Monaco, Saint-Tropez (Cheval Blanc, Club 55), Ritz Paris, London (Dorchester, Sexy Fish), Nammos
  Mykonos, Pacha Ibiza, Villa d'Este, Le Sirenuse, Les Airelles, Badrutt's. Dubai (Burj Al Arab), Aman Tokyo,
  Marina Bay Sands, Bulgari Bali, Royal Mansour, The Silo, Copacabana Palace, La Huella, Bondi Icebergs.
  Maldives (Soneva Jani) + Bora Bora (Four Seasons) are `access: boat` = pin only, no road from the airport.
  St. Moritz / Courchevel use the private-jet airports (Samedan, the altiport), way shorter than Zurich/Geneva.
- Every coordinate is from OSM (Nominatim), airports moved from the runway centroid to the passenger terminal
  (Overpass). Sexy Fish Miami isn't in OSM, used its street address (1001 S Miami Ave).
- `core/tools/gen_destinations.py`: airport → base hotel → each spot (or airport → spot when no base).
  Walk out to the road, Valhalla drive, walk in, 10 min dwell. Under 1 km straight line = walk only.
  Snaps + renders + validates before writing; failures are listed, never written. Rerun prunes stale files.
- Spots are pin presets too (`spoof sexy-fish-miami`), `/api/cities` replaces the hardcoded CITY_INFO,
  routes carry `label` + `city`.
- App: city page says the local time there, place chips say "open now" / "opens 11pm". World map merges
  overlapping city tags ("London +6"), click zooms in till they split. That was the Europe pile-up the
  last entry warned about.

**Fixed (renderer):** drives were reaching their final stop at 6-12 m/s (the jerk-limited tracker can't
follow a full-a_lon braking plan) and the next segment started at 0, a hard-fail velocity step. 5 of the new
routes failed on it, existing ones passed by luck. The final stop now gets a softer ramp (`_BRAKE_MARGIN` 0.5
of a_lon); corners keep full a_lon (a blanket margin broke the corner unit test). 40 routes x 3 seeds: 17
hard-fails → 2. Those 2 are a Tokyo highway-ramp corner at 2.92 vs 2.85, on non-default seeds only.
Builds use seed 0, which passes. Corner tracking has the same lag, open if it ever bites.

**Verified:** all 33 generated routes + the 7 hand-made ones pass validation (that's the Spoof/GPX path,
seed 0). **Drive path too:** dry-run `DriveEngine().prepare()` on all 33, 0 failures, each ends in its 601 s
stop, walk-only ones play at ~3 mph. Note Drive picks a *random* seed every play (`plan_chunks`), so it
never sees the validator's seed 0. emoji-test, same seed, old vs new: start/cruise identical, only the
end changes (old reached the stop at 5-6 m/s, new eases to ~1.7). Unit tests green, + one that fails on the
old brake plan. Dry-run app in headless Chrome (gallery, Miami + Ibiza city pages with hours/local time,
clustered map at z1/z5). The two "Sexy Fish" are now "Sexy Fish Miami/London" (live place is matched by name).
**Not done:** nothing played on the phone. Opening hours are approximate (from listings), seasonal spots have
a `note` but no warning in the UI yet.

**Next:** play one for real (`mia-to-faena-miami` / `faena-miami-to-sexy-fish-miami`, Drive engine). For a
Life360 "arrived" push the spot must be a saved Place, check the plan's Place limit. Hook the catalog into
the flight flow: every city's routes start at its arrival airport, so the airport + the `<code>-to-...` route
are exactly a trip's `arrive_hold` / `arrive_route`. A "home → spot" route needs the owner's start point.

---

## 2026-10-24 — `reset` now goes to the whole-world view

- **Changed:** the console `reset` command used to fly the map to Miami. It now backs out of any open city page and frames every city tag (same `frameBrowse` view as on load). `frameBrowse(force)` skips the "something's playing" guard because `reset` calls it right after `stop`, before the status poll clears `live`.
- **Not tested on a device** (UI only, checked syntax with `node --check`).

---

## 2026-10-24 — Researched altitude spoofing tools (none found)

**Model: Claude Opus 5.5 (Claude Code).** Owner asked for a tool that spoofs altitude for the "landed" push.
Nothing works on non-jailbroken iOS 26. pmd3 and devicectl `coordinate`/`route` are lat/lon only. The one
lead is devicectl `simulate location scenario`: Apple's scenario plists hold full CLLocations, altitude
included. devicectl seems to take only a scenario name or an on-device path, though, so we can't feed it
a forged file. Details in docs/research/life360-flight-detection.md.

**Next:** with the phone plugged in, run `devicectl device simulate location list` and try `scenario` with
a Mac path (2 min, probably errors). Then run §5 without altitude. That test still decides whether the
"landed" push is reachable at all.

Later the same day: added a plan (§5b) so a "no push" result actually tells us something. It has a
positive-control checklist, a realistic MIA→MCO timeline, checkpoints (mph / plane icon / history /
push), a Shortcut that reads the phone's reported altitude and speed, and a vacuum-canister barometer
A/B as the one real altitude experiment.

**Owner's first fake-flight result (reported, not instrumented):** airplane mode toggled fine. Life360
drew the trail line straight across the ocean and showed the **car / driving** status. No plane icon, no
"landed" push. So the fast leg reached Life360 as continuous points, and its drive classifier took it (no
water/geography check). That doesn't settle altitude yet. A real flight shows Life360 an airport, a
blackout, then the other airport. Our run fed it a live, continuous fast track, which looks like a drive.
Next variant: hold inside the departure airport long enough to register (several minutes, not 2),
airplane on, **teleport** to the arrival airport while offline (no route), hold for about the real flight
time, airplane off.

---

## 2026-10-24 — Airplane mode from the Mac works (Shortcuts via devicectl openURL)

**Model: Claude Opus 5.5 (Claude Code).** Owner wants a hands-free flight: get to the departure airport
(drive or quick teleport), wait ~2 min, airplane on, fly at plane speed, airplane off at the destination,
aiming for the real "landed at" push.

**Found:** devicectl has no airplane-mode setting (`settings` only does appearance/audio/biometrics/reset/
standby/voiceover; `simulate statusBar` is just the icon). But `devicectl device process openURL
"shortcuts://run-shortcut?name=..."` runs an iOS Shortcut. Owner made `vida-airplane-on` (Airplane On, Wi-Fi
Off) and `vida-airplane-off` (Airplane Off, Wi-Fi On).

**Verified on the phone** (iPhone19,3, iOS 27.0.1, cable):
- the phone was paired over Wi-Fi before (`Transport Type: localNetwork`). Has to be the cable (`wired`) or
  the Mac loses it the moment airplane mode is on
- ON link runs with no prompt, airplane + Wi-Fi off
- Mac still reaches the phone in airplane mode; OFF link works from there
- a devicectl `coordinate` set while offline holds (Maps dot moved to the Publix up the road), clear works
- phone has to be unlocked or the link doesn't run

**Still open:** does Life360's "landed" push fire with no altitude? That's the §5 test in
life360-flight-detection.md, now cheap to repeat.

**Next:** one short real flight (JFK→BOS at real jet speed, ~45 min, Logan saved as a Place as a fallback,
2nd circle member watching). Then mock the flight UI (phase stepper + airplane chip + drive-in / quick
teleport) and build it as a Mac-only engine next to drive_engine.py. Stop/kill has to fire the OFF
shortcut too. Open questions for the owner: real-time vs short test flights, teleport vs drive to the airport.

---

## 2026-10-24 — Destinations grouped by country

**Model: Claude Opus 5.5 (Claude Code).** Owner wanted the cities organized by country. Mocked 4 layouts in a
throwaway localhost playground (grouped gallery, country → city drill-down, flag filter chips, compact
accordion), with a "+ sample cities" toggle to see them with more data. Owner picked **grouped gallery**.

**Changed**
- Gallery home: a header per country (flag, name, "N cities · N routes", chevron), click it to collapse.
  A country with one city keeps the full-width card; 2+ cities go in a 2-up grid of smaller cards.
  The flag/country line is gone from the cards themselves since the header says it.
- Countries come from `CITY_INFO[...].country`; cities with none (unknown regions, "Elsewhere") land in a
  "🌐 Other places" group at the end. Countries sort by item count, like cities.
- Live badge also shows on the country header, so a collapsed group still tells you something's playing.
- Collapsed groups are only remembered for the session (in memory).

**Verified** (dry run, headless Chrome): US group with Miami + New York half cards, France and UAE full cards.
Collapse + live badge on the header not clicked through in the real app yet.

**Not done**: world map still has one bubble per city. They'll pile up over Europe if there are lots of
cities there; one bubble per country (as in the playground's option 2) is the fix if that happens.

---

## 2026-10-23 — Window border: rainbow ring on the edge + a comet light

**Model: Claude Opus 5.5 (Claude Code).** Owner wanted the rainbow border more defined and actually fitting
the window edge, with one brighter light going round in the same colours. Mocked it in the throwaway
playground (not in the repo); owner tuned the Comet preset and sent the exact numbers.

**Why the old one didn't fit:** the ring sat 4px in (radius 20) and the frame 9px in (radius 16), so a 3px
dark gap, a black band outside, corners not concentric, and a 22px blurred halo smearing over all of it.

**Changed**
- `static/ring.js` (new): a canvas over the whole window draws the turning rainbow on the edge (4px, 14px
  corners) plus a comet that runs round it at an even speed. The comet strokes with the same conic gradient,
  so it's always the colour of the ring under it; white-hot head, fading tail, soft bloom. Settings are the
  `S` object at the top (speed 0.35, rainbow turn 5s, lap 13s, tail 12%, light 0.4, base 0.55, glow 16).
- `#halo` / the CSS `#ring` are gone. Body padding 9px → 4px and `#frame` radius 16 → 10, so the frame
  sits right inside the ring with the same centre. `--ang` + `spin` stay for the hero card's tick.
- Freezes while the map pans (`body.panning`, as before); reduced motion draws one still frame.

**Verified** (dry run, headless Chrome, 2x): ring on the edge, corners concentric, no console errors.
Not looked at in the real pywebview window yet. Window is still square, so the corners outside the
14px curve show the #050609 background; `transparent=True` in pywebview would drop those.

---

## 2026-10-23 — Routes/places panel → Destinations

**Model: Claude Opus 5.5 (Claude Code).** Owner found the routes/places tabs messy. Mocked 3 ideas
(search + chips, destinations, trips) then 4 destination homes × 3 city layouts in the throwaway playground;
owner picked **Gallery + Map cards**.

**Changed**
- The ROUTES/PLACES tabs + list are gone. The panel opens on **Destinations**: one big card per city with its
  routes drawn on a little map (tiles + svg, `mapArt()` in app.js), flag, country, route/place/mile counts.
- Clicking a city: map header with a back button, stat boxes (routes / miles / minutes of driving), places
  as chips, routes as a 2-column grid of map cards. Click = select, double-click = play.
- Cities aren't in the data: a place's `region` is its city; a route goes to the known city (`CITY_INFO`) or
  place region nearest its last point within 100 km, else "Elsewhere". `CITY_INFO` holds flag/country/color
  for Miami, New York, LA, Paris, London, Dubai; unknown cities still get a card (📍 + a palette color).
  Routes and places now take their city's color as their accent.
- Route names are shown readable (`jfk-to-hotel` → "JFK → hotel"); ids/commands unchanged.
- Map: world view with clickable city tags on the home screen; inside a city its routes are drawn faintly.
  It won't fly anywhere while something is playing. Reset view frames the current screen.
- The play card is hidden until something is picked and is compact now (play button beside the name, the
  stat boxes are gone since the cards show them).
- Live badge on the playing route's card and on its city card.

**Verified** (dry run, headless Chrome): gallery, Miami city page, select → preview, play → live badges.

**Next**: the play card, now-playing bar, console and status bar still have the old mono/glow look.

---

## 2026-10-23 — Titlebar redesign: device pill + status dropdown

**Model: Claude Opus 5.5 (Claude Code).** Owner wants the UI to look less vibe-coded / more modern
(Linear / Vercel / YC-startup feel). Started with the top-left. Mocked 4 options in a throwaway
localhost playground (not in the repo); owner picked "pill + dock", in Inter.

**Changed**
- Titlebar: the logo, "Waypoint" wordmark and map/phone/live dot pill are gone. In their place is a
  device pill: a see-through glass phone (its screen light is the overall state and pulses while a spoof
  is live), the phone name, a status word (Live / Ready / Needs attention / N problems / Not connected),
  a small dock of map · live · link · speed icons each with a status dot, and an arrow.
- Clicking it opens a dropdown: a bigger phone + iOS/connection, an alert card per problem with a plain
  fix, then tiles grouped iPhone (USB, Screen lock) / Connection (Local server, Speed engine) / Waypoint
  (Location, Map, Internet). Footer: Check again, plus Back to real GPS while something is on the phone.
- Only shows what `/api/status` really knows. Tunnel / Developer Mode / disk image aren't reported on
  their own (the playground had them); the phone's `ready`/`locked`/`error` state covers them for now.
- Esc closes the dropdown instead of stopping the spoof; a click outside closes it without dropping a pin.
- `static/icons.js`: the 14 Lucide icons it uses, inlined so it works offline.

**Verified** (dry run, headless Chrome): ready, live, and faked locked + server down + failed command.

**Next (design pass, from the brainstorm)**: the rest of the app still uses the old look — mono caps
labels, glows, the rainbow frame, CRT/flicker. Candidates: drop the decorative layers, one accent, Inter
everywhere with mono only for numbers, one telemetry card on the map, a ⌘K palette instead of the console.

---

## 2026-10-23 — Unplugging the phone goes back to the connect screen

**Model: Claude Opus 5.5 (Claude Code).** Owner: if the phone disconnects while the app is running, go
back to the phone + cable loading screen.

**Changed**
- `app.js`: after boot, if the phone was there and `/api/status` stops listing it, the console logs
  "phone disconnected" and the connect screen comes back. It leaves by itself once the phone is plugged
  in + unlocked again (same flow as at startup). "Continue without phone" still works and it won't
  pop again until the phone has been seen again.
- `device.py`: `VIDA_DRY_PHONE=flaky` dry run — fake phone unplugs 30s in, comes back 15s later.
- Whatever was playing is not stopped by the frontend; the backend does whatever it did before on unplug.

**Verified** (dry run `flaky`, headless Chrome): screen shows at the unplug, goes back to the app when the
phone returns. Not tried on the real phone — the backend only re-lists devices every 4s, so expect up
to ~6s before the screen shows.

---

## 2026-10-23 — Console takes typed commands

**Model: Claude Opus 5.5 (Claude Code).** Owner wanted terminal-style commands like clear and reset
that put the location back and remove the spoof.

**Changed** (`core/web/` only, no backend change)
- The `waypoint ›` prompt is now a real input (click the prompt line to focus it). Up/down = history,
  ctrl+L = clear, Esc = blur.
- Commands: `clear` (wipes the console), `reset` (stop + clear the spoof via `/api/stop`, map back to
  default view, console wiped), `stop`, `set <place>` / `set <lat> <lon>`, `play <route> [--spoof|--drive]
  [--mph N]`, `ls [routes|places]`, `help`.

**Verified** (dry run, headless Chrome): set place, set coord, then `reset` → `active` goes null and the
clear command runs; `clear`, `ls`, `help`, unknown command, history all fine. Not tried on the real phone.

---

## 2026-10-23 — Drive with changing speed (chained devicectl calls)

**Model: Claude Opus 5.5 (Claude Code).** Owner wants the Miami drive to have realistic, changing speed.

devicectl holds one speed per call, so a varying drive is a chain of calls.
`devicectl_route.plan_chunks` renders the route with the movement engine (ramps, slows for bends,
stops), cuts it into 5–30s chunks of roughly steady speed, and averages each chunk's speed with
its neighbours, so the renderer's braking for every bend doesn't read as 18-31-18 mph. On top
of that a slow ±12% wander gets a new target every 30–60s. Stops become a `coordinate` hold. New
seed every run. `play_chunks` launches each chunk against one start clock and checks a cancel
Event right before every launch.
- Terminal: `drive.command emoji-test --vary` (`--write-only` prints the plan).
- App: Drive now varies by default; typing an MPH keeps the old single steady call.
  `ChainJob` stops by joining the thread, so no chunk lands after the clear.
- emoji-test plan: 9→37 mph, ~48 chunks, ~10 min. miami-demo: walk 2 mph → 26 mph → stop → … → park.
- Also fixed: devicectl `coordinate` with a negative longitude (`--longitude=-80.19`), which broke Miami pins + stops.

**Verified**: dry run (plays through, stop in 0.2s, steady mph path unchanged), speed-planning tests OK.
- Terminal `--vary` must be stopped with **Ctrl+C in its own window** (or closing it). `--clear` from
  another window only clears the current chunk, and then the next chunk starts. Each `[k/n]` line logs
  `late`/`call` seconds. If `call` is around 1s on the phone, raise `CHUNK_MIN_S` (20–30s).
**NOT verified on the phone**: whether a new `route` call cleanly replaces the running one, and what
Life360 shows at each handoff. First on-device try: `drive.command emoji-test --vary`, phone unlocked.

---

## 2026-10-23 — drive.command shows mph again, app polling slowed during routes

**Model: Claude Opus 5.5 (Claude Code).** Owner ran `./mac-version/drive.command emoji-test` per the
10-22 recipe (clear first, phone unlocked, 3–5 min) and **Life360 showed the speed**. So devicectl
speed still works on iOS 27.0.1.

The app's Drive button already runs the same thing (same `build_route_file`, `find_device`, same
`devicectl … simulate location route` call). Only difference found: the app's readiness check
runs `devicectl device info lockState` every 2s, also mid-route. Now every 20s while a route is
active. **A guess, not a proven cause** — today's app runs were also much shorter (40s–2.5 min) and
the phone kept locking. Next: the same emoji-test from the app, 3–5 min, phone unlocked.

---

## 2026-10-23 — "Speed spoof doesn't work on one of the routes"

**Model: Claude Opus 5.5 (Claude Code).** Owner: picking one of the routes, the speed doesn't show.

**Found** (Waypoint.log + code, owner hasn't said which route yet)
- **miami-demo could never play on Drive**: `build_route_file` took the speed of the *first* moving
  segment only, and miami-demo starts with a walk that has no speed → "no speed … pass --mph". The
  card still said 26 mph CRUISE because `summary()` skips segments without a speed. Fixed: same
  rule as `summary()` (f153d12). All 7 routes now build for Drive.
- **Engine toggle could stick on Spoof**: `selEngine()` stored its fallback, so if a route card
  rendered before the first `/api/status` (ENGINES empty → Spoof only), Spoof stayed picked even
  after Drive appeared. Now only a click stores a choice, and the toggle re-renders when the
  engine list changes (623d255). Today's 13:21 run was **emoji-test via spoof**, which is 0 mph by
  design, so that run looks like "speed doesn't work" whichever way Spoof got picked.
- The Drive runs in the log (jfk-to-hotel 00:10, 67 mph, cleared after ~40s; demo-drive 13:35,
  Paris, ~2.5 min) both started fine on devicectl. Both were long teleports and short, so Life360
  may just not have caught a moving sample. Not a code bug as far as the log shows.

**Not verified**: on the phone. **Still open**: negative-longitude `hold` (places, not routes).

---

## 2026-10-23 — Dragging the window was laggy

**Model: Claude Opus 5.5 (Claude Code).** Owner said dragging is really laggy.

**Found**: the titlebar used pywebview's `pywebview-drag-region`, which moves the window with one
JS→Python bridge call per mousemove, so the window always lagged behind the cursor.

**Changed**
- `app.py`: a local NSEvent monitor remembers the last left mouse-down; `WindowApi.drag()` hands it
  to `NSWindow.performWindowDragWithEvent_` (only if the button is still held), so AppKit runs the drag.
- `index.html`/`app.js`: titlebar no longer has the pywebview class; a mousedown on it (not on
  `.no-drag`) calls `api.drag()`. Browser/Windows paths skip it (no `pywebview.api.drag`).
- `app.css`: while the map pans (`body.panning`), the halo/ring spin pauses and HUD backdrop blur is
  off, in case "drag" also meant the map. Not measured, just less repaint.

**Verified** (dry run, synthetic Quartz mouse events on the titlebar): the window follows the drag
exactly. **Not verified**: how it feels by hand, and whether map panning feels better.

---

## 2026-10-23 — Quitting the Mac app "crashed": it was a main-thread hang

**Model: Claude Opus 5.5 (Claude Code).** Owner: the app crashes when you close it.

**Found**: no crash report, but there's a hang report: `/Library/Logs/DiagnosticReports/python3.12_2026-10-23-000900_*.hang`
(15.9s). Stack: Cmd+Q → `applicationShouldTerminate_` → pywebview's `closing` event → our `cleanup()`
→ waiting on `session.lock`. pywebview runs `closing` **synchronously on the Cocoa main thread**, so
`session.shutdown()` (wait for any in-flight action, then `Job.stop` up to 5s + devicectl clear up to 30s)
froze the UI. The old `window.hide()` there did nothing useful: it's only `callAfter`, so it ran
after the handler returned. Dry run never showed it because fake clears are instant.

**Changed**
- `app.py`: Cmd+Q, Dock → Quit, Cmd+W and the titlebar close button all go to `quit_soon()`, which
  hides the window, clears on a thread, then `window.destroy()`. The closing handler returns False
  until the clear finishes. 45s cap (`QUIT_LIMIT`), then `os._exit`. SIGTERM/atexit now wait for a
  clear that's already running instead of skipping it.
- `session.py`: `closing` flag. Once shutdown starts, queued actions do nothing, so no hold lands
  after the last clear.

**Verified** (dry run, with a `Session.shutdown` slowed to 8s + a probe timing `callAfter` on the
main thread): before = main thread blocked 8s with the window still showing on Cmd+Q. After = no
blocking on Cmd+Q / titlebar / performClose, window hidden in under 1s, clear runs, process exits.
Real mode (phone unavailable) quits clean in ~7s. **Not verified**: quitting with the real phone holding a pin.

**Separate bug spotted, not fixed**: `DriveEngine.hold` with a negative coordinate fails. devicectl
reads `-80.19` as a flag (`Missing value for '--longitude'`, log 00:19:31), so pins in the western
hemisphere don't work. Likely fix: `--longitude=<value>`.

---

## 2026-10-23 — Connect screen on the real phone: pmd3 can't mount on iOS 27, switched the Mac to devicectl

**Model: Claude Opus 5.5 (Claude Code).** First try of the connect screen with the real phone.

**Found (on-device)**
- At first the Mac didn't see the phone at all (usbmux empty, devicectl "unavailable"); after a
  re-plug it showed up as iPhone (3), iOS 27.0.1, iPhone19,3, "available (paired)".
- **pmd3 9.33.1 `mounter auto-mount --userspace` crashes on iOS 27.0.1**: `MissingManifestError` →
  `KeyError: 'ApBoardID'` in `get_manifest_from_tss`. The 2026-10-22 warning ("DDI build newer than
  pmd3 knows") came true. Not upgrading pmd3 in this pass (past upgrades broke deps).
- **My mount check said "ready" anyway**: pmd3's rich traceback quotes its own source, which contains
  "DeveloperDiskImage mounted successfully". Fixed — boxed traceback lines are ignored (4bbbdf1).
  So yesterday's "mount-based unlock detection" is **refuted on this device**: it can't work on iOS 27.
- `devicectl device info lockState` answers in ~0.6s (`passcodeRequired`, `unlockedSinceBoot`);
  `ddiServices` says Xcode's cryptex DDI is on the phone, `isUsable: true` (~5s, first call ~14s).

**Changed**: `Session.use_readiness(check)` lets a platform swap in its own unlock check (polled
every 2s, live — notices re-locking). `mac-version/phone_check.py` = devicectl lockState + one-time
ddiServices check; app.py registers it (not in dry run). Windows keeps the pmd3-mount check.

**Then: places didn't spoof.** Places/pins always went through pmd3 (`hold`), so on iOS 27 the mount
crashed and the hold ran on a phone pmd3 couldn't drive. Added `Session.use_placer(engine)`; the Mac
app hands places/pins to `DriveEngine.hold()` = `xcrun devicectl device simulate location coordinate
--latitude --longitude` (stop clears it via devicectl). Dry-run checked; real run pending with owner.
A Drive route (jfk-to-hotel) did start on the phone at 00:10 ("Started location simulation…").
The **Spoof** route engine is still pmd3 → expect it to fail on iOS 27 until pmd3 is upgraded.

**Not verified yet**: that `passcodeRequired` flips to true when the phone locks (needs the owner to
lock it). Whether pmd3's DVT location sim (Spoof engine) works on iOS 27 with Xcode's DDI already
mounted — that's a real pin move, owner watching.

---

## 2026-10-22 — Waypoint: connect screen (plug in + unlock) with a rainbow wire

**Model: Claude Opus 5.5 (Claude Code).** Owner wanted a modern screen after the terminal boot log
that waits for the phone to be connected + unlocked, with a rainbow cable between computer and phone.

**Broke / fixed**
- **`Session.devices()` always returned None** — in 850ad09 the `return self._devices` line got
  glued onto the end of a comment. So the app said "no phone" no matter what (even in dry run). The
  previous entry's "correctly showed not found" was this bug, not a real check. Fixed (e439e33).

**Changed**
- `device.py`: `Pmd3.mount()` returns `(state, message)` — `ready` / `locked` / `error` — parsed
  from auto-mount's output (it exits 0 on most failures, so the exit code is useless). `DeviceLocked`
  / `PasswordProtected` → locked, "Developer Mode is disabled" → error, "already mounted" /
  "mounted successfully" → ready.
- `session.py`: `status()` has a `phone` field: `none | checking | locked | ready | error`. Unlocked is
  judged by mounting the DDI (which won't happen on a locked phone), retried in the background every
  ~4s, never inside the status request. Side effect: the DDI is already on before the first play.
- Page: `#link` overlay between the boot log and the app (laptop → SVG wire → phone, three step pills,
  "continue without phone"). Wire is dim + unplugged when there's no phone, a flowing rainbow (same
  colors as the window ring) when plugged in, with white packets + glow when ready. Holds ~1.8s on
  ready, then hands off. Scanlines fade out while it's up.
- `VIDA_DRY_PHONE=slow` (with `VIDA_DRY_RUN=1`): fake phone is missing for 12s, locked until 20s, then
  ready — for working on this screen.

**Verified**: dry-run screenshots of none → locked → ready → app handoff. **Not verified on the real
phone**: whether pmd3 really prints `DeviceLocked` for a locked phone on iOS 27 (it did on 26.6 in
July), and the error state's copy. Limit: once mounted, re-locking the phone isn't noticed (one-time
gate, not a live lock indicator).

**Next**: plug the real phone in locked and watch the screen flip to "Unlock your iPhone".

## 2026-10-22 — Waypoint: a real Mac app (Dock icon, map UI) on top of the engine

**Model: Claude Opus 5.5 (Claude Code).** Owner wanted something they can run from the Dock instead
of .command files, starting from the existing `core/map-visualizer.html` design (it was already
built for pywebview — frameless titlebar, `window.pywebview.api` hooks — just on mock data).

**Changed**
- Unbundled the design into `core/web/` (index.html, app.css, app.js, Leaflet 1.9.4 + Inter /
  JetBrains Mono vendored). app.js rewritten onto the real API: routes/places from disk, Drive /
  Spoof toggle + mph, click-the-map pin, status pills (map / phone / live), console fed by the
  server log, pin animated on the **server's timeline in real time** (the mock's 20× clock is gone;
  PAUSE is gone too — neither sim can pause — it's STOP & CLEAR now).
- `core/backend/`: `server.py` (FastAPI, 127.0.0.1 only, cross-origin POSTs refused), `session.py`
  (one job at a time; stop = SIGINT/ENTER the job, then clear every sim touched — pmd3 and devicectl
  are separate services), `device.py` (pmd3 adapter, same CLI calls as spoof.py, `VIDA_DRY_RUN=1`),
  `routes.py` (summary + GPX build, spoof.py now uses it), `places.py` + `core/places.json` (one
  preset list for spoof.py and the app; added Miami).
- `mac-version/`: `app.py` (pywebview window, clears the phone on close / Cmd+Q / SIGTERM),
  `drive_engine.py` (devicectl engine, wraps devicectl_route.py), `app.command`, `make-app.command`
  → `~/Applications/Waypoint.app` with an icon (`app/icon.svg` → icns via AppKit).
- `pywebview==6.2.1` in requirements (darwin-only marker). pmd3 pins unchanged (checked).

**Found**
- **CARTO `dark_all` tiles now return "API KEY REQUIRED"** images. Switched to Stadia
  `alidade_smooth_dark` — keyless when the Referer is localhost (401 without one).
- **macOS 26 won't open a .app whose executable is a shell script** (`open` → -10669, even though
  lsregister registers it). Fixed with a ~30-line C launcher (`app/launcher.c`) compiled by
  make-app with the repo path baked in; it `exec`s the venv python → one process, LaunchServices
  shows it as Waypoint / `local.vida360.waypoint` (checked with lsappinfo — no extra "Python" app).
- pmd3 `simulate-location set/play` block in `wait_return()` (sigwait on Mac, `input()` on Windows)
  — and `play` keeps holding the last point after the route ends. The Job class handles both.

**Verified (no phone moved)**: every endpoint in dry run; spoof→drive→place switching clears the
other service; headless-Chrome screenshots of idle + mid-drive; the built app launches from
LaunchServices; with a dry-run hold/drive active, both `quit app "Waypoint"` and SIGTERM log the
clear for every sim touched (SIGTERM needed a sigwait thread — Python handlers never run under the
Cocoa loop). A failed clear now stays dirty + warns instead of claiming "cleared". Not tested: the
titlebar ✕ (can't click it from here; it calls destroy(), and cleanup also runs after
webview.start() returns), window drag/resize (no screen access), Windows. Phone was unplugged by
the end, and the app correctly showed "not found". Force-quit leaves the pmd3 child holding → recover
with `spoof clear` / `drive --clear`.

**Next**
- **First real run from the app, with the owner watching**: place → stop, then a short Drive route.
  Confirm stop really clears both sims and the pin goes back to real GPS.
- Does devicectl's `simulate location route` return right away or block until the end? The app
  handles both, but the console will show which.
- Nice-to-haves: save a dropped pin as a place from the UI, flights (`fly`) in the app, DDI /
  Developer-Mode detail in the status pills, phone-over-Wi-Fi (devicectl lists it as "available
  (paired)" when unplugged).

---

## 2026-10-22 — Repo reorganized: mac-version/ + windows-version/ over a shared core/

**Model: Claude Opus 5.5 (Claude Code).** Owner wanted a clear two-folder "Mac version / Windows
version" layout. Picked (with the owner) two version folders over one shared engine, so fixes
still happen once:

- `core/` — spoof.py, routes/ (was data/routes), backend/, tools/, tests/, map-visualizer.html
  (was "Waypoint Map Visualizer/export/Waypoint.html"), build/.
- `mac-version/` — spoof/fly/setup + new **drive.command** and `devicectl_route.py` (moved from
  tools/, Mac-only real-speed path; now takes a route name like `emoji-test`).
- `windows-version/` — spoof/fly + new **setup.cmd** (uv venv, same as the Mac one).
- `.venv`, `.env`, requirements.txt stay at the root. observe.py's default `--env` still points at
  the root `.env`.

READMEs rewritten (root picks a version; core/README explains the engine; Windows README says
real speed is Mac-only). Live docs + script headers repointed; old plans/specs/research left as
historical.

**Verified (no phone):** 7 tests pass, spoof lists all 7 routes from core/routes, fly lists trips,
drive builds route files by name (also when run from another directory), all .command files parse.
Windows launchers not run (no Windows box here) — only path edits, same pattern as before.

**Next:** unchanged — variable-speed drive (chain segments), then the >100 mph flight-detection test.

---

## 2026-10-22 — Life360 shows real mph: Xcode's devicectl location sim carries speed

**Model: Claude Opus 5.5 (Claude Code).** Owner confirmed the Mac spoof works on-device, then asked
about the 0 mph problem. pmd3's DVT injection is lat/lon only, so `CLLocation.speed` is -1 and Life360
shows 0. But Xcode on this Mac ships `xcrun devicectl device simulate location route`, which takes a
`--speed` in m/s — a different (CoreDevice) service the research had never looked at.

**Test:** cleared the pmd3 spoof, then played the snapped emoji-test route (353 points, Dolphin
Expressway) through devicectl at 15.6 m/s, interval mode 1 s. **Life360 showed 35 mph** on another
circle member's phone. First time the spoof has ever produced a nonzero speed.

**Added** `tools/devicectl_route.py` — turns a route JSON into devicectl's route file (snapped
waypoints, one speed) and plays it; `--mph` override, `--clear`. Docs updated (AGENTS.md,
ROADMAP.md, activity-emoji brief, mac/README).

**Car icon showed up too** (owner confirmed). Still unknown: whether devicectl `route` blocks until done.

**Next:**
1. Variable speed — chain one devicectl call per segment so it slows for corners and stops.
2. Flight detection: the >100 mph gate was never actually reachable before (speed was -1). Now it
   is, so altitude is the only unknown left. Try a >45 m/s leg near MIA before the airplane-mode gap.
3. Still pending: airplane-mode tunnel gate (now for devicectl too), save the hotel Place, `fly nyc`.

---

## 2026-10-22 — Mac support: split launchers into windows/ and mac/

**Model: Claude Opus 5.5 (Claude Code).** Owner picked the project back up on a Mac and wanted a
Windows version and a Mac version. Kept **one shared codebase** (all the Python was already
platform-neutral — it calls pmd3 via `sys.executable`, paths are relative to `__file__`) and split
only the launchers:

- `windows/` — `spoof.cmd`, `fly.cmd` (moved from the root, paths now `%~dp0..\`), + README.
- `mac/` — `spoof.command`, `fly.command`, `setup.command` (uv venv on 3.12), + README.
  `.command` so they double-click in Finder like the `.cmd` ones.
- AGENTS.md / README / spoof.py + fly.py headers point at the new launchers.

**Verified on the Mac (no phone attached):** `setup.command` builds the venv, `usbmux list` talks to
usbmuxd (returns `[]`, no socket error — macOS has it built in, no iTunes needed), offline route
build OK, all 7 movement tests pass, `fly.command` lists trips.

**Note:** Mac's built-in python3 is 3.9 — always use `.venv/bin/python`.

**First on-device run (same day) — two dependency breakages, fixed:** a fresh install pulled
deps newer than pmd3 9.33.1 (released 2026-07-04): `pmd-pytcp` 0.3.8 made `stack.start()` async so
the userspace tunnel never came up, and `construct-typing` 0.8.1 crashed on importing `afc.py`.
Pinned the pre-July-8 versions in requirements.txt. After that the tunnel connects.
**⚠ Phone is now on iOS 27.0.1** (was 26.6). The update turned Developer Mode off (that's the
current blocker), and pmd3 warns the DDI build (27A5228h) is newer than it knows — may need a pmd3
upgrade if mounting fails after Developer Mode is back on.

**Next (owner, on-device, on the Mac):**
1. First Mac device run: plug in + unlock, `./mac/spoof.command eiffel`, confirm in Maps.
2. Then pick up where 2026-07-10 left off — Step 0 airplane-mode tunnel gate, then `fly nyc`.

---

## 2026-07-10 — Built the flight-arrival spoofer (Miami -> NYC): choreographer + routes + Observer arrival signal

**Model: Claude Sonnet 5 (Claude Code).** Pivoted from the (dead) emoji goal to the real north star —
a believable **flight** that fires Life360's "arrived at <destination>" push. Brainstormed the design
with the owner, wrote the spec, and built the offline-buildable parts.

**The design insight (why this works):** in airplane mode the phone is **offline**, so Life360 never
sees the flight — only the airport departure before the gap and the driven arrival after. Airplane
mode *launders* the impossible 10-min compression (a real 2.5 h flight and our 10-min gap look
identical to Life360: "offline, then far away"). So the flight arc is **never spoofed** (decided with
the owner); all realism goes into the two ground legs Life360 *does* see. Full design:
**docs/superpowers/specs/2026-07-10-flight-arrival-spoofer-design.md**.

**Built (offline, all verified):**
- **`tools/fly.py` + `fly.cmd`** — the guided choreographer. Runs: drive to MIA (route) -> hold ->
  [you toggle airplane mode ON] -> jump spoof to JFK while offline -> hold -> [you toggle airplane
  mode OFF] -> drive JFK->Manhattan hotel -> dwell -> "arrived" push. ENTER-gated at the two manual
  airplane-mode steps. Reuses spoof.py's transport glue (no duplicated pmd calls). `fly.cmd nyc`.
- **`data/routes/mia-departure.json`** (drive to MIA + dwell, snapped, 25.7 min, validates) and
  **`data/routes/jfk-to-hotel.json`** (JFK -> The Plaza placeholder, snapped, 36.5 min, ends with a
  5-min dwell inside the hotel Place; starts ~20 km out so the entry is a genuine outside->inside
  crossing — the reliable arrival trigger). Both build + validate clean (1 harmless launch-accel warn).
- **Observer arrival signal:** `MemberState.place_name` now surfaces `location.name` (the Place name
  while INSIDE a Place) — previously **masked** behind the street address in `client.py._member`, so
  the arrival-state signal was being lost. Added `Life360Client.places()` (reads a Place's exact
  **radius** in meters) and `observe.py --places`. `place_name` flows into the JSONL log automatically.
  Verified offline: inside-a-Place vs raw-GPS mapping, oneline shows `@Place`, all 7 movement tests
  still pass.

**API-behavior correction (ground rule #3):** the earlier AGENTS.md claim that "iOS derives speed
from successive positions, so our point spacing is the speed signal" is **wrong on-device.** Today's
emoji-A/B logs showed the spoofed-moving phone reports `CLLocation.speed == -1` (invalid) on every
sample, while the real stationary phone reports `0.0` — i.e. the DVT-injected location carries **no
valid speed** (the service is lat/lon only) and Life360 reads that field directly. Corrected in
AGENTS.md. (Good news for arrival: it's purely spatial, speed-independent — §4 of the geofence brief.)

**Next (owner, on-device, in order):**
1. **Step 0 gate (decisive):** does the userspace tunnel survive an airplane-mode toggle? Hold
   `spoof.cmd eiffel`, toggle airplane mode on then off, confirm the spoof holds/re-establishes. This
   gates the whole choreographer (if it drops, we handle the reconnect race).
2. Save a Manhattan hotel as a Life360 **Place**; read its real radius with `observe.py --places`;
   point `jfk-to-hotel.json`'s final waypoint at it.
3. Line up a 2nd circle member to watch for the push; run `observe.py --watch --log flight.jsonl`.
4. `fly.cmd nyc` -> follow the prompts -> watch for "arrived". Then stamp out CDG/LAX from the same shape.

---

## 2026-07-10 — Emoji A/B COMPLETE: Motion & Fitness makes no difference; Phase A #1 resolved NO

**Model: Claude Sonnet 5 (Claude Code).**

Ran the second (ON) leg to complete the Motion & Fitness A/B from earlier today. Full comparison:

| | OFF leg | ON leg |
|---|---|---|
| Route span captured | ~12 min (306 samples) | ~19 min (376 samples) |
| `speed_raw` ever nonzero | never | never |
| `isDriving` ever TRUE | never | never |
| Server update interval | 61-952s | 62-715s |

**Verdict: the two legs are statistically indistinguishable — Motion & Fitness ON vs OFF made no
difference.** This refutes the brief's original hypothesis that turning the permission OFF would
unlock GPS-only speed/driving inference. Both runs confirm the spoof + engine genuinely moved the
pin the full route; Life360's server just never computed a nonzero speed or driving classification
in either condition.

**New leading hypothesis (reasoned, not yet directly confirmed):** it's Life360's own sparse
**server-side position-update cadence** (~60-75s median in both legs) that's the real bottleneck —
too coarse to ever clear the ½-mi/15-mph/850m Drive Detection gates within a single interval,
independent of the permission. Possibly itself downstream of CoreMotion reporting `stationary`
(throttling background upload frequency), but that's speculative.

**Docs updated:** `docs/research/activity-emoji-coremotion.md` (verdict flipped, frontmatter
`device_verified: full`, on-device update block rewritten with the full comparison table);
`ROADMAP.md` (Phase A #1 checked off as RESOLVED NO, movement-emoji route-preset item marked
resolved/deprioritized).

**Next:** the movement-emoji goal is deprioritized per the roadmap update above (no known lever
left except an untested much-longer sustained run). Remaining open items unchanged: re-run the
flight-gap research brief; locate/re-add a real UI.

---

## 2026-07-10 — Live Observer confirmed working + first emoji A/B leg (Motion & Fitness OFF): no speed, no isDriving flip

**Model: Claude Sonnet 5 (Claude Code).** Flagging in case this gets revisited/redone with Opus.

**Token auth confirmed live.** Owner captured a `LIFE360_TOKEN` via web DevTools (life360.com →
Network tab → `Authorization: Bearer` header on the `/v3/circles` GET, not the OPTIONS preflight)
and dropped it in `.env`. `observe.py` now reads the real account: 2 circles ("og clan" 12 members,
"bird gang" 3 members). Also spotted (same token, unused by our client) `/v3/users/me` (account
profile) and `/v4/users/premium` (subscription status) — documented in `docs/LIFE360_OBSERVER.md` §3
for future reference, not wired in.

**Ran the Motion & Fitness OFF leg of the emoji A/B, instrumented.** With the permission OFF, owner
ran `spoof.cmd emoji-test` while `observe.py --watch --log` recorded. Result: **306/360 samples
landed on the route corridor over a real ~12 min span** (so the spoof itself played correctly, then
reverted to the real home location afterward — not a mid-route crash as first suspected) **but
`speed_raw` stayed 0/-1 and `isDriving` never flipped TRUE for the entire run.** This is evidence
*against* the "Motion & Fitness OFF unlocks GPS-only speed detection" hypothesis from the CoreMotion
research brief — but not conclusive on its own; the **Motion & Fitness ON** comparison leg (same
route, same instrumentation) hasn't been run yet. Updated
`docs/research/activity-emoji-coremotion.md` with this on-device result; **did not flip the verdict**
— that needs the ON leg run + compared via `correlate.py` first.

**Bug fix: `tools/correlate.py` crashed on this exact data shape.** `ratio = ... if (med_obs and
med_emi) else None` treated a median observed speed of `0.0` as falsy → crashed formatting `None` as
a float. Fixed the truthiness check to `is not None`, made the report degrade cleanly ("n/a") instead
of crashing, and fixed an em-dash mojibake in the unit-guess string. Re-verified against the real
`run-off.jsonl` — prints cleanly now. Details in `docs/LIFE360_OBSERVER.md` §11.5.

**Next:** run the Motion & Fitness **ON** leg of the same emoji-test A/B (same instrumentation),
then `correlate.py` both logs side by side to actually decide the verdict. Also still open: re-run
the flight-gap research brief; locate/re-add a real UI (the Waypoint Visualizer is a standalone
export, not wired in).

---

## 2026-07-09 — Added the Waypoint Map Visualizer (first UI artifact), committed + pushed

Owner added **`Waypoint Map Visualizer/export/Waypoint.html`** — a single self-contained ~530 KB
bundled HTML single-page app (its own loader/splash; no external assets). Committed + pushed as-is at
the owner's request. Not yet wired into anything — it's a standalone visualizer, separate from the
planned FastAPI+Leaflet UI in AGENTS.md (M3). Left the folder name with spaces as given.

**Note:** this is a prebuilt/exported bundle, not source — if we want to iterate on it, we'll want the
source project, not just the export. Flagging for later; no action taken now beyond committing it.

**Next:** unchanged — owner on the token → emoji A/B path; flight-gap research brief still to re-run.

---

## 2026-07-09 — Committed 2 of 3 mega-prompt research briefs (geofence arrival + account safety)

The research agent produced two of the three briefs from the mega prompt and I committed/pushed them:
- **docs/research/life360-geofence-arrival-mechanics.md** — the exact parameters that fire "arrived
  at <Place>" (radius, outside→inside crossing, dwell/latency, Place-create API). Directly unblocks
  the CDG arrival route (M1.5 / SWE-2 #4). Open gates: geofence-crossing-required,
  geofence-dwell-latency.
- **docs/research/life360-account-safety-detection.md** — server-side spoof/impossible-travel
  consequences + API-access risk (poll cadence, ban risk) so we don't flag the owner's real account.
  Open gates: account-flagging-risk, api-poll-cadence-safe.

**Still missing:** the third brief (flight-gap / stop-spoof behavior) was NOT produced — re-run that
part of the mega prompt. **Also:** owner mentioned adding a UI, but there is **no UI anywhere in this
working copy** (no web/ui/frontend, no html/css/js — searched tracked/untracked/ignored). It wasn't
committed because it isn't here; owner to confirm where it was saved.

**Next:** re-run the flight-gap research; locate/re-add the UI; owner still on the token → emoji A/B path.

---

## 2026-07-09 — Built Observer Increment 4 (tools/correlate.py) — the offline analysis loop is done

SWE-2 concurred on the ranking: #1 (live-verify + emoji A/B) is token/phone-gated, so the highest
*coding* ROI right now is `correlate.py`. Built it.

**`tools/correlate.py`** — aligns an Observer JSONL (`observe.py --log`) against the route GPX that was
played, and reports the three things this whole effort exists to measure:
- **Speed:** median observed vs emitted, a **unit guess** (mph / m/s / km/h from the ratio), and the
  **under-read %** (sparse Life360 sampling smooths our speed down).
- **isDriving timeline:** did the driving flag flip, and how far into the route — the direct
  emoji-reachability answer.
- **Server cadence:** min/median/max interval between distinct server updates — the "stutter,"
  quantified.
- **Aligns by position, not timestamp** (the GPX uses a synthetic 2020 epoch; the observer stamps real
  wall-clock) — each sample matched to the nearest emitted GPX point. Read-only, stdlib.

**Verified offline** against a synthesized JSONL + a built GPX: correctly reported MPH + an ~18%
under-read + an `isDriving` flip at ~160s + 5s cadence; degrades cleanly on a no-speed/no-driving run.
(Fixed a cp1252 mojibake — swapped `≈`/`×` for ASCII in the printed output, repo precedent.)

**Observer status:** Inc 1 (auth/one-shot), Inc 2 (watch+JSONL), Inc 4 (correlate) all **code-complete
and offline-verified**; only the **live run needs a token**. Inc 3 IS that live run (the instrumented
emoji A/B) — nothing left to build for it.

**Next (owner):** get `LIFE360_TOKEN` working → `observe.py --watch --log run.jsonl` during the emoji
A/B (Motion & Fitness ON then OFF) → `correlate.py --log run.jsonl --gpx build/emoji-test.gpx`. That
sequence answers the emoji question with data. Remaining cheap offline items if wanted: Valhalla
`trace_attributes` per-edge speed, MOVEMENT_ENGINE.md doc-drift fix.

---

## 2026-07-09 — Built Observer Increment 2 (watch loop + JSONL logging) — offline while owner's at work

Owner is at work (no rig); asked for the highest-ROI offline SWE work. Analyzed the new
life360-flight-detection.md in depth: it *refines* the flight-push verdict (narrowed to the altitude
gate; frontier territory) but is **phone-gated and explicitly warns against pre-building flight
routes** (§7.4) — so it does NOT beat the Observer track. Built the clear winner instead: the exact
next Observer step, fully offline-buildable, which unblocks the emoji A/B the moment the token lands.

**Built (Increment 2, code done; live-verify pending a token):**
- `tools/observe.py` gained **`--watch`** (poll loop, exponential backoff cap 60s on transient
  errors), **`--interval`** (default 4s), **`--log FILE`** (append JSONL: every `MemberState` field +
  ISO timestamp + circle, flushed per write). Refactored into `setup_client` / `collect` /
  `run_once` / `watch` / `log_record`. Still read-only, stdlib-only.
- **Verified offline with a fake client** (no network): `collect`+filter, `run_once`, JSONL shape,
  and `--help` all pass. The infinite watch loop reuses the tested `collect`/`log_record`.

**Analysis takeaways for the owner (things to do at work, no rig):** (1) try the **Method A token
capture from a work browser** (life360.com + DevTools needs no home rig — could get the token today);
(2) **save CDG as a Life360 Place** from the phone app (required precondition for the geofence
"arrived" north star); (3) optional: line up a 2nd circle member for the flight experiment.

**Next:** owner gets the token (home or work-browser) → run `observe.py --watch --log` during the
emoji A/B. Then Increment 4 (`correlate.py`, fully offline) can align that JSONL against the played
GPX. Still-open cheap offline items if wanted: Valhalla `trace_attributes` per-edge speed, and the
MOVEMENT_ENGINE.md airport-auto-Place doc-drift fix.

---

## 2026-07-09 — Deep research: Life360 Flight Detection — how it works, nobody's spoofed it, verdict narrows to ONE gate (altitude)

Owner asked for a deep-research analysis of Life360's **Flight Detection / Landing Notifications** setting:
how it works, and whether anyone's spoofed the "landed at <airport>" push. Ran it as a 4-front dive (same
method as the CoreMotion brief) — read the new `backend/life360/` client + Observer doc firsthand, fanned
out four cited + adversarially-verified web agents (official mechanism/settings; prior-spoofing hunt; the
technical gates; the API/server-side read path). New doc: **docs/research/life360-flight-detection.md**.

**How it works (HIGH, primary/verbatim):** a sensor-fusion + airport-geofence + airplane-mode heuristic
(NOT a flight-API lookup). Signals = location + altitude + speed. Fires when the phone pings **within 100 m
of an airport**, hits **>100 mph**, goes **Airplane Mode ON**, then **OFF** near a **second airport within
24 h**, and the push is sent **on network reconnect post-landing**. It's **free**, **ON by default**,
per-member at **Settings → Flight Detection**, and draws a **plane icon** on the map. Motion & Fitness is
NOT tied to it (Life360's permissions page scopes Motion only to driving/crash) ⟹ flight "altitude" is
likely `CLLocation.altitude` (GPS), not the barometer; and `CMMotionActivity` has no "flying" class anyway.

**Has anyone spoofed it? NO public prior art (HIGH).** Zero confirmed demos, zero credible claims, and no
"can't be done" consensus either — the scene pranks *crash* detection but never *landing*. Only two Life360
tools exist (`lifespoof` = MITM payload rewrite; an empty stub); the 2024 Life360 API breach proves the
ingest API is MITM-able. Frontier territory.

**Can WE trigger it? NO-until-tried, gated solely on ALTITUDE (this REFINES the old flat NO).** The prior
doc over-weighted the airplane-mode/reconnect gates — the owner's **hand toggle satisfies them
authentically** (it produces the genuine connectivity gap→restore), and airport/speed/two-airport are
injectable (USB tunnel should survive airplane mode — verify). **Every gate is satisfiable except
altitude**, which is dead both ways (injected GPS carries no altitude; barometer reads ground-flat on a
still phone). So the literal push fires **iff Life360 treats altitude as a soft signal, not a hard
climb/descent gate** — genuinely untested. Documented the exact MIA→CDG hand-airplane-mode experiment
(§5), plus a Path B escalation (API MITM payload injection — most capable, unattempted, out of scope). The
API can neither produce nor observe the push (no flight field, no notification endpoint — confirms the
Observer §1.3 caveat).

**Docs touched:** new life360-flight-detection.md; README index + TL;DR #10 + new open gates
(`flight-push-manual-toggle`, `flight-altitude-hard-gate`); cross-linked from
life360-notification-triggers.md §2. No code touched.

**Next (owner, on-device):** run the §5 sequence — establish at MIA → >100 mph leg → hand Airplane Mode ON
→ inject the gap to CDG → Airplane Mode OFF → watch a second circle member's phone for the "landed at CDG"
push. Fires ⟹ altitude is soft ⟹ literal push reachable (flip the gate YES). No push ⟹ altitude is a hard
gate ⟹ keep the geofence "arrived at CDG" fallback (needs none of this).

---

## 2026-07-09 — Wrote the Observer at-home setup runbook

Owner is at work; will do the token capture at home. Wrote **docs/OBSERVER_SETUP_AT_HOME.md** — a
step-by-step runbook to get `observe.py` printing live data: an optional 30-sec email+password test,
then two token-capture methods (Method A: web login + browser DevTools; Method B: mitmproxy capture
off the iPhone, with cert-trust + proxy-cleanup steps), then how to confirm it works and what to
report back (does it print location? what does `speed` read → mph?). Troubleshooting section included.
No code change — documentation only.

**Next (owner, at home):** follow the runbook, set `LIFE360_TOKEN` in `.env`, run `observe.py`, report
location + speed. Then Increment 2 (watch loop + JSONL) and the instrumented emoji A/B.

---

## 2026-07-09 — Observer auth: owner's account is passwordless → added token-based login

**On-device result:** running `observe.py` returned **403 "Invalid login and password."** The client
token + endpoints are correct (Life360 accepted the request and rejected only the creds). Owner then
signed out/in and confirmed the account is **passwordless — phone number + SMS code, no password
anywhere in settings.** So `grant_type=password` can never succeed for this account.

**Researched the SMS-code path — dead end for a safe build.** The passwordless SMS-verification
endpoints are **not reliably reverse-engineered** in any public client (pnbruckner/life360,
kaylathedev/life360-node-api, the API-docs site all do username/password only; the main maintainer
said he couldn't get SMS login working). Guessing endpoints risks Life360's **24 h verification
lockout**. Did NOT build the SMS script — not worth risking the account on guesses.

**Pivoted to token auth (safe, reliable).** Added `Life360Client.use_token()` and taught
`observe.py` / `.env` to accept **`LIFE360_TOKEN`** (used first; falls back to user/pass). The owner
obtains a long-lived bearer token once from a session they control — mitmproxy capture off the iPhone,
or web-login DevTools — and pastes it into `.env`. No new SMS requests, no lockout risk. Verified the
token path offline (`--check` shows it, `use_token` authenticates the client). Updated
docs/LIFE360_OBSERVER.md §3/§8 and `.env.example` (LIFE360_TOKEN is now the primary option).

**Next (owner):** grab a bearer token (proxy or web DevTools), set `LIFE360_TOKEN` in `.env`, run
`observe.py`. Then Increment 2 (watch loop + JSONL) and the instrumented emoji A/B.

---

## 2026-07-09 — Built Life360 Observer Increment 1 (auth + one-shot read)

Built the read-path core per docs/LIFE360_OBSERVER.md. **Nothing on-device yet — code is done and
verified offline; needs a live run with the owner's real Life360 login.**

**What landed:**
- `backend/life360/` — `client.py` (the ONLY place that speaks Life360's API: `authenticate()` →
  bearer token, `circles()`, `members()`; all urllib/HTTP/JSON quarantined; own `Life360Error`),
  `model.py` (`MemberState` + a compact `oneline()`), `__init__.py`. **stdlib urllib, no new deps.**
- `tools/observe.py` — one-shot CLI: loads `.env` (tiny stdlib parser), authenticates, lists circles,
  prints each member's current server state; `--member` filter.
- Creds via **`.env`** (owner's choice): `LIFE360_USER` / `LIFE360_PASS`. `.env` was already
  gitignored; added `data/life360.creds.json` too. Committed `.env.example` as the template.
- **API specifics cribbed from pnbruckner/life360** (WebFetched the source): host
  `api-cloudfront.life360.com`, `POST /v3/oauth2/token` (Basic client token), `GET /v4/circles`,
  `GET /v3/circles/{id}/members`. Android user-agent set.

**Verified offline:** imports clean, `oneline()` formats, `--help` works, and the no-credentials path
prints a helpful message + exits 2. Fixed an em-dash→cp1252 mojibake in one print (repo precedent:
keep console output ASCII on Windows). Could NOT test auth/reads — no creds here, by design.

**Next (owner):** copy `.env.example` → `.env`, fill in your Life360 login, run
`.venv\Scripts\python.exe tools\observe.py`. Confirm it prints your real location, and check whether
`speed` reads in **mph** (the one live unknown). Then Increment 2 (watch loop + JSONL logging) so we
can run the emoji A/B instrumented.

---

## 2026-07-09 — Designed the Life360 Observer (server-side telemetry read path)

**Why:** every on-device experiment currently ends with "owner eyeballs the app" — slow, subjective,
and limited to what the app draws. The CoreMotion feasibility brief
(docs/research/coremotion-injection-feasibility.md §7 + sources) surfaced that Life360's own server
data model exposes each member's **speed** and an **`isDriving`** flag via the same unofficial API the
Home Assistant integration uses. So we can *read what Life360 actually sees* instead of guessing.

**Wrote docs/LIFE360_OBSERVER.md** — full design + incremental build plan for a read-only telemetry
tool (the mirror of the spoof write path):
- **Architecture:** `backend/life360/` (client + `MemberState` model — the ONLY place that speaks the
  Life360 HTTP API, quarantined like the pmd3 adapter) + `tools/observe.py` (one-shot | watch | log).
  Strictly read-only; no coupling to `backend/movement/`. **No new deps** — stdlib `urllib` like
  snapper.py.
- **Payoff:** (1) settles the driving-emoji question by *watching `isDriving` flip* (or not) during a
  spoof; (2) quantifies the "stutter" (real server update cadence); (3) confirms the CDG geofence
  arrival server-side; (4) turns route tuning into emitted-vs-observed measurement.
- **Build plan:** Inc 1 auth + one-shot read (also pins the unknown speed unit / field names on first
  live call) → Inc 2 watch loop + JSONL logging → Inc 3 the emoji A/B *instrumented* (ON vs OFF, by
  data) → Inc 4 offline `correlate.py` (align JSONL against the played GPX).
- **Risks flagged:** auth/captcha is the #1 fragility (isolated in `authenticate()`); speed unit
  resolved empirically in Inc 1; `isDriving` semantics are exactly what Inc 3 measures. Creds via env
  var / gitignored file, never in the repo.

**Nothing built yet — this is the design.** Pairs with the motion-injection brief below: since true
injection is a hard wall, this observability path is how we squeeze the most out of the levers we *do*
have (the Motion & Fitness A/B, route tuning, arrival confirmation).

**Next:** build Observer Increment 1 (auth + one-shot), then run the emoji A/B with it watching so the
result is `isDriving` data, not a flickering icon.

---

## 2026-07-09 — Research: motion injection is a hard wall; the one no-JB lever is Motion&Fitness-OFF *suppression* (new brief)

Owner asked, exhaustively: is there ANY software way to inject/override/**suppress** CoreMotion on our
stack (owned non-JB iPhone, iOS 26.6, pmd3 userspace tunnel, Windows) so Life360 reads "driving" on a
physically still phone? Ran it as a 5-front dive — I read the **installed pmd3 9.33.1 source firsthand**
for the primary evidence and fanned out four web-research agents (DVT/DTX + condition_inducer; XCTest/
CoreMotion/Simulator; TrollStore/jailbreak on 26.6; Life360 Motion&Fitness behavior). All cited +
adversarially verified. New doc: **docs/research/coremotion-injection-feasibility.md**.

**Verdict — INJECTION: no, HIGH confidence, primary-sourced.** The complete DVT/DTX surface reachable
via the mounted DDI is 13 Instruments services + the XCTest interfaces, and **not one carries a motion
selector** — the only sensor channel is `LocationSimulation` (lat/lon; maintainer doronz88 confirms in
#340/#1405 that Apple exposes nothing more). `condition_inducer` is Network-Link + Thermal only. The
`AccelerometerCapability`/etc. strings in pmd3 are read-only MobileGestalt *capability booleans*, not a
write path. CoreMotion is read-only, per-process, vended from the motion coprocessor (a still phone =
`stationary`, GPS-independent). XCTest/XCUIDevice have no real-device motion API; the Simulator can fake
motion but is a Mac process that never touches a handset (and none of it reaches Windows). And there's no
jailbreak/TrollStore for 26.6 (caps at iOS 17.0) — even one would need a system-wide CoreMotion-faking
tweak that has **only ever been built on Android**, never iOS. So the still-phone contradiction is a hard
architectural wall, not an engine bug — this closes the "can we fake it" question.

**The one thing that's NOT dead — SUPPRESSION.** We can't make Life360 *see* fake motion, but we can
**deny it the real one**: turn Life360's **Motion & Fitness permission OFF** (Settings toggle, no code,
no JB) and bet its speed-derived emoji falls back to GPS-only, removing the contradiction. MEDIUM
confidence, **untested** — the wrinkle is Life360's API also has an `isDriving` flag separate from speed
that *might* still gate the display emoji. This is now the highest-value on-device action for the emoji
goal, and `data/routes/emoji-test.json` was already built for it.

**Docs touched:** new coremotion-injection-feasibility.md; added it to the research README index +
TL;DR #9 + a new `motion-and-fitness-off` open gate; cross-linked activity-emoji-coremotion.md §4 to the
exhaustive backing. Bonus finding logged: pmd3 Discussion #1747 says the DVT `simulate-location` path
does **not** set `isSimulatedBySoftware` — consistent with the spoof already showing on Life360 (gate #0
looks clear). No code touched.

**Next (owner, on-device):** run `spoof.cmd emoji-test` **twice** — Motion & Fitness ON then OFF — and
report whether the car emoji + mph appear. Emoji with it OFF ⟹ GPS-only fallback works ⟹ flip the emoji
doc to YES. No emoji either way ⟹ accept the wall, keep the geofence "arrived at CDG" north star (which
this permission doesn't affect). Same test the prior entry queued — now with the full theory behind it.

---

## 2026-07-09 — On-device: driving emoji won't hold on a still phone (CoreMotion contradiction) + emoji-test route

**Owner ran `miami-cruise` at home overnight. It plays fine, but the driving (car) emoji + mph
would NOT reliably show.** Same day, driving to work for real, the car emoji appears with no
problem — **even when going slow.** This is the cleanest confirmation yet of the two-subsystem
split in docs/research/activity-emoji-coremotion.md:

- **Real drive:** the motion coprocessor reports `CMMotionActivity = automotive` (accelerometer +
  gyro feel the car). Once classified "in a car," the emoji **holds through slow patches** because
  it's motion-derived, not instantaneous-speed-derived.
- **Spoof on a still phone:** CoreMotion reports `stationary` no matter what the (spoofed) GPS
  says → Life360 gets a **contradiction** (GPS "moving 18 mph" vs accelerometer "not moving") and
  suppresses the car emoji. We inject lat/lon only; the accelerometer isn't on the DVT bus and
  can't be faked without a jailbreak. **This is a hard wall, not an engine bug.** (Note the very
  first `miami-demo` run *did* flash the car emoji on the teleport — the speed-derived path can
  fire briefly before the "stationary" vote reasserts.)

**Not flipping the doc verdict to NO yet** — the decisive test is still pending: does turning
**Life360's Motion & Fitness permission OFF** make it fall back to GPS-only activity (removing the
contradicting "stationary" signal)? That's the LOW-confidence hypothesis in the research brief and
the single most promising lever.

**Built `data/routes/emoji-test.json` for that test** — a single steady **~35 mph (15.6 m/s)** run
west on the Dolphin Expressway (SR-836), Valhalla-snapped, **no trailing stop**, tuned to Life360's
activity gates (above the ~15 mph walk/drive split, below the 80 mph speeding flag, >1.5 mi,
~10 min sustained). Built + validated offline: 606 fixes, 10.1 min, 15.7 m/s smoothed (57 km/h),
1 warning (the on-ramp launch accel, harmless). Run: `spoof.cmd emoji-test`.

**Confirmed Motion & Fitness is orthogonal to the airport goal:** the geofence "arrived at CDG" is
pure location (unaffected by the permission); only the *literal* flight "landed" push wants the
barometer/altitude behind Motion & Fitness — and that's unfakeable on a still phone anyway. So
toggling it OFF for the emoji test costs the airport project nothing.

**Next (owner, on-device):** run `spoof.cmd emoji-test` **twice** — once with Life360's Motion &
Fitness ON, once OFF — and report whether the car emoji + mph appear. Emoji with it OFF ⟹
GPS-only fallback works ⟹ Phase A #1 = YES (flip the doc). Still no emoji either way ⟹ the emoji is
motion-gated on a still phone ⟹ Phase A #1 = NO (accept the wall, keep the geofence arrival goal).

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
