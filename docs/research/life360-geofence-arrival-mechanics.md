---
title: Life360 geofence arrival mechanics — the exact parameters that fire "arrived at <Place>"
status: research                # research | device-verified | superseded
last_verified: 2026-07-09
device_verified: none           # every number here is sourced/reasoned; the crossing + dwell claims are the on-device gates
open_gates: [geofence-crossing-required, geofence-dwell-latency, isSimulatedBySoftware]
depends_on: [life360-notification-triggers, life360-detection-and-realism]
source_tier: mixed              # PRIMARY (Life360 support snippets + patents, Apple CoreLocation, 6 API reverse-engineerings read directly) + third-party corroboration
recheck_if: [Life360 app update changes Place radius/alert behavior, iOS point release changes region monitoring, the API adds a place-create endpoint]
---

# Life360 geofence arrival mechanics — the exact parameters that fire "arrived at <Place>"

> Research brief. `life360-notification-triggers.md` gives the *recipe* ("save a Place, drive in, dwell");
> `life360-detection-and-realism.md` §3 gives the iOS region-monitoring *substrate*. This brief supplies
> the **precise parameters** needed to author a route that reliably fires the arrival push: radius, whether
> a real boundary crossing is required, dwell/latency, speed effects, and whether the API can create/read a
> Place or observe the arrival. Confidence + source-class per claim; sources at end.
>
> **How to read confidence:** each claim is tagged `[HIGH/MEDIUM/LOW]` (source/reasoning strength) and
> **[PRIMARY]** (Life360 docs/patents, Apple docs, reverse-engineered API source read directly) or
> **[THIRD-PARTY]** (blog/forum). Separately, `device_verified: none` — nothing here is confirmed on our
> phone; the load-bearing items get a concrete on-device test (§7).
>
> **Method caveat that caps every Life360-specific number:** `support.life360.com` returns HTTP 403 to
> automated fetchers and the renumbered article IDs have no Wayback snapshots, so Life360's own figures come
> from **cross-checked search-result snippets of the live pages**, not raw fetches. Apple CoreLocation docs,
> Life360 patents, and the API reverse-engineerings fetched cleanly and are directly verified.

## Bottom line (read this first)

**To reliably fire "arrived at CDG," author the route to APPROACH FROM OUTSIDE and physically CROSS the
Place boundary at a plausible speed, then DWELL inside ~2–5 minutes. Do NOT let a flight-gap teleport land
straight inside the radius — that likely fires only a silent presence update, not the arrival push.**
Confidence MEDIUM-HIGH, and it's the single most important design constraint this brief establishes.

- **Radius:** user-adjustable, **250 ft (~76 m) minimum → 2 miles (~3.2 km) maximum**, same for any Place
  type. `[HIGH · PRIMARY]` (This refines `detection-and-realism.md` §3's generic "~100 m" — the real floor
  is ~76 m.) The API can **read** a Place's exact radius (field `radius`, meters) but **cannot create** a
  Place — save CDG manually in the app. `[HIGH · PRIMARY]`
- **Crossing required:** a genuine outside→inside transition is the reliable trigger; merely *appearing*
  inside is unreliable (~70–75%). `[MEDIUM-HIGH · PRIMARY-by-proxy]`
