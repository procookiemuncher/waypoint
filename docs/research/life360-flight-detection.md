---
title: Life360 Flight Detection / Landing Notifications — how it works, has anyone spoofed it, and can we?
status: research                # research | device-verified | superseded
last_verified: 2026-10-24
device_verified: partial        # 2026-10-24: airplane toggle automated, sim holds offline, tunnel survives (cable); the push itself is still UNTESTED
open_gates: [flight-push-manual-toggle, flight-altitude-hard-gate, isSimulatedBySoftware]
depends_on: [life360-notification-triggers, coremotion-injection-feasibility]
source_tier: mixed              # PRIMARY (Life360 support/press/blog, Apple docs, 3 independent API reverse-engineerings) + third-party (spoof-scene blogs, forums)
recheck_if: [Life360 app update changes flight-detection triggers or gating, iOS point release changes location-sim/altitude behavior, someone publishes a landing-notification spoof, the phone->server ingest schema is dumped]
---

# Life360 Flight Detection / Landing Notifications — how it works, has anyone spoofed it, and can we?

> Deep-research brief answering the owner's three questions: (1) **how does the Flight Detection
> setting actually work**, (2) **has anyone spoofed the "landed at <airport>" notification before**,
> and (3) **can *we* trigger it** on our stack (owned, non-jailbroken iOS 26.6, pmd3 userspace tunnel,
> Windows, lat/lon-only injection, physically-still phone — but the owner **can toggle airplane mode by
> hand**). Deepens the one-row treatment in `life360-notification-triggers.md` §2 into a dedicated
> analysis. Confidence marked; sources at end.
>
> **How to read confidence:** each claim is tagged `[HIGH/MEDIUM/LOW]` for source/reasoning strength and
> flagged **PRIMARY** (Life360 official docs/press, Apple docs, reverse-engineered API source) or
> **THIRD-PARTY** (blogs/forums). A separate axis — *tested on our own phone* — is `device_verified:
> none` for everything here; the decisive experiment (§5) is an **open gate**, not a result.

