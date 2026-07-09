---
title: Research index
status: research
last_verified: 2026-07-08
device_verified: none           # the whole corpus is desk research pending the Phase A on-device gates
open_gates: [isSimulatedBySoftware, movement-emoji, motion-and-fitness-off, flight-gap, flight-push-manual-toggle, flight-altitude-hard-gate]
source_tier: mixed
recheck_if: [Life360 app update, iOS point release, pmd3 version bump]
---

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
| [life360-notification-triggers.md](life360-notification-triggers.md) | Can we trigger crash / "landed at airport" / *every* Life360 notification? The injection surface (location only), a full catalog + spoofability matrix, and the method for the reachable ones. |
| [oss-spoofer-landscape.md](oss-spoofer-landscape.md) | Who's built OSS spoofers, has anyone done Find My + Life360, what notifications people actually trigger, and the anti-spoof arms race. |
| [coremotion-injection-feasibility.md](coremotion-injection-feasibility.md) | Can we inject/override/**suppress** CoreMotion so Life360 shows "driving" on a still phone? Exhaustive pmd3/DVT/DTX enumeration, XCTest/Simulator + jailbreak/TrollStore reality on iOS 26.6, and the one no-JB lever: the Motion&Fitness-OFF suppress test. |
| [life360-flight-detection.md](life360-flight-detection.md) | Deep-dive on the **Flight Detection / Landing Notifications** setting: exactly how it works (triggers, tier, defaults), whether **anyone has spoofed it** (no public prior art), and whether *we* can — verdict narrowed to a single altitude gate, with the hand-airplane-mode test spelled out. |

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

8. **Dev mode injects LOCATION ONLY — not "almost any variable."** Verified four ways (pmd3
   #340, source read, GPX playback discards altitude, DVT instrument list). ⟹ **crash detection
   is unreachable** (real accelerometer G-spike; don't fake it — it escalates to 911 dispatch),
   and the **literal "landed at airport" flight push is unreachable** (altitude + airplane-mode +
   network reconnect). The reachable notification family is **geofence arrivals/leaves + the
   movement emoji**; the honest "landed" substitute is a **geofence "arrived at CDG"** (airports
   are **not** auto-Places — save one manually). Full catalog + method:
   life360-notification-triggers.md. OSS state of the art: oss-spoofer-landscape.md.

9. **Motion injection is a HARD WALL — but there's one no-jailbreak lever left: *suppression*.**
   Exhaustively confirmed (pmd3 9.33.1 source read locally + go-ios/libimobiledevice + Apple docs +
   the maintainer's own words): **nothing on this stack injects CoreMotion** — the only sensor
   channel is GPS lat/lon, CoreMotion is read-only per-process from the motion coprocessor, XCTest/
   Simulator can't touch a real device, and iOS 26.6 has no jailbreak/TrollStore (caps at 17.0) — and
   even a JB would need a system-wide motion-faking tweak that exists only on Android. So we can't make
   Life360 *see* "automotive." **But** we may remove the *contradiction* by turning Life360's
   **Motion & Fitness permission OFF**, letting its speed-derived emoji fall back to GPS — a Settings
   toggle, testable now with `emoji-test.json`. Might work, might hit an `isDriving`-flag wall.
   Full proof + the A/B test: coremotion-injection-feasibility.md.

10. **Flight/landing push: NO public prior art, and the verdict narrows to ONE gate — altitude.** Deep-dive
    on Life360's Flight Detection setting (free, default-on; fires on 100 m-airport + >100 mph + airplane-mode
    ON→OFF + a 2nd airport within 24 h + network-reconnect). **Nobody has publicly spoofed the "landed" push**
    — the scene pranks *crash* detection but never *landing*. The old flat "NO" was too pessimistic: the
    owner's **hand airplane-mode toggle** satisfies the airplane-mode + reconnect gates *authentically*, and
    the airport/speed/two-airport gates are injectable — so it reduces to **one unknown: does Life360 require
    a real altitude climb/descent** (dead on our stack either way) **or treat altitude as a soft signal?**
    NO-until-tried, with a cheap decisive test. Full mechanism + prior-art + test: life360-flight-detection.md.

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

---

## Doc frontmatter schema (for humans and agents)

Every brief here (and this index) opens with a YAML frontmatter block so a reader — human or
agent — can judge a doc's trust and currency **without reading the body**. This matters because
agents usually read *excerpts*, not whole files, and long-session context gets summarized (a
prose hedge like "(untested for our path)" can be dropped in compaction; a structured field
survives). Fields:

| Field | Meaning |
|---|---|
| `status` | `research` (sourced, not device-checked) · `device-verified` (confirmed on our own phone) · `superseded` (kept for history; don't act on it) |
| `last_verified` | Date the claims were last checked against sources. Treat as perishable. |
| `device_verified` | **The key distinction:** what (if anything) was tested on *our* iOS 26.6 phone vs. only sourced. `none` = believe the sources, but nothing here is empirically confirmed for our stack. |
| `open_gates` | Phase A device tests whose outcome could invalidate this doc's conclusions: `isSimulatedBySoftware` (#0), `movement-emoji` (#1), `flight-gap` (#2). |
| `depends_on` | Other briefs (by filename slug) this one builds on. |
| `source_tier` | `primary` (docs/source/specs) · `vendor` (marketing) · `anecdote` · `mixed`. Per-claim `(HIGH/MEDIUM/LOW)` tags inside the body still say how good each *individual* source is. |
| `recheck_if` | Events that make this doc stale and warrant a re-verify. |

**Convention when you touch a doc:** if you confirm something on-device, flip `status` /
`device_verified` and bump `last_verified` in the *same* session (ground rule #3). Two confidence
axes are in play — `source_tier` (how good the source) and `device_verified` (did we test it) —
keep them distinct; a HIGH-sourced claim can still be `device_verified: none`.
