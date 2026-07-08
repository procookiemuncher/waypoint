# Life360 on iOS — location signals, spoof detection, and realism rules

> Research brief. Scope: our owned iPhone (iOS 26.6), location driven by pymobiledevice3
> `simulate-location` over the iOS 17+ RemoteXPC developer tunnel. Life360 is the primary
> target. Confidence marked per claim; sources at the end.

## Bottom line

On iOS, Life360's positioning is **entirely CoreLocation-mediated** — the app never scans
Wi-Fi/cell itself; iOS does that and hands over a fused fix. So a CoreLocation-level spoof
feeds Life360's pin correctly, which matches our confirmed static-spoof result. **No primary
evidence shows Life360 running app-side spoof detection on iOS.** The two real risks are:
(1) the `isSimulatedBySoftware` flag (§2 — a must-test unknown for our tunnel path), and
(2) the **driving/telematics layer is CoreMotion-based and a still phone can't fake it** (§4).
Everything else that "catches" people is human observation of implausible movement.

## 1. What signals Life360 uses  *(HIGH)*

- The app reads location **through CoreLocation**; it does not roll its own positioning
  (Life360 engineering explicitly avoids "interfering with the core location code").
- On iOS, **iOS itself** does the Wi-Fi-hotspot and cell-tower lookup and returns a fused fix;
  third-party apps **cannot** scan surrounding Wi-Fi or enumerate neighboring cells (no public
  API). ⟹ Life360 cannot independently notice "connected to home Wi-Fi but GPS says 30 mi
  away." The exception is an opt-in **Trusted-Place Wi-Fi fence** (per-place, not ambient).
- **Server-side IP geolocation** gives Life360 a coarse city/ZIP from the connection IP
  (stated in its privacy policy). This is the one signal that can silently contradict a distant
  GPS pin — see Implications.
- Motion/activity and a **telematics SDK (Arity**, an Allstate company, embedded since 2018)
  run alongside for driving features; Arity uses "GPS, accelerometers, and gyroscopes."

## 2. Can Life360 detect spoofing on iOS?  *(HIGH there's no confirmed detection; flag = UNKNOWN)*

iOS has **no** Android-style "mock location" flag an app can query. The only analog is:

### `CLLocationSourceInformation.isSimulatedBySoftware` (iOS 15+)
- Apple: `true` "if the system generated the location using on-device software simulation." An
  app can read `location.sourceInformation?.isSimulatedBySoftware` and reject the fix. *(HIGH)*
- **Xcode debugger + GPX file → sets it `true`** (verbatim from Apple DTS, Oct 2025). *(HIGH)*
- **Third-party "external location provider" spoofers (LocaChange, AnyTo) → read `false`**,
  even on iOS 18 — "it will not have access to set that API flag." *(HIGH)*
- Developer Mode being enabled alone does **not** set it. *(MEDIUM-HIGH)*

