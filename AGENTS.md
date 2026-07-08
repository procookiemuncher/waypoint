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

**End goal:** replicate the real "Juan has arrived at Paris (CDG) airport" notification that
Life360 auto-sends the group when you land at a major airport — Life360 recognizes major
airports itself, so **no manual Place is needed**. The spoof must (a) survive Life360's sanity
checks (no impossible-speed teleport, GPS drift present) and (b) believably *arrive* at the
airport area to trigger that built-in notification. Both are movement-engine work.

**Stretch — pre-built routes** (the owner's real ambition):
- "Airport route": a believable ~30–40 min drive from CDG to a 5-star Paris hotel.
- "Full Ride": a multi-hour trip — airport → hotel, then mixed walking / driving / stops.
- Trigger Life360's **activity indicator** (the driving / walking emoji it shows per member).
  ⚠ RISK: iOS activity type often comes from **CoreMotion** (the real accelerometer), which we
  do NOT spoof — the phone sits physically still. Must test whether Life360's emoji is
  GPS-speed-derived (spoofable) or motion-derived (not).

A **UI** is wanted eventually, but deferred.

## How it works (the mechanism)

iOS ships a developer location-simulation service — the same one Xcode's "Simulate
Location" uses. It injects coordinates at the CoreLocation layer, so **every** app that
reads location sees the fake value. No jailbreak, no per-app patching.

On iOS 17+ that service lives behind Apple's RemoteXPC **tunnel** (RSD), reached with the
[`pymobiledevice3`](https://github.com/doronz88/pymobiledevice3) library. This device is on
**iOS 26.6**, so the tunnel path is the *only* option — there is no legacy pre-17 USB flow.

**Confirmed API constraint (2026-07-08, verified against pmd3 upstream):** `simulate-location
set` accepts **only latitude + longitude** — no accuracy, altitude, speed, or heading (see
upstream issue #340). ⟹ **iOS derives speed and heading from successive positions**, so the
spacing/timing of the points we emit *is* the speed signal Life360 sees — which is why the
movement engine is all about the point stream. `simulate-location play <gpx> [noise_ms]`
derives speed from the GPX time deltas and takes an optional ± timing-noise argument.

## Environment (fixed facts)

- **Host:** Windows (primary). macOS is a future nice-to-have, not MVP.
- **Target:** iPhone on **iOS 26.6** → RemoteXPC tunnel path only.
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
| Python core, not Swift | Swift tools are macOS-only; host is Windows. |
| `pymobiledevice3` as transport | Only maintained lib for iOS 17+ on Windows. |
| FastAPI + Leaflet local web UI | Best map picker for least code; single Python process; cross-platform for free. Rejected Electron (2nd runtime) and PyQt (painful embedded map). |
| Hybrid `tunneld` daemon + library API | CLI-stable transport, library-level control for frequent calls. |
| All transport glue in one adapter module | Version resilience against Apple's transport churn. |

## Repo layout (planned — created as M2/M3 land)

- `backend/` — FastAPI app + `LocationBackend` + pymobiledevice3 adapter
- `web/` — static Leaflet UI
- `data/` — landmark presets + saved locations (JSON)
- `run.*` — launcher

## Running it

**Quick spoof (current):** `spoof.cmd` (double-click for the preset menu), or
`spoof.cmd eiffel` / `spoof.cmd 48.8584 2.2945` / `spoof.cmd clear`. It mounts the DDI
(phone must be **unlocked**), sets the location over the `--userspace` tunnel (no admin),
and holds it until you press ENTER. Presets live in the `PRESETS` dict at the top of
`spoof.py` — add more there. This script is the seed of the eventual backend.

**Full app (planned):** launcher → prerequisite checks → FastAPI + browser UI. See ROADMAP.md.

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
QUIC-vs-TCP tunnel quirks · phone locks → DVT session drops · location slow to clear.

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
6. This is a personal-use tool on an owned device. Keep it that way.
7. Follow the **Git commit & push conventions** below.

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