- **Dwell/latency:** no documented Life360 dwell timer; iOS floor ~20 s; documented push latency **1–5 min**
  (1–3 with a Wi-Fi-anchored Place, which we can't inject). Budget ~5 min inside. `[MEDIUM · PRIMARY]`
- **Speed:** no evidence approach speed or an impossible-speed entry suppresses arrival (arrival is purely
  spatial) — but a smooth approach is cheap insurance and matters for *detection* (Topic 3), not the trigger.
  `[MEDIUM · PRIMARY patents + absence of evidence]`
- **Observability:** the arrival *push* isn't API-readable, but the member's `location.name` populates with
  the Place name while inside it — so the Observer can confirm the **arrival state** (not the push) by
  polling. `[MEDIUM-HIGH · PRIMARY]`

---

## §1 — Place geofence RADIUS *(HIGH · PRIMARY)*

- **User-adjustable, not fixed, not category-dependent.** A phone Place radius is set on a slider (mobile)
  or numeric box (web), **250 ft (~76.2 m) minimum → 2 miles (~3.2 km) maximum**, identical for Home/Work/
  custom. Adjusting the radius is **not** paywalled (the free tier caps the *number* of Places at 2, and
  gates unlimited alerts). `[HIGH · PRIMARY — Life360 "Places" support article, snippet-level; corroborated
  THIRD-PARTY: Alphr, a first-hand Hubitat user hitting the 250 ft floor]`
- **Default radius for a new Place: undocumented** `[absence of evidence]` — read the actual value off the
  saved CDG Place before routing (the API exposes it; see §5).
- **"Size" = radius, not diameter** `[MEDIUM]` — Life360 calls it "size"; the UI + third parties treat it as
  radius. Worth confirming the 250 ft is a radius on-device.
- **Correction of a prior number:** an earlier internal figure of "100–800 ft" is the **Jiobit hardware
  tracker's** Trusted-Places range, *not* phone Places — irrelevant to a spoofed iPhone. `[HIGH · PRIMARY]`
- **Patent color (not a UI number):** US11483672B2 derives a Place radius statistically from location
  history (e.g. 99.7th-percentile of past distances) — an internal option, no fixed meters, distinct from
  the documented 250 ft–2 mi control. `[HIGH · PRIMARY, patent]`

**Design consequence:** at the 76 m floor plus Apple's ~200 m test cushion (§3), start the approach **well
outside** — ≥ ~400–500 m from the Place center — to guarantee a clean crossing.

## §2 — Is a real OUTSIDE→INSIDE crossing required? *(MEDIUM-HIGH · PRIMARY-by-proxy — the load-bearing finding)*

**A clean boundary crossing is the reliable, designed trigger. Merely appearing inside the radius (e.g. a
flight-gap teleport that lands in the CDG circle) is UNRELIABLE for the "arrived at <Place>" push — likely
NO.** Net confidence ~70–75%.

Confirming evidence:
- **iOS geofence enter events are transition-only** `[HIGH · PRIMARY, Apple]`: "only boundary crossings
  generate an event. In particular, if the user's location is already inside the region at registration
  time, the location manager doesn't automatically generate an event." Life360's Places are built on this
  region-monitoring substrate (`detection-and-realism.md` §3).
- **Life360's own patents define entry as a crossing** `[HIGH for the patent language / MEDIUM as proof of
  shipped behavior]`: US11323844B2 — an event when "a UE … moves from a position outside … to a position
  within the geofence boundary"; US9294876B2 — alert fires "when the refined location … crosses the
  geo-fence."
- **Life360 built a SEPARATE "Landing Notification"** for the flight/teleport case (sensor + airplane-mode +
  two-airport, per `life360-flight-detection.md`). That a distinct pipeline was needed strongly implies the
  normal Place "arrived" push does **not** natively cover "appear inside after a gap." `[MEDIUM · inference]`

Counter-evidence (why it's not 90%+, stated honestly):
- iOS exposes `requestState(for:)` → `didDetermineState`, which reports "already inside" with no crossing,
  and an app *can* synthesize an arrival from it. `[HIGH · PRIMARY that the API exists]` Whether **Life360**
  wires its Place push to that path is **unproven** — possible, not demonstrated. `[absence of evidence]`
- One first-hand report (phone died → powered on at home → Life360 showed "At Home") was a **silent
  state/presence update, not an arrival push** — which actually *supports* the split between silent presence
  reconciliation and a discrete alert. `[THIRD-PARTY]`

**Design consequence (the rule):** approach from outside and cross the boundary continuously. For the
Miami→CDG scenario, this means the flight gap must **resume the injected track OUTSIDE the CDG Place and
drive in** — do not teleport into the CDG radius (ties directly to `flight-gap-and-stop-spoof-behavior.md`).

## §3 — Debounce / dwell / latency *(MEDIUM · PRIMARY)*

- **No documented Life360 dwell/"remain X minutes" rule** `[HIGH · absence of evidence]`. "Smart
  Notifications" is Life360's umbrella term for alert *types*, not a dwell timer.
- **iOS dwell floor ≈ 20 s** past the boundary, plus a system cushion (~200 m for testing) to suppress
  flapping, plus a ~10 s background wake window. `[HIGH · PRIMARY, Apple region-monitoring]` This is the only
  hard dwell number and it's the substrate Life360 sits on.
- **Documented delivery latency: 1–3 min** (when a Wi-Fi network is anchored to the Place) / **1–5 min**
  (no Wi-Fi). `[HIGH · PRIMARY — Life360, snippet-level]` We cannot inject Wi-Fi via GPS spoofing, so plan
  for the **no-Wi-Fi 1–5 min** window.
- **Anecdotal latency ~4.5–7 min**, with long tails to "minutes–1 hr+" that are confounded by permissions
  (Location not "Always", Background App Refresh off, Low Power Mode) — **not** a dwell parameter. `[MEDIUM ·
  THIRD-PARTY]`
- **iOS 20-region-per-app cap** means Life360 rotates monitored Places by proximity; only relevant if the
  owner has >20 Places. `[HIGH · PRIMARY]`

**Design consequence:** after crossing, continue inward past the ~200 m cushion and **dwell stationary ~2–5
min** to clear the push latency. Budget generously; don't blip through.

## §4 — Does approach speed / impossible-speed entry suppress the arrival? *(MEDIUM · PRIMARY + absence of evidence)*

- **No evidence approach speed gates the arrival.** Life360's arrival patents are purely spatial (enter/exit
  a boundary, no velocity term). `[HIGH · PRIMARY, patents US8731813B2/US9294876/US10051417]` No Life360
  patent on spoof/impossible-speed rejection was found.
- **Where speed *does* live in Life360** is Drive Detection (>15 mph after ≥½ mi) and a travel-mode
  classifier — these classify *driving vs walking* on accelerometer/gyro fusion, not spoofing, and don't
  gate a Place arrival. `[HIGH · PRIMARY]`
- **iOS proxy:** `CLLocation.speed` is instantaneous/provider-supplied (−1 = invalid); iOS does not
  recompute a 3000 km/h value from two injected fixes and reject them. `[HIGH · PRIMARY, Apple]`
- **The "impossible speed = flagged" narrative is almost entirely spoofing-vendor marketing** `[LOW ·
  THIRD-PARTY, conflicted]` — treat impossible speed as a *detection/cover* risk (see
  `life360-account-safety-detection.md`), not a documented arrival-suppressor.

**Design consequence:** a smooth, plausible-speed approach is prudent insurance (and matters for not tipping
off a watching human), but it is not a proven trigger requirement. Don't teleport across the boundary edge.

## §5 — Can the API create/read a Place, or observe the arrival? *(HIGH · PRIMARY — 6 reverse-engineerings)*

- **CREATE a Place via API: effectively NO** `[HIGH-by-convergence · PRIMARY]`. Across six independent
  reverse-engineerings (krconv OpenAPI spec; kaylathedev node-api; pnbruckner; ryanbuckner; ioBroker;
  pyLife360), **every places endpoint is GET-only** — no POST/PUT surfaced. The web/app UI *can* create
  places, so an undocumented endpoint may exist (authenticated GitHub-wide code search wasn't available), but
  no public client demonstrates it. **⟹ Save CDG as a Place manually in the app.**
- **READ a Place + its radius: YES** `[HIGH · PRIMARY]`. `GET /v3/circles/{id}/places` and `/allplaces`
  return a `Place` object: `id, ownerId, circleId, name, latitude, longitude, radius, type, typeLabel`. The
  **`radius` field is in meters** (confirmed by a reverse-engineer's `convertMetersToKm(float(radius))`;
  observed values 50–300.5). So the Observer can read the exact CDG geofence we're aiming at.
- **READ the arrival EVENT: NO event feed** `[HIGH · PRIMARY]`. No notifications/geofence-event endpoint;
  `/member/alerts` is low-battery-only; `/messages` is human chat; `/members/history` is a location trail,
  not transition events. The enter/leave push is **push-only**.
- **But the arrival STATE is pollable** `[MEDIUM-HIGH · PRIMARY]`: the member `location.name` is populated
  with the Place name while the member is inside it (`"Home"`, `null` when on raw GPS). So `location.name ==
  "CDG"` ⇒ the member is currently inside the CDG Place. This is a genuine refinement of the Observer's
  "can't read notifications" limit (`LIFE360_OBSERVER.md` §1.3): **we can confirm the arrival state by
  polling, just not the push itself.** (`placeType`/`source` are unreliable — `null` in samples.)

## §6 — Concrete route recipe (author the CDG arrival on this)

Bold = a guess needing on-device confirmation.

1. **Read the target first.** Save CDG as a Life360 Place in the app, then read its actual **radius** via the
   Observer (`GET .../places`) — don't assume the default.
2. **Start well OUTSIDE.** Begin the injected track **≥ ~400–500 m from the Place center** (clears the ~76 m
   radius + Apple's ~200 m cushion) so the entry is a genuine crossing (§2).
3. **Approach smoothly and cross continuously.** Plausible ground speed (**~1.4 m/s walking / ~8–13 m/s
   driving**), a **≥1 Hz** fix stream, no teleport across the edge — the movement engine's densify + speed
   ramp already does this.
4. **Continue inward ≥ ~200 m past the boundary**, then **dwell stationary ~2–5 min** (iOS floor ~20 s; padded
   for Life360's 1–5 min no-Wi-Fi push latency, §3).
5. **Never teleport into the radius.** If a flight gap precedes CDG, resume the injected track *outside* the
   CDG Place and drive in (§2; see `flight-gap-and-stop-spoof-behavior.md`).

Guesses to confirm on-device: default radius; exact dwell for the push (iOS 20 s floor vs padded 2–5 min);
whether a teleport-inside ever fires the push (~70–75% it doesn't); whether impossible inter-fix speed causes
any flag.

## §7 — On-device verification test (Observer + a 2nd circle member)

Closes the two load-bearing gates (crossing-required, dwell) cheaply.

Setup: save CDG (or a nearby test Place) in the app; read its radius via `observe.py`; have a **second circle
member's phone** to see the push (the API can't — §5); run `observe.py --watch --log arrival.jsonl` on the
owner's member the whole time to capture `location.name` flips and server cadence.

- **Test A — crossing vs teleport-inside (the decisive one):**
  1. *Crossing run:* play a route that starts ~500 m outside the Place and drives in, dwelling ~5 min. Record:
     did the 2nd member get the "arrived at <Place>" push? how long after boundary crossing? did
     `location.name` flip to the Place name in the Observer log?
  2. *Teleport-inside run:* clear, then `set` a single point **inside** the radius and hold ~5 min (no
     approach). Record: push or no push? does `location.name` still flip (state) even if no push fires?
  - **Push on the crossing but NOT the teleport ⟹ crossing is required** (flip `geofence-crossing-required`
    to confirmed) ⟹ the flight-gap route must drive in from outside. **Push on both ⟹** teleport-inside is
    enough (relaxes the flight-gap design).
- **Test B — dwell/latency:** from Test A's crossing run, read the delay between the Observer's boundary-cross
  timestamp and the 2nd member's push → the real push latency on our stack; tune the dwell.

Precondition already effectively met: `isSimulatedBySoftware` isn't blocking (the spoof reflects on Life360;
our DVT path doesn't set the flag — `coremotion-injection-feasibility.md` §3).

## Implications for vida-360

1. **Author the CDG arrival as an OUTSIDE→INSIDE drive-in, never a teleport-into-radius** — the highest-value
   design rule this brief establishes, and it constrains the flight-gap sequence (Topic 2).
2. **Read the Place radius off the API before routing** — the Observer can fetch the exact meters; don't guess.
3. **The Observer CAN confirm arrival state** (`location.name`) even though it can't read the push — a useful
   upgrade to the emoji/arrival instrumentation loop.
4. **Refines `detection-and-realism.md` §3:** the Place radius floor is **~76 m (250 ft)**, user-adjustable to
   2 mi — not a fixed ~100 m.
5. **Dwell ~2–5 min inside** is the safe budget; the movement engine should append that dwell after every
   arrival leg (it already models stop/dwell segments).

## Sources

**Primary — Life360 (support snippets + patents):**
- Places / radius 250 ft–2 mi: https://support.life360.com/hc/en-us/articles/35609060078743-Places-in-the-Life360-app
- Alert latency 1–3 / 1–5 min (shared Places engine): https://support.life360.com/hc/en-us/articles/30582980837271-Jiobit-Notifications
- Smart Notifications (umbrella, not a dwell timer): https://support.life360.com/hc/en-us/articles/23053397802263-Smart-Notifications
- Crossing patents: https://patents.google.com/patent/US11323844B2/en · https://patents.google.com/patent/US9294876 · https://patents.google.com/patent/US8731813 · dynamic radius: https://patents.google.com/patent/US11483672B2/en · travel-mode classifier: https://patents.google.com/patent/US11638119B2/en

**Primary — Apple CoreLocation:**
- Region Monitoring (crossing-only, ~20 s, ~200 m cushion, 20-region cap): https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/RegionMonitoring/RegionMonitoring.html
- `CLLocation.speed` (instantaneous, −1 invalid): https://developer.apple.com/documentation/corelocation/cllocation/speed
- `isSimulatedBySoftware` set only by Xcode/GPX, not external injection: https://developer.apple.com/forums/thread/803179

**Primary — Life360 API reverse-engineerings (create=no, radius readable=meters, no event feed):**
- krconv OpenAPI (`Place` schema, GET-only): https://raw.githubusercontent.com/krconv/life360-api-docs/master/spec/openapi.yaml
- kaylathedev node-api dissection (places endpoints, history): https://github.com/kaylathedev/life360-node-api/blob/master/DISECTION_CIRCLES.md
- ryanbuckner Indigo plugin (radius=meters via convertMetersToKm; client-side geofence math): https://github.com/ryanbuckner/life360-plugin
- pnbruckner (no places endpoint at all): https://raw.githubusercontent.com/pnbruckner/life360/master/life360/api.py

**Third-party corroboration:** Alphr radius floor https://www.alphr.com/change-radius-life360/ · region-monitoring deep-dive https://dwirandyh.medium.com/deep-dive-into-core-location-in-ios-geofencing-region-monitoring-7846802c968e

**Cross-references (local):** `life360-notification-triggers.md` (the recipe this parameterizes),
`life360-detection-and-realism.md` §3 (region substrate this refines), `flight-gap-and-stop-spoof-behavior.md`
(why the flight gap must drive in from outside), `LIFE360_OBSERVER.md` §1.3 (arrival-state polling refinement).