**⚠ The decisive unknown for us:** pmd3 drives `DVTSimulateLocation` — the *same* DVT service
Xcode's "Simulate Location" panel uses (distinct from GPX-in-debugger, but both are Apple's own
developer facilities, not "external providers"). **No source states whether the tunnel path
sets `isSimulatedBySoftware`.** Because we use Apple's own developer service rather than posing
as an external provider, there's a real chance it reads **`true`** — the opposite of consumer
spoofer apps. **Test before trusting any realism work** (Phase A gate #0). Note Life360's
engineers are CoreLocation-sophisticated (they built their own location-sim test tooling), so
if the flag is readable, assume they *could* read it.

### Everything else
- No evidence of App Attest / DeviceCheck / jailbreak detection used against spoofing. *(MEDIUM
  — absence of evidence.)* The one real Life360 RE event ("Emo") was an Android emulator hitting
  a faulty API — a data leak, not spoof detection.
- Life360 shows **no "spoofing detected" alert** — it just keeps showing the fake pin. *(MED-HIGH)*
- Impossible-speed/teleport and accuracy-anomaly detection are well-established *techniques* in
  the literature, but there is **no evidence Life360 implements them** (vendor blogs claiming so
  are selling spoofers and cite nothing). *(HIGH technique exists / LOW that Life360 uses it.)*

## 3. Geofencing, Places, "arrived at airport", cadence

- **Places are entry/exit-triggered** (free tier = 2 Places). Built on iOS region monitoring:
  **max 20 regions/app, circular only, ~100 m min radius, ~20 s dwell** before a crossing event
  fires. "Unlimited Places" implies server-side region rotation. *(HIGH substrate / MEDIUM the
  rotation.)*
- **Arrival/leave alert latency ≈ 1–5 min** (1–3 with a Wi-Fi fence). Auto-Places form after
  ~5–10 min dwell. *(MEDIUM.)*
- **"Arrived at airport" / landing:** Flight Detection uses **location + altitude + speed**; the
  landing push fires when the phone **reconnects to a network after landing** and needs a ping
  **within 100 m of an airport**. ⟹ a lat/lon-only ground sim **cannot** reproduce the auto-
  "landed" push (no altitude, no airborne speed, no reconnect event); a **plain geofence arrival
  near the airport is reproducible.** *(MEDIUM-HIGH.)*
- **Update cadence is server/motion-adaptive**, not fixed — rises with movement, falls when
  stationary/low-battery. Popular "every 2 s / 2–15 min" figures are anecdotal. *(MEDIUM/LOW.)*

## 4. Driving detection & whether a "driving" state is spoofable  *(HIGH)*

This is the layer most likely to expose a GPS-only spoof.

- **Trip-start gate is GPS-derived (spoofable):** a drive registers only after **≥ ½ mile AND
  > 15 mph** (and background "Always" location, >10% battery, good signal).
- **But the analytics themselves are motion-fused (not spoofable on a still phone):** Crash
  Detection arms **> 25 mph** and uses **accelerometer + GPS**; hard-brake / rapid-accel events
  (~≥ 8 mph change in 1 s) are **accelerometer-detected, GPS-confirmed**; raw gyro + accel go to
  Arity. iOS's own `CMMotionActivity` "automotive" is computed by the motion coprocessor from
  accelerometer patterns, **not** GPS.
- **The only regime motion sensors can't disprove is perfectly constant-speed, straight-line
  motion** — any simulated turn/stop/brake exposes the missing accelerometer data.

**Takeaway:** don't try to fake "driving" as a *telematics* event. A spoofed drive will either
not register or look anomalous (a drive with zero braking/accel events). See the dedicated
[activity-emoji-coremotion.md](activity-emoji-coremotion.md) for the movement-*emoji* nuance
(which is speed-derived and likely reachable).

## 5. What actually gets people caught  *(MEDIUM-HIGH; human, not app)*

Teleporting; impossible speed / straight lines through buildings or water; an unnaturally
static pin with zero GPS drift; a frozen/missing battery while "out"; and **cross-app
contradiction** (Find My / Google Maps / Snap Map disagreeing with Life360). Life360 pushes no
"spoof detected" alert — the catch is behavioral. Since Find My / Google Timeline / Snap Map all
read the *same* spoofed CoreLocation fix, they agree with Life360 automatically; the leak is any
signal that *isn't* CoreLocation (IP-based services, a message "sent from" a Wi-Fi-geolocated
place).

## 6. Device state  *(HIGH phone-off; MED-HIGH battery independence)*

Battery %, phone on/off, permission state, and pause status come from the real device/OS and are
**not touched by pmd3 location simulation** — so they're independent cross-checks. Notably, the
**real, slowly-draining battery is a realism *asset*** (more believable than the frozen-100%
battery crude spoofers show). Don't try to touch it. Airplane mode kills the data connection
(no updates reach Life360 at all) and flags as paused/offline.

## Implications for vida-360

1. **Phase A gate #0: test `isSimulatedBySoftware` on the tunnel path first.** It can make all
   realism work moot. Treat the project as flag-gated until it returns `false`/`nil`.
2. **The pin works; the driving telematics layer is the exposure.** Design to avoid presenting
   as a *telematics* "drive"; the movement *emoji* is a separate, likely-reachable target.
3. **Respect IP geolocation:** test off home Wi-Fi; where practical keep spoofs within a
   plausible radius of the phone's real network metro.
4. **Cross-app consistency is free** (single CoreLocation source) — lean on it; avoid non-
   CoreLocation tells.
5. **Leave battery alone.** The natural drain helps.
6. **Airport:** aim for a geofence arrival near CDG; treat the auto-"landed" push as out of reach.

## Suggested realism rules (bake into renderer + validator)

Grounded in Apple CoreLocation semantics, empirical iPhone GPS numbers, iOS region rules, and
telematics thresholds.

- **Fields:** `set` is lat/lon only; iOS derives speed/course from ~1 Hz position deltas. A
  single static point → speed 0/−1, course −1 (verify on-device). Negative accuracy/speed/course
  = "invalid"; `verticalAccuracy ≤ 0` = altitude invalid.
- **Jitter:** wander ~**1–3 m** even when "still" (never emit a pixel-frozen coordinate); open-sky
  `horizontalAccuracy` ≈ **5–7 m**, urban up to ~30–65 m. Model per-axis Gaussian(σ≈accuracy) →
  Rayleigh radial. **Jitter must not manufacture speed** (use a bounded correlated offset, not
  IID per-point — the SWE core already hit and fixed exactly this bug).
