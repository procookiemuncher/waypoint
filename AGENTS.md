# AGENTS.md

> Read this first, then **PROGRESS.md** (current state). This file is how the project works and
> why. Dated history lives in PROGRESS.md / docs/progress-archive.md, not here.

## What this is

**vida-360** spoofs the GPS location of the owner's own iPhone from a Mac or Windows PC: fixed
points (Eiffel Tower, Dubai, Miami...) and realistic movement along routes. The app is
**Waypoint** (Mac Dock app, or the same page in a browser). Each user spoofs only their own phone.

**Goal:** get Life360 to push **"Juan arrived at Paris (CDG)"** to the group. The literal
flight-detection "landed at CDG" push is **not reproducible** (needs real altitude + an
airplane-mode toggle + a post-landing reconnect), and airports are **not** auto-recognized
Places. The achievable equivalent is a **geofence arrival**: save CDG as a Life360 Place, then
drive into it believably (no impossible-speed teleport, GPS drift present) and dwell.
Full analysis: docs/research/life360-notification-triggers.md.

**What works (on-device):** a static spoof shows on Life360, not just Find My. The movement
engine is built. The drive path shows **real mph + the car icon** on Life360. No VPN needed:
Life360 trusts the GPS over the connection's IP city.

## How it works

iOS ships a developer location-simulation service (what Xcode's "Simulate Location" uses). It
injects at the CoreLocation layer, so **every** app sees the fake location. No jailbreak. On
iOS 17+ it sits behind Apple's RemoteXPC tunnel (RSD), reached with
[`pymobiledevice3`](https://github.com/doronz88/pymobiledevice3) (pmd3). The phone is on
**iOS 27.2.1**, so the tunnel is the only path.

There are **two location services**, and the difference matters:

| | DVT `simulate-location` | CoreDevice location service |
|---|---|---|
| Engine | `spoof` | `drive` (`core/backend/drive.py`) |
| Input | lat/lon only (pmd3 issue #340) | waypoints + **speed** + pacing |
| Speed iOS reports | `-1` (invalid), so no mph and no car icon | real, so Life360 shows mph + car |
| Notes | `play <gpx> [noise_ms]` replays on GPX time deltas | phone-side `dtlocationd`, RSD `com.apple.coredevice.locationservice`; set / route / clear via a `python -c` helper (pmd3's CLI has no command) |

The geofence arrival is purely spatial, so it works on both. Places/pins are held by the
CoreDevice sim (`setsimulatedlocation`), which hands off and exits, no process kept. pmd3 11.59
mounts its own DDI, so **no Xcode is needed**. Details: docs/research/no-xcode-speed-sim.md.

**Airplane mode (pmd3, Mac + Windows, not in the app):** two iOS Shortcuts on the phone,
`vida-airplane-on` (Airplane On + Wi-Fi Off) and `vida-airplane-off` (the reverse), made by hand in
the Shortcuts app. `CoreDevice.airplane(on)` in device.py runs one through CoreDevice
`launchapplication` for `com.apple.shortcuts` with the URL in `options.payloadURL`
(`{"relative": "shortcuts://run-shortcut?name=…"}`, what devicectl's `--payload-url` fills). No
CoreDevice feature just opens a URL, and pmd3's `launch_application` has no slot for it, so the helper
builds the input itself. Silent, no prompt, ~0.3 s, phone unlocked. Works over the **cable** only:
new tunnels still reach the phone in airplane mode; Wi-Fi pairing doesn't. The launch answers before
the Shortcut runs, so True means "sent", not "toggled", and `fly` asks the owner to confirm each flip.
`fly airplane on|off` flips it from a terminal. Nothing calls devicectl any more.

## Detection and limits (details in docs/research/)

- **`isSimulatedBySoftware` is untested and decisive.** iOS 15+ apps can read
  `CLLocation.sourceInformation.isSimulatedBySoftware`. Xcode's sim sets it `true`. Ours may too.
  If so, any app can detect the sim in one line. Phase A gate #0.
- **Driver reports / crash / hard-braking** are Arity **CoreMotion** (real accelerometer +
  gyro). Not spoofable on a still phone, out of scope. Target the emoji, not the reports.
- **No untethered spoof without a jailbreak.** The "location stays after you disconnect" that
  commercial tools sell is a frozen stale dot, cleared by iOS 18+.
- **Transport is the standard one.** Every serious tool rides the same DDI/DVT/RemoteXPC rails.
  Fallback: `go-ios` (watch only, needs elevation). Standing risk: iOS hardening against the whole
  DDI class.

## Environment and layout

- **Hosts:** Windows and macOS. **Target:** iPhone on iOS 27.2.1.
- **Language:** Python for the engine and server, plain JS/CSS for the page (`core/web/`, no
  framework, no build step outside release minifying), a tiny C launcher for the Mac app. No Swift.
- **Python 3.12/3.13** in `.venv` (3.14 doesn't work). Deps pinned exactly in requirements.txt.

```
mac-version/       Mac launchers (spoof, drive, fly, setup), the Waypoint window (app.py), release/
windows-version/   Windows launchers (spoof, drive, fly, setup, waypoint), the Waypoint window (app.py)
core/              shared engine: spoof.py, routes/, backend/ (server, session, device, drive,
                   movement/, life360/), tools/, tests/, web/, build/ (generated, ignored)
docs/              design docs + research
cini videos/       promo films drawn in HTML, rendered with Playwright (v1 sting, v2 trailer)
.venv  .env  requirements.txt   stay at the repo root
```

**Don't copy code between version folders.** If it works on both, it goes in `core/`. Only
OS-specific stuff (launchers, the Mac window) lives in a version folder.

## Architecture: three layers, keep them separate

```
┌─────────────────────────────────────────────┐
│  UI      core/web page (Leaflet + globe)      │  served by FastAPI (server.py);
│          pywebview window on Mac, or browser  │  the Mac window is mac-version/app.py
├─────────────────────────────────────────────┤
│  Core    session.py + engines + movement/     │  one job at a time; spoof (DVT GPX)
│                                               │  and drive (CoreDevice, real speed)
├─────────────────────────────────────────────┤
│  Adapter core/backend/device.py               │  the only app module that talks to
│                                               │  pmd3: mount, DVT set/play, CoreDevice
└─────────────────────────────────────────────┘
```

Apple changes the transport periodically (it broke between iOS 16 and 17). Keeping every
transport detail in the adapter makes a future break a one-file fix.

- **Transport:** pmd3's **`--userspace`** tunnel (pure Python, no admin, no `wintun`). Most
  calls run the pmd3 CLI as a subprocess. The terminal launchers (`spoof.py`,
  `tools/play_route.py`) call the CLI the same way.
- **Server:** `server.py` is FastAPI on 127.0.0.1 only, and rejects any Host but
  127.0.0.1/localhost (DNS rebinding).
- **Session:** `session.py` runs one job at a time. Stop = kill + clear every sim touched.
  `Session.use_placer` points places/pins at drive's hold.
- **Mac app:** `make-app.command` builds `~/Applications/Waypoint.app` around a compiled
  `app/launcher.c` that execs the venv python. macOS 26 won't launch a bundle whose executable is
  a shell script (error -10669).

## Key decisions: don't relitigate without a real reason

| Decision | Why |
|---|---|
| Python core, not Swift | Swift tools are macOS-only; hosts are Windows + Mac. |
| `pymobiledevice3` as transport | Only maintained lib for iOS 17+ that works on Windows. |
| FastAPI + Leaflet local web UI | Best map picker for least code, one Python process, cross-platform. Rejected Electron (2nd runtime) and PyQt (painful embedded map). Mac wraps it in pywebview. |
| `--userspace` tunnel, pmd3 CLI as subprocess | No admin/UAC, no `wintun`; the CLI is the stable surface. |
| All transport glue in one adapter module | Resilience against Apple's transport churn. |
| Everything stays local | A hosted server can't reach a USB-connected phone. |
| No paid Apple developer account (yet) | Testers use "Open Anyway" or `xattr -dr com.apple.quarantine`. |
| OpenFreeMap vector map, not Stadia/CARTO/MapTiler | Only free host that allows a paid app with no key or cap. Stadia/MapTiler free = non-commercial, CARTO's key can't be shared across installs, proxying tiles is banned by Stadia and CARTO. |

## Running it

### Launchers

Per platform: `windows-version/` (`spoof.cmd`, `drive.cmd`, `fly.cmd`, `setup.cmd`) and `mac-version/`
(`spoof.command`, `drive.command`, `fly.command`, `setup.command`). Each folder has a README.
Needs the `.venv`, the Apple Mobile Device Service (Windows only), and the phone **unlocked**
with Developer Mode on.

- **`spoof`** opens a "where do you want to go?" menu: a **route** (rendered + validated into a
  GPX and replayed), a **static preset** (held until ENTER), or **clear**. Direct args work:
  `spoof miami`, `spoof 48.8584 2.2945`, `spoof clear`. A new JSON in `core/routes/` shows up
  in the menu automatically.
- **`drive`** is the real-speed path (`core/tools/drive.py`). `drive.command --clear` clears it.
- **`fly <trip>`** (e.g. `fly nyc`): drive to the departure airport, an **airplane-mode** gap
  (offline like a real flight, so Life360 never sees the impossible hop), then drive from the
  arrival airport into a saved Place and dwell. ENTER-gated at both toggles: ENTER = take off / land,
  fly flips airplane mode through the Shortcuts while the airport hold runs (a background DVT `Job`),
  the owner confirms the flip, anything but a yes falls back to toggling by hand. A trip is
  `{depart route, arrive airport, destination Place + drive-in route}`. Design:
  docs/superpowers/specs/2026-07-10-flight-arrival-spoofer-design.md. Step 0's tunnel half passed
  (2026-11-21); whether a running hold keeps the spoof through the toggle is still open, check it
  before trusting a real run. pmd3's DVT `play` doesn't exit when the route ends: it holds the last
  point and waits for ENTER (Windows) or Ctrl+C (Mac), and on the Mac that Ctrl+C also cancels fly
  (read from pmd3's source, not run). Not in the app (no flight API).

### Waypoint app (Mac)

`./mac-version/make-app.command` once, then Waypoint is in ~/Applications / the Dock. Or
`./mac-version/app.command`.

- **`VIDA_DRY_RUN=1`** makes every phone command a printed no-op. **Use it for UI work.**
  `VIDA_DRY_PHONE=slow` fakes a late, locked phone; `=none` a phone that never shows.
- **Map tiles:** [OpenFreeMap](https://openfreemap.org) vector tiles (free, commercial use OK, no
  key, no rate limit), drawn by MapLibre GL 5.24.1 through the `leaflet-maplibre-gl` plugin, both
  vendored in `core/web/static/maplibre/`. MapLibre draws in Leaflet's tile pane (the tile filter
  in app.css still applies); markers, routes and pins stay Leaflet. The look is
  `core/web/static/map-style.json`, made by `core/tools/build_map_style.py` (their dark style,
  recoloured toward the old Stadia map). Change colours there and rerun, don't hand-edit the JSON.
  `tilesReady` waits for a real tile (MapLibre's `load` fires offline too). Release builds need
  nothing extra. Risk: one maintainer, no SLA; the tiles are OpenMapTiles schema, so moving to
  another host is a new source URL in the tool. MapLibre stays on 5.x (6 is ESM-only + a separate
  worker file).
- **Connect screen** (after the boot log) waits for plugged in + unlocked + DDI, all in
  `Session.phone()`/`_probe()`. Unlocked comes from lockdown `PasswordProtected` (plain USB, no
  tunnel, ~0.6 s; CoreDevice's `getlockstate` is refused on iOS 27). `mounter auto-mount` runs
  once per plug-in (15 min timeout; the first one downloads + personalizes the image).
- **Command palette:** ⌘K / ctrl+K, `core/web/static/palette.js`. go / play / pin / open / stop.
  `go` geocodes an address (`/api/geocode`, Photon) and drops a movable pin. **Anything that moves
  the phone must pass the confirm step, keep it that way.**
- **New static JS of our own** must be added to `MINIFY_JS` in `mac-version/release/stage_assets.py`,
  and use single-line strings only (rjsmin breaks multiline ones; the build `node --check`s output).
  Third-party `leaflet/` and `maplibre/` are already minified and must stay out of it.
- **Windows:** `windows-version\waypoint.cmd` opens the same page in a pywebview window (Edge
  WebView2), under pythonw, log in `%LOCALAPPDATA%\Waypoint\Waypoint.log`. The titlebar drags via
  `WM_NCLBUTTONDOWN`/`HTCAPTION`. Close clears the phone like the Mac. No splash, updater or
  release build. Works on the phone (2026-11-20): connect, DVT pin + Stop (`Job.stop()` writes
  ENTER to pmd3's stdin, the dry-run stand-in does the same), Drive with speed, quit clears.
  CoreDevice calls take ~1.5 s each here (~0.8 s on the Mac).
- **Force-quit / kill -9 leaves the pmd3 child holding the spoof** (normal close, Cmd+Q and
  SIGTERM all clear). Recover with `spoof clear` + `drive.command --clear`.

### Destinations and routes

- `core/destinations.json`: 35 spots in 28 cities (Sexy Fish, LIV, Club 55, Burj Al Arab...).
  Each city has an arrival airport (terminal coords), optionally a base hotel, spots with local
  opening hours, and a timezone. **Colour is per country** (`"countries"` at the top: colour +
  vibe name, every city's country needs one). No flags anywhere (Windows draws 🇺🇸 as "US").
  Coordinates come from OSM (Nominatim/Overpass), not memory.
- `core/tools/gen_destinations.py` turns it into routes (airport → hotel → spot: walk out,
  snapped drive, walk in, 10 min dwell; under 1 km is walked) and **refuses to write a route that
  fails validation**. Generated routes carry `"generated": true`. **Don't hand-edit them**: edit
  the catalog and rerun. Every spot is also a pin preset (`spoof sexy-fish-miami`).
  `"access": "boat"` spots (Maldives, Bora Bora) are pin-only.
- **Route times:** `/api/routes` sends `legs` and `seconds` from the renderer at seed 0 (exactly
  what Spoof plays). Rendering all routes takes ~12 s, so `server.warm_route_legs` does it on a
  thread after launch, cached in `<build>/legs-cache/`. Until then a route carries an estimate and
  `"exact": false`. A playing route's `active.legs` drives the live card.

### Access keys and the two builds

- **Dev build:** the Dock app from `make-app.command`. Keyless, DEV BUILD badge in the titlebar.
- **Production:** the compiled `release/build.command` app. Asks for a key, no badge.
  `LICENSE_URL` is baked in (required for non-`--test` builds); `VIDA_LICENSE_URL` turns keys on
  for the dev app.
- **Gate:** `server.py` middleware answers the API with 402 until a key checks out. The key
  screen (`#keygate`) is just the way in. `core/backend/license.py` checks at launch and every
  5 min; a deleted key locks the app (running jobs keep going), unreachable dashboard keeps a key
  that checked out in the last 6 h. Basic on purpose: answers aren't signed, keys aren't bound to
  one Mac.
- **Key dashboard:** separate Next.js app in `~/Desktop/projects/key dashboard` (private repo
  `procookiemuncher/waypoint-key-dashboard`), live at https://waypoint-key-dashboard.vercel.app
  (Vercel, Upstash Redis, push to main deploys).
- To see the key screen as a new user: `open -n --env HOME=/some/empty/dir <app>`, or delete
  `~/Library/Application Support/Waypoint/license.json`.
- Dry runs never run pmd3, so they can't prove a compiled build works. `build.command` runs
  `usbmux list` and a CoreDevice self-test itself.

### Releases and auto-update

**The owner says when to release, never on a plain push.**

- `VERSION=0.1.0-beta.3 NOTES="..." ./mac-version/release/release.command` (clean tree matching
  origin). Picks the next BUILD (live + 1), builds, ditto-zips + signs, makes the DMG on the
  Desktop, uploads the zip to Vercel Blob (`waypoint-releases`), PUTs the manifest to the
  dashboard's `/api/release`, tags `v<VERSION>`. `NO_PUBLISH=1` = build + DMG only. Secrets come
  from `vercel env pull` into a temp dir each run.
- Installed release copies (`core/backend/updater.py`, never the dev app) POST `/api/update`
  90 s after launch and every 3 h. A newer BUILD is downloaded, checked (sha256 + **Ed25519
  signature over `waypoint:<build>:<sha256>`**, codesign --strict) and staged in
  `~/Library/Application Support/Waypoint/update/`. It swaps in after the app quits. No relaunch,
  no update screen. Can't swap when run off the DMG or translocated. Logs: `update:` lines in
  `~/Library/Logs/Waypoint.log`.
- **Signing key: `~/.config/waypoint/update_ed25519.pem`, in no repo. Lose it and no installed
  copy can ever update again.** BUILD 0 = never updates.
- Build gotchas: build outside ~/Desktop (iCloud xattrs break codesign); DMGs must be APFS (HFS+
  breaks the signature).

## Prerequisites and failure modes

- **Windows:** Apple Mobile Device Support (iTunes or the Apple Devices app), or the phone
  isn't discovered at all. With the Store Apple Devices app, usbmuxd (`AppleMobileDeviceProcess`,
  127.0.0.1:27015) only runs once the app has started it, and a phone plugged in before that isn't
  listed (`usbmux list` = `[]`) until it's replugged.
- **Developer Mode ON:** Settings → Privacy & Security → Developer Mode (appears only after a
  dev-connection attempt; reboot + confirm). **An iOS update turns it off.**
- **Trust** the computer on first connect. Keep the phone **unlocked / awake** while spoofing.

Known failures: stale pairing record (unpair/re-pair) · personalized DDI not yet in the image
mirrors for a fresh iOS build · unpinned deps newer than pmd3 expects break the tunnel · phone
locks → DVT session drops · location slow to clear · **grey dot after a clear** (seen once:
Maps kept a grey dot on the last point, toggling Location Services off/on fixed it).

## Ground rules for agents

1. **Read PROGRESS.md first.** Its "Current state" block + recent entries are the running state.
   Older history is one-liners in docs/progress-archive.md.
2. **After work, add a short dated entry at the top of PROGRESS.md** (changed / decided / broke /
   next) and update "Current state". Past ~10 entries, move the oldest to the archive.
3. **Keep the docs true.** When you confirm something works or fails, update AGENTS.md /
   ROADMAP.md / PROGRESS.md in the same session. Write AGENTS.md as current fact, not as a stack
   of dated corrections. Stale claims mislead the next agent (the docs once said "Life360 ignores
   the spoof" long after it was shown to work).
4. **UI work runs with `VIDA_DRY_RUN=1`.** A real run moves the owner's pin in front of their
   Life360 circle.
5. Never leak `pymobiledevice3` types or errors above the adapter layer.
6. Each user spoofs only their own phone, from their own Mac. Access keys are the only
   "multi-user" part.

## Research docs (docs/research/)

Each brief opens with **YAML frontmatter** (`status`, `last_verified`, `device_verified`,
`open_gates`, `depends_on`, `source_tier`, `recheck_if`), schema in docs/research/README.md.
Two separate confidence axes: `source_tier` = how good the source, `device_verified` = did we
test it on our phone. **When you confirm or refute something on-device, flip
`status`/`device_verified` and bump `last_verified` in the same session.** Keep the prose
reasoning intact, don't shred briefs into key-value dumps.

## Git

- Commit messages read like a human wrote them. **No AI attribution** (no `Co-Authored-By`, no
  "Generated with" trailer). Commit and push after every meaningful change. Never force-push or
  rewrite pushed history without asking.
- **Commit as `juanmendoza <juanmendoza6159@gmail.com>`** (GitHub `juanmendoza-dev`), since
  2026-11-20. The owner spreads the history across both accounts; older commits were split
  between them with a rewrite (`backup-before-split` holds the pre-rewrite history).
- Signing key: `~/.ssh/juanmendoza_signing`, registered on juanmendoza-dev as a Signing key
  (`SHA256:W1yLj6HBCJLwUnER5T0CfgmHjGBKOH0lMuG89z64Hfw`), so commits show "Verified".
  `procookiemuncher` (`~/.ssh/vida360_signing`, `SHA256:aB2iV8fKwRIHqgN0ztNl7DOHN/sacv6VMbTcazbxDEg`)
  is the other identity; juanmendoza-dev has push access to the repo too.
- Remote: `procookiemuncher/waypoint` on GitHub. The Windows clone pushes over HTTPS through
  `gh auth git-credential`. Over SSH the default key is juanmendoza-dev's.

Repo-local config (once, after a clone):

```
git config user.name  "juanmendoza"
git config user.email "juanmendoza6159@gmail.com"
git config commit.gpgsign true
git config gpg.format ssh
git config user.signingkey ~/.ssh/juanmendoza_signing.pub
```