> **Update 2026-10-24 (on-device, Mac):** the airplane-mode gates no longer need hands. A devicectl
> `openURL` to `shortcuts://run-shortcut?name=vida-airplane-on|off` toggles airplane mode + Wi-Fi with no
> prompt; over the cable the Mac still reaches the phone while offline, and a location set offline holds.
> devicectl also carries a real speed now (the >100 mph gate was doubtful under pmd3's `speed = -1`).
> Altitude is still missing, so §5 is still the deciding test. See AGENTS.md.

> **Update 2026-10-24 — altitude tool search (Mac, Xcode 27.1, phone not plugged in):** still no tool
> that injects altitude on non-jailbroken iOS 26. Checked:
> - **pmd3 DVT** — only `simulateLocationWithLatitude:longitude:`. Unchanged.
> - **devicectl `simulate location coordinate` / `route`** — lat/lon (+ speed for route). Route JSON
>   waypoints are `{latitude, longitude}` only; the string "altitude" appears nowhere in devicectl or the
>   CoreDevice frameworks.
> - **devicectl `simulate location scenario`** — the one real lead. Apple's scenario files
>   (`/System/Library/Frameworks/CoreLocation.framework/Versions/A/Support/SimulationScenarios/*.plist`,
>   also shipped on the phone) are arrays of keyed-archived **full CLLocations** — Altitude,
>   VerticalAccuracy, Speed, Course, Timestamp. Stock ones have Altitude 0 / VerticalAccuracy −1 (invalid).
>   A forged plist with a 0→11 km climb would be exactly what we need **if** devicectl could ship it. But
>   the help says the file must be "a path to a file inside of the simulator runtime", and CoreDevice only
>   sends `scenarioName` / `scenarioFile` (a path string, not contents). On a physical phone that
>   probably means a path on the device, which we can't write to. **Likely dead.** A cheap check once the
>   phone is plugged in: `simulate location list`, then `scenario /abs/mac/path.plist` to see if it errors.
> - **Commercial spoofers (AnyGo, MockGo, iMyFone AnyTo…)** — all lat/lon over the same Apple service.
>   "Fake GPS (LocSim)" takes altitude but is a TrollStore IPA for iOS 15.0–15.4.1. Not usable.
> - **Physical routes** — a vacuum/degassing chamber can drop the **barometer** to cabin-pressure levels
>   (~75 kPa ≈ 8,000 ft), but it doesn't touch GPS altitude. RF GPS simulation (HackRF + gps-sdr-sim) would
>   supply real GNSS altitude, but transmitting GPS is illegal outside a shielded enclosure. Not pursued.
>
> Net: §5 (fly with no altitude, airplane toggle automated) is still the only cheap way to learn if
> altitude is a hard gate.

## Bottom line (read this first)

1. **How it works — a sensor-fusion + airport-geofence + airplane-mode heuristic, not a flight-API
   lookup.** `[HIGH · PRIMARY]` Life360 watches **location, altitude, and speed**; it decides you flew
   when your phone pings **within 100 m of an airport**, hits **>100 mph**, goes into **Airplane Mode**,
   then comes out of Airplane Mode near a **second airport within 24 h** — and it fires the push **when
   the phone reconnects to a network after landing**. It's **ON by default**, **free for all members**,
   toggled per-member at **Settings → Flight Detection**, and marks the trip with a **plane icon** on the
   map.

2. **Has anyone spoofed it? — No public evidence, and no consensus that it's impossible either.**
   `[HIGH · that no public prior art exists]` Across Reddit, GitHub, YouTube/TikTok, blogs and news:
   **zero** confirmed demonstrations, zero credible claims, zero tools targeting the landing push. The
   spoofing scene pranks *crash* detection constantly but has **never** discussed faking a *landing*
   notification. This is **novel, undocumented territory.**

3. **Can we trigger it? — UNKNOWN, pending one on-device test; it hinges on a single gate: altitude.**
   `[gates satisfiable: HIGH][altitude blocker: HIGH][net verdict: genuinely untested]` The earlier docs
   marked this a flat **NO**, over-weighting the airplane-mode/reconnect requirements. This deeper look
   **narrows the verdict**: the owner's **hand-operated airplane-mode toggle** satisfies the airplane-mode
   *and* network-reconnect gates *more faithfully than any injection could* (it produces the genuine
   connectivity gap→restore), and the airport-proximity + >100 mph + two-airport gates are all injectable.
   **Every gate is satisfiable except altitude** — which is dead on our stack no matter which altitude
   source Life360 uses (injected GPS locations carry no altitude; the barometer reads ground-flat on a
   still phone). So the literal push fires **iff Life360 treats altitude as a soft, weighted signal rather
   than a hard requirement** — an unknown no public source resolves. Verdict: **NO-until-tried, but now a
   cheap, well-specified test away from a definitive answer** (§5). The reliable fallback, if it fails,
   remains the **geofence "arrived at CDG"** (unchanged from `life360-notification-triggers.md`).

---

## §1 — How the Flight Detection setting works *(mostly HIGH · PRIMARY)*

### The official mechanism (verbatim)

Life360's press release, repeated across TechCrunch and the support article `[HIGH · PRIMARY]`:

> "Utilizing phone sensors like **location, altitude, and speed**, Life360's flight detection algorithm
> accurately identifies takeoff and landing times, **even in airplane mode**. **Upon connecting to a
> network post-landing**, Circle members are promptly notified without any action required from the
> traveler."

Decoded: it is **not** an airline/flight-number API lookup (works domestic + international, no flight
info entered). It is a **heuristic state machine** over three phone signals plus an **airport location
dataset** (a proximity test against known airports — Life360 does **not** disclose *which* database;
OurAirports/OpenFlights are plausible but unconfirmed `[LOW · inference]`). Because location can't
transmit while the radios are off, the phone **senses the flight offline, buffers it, and uploads on
reconnect**; Life360's **server** then fans the push out to the circle. The internal takeoff/landing
discrimination logic is proprietary and undisclosed `[not disclosed]`.

### The exact trigger checklist (verbatim from the support article) *(HIGH · PRIMARY)*

> "For a Landing Notification to be sent:
> - A member's location must ping **within 100 meters of an airport**.
> - The travel speed must reach **over 100 MPH**.
> - During the flight, they must have **Airplane Mode turned on**.
> - Once the flight lands, they must **turn Airplane Mode off**.
> - They must arrive at a **second airport location within 24 hours**."

Plus two config preconditions `[HIGH · PRIMARY, blog]`: the **recipient** must have Flight Detection on,
and the **traveler** must have **Location Sharing on**. (Note: the widely-repeated "200 mph" figure is
**wrong** — every primary source says **over 100 mph**.)

### The setting itself *(HIGH · PRIMARY)*

- **On by default:** "This feature is enabled automatically" / "automatically enabled for all Life360
  members using the latest app version." **No manual setup needed** — unlike a geofence Place.
- **Where it lives:** **Settings (upper-left) → Flight Detection → toggle.** It is **per-member** (each
  member toggles whether *they* receive flight notifications about others).
- **Free, not a paid tier.** Marketed "available to all members"; the feature isn't even named on the
  Gold/Platinum pricing page. (Don't confuse with the paid Platinum "Travel Support" concierge — separate.)
- **iOS + Android**, no stated platform restriction `[MEDIUM · inferred from absence of a gate]`.

### The notification + map behavior *(HIGH for existence/icon; LOW for exact string)*

- Goes to the traveler's **circle**; a **plane icon** appears on the map "on the runway and while in
  flight" — Life360's first non-driving movement status. `[HIGH · PRIMARY, blog]`
- On landing at a **US/Canada** airport, a **"Request an Uber"** prompt appears (the feature's monetization
  hook: ~30M landing notifications drove ~57k Uber bookings; a deeper Uber integration shipped Feb 2026).
  `[HIGH · PRIMARY]`
- **Exact push wording is UNVERIFIED** — no primary source publishes the literal string, and **no source
  confirms airport codes (e.g. "SFO") appear** in it. Do not assert "Juan landed at CDG (SFO)"-style
  text; getting it requires an in-app screenshot. `[LOW]` Whether landings log to History/timeline is
  **undocumented** `[unknown]`.

### Permissions — and a load-bearing nuance *(mixed)*

- **Required:** traveler's Location Sharing on + recipient's Flight Detection on `[HIGH · PRIMARY]`.
- **Motion & Fitness is almost certainly NOT required for flight.** `[the "unconfirmed" fact: HIGH ·
  PRIMARY; the inference: MEDIUM]` Life360's own Permissions page scopes Motion & Fitness **only** to
  "driving analytics, Driving Safety features, and Crash Detection" — it never mentions flight or altitude.
  This matters for §3: it implies flight "altitude" is read from **`CLLocation.altitude` (Core Location,
  GPS-derived, no Motion permission)** rather than the **`CMAltimeter` barometer (Motion-gated)**.
  Reinforcing this: Apple's `CMMotionActivity` has **no "flying" class** (only stationary/walking/running/
  automotive/cycling), so flight detection *cannot* lean on a motion-activity classification the way the
  driving emoji does — it must fuse altitude + speed + airport geofence. `[HIGH · PRIMARY, Apple]`

---

## §2 — Has anyone spoofed the landing notification before? *(HIGH that no public prior art exists)*

**No confirmed demonstration, no credible claim, and — tellingly — no "it can't be done" consensus.** The
feature is essentially **absent** from the entire Life360-spoofing discourse. Evidence, breadth-first:

- **GitHub:** repo searches for `life360 flight`/`landing`/`airport` → **0 results**. Only two Life360
  tools exist, neither touching flight: **`JohnSwiftC/lifespoof`** (sets location by **MITM-rewriting the
  phone→Life360 upload** at `location.life360.com/v4/locations` / `gpi2.life360.com/v1/ingest`) and an
  empty `brittsabrat/Spoof` stub. The large pool of pymobiledevice3-based iOS spoofers (the same class we
  use) supports teleport + walk/drive/cycle up to ~159 mph but **none references Life360, airports, or
  flight.** `[HIGH · PRIMARY, negative]`
- **Reddit:** threads on generic Life360 spoofing (Fake GPS, Lockito, airplane-mode tricks) exist; the
  closest signal is "if you stop spoofing while at a place, it issues an **arrival** notification" — a
  *geofence* effect, not flight. No thread surfaced on faking the **landing/flight** push. `[MEDIUM ·
  comment bodies were access-blocked — titles/snippets only]`
- **The crash-vs-landing asymmetry (a meaningful negative signal):** there's a whole TikTok "fake **crash**
  detection" prank genre, yet **no "fake landing notification" genre exists.** The community treats Life360
  as a *map-position* problem; flight detection isn't in their threat model. `[MEDIUM · THIRD-PARTY]`
- **The spoof-scene how-to industry** (imobie, drfone, iMyFone, etc., 2026): all about static/teleport GPS
  to hide location; **none mentions flight detection at all.** They note Life360 flags **impossible travel
  speed / teleports** as a spoofing tell. `[MEDIUM · THIRD-PARTY]`
- **The one real precedent is an *API* attack, not a sensor spoof:** the **2024 Life360 breach** (~442k
  users) used an **Android emulator + proxy to intercept the login API** — proving Life360's endpoints are
  reverse-engineerable/MITM-able, which (with `lifespoof`) is the plausible route to inject a fake flight
  event *server-side* — **but nobody reports having done it for the landing push.** `[HIGH · THIRD-PARTY,
  verified reporting]`

**Verdict:** **UNKNOWN, leaning "nobody has publicly."** If it's been done, it's not published anywhere
reachable (Reddit comments, GitHub code-search, private Discord/Telegram tweak channels, and Life360's own
docs were variously access-walled — so this is a broad-but-not-exhaustive negative). **You would be at the
frontier.**

---

## §3 — Can we trigger it? Per-gate feasibility on our stack *(scorecard)*

Mapping each documented trigger to our stack (lat/lon-only injection over the USB RemoteXPC tunnel, still
phone, **owner toggles airplane mode by hand**):

| Trigger gate | On our stack | Confidence |
|---|---|---|
| Ping within 100 m of airport A, and airport B | **Satisfiable** — inject coordinates inside each airport | HIGH · PRIMARY |
| Second airport within 24 h | **Satisfiable** — inject the timeline | HIGH |
| Travel speed **>100 mph** | **Satisfiable** — a *densified* fast leg (iOS derives speed from position deltas), not a single teleport | MEDIUM |
| **Airplane Mode ON during flight** | **Satisfiable by hand** — and it produces the *genuine* connectivity gap the algorithm keys on | HIGH |
| **Airplane Mode OFF → network reconnect** | **Satisfiable by hand** — toggling off restores the network path, triggering the upload | HIGH |
| **Altitude** (climb/descent) | **DEAD both ways** — injected `CLLocation` carries **no altitude** (dropped even with GPX `<ele>`); the **barometer reads ground-flat** on a still phone and isn't injectable | HIGH (that it's blocked) / MEDIUM (that Life360 *requires* it) |

