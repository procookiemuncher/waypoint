# AGENTS.md

> Read this first, then **PROGRESS.md**. This file explains how the project works and why.
> PROGRESS.md tells you the current state.

## What this is

**vida-360** is a personal tool that spoofs the GPS location of the owner's own iPhone
from a Windows PC. v1 sets a fixed fake coordinate (e.g. Eiffel Tower, Dubai, Miami).
v2 will simulate movement along routes. Personal use, single owned device.

**Status (confirmed):** a static spoof **does** reflect on Life360 — the member's pin moves
to the fake location, not just in Find My. So Life360 is *not* ignoring CoreLocation, and a
plain "set location" already works. **The missing piece is the movement engine** — believable
*movement* (routes, per-segment speed profiles, GPS jitter, a flight "gap"), which is what a
realistic arrival and the activity indicator still need.

**End goal (corrected 2026-07-08 — see docs/research/life360-notification-triggers.md):** get
Life360 to push **"Juan arrived at Paris (CDG)"** to the group. ⚠ The *literal* flight-detection
**"landed at CDG"** push is **NOT reproducible** on our stack — it's gated on real altitude + an
airplane-mode ON→OFF toggle + a post-landing network reconnect, none of which a lat/lon-only spoof
can inject. And **airports are NOT auto-recognized Places** (the earlier "no manual Place needed"
claim was wrong — what the owner saw on a real trip was the genuine flight-detection push from
real sensors). The achievable, functionally-equivalent goal is a **geofence arrival**: save CDG as
a Life360 **Place**, then have the spoof (a) survive sanity checks (no impossible-speed teleport,
GPS drift present) and (b) believably drive into that Place and dwell → "arrived at CDG".
Movement-engine work.

