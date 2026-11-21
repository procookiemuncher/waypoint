# Flight-arrival spoofer — design (Miami → NYC, repeatable per city)

> Status: design approved (2026-07-10, brainstormed with the owner). Author: Claude Sonnet 5.
> Companion research: `docs/research/life360-geofence-arrival-mechanics.md` (the arrival recipe),
> `docs/research/life360-flight-detection.md` (the airplane-mode gate + the bonus landing push),
> `docs/research/life360-notification-triggers.md` (the notification catalog).

## Goal

Make Life360 push **"arrived at <destination>"** after a believable **flight** from one city to
another — e.g. Miami → NYC — by choreographing a spoofed airport departure, an **airplane-mode
offline gap** (the "flight"), and a driven arrival at the destination. Designed as a **repeatable
template**: prove NYC, then stamp out CDG / LAX / etc. by swapping coordinates.

## The load-bearing insight (why this works)

When the phone is in **airplane mode it is offline** — Life360 receives nothing. So Life360 never
sees the flight itself; it sees only **last position before the gap** (an airport) and **first
position after the gap** (near the destination airport). That is exactly what a real flight looks
like to Life360. Crucially, **airplane mode launders the impossible compression**: a 10-minute
"flight" and a real 2.5-hour flight are indistinguishable to Life360 (both are just "offline, then
far away"). ⟹ **The flight arc is never spoofed** — it is a pure offline gap. All realism effort
goes into the two segments Life360 *does* see: the airport departure and the destination drive-in.

## The choreographed sequence

Part tool, part human. A guided launcher (`fly.py`) walks it with ENTER-gated prompts. Since
2026-11-21 the tool flips airplane mode itself (the phone's `vida-airplane-on/off` Shortcuts, run
over the cable) while the hold runs, and the owner confirms each flip; if it didn't happen, the
owner toggles by hand as below:

| # | Actor | Action |
|---|-------|--------|
| 1 | Tool  | Play `mia-departure` route → drive to MIA, hold there (believable "last seen before the flight"). |
| 2 | Human | Press ENTER → the tool turns **airplane mode ON** (owner confirms; by hand if not). Phone goes offline. |
| 3 | Tool  | `set` the spoof to **JFK** (instant teleport is free — phone is offline, Life360 blind) → hold. |
| 4 | Human | Press ENTER → the tool turns **airplane mode OFF** (owner confirms; by hand if not). Phone reconnects **at JFK**. |
| 5 | Tool  | Immediately play `jfk-to-hotel` route → drive JFK → Manhattan hotel Place. |
| 6 | Tool  | Cross into the hotel Place → dwell 2–5 min → **"arrived" push** fires (confirmed by a 2nd circle member). |

Reconnecting **at JFK** (an airport) also sets up the possible bonus **"landed at NYC" flight
push** — the untested `flight-altitude-hard-gate` from the flight-detection research. If it fires,
free extra realism; if not, the geofence arrival still stands.

## The one hard rule (from the arrival research)

The "arrived" push needs a genuine **outside→inside boundary crossing**, NOT a teleport into the
Place radius (`geofence-arrival-mechanics.md` §2, ~70–75% confidence). So the sequence lands the
phone **at JFK — outside the Manhattan hotel Place — and drives in.** Never reappear already sitting
inside the destination radius. The `jfk-to-hotel` route therefore starts well outside the hotel
(≥ ~400–500 m past the radius + Apple's ~200 m cushion) and ends with a stationary dwell inside it.

## The load-bearing UNKNOWN (gates the whole design — verify first)

**Does the userspace DVT tunnel survive an airplane-mode toggle?** Airplane mode kills the radios
(cellular / Wi-Fi / BT) but should NOT kill the **USB** transport the tunnel rides. Untested on our
stack (`life360-flight-detection.md` flagged it "verify").

- **If it survives (expected):** clean. The spoof holds at JFK straight through the toggle; when
  airplane mode flips off, the phone uploads the already-spoofed JFK location. No race.
- **If it drops:** the phone reverts to real GPS during the gap, and on reconnect there is a
  **race** — Life360 may upload the real (home) location before the tunnel re-establishes and sets
  JFK. Fallback design: on step 4, re-mount + `set` JFK as fast as possible, and keep the
  destination *far* from home so even a brief real-location blip is not obviously "home."

**Step 0 of the build is this on-device test** (hold a spoof, toggle airplane mode on/off, confirm
the spoof holds/re-establishes) — before investing in the full run.

**Step 0 result so far (2026-11-21, Windows, iOS 27.2.1, pmd3 11.59, no spoof held):** the transport
half **passed**. With airplane mode on and Wi-Fi off, the phone stayed on usbmuxd over USB, new
userspace tunnels came up in ~0.23 s, CoreDevice calls worked, and airplane-off was sent over the same
cable (3 on/off runs). So the tool can always reconnect and send the OFF. Still **untested**: whether a
hold that's *already running* keeps the spoof through the toggle (the owner chose no hold for this
run). `fly` now starts each hold before the toggle and keeps it running through it, so that's the
case a real run exercises. Details: `docs/research/no-xcode-speed-sim.md` → "Opening a URL".

## Components

### 1. Routes (`data/routes/`)
- **`mia-departure.json`** — a short road-snapped drive to Miami International (MIA), ending in a
  `stop`/dwell at the terminal. Believable "heading to the airport."
- **`jfk-to-hotel.json`** — JFK → a Manhattan hotel, road-snapped (Valhalla fills the highway path
  from a few waypoints), ending in a stationary dwell **inside** the hotel Place. Placeholder hotel
  = a well-known Manhattan landmark (e.g. The Plaza, 40.7644, -73.9744); the owner sets the real
  Life360 Place and the route's final coords are pointed at it.

A **trip** is the shape `{depart airport, arrive airport, destination Place + drive-in route}` — NYC
is the reference; other cities are copies with swapped coordinates.

### 2. Observer arrival-confirmation (`backend/life360/`, `tools/observe.py`)
- **`MemberState.place_name`** — surface Life360's `location.name` (the Place name, populated while
  the member is *inside* a Place) as its own field. Currently it is **masked** — `client.py`
  `_member()` folds `location.name` into `address` behind `shortAddress`/`address1`, so the
  arrival-state signal is lost. Split them: `place_name` = `location.name`; `address` stays the
  street address. This is how the Observer confirms "inside the hotel Place" server-side
  (`geofence-arrival-mechanics.md` §5).