Three points that make this more promising than the old flat "NO":

- **The USB tunnel should survive airplane mode.** `[MEDIUM-HIGH · architectural, VERIFY on-device]`
  Airplane Mode disables Wi-Fi/cellular/Bluetooth but **not** the wired USB (Lightning) connection the
  pmd3 RemoteXPC tunnel rides on. So we can **keep injecting the fast "flight" path over USB while the
  phone's radios are off**, and Life360's background SDK buffers those injected positions offline — exactly
  the behavior the feature expects. (Precondition to confirm: keep the phone **unlocked** through the
  toggle so the DVT session doesn't drop — a known failure mode.)
- **The airplane-mode gate is a connectivity gap, not a flag Life360 reads.** `[HIGH · PRIMARY]` iOS gives
  apps **no API to read airplane-mode state**, so what the algorithm actually observes is *near airport A →
  clean network blackout → reappear near airport B*. A **hand toggle generates that pattern authentically**
  — better than any spoof.
- **The still-phone "stationary" contradiction matters *less* here than for the driving emoji.** `[MEDIUM]`
  Because `CMMotionActivity` has no "flying" class, flight detection can't require a motion-activity match,
  so a "stationary" accelerometer isn't a direct contradiction of "flying" (it would be for "automotive").
  It remains a *secondary* spoof-detection risk (a generic "GPS says 500 mph, accelerometer says still"
  cross-check), but it's not the primary blocker.

**The single decisive unknown — altitude.** Life360 lists "altitude" as a signal but never says whether
it's a **hard gate** (a real climb/descent must be present) or a **soft weighted input** (fused with
airport-geofence + speed + the airplane-mode envelope). This is the whole ballgame:

