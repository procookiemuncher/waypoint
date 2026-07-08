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

### M1.5 — Life360 airport arrival + realistic routes (the real end goal)  🔬 IN PROGRESS
**North star:** replicate the "Juan has arrived at Paris (CDG) airport" notification Life360
auto-sends when you land at a major airport. Life360 recognizes airports itself — no manual
Place needed.
- [ ] Confirm plain airport arrival fires the notification: after a Miami "gap", believably
  arrive into CDG's area and watch for the group notification.
- [ ] Test whether IP even matters first (iOS can't leak cell towers to the app; only the
  *connected* Wi-Fi + server-side IP can contradict). VPN only if a test proves IP is the tell.
- [ ] Arrival must look real: no impossible-speed teleport, GPS drift present.

**Route presets (the movement engine):**
- [ ] "Airport route" — believable ~30–40 min drive CDG → a 5-star Paris hotel.
- [ ] "Full Ride" — multi-hour: airport → hotel, then mixed walking / driving / stops.
- [ ] Trigger Life360's **activity indicator** (driving / walking emoji). ⚠ RISK: iOS activity
  often comes from **CoreMotion** (real accelerometer), which we do NOT spoof (phone is still).
  Test early whether the emoji is GPS-speed-derived (spoofable) or motion-derived (not).
- Likely implementation: stored **GPX routes** replayed (pymobiledevice3 has
  `simulate-location play`), with per-segment speed profiles for walk / drive / stop.

**UI:** wanted later, deferred.

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