**Stretch — pre-built routes** (the owner's real ambition):
- "Airport route": a believable ~30–40 min drive from CDG to a 5-star Paris hotel.
- "Full Ride": a multi-hour trip — airport → hotel, then mixed walking / driving / stops.
- Trigger Life360's **movement emoji** (the walk / drive icon it shows per member). Research
  (docs/research/activity-emoji-coremotion.md) finds this icon is likely **speed-derived**
  (spoofable); confirm in Phase A. But Life360's **driver reports / hard-braking / crash
  detection** are Arity **CoreMotion** (real accelerometer + gyro), which we do NOT spoof — the
  phone sits physically still — so those are out of scope. Target the emoji, not the reports.

**UI: first version built (2026-10-22)** — the Waypoint app (Mac Dock app + the same page in a browser). See *Running it*.

## How it works (the mechanism)

iOS ships a developer location-simulation service — the same one Xcode's "Simulate
Location" uses. It injects coordinates at the CoreLocation layer, so **every** app that
reads location sees the fake value. No jailbreak, no per-app patching.

On iOS 17+ that service lives behind Apple's RemoteXPC **tunnel** (RSD), reached with the
[`pymobiledevice3`](https://github.com/doronz88/pymobiledevice3) library. This device is on
**iOS 26.6**, so the tunnel path is the *only* option — there is no legacy pre-17 USB flow.

**Confirmed API constraint (2026-07-08, verified against pmd3 upstream):** `simulate-location
set` accepts **only latitude + longitude** — no accuracy, altitude, speed, or heading (see
upstream issue #340). The point *spacing/timing* still sets what displacement Life360 can
measure, so the movement engine is all about the point stream. `simulate-location play <gpx>
[noise_ms]` replays the points on their GPX time deltas and takes an optional ± timing-noise arg.

**⚠ Correction (2026-07-10, on-device): the injected location carries `CLLocation.speed == -1`
(invalid) — iOS does NOT synthesize a speed from successive injected fixes.** The earlier claim
here ("iOS derives speed from successive positions → point spacing is the speed signal") was wrong.
The emoji-A/B Observer logs showed the spoofed *moving* phone report `speed = -1` on every sample,
while the real *stationary* phone reports `0.0` — so Life360 reads the phone's `CLLocation.speed`
field directly and gets no valid value from us. This is why the driving emoji is unreachable
(docs/research/activity-emoji-coremotion.md). It does **not** affect the geofence arrival, which is
purely spatial / speed-independent (docs/research/life360-geofence-arrival-mechanics.md §4).

**✅ Speed workaround found (2026-10-22, on-device, Mac):** Xcode's CoreDevice location sim —
`xcrun devicectl device simulate location route --speed <m/s>` — is a *different* service from pmd3's
DVT one and it carries a real speed. The emoji-test route played this way at 15.6 m/s showed **35 mph**
on Life360 (seen on another circle member's phone). Tool then: `mac-version/devicectl_route.py` (gone, see the next note). Limits then: Mac +
Xcode only (broke the same-code-both-platforms rule, fixed 2026-11-19), one
constant speed per call (no corner slowdowns or dwell yet), no altitude. **The car icon showed up
too** — the driving emoji, dead since July, works on this path.

**✅ No Xcode needed anymore (2026-11-19, on-device, iOS 27.0.1, pmd3 11.59.0):** that "Xcode" sim is
really a service on the **phone** (`dtlocationd`, comes in with the DDI; RSD
`com.apple.coredevice.locationservice`), and pmd3 reaches it over the no-admin userspace tunnel.
`core/backend/device.py` `CoreDevice` (set / route-with-speed / clear, via a `python -c` helper since
pmd3's CLI only has `available-scenarios`) replaced every `xcrun devicectl` call. Owner confirmed on the
phone: pin shows in Maps and sticks after the helper exits, a 30 mph drive shows **mph + the car** on
Life360, the varying-speed chain shows a changing mph, clear works. pmd3 11.59 mounts its own DDI (proved
by unmounting Xcode's first). The engine is `core/backend/drive.py` now, so it's in core, and Windows
should get real speed too (**untested on Windows**). Details: docs/research/no-xcode-speed-sim.md.

**✅ Airplane mode is automatable (2026-10-24, on-device, Mac) — the one thing still on devicectl, and it isn't in the app:** devicectl can't toggle it directly, but
`xcrun devicectl device process openURL "shortcuts://run-shortcut?name=vida-airplane-on"` runs an iOS
Shortcut on the phone (owner made two once: `vida-airplane-on` = Airplane On + Wi-Fi Off,
`vida-airplane-off` = Airplane Off + Wi-Fi On). Runs silently, no confirmation prompt. Over the **cable**
(`Transport Type: wired`) the Mac keeps reaching the phone in airplane mode, so the OFF link works too, and a
devicectl `coordinate` set while offline holds (blue dot moved in Maps). Over Wi-Fi pairing none of this
works. Phone must be unlocked. Still unknown: whether Life360's "landed" push fires without altitude.

## Detection surface & landscape (research 2026-07-08 — details in `docs/research/`)

- **⚠ `isSimulatedBySoftware` is an unresolved, decisive risk.** iOS 15+ apps can read
  `CLLocation.sourceInformation.isSimulatedBySoftware`. Xcode's GPX sim sets it `true`; consumer
  "external provider" spoofer apps read `false`. Our path uses Apple's *own* `DVTSimulateLocation`
  service, so it **may** read `true` — untested. This is **Phase A gate #0**: if `true`, any app
  (Life360 included) can detect the sim in one line and realism work is moot.
- **Activity is two systems.** Life360's on-map *movement emoji* is speed-derived (likely
  spoofable); its *driver reports / crash / hard-braking* are Arity **CoreMotion** and are **not**
  spoofable on a still phone.
- **Airport "landed" push** needs altitude + airborne speed + a post-landing network reconnect —
  not reproducible by a lat/lon ground sim. A plain geofence arrival near the airport is.
- **Transport is validated.** pmd3 is the reference impl of the only no-jailbreak iOS 17+
  mechanism; every serious tool (commercial included) rides the same DDI/DVT/RemoteXPC rails.
  **Fallback:** `go-ios` is the sole real peer — WATCH only (it needs `wintun`/elevation, lacking
  our `--userspace` no-admin edge). **Standing risk:** iOS 18/26 detection hardening threatens the
  whole DDI class, not just us.
- **No untethered spoof without a jailbreak** — the "location stays after you disconnect" that
  commercial tools sell is a frozen *stale dot* (`cantfix` API artifact), cleared by iOS 18+.
  Live control is the Phase C long-lived session.
- **IP geolocation is NOT enforced (confirmed 2026-07-08).** A plain Paris spoof from the owner's
  normal (Miami) connection — **no VPN** — showed up on Life360 as Paris. So Life360 trusts the
  (spoofed) GPS over the connection's IP city; the IP mismatch is not a blocker and VPN is not
  needed. (Earlier this was flagged as the one silent server-side tell — that worry is retired for
  a static/route spoof.)

## Environment (fixed facts)

- **Host:** Windows (original) and macOS (added 2026-10-22). Two version folders —
  `mac-version/` and `windows-version/` — over one shared `core/`. Don't copy code between the
  versions: if it works on both, it goes in `core/`; only OS-specific stuff (launchers, the Mac
  window app) lives in a version folder.
- **Target:** iPhone, now on **iOS 27.0.1** (was 26.6) → RemoteXPC tunnel path only.
- **Language:** Python end-to-end. No JS, no Swift.
- **Transport lib:** `pymobiledevice3` — the only maintained cross-platform library that
  speaks the iOS 17+ tunnel on Windows.

## Architecture — three layers, keep them separate

```
┌─────────────────────────────────────────────┐
│  UI      FastAPI + static Leaflet page        │  map picker, presets,
│          (browser)                            │  saved locations, status
├─────────────────────────────────────────────┤
│  Core    LocationBackend interface            │  ensure_ready() / set_location(lat,lon)
│          (only depends on this)               │  / clear() / status()
├─────────────────────────────────────────────┤
│  Adapter pymobiledevice3 glue (ONE module)    │  tunneld daemon, RSD lookup,
│          the only place that imports pmd3     │  DDI mount, DVT connect
└─────────────────────────────────────────────┘
```

**Why the strict layering:** Apple changes the device transport periodically (it broke
between iOS 16 and 17). Quarantining *every* transport detail inside the adapter means a
future break is a one-file fix, and the UI / route code never changes.

**Driving strategy (hybrid):** run pymobiledevice3's `remote tunneld` as a managed
background daemon (the one piece that needs admin/UAC), and use pymobiledevice3's **Python
API** for the frequent set/clear/route calls against the RSD that tunneld exposes.

## Key decisions — do not relitigate without a real reason

| Decision | Why |
|---|---|
| Python core, not Swift | Swift tools are macOS-only; host is Windows + Mac. |
| `pymobiledevice3` as transport | Only maintained lib for iOS 17+ on Windows. |
| FastAPI + Leaflet local web UI | Best map picker for least code; single Python process; cross-platform for free. Rejected Electron (2nd runtime) and PyQt (painful embedded map). |
| Hybrid `tunneld` daemon + library API | CLI-stable transport, library-level control for frequent calls. |
| All transport glue in one adapter module | Version resilience against Apple's transport churn. |

## Repo layout (reorganized 2026-10-22)

```
mac-version/       Mac launchers (spoof, drive, fly, setup) + the Waypoint window app (app.py) + release/
windows-version/   Windows launchers (spoof, fly, setup)
core/              shared engine — spoof.py, routes/, backend/ (movement, life360), tools/, tests/,
                   map-visualizer.html, build/ (generated, ignored)
docs/              design docs + research
cini videos/       promo films drawn frame by frame in HTML and rendered with Playwright:
                   v1/sting (12 s square sting), v2/trailer (45 s trailer, see v2/brief.md)
.venv  .env  requirements.txt   stay at the repo root
```

App (built 2026-10-22): `core/backend/server.py` (FastAPI, 127.0.0.1 only) + `session.py` (one job
at a time, stop = kill + clear every sim touched) + `device.py` (the pmd3 adapter — still CLI
subprocesses, same commands spoof.py runs) + `routes.py`/`places.py`; page in `core/web/`. Route
engines plug into the Session, both in core and both through device.py: `spoof` (pmd3 DVT GPX) and
`drive` (`core/backend/drive.py`, the CoreDevice sim with a real speed; was Mac-only devicectl until
2026-11-19). `mac-version/app.py` points places/pins at drive's hold (`Session.use_placer`) and is the
pywebview window; the terminal version is `core/tools/drive.py` (`drive.command`); `make-app.command` builds
`~/Applications/Waypoint.app` (compiled `app/launcher.c` that execs the venv python — macOS 26 won't
launch a bundle whose executable is a shell script, error -10669).

## Running it

**Launchers live per platform:** `windows-version/` (`spoof.cmd`, `fly.cmd`, `setup.cmd`) and
`mac-version/` (`spoof.command`, `drive.command`, `fly.command`, `setup.command`). **`drive` is the real-speed path** — Life360 shows mph + the car icon. Each folder has a README. Below, `spoof` / `fly` means whichever
launcher matches your OS — e.g. `windows-version\spoof.cmd eiffel` or `./mac-version/spoof.command eiffel`.

**Spoof launcher:** `spoof` (double-click) opens a **"where do you want to go?"** menu —
pick a **route** (realistic movement, built by the movement engine from `core/routes/*.json`),
a **static preset** (hold a fixed point), or **clear**. Direct args also work:
`spoof miami` / `spoof eiffel` / `spoof 48.8584 2.2945` / `spoof clear`. Routes
are rendered + validated into a GPX and replayed over the `--userspace` tunnel (no admin);
presets/coords hold a point until you press ENTER. **Drop a new JSON in `core/routes/` and it
appears in the menu automatically.**

**Destinations catalog (2026-10-24):** `core/destinations.json` holds the LARP spots, 35 in 28 cities
across every continent but Antarctica (Sexy Fish, LIV, Club 55, Burj Al Arab, Aman Tokyo...). Each city has
an arrival airport (passenger-terminal coords), optionally a base hotel, its spots with local opening hours,
and a timezone. `core/tools/gen_destinations.py` turns it into routes (airport → hotel → spot, walk out,
snapped drive, walk in, 10 min dwell; anything under 1 km is walked) and **refuses to write a route that
fails validation**. Generated routes carry `"generated": true` + `label` + `city`. Don't hand-edit them:
edit the catalog and rerun. Every spot is also a pin preset (`spoof sexy-fish-miami`), and the app reads
city/country/flag/tz from `/api/cities`. Coordinates come from OSM (Nominatim/Overpass), not memory.
`"access": "boat"` spots (Maldives, Bora Bora) are pin-only. Needs the `.venv` (Python 3.12/3.13, see BUILD_PLAN.md),
the Apple Mobile Device Service (Windows only — built into macOS), and the phone **unlocked** with Developer Mode on.

**Flight choreographer:** `fly <trip>` (e.g. `fly nyc`) runs a believable **flight** that
fires Life360's "arrived at <destination>" push — drive to the departure airport, a manual
**airplane-mode** gap (the phone goes offline like a real flight, so Life360 never sees the
impossible compressed hop), then drive from the arrival airport into a saved destination Place and
dwell. ENTER-gated at the two manual airplane-mode toggles. A **trip** is `{depart route, arrive
airport, destination Place + drive-in route}`, so new cities are copies with swapped coords. Design:
docs/superpowers/specs/2026-07-10-flight-arrival-spoofer-design.md. ⚠ Verify the airplane-mode
tunnel gate (Step 0 in the spec) once before trusting a real run.

**Waypoint app (Mac):** `./mac-version/make-app.command` once → Waypoint in ~/Applications / the
Dock. Or `./mac-version/app.command`. `VIDA_DRY_RUN=1` makes every phone command a printed no-op —
**use it for UI work; a real run moves the owner's pin in front of their Life360 circle.** Map tiles:
Stadia `alidade_smooth_dark` (CARTO's dark_all started demanding an API key). The page asks `/tiles/...`, `core/backend/tiles.py` redirects to Stadia with `VIDA_STADIA_KEY` from the env or the gitignored root `.env`. **No key = keyless localhost access, strictly rate limited ("Account limit exceeded" on the map), and release builds have no key yet.**
After the boot log the app shows a **connect screen** until the phone is plugged in + unlocked + has the DDI. Unlocked comes live from lockdown's `PasswordProtected` (`pymobiledevice3 lockdown get "" PasswordProtected`, plain USB, no tunnel, ~0.6s; it flips with the lock screen exactly like devicectl's `passcodeRequired`, checked both ways 2026-11-19. CoreDevice's own `getlockstate` is refused on iOS 27, "action not implemented"). Then `mounter auto-mount` runs once per plug-in (15 min timeout, the first one downloads + personalizes the image; took 10s here). Polled every 2s on the connect screen, 6s once ready, 10s after a mount error, 20s while a route plays; `usbmux list` every 4s, 10s once ready. All in `Session.phone()`/`_probe()`, same on every platform. Places/pins are held by the CoreDevice sim (`setsimulatedlocation`, via `Session.use_placer`), which hands off and exits, no process kept. `VIDA_DRY_PHONE=slow` fakes a late, locked phone for working on it; `=none` a phone that never shows (the screen waits forever until skipped).
Windows *should* be able to run `core/backend/server.py` and use a browser (spoof engine only) — **untested**, including `Job.stop()`'s Windows path (writes ENTER to pmd3's stdin). **Force-quit / kill -9 leaves the pmd3 child holding the spoof** (normal close, Cmd+Q and SIGTERM all clear) — recover with `spoof clear` + `drive.command --clear`.

**Command palette (2026-11-02):** ⌘K / ctrl+K, `core/web/static/palette.js`. Search or chips: go / play / pin / open / stop. `go` looks up an address (`/api/geocode`, Photon, needs internet), flies there and leaves a movable pin that the hero button sets. Anything that moves the phone has to pass its confirm step, keep it that way. New static JS has to be added to `MINIFY_JS` in `mac-version/release/stage_assets.py`, and single-line strings only (rjsmin).

**Access keys (2026-10-31):** release builds ask for a key after the intro (before the boot log) and
the server answers the API with 402 until one checks out — the gate is in `server.py`'s middleware,
the key screen in the page (`#keygate`, full screen over the finished intro) is just the way in. It only
shows while no saved key checks out — to see it again, delete the key on the dashboard or remove
`~/Library/Application Support/Waypoint/license.json`. Keys are made/deleted in the **key dashboard**, a separate
Next.js app in `~/Desktop/projects/key dashboard` (GitHub `procookiemuncher/waypoint-key-dashboard`, private),
live at **https://waypoint-key-dashboard.vercel.app** (Vercel team "cookie's projects", Upstash Redis, pushes to
main auto-deploy). Release builds: `LICENSE_URL=https://waypoint-key-dashboard.vercel.app ./mac-version/release/build.command`.
**Two builds (2026-11-04):** the Dock app from `make-app.command` is the **dev build**, keyless with a DEV BUILD badge in the titlebar. The compiled `release/build.command` app is **production**, asks for a key, no badge. A saved key skips the key screen, so to see it as a new user would, launch with an empty profile: `open -n --env HOME=/some/empty/dir <app>`. Dry runs never run pmd3, so they can't prove a compiled build works; `build.command` checks that itself now.
`core/backend/license.py` checks the saved key at launch and every 5 min; a deleted key locks the app
(running jobs keep going, nothing new starts), dashboard unreachable keeps a key that checked out in
the last 6 h. On only when a URL is set: `LICENSE_URL` baked in by `release/build.command` (required
for non-test builds), or `VIDA_LICENSE_URL` for the dev app. Basic on purpose: answers aren't signed
and keys aren't bound to one Mac yet.

**Releases + auto-update (2026-11-19). The owner says when to release, never on a plain push.**
One command ships it: `VERSION=0.1.0-beta.3 NOTES="..." ./mac-version/release/release.command`
(needs a clean tree that matches origin). It picks the next **BUILD** (integer, live build + 1),
runs `build.command` with it baked in, ditto-zips + signs the app, makes the DMG on the Desktop,
uploads the zip to Vercel Blob (store `waypoint-releases`, public, random-suffix URL, on the
dashboard project), PUTs the manifest to the dashboard's `/api/release`, and tags `v<VERSION>`.
`NO_PUBLISH=1` = build + DMG only. Secrets (ADMIN_PASSWORD, BLOB token) come from
`vercel env pull` into a temp dir each run, nothing saved.
Installed copies (`core/backend/updater.py`, release builds only, never the dev app) POST
`/api/update` with their key 90 s after launch and every 3 h. Newer BUILD → download, check sha256
+ the **Ed25519 signature over `waypoint:<build>:<sha256>`** (public key in updater.py), ditto
-x, codesign --strict, stage in `~/Library/Application Support/Waypoint/update/`. The swap waits
until the app quits (after the phone's sims are cleared, normal quit or SIGTERM): a detached sh
waits for the PID, moves the new app into place, puts the old one back if that fails. No relaunch,
no update screen (owner's call). Can't swap when run off the DMG or translocated, it just stays
staged. Log lines start with `update:` in `~/Library/Logs/Waypoint.log`.
**Signing key: `~/.config/waypoint/update_ed25519.pem`, not in any repo. Lose it and no installed
copy can ever update again** (they'd need a new DMG with a new public key). BUILD 0 = never updates.

## Prerequisites (these bite first)

- **Windows Apple driver:** Apple Mobile Device Support (via iTunes or the Apple Devices
  app) — without it the phone is not discovered at all.
- **Admin/UAC:** the tunnel creates a virtual network interface (`wintun`) → the tunnel
  helper must run elevated.
- **iPhone Developer Mode ON:** Settings → Privacy & Security → Developer Mode (appears
  only after a dev-connection attempt; reboot + confirm).
- **Trust:** first connect prompts "Trust this computer" on the unlocked phone.
- Keep the phone **unlocked / awake** while spoofing.

## Known failure modes (expect these)

Missing Apple USB driver · not elevated · `wintun` blocked by AV/firewall · Developer Mode
off · stale pairing record → unpair/re-pair · personalized DDI not yet in the image mirrors
for a fresh iOS build · `pymobiledevice3` version skew (may need git `main` for 26.6) ·
QUIC-vs-TCP tunnel quirks · phone locks → DVT session drops · location slow to clear ·
**grey dot after a clear** (2026-11-19: once, after clearing a CoreDevice route, Maps kept a grey dot on
the last spoofed point; both clears had been accepted, toggling Location Services off/on fixed it; the
next clear went straight back to real GPS).

## Ground rules for agents working here

1. **Read PROGRESS.md first** — it's the running state after any memory/context reset.
2. **After doing work, append a dated PROGRESS.md entry** (changed / decided / broke / next).
3. **Keep the docs true to reality.** The moment you *confirm* something (it works, or it
   fails), update AGENTS.md / ROADMAP.md / PROGRESS.md in the same session to match. A
   confirmed result that only lives in your head or a chat is a bug in the docs. This is not
   optional — stale claims actively mislead the next agent (e.g. the docs long said "Life360
   didn't reflect the spoof" when the static spoof actually *does* work on Life360, which
   caused real confusion).
4. Follow ROADMAP.md order — **de-risk the transport (M1) before building UI.**
5. Never leak `pymobiledevice3` types or errors above the adapter layer.
6. Each user spoofs only their own phone, from their own Mac. Access to the release build is sold
   and controlled with access keys (see "Access keys" above); that's the only "multi-user" part.
7. Follow the **Git commit & push conventions** below.

## Research doc conventions (docs/research/)

Each research brief opens with **YAML frontmatter** (`status`, `last_verified`, `device_verified`,
`open_gates`, `depends_on`, `source_tier`, `recheck_if`) so an agent can judge a doc's trust and
currency from a partial read — full schema in **docs/research/README.md**. Two confidence axes,
kept separate: `source_tier` / per-claim `(HIGH/MEDIUM/LOW)` = *how good the source*;
`device_verified` = *did we test it on our own phone*. A well-sourced claim can still be
`device_verified: none` — most of the corpus is, pending the Phase A gates. **When you confirm
(or refute) something on-device, flip `status`/`device_verified` and bump `last_verified` in the
same session** (this is ground rule #3 applied to the frontmatter). Structure the metadata; leave
the prose reasoning intact — don't shred briefs into key-value dumps.

## Git commit & push conventions

- **Write commit messages like a human wrote them** — realistic and descriptive, not
  robotic. Say what changed and why in plain first-person language; skip mechanical,
  template-y boilerplate and the "type: subject" prefix habit unless it reads naturally.
- **No AI attribution.** Never add `Co-Authored-By: Claude` (or any AI co-author) and no
  "Generated with …" trailer. Commits are authored solely by the repo owner, as if they
  wrote them by hand.
- Commit identity stays `procookiemuncher <thegoatcodercookie@gmail.com>` (set per-repo).
- **Auto-commit and auto-push after every meaningful update — small or large.** Don't wait
  to be asked; the owner wants the GitHub repo to always mirror the latest working state.
  (Exception: never force-push or rewrite already-pushed history without asking first.)

### Where & how to commit (concrete setup)

**Remote:** `git@github.com:procookiemuncher/vida-360.git` — the repo lives under the
**procookiemuncher** account and is pushed as that account.

**⚠ This machine has two GitHub identities.** The default SSH key authenticates as a
*different* account (`juanmendoza-dev`) that **cannot see this private repo** — an
un-pinned push fails with `ERROR: Repository not found`. Pushes MUST be pinned to the
procookiemuncher key (see `core.sshCommand` below).

**One key does both jobs.** `~/.ssh/vida360_signing` is registered on the procookiemuncher
account **twice**: once as an *Authentication Key* (lets this machine push) and once as a
*Signing Key* (makes commits show "Verified").
Fingerprint: `SHA256:aB2iV8fKwRIHqgN0ztNl7DOHN/sacv6VMbTcazbxDEg`.

**Repo-local git config to set once (after `git init` or clone):**

```
git config user.name  "procookiemuncher"
git config user.email "thegoatcodercookie@gmail.com"
git config commit.gpgsign true
git config gpg.format ssh
git config user.signingkey ~/.ssh/vida360_signing.pub
# Pin the SSH key so pushes auth as procookiemuncher, not the machine's other account:
git config core.sshCommand "ssh -i ~/.ssh/vida360_signing -o IdentitiesOnly=yes"
```

**The "Verified" badge needs two things on the procookiemuncher account:** (1) the key above
added as a *Signing Key*, and (2) `thegoatcodercookie@gmail.com` present as a **verified
email**. Miss either and the commit shows "Unverified" even though it's signed.

> Note: this working copy is a "Download ZIP" (no `.git`). To reconnect it, `git init` here,
> `git remote add origin <remote>`, `git fetch`, then align the branch — or just clone fresh
> and copy over any local changes.