- If **soft/optional** → every other gate is satisfiable and the **literal push is reachable** on our stack
  with the hand toggle.
- If a **hard climb/descent requirement** → a still phone's flat/absent altitude never registers "takeoff,"
  and no amount of GPS + airplane-mode theater fires it. This is *plausible* precisely because altitude is
  the one flight signal hardest to fake — a security-minded design would lean on it.

No public source resolves this (the algorithm is proprietary). It is **empirically testable** (§5).

---

## §4 — Two candidate paths

**Path A — GPS injection + hand airplane-mode toggle (our current stack).** The owner's own idea, now
fully specified (§5). Cheap, uses tooling we already have, no new attack surface. Blocked only if altitude
is a hard gate. **Recommended first.** This is the existing `flight-push-manual-toggle` open gate.

**Path B — API MITM / payload injection (out of current scope; the most capable, highest-effort path).**
Instead of spoofing the phone's sensors and letting it report up, **intercept the phone→Life360 upload and
forge the payload** — the technique `JohnSwiftC/lifespoof` already uses for plain location, and that the
2024 breach proved viable. This could **bypass every sensor gate** (altitude included) by fabricating what
the phone tells the server. Big caveats: `[LOW-MEDIUM · unattempted]`
- It hinges on an unknown: **is the flight event classified on-device (SDK uploads a discrete "landed"
  event) or server-side (server infers from an uploaded breadcrumb stream)?** The "detects even in airplane
  mode, notifies on reconnect" wording implies **on-device sensing buffered then uploaded** — if the SDK
  uploads a *flight event*, MITM-injecting it is high-viability; if it uploads *raw breadcrumbs* the server
  classifies, you'd have to forge a convincing altitude/speed/airport stream (harder). The ingest schema
  (`gpi2.life360.com/v1/ingest`) is **undocumented** — reverse-engineering it is the prerequisite.
