# Valhalla road-snapping & per-edge speed — API research (Increment 2)

> Research brief. Goal: unblock **Increment 2** of docs/BUILD_PLAN.md — snap a small set of
> ordered waypoints to a realistic, mode-aware, road-following polyline **and** get **per-edge
> speed** so the GPX track is *timed* realistically (iOS derives speed from point spacing/Δt, per
> docs/MOVEMENT_ENGINE.md). Build-time only: hit the **FOSSGIS public Valhalla** once per route
> edit, cache the result, keep the straight-line renderer as the offline fallback. Self-hosting is
> the escape hatch. Confidence marked; every significant claim carries a source; URLs at end.

## Bottom line

Two calls, in this order, per drivable/walkable segment:

1. **`/route`** with `costing` = `auto` | `pedestrian` | `bicycle` → returns a **road-following
   shape as an encoded polyline at precision 1e-6 (polyline6)**, plus per-leg `time`/`length`.
   This is the *geometry* source. **The #1 pitfall: decode with `1e6`, not Google's `1e5`** —
   using 1e5 puts every point 10× off (valhalla.github.io decoding docs are explicit about this).
2. **`trace_attributes`** with `shape_match: "edge_walk"` on the polyline we just got back →
   returns an **`edges[]` array with per-edge `speed` (km/h by default), `speed_limit`,
   `road_class`, `length`, and `begin_shape_index`/`end_shape_index`**. This is the *timing*
   source: it maps each vertex range of the shape to a realistic speed, which is exactly what we
   need to space GPX points so iOS reads the right speed.

Use **`trace_attributes`, not `trace_route`**, for timing — `trace_route` gives directions text;
`trace_attributes` gives the per-edge attribute table. Because `/route`'s shape came *from
Valhalla*, feed it back with `shape_match: "edge_walk"` (exact, cheap) rather than `map_snap`
(the expensive HMM matcher meant for noisy GPS). Endpoint: **`https://valhalla1.openstreetmap.de`**,
no API key, rate-limited to **1 call/user/s, 100/s total** — a cached route hits it ~once per
edit, so we are comfortably inside fair-use. This confirms and operationalizes the note already in
docs/research/behavioral-engine-prior-art.md §5 ("`trace_attributes` gives per-edge speed +
speed_limit + road class — the key API to time a track").

---

## 1. `/route` — geometry + coarse timing  *(HIGH)*

**Endpoint / method:** `POST https://valhalla1.openstreetmap.de/route` (GET with a `json=` query
param also works). Request is a single JSON object.
Source: https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/

**Request schema (minimum):**
```jsonc
{
  "locations": [ {"lat": 49.0097, "lon": 2.5479}, {"lat": 48.8698, "lon": 2.3078} ],
  "costing": "auto",
  "directions_options": { "units": "kilometers" },
  "shape_format": "polyline6"
}
```
- `locations[]` — ordered lat/lon in **decimal degrees**; each supports optional `type`
  (`break` | `through` | `via` | `break_through`), `heading`, `street`, `radius`. For our small
  ordered waypoint sets, the default `break` at ends and `through`/`via` for intermediate points is
  right. `n` break locations → `n-1` legs.
- `costing` — **required**; names the travel model (below).
- `directions_options.units` — `kilometers`/`km` (default) or `miles`/`mi`. Governs the units of
  `length` in the response and (separately, see §2) of `edge.speed`/`edge.length`.
- `shape_format` — `polyline6` (**default**), `polyline5`, `geojson`, or `no_shape`. Explicitly
  set `polyline6` (or `geojson` to sidestep decoding entirely — see pitfall below).
Source: https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/

**Costing models & the options we care about** *(HIGH)*
(maps directly onto our `Segment.mode`: `drive`→`auto`, `walk`→`pedestrian`, plus `bicycle`):

| mode | costing | key options (default) | why it matters for us |
|---|---|---|---|
| drive | `auto` | `top_speed` (140 KPH, range 10–252), `use_highways` (0.5), `use_tolls` (0.5), `maneuver_penalty` | realistic driving; cap `top_speed` for surface-street presets |
| walk | `pedestrian` | `walking_speed` (**5.1 km/h** ≈ 3.1 mph, range 0.5–25), `use_hills`, `step_penalty`, `max_distance` | keeps the path off car-only roads; note the *routing* speed, but we re-derive timing from `trace_attributes` |
| bike | `bicycle` | `bicycle_type` (**hybrid**), `cycling_speed` (road 25 / cross 20 / hybrid 18 / mountain 16 KPH), `use_roads`, `avoid_bad_surfaces` | mixed cycleway/road preference |

Source (all defaults quoted verbatim): https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/

**Geometry returned + THE polyline pitfall** *(HIGH)*
Each `leg` has a `shape` field: *"an encoded polyline of the route path (with 6 digits decimal
precision)"*. Valhalla's decoding doc is emphatic: *"Valhalla APIs use six digits of decimal
precision… It is very important that you use six digits, rather than five as referenced in the
Google algorithms documentation."* Decode by dividing accumulated integers by **`1e6`** (the docs'
own samples use `inv = 1.0 / 1e6`, `kPolylinePrecision = 1E6`).
→ **Pitfall:** every off-the-shelf "Google polyline" decoder defaults to `1e5`; using it silently
scales all coordinates by 10 (points land ~hundreds of km away). Either (a) pass a `precision=6`
to a polyline lib (e.g. Python `polyline.decode(s, precision=6)`), or (b) request
`shape_format: "geojson"` and skip encoded polylines altogether — cleanest for our build script.
Sources: https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/ ·
https://github.com/valhalla/valhalla/blob/master/docs/docs/decoding.md

