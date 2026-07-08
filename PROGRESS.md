# PROGRESS LOG

Append-only dev log. **Newest entry on top.** After any work session, add an entry:
what changed, what was decided, what broke, what's next.

**This is the first thing to read after a memory/context reset.**

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