- It's a **different toolchain and ethos** (TLS-intercept + cert-pinning bypass on your own traffic) than
  the pmd3 location sim, and further from "personal dev-mode location spoof." Document it, don't build it
  yet.

---

## §5 — The concrete on-device experiment (Path A — do this)

This converts the verdict from UNKNOWN to definitive, cheaply. **Airports need no manual Place** — flight
detection uses Life360's own airport dataset (the 100 m proximity test), unlike the geofence-arrival
fallback. Precondition: Flight Detection is on by default; the owner's Location Sharing on; **a second
circle member (or second account) to observe the push**, since the API can't read it (§ below). Keep the
phone **unlocked** throughout so the DVT session survives the toggles.

**Sequence:**
1. **Establish at MIA.** Inject a location **within 100 m of Miami International**, radios **on**, and let
   it settle so Life360 uploads "at MIA." (Confirm with the Observer.)
2. **Hit >100 mph near MIA.** Play a short **densified** departure leg that ramps over 100 mph (registers
   the speed gate while still online/near airport A).
3. **Owner turns Airplane Mode ON** (Control Center / Settings, without locking). Radios off; **USB
   injection continues**.
4. **Fly the gap.** With the phone offline, inject the path toward CDG — because Life360 can't upload while
   offline, a fast leg then a **teleport/hold to within 100 m of Charles de Gaulle** is fine (no
   over-the-wire impossible-speed tell during the blackout). Hold at CDG.
5. **Owner turns Airplane Mode OFF.** Radios reconnect → the phone uploads the buffered "flight" → Life360's
   server evaluates the sequence.
