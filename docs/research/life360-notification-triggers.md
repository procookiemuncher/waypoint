---
title: Life360 notification triggers — what we can and can't fire (and the method)
status: research                # research | device-verified | superseded
last_verified: 2026-07-08
device_verified: none           # the spoofability matrix is sourced/reasoned, not yet tested on our phone
open_gates: [isSimulatedBySoftware, flight-gap, flight-push-manual-toggle]
depends_on: [life360-detection-and-realism, activity-emoji-coremotion]
source_tier: mixed              # primary (Life360/Arity/pmd3 source + Apple docs) + press releases
recheck_if: [Life360 app update, iOS point release]
---

# Life360 notification triggers — what we can and can't fire (and the method)

> Research brief answering three questions: can we trigger (1) a **crash** alert, (2) a
> **"landed at <airport>"** alert, and (3) *every* Life360 notification? Plus the concrete
> **method** for the ones that are reachable. Scope: owner's own iPhone (iOS 26.6), lat/lon-only
> spoof via pymobiledevice3, phone physically still, no jailbreak. Confidence marked; sources at
> end. Companion to life360-detection-and-realism.md and activity-emoji-coremotion.md.

## Bottom line (read this first)

**Dev mode does *not* let us "manipulate almost any variable." It injects exactly one thing:
GPS position (latitude + longitude over time).** Verified four ways: pmd3 issue #340, a direct
read of the pmd3 source, a check that GPX playback **discards `<ele>`/altitude** (only lat/lon
reach the device), and the full DVT instrument list — the only non-location "condition" injector
(`condition_inducer`) fakes **network + thermal** state, never motion. Altitude, accelerometer,
gyroscope, barometer, battery %, and airplane-mode are **not injectable** without a jailbreak,
and there is no jailbreak for iOS 26.6.

That single lever — position — is enough to *cause* one family of Life360 alerts (geofence
arrivals/leaves + the movement emoji) and nothing else. Concretely:

| Ask | Verdict | Why |
|---|---|---|
| **#1 "Juan crashed"** | ❌ **No** | Crash = a real accelerometer G-spike (Arity/CoreMotion). Still phone = no spike; no injection path. **Also: don't — it auto-escalates to the circle + 24/7 dispatch.** |
| **#2 "Juan landed at CDG"** (literal flight push) | ❌ **No** | Gated on valid climbing **altitude** + an **airplane-mode ON→OFF** toggle + a **post-landing network reconnect**. None injectable. |
| **#2 substitute — "Juan arrived at CDG"** (geofence) | ✅ **Yes** | Save CDG as a **Place**, drive the pin in, dwell. Same family alert to the circle, minus the plane icon. |
| **#3 everything else** | Mixed | Full catalog below. The reachable set = geofence arrive/leave + movement emoji + a couple of freebies. |

## The injection surface — what "dev mode" actually gives us  *(HIGH)*

