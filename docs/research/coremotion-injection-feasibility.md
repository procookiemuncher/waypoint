---
title: CoreMotion on a still phone — can we inject, override, or suppress motion so Life360 sees "driving"?
status: research                # research | device-verified | superseded
last_verified: 2026-07-09
device_verified: none           # every claim here is source/architecture-based; the one live lever (Motion&Fitness OFF) is UNTESTED — that's the gate
open_gates: [motion-and-fitness-off, movement-emoji, isSimulatedBySoftware]
depends_on: [activity-emoji-coremotion, life360-notification-triggers]
source_tier: mixed              # heavy PRIMARY (pmd3 9.33.1 source read locally, Apple docs, maintainer statements, TrollStore/JB repos) + third-party (Life360 behavior, Android-tweak comparison)
recheck_if: [a jailbreak or TrollStore-class exploit reaches iOS 26.x, pymobiledevice3 adds a motion/sensor instrument, a public iOS CoreMotion-faking tweak appears, Life360 app update changes the emoji or its permission use]
---

# CoreMotion on a still phone — can we inject, override, or suppress motion so Life360 sees "driving"?

> Research brief. **Question:** on a personal, owned, non-jailbroken iPhone on **iOS 26.6**, Developer
> Mode on, DDI mounted via pymobiledevice3's userspace RemoteXPC tunnel from a **Windows** host — is
> there ANY software method to **inject, simulate, override, or suppress** the device's
> CoreMotion-derived motion data, such that **Life360** perceives "automotive/driving" while the phone
> lies physically still? Companion to and exhaustive backing for `activity-emoji-coremotion.md` §1/§4.
> Confidence marked; sources at end.
>
> **How to read confidence:** each claim carries a `[HIGH/MEDIUM/LOW]` tag for **source/reasoning
> strength** and is flagged **PRIMARY** (Apple docs, source code read directly, maintainer statements)
> or **THIRD-PARTY** (community/vendor/anecdote). A separate axis — *did we test it on our own phone* —
> is `device_verified: none` for everything below; the single testable-now lever (§7) is called out as
> an open gate, not a result.

## Bottom line (read this first)

**NO — motion injection is not reachable on this stack, and there is no path short of a jailbreak
that does not currently exist.** The question splits cleanly in two, and the useful nuance is in the split:

- **Inject / simulate / override CoreMotion → categorically NO.** `[HIGH · PRIMARY]` Nothing in the
  iOS developer/Instruments surface writes motion. The *only* sensor-override channel Apple ships over
  the DVT/Instruments protocol is `LocationSimulation` (GPS **latitude + longitude only**). CoreMotion
  (`CMMotionActivity` automotive/walking/**stationary**, `CMDeviceMotion`, raw accel/gyro, pedometer,
  barometer) is vended **per-process from the motion coprocessor** and is **read-only to every app** —
  it is not on the DVT bus, has no XCTest hook on a real device, and the iOS Simulator (the only place
  motion can be faked) is a macOS process that never touches a handset. Confirmed firsthand against the
  installed **pymobiledevice3 9.33.1** and corroborated by go-ios, libimobiledevice, Apple docs, and the
  pmd3 maintainer's own words.
- **Suppress CoreMotion's input to Life360 → YES, trivially — but whether it achieves the goal is
  UNKNOWN and is the one test worth running.** `[suppression: HIGH · PRIMARY][effect on emoji: MEDIUM ·
  inferred, not device-tested]` You cannot feed Life360 a fake "automotive," but you *can* deny it the
  real "stationary" one by turning **off the iOS Motion & Fitness permission** for Life360 — a Settings
  toggle, no code, no jailbreak. The bet: with no CoreMotion signal to contradict the (spoofed) GPS,
  Life360's **speed-derived** on-map movement emoji may fall back to GPS-only inference and show the car
  icon. This is the single most promising lever and it is **testable today** (§7). It might also do
  nothing (if the emoji hard-requires a positive `automotive`/`isDriving` classification). Not injection —
  *removal of the contradiction* — which is why it's the only no-jailbreak shot at the "driving on a
  still phone" outcome.

**What would have to change for injection to become possible:** BOTH (a) a jailbreak for iOS 26.6
(none exists; see §6) AND (b) a system-wide CoreMotion-faking tweak hooked into Life360's process
(never published for iOS — the technique exists only on Android). Either one alone is insufficient.

---

## §1 — The developer/DVT surface on THIS stack injects location, nothing else *(HIGH · PRIMARY)*

*(Answers sub-questions 1 & 5 — the full instrument/selector enumeration.)*

Read directly from the installed **`pymobiledevice3 9.33.1`** in this repo's `.venv`. The complete set
of DVT (DTX Instruments) services reachable through the mounted DDI over the RSD tunnel
(`com.apple.instruments.dtservicehub` on iOS 17+) — and every DTX selector each exposes — is:

| DVT service (`IDENTIFIER`) | What it does | Motion/sensor? |
|---|---|---|
| `…LocationSimulation` | `simulateLocationWithLatitude:longitude:`, `stopLocationSimulation` | **Location only** (2 floats) |
| `…ConditionInducer` | `availableConditionInducers`, `enableConditionWithIdentifier:profileIdentifier:`, `disableActiveCondition` | No — network/thermal (§2) |
| `…deviceinfo` | process list, hardware/kernel/network info, mach time | No |
| `…sysmontap` | per-process + system CPU/memory sampling | No |
| `…processcontrol` | launch/kill/signal processes | No |
| `…networking` | socket/interface traffic stats (read) | No |
| `…graphics.opengl` | GPU/FPS render counters | No |
| `…device.applictionListing` | enumerate installed apps *(Apple's real misspelling)* | No |
| `…activitytracetap` | unified-logging / os_signpost tap — **NOT `CMMotionActivity`** | No |
| `…coreprofilesessiontap` | kernel KDebug/ktrace stream + stackshots | No |
| `…mobilenotifications` | app lifecycle / memory-warning notifications | No |
| `…debug-gauge-data-providers.Energy` | Xcode energy-gauge sampling | No |
| `…screenshot` | device screenshot | No |
| `testmanaged/*` (`XCTestDriverInterface`, `XCTestManager_*`) | XCUITest orchestration | No (see §4) |

- **Not one service, class, or selector references** accelerometer, gyroscope, magnetometer, CMMotion /
  CMDeviceMotion, `CMMotionActivity`, pedometer/steps, barometer, or CMAltimeter. A full recursive
  keyword sweep of the entire pmd3 tree returns **zero** matches. `[HIGH · PRIMARY — local source read]`
- **False leads ruled out** (each looks motion-ish, none is): `activitytracetap` is os_signpost logging,
  a different "activity" from CoreMotion's. `configuration_service.set_reduce_motion` is the
  **accessibility display** setting (reduce UI animation), not a sensor. The XCTest
  `XCActivityRecord`/`willStartActivity` selectors are **test-step "activities."** And the
  `AccelerometerCapability`/`GyroscopeCapability`/`MagnetometerCapability` strings in `diagnostics.py`
  are **read-only MobileGestalt capability booleans** — "does this model *have* the sensor" — with no
  value and no write path. `[HIGH · PRIMARY]`
- **Architecture note:** pmd3 opens a channel by asking the device for it (`RequestChannelIdentifier`);
  there is no client-side allow-list. So the question isn't "did pmd3 implement a motion wrapper" but
  "does the device's Instruments daemon *advertise* a motion channel" — answered NO by two independent
  reimplementations (§5). `[HIGH · PRIMARY]`

## §2 — `condition_inducer` is Network-Link + Thermal only *(HIGH · PRIMARY, with an honest caveat)*

*(Answers sub-question 2.)*

- pmd3 hardcodes **no** profiles; it calls `availableConditionInducers` and the **device** returns the
  list at runtime. `[HIGH · PRIMARY — local source read]`
- The concrete identifiers that channel actually returns (from **go-ios**, which drives the identical
  Apple channel and documents them): a **`SlowNetworkCondition`** group (e.g. `SlowNetwork3GGood` — the
  Network Link Conditioner) and **`ThermalConditions`** (thermal pressure). These are Apple's Xcode
  "Device Conditions" (WWDC19 s.422). `[HIGH · PRIMARY (go-ios source) + THIRD-PARTY (WWDC)]`
- **No iOS version 17–26 is known to expose a motion/sensor/location condition profile.** `[MEDIUM ·
  absence-of-evidence]` — honest caveat: because profiles are device-supplied, a private/future profile
  *could* appear, but none touching motion is referenced by pmd3, go-ios, or Apple's condition docs. To
  close this to HIGH would take an on-device `availableConditionInducers` dump from our own 26.6 DDI.

## §3 — No speed/heading/motion selector on the location service either *(HIGH · PRIMARY)*

*(Sub-question 5, continued — is there a private CoreLocation/DTX selector beyond lat/lon?)*

- The DVT `LocationSimulation` service exposes exactly `simulateLocationWithLatitude:longitude:` +
  `stopLocationSimulation`. GPX "play" is just repeated `set(lat, lon)` on GPX time deltas — pmd3 reads
  only `point.latitude`/`point.longitude` and **discards `<ele>`/altitude**. `[HIGH · PRIMARY]`
- The maintainer has said so twice, verbatim. **pmd3 #340:** *"Unfortunately, Apple do not provide APIs
  for this. `DTSimulateLocation` only supports setting longtitude and latitude parameters."* **pmd3
  #1405:** *"The API doesn't provide any way to set them"* (altitude/speed). `[HIGH · PRIMARY —
  maintainer doronz88]` ⟹ iOS *derives* speed/course from our position deltas; we never set a motion
  vector, and there is no motion context rider on the location call.
- **Bonus, relevant to gate #0 (`isSimulatedBySoftware`):** pmd3 **Discussion #1747** reports that the
  DVT `simulate-location` path does **not** set `CLLocation.sourceInformation.isSimulatedBySoftware`
  true — only Core Location's *own* Xcode-GPX integration flips it. `[MEDIUM-HIGH · PRIMARY but an
  unreviewed author write-up]` This is consistent with our empirical result that the spoof already
  reflects on Life360, i.e. they do not hard-block on that flag today. (Tracked in
  `life360-detection-and-realism.md`; noted here only because the sweep surfaced it.)

## §4 — XCTest / XCUIDevice / CoreMotion / Simulator: no real-device motion, and nothing from Windows *(HIGH)*

*(Answers sub-questions 3 & 4.)*

- **CoreMotion is read-only.** `CMMotionActivity` and friends are *created by the system and handed to
  your handler* — "You don't create instances of this class yourself." No API anywhere accepts a motion
  object as input. `CMMotionManager`/`CMPedometer`/`CMAltimeter` are start-updates/query-only. `[HIGH ·
  PRIMARY — Apple docs]`
- **The iOS Simulator does not emulate motion at all** — Apple's own guide: *"Motion support
  (accelerometer and gyroscope) are unsupported"* (also barometer/proximity/ambient-light). Whatever it
  *can* fake (location, push, biometrics, permissions) exists **only inside the Mac process** and cannot
  reach a physical iPhone over USB. Historical "accelerometer injection" hacks (SimulatorEnhancements)
  fed the Simulator, not hardware. `[HIGH · PRIMARY (Apple) + THIRD-PARTY (the hacks)]`
- **XCTest/XCUIDevice has no motion API on a real device.** `XCUIDevice`'s entire surface is
  `orientation` + hardware-button `press` + `siriService` + `location` — no accelerometer/gyro/shake/
  CoreMotion. Setting `.orientation` rotates the UI; it does not feed `CMDeviceMotion`. Appium's `shake`
  is **Simulator-only** (AppleScript) — direct corroboration that XCTest exposes no on-device motion
  injection. Apps reading Core Motion under a real-device UI test get **real hardware data**. `[HIGH ·
  PRIMARY + THIRD-PARTY (Appium)]`
- **Xcode "Simulate Location" (GPX) populates CLLocation only** (lat/lon; course via the test proxy),
  never CoreMotion. `[HIGH · PRIMARY]`
- **No Instruments "record & replay" of sensors reaches a real device.** The taps that exist
  (`coreprofilesessiontap`, `activitytracetap`, `sysmontap`, energy/graphics) are **read-only
  telemetry**; none injects. `[HIGH · PRIMARY]`
- **Windows reachability:** moot regardless — even the (nonexistent) on-device motion path would need an
  **Xcode-built, code-signed XCTest runner** deployed from a Mac, and the Simulator is macOS-only. From
  Windows, the only host-driven channel on non-JB iOS 17+ is DVT `LocationSimulation` (lat/lon). `[HIGH ·
  PRIMARY]`

## §5 — Why it's a hard wall: CoreMotion's architecture *(HIGH)*

- `CMMotionActivity` (stationary / walking / running / **automotive** / cycling + confidence) is
  computed on the **motion coprocessor / Always-On Processor** (folded into the SoC since A12) from the
  inertial sensors, at near-zero power, "whether or not your app is running," and **GPS-independent**. A
  phone lying still classifies **stationary** no matter what the spoofed GPS says. `[HIGH · PRIMARY
  (Apple) + THIRD-PARTY (NSHipster)]` *(Correction to an earlier assumption: this is the AOP/motion
  coprocessor, NOT the Secure Enclave — do not attribute CoreMotion to the SEP.)*
- Each app is a **client** of a system-vended source (Apple: multiple `CMMotionManager` instances "affect
  the rate at which **the system** receives data"). Making a *specific* app read a fake value therefore
  requires intercepting that per-process vend **inside that app's address space** — i.e., code injection,
  not a host command. `[HIGH · PRIMARY reasoning]` *(The backing daemon's exact name is unconfirmed by
  public sources — do not assert `coremotiond`; the client/XPC model is well-supported by analogy to
  `locationd`.)* `[LOW on the name]`

## §6 — Jailbreak / TrollStore / sideload reality on iOS 26.6 *(HIGH · PRIMARY, adversarially verified)*

*(Answers sub-question 6.)*

- **TrollStore caps at iOS 17.0.** README verbatim: *"Supported versions: 14.0 beta 2 - 16.6.1, 16.7 RC,
  17.0"* and *"17.0.1+ will NEVER be supported (unless a third CoreTrust bug is discovered)."* The enabler
  (CoreTrust **CVE-2023-41991**) was patched in 16.7 / 17.0.1. **26.6 is permanently out of range.**
  `[HIGH · PRIMARY]`
- **No public jailbreak for iOS 26.x — or even 18.x — on A12+.** palera1n/checkra1n are checkm8/**A8–A11
  hardware only**; Dopamine's arm64e ceiling is **16.5.1**; NathanLR (highest arm64e software JB) stops at
  **17.0**; canijailbreak's highest "yes" is 16.6. iClarified (2026): *"there is no public jailbreak
  available for iOS 18 or iOS 26 on modern iPhones."* The June-2026 **`usbliter8`** A12/A13 bootrom
  primitive is, by its own author, **not a jailbreak** (no kernel R/W, no SPTM/PPL/PAC bypass) and does
  not reach 18/26 — worth *tracking*, changes nothing today. `[HIGH · PRIMARY (repos) + THIRD-PARTY
  (trackers)]`
- **Even WITH a jailbreak, injection needs a tweak that does not exist for iOS.** Faking CoreMotion for
  *another* app means a system-wide code-injection tweak (Substrate/ElleKit) hooking
  `CMMotionActivityManager` inside Life360's process — exactly how location-faking tweaks work
  (`LocationFaker` = `%hook CLLocation`). The technique is plausible, but **no CoreMotion/CMMotionActivity
  spoofing tweak has ever been published for iOS**; system-wide sensor spoofers exist **only on Android**
  (Xposed/Frida: MotionEmulator, VirtualSensor, PriviSense). iOS step-fakers were scoped to HealthKit, not
  a general vend. `[MEDIUM-HIGH · absence-of-evidence, survived a dedicated refutation pass]` *(Two tweak
  names from the working hypothesis — "SensorOverride"/"MotionFake" — do not exist; they were fabricated.
  Ignore them.)*
- **Sideloading cannot do it.** A sideloaded app (AltStore/SideStore, even the EU DMA marketplaces) is a
  normal **sandboxed** app: no cross-app reach, gated by `task_for_pid` + `get-task-allow` — which only
  opens *your own* re-signed binary, never an installed App Store app (distribution strips
  `get-task-allow`, and you can't even decrypt Life360's FairPlay binary to re-sign it without a JB). The
  most sensor-privileged entitlement, `com.apple.developer.sensorkit.reader.allow`, is **read-only** and
  research-gated. **Faking motion for *your own* app is possible; making *Life360* read it is
  jailbreak-class.** `[HIGH · PRIMARY — Apple Platform Security, TN2415]`

## §7 — The one reachable lever: SUPPRESS via Motion & Fitness OFF *(suppression HIGH · effect MEDIUM, UNTESTED)*

*(Answers sub-question 7 — and reframes the whole question toward the achievable.)*

You cannot inject "automotive." But the working hypothesis for why the car emoji won't hold is a
**contradiction**: spoofed GPS says "moving," CoreMotion says `stationary`, and Life360 resolves it
against us. You do not need to *fake* the motion signal — you may only need to **remove** it, so there is
no contradiction and Life360's speed-derived emoji is free to follow the GPS.

- **Life360's on-map movement emoji is speed-derived.** Its "Movement Icons" doc defines every icon by an
  mph band (walk 0–4, bike 0–7, **drive 0–50**) and includes flying/boating icons that *cannot* be
  accelerometer-based. First-hand inspection of Life360's server data (the Home Assistant integration
  author) found **no movement-type field is sent — walk/drive is inferred client-side from GPS speed.**
  `[MEDIUM-HIGH · PRIMARY (Life360 doc, snippet) + FORUM first-hand]`
- **Motion & Fitness is bound to the *other* subsystem.** Life360's legal/permission text ties motion
  (gyro/accel/compass → **Arity**) to **Driving Analytics / Drive Detection / Crash Detection** — and iOS
  Crash Detection *explicitly requires* Motion & Fitness. That is the CoreMotion-fused product (out of
  scope), distinct from the on-map emoji. So turning Motion & Fitness OFF costs the geofence-arrival goal
  **nothing** (arrivals are pure location) and only disables features we already can't fake. `[HIGH ·
  PRIMARY (Life360 legal/support, snippet-level)]`
- **The wrinkle that keeps this from being a slam-dunk:** Life360's API also carries an **`isDriving`
  flag that is *separate* from raw speed and can disagree with it** (observed `speed≈71, driving=false`).
  If the on-map emoji consults that flag (which may be the Arity/CoreMotion-derived signal) rather than
  pure speed, then a still phone yields `driving=false` and the car icon stays suppressed **even with
  Motion & Fitness off**. No source resolves whether the *display emoji* uses speed alone or also this
  flag. `[MEDIUM · first-hand forum, interpretation open]`
- **Net:** suppression is free and no-jailbreak; whether it *produces the car emoji* is genuinely unknown
  and splits on the above. It is the only lever with a plausible YES, so it is worth one deliberate test.

### Concrete on-device test (do this — it closes the gate)

Route `data/routes/emoji-test.json` was built for exactly this (steady ~35 mph, >1.5 mi, ~10 min, no
trailing stop — clears Life360's ½-mi / 850 m / ~5-min activity gates without tripping the 80-mph
speeding flag). Run it **twice**, changing only the permission, and watch the member's icon + mph:

1. **Trial A — Motion & Fitness ON.** `spoof.cmd emoji-test`. Record: does the car emoji appear? Does it
   *hold* through the run, or flash then die?
2. **Trial B — Motion & Fitness OFF** (iOS Settings → Life360 → Motion & Fitness → off). Same route.
   Record the same.

Interpretation:
- **Car emoji appears with OFF (esp. if it did *not* with ON) ⟹ removing the contradiction works ⟹**
  GPS-only fallback confirmed ⟹ **movement-emoji gate = YES via suppression.** Bake "advise Motion &
  Fitness off" into the emoji-driving preset and flip `activity-emoji-coremotion.md` to
  `device_verified: partial → yes`.
- **No car emoji in *either* trial ⟹** the display emoji consults a positive motion/`isDriving`
  classification a still phone can't produce ⟹ **hard wall confirmed** ⟹ gate = NO. Accept it, drop the
  driving-emoji ambition, and keep the geofence "arrived at CDG" as the north star (unaffected).
- Cross-check: does **Find My** motion/speed behave differently from Life360 in either trial? (Isolates
  Life360-app logic from the OS location feed.)

Precondition already effectively met: gate #0 (`isSimulatedBySoftware`) isn't blocking — the spoof
reflects on Life360 today, and §3 shows the DVT path doesn't set that flag.

---

## Verdict (definitive)

**Is motion injection reachable on THIS stack (owned, non-JB iOS 26.6, pmd3 userspace tunnel, Windows)?
No — with HIGH confidence, from primary sources.** There is no developer, DVT/DTX, XCTest, or Simulator
mechanism that injects, simulates, or overrides CoreMotion on a real device; the only host-reachable
sensor channel is GPS lat/lon. CoreMotion is a read-only, per-process, coprocessor-vended signal, so a
physically still phone reports `stationary` and there is no software seam — on this OS version — to change
what Life360 reads.

**The only path that could yield the "driving on a still phone" *outcome* without a jailbreak is
suppression, not injection** (§7): turn off Life360's Motion & Fitness permission and bet that its
speed-derived emoji falls back to GPS-only. That is **testable today** and is the recommended next action;
it may work or may hit the `isDriving`-flag wall.

**For true injection to become possible, BOTH would have to change:** a jailbreak lands for iOS 26.6
(none exists; the whole A12+ line tops out at iOS 17.0), AND someone ships a system-wide CoreMotion-faking
tweak for iOS (never done — the technique lives only on Android). Absent both, the still-phone
"automotive" contradiction is a **hard architectural wall, not an engineering gap.**

## Implications for vida-360

1. **Stop looking for a motion-injection API — there isn't one, and this brief is the exhaustive proof.**
   Don't re-litigate it unless `recheck_if` fires.
2. **Run the §7 A/B test.** It is cheap, decides the driving-emoji feature outright, and needs only the
   already-built `emoji-test.json`. It is the highest-value on-device action left for the activity goal.
3. **The geofence "arrived at CDG" north star is untouched by all of this** — it's pure location, needs
   no motion, and is unaffected by the Motion & Fitness toggle. Keep it primary.
4. **Track `usbliter8`** as the sole live development in the JB space (A12/A13 bootrom primitive) — not
   actionable now, but it's the thing that could, someday, reopen (a) above.

## Sources

**Primary — read directly / Apple / maintainers (bold):**
- **pmd3 9.33.1 source (read locally in `.venv`):** `services/dvt/instruments/{location_simulation,location_simulation_base,condition_inducer,dvt_provider}.py`, `services/diagnostics.py` (MobileGestalt capability keys), full `@dtx_method`/`IDENTIFIER` sweep. Upstream: https://github.com/doronz88/pymobiledevice3/tree/master/pymobiledevice3/services/dvt/instruments
- **pmd3 maintainer statements:** #340 https://github.com/doronz88/pymobiledevice3/issues/340 · #1405 https://github.com/doronz88/pymobiledevice3/issues/1405 · Discussion #1747 (isSimulatedBySoftware) https://github.com/doronz88/pymobiledevice3/discussions/1747
- **go-ios** (identical Instruments channels; ConditionInducer identifiers): https://github.com/danielpaulus/go-ios/blob/main/ios/instruments/instruments_channels.go · https://github.com/danielpaulus/go-ios/blob/main/ios/instruments/devicestate.go
- **libimobiledevice** (no DVT layer at all): https://github.com/libimobiledevice/libimobiledevice · issue #149 https://github.com/libimobiledevice/libimobiledevice/issues/149
- **Apple CoreMotion** (read-only, system-created): https://developer.apple.com/documentation/coremotion/cmmotionactivity · …/cmmotionactivitymanager · …/cmmotionmanager · framework: https://developer.apple.com/documentation/coremotion/
- **Apple Simulator "motion unsupported":** https://developer.apple.com/library/archive/documentation/IDEs/Conceptual/iOS_Simulator_Guide/TestingontheiOSSimulator/TestingontheiOSSimulator.html · https://developer.apple.com/documentation/xcode/testing-in-simulator-versus-testing-on-hardware-devices
- **Apple XCUIDevice / test location:** https://developer.apple.com/documentation/xctest/xcuidevice · …/xcuidevice/4111083-location · https://developer.apple.com/documentation/xcode/simulating-location-in-tests
- **Apple Platform Security (sandbox) / TN2415 (entitlements) / SensorKit / DMA:** https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web · https://developer.apple.com/library/archive/technotes/tn2415/_index.html · https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.sensorkit.reader.allow · https://developer.apple.com/support/dma-and-apps-in-the-eu/
- **TrollStore README (version ceiling):** https://raw.githubusercontent.com/opa334/TrollStore/main/README.md · CVE-2023-41991 https://cvefeed.io/vuln/detail/CVE-2023-41991
- **Jailbreak ceilings:** https://github.com/palera1n/palera1n · https://github.com/opa334/Dopamine · https://www.nathanlr.com/ · https://canijailbreak.com/ · **usbliter8** https://github.com/prdgmshift/usbliter8 · https://ps.tc/pages/blog-usbliter8.html
- **LocationFaker tweak mechanism (`%hook CLLocation`):** https://github.com/JonathanSeals/locationfaker/blob/master/Tweak.m

**Third-party / vendor / forum (explicitly not primary):**
- CoreMotion coprocessor + read-only overview: https://nshipster.com/cmmotionactivity/ · https://en.wikipedia.org/wiki/Apple_motion_coprocessors
- Simulator faking is Mac-side only: https://saagarjha.com/blog/2019/01/11/mocking-capabilities-in-the-ios-simulator/ · https://github.com/ColinEberhardt/SimulatorEnhancements
- Appium shake = Simulator-only: https://appium.github.io/appium.io/docs/en/commands/device/interactions/shake/ · https://github.com/appium/appium/issues/13537
- iClarified jailbreak status (2026): https://www.iclarified.com/jailbreak
- Android-only system-wide sensor spoofers (proof the concept exists off-iOS): https://github.com/zhufucdev/MotionEmulator · https://github.com/frazew/VirtualSensor
- iOS pentest / no-JB limits (task_for_pid, FairPlay): https://www.anvilsecure.com/blog/locked-up-but-not-locked-out-ios-app-pentesting-without-jailbreak.html · OWASP MASTG-TECH-0090/0091
- **Life360 (official, snippet-level — pages 403 to fetchers):** Movement Icons https://support.life360.com/hc/en-us/articles/23053397194903-Movement-Icons · Movement Accuracy https://support.life360.com/hc/en-us/articles/23053466420887-Movement-Accuracy · Driving Analytics (motion→Arity) https://legal.corp.life360.com/hc/en-us/articles/16044058241559-Driving-Analytics-Services · iOS Crash Detection needs Motion & Fitness https://support.life360.com/hc/en-us/articles/23053578720791-Crash-Detection-Troubleshooting-iOS
- **Life360 (first-hand forum — server data model):** no movement-type field, client infers from speed https://community.home-assistant.io/t/life360-walking-addition/596976 · `isDriving` separate from speed https://community.home-assistant.io/t/get-life360-to-show-driving/133428