**Per-leg / maneuver time & length** *(HIGH)*
- `trip.summary` and each `leg.summary`: `time` = **estimated elapsed seconds**; `length` =
  distance in the requested `units` (km default).
- `leg.maneuvers[]`: each has `time` (seconds), `length` (units), `instruction`, and
  `begin_shape_index`/`end_shape_index` (indices into the decoded shape point array).
Source: https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/

> **Could we time the track from `/route` alone?** Partly — `leg.summary.time` gives a total, and
> maneuver `time`/`length` give coarse per-maneuver averages. But that is a *routing estimate*, not
> per-road-segment ground speed, and maneuvers are sparse (one per turn). For the realistic,
> per-edge speed profile we want, `trace_attributes` (§2) is the right tool.

---

## 2. `trace_attributes` (Meili) — per-edge speed to TIME the track  *(HIGH)*

This is the key API for Increment 2's timing goal.
Source: https://valhalla.github.io/valhalla/api/map-matching/api-reference/

**Request schema:**
```jsonc
{
  "encoded_polyline": "<the polyline6 string from /route>",   // or "shape": [{lat,lon},...]
  "costing": "auto",                                          // same mode as the /route call
  "shape_match": "edge_walk",                                 // exact walk; our shape IS a Valhalla path
  "directions_options": { "units": "kilometers" },
  "filters": {
    "attributes": [
      "edge.speed", "edge.speed_limit", "edge.road_class",
      "edge.length", "edge.begin_shape_index", "edge.end_shape_index",
      "edge.names", "edge.use"
    ],
    "action": "include"
  }
}
```
- `shape` **or** `encoded_polyline` (mutually exclusive) — the trace to attribute. Passing the
  `encoded_polyline` we already got avoids a re-encode.
- `costing` — the travel model; **excludes `multimodal`**.
- `shape_match` — algorithm (below).
- `filters.attributes[]` + `filters.action` (`include` keeps only the listed attrs → smaller,
  faster response; `exclude` drops them).
Source: https://valhalla.github.io/valhalla/api/map-matching/api-reference/

**`shape_match` modes — which to use** *(HIGH)*

| mode | behavior | use when |
|---|---|---|
| `edge_walk` | *"requires nearly exact shape matching… only when the shape is from a prior Valhalla route"* | **our case** — the shape came straight from `/route`; cheapest & deterministic |
| `map_snap` | HMM map-matcher (Meili); *"input shape might not closely match Valhalla edges… more expensive"* | raw/noisy recorded GPS traces (not our build path) |
| `walk_or_snap` | **default**; tries `edge_walk`, falls back to `map_snap` on failure | safe general default if unsure |

Since Increment 2 feeds `trace_attributes` a polyline that is itself a Valhalla route, use
**`edge_walk`** (or `walk_or_snap` as a resilient default).
Source: https://valhalla.github.io/valhalla/api/map-matching/api-reference/

