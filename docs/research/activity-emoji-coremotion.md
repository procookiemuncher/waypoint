---
title: Activity emoji vs. CoreMotion — is the walking/driving indicator spoofable?
status: research                # research | device-verified | superseded
last_verified: 2026-07-08
device_verified: none           # the long-drive emoji test (Phase A #1) has NOT been run
open_gates: [movement-emoji, isSimulatedBySoftware]
depends_on: [life360-detection-and-realism]
source_tier: mixed              # primary (Apple CoreMotion / pmd3 source) + Life360 vendor + one third-party
recheck_if: [Life360 app update, iOS point release]
---

# Activity emoji vs. CoreMotion — is the walking/driving indicator spoofable?

> Research brief. Question: is Life360's per-member walking/driving activity emoji derived from
> GPS or from CoreMotion (accelerometer + motion coprocessor), and can we trigger it with a
> **physically stationary** phone whose GPS we drive via pmd3? Confidence marked; sources at end.

## Verdict

**The on-map movement emoji is LIKELY spoofable (MEDIUM confidence) — one on-device test
confirms it. The formal "Driving" analytics product is NOT spoofable (HIGH confidence).** These
are two different Life360 subsystems, and conflating them is the trap.

## 1. CoreMotion is motion-hardware based and GPS-independent  *(HIGH)*

