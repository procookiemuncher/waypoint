# AGENTS.md

> Read this first, then **PROGRESS.md**. This file explains how the project works and why.
> PROGRESS.md tells you the current state.

## What this is

**vida-360** is a personal tool that spoofs the GPS location of the owner's own iPhone
from a Windows PC. v1 sets a fixed fake coordinate (e.g. Eiffel Tower, Dubai, Miami).
v2 will simulate movement along routes. Personal use, single owned device.

## How it works (the mechanism)

iOS ships a developer location-simulation service — the same one Xcode's "Simulate
Location" uses. It injects coordinates at the CoreLocation layer, so **every** app that
reads location sees the fake value. No jailbreak, no per-app patching.

On iOS 17+ that service lives behind Apple's RemoteXPC **tunnel** (RSD), reached with the
[`pymobiledevice3`](https://github.com/doronz88/pymobiledevice3) library. This device is on
**iOS 26.6**, so the tunnel path is the *only* option — there is no legacy pre-17 USB flow.

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

**Not built yet.** Intended launcher flow: (1) check prerequisites, (2) start the elevated
tunnel helper, (3) start FastAPI, (4) open the browser UI. See ROADMAP.md for status.

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
3. Follow ROADMAP.md order — **de-risk the transport (M1) before building UI.**
4. Never leak `pymobiledevice3` types or errors above the adapter layer.
5. This is a personal-use tool on an owned device. Keep it that way.
6. Follow the **Git commit & push conventions** below.

## Git commit & push conventions

- **Write commit messages like a human wrote them** — realistic and descriptive, not
  robotic. Say what changed and why in plain first-person language; skip mechanical,
  template-y boilerplate and the "type: subject" prefix habit unless it reads naturally.
- **No AI attribution.** Never add `Co-Authored-By: Claude` (or any AI co-author) and no
  "Generated with …" trailer. Commits are authored solely by the repo owner, as if they
  wrote them by hand.
- Commit identity stays `procookiemuncher <thegoatcodercookie@gmail.com>` (set per-repo).
- Always confirm with the owner before pushing to the remote.