- `simulate-location set` → DTX selector `simulateLocationWithLatitude:longitude:` — **two floats,
  lat + lon.** No altitude/speed/heading/accuracy (pmd3 #340; libimobiledevice #1370 agrees).
- `simulate-location play <gpx>` → pmd3 reads **only** `point.latitude`/`point.longitude` and
  replays them on the GPX time deltas; **`<ele>` is parsed by gpxpy but never sent.** (Confirmed
  by reading `location_simulation_base.py`.)
- iOS therefore **derives** speed/course from our position deltas — that's why point spacing *is*
  the speed signal — but reports `altitude 0 / verticalAccuracy ≤ 0` (invalid), `speed`/`course`
  = −1 (invalid) for a static point.
- The DVT instrument set has no motion/accelerometer sim. `condition_inducer` (the "induce a
  device condition" one) only offers **Network Link** + **Thermal State** — no motion, no crash.
- **CoreMotion** (accelerometer/gyro → `CMMotionActivity`, walk/run/automotive/…) and
  **CMAltimeter** (barometer) are separate hardware channels with **no injection API** on a real
  device. A still phone reads `stationary` + flat pressure regardless of GPS.

⟹ Anything Life360 computes from **position/derived-speed/geofences** is in reach; anything from
**motion sensors, barometer, network state, battery, or manual/hardware actions** is not.

## #2 — "Landed at <airport>" (the priority) — NO as the flight push; YES as a geofence arrival

**How Life360 Flight Detection actually fires** *(HIGH — Life360 press + support):* it uses phone
sensors to measure **location, altitude, and speed**, detects takeoff/landing **even in airplane
mode**, and pushes to the circle **when the phone reconnects to the network after landing**. The
documented trigger checklist: a location ping **within 100 m of an airport**, travel speed
**> 100 mph**, **airplane mode on during the flight and off after**, and arrival at a **second
airport within 24 h**.

**Why our stack can't produce it** *(HIGH):* we can teleport the pin >100 mph past an airport on
paper, but (a) the **altitude** channel reads invalid (not injectable), (b) the **barometer**
reads flat on a still phone, (c) we cannot toggle **airplane mode** from the PC, and (d) we cannot
manufacture a **network reconnect** event. Even the commercial tools on the same DVT rails don't
attempt it (and cap simulated speed ~62 mph, below the 100 mph gate).

**Owner's manual-toggle idea — worth an on-device experiment (2026-07-08, UNTESTED).** The owner
proposed doing the airplane-mode toggle *by hand on the phone*, which changes premise (c) — and
therefore (d), since turning airplane mode off is exactly what forces the post-landing network
reconnect. Proposed sequence: spoof at/near **MIA** (satisfies the "within 100 m of an airport"
ping) → dwell → **manually turn airplane mode ON** → spoof-teleport the pin to **CDG** (a second
airport, >100 mph apart, within 24 h) → **manually turn airplane mode OFF** (network reconnects).
This hand-supplies conditions (a)(c)(d) and the two-airport/speed gates. **The only remaining
unknowns are (b)** — whether Life360's algorithm *hard-requires* the real **altitude/barometer**
climb-and-descent, or whether location + derived-speed + the airplane-mode/reconnect envelope is
enough. Nobody's published this specific attempt, so it's genuinely untested. **Verdict stays NO
until tried**, but this is the closest reachable shot at the literal flight push and is worth a
deliberate experiment (new **open gate: flight-push-manual-toggle**). If it fails, fall back to the
geofence "arrived at CDG" (below), which needs none of this.

> **Deep-dive (2026-07-09) → `life360-flight-detection.md`.** A dedicated brief now fully specifies the
> mechanism, confirms **no one has publicly spoofed the landing push**, and **narrows this verdict to a
> single gate: altitude.** The hand airplane-mode toggle satisfies the airplane-mode *and* network-reconnect
> conditions authentically (the old blanket NO over-weighted them); the airport/speed/two-airport gates are
> injectable. So the literal push fires **iff Life360 treats altitude as soft rather than a hard
> climb/descent requirement** — untested. That doc spells out the exact MIA→CDG hand-toggle experiment.

**Correction to a repo assumption** *(HIGH):* airports are **NOT** auto-recognized Places. The
only *automatic* airport notification is Flight Detection itself — which is the unreachable one.
The earlier docs' "Life360 recognizes airports itself, no manual Place needed" is wrong. What the
owner saw on a real Paris trip was the genuine flight-detection push, produced by real
altitude/airplane-mode/reconnect — exactly the inputs a spoof can't fake.

**The achievable substitute — a geofence arrival** *(MEDIUM-HIGH, pending on-device test):* save
the destination airport (CDG) as a Life360 **Place**, then drive the pin from outside into that
Place's radius and dwell. The circle gets **"Juan arrived at CDG"** — the same headline event to
the family, just without the plane movement icon and the flight-specific wording.

## #1 — "Crashed" — NO (two independent walls) + a safety caution

**Wall 1 (algorithm):** Life360's Crash Detection is **Arity's** model (since 2018). It requires a
real **accelerometer high-G impact** (≈20–40 g for a 30 mph crash), fused with gyro; GPS is only
*confirmation* (it arms when the phone was > 25 mph within ~5 s before impact). GPS deceleration
alone **cannot initiate** detection, and the feature requires the **Motion & Fitness** permission
(CoreMotion), a channel separate from location. A still phone emits a flat trace → no trigger.
**Wall 2 (injection):** as above, no no-jailbreak path injects CoreMotion into a real device.
Either wall alone is fatal; **verdict is a definite No** for our stack (HIGH). *(The same applies
to hard-braking, rapid-acceleration, and phone-usage driving events — all CoreMotion.)*

**⚠ Safety caution:** even if it were possible, don't. A crash alert auto-escalates — it tells the
whole circle "<name> may have been in a crash," starts an "are you OK?" countdown, and can
**contact 24/7 emergency dispatch / 911** if unanswered. Faking it risks real family panic and a
real emergency response to a false report.

## #3 — Full notification catalog + spoofability

The complete set of Life360 pushes/alerts, by trigger mechanism and whether our lat/lon-only
stack can fire it. **YES** = location/derived-speed only; **PARTIAL** = triggerable but with a
tell or only the location-derived half; **NO** = needs a channel we can't touch.

| Notification | Trigger mechanism | Spoofable? | Note |
|---|---|---|---|
| Arrived at `<place>` | geofence entry (location) | **YES** | Core target; save a Place, drive in |
| Left `<place>` | geofence exit (location) | **YES** | Drive out past the radius |
| Auto-detected Places | server dwell-clustering on location | **YES** | Emerges from the coords we feed |
| Movement emoji — walking (0–4 mph) | GPS-derived speed band | **YES** | Point spacing ≈ 1.3 m/s |
| Movement emoji — driving (0–50 mph) | GPS-derived speed band | **YES** | The emoji we target (Phase A #1) |
| Movement emoji — biking (0–7 mph) | GPS-derived speed band | **YES** | Mid band |
| Movement emoji — boating | location over water polygon | **PARTIAL** | Map lookup; emit coords over water (untested) |
| Movement emoji — flying (plane) | flight algo (altitude + >100 mph) | **NO** | Rides the unreachable flight gate |
| Flight Detection — "landed at `<airport>`" | altitude + airplane-mode + reconnect + 2 airports/24 h | **NO** | Use geofence "arrived" instead |
| Drive completed / summary | trip = ≥½ mi + >15 mph, then stop | **PARTIAL** | Trip object can form, but event-free |
| Weekly / individual driver report | server aggregation of drives | **PARTIAL** | Miles/top-speed populate; event columns stay 0 |
| Hard braking event | CoreMotion accelerometer | **NO** | Real deceleration only |
| Rapid acceleration event | CoreMotion accelerometer | **NO** | Real acceleration only |
| High speed / speeding (>80 mph/30 s) | GPS-derived speed | **PARTIAL** | The one speed-derived driving *event*; may surface only inside a validated drive |
| Phone usage while driving | screen + orientation (motion) | **NO** | Device interaction + motion |
| Crash Detection (+ dispatch) | CoreMotion impact ≥25 mph | **NO** | See #1; don't |
| SOS / Help Alert | manual button + countdown | **NO** | User action |
| Emergency Dispatch | downstream of SOS/crash | **NO** | — |
| Critical Alert (iOS channel) | wrapper for SOS/crash | **NO** | Inherits their triggers |
| Low battery (<10%) | device battery state | **NO** | Real battery; not injectable |
| Phone off / dead / "hasn't updated" | absence of updates (device/net) | **NO** | Stale-dot status, not a push we'd want |
| Location sharing paused / off | app/permission state | **NO** | Mostly a status tag; in-app pause sends no push |
| No-show alert ("didn't arrive by `<time>`") | server check of arrival vs. a set time | **PARTIAL** | Inverse logic: our spoof *suppresses* it by arriving |
| Severe weather (AccuWeather) | server: member location ∩ weather feed | **YES (indirect)** | Spoof into a severe-weather area → alert follows the pin |
| Bubbles active | manual user action | **NO** | User privacy state |
| Check-in ("checked in at `<place>`") | manual user action | **NO** | Explicitly manual |
| Tile — separation / left-behind | Bluetooth range from a paired Tile | **NO** | Needs the physical Tile |
| Jiobit — separation / button | Bluetooth range / hardware button | **NO** | Needs the physical Jiobit |
| Data breach / dark-web alert | server: PII match | **NO** | No location coupling |
| Membership / marketing pushes | account/server | **NO** | Promotional |
| Stolen-phone alert (standalone) | — | **NO / UNCONFIRMED** | Couldn't confirm it exists as its own push |

## The method we can use (concrete, honest)

The only Life360 notifications we can *cause* are the **geofence + derived-speed** family. The
recipe, built on the movement engine already in the repo:

1. **Gate first — Phase A #0 (`isSimulatedBySoftware`).** If Life360 ever reads that flag, every
   trigger below dies in one line. Our empirical result (the spoof already shows on Life360)
   proves they don't hard-block on it *today*, but confirm it before investing (see
   life360-detection-and-realism.md).
2. **Save the target as a Life360 Place** (airport, hotel, "work"). **Required** — airports are
   not auto-Places. Radius ~300–500 m.
3. **Build a route** (movement engine): start **outside** the Place → believable road-snapped
   approach at a plausible mode speed (Valhalla per-edge, Increment 2) → **cross the geofence** →
   **dwell ≥ 5–10 min** inside so the region event settles and the alert latency (≈1–5 min)
   elapses. Validate offline (the existing gate) so no teleport/velocity-step tells.
4. **Play it** (`simulate-location play`). The circle gets **"Juan arrived at <Place>"**; the
   **movement emoji** flips walk↔drive along the way (if Phase A #1 confirms it's speed-derived).
5. **For the "flight" story (#2 substitute):** model Miami→CDG as last-seen at MIA → an **update
   gap** (the flight) → reappear near CDG → drive the short final approach into the **CDG Place**.
   Result: **"arrived at CDG"** to the family. The gap mechanics depend on Phase A #2 (does iOS
   revert to real GPS when we stop `set()`?).
6. **Free bonus:** if you spoof into a region with active severe weather, the AccuWeather alert
   follows the fake pin — realism with zero engineering.

**Do not** build toward crash / hard-braking / driver-score / the literal flight "landed" push —
they need channels we can't inject, and the crash one is actively harmful to fake.

## Sources

Life360 Flight Detection: https://support.life360.com/hc/en-us/articles/23053396597271-Flight-Detection-Landing-Notifications · https://www.prnewswire.com/news-releases/life360-launches-landing-notifications-a-new-in-app-feature-that-allows-members-to-receive-air-travel-updates-302111026.html · https://techcrunch.com/2024/04/09/life360-launches-landing-notifications-to-alert-friends-and-family/
Crash Detection / Arity: https://www.life360.com/learn/how-does-crash-detection-work · https://arity.com/move/life360-and-arity-saving-lives-one-detected-crash-at-a-time/ · https://support.life360.com/hc/en-us/articles/23053410919063-Life360-Free-Crash-Detection · https://support.life360.com/hc/en-us/articles/23053549450391-False-Collision-Alerts
Notifications / Places / Movement Icons / Smart Notifications: https://support.life360.com/hc/en-us/articles/23053397802263-Smart-Notifications · https://support.life360.com/hc/en-us/articles/23053397194903-Movement-Icons · https://www.life360.com/learn/check-in-with-life360-place-alerts · https://www.life360.com/blog/life360-no-show-alerts
Movement/speed = position deltas: https://support.life360.com/hc/en-us/articles/23053466420887-Movement-Accuracy
Injection surface (lat/lon only): https://github.com/doronz88/pymobiledevice3/issues/340 · https://github.com/libimobiledevice/libimobiledevice/issues/1370 · pmd3 `location_simulation.py` / `location_simulation_base.py` / `condition_inducer.py` (github.com/doronz88/pymobiledevice3) · Apple CLLocation verticalAccuracy/speed/course (developer.apple.com/documentation/corelocation/cllocation) · CMAltimeter / CMMotionActivity (developer.apple.com/documentation/coremotion)
