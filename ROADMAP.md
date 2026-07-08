# ROADMAP

## Vision

Personal GPS spoofer for the owner's own iPhone (iOS 26.6) from Windows.
**v1:** set a fixed fake location reliably. **v2:** simulate movement along routes.

MVP = **M1–M4**.

---

## Milestones

### M0 — Project setup  ✅ DONE
- [x] Brainstorm architecture (2026-07-07)
- [x] Connect git repo to GitHub `procookiemuncher/vida-360`
- [x] AGENTS.md / ROADMAP.md / PROGRESS.md
- [x] Python project skeleton + virtualenv + pinned `pymobiledevice3` (9.33.1)

### M1 — Transport spike  ✅ DONE (Find My confirmed)
Goal: push **one hardcoded coordinate** onto the iOS 26.6 phone from Windows and see it in
Maps / Find My. This de-risks everything else.
- [x] Verify prerequisites (device visible over USB, Developer Mode = `true`, trusted)
- [x] Bring up the tunnel — used **`--userspace`** (pure-Python, no admin / no `wintun`)
- [x] Auto-mount the personalized Developer Disk Image (needs phone unlocked)
- [x] Connect DVT, call `simulate-location set`, confirm on device
- [x] Record the exact working command sequence in PROGRESS.md
- **Exit criteria met:** Find My showed the spoofed location (Paris).

### M1.5 — Life360 realism (anti-teleport)  🔬 INVESTIGATING
Find My reflects the spoof, but **Life360 still shows "home"**. Diagnose the betraying
signal *before* building anything (systematic-debugging, not fix-blind):
- [ ] Identify why Life360 ignores the spoof — teleport / impossible-speed detection vs.
  non-GPS signals (home Wi-Fi SSID/BSSID, cell towers, server-side IP geolocation) vs. a
  stale background update.
- [ ] Apply the fix matching the cause: gradual movement + GPS jitter (our tool),
  Wi-Fi off / cellular only, and/or a VPN exit node near the target (for IP geolocation).
- [ ] Re-test until Life360 reflects the target without a teleport flag.

### M2 — Backend core
- [ ] `LocationBackend` interface — `ensure_ready()` / `set_location()` / `clear()` / `status()`
- [ ] `pymobiledevice3` adapter (all transport glue lives here)
- [ ] Managed tunnel helper (handles elevation)
- [ ] Status/health reporting (device · tunnel · DDI · dev-mode · current coord)

### M3 — Local web UI
- [ ] FastAPI app serving the static Leaflet page
- [ ] Map click-to-set + location label
- [ ] Landmark presets (Eiffel Tower, Dubai, Miami, …)
- [ ] Save / reuse named locations (local JSON)
- [ ] Status panel + Set / Clear controls

### M4 — MVP polish
- [ ] Prerequisite checks surfaced in the UI with fixes
- [ ] One-command launcher
- [ ] Basic error surfacing

---

## v2 — Backlog & Ideas (parking lot)

- **Route simulation:** hold the DVT session open, interpolate along a drawn polyline,
  `set()` on a ~1s timer, with speed control (smoother than one-shot GPX play).
- GPX import / export.
- Small positional **jitter** for realism.
- **macOS support** — mostly free once the adapter is isolated; the tunnel is easier there.
- Auto-reconnect / tunnel self-healing.
- Keep-awake helper while spoofing.
- Preset packs / shareable location files.

---

## Current focus

→ Finish **M0**, then start the **M1 transport spike**. Do not build UI until M1's exit
criteria are met.