6. **Watch the second member's phone** for the "landed" push + the plane icon on the map.

**Instrumentation:** run `tools/observe.py --watch --log` throughout. Per `life360-flight-detection`
research, the API exposes **no flight field and no notification-history endpoint** (see below), so the
Observer **cannot** see the landing event itself — but it **can** confirm the breadcrumb sequence uploaded
(MIA → gap → CDG) and the reconnect timing, isolating "did our data land server-side" from "did the push
fire." The push itself must be observed on a circle member's device.

**Interpretation:**
- **Push fires ⟹ altitude is soft ⟹ the literal flight/landing push is REACHABLE on a still phone.** Flip
  `flight-push-manual-toggle` to YES and update `life360-notification-triggers.md` #2.
- **No push ⟹** altitude (or the generic stationary-vs-fast-GPS spoof check) is a hard gate ⟹ **not
  reachable** on this stack ⟹ fall back to the **geofence "arrived at CDG"** (save CDG as a Place; needs
  none of this). Record it and close the gate as NO.
- **Optional isolation:** repeating on a **no-barometer device** (iPhone SE-1 / old iPad) would test whether
  *barometric* altitude specifically is the gate — but since injected **GPS** altitude is also absent, a
  null result there wouldn't distinguish "barometer required" from "any altitude required." The single test
  above is the decisive one.

> **Why the Observer can't shortcut this** `[HIGH · PRIMARY, 3 independent API reverse-engineerings]`: the
> Life360 member-location object exposes **no altitude, no `isFlying`, no flight/landing field** (the schema
> ends at `isDriving`, plus `inTransit`/`tripId`/`userActivity` — none plane-related), and there is **no
> notifications/activity/timeline endpoint** (`/messages` is human chat; `/member/alerts` is low-battery
> only; `/members/history` is location breadcrumbs; `unreadNotifications` is a bare counter). So a landing
> is neither **producible** (spoof side) *nor* **observable** (API side) through the API — confirming the
> `LIFE360_OBSERVER.md` §1.3 caveat. Observation must be human, on a circle member's device.

---

## §6 — Verdict & recommendation

- **How it works:** answered in full (§1) — a free, default-on, per-member setting that fuses
  location + altitude + speed with an airport geofence and an airplane-mode/reconnect envelope.
- **Has anyone spoofed it:** **No public evidence** (§2). Frontier territory.
- **Can we:** **NO-until-tried, gated solely on altitude** (§3). The old flat NO was too pessimistic about
  the airplane-mode/reconnect gates — the hand toggle handles them authentically. Run the **Path A test**
  (§5): it's cheap and decisive. If altitude turns out to be a hard requirement, the **geofence "arrived at
  CDG"** remains the reliable, already-understood substitute that delivers the same headline event to the
  family (minus the plane icon and flight wording).
- **If Path A fails and the literal plane-icon push really matters,** the only remaining escalation is
  **Path B (API MITM payload injection)** — powerful but unattempted, requiring the ingest schema to be
  reverse-engineered first. Scope it deliberately; don't drift into it.

## §7 — Implications for vida-360

1. **The airport goal has TWO tiers now, cleanly separated:** the **literal flight/landing push** (Path A,
   test-gated on altitude — the plane icon + "landed" wording) vs. the **geofence arrival** (reliable
   fallback, needs a saved CDG Place). Keep both in the roadmap; the geofence stays the safe north star.
