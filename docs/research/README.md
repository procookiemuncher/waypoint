# Research index

> External research feeding vida-360's design. Each file is a cited, confidence-marked brief.
> The researcher owns these; findings that change the plan get pushed into ROADMAP.md /
> AGENTS.md the same session (ground rule #3). Read alongside **../MOVEMENT_ENGINE.md** (design)
> and **../BUILD_PLAN.md** (build status).

## Docs

| Doc | Topic |
|---|---|
| [life360-detection-and-realism.md](life360-detection-and-realism.md) | How Life360 consumes/validates location on iOS, what it can detect, and concrete realism rules (speeds, jitter, dwell, cadence). |
| [activity-emoji-coremotion.md](activity-emoji-coremotion.md) | Is the walking/driving activity emoji GPS- or CoreMotion-derived? Can we trigger it with a stationary phone? |
| [spoof-methods-survey.md](spoof-methods-survey.md) | Every way to set an iPhone's location, judged against our no-jailbreak / Windows / owned-device constraints. |
| [behavioral-engine-prior-art.md](behavioral-engine-prior-art.md) | Prior art for generating realistic human GPS trajectories — models, OSS code, and a design for a "life-simulation" engine. |
| [valhalla-road-snapping.md](valhalla-road-snapping.md) | How to snap waypoints to roads and get per-edge speed via Valhalla — unblocks the movement engine's Increment 2 (build-time road-snapping). |

---

## TL;DR — the findings that change the plan

1. **⚠ DECISIVE UNKNOWN — the `isSimulatedBySoftware` flag.** iOS 15+ exposes
   `CLLocation.sourceInformation.isSimulatedBySoftware`. Xcode's GPX-debugger simulation sets
   it **`true`**; third-party "external location provider" spoofer apps read **`false`**. Our
   stack drives `DVTSimulateLocation` — the *same* DVT/Instruments service Xcode's "Simulate
   Location" panel uses — so it may well set the flag `true`, which any app (Life360 included)
   could read in one line and reject the fix. **No source resolves this for the tunnel path.**
   If it reads `true`, movement realism is largely moot. → **New Phase A gate #0: test this
   first** (a ~20-line app logging `location.sourceInformation?.isSimulatedBySoftware` while
   pmd3 drives location). *(Confidence: HIGH the flag exists and Xcode sets it; the tunnel-path
   behavior is a genuine UNKNOWN.)*

2. **The "activity emoji" is two different systems — reframe the goal.** Life360's on-map
   **movement icon** (walk/bike/drive, plus *flying* and *boating* icons that can't be
   accelerometer-derived) is defined by **speed thresholds** → **likely GPS-spoofable.** But
   Life360's **driving analytics** (Drive Detection, Crash Detection, weekly hard-braking
   reports) are **Arity CoreMotion** accelerometer/gyro fusion → **not** reproducible on a
   physically-still phone. Target the *emoji*; drop any ambition around drive *reports*.
   *(Confidence: MEDIUM-HIGH; still gated by the Phase A long-drive test.)*

3. **The airport auto-"landed" push is probably out of reach; a plain arrival is not.** Life360
   Flight Detection keys the "landed" notification off **altitude + airborne speed + a
   network-reconnect after landing** — none of which a lat/lon-only ground simulation produces.
   A normal geofence **arrival** into the airport area is still reachable. Adjust the north-star
   wording accordingly. *(Confidence: MEDIUM-HIGH.)*

4. **Transport choice is validated — don't switch.** pymobiledevice3 is the reference
   implementation of the *only* no-jailbreak iOS 17+ mechanism (Developer Mode + personalized
   DDI + DVT LocationSimulation over the RemoteXPC tunnel). Every serious tool — commercial
   apps included — rides the same rails. **go-ios** is the sole real peer → **WATCH** (fallback
   if pmd3 ever breaks), but it needs `wintun`/elevation and lacks our `--userspace` no-admin
   edge. Everything else is REJECT (see the survey). *(Confidence: HIGH.)*

5. **No untethered/persistent spoofing exists without a jailbreak.** The commercial "location
   stays after you disconnect" is a frozen *stale dot* (`cantfix` API artifact), and iOS 18+
   clears even that within minutes. Our long-lived-session model (Phase C) is the right call;
   don't promise background/no-tether.

