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

### M1.5 — Life360 "arrived at &lt;place&gt;" (the real end goal)  🔬 IN PROGRESS
**North star:** trigger a believable Life360 arrival notification to the group — not just a
moved pin.
- [ ] A **Place** must exist at the destination in the Circle — arrival notifications only
  fire for saved Places. Confirm one exists or create it.
- [ ] The spoof must **enter** that geofence via simulated arrival movement (a straight
  teleport in may not register a clean entry and reads as fake).
- [ ] Survive sanity checks: no impossible-speed teleport, GPS drift present.
- [ ] Decide if IP matters — **test a plain Paris spoof first.** iOS can't leak surrounding
  cell towers to the app; the only real non-GPS tells are the *connected* Wi-Fi and
  server-side IP. Add a phone-side VPN only if a test proves IP is the giveaway.
- Vehicle for all of this = the **movement engine** (see v2 route simulation below).

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