- **Cadence:** ~**1 Hz while moving**; slow to occasional jittery updates when stationary. Don't
  stream 10 Hz (non-physical for a phone).
- **Max plausible speed (m/s):** walk ≈1.4 (cap ~2.0); run ≈3–4; cycle ≤~5.6; city drive ≈10–15;
  highway ≈25–33; **review > 35.8 (80 mph); hard-fail > 53.6 (120 mph)**. Between two 1 Hz fixes
  that's ~55 m max step for driving.
- **No teleports / no off-road straight lines:** enforce `distance(prev,next) ≤ v_max·Δt`;
  interpolate continuous paths; snap to roads/paths; ramp speed (a few m/s² max, jerk ≤~2 m/s³);
  match mode to environment.
- **Geofence dwell:** to fire "arrived", stay inside the ~100 m Place radius for **≥ 2–5 min**;
  to fire "left", move clearly out and stay out. Don't blip through.

## Open unknowns (test on-device, priority order)

1. **Does the pmd3/`DVTSimulateLocation` tunnel path set `isSimulatedBySoftware`?** — decisive.
2. Can pmd3 control the reported `horizontalAccuracy`, or is it fixed? — affects jitter realism.
3. What does iOS report for `speed`/`course` on a static simulated point vs. a moving GPX (0 vs
   −1)? — affects how we emit "stationary".

## Sources

- Apple DTS thread — `isSimulatedBySoftware` set by Xcode/GPX, not external providers: https://developer.apple.com/forums/thread/803179
- `isSimulatedBySoftware` reference: https://developer.apple.com/documentation/corelocation/cllocationsourceinformation/issimulatedbysoftware
- iOS region monitoring (20-region cap, ~20 s dwell, circular): https://developer.apple.com/documentation/corelocation/monitoring-the-user-s-proximity-to-geographic-regions · https://radar.com/blog/limitations-of-ios-geofencing
- CoreLocation accuracy/speed/course semantics: https://developer.apple.com/documentation/corelocation/cllocation/horizontalaccuracy · /speed · /course · /verticalaccuracy
- iOS Location Services uses OS-side crowd-sourced Wi-Fi/cell: https://support.apple.com/en-us/102515 · https://www.apple.com/legal/privacy/data/en/location-services/
- Apple WPS lookup is OS-side (apps can't scan): https://github.com/acheong08/apple-corelocation-experiments · https://arxiv.org/pdf/2405.14975
- Life360 uses CoreLocation / built sim-test tooling: https://medium.com/life360-engineering/location-simulation-testing-607149ca28d0
- Drive Detection (½ mi / 15 mph, Arity): https://support.life360.com/hc/en-us/articles/23053499870487-Drive-Detection-Analysis
- Crash Detection (accel + GPS, >25 mph): https://support.life360.com/hc/en-us/articles/23053410919063-Life360-Free-Crash-Detection · https://support.life360.com/hc/en-us/articles/23053658294807-Crash-Detection-Data-Collection
- Flight Detection / landing (location+altitude+speed, 100 m, network reconnect): https://support.life360.com/hc/en-us/articles/23053396597271-Flight-Detection-Landing-Notifications · https://techcrunch.com/2024/04/09/life360-launches-landing-notifications-to-alert-friends-and-family/
- Places (entry/leave, 2 free): https://support.life360.com/hc/en-us/articles/35609060078743-Places-in-the-Life360-app
- Arity SDK (GPS + accel + gyro): https://arity.com/mobility-data/telematics-sdk/
- CMMotionActivity automotive is motion-coprocessor-derived: https://nshipster.com/cmmotionactivity/
- Cadence is server/device-driven: https://community.home-assistant.io/t/life360-update-rate/566786
- Battery is a separate device field: https://community.home-assistant.io/t/life360-no-longer-shows-battery-level/445191
- Speed-threshold anomaly bands: https://blog.data-basics.com/clock-in/out-gps-spoofing-detection-and-audit-guide-1
- Empirical iPhone GPS (~7 m, ~1 Hz): https://freeletics.engineering/2019/06/03/ios_gps_testing.html
- Human-observable spoof tells (anecdotal): https://www.ifonetool.com/blog/change-location/how-to-tell-if-someone-is-faking-their-location-on-life360/
- Life360 sold precise location data (context): https://themarkup.org/privacy/2021/12/06/the-popular-family-safety-app-life360-is-selling-precise-location-data-on-its-tens-of-millions-of-user