6. **IP geolocation is the one silent server-side contradiction.** Life360 infers coarse
   location from IP. Your phone's real Wi-Fi/cellular IP geolocates to your actual metro — a
   distant GPS pin is a *potential* tell (no evidence Life360 acts on it, but cheap to respect:
   keep test spoofs off home Wi-Fi and, where practical, within a plausible radius of the real
   network).

7. **A whole new engine is worth building: the behavioral / life-simulation engine.** The
   research literature already gives a proven recipe (EPR / TimeGeo for *where & when* a person
   is; Valhalla `trace_attributes` for per-edge speed; a Pokémon-Go bot's step model for
   per-point jitter). There's even a near-exact open-source analog on our stack
   (`locwarp` — Windows + pymobiledevice3). See the behavioral doc; added to the roadmap.

---

## Candidate engines (the brainstorm) — what we could add beyond the movement engine

| Engine | What it does | Verdict |
|---|---|---|
| **Behavioral / life-simulation** | Above the movement engine: an EPR/TimeGeo "day planner" that decides where/when a person is over hours/days (home→work→errand→home, believable dwell + rhythm), then hands legs to the movement engine to render. | **Roadmap it** (new M-item). Biggest new idea. |
| **Jitter / GPS-noise** | Realistic positional noise: perpendicular lateral jitter, ~5 m open-sky σ (Rayleigh radial), worse in "urban", warm-up error. Must never manufacture speed. | **Upgrade** — the renderer already has bounded random-walk jitter; port the Pokémon-Go `step_walker` model + specific σ values. |
| **Speed/timing profiler** | Per-edge speeds from Valhalla `trace_attributes`, jerk-limited accel/decel (≤~2 m/s², jerk ≤~2 m/s³), zero-speed dwell between mode changes. | **Fold into movement engine** (Increment 2–3). Concrete constants in the Life360 & behavioral docs. |
| **Geofence / arrival tuner** | Ensure arrivals actually fire: dwell ≥ 2–5 min inside the ~100 m Place radius; model entry not a blip. | **Small, needed** for the north-star arrival. |
| **Detection self-test harness** | A diagnostic "engine": probe `isSimulatedBySoftware`, run the emoji test, run the flight-gap test — turn Phase A into a repeatable check. | **Build with Phase A.** |
| **Live-control / joystick** | Hold the DVT session open, `set()` on a ~1 s timer, interactive steer/pause/resume/reroute. | **Phase C** (already parked). |
| **Record-and-replay** | Import a real GPX (self-recorded or an OSM `identifiable` trace) and replay it — authentic pacing/jitter for free. | **Cheap win** — good realism baseline + regression corpus. |

## Candidate spoof methods — verdicts (details in the survey)

- **KEEP:** pymobiledevice3 `--userspace` + DDI + `set`/`play` (what we run).
- **WATCH:** **go-ios** (only true peer; fallback if pmd3 breaks). Lower priority: `idevice` (Rust; Windows unproven).
- **REJECT:** libimobiledevice/`idevicesetlocation` (can't reach iOS 17+ services), Appium (heavy, no routes, depends on pmd3 anyway), SDR GPS broadcast (illegal RF, receiver-agnostic — aviation risk), jailbreak tweaks (none exists for iOS 26.6), on-device VPN apps (spoof Wi-Fi positioning not true GPS; not automatable).
- **N/A:** Android mock-location (only if we ever go cross-platform — and it doesn't solve the CoreMotion problem either).

---

## How this maps to the roadmap

- **Phase A gates (M1.5)** grow a **gate #0 (`isSimulatedBySoftware`)** ahead of the CoreMotion and flight-gap tests.
- **Activity-emoji line** is re-scoped: movement emoji (attempt) vs. drive analytics (out of scope).
- **Airport arrival** note: aim for a geofence arrival; the auto-"landed" push is a stretch/unknown.
- **New milestone: behavioral engine** (life-simulation layer above the movement engine).
- **AGENTS.md** gains a "detection surface & landscape" note (the flag, go-ios fallback, iOS-hardening risk, no-untethered fact).