2. **No manual Place is needed for the *flight* push** (Life360's own airport dataset) — a genuine
   difference from the geofence path, and a point the earlier docs conflated.
3. **The Path A test is the single highest-value flight experiment** and reuses the movement engine
   (densify a >100 mph leg — the repo already densifies legs) + a hand toggle + the Observer for
   breadcrumb confirmation + a second phone for the push.
4. **Don't over-invest before the test.** If altitude is a hard gate, all Path-A engineering is moot;
   spend the effort on the geofence arrival instead.
5. **`isSimulatedBySoftware` (gate #0) still applies** but looks clear (the spoof already reflects on
   Life360; the DVT path doesn't set the flag — see `coremotion-injection-feasibility.md` §3).

## Sources

**Primary — Life360 official:**
- **Flight Detection / Landing Notifications support article:** https://support.life360.com/hc/en-us/articles/23053396597271-Flight-Detection-Landing-Notifications
- **Launch press release (mechanism, "available to all"):** https://www.prnewswire.com/news-releases/life360-launches-landing-notifications-a-new-in-app-feature-that-allows-members-to-receive-air-travel-updates-302111026.html
- **Announcement blog (plane icon, "Location Sharing on"):** https://www.life360.com/blog/landing-notification-announcement
- **Permission Settings (Motion tied only to driving/crash):** https://support.life360.com/hc/en-us/articles/23053398402839-Life360-Permission-Settings
- **Movement Icons:** https://support.life360.com/hc/en-us/articles/23053397194903-Movement-Icons
- **Plans/pricing (flight not listed = free):** https://www.life360.com/plans-pricing
- **Feb 2026 Uber expansion:** https://www.globenewswire.com/news-release/2026/02/17/3239644/0/en/Life360-and-Uber-Announce-New-Integration-to-Help-Families-Stay-Connected-on-Every-Trip.html

**Primary — Apple (altitude / motion / network):**
- CMAltimeter (barometer = CoreMotion): https://developer.apple.com/documentation/coremotion/cmaltimeter · isRelativeAltitudeAvailable: https://developer.apple.com/documentation/coremotion/cmaltimeter/1616170-isrelativealtitudeavailable
- CLVisit (airport dwell, candidate): https://developer.apple.com/documentation/corelocation/clvisit
- NWPathMonitor (airplane-mode → connectivity transition): https://developer.apple.com/documentation/network/nwpathmonitor
- GPX sim lacks speed/altitude (altitude dropped even with `<ele>`): https://developer.apple.com/forums/thread/95388 · https://medium.com/@merlos/how-to-simulate-locations-in-xcode-b0f7f16e126d

**Primary — Life360 API reverse-engineerings (no flight/altitude field, no event endpoint):**
- krconv OpenAPI spec (`Location` schema ends at `isDriving`): https://raw.githubusercontent.com/krconv/life360-api-docs/master/spec/openapi.yaml
- kaylathedev node-api dissection (adds `userActivity`; endpoint list): https://github.com/kaylathedev/life360-node-api/blob/master/DISECTION_CIRCLES.md
- pnbruckner package (host/token/endpoints): https://raw.githubusercontent.com/pnbruckner/life360/master/life360/const.py · https://github.com/pnbruckner/life360/blob/master/life360/api.py
- (local, matches upstream) `backend/life360/client.py`, `docs/LIFE360_OBSERVER.md` §1.3

**Third-party — reporting / spoof scene / prior-art:**
- TechCrunch launch (April 9, 2024; "location, altitude and speed"): https://techcrunch.com/2024/04/09/life360-launches-landing-notifications-to-alert-friends-and-family/
- 2024 Life360 API breach (API is MITM-able): https://www.bleepingcomputer.com/news/security/over-400-000-life360-user-phone-numbers-leaked-via-unsecured-android-api/ · https://salt.security/blog/another-api-security-breach-life360
- `JohnSwiftC/lifespoof` (MITM payload rewrite of the location ingest): https://github.com/JohnSwiftC/lifespoof
- Spoof-scene how-tos (teleport detection; no flight mention): https://www.imobie.com/location-change/how-to-fake-location-on-life360.htm · https://www.ifonetool.com/blog/change-location/how-to-tell-if-someone-is-faking-their-location-on-life360/
- Airplane-mode restatements of the trigger: https://phonelocator360.com/blog/location-trackers-reviews/life360-in-airplane-mode-what-you-need-to-know

**Cross-references (local):** `docs/research/life360-notification-triggers.md` (the #2 flight row this
deepens), `docs/research/coremotion-injection-feasibility.md` (altitude/CMAltimeter non-injectability,
gate #0), `docs/LIFE360_OBSERVER.md` (why the API can't observe the push).