**Per-edge attributes available via `filters` (exact field names)** *(HIGH)*
Speed-relevant: `edge.speed`, `edge.speed_limit`, `edge.truck_speed`, `edge.speeds_faded`,
`edge.speeds_non_faded`. Geometry/index: `edge.length`, `edge.begin_shape_index`,
`edge.end_shape_index`. Classification/identity: `edge.road_class`, `edge.use`,
`edge.travel_mode`, `edge.names`, `edge.way_id`, `edge.id`. Plus `edge.surface`, `edge.toll`,
`edge.tunnel`, `edge.bridge`, `edge.roundabout`, `edge.lane_count`, `edge.traversability`,
`edge.weighted_grade`, `edge.forward`, and more.
Sources: https://valhalla.github.io/valhalla/api/map-matching/api-reference/ ·
https://github.com/valhalla/valhalla/blob/master/docs/docs/api/map-matching/api-reference.md

**Units** *(HIGH):* `edge.speed` is *"Edge speed in the units specified. The default is kilometers
per hour."* `edge.length` is *"the matched edge length in the units specified (default is
kilometers)."* So with `units:"kilometers"`, `speed` is **km/h** and `length` is **km** — divide
speed by 3.6 to get m/s for the renderer.
Source: https://github.com/valhalla/valhalla/blob/master/docs/docs/api/map-matching/api-reference.md

**Response structure** *(HIGH):* top-level keys `edges`, `matched_points`, `shape`, `admins`,
`units` (+ optional `shape_attributes`, `elevation`, `warnings`, `osm_changeset`). Each
`edges[i]` carries the requested attrs; **`begin_shape_index`/`end_shape_index` tie each edge to a
contiguous run of vertices in the decoded `shape`** — that index mapping is what lets us assign
each shape-point run the edge's `speed`. `matched_points[]` (relevant to `map_snap`) each have
`lat`, `lon`, `type` (`matched`|`interpolated`|`unmatched`), `edge_index`, `distance_along_edge`
(0–1), `distance_from_trace_point` (m).
Sources: https://valhalla.github.io/valhalla/api/map-matching/api-reference/ ·
https://github.com/valhalla/valhalla/blob/master/docs/docs/api/map-matching/api-reference.md

**Tiny verified example — response fields we consume** (shape of the reply, per the docs above):
```jsonc
{
  "shape": "…polyline6…",
  "units": "kilometers",
  "edges": [
    { "speed": 48, "speed_limit": 50, "road_class": "residential",
      "length": 0.214, "begin_shape_index": 0, "end_shape_index": 5, "use": "road" },
    { "speed": 87, "speed_limit": 90, "road_class": "trunk",
      "length": 3.972, "begin_shape_index": 5, "end_shape_index": 41, "use": "road" }
  ]
}
```
Read as: shape vertices [0..5] move at 48 km/h; [5..41] at 87 km/h. That is the per-edge speed
profile the GPX timer needs.

---

## 3. `trace_route` vs `trace_attributes` — pick `trace_attributes`  *(HIGH)*

- **`trace_route`**: *"takes the costing mode and a list of lat/lon coordinates… to turn them into
  a route with the shape snapped to the road network and a set of guidance directions."* → output
  looks like a `/route` response (shape + maneuver narrative). Good for "clean this messy trace
  into turn-by-turn directions."
- **`trace_attributes`**: *"takes the costing mode and a GPS trace… and returns detailed
  attribution along the portion of the route"* → the `edges[]` attribute table (speed, road_class,
  …).

**For our timing use-case we want `trace_attributes`** — we already have the snapped geometry from
`/route`; what we lack is per-edge *speed*, which only `trace_attributes` exposes.
Source: https://valhalla.github.io/valhalla/api/map-matching/api-reference/

---

## 4. FOSSGIS public server — endpoint, key, limits  *(HIGH)*

- **API base URL:** `https://valhalla1.openstreetmap.de` (e.g.
  `https://valhalla1.openstreetmap.de/route`, `/trace_attributes`). The bare
  `https://valhalla.openstreetmap.de` is the **demo UI**; the programmatic API lives on the
  `valhalla1` subdomain. Full **planet** graph.