- **`Life360Client.places(circle_id)`** — `GET /v3/circles/{id}/places` → `[(name, lat, lon,
  radius_m)]`, so the owner can read the **exact radius** of the saved hotel Place before routing
  (don't guess the default). Read-only, quarantined like the rest of the client.
- **`observe.py --places`** — print each circle's Places (name / center / radius) and exit.
- `place_name` flows into the JSONL log automatically (`log_record` uses `dataclasses.asdict`), so
  arrival state is captured for `correlate.py` / post-run review.

### 3. Guided choreographer (`tools/fly.py` + `fly.cmd`)
- Reuses `spoof.py`'s helpers (`pmd`, `ensure_mounted`, `build_gpx`) — no duplicated transport glue.
- Runs the sequence table above; ENTER-gated at the two manual airplane-mode steps.
- A **trip** is defined by a small dict (depart route, arrive-airport `set` point, drive-in route);
  ships with the `nyc` trip, structured so more cities drop in.
- `fly.cmd nyc` runs it; bare `fly.cmd` lists trips.
- Read-through prompts remind the owner: phone unlocked, 2nd member watching, Observer running.

## Out of scope (deliberately)
- Spoofing the flight arc (invisible to Life360; decided with the owner).
- The literal "landed at <airport>" flight push as a *requirement* — it's a free bonus if altitude
  turns out soft, not a deliverable (the geofence arrival is the real target).
- API **writes** to Life360 (creating Places) — the API can't; the owner saves Places by hand.
- Any CoreMotion / driving-emoji work — resolved dead-end (`activity-emoji-coremotion.md`).

## Build order (de-risk first)
0. **On-device: verify the tunnel survives airplane mode** (owner). Gates everything below.
1. Observer arrival-confirmation (`place_name` + `places()` + `--places`) — offline-testable.
2. Author + validate the two routes offline.
3. Build `fly.py` + `fly.cmd`.
4. On-device dry run (no 2nd member), then the real run with a 2nd member watching for the push.

## Open on-device gates (carried from research)
- `flight-tunnel-survives-airplane-mode` (Step 0): new tunnels over the cable **pass** (2026-11-21);
  a running hold keeping the spoof through the toggle is still open.
- `geofence-crossing-required`, `geofence-dwell-latency` (does the drive-in fire the push; how long).
- `flight-altitude-hard-gate` (bonus: does the literal landing push fire).
