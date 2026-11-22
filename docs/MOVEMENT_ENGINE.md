# Movement Engine — design

> Design doc for vida-360's movement engine. Read **AGENTS.md** (how it works) and
> **PROGRESS.md** (current state) first. This doc captures the decisions from the
> 2026-07-08 design session; it maps onto **M1.5 / M2** in ROADMAP.md.

## Goal

A static spoof already reflects on Life360 (the member's pin moves — confirmed). The missing
piece is believable **movement**. The engine must:

1. **North star:** believably *arrive* into a major airport's area (CDG) after a Miami
   "flight gap", so Life360 auto-fires its built-in "Juan has arrived at Paris (CDG)
   airport" notification — Life360 recognizes airports itself, so no manual Place is needed.
2. Survive Life360's sanity checks — no impossible-speed teleport, GPS drift present.
3. **Stretch:** drive believable routes — CDG → 5-star hotel (~30–40 min), and a multi-hour
   "Full Ride" (airport → hotel → mixed walking / driving / stops) — and, *if the CoreMotion
   test allows it*, trigger Life360's driving / walking activity emoji.

## Confirmed transport facts (verified 2026-07-08 against pymobiledevice3 upstream)

These constrain the whole design, so they're recorded here rather than assumed:

- **`simulate-location set` takes only `latitude, longitude`.** There is no parameter for
  accuracy, altitude, speed, or heading (see `location_simulation.py`; upstream issue #340
  requests speed/heading/altitude and it is not implemented).
- **⟹ iOS derives speed and heading from successive positions.** Because we cannot set them,
  the *spacing and timing of the points we emit is itself the speed/heading signal* that
  Life360 sees. This is good news: speed is spoofable purely through geometry + timing.
- **`simulate-location play route.gpx [noise_ms]`** replays a GPX, deriving speed from the
  **time delta between consecutive track points** (distance ÷ Δt). It also accepts an optional
  timing-noise argument (± milliseconds jitter on the inter-point delay). This is exactly the
  mechanism the current `miami` preset uses.

## Chosen approach

**Author routes as JSON → snap to roads with Valhalla at build time → cache a dense GPX →
replay with `simulate-location play`.** Ship the CDG arrival on this. Defer the long-lived
live-`set()` session until an arrival is proven.

Concretely:

```
route.json  ──(build time)──►  Valhalla road-snapping  ──►  dense trajectory
  (intent: waypoints,                                          + speed profile
   mode, speed, dwell)                                         + jitter
                                                                   │
                                                                   ▼
                                                       cached  route.gpx  ──►  play --userspace
                                                    (checked in; no network at run time)
```

Why this shape:

- **Valhalla is a *build-time* dependency, not a runtime one.** Because routes are a small,
  cached preset set, we snap once when authoring a preset and freeze the result as a GPX we
  commit. The running tool needs no network and no API key, and a Valhalla outage can never
  break a spoof already in progress.
- **`play` is already proven** (the `miami` demo) and keeps the tunnel-lifecycle simple —
  one subprocess that stays alive for the duration, matching M1's "the session process must
  stay alive" learning. No in-process tunnel ownership yet.
- **JSON separates intent from geometry.** A GPX can't express "walk this bit, then drive at
  50 km/h, then dwell 3 min"; JSON can, and stays human-editable. GPX is the *cache /
  interchange* format (and what `play` eats), not the authoring format.

### Rejected / deferred alternatives

| Option | Verdict | Why |
|---|---|---|
| Long-lived DVT session + `set()` on a ~1s timer, our own interpolation | **Deferred to Phase C** | Better for *interactive* control (pause / resume / reroute / live jitter), but moves tunnel-lifecycle ownership in-process — more failure-prone on Windows. Not needed for a pre-planned arrival. Build it only once an arrival is confirmed. |
| Author routes directly as GPX | Rejected | GPX can't express per-segment mode/speed/dwell intent; painful to hand-edit. Kept only as the cached output format. |
| Runtime routing API calls | Rejected (for now) | Cached presets don't need live routing; adds a network dependency and a failure mode to the run path for no benefit. Revisit only if arbitrary/drawable routes land. |
| OSRM public demo for snapping | Rejected | Effectively car-profile only; the Full Ride needs mixed walking + driving. Valhalla (FOSSGIS public) does both in one API, no key. |
| Self-hosted routing (Docker OSRM/Valhalla) | Rejected | Overkill for a handful of personal routes that we cache anyway. |

## Data model & interface

### Route definition (authoring, JSON)

```jsonc
{
  "name": "cdg-to-hotel",
  "description": "CDG Terminal 2E → 5-star hotel, believable arrival drive",
  "segments": [
    {
      "mode": "drive",              // walk | drive | stop
      "waypoints": [[49.0097, 2.5479], [48.8698, 2.3078]],
      "speed_mps": 13.9,            // target speed; iOS infers this from point spacing
      "jitter_m": 4.0               // optional per-segment GPS jitter magnitude
    },
    { "mode": "stop", "at": [48.8698, 2.3078], "dwell_s": 180 }
  ]
}
```

- `mode` picks the Valhalla costing model (`pedestrian` / `auto`) and a plausible default
  speed if `speed_mps` is omitted.
- `stop` segments hold position for `dwell_s` (with a slight decel into the stop, see below).
- Speeds are *intent*; the renderer realizes them by spacing points at `speed_mps` per
  second, since iOS reads speed from position deltas.
- A snapped drive (`"snap": true`) drives each road at its own speed once road data is in (see
  "Road-aware driving" below); its `speed_mps` is then only the fallback for when there's none.
  `"steady": true` opts a drive out: it holds `speed_mps` with no road speeds, lights or stops
  (`emoji-test` and `miami-drift` test one thing each on purpose).

### Renderer (Core layer)

A `RouteRenderer` in the Core layer turns a `route.json` into an emittable trajectory. It is
the only thing that knows about speed profiles and jitter; it knows **nothing** about
pymobiledevice3.

```
RouteRenderer.render(route) -> list[LocationFix]     # (lat, lon, t_seconds)
RouteRenderer.to_gpx(fixes) -> path                  # cached GPX for `play`
```

Phase C adds a streaming variant (`iter_fixes()` yielding at wall-clock cadence) for the live
session, but the same renderer/data model feeds both.

### LocationBackend additions

The engine drives the adapter only through the `LocationBackend` interface — pmd3 types and
errors stay quarantined below it (AGENTS.md ground rule #5). Movement adds:

```
LocationBackend.play_route(gpx_path, timing_noise_ms=0) -> None   # Phase B (wraps `play`)
# Phase C only:
LocationBackend.start_session() / set_location(lat, lon) / stop_session()
```

`play_route` wraps `simulate-location play --userspace <gpx> [noise_ms]`. The `noise_ms`
argument maps to pmd3's built-in inter-point timing jitter.

## Realism model

Since iOS derives speed/heading from our positions, realism is entirely about the point
stream we produce:

- **Spatial jitter:** add small Gaussian noise (a few meters, per `jitter_m`) to each point so
  the track wanders like real GPS instead of tracing a mathematically perfect line.
- **Temporal jitter:** use `play`'s built-in `noise_ms` (± up to ~500 ms) so inter-point
  timing isn't robotic.
- **Monotonic timestamps:** GPX times must strictly increase; the offline validator enforces
  this.
- **Decelerate into stops:** ramp speed down over the last few points before a `stop` (and up
  on departure) so there's no instantaneous speed cliff that could read as anomalous.
- **No impossible speeds:** the validator rejects any inter-point speed above a plausible
  ceiling per mode (walk / drive) before anything reaches the device.

### Road-aware driving (2026-11-22)

A snapped drive used to hold one cruise speed the whole way and slow only for bends, so it read
as a highway through every traffic light. Now:

- **Road data.** After `/route`, `snapper.road_edges` asks Valhalla `/trace_attributes` what the
  line runs over: road class, Valhalla's speed, the tagged speed limit, traffic lights, the roads
  meeting at each node, `stop_impact`. `shape_match: "walk_or_snap"`, because `edge_walk` fails on
  `/route`'s own shape (error 443). The edges come back as matched lengths and are laid on our
  polyline by distance (`roads.map_edges`, refused if the totals differ by >5%). Cached in
  `snap-cache/<key>.roads.json` next to the line, so the release build bundles it. A network
  failure falls back to one cruise speed and isn't asked again for 5 min; "can't match" is cached.
  The app's route list reads the cache only; `warm_legs` fetches. Requests are paced 1/s.
- **A speed per road** (`roads.edge_mps`): the tagged limit, or Valhalla's estimate clamped into a
  band for the class; ramps ≤60 km/h, roundabouts 28, service roads 25-40, parking aisles 10; times the driver's pace
  (±4% city, +3% on fast roads); never over 32.5 m/s (~73 mph). A slow drift of a few percent
  wanders around it so nobody holds exactly the limit.
- **Traffic lights** come from OSM through Valhalla. Signals within 50 m are one intersection (a
  dual carriageway has one per carriageway), one red/green roll each: 35% red on the bigger road
  (wait up to 45 s), 55% coming off the smaller one (up to 75 s), 25% for a midblock crosswalk
  signal. A red with <6 s left is a slow roll instead of a stop.
- **Stop signs are inferred**: Valhalla's API has no stop-sign field and the public Overpass
  server refuses automated use (502 at capacity, and its banner says so). At an unsignalled
  intersection, coming off a smaller road onto or across a bigger one is a stop sign (70%, 1-3 s)
  or a rolling stop; pulling out of a lot always stops; two residential roads meeting is an
  all-way stop 30%, a slow look 45%; roundabout entries give way. Ramps, trunks, motorways never.
- **Turns at intersections**: the heading change over ±20 m at each node; the tight side (right
  when driving on the right) ~10 mph at 90°, the wide side ~13 mph, a U-turn ~7 mph. Bends are
  measured over ±10 m so map-digitizing kinks don't brake the car; a line that folds back on
  itself is a U-turn crawl.
- **The plan** (`renderer.plan_piece`): a speed cap every 5 m, the drive split at every full stop
  so each piece starts and ends at rest, a backward pass braking before every cap (1.5-1.9 m/s²)
  and more gently into stops (1.1-1.5), a forward pass whose pull-away falls off with speed
  (~1.75 m/s² from rest, about half at 55 mph). Timed exactly at constant acceleration per cell,
  so the car arrives at rest on the stop line. Waits are held with still-phone jitter and flagged
  `LocationFix.hold`. A `Driver` is sampled per render, so no two drives look the same; Spoof's
  GPX is seed 0, Drive picks a new seed each time.
- **Drive** (`drive.plan_chunks`) turns a wait into a parked `set` call whose leg is still
  "drive", cuts 3 s chunks near rest so the ramp reaches the phone, folds the last 1-2 s before a
  stop into the chunk before it, doesn't average across a stop, and keeps its ±5% wander under
  75 mph (a route written faster, like miami-drift, keeps its own speed).
- **Result** (2026-11-22, all 39 routes, offline): 0 validator errors; warnings 27 → 1 (the one
  left is miami-drift's deliberate 80 mph); peak accel 2.69 → 1.91 m/s²; rendering every route 2 s
  (was 23 s). 158 waits across the 34 road-aware drives. Drive times move both ways, median +3%:
  the waits add time, faster main roads give some back (JFK → Manhattan, 26 lights, +45%; Milan →
  Lake Como −9%). Not yet seen on Life360: whether its sparse sampling shows the stops.

## The flight gap (Miami → CDG) — test-gated

To look like a flight the timeline must be: seen moving to MIA → last update at the airport →
a genuine **no-update gap** (hours) → reappear near CDG and drive the short final approach.

The trap: if we `clear` the spoof during the gap, the phone's **real** GPS (home, not Miami)
starts reporting to Life360 — worse than a gap. If we keep emitting, a MIA→CDG jump is an
impossible-speed teleport.

**This hinges on a fact we don't yet know and must test first** (see Phase A): *does iOS
revert to real GPS when we simply stop calling `set()` while holding the session open, or does
it keep reporting the last simulated point?* Two branches, decide after the test:

- **Branch A — "hold, go silent, resume" (preferred if it works):** hold at MIA, then stop
  updates for a realistic offline period (emulating airplane mode — no updates leak), then
  resume at CDG and drive the final approach. Only viable if stopping updates does **not**
  leak real GPS.
- **Branch B — "hold, then jump" (fallback):** keep the session holding the last MIA point
  (looks stationary at the airport), then resume moving at CDG within the same session. Risk:
  the single large MIA→CDG delta may read as a teleport; we'd study how Life360 reacts to a
  long stationary period followed by reappearance (real flights do freeze the pin, so this may
  be tolerated).

The doc adopts whichever the Phase A test supports — **TODO pending that result.**

## Phased build plan

### Phase A — on-device gates (no engine code)

Two cheap tests that each gate a design decision; run before building:

1. **CoreMotion test.** Run one long (~10–15 min) constant "drive" at ~60 mph — just bump the
   `*_SECS` constants in `spoof.py`, no real road needed — and watch whether Life360 shows the
   driving emoji. **If yes:** the emoji is GPS-speed-derived and spoofable → activity-emoji
   features are real. **If no:** it's CoreMotion-derived (the real, stationary accelerometer)
   and we **cannot** trigger it — drop the activity-emoji goal.
2. **Flight-gap test.** Determine whether iOS reverts to real GPS when we stop calling `set()`
   (vs. holding the last fake point). Decides Branch A vs. B above.

### Phase B — the engine (batch / `play`)

- `route.json` schema + loader.
- Valhalla road-snapping at build time (`pedestrian` / `auto` costing per segment).
- `RouteRenderer`: speed profile, spatial jitter, decel-into-stops → `LocationFix` list → GPX.
- `LocationBackend.play_route()` wrapping `play --userspace` (with `noise_ms`).
- **Deliverable:** the CDG final-approach arrival, played after a (Phase-A-informed) gap,
  fires the Life360 airport notification.
- Presets: build the "Airport route" (CDG → hotel) and "Full Ride" as cached GPX.

### Phase C — deferred (live session, arbitrary routes)

- Long-lived DVT session + `set()` on a ~1s timer + streaming renderer for pause / resume /
  reroute / live jitter.
- Arbitrary / drawable routes (ties into the deferred map UI), which turns Valhalla into a
  runtime dependency.

## Testing strategy

- **Offline first (gate before every on-device run):** extend the existing gpxpy speed check
  into a validator — no inter-point speed above the per-mode ceiling, jitter within bounds,
  timestamps strictly monotonic, total duration sane, smooth speed transitions at stops.
- **On-device:** Phase A gates → then arrival → then full routes, watching Life360 each time.

## Open risks & unknowns

- **CoreMotion (Phase A #1):** activity emoji may be un-spoofable. Gated, not assumed.
- **Flight gap (Phase A #2):** whether stopping `set()` leaks real GPS. Decides the gap
  approach.
- **Life360's airport trigger:** exact condition (geofence entry vs. dwell time) is unknown;
  the arrival simulation may need tuning (approach speed, dwell in the airport polygon).
- **Valhalla public endpoint** availability/quality for these specific routes — mitigated by
  caching, but first build needs it up.
- **Teleport tolerance:** how large a position delta Life360 flags is unmeasured; relevant to
  Branch B.

## Mapping to ROADMAP

- **M1.5** — Phase A gates + Phase B deliver the movement engine and the CDG arrival, and the
  route presets ("Airport route", "Full Ride"). The activity-emoji line-item is gated on
  Phase A #1.
- **M2** — formalizing `LocationBackend` + the pmd3 adapter (currently `spoof.py` shelling out
  to the CLI) is where `play_route()` and the renderer land in the Core layer.
- **v2 backlog** — Phase C (live interpolation, arbitrary routes) matches the existing parking-
  lot entry for holding the DVT session open and interpolating along a drawn polyline.