- **API key:** **none required.**
- **Rate limits:** **1 call/user/s and 100 calls/s total**; stricter limits on heavy endpoints
  (`/matrix`, `/expansion`, `/centroid`). Same fair-use spirit as the OSRM/Nominatim demo servers.
- **If you ship an app to end users:** you're asked to **notify via GitHub Discussions** and send
  an identifying **`X-Client-Id`** header (e.g. `X-Client-Id: vida-360`); a proper **`User-Agent`**
  is appreciated. (For our build-time-only, single-user use this is courtesy, not a hard gate — but
  set a `User-Agent`/`X-Client-Id` anyway; it's free insurance.)
Sources: https://github.com/valhalla/valhalla/discussions/3373 ·
https://github.com/valhalla/valhalla (README, FOSSGIS section)

**Caching keeps us well inside fair-use** *(HIGH, by construction):* per docs/MOVEMENT_ENGINE.md,
Valhalla is a *build-time* dependency. Each route edit = at most one `/route` + one
`trace_attributes` per segment, then we freeze the snapped+timed result to a committed GPX. A given
preset therefore hits the server **~once per edit**, never at run time — far under 1 call/s. If a
build ever needs many segments at once, add a small client-side delay (≥1 s between calls) to
respect the per-user limit.

---

## 5. Self-hosting fallback  *(HIGH, high-level)*

Canonical repo: **`github.com/valhalla/valhalla`** — *"an open source routing engine and
accompanying libraries for use with OpenStreetMap data,"* **MIT** licensed.
Source: https://github.com/valhalla/valhalla

Drop-the-public-dependency flow (high level):
1. `docker pull ghcr.io/valhalla/valhalla` — official image.
2. Provide an OSM extract (e.g. a Geofabrik `.osm.pbf` for France/Île-de-France — small, enough for
   the CDG routes) mounted into the container.
3. Build graph tiles with **`valhalla_build_tiles`** (config via `valhalla_build_config`); the
   image's entrypoint typically builds tiles from any `.pbf` in the mounted data dir on first run.
4. Serve with **`valhalla_service`** on `localhost:8002`; the API is identical, so only the base
   URL changes.
Sources: https://github.com/valhalla/valhalla · https://valhalla.github.io/valhalla/

**Recommendation:** stay on FOSSGIS for now (docs/MOVEMENT_ENGINE.md already rejected self-hosting
as overkill for a handful of cached routes). Keep self-host as a documented escape hatch if FOSSGIS
is down when we build, or if we ever need many routes. Make the base URL a config value so the
switch is one line.

---

## 6. Practical gotchas  *(mixed confidence, sourced)*

- **Polyline precision (repeat, because it bites everyone):** decode with **1e6**, not 1e5, or
  request `geojson`. *(HIGH — https://github.com/valhalla/valhalla/blob/master/docs/docs/decoding.md)*
- **Waypoint snapping radius:** on `/route`, each `location` accepts a `radius` (meters) — how far
  Valhalla may search for a road to snap that waypoint to. Set it a bit generous (e.g. tens of m)
  for hand-placed waypoints so a point dropped slightly off-road still snaps. *(HIGH —
  https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/)*
- **`trace_attributes` search radius:** `trace_options.search_radius` (meters) with a **max of
  100 m**; Meili config defaults are `search_radius: 50`, `max_search_radius: 100`,
  `gps_accuracy: 5`, `sigma_z: 4.07`, `beta: 3`, `interpolation_distance: 10`,
  `breakage_distance: 2000`. These matter for `map_snap`; for `edge_walk` on a clean Valhalla shape
  they're largely moot. *(HIGH — https://valhalla.github.io/valhalla/api/map-matching/api-reference/ ·
  https://valhalla.github.io/valhalla/meili/configuration/)*
- **Waypoints that don't snap:** a `/route` that can't connect a waypoint returns an error (no
  route); a `map_snap` `trace_attributes` marks points `type:"unmatched"` and may split the result
  (`begin_route_discontinuity`/`end_route_discontinuity`). Build step must **detect this and fall
  back to the straight-line renderer** for that segment (Increment 2 keeps that fallback). *(HIGH —
  https://valhalla.github.io/valhalla/api/map-matching/api-reference/)*
- **Turn jitter:** raising `trace_options.turn_penalty_factor` (docs suggest up to ~500) smooths a
  matched path that flip-flops between parallel edges — only relevant if we ever `map_snap` noisy
  input. *(MEDIUM — https://valhalla.github.io/valhalla/api/map-matching/api-reference/)*
- **`units` consistency:** send the same `directions_options.units` on both calls so `/route`
  `length` and `trace_attributes` `edge.speed`/`edge.length` share units. km→m/s: `mps = kmh/3.6`.
  *(HIGH — turn-by-turn + map-matching refs)*
- **Request size / trace length:** the docs state **no explicit max shape-point count** for
  `trace_attributes`; our traces are short (a handful of waypoints → a few hundred vertices), well
  within any practical limit. Don't send thousands of points to the public server in one call.
  *(MEDIUM — https://github.com/valhalla/valhalla/blob/master/docs/docs/api/map-matching/api-reference.md;
  absence of a documented limit)*
- **Per-mode speed realism caveats** *(MEDIUM):*
  - Pedestrian `edge.speed` reflects the routing `walking_speed` (default 5.1 km/h ≈ 1.42 m/s),
    not human variability — so for walk segments, treat `trace_attributes` speed as an *upper
    envelope* and let the renderer's `N(1.34, 0.30)` walk model (already built in Increment 1.5,
    per docs/research/behavioral-engine-prior-art.md §3) set the actual pace. *(HIGH for the
    default value; MEDIUM for the modeling call —
    https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/)*
  - Auto `edge.speed` without live traffic is a free-flow estimate; `edge.speed_limit` may be
    absent where OSM lacks `maxspeed`. Prefer `edge.speed`; fall back to `speed_limit`, then the
    per-mode default. Apply the renderer's accel/decel + zero-speed dwells (Increment 1.5) *on top*
    of these per-edge targets so junctions aren't taken at full edge speed. *(MEDIUM — inference
    from the attribute definitions.)*

---

## Implications for vida-360 (Increment 2)

Concrete, developer-actionable. Fits the shape in docs/MOVEMENT_ENGINE.md
(`route.json → Valhalla snap → dense GPX`) and slots *before* the existing `RouteRenderer`.

**Where it goes:** a new build-time module (e.g. `backend/movement/snapper.py`) that, per drive/
walk/bike `Segment`, replaces the segment's hand-authored `waypoints` with a **dense, road-snapped,
per-vertex-speed-annotated** polyline, then hands that to the existing renderer. Straight-line
interpolation stays as the offline/no-network fallback (Increment 2 requirement).

**Call sequence per segment:**
1. `mode → costing`: `drive→auto`, `walk→pedestrian`, `bike→bicycle`.
2. `POST /route` with the segment's ordered `waypoints` as `locations`,
   `directions_options.units="kilometers"`, `shape_format="geojson"` (or `polyline6` + decode with
   **1e6**). Keep `leg.shape` (the dense road geometry) and, per location, a small `radius` so
   slightly-off waypoints snap.
3. `POST /trace_attributes` with that shape (`encoded_polyline` or `shape`),
   `shape_match="edge_walk"`, same `costing`, same `units`, and
   `filters.action="include"` for `["edge.speed","edge.speed_limit","edge.road_class",
   "edge.length","edge.begin_shape_index","edge.end_shape_index"]`.
4. **Map per-edge speed → per-vertex speed:** for each `edges[i]`, assign `speed` (÷3.6 → m/s) to
   shape vertices `[begin_shape_index .. end_shape_index]`. Result: a polyline where each point
   carries a target ground speed.
5. **Hand off to `RouteRenderer`:** feed the dense polyline + per-vertex target speed in place of
   the straight-line path. The renderer then does what Increment 1.5 already built — densify to
   ~1 Hz so **point spacing encodes speed** (the `gips` technique, behavioral-engine-prior-art.md
   §5/D), apply jerk-limited accel/decel ramps, zero-speed dwell at mode changes, and
   perpendicular-biased GPS jitter — but now *timed by real road speeds* instead of a flat
   `speed_mps`. `speed_mps` in `route.json` becomes an optional **override/clamp**, not the primary
   signal.
6. **Validate** with the existing validator (per-mode/global speed ceilings, monotonic time,
   accel gate) — this catches any bad edge speed before the GPX reaches the device.

**Caching (Increment 2 requirement):** key the cache on
`(segment waypoints, mode, costing options)` → the snapped polyline + per-edge speeds (store raw
JSON responses next to the route, e.g. `data/routes/<name>.snap.json`, committed). Rebuild only
when the input changes → **network hit ~once per route edit**, never at run time. This is the
mechanism docs/MOVEMENT_ENGINE.md relies on to keep Valhalla a build-time-only dependency.

**Config knobs to expose:** `VALHALLA_BASE_URL` (default `https://valhalla1.openstreetmap.de`, so
self-host is a one-line switch), a `User-Agent`/`X-Client-Id` (`vida-360`), and a ≥1 s inter-call
delay to honor the per-user rate limit on multi-segment builds.

**Speed-realism guardrails:** trust `auto` `edge.speed` for driving; treat `pedestrian` edge speed
as an envelope and let the walk model set pace; never take an edge's full speed *through* a
junction — the renderer's ramps + dwells (Increment 1.5) handle that. This dovetails with the
Life360 speed bands already tuned in Increment 1.5 (teleport >53.6 m/s, review >35.8 m/s).

---

## Suggested build steps (→ Increment 2)

1. **`snapper.py` + `VALHALLA_BASE_URL` config.** Thin HTTP client (POST `/route`,
   `/trace_attributes`) with `User-Agent`/`X-Client-Id`, timeout, and a graceful "no route /
   unmatched → raise" path. *(→ Increment 2 bullet 1)*
2. **`/route` call + geometry decode.** Prefer `shape_format:"geojson"`; if using `polyline6`,
   decode with **precision 6 / 1e6** (add a unit test with a known Valhalla polyline to lock the
   precision — this is the pitfall). Per-location `radius` for snapping. *(→ bullet 1)*
3. **`trace_attributes` call + per-edge→per-vertex speed mapping.** `edge_walk`, `include` filter,
   expand `begin/end_shape_index` ranges to a per-vertex `speed_mps` (km/h ÷ 3.6). *(→ bullet 1)*
4. **Wire into the build pipeline before `RouteRenderer`;** feed dense polyline + per-vertex speed;
   `route.json` `speed_mps` becomes an optional clamp/override. *(→ bullet 1)*
5. **Straight-line fallback preserved:** on any Valhalla error/unmatched segment or
   `VALHALLA_BASE_URL` unreachable, fall back to the existing interpolation. *(→ bullet 2)*
6. **Response cache** keyed on inputs, committed alongside the route (`<name>.snap.json`); rebuild
   only on input change → network ~once per edit. *(→ bullet 3)*
7. **Re-run the offline validator** on the timed GPX (already in place) as the gate before device
   play. *(cross-cuts; per docs/BUILD_PLAN.md "Verify offline")*
8. **(Optional, documented) self-host escape hatch:** `docker pull ghcr.io/valhalla/valhalla` +
   `valhalla_build_tiles` on a France `.osm.pbf`, point `VALHALLA_BASE_URL` at `localhost:8002`.
   *(→ resilience; not required to ship)*

## Sources

Valhalla `/route` (turn-by-turn) API: https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/ ·
raw md: https://github.com/valhalla/valhalla/blob/master/docs/docs/api/turn-by-turn/api-reference.md
Map-matching (`trace_route` / `trace_attributes`, Meili) API: https://valhalla.github.io/valhalla/api/map-matching/api-reference/ ·
raw md: https://github.com/valhalla/valhalla/blob/master/docs/docs/api/map-matching/api-reference.md
Polyline **1e-6** precision + decode pitfall: https://github.com/valhalla/valhalla/blob/master/docs/docs/decoding.md
Meili config defaults (sigma_z, search_radius, etc.): https://valhalla.github.io/valhalla/meili/configuration/
FOSSGIS public server (endpoint, no key, 1/s·100/s limits, X-Client-Id, planet graph): https://github.com/valhalla/valhalla/discussions/3373 · https://valhalla.openstreetmap.de/
Canonical repo / MIT license / Docker image / `valhalla_build_tiles`: https://github.com/valhalla/valhalla · https://valhalla.github.io/valhalla/
Cross-refs (this repo): docs/MOVEMENT_ENGINE.md · docs/BUILD_PLAN.md · docs/research/behavioral-engine-prior-art.md