`CMMotionActivity` (stationary/walking/running/automotive/cycling + confidence) is vended by the
motion coprocessor from **accelerometer + gyroscope + magnetometer** (and `CMPedometer` steps),
fused at near-zero power and **deliberately GPS-independent** (NSHipster: location "should only
be consulted if absolutely necessary"). A phone lying still reads **stationary** no matter what
GPS says. There is **no** Apple-sanctioned way to inject synthetic motion/`CMMotionActivity`
into a real device without a jailbreak — the motion coprocessor is not on the DVT bus. (The iOS
*Simulator* can fake motion, but that's a Mac process, not a real handset.)

## 2. Simulated location and CLLocation.speed  *(mechanism HIGH; on-device value MEDIUM)*

- The DTX selector is literally `simulateLocationWithLatitude:longitude:` — **lat/lon only**, no
  speed/heading/altitude (pmd3 issue #340; libimobiledevice #1370 says the same). ⟹ iOS derives
  speed/course from the position deltas *we* emit.
- pmd3's `play_gpx_file` replays those lat/lon points on a timer (`asyncio.sleep(Δt)` between
  `set()` calls, Δt from the GPX `<time>` deltas, plus an optional `timing_randomness_range`
  ±ms). So **our point spacing is the speed signal.**
- Caveat: reports of `CLLocation.speed == -1` cluster around the **Mac Simulator**, not physical
  devices. Whether a real device reports a positive `.speed` vs `-1` under simulation is
  genuinely **untested here** — but the movement emoji may not need `.speed` at all (Life360 can
  difference successive fixes itself). Our own PROGRESS.md already shows `play` producing motion
  on-device.

## 3. Two Life360 subsystems  *(A: MEDIUM-HIGH; B: HIGH)*

**(A) On-map movement icon (the emoji you want) — appears speed/location-derived.** Life360's
own "Movement Icons" page defines icons purely by **speed** (walk 0–4 mph, bike 0–7, drive
0–50) and the set includes **flying** and **boating** icons — which **cannot** come from an
accelerometer and must be inferred from speed + location context. Strong circumstantial evidence
this layer is location/speed-driven. A third-party writeup: "Life360 differentiates driving from
walking by studying the speed."

**(B) "Driving" analytics (drive reports, hard-braking, crash) — genuinely CoreMotion+GPS
fusion.** Life360's privacy policy: it collects "gyroscope, accelerometer, compass" motion data
to classify "cycling, walking, running or driving," shared with Arity; on iOS this needs the
**Motion & Fitness** permission. Drive Detection also gates on ≥ ½ mi / > 15 mph / > 850 m.

**So:** the live emoji is likely **(A) speed-derived → reachable**; drive *reports* are **(B)
accelerometer-fused → not reachable** on a still phone. The two can disagree (Life360 itself
notes the icon can show "walking" during a real drive).

## 4. No no-jailbreak path to inject motion  *(HIGH)*

pmd3/DVT exposes location simulation only (DeepWiki: "location simulation is the only
environmental simulation capability"). Xcode/Instruments/XCTest simulate **location**, not
motion, on real devices. Confirmed dead end for the accelerometer.

## Cheapest on-device experiment (Phase A)

Run **one long, believable constant-speed drive** and watch the member's icon in Life360:
- GPX at a steady **~30–45 mph** (above the ~15 mph walk/drive split, below the 80 mph speeding
  flag), covering **≥ 1 mile**, lasting **≥ 5 min** (clears the ½-mi / 850 m / ~5-min gates),
  1 point/sec, small ±timing jitter via `simulate-location play <gpx> 500`.
- **Car emoji appears ⟹ speed-derived ⟹ spoofable.** Stays walking/stationary ⟹ motion-gated ⟹
  not reachable on a still phone.
- Cheap extra sub-test: repeat with **Motion & Fitness permission OFF** — it may make Life360
  fall back to GPS-only activity (paradoxically *helping* a still-phone spoof by removing the
  contradicting "stationary" signal). *(LOW confidence hypothesis — worth the free check.)*
- Prior test phases of 10–15 s were almost certainly **too short**; duration/thresholds are
  first-class parameters here.

## Implications for vida-360

1. **Reframe the goal:** target the **movement emoji** (speed-derived); explicitly drop drive
   *reports* / hard-braking / crash / "unsafe driving" (Arity/CoreMotion, unreachable).
2. **No new API needed** — it's all realistic per-second point spacing + sustained duration.
3. **Duration & distance gates are first-class** route parameters (hold each mode for *minutes*,
   clear ½ mi / 850 m).
4. **CoreMotion is a hard wall, not a bug to fix** — this honestly bounds the product.

## Suggested roadmap items

- **[Phase A]** The long constant-speed drive test above → record result, flip the AGENTS.md
  "activity emoji: spoofable?" line from UNKNOWN to YES/NO.
- **[Engine]** `speed_profile` per segment (walk ~3 / drive ~30–45 mph / stop 0) with a
  configurable **minimum dwell per mode** (default ≥ 5 min for "drive") and distance-gate
  awareness (≥ ½ mi / ≥ 850 m).
- **[Docs]** Keep an explicit "Not supported: Life360 driver reports / hard-braking / crash"
  note so the CoreMotion limit isn't re-litigated.

## Sources

- CMMotionActivity: https://developer.apple.com/documentation/coremotion/cmmotionactivity · https://nshipster.com/cmmotionactivity/
- Core Motion framework: https://developer.apple.com/documentation/coremotion/
- Simulator reports accel (0,0,0); real device needed: https://blog.scottlogic.com/2014/03/19/simulator-enhancements.html · https://github.com/ColinEberhardt/SimulatorEnhancements
- pmd3 location simulation source (lat/lon only, GPX timer replay): https://github.com/doronz88/pymobiledevice3/blob/master/pymobiledevice3/services/dvt/instruments/location_simulation.py · https://github.com/doronz88/pymobiledevice3/blob/master/pymobiledevice3/services/dvt/instruments/location_simulation_base.py
- pmd3 #340 (no speed/heading API) · libimobiledevice #1370 (speed "not possible"): https://github.com/doronz88/pymobiledevice3/issues/340 · https://github.com/libimobiledevice/libimobiledevice/issues/1370
- pmd3 location is the only env-sim: https://deepwiki.com/doronz88/pymobiledevice3/11.2-developer-and-instrumentation-commands
- Speed from GPX timing / Simulator speed = -1: https://blog.ricardopereira.eu/2024/03/13/EN-simulate-driving-custom-route-ios/ · https://www.avanderlee.com/workflow/location-simulation-xcode-simulator/
- Life360 Movement Icons (speed thresholds; flying/boating): https://support.life360.com/hc/en-us/articles/23053397194903-Movement-Icons
- Life360 Driving Analytics (gyro/accel/compass → Arity) · Permission Settings (Motion & Fitness): https://legal.corp.life360.com/hc/en-us/articles/16044058241559-Driving-Analytics-Services · https://support.life360.com/hc/en-us/articles/23053398402839-Life360-Permission-Settings
- Drive Detection (½ mi / 15 mph / 850 m): https://support.life360.com/hc/en-us/articles/23053499870487-Drive-Detection-Analysis
- "differentiates by speed" (third-party): https://smarttechville.com/life360-shows-walking-instead-of-drivin/
- Stationary sim ⇒ app sees standing still (third-party): https://www.imobie.com/location-change/xcode-simulator-location-guide.htm
