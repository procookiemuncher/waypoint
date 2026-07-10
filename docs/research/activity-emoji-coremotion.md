---
title: Activity emoji vs. CoreMotion — is the walking/driving indicator spoofable?
status: research                # research | device-verified | superseded
last_verified: 2026-07-10
device_verified: full            # on-device, both legs, Observer-instrumented (2026-07-10): Motion & Fitness ON vs OFF made NO difference - speed/isDriving never triggered in either. The Motion&Fitness-OFF fallback hypothesis is REFUTED; suspect server-side position-update cadence (not the permission) is the real gate. See update block below.
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

**The on-map movement emoji does NOT reliably trigger on a physically-still spoofed phone
(MEDIUM-HIGH confidence, two-leg on-device test, 2026-07-10). The formal "Driving" analytics
product is NOT spoofable (HIGH confidence).** The Motion & Fitness permission toggle — the one
lever this brief flagged as promising — made **no measurable difference**; see the on-device
update below for what actually looks like the real gate.

> **On-device update (2026-07-09, `device_verified: partial`).** Owner ran a sustained ~18 mph
> spoof (`miami-cruise`) on a physically still phone: the car emoji + mph would **not reliably
> show/hold**. Same day, a *real* drive showed the car emoji fine **even at slow speed**. This is
> the two-subsystem split in action: a real drive is classified `automotive` by CoreMotion and the
> icon holds through slow patches (motion-derived), while a still-phone spoof produces a
> **contradiction** — GPS says "moving," the accelerometer says `stationary` — and Life360
> suppresses the emoji. (Consistent with §3's note that the icon can disagree with GPS.) The
> earlier "one on-device test confirms it" refers to the initial `miami-demo` **teleport** briefly
> flashing the car emoji — the speed-derived path *can* fire, but the "stationary" vote wins over a
> sustained still-phone drive. **Verdict not yet flipped to NO:** the decisive test is whether
> turning Life360's **Motion & Fitness permission OFF** forces GPS-only activity inference (the §
> "Cheapest on-device experiment" sub-test). Route `data/routes/emoji-test.json` (steady ~35 mph,
> >1.5 mi, ~10 min, no trailing stop) was built for exactly this; run it with the permission ON
> then OFF.

> **On-device update — BOTH legs complete (2026-07-10, Observer-instrumented; analyzed by Claude
> Sonnet 5).** Owner ran `spoof.cmd emoji-test` (steady ~35 mph, no trailing stop) twice — once
> with Motion & Fitness **OFF**, once **ON** — each with `tools/observe.py --watch --log` recording
> server-side truth throughout, compared via `tools/correlate.py`:
>
> | | Motion & Fitness OFF | Motion & Fitness ON |
> |---|---|---|
> | Route span captured | ~12 min (306 samples) | ~19 min (376 samples) |
> | `speed_raw` ever nonzero | never (0/-1 only) | never (0/-1 only) |
> | `isDriving` ever TRUE | never | never |
> | Distinct server updates | 12 | 15 |
> | Update interval (min/med/max) | 61s / 63s / 952s | 62s / 75s / 715s |
>
> **Result: the two legs are statistically indistinguishable.** Toggling Motion & Fitness made
> **no difference** — refuting the "OFF unlocks GPS-only speed/driving inference" hypothesis this
> brief originally proposed as the decisive lever. Both runs confirm the pin genuinely moved the
> full route (so the spoof + engine worked correctly); Life360's server simply never computed a
> nonzero speed or drive classification in either condition.
>
> **New leading hypothesis: it's the server-side position-update cadence, not the permission.**
> Both runs show Life360 only recording a new position every ~60-75s (median) — far too sparse to
> derive a meaningful speed or clear the ½-mi/15-mph/850m Drive Detection gates in any single
> interval. That cadence is plausibly itself downstream of CoreMotion reporting `stationary` (a
> still phone), i.e. **the accelerometer contradiction may be throttling how often Life360's
> background location manager even uploads**, independent of whether Motion & Fitness has read
> access. This is reasoned from the data, not yet directly confirmed — untested next step would be
> checking whether a *longer* sustained run (30+ min) ever produces a burst of tighter-interval
> updates, or whether the cadence is a fixed server-side poll unrelated to motion state at all.

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

> **Exhaustive backing (2026-07-09):** this claim is now proven from primary sources —
> `coremotion-injection-feasibility.md` enumerates the *entire* pmd3 9.33.1 DVT/DTX surface (read
> locally), the XCTest/Simulator boundary, and the jailbreak/TrollStore reality on iOS 26.6. It also
> reframes the goal: injection is impossible, but **suppressing** Life360's Motion & Fitness input
> (a Settings toggle) is the one no-jailbreak lever that could let the speed-derived emoji show —
> the decisive open gate, with the A/B test spelled out there.

## Cheapest on-device experiment (Phase A)

Run **one long, believable constant-speed drive** and watch the member's icon in Life360:
- GPX at a steady **~30–45 mph** (above the ~15 mph walk/drive split, below the 80 mph speeding
  flag), covering **≥ 1 mile**, lasting **≥ 5 min** (clears the ½-mi / 850 m / ~5-min gates),
  1 point/sec, small ±timing jitter via `simulate-location play <gpx> 500`.
- **Car emoji appears ⟹ speed-derived ⟹ spoofable.** Stays walking/stationary ⟹ motion-gated ⟹
  not reachable on a still phone.
- ~~Cheap extra sub-test: repeat with **Motion & Fitness permission OFF**~~ — **DONE, REFUTED
  (2026-07-10):** ran both ON and OFF, Observer-instrumented; no difference in speed/isDriving
  either way (see the on-device update in the Verdict section above). The permission is not the
  gate.
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
