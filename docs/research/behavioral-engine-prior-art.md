---
title: Behavioral / life-simulation engine — prior art & design
status: research                # research | device-verified | superseded
last_verified: 2026-07-08
device_verified: none           # design + prior art only; nothing built or run on-device
open_gates: [flight-gap]        # the flight-gap branch (§F) is gated on a Phase A device test
depends_on: [valhalla-road-snapping, life360-detection-and-realism]
source_tier: primary            # peer-reviewed mobility papers + OSS source + measured GPS numbers
recheck_if: [scikit-mobility API change, OSM/Strava terms change]
---

# Behavioral / life-simulation engine — prior art & design

> Research brief. Goal: a "behavioral engine" that sits **above** the movement engine and makes
> the phone's location history look like a real person's life over hours/days (home→work→errand
> →home, believable dwell + rhythm), primarily to Life360. The movement engine renders legs
> (JSON→Valhalla→GPX→`play`); the behavioral engine decides *where and when* a person is.
> Confidence marked; sources at end.

## Bottom line

Don't invent a mobility model — the research gives a proven one. Use **EPR / TimeGeo** (explore-
vs-preferential-return + a circadian day-diary) to decide where/when, snap legs to roads with
**Valhalla `trace_attributes`** for real per-edge speed, and steal the per-point realism (speed
jitter, lateral noise, dwell) from the **Pokémon-Go bot** step model and **`locwarp`** — a
Windows + pymobiledevice3 tool already doing almost exactly this. Emit one densified, timestamped
GPX per day and play it.

## 1. Human mobility models — the acceptance criteria

Empirical "laws" a realistic generator must reproduce *(all HIGH unless noted)*:
- Movement is **regular, not random**: each person has a characteristic length scale and strongly
  returns to a few frequented places (González, Hidalgo & Barabási, *Nature* 2008).
- **Jump lengths are heavy-tailed** (truncated power law): P(Δr) ∝ (Δr+Δr₀)^(−β)·exp(−Δr/κ), with
  **β=1.75±0.15, Δr₀=1.5 km, κ=400 km**.
- **Visitation is Zipfian**: k-th most-visited place has frequency ∝ k^(−1.2) → "home" dominates,
  ~2 places hold most time. Distinct places grow **sublinearly** S(t)∝t^0.6. Stable "active set"
  ≈ **25 places**. ~**93% of mobility is predictable** (Song 2010, *Science*).

Model picks:

| Model | Captures | Use it for | Confidence |
|---|---|---|---|
| Random waypoint | nothing human | **avoid** (baseline of what not to do) | HIGH |
| Truncated **Lévy walk** | heavy-tailed jump lengths (α≈1.4–1.75) | intra-segment step primitive | HIGH/MED |
| Gravity / radiation | aggregate O–D flow (collective, not traces) | spatial prior on exploration only | HIGH |
| **EPR** (Song 2010) | explore (P_new=ρ·S^−γ) vs preferential return ∝ past frequency → Zipf, r_g growth, sublinear S(t) | **core individual model — start here** | HIGH |
| **TimeGeo** (Jiang 2016) | EPR **+ circadian day-diary** (time-inhomogeneous Markov over {home,other}); infers anchors; 3 interpretable params | the "day in the life" engine | HIGH |
| **DITRAS** (Pappalardo 2018) | cleanly splits WHEN (mobility diary, routine vs not) from WHERE (density-EPR) | turnkey routine; in scikit-mobility | HIGH |
| MoveSim / diffusion | highest fidelity | **impractical** (needs GPU + training corpus) | MED |

**Verified defaults** (from Song 2010 text + scikit-mobility source): ρ≈0.6, γ=0.21±0.02,
stay-time P(Δt)∝Δt^(−1−β) with β=0.8±0.1, cutoff **τ=17 h**; TimeGeo spatial choice adds rank
P(k)∝k^(−0.86). scikit-mobility's `EPR(rho=0.6, gamma=0.21, beta=0.8, tau=17)` matches the paper.
Caveat: EPR/TimeGeo emit **stay-point sequences (place + dwell)**, *not* the path between them —
route/interpolate each leg to get a playable track.

## 2. Open-source projects worth borrowing *(all URLs verified live)*

**Closest analog — study it directly:**
- **`keezxc1223/locwarp`** — https://github.com/keezxc1223/locwarp — a **Windows iPhone GPS
  simulator built on pymobiledevice3** (~223★, active). Modes: Teleport, Navigate (walk/run/drive
  via **OSRM/Valhalla/BRouter**), Route Loop (random 5–20 s pauses), Multi-Stop (per-station
  dwell), Random Walk, Joystick. **Per-segment random min–max speed** resampled each segment;
  **"cooldown delays scale dynamically with teleport distance."** Same stack, same goal — port
  concepts (TS/Electron + Python/FastAPI + pmd3), don't import wholesale.

**Human-like walking / jitter (the "gold"):**
- **`PokemonGoF/PokemonGo-Bot`** — https://github.com/PokemonGoF/PokemonGo-Bot — MIT, Python.
  `walkers/step_walker.py` is directly portable: speed=`uniform(min,max)` (extra ±0.5 jitter at
  max); **perpendicular lateral jitter** `dist~uniform(0, precision)` at `azimuth±uniform(0,90)`,
  **`precision=0.5 m`**; altitude noise; geodesic step capped at remaining distance; a
  `PolylineWalker` snaps to a directions polyline. **Copy the per-step model into our emitter.**
- **Pokémon-Go cooldown chart** (distance→time; 2 h hard cap ≥1500 km) — relevant only as a
  speed-plausibility reference; cooldown is triggered by *actions*, not movement.

**Synthetic GPS / "fake GPX" generators:**
- **`appscape/gips`** (Ruby) — https://github.com/appscape/gips — inserts interpolated waypoints
  so movement matches a **target speed** (exists precisely because iOS Simulator ignores GPX
  timestamps). **Exact densify-to-encode-speed algorithm to port to Python.**
- `reihakuro/track-gps-generator`, `mmadfox/go-gpsgen`, `BeepView/route-gps-simulator` — coord→GPX
  with pace/jitter/noise/blackout models; concept references.

**Driving simulators:**
- **`sharedstreets/trip-simulator`** (JS, dormant) — https://github.com/sharedstreets/trip-simulator
  — OSRM trips, **1 Hz probes with realistic GPS noise**. Port the noise/cadence approach.
- **OSRM** — https://github.com/Project-OSRM/osrm-backend — routing + `/match` HMM map-matching.

**Mobility frameworks:**
- **`scikit-mobility`** (Python, BSD) — https://github.com/scikit-mobility/scikit-mobility —
  EPR/DensityEPR/SpatialEPR/DITRAS + gravity/radiation; `.generate()` → timestamped points →
  resample→GPX. **The "where/when" layer** (defaults already match Song 2010).
- **Eclipse SUMO** — https://github.com/eclipse-sumo/sumo — traffic+pedestrian microsim;
  `traceExporter.py --gpx --delta-t 1 --gps-blur N` → per-second noised GPX. Heavier setup.

**iOS route-spoof references (macOS/other; UX patterns only):** `Schlaubischlump/LocationSimulator`
(no iOS 17+), `lvalen91/Location-Simulator`, `nexron171/SimVirtualLocation`, `davesc63/GeoPort`
(Python/Flask + pmd3 scaffolding, teleport-only).

## 3. Realism numbers to steal *(HIGH unless noted)*

- **Speeds:** walk mean **1.34–1.4 m/s** → model **N(1.34, 0.30)** clamped ~[0.75, 2.4]; run
  2.2–3.3; commuter cycle 4.2–6.7; motorized median ~13 m/s (urban = stops + highway sustained).
- **Accel/jerk (biggest tell):** keep |accel| ≲ **2 m/s²** (max ~2.85), **jerk ≲ ~2 m/s³** (ISO
  15622). An instantaneous velocity step is the #1 synthetic giveaway.
- **Dwell / stay-points:** canonical detection = **200 m / ≥30 min** (+ ~12 h gap-splitter so
  overnight silence doesn't fragment "home"). Dwell durations are **heavy-tailed** (truncated
  power law, β=0.8) — not exponential/Gaussian. US trips/day ≈ **2.28** (2022 NHTS).
- **GPS noise:** open-sky σ ≈ **5 m** (measured iPhone mean `horizontalAccuracy` 7.18 m, worse in
  the first 10–20 warm-up fixes); urban ~7–13 m, biased/heavier-tailed. Per-axis Gaussian(σ) →
  **Rayleigh** radial + rare outliers. `horizontalAccuracy` ≈ 1σ (68%), negative = invalid.
- **Map-matching:** HMM (Newson & Krumm) with σ≈5 m; reuse **Valhalla Meili** defaults
  (`sigma_z=4.07, gps_accuracy=5, beta=3, search_radius=50`) or OSRM `/match` per-point `radius`.
- **Transitions:** jerk-limited S-curve; **always a zero-speed dwell between mode changes** (park,
  then walk). Mode detectors key on the **95th percentile** of speed/accel — match each mode's
  upper tail, not just its mean.

## 4. Daily patterns ("a day in the life") *(HIGH direction; MED exact minutes)*

- **Anchors dominate:** ~2 places hold most time; **home = most-visited nighttime location**
  (default 22:00–07:00); ~25 familiar places; preferential return governs revisits.
- **US commute:** bimodal — sharp **AM peak 7–9**, broader **PM peak 4–6** (trip-chaining errands
  on the way home); mean one-way **27.6 min**; ~91% by car.
- **Durations:** work long (~8 h); errands short (10–30 min); home overnight longest. Log-normal /
  hazard-based.
- **Circadian:** near-zero overnight, **daily minimum ~4 am**, sharp morning ramp, bursty.
- **Weekend:** no commute, **later start, midday-centered**, work→discretionary/social mix.
- **Motifs:** just **17 network shapes cover ~90% of days**; the most common (~half of days) is
  the 2-node **home→work→home** loop; **90% of people visit <7 places/day** (count log-normal
  μ=1, σ=0.5). Sample day-shapes from these.

## 5. Record-and-replay + route data *(HIGH)*

- **`play` semantics (verified against pinned 9.33.1 source):** `simulate-location play <gpx> <N>`
  — **N = ±N ms timing jitter** added to each inter-point wait (`duration = Δt(points);
  duration += randint(-N,N)/1000; await sleep(duration)`). **Point spacing/timing IS the speed
  signal**; `500` = ±500 ms. `set` is lat/lon only (issue #340). Use **`gpxpy`** to build/parse
  (it has `speed_between`/`get_moving_data`, confirming the derive-from-deltas model).
- **⚠ Xcode Simulator ignores `<time>`** (constant speed) — the trap `gips` solves; on-device pmd3
  playback *does* honor timing. Encode speed via point *spacing* to be safe either way.
- **Capture real trips:** Open GPX Tracker (iOS, OSS) / OsmAnd / GPSLogger — authentic
  pacing/jitter, no routing engine needed.
- **Routing engines (self-hostable, build-time):** **Valhalla** — `trace_attributes` gives
  **per-edge speed + speed_limit + road class** (the key API to *time* a track); Meili map-match.
  OSRM `/route` annotations + `/match`; GraphHopper GPX map-matching. *(We already chose Valhalla
  — this confirms it and names `trace_attributes` as the way to get realistic per-edge speeds.)*
- **Route/trace data:** OSM public GPS traces (use **`identifiable`/`trackable`** visibility —
  `public` strips timing; verify current OSM terms before redistribution); **GeoLife** (182 users,
  real human traces — MSR-LA research license); **T-Drive** (Beijing taxis). **Strava: RULED OUT**
  — its 2026 API policy explicitly bans ingesting Strava data into AI apps / a context window.

## Design for a vida-360 behavioral engine

Layered, build-time, fits `LocationBackend` + `simulate-location play`. The behavioral engine
*authors* a life-script; the movement engine *renders* it.

### Data model — JSON "life-script"

```jsonc
{
  "person": {
    "home": {"lat":25.77,"lon":-80.19,"night_window":["22:00","07:00"]},
    "work": {"lat":25.79,"lon":-80.13,"start":"09:00","dur_h":8,"days":["Mon","Tue","Wed","Thu","Fri"]},
    "anchors": [ {"name":"gym","lat":..,"lon":..,"weight":6},
                 {"name":"cafe","lat":..,"lon":..,"weight":9} ],   // ~5-25, Zipf visit weights
    "profile": {"rho":0.6,"gamma":0.21,"tau_h":17,"beta":0.8}      // EPR/Song-2010 defaults
  },
  "day_template": {
    "motif": "H-W-H+errand",                                        // from the 17 Schneider motifs
    "legs": [
      {"from":"home","to":"work","mode":"drive","depart":"08:32","speed_kmh":[30,80]},
      {"stay":"work","dwell_min":495},
      {"from":"work","to":"cafe","mode":"drive","depart":"17:11"},
      {"stay":"cafe","dwell_min":25},
      {"from":"cafe","to":"home","mode":"drive"}
    ]
  }
}
```

### Algorithms

- **A. Day planner (WHERE + WHEN).** *Ship first:* template + **motif sampler** (bias to the
  2-node H→W→H loop; extra-stop count ~ log-normal(μ=1,σ=0.5) → <7/day; pick discretionary stops
  from `anchors` weighted by visit frequency = preferential return; dwell from truncated power law
  clamped per activity type; departures jittered around the bimodal peaks). *Graduate to:*
  **scikit-mobility** `EPR`/`DITRAS` behind the same interface for procedural multi-day variety.
  Both output `(place, arrive, depart)`.
- **B. Leg renderer.** Per travel leg call **Valhalla `route`** at build time (auto/pedestrian/
  bicycle); pull **`trace_attributes` per-edge speed** so timing reflects real road speeds. (This
  is the existing JSON→Valhalla→GPX step, now fed by the planner.)
- **C. Speed/timing profiler.** Densify to ~1 Hz; timestamp so spacing encodes speed (the `gips`
  technique). Per-mode base speed from §3; jerk-limited S-curve at start/end/stops; **zero-speed
  dwell between mode changes.**
- **D. Jitter layer.** Port the PokemonGo `step_walker` model (perpendicular lateral jitter,
  precision≈5 m open-sky / larger urban) → zero-mean Gaussian per-axis → Rayleigh radial + rare
  outliers; light re-snap so points stay on the road. **Must not manufacture speed.**
- **E. Emit + play.** Concatenate legs + dwells into one GPX with absolute `<time>`; play with
  `simulate-location play day.gpx 500`. Dwells = many jittered near-identical points.
- **F. Flight gap (CDG arrival).** Model the ocean leg as an **update gap** (stop emitting for a
  flight-plausible duration), then resume with a believable in-airport approach. *Still gated by
  the Phase A device tests (does iOS revert to real GPS during the gap? — see MOVEMENT_ENGINE.md).*

### Acceptance tests (offline, extend the validator)

Assert the verified laws: heavy-tailed jump lengths; Zipf visitation (home dominates); <7
places/day; **no segment over mode speed cap; no accel >~2.85 m/s²; no instantaneous velocity
step; every mode change has a stop**; overnight shows home + jitter only; weekend later/midday.

## Suggested roadmap items (ordered)

1. **Vendor the PokemonGo jitter/step model** into `backend/movement/jitter.py` (MIT) — immediate
   realism win. *(→ M1.5 "GPS jitter present")*
2. **Add the `gips`-style speed/densify profiler** to the GPX builder (spacing encodes per-mode
   speed; jerk-limited ramps; stop between mode changes). *(→ M1.5 speed profiles)*
3. **Wire Valhalla `trace_attributes`** into the build step to time legs by real per-edge speed.
4. **Study `locwarp`'s** speed-range + distance-scaled-cooldown logic before writing our own.
5. **Ship the template day planner** (motif sampler + Zipf anchors + power-law dwell) → a
   `(place,arrive,depart)` day-script rendered into a full-day GPX. *(→ new behavioral milestone)*
6. **Add scikit-mobility** (EPR/DITRAS) as an optional generator backend behind the same interface.
7. **Seed with real tracks** (self-recorded via Open GPX Tracker; OSM `identifiable` traces) as a
   realism baseline + regression corpus. GeoLife for offline analysis only; **not Strava.**
8. **Write the realism acceptance tests** (above) so a generated day validates offline before it
   hits the device.
9. **(Gated on Phase A)** implement the flight-gap branch for the CDG arrival.

## Sources

Models & laws: https://www.nature.com/articles/nature06958 · https://arxiv.org/abs/0806.1256 (González 2008) · https://arxiv.org/abs/1010.0436 (Song 2010 EPR) · https://www.science.org/doi/10.1126/science.1177170 (predictability) · https://www.nature.com/articles/s41586-020-2909-1 (~25 places) · https://www.nature.com/articles/nature04292 (Lévy) · https://www.nature.com/articles/nature10856 (radiation) · https://www.pnas.org/doi/10.1073/pnas.1524261113 (TimeGeo) · https://arxiv.org/abs/1607.05952 (DITRAS)
OSS: https://github.com/keezxc1223/locwarp · https://github.com/PokemonGoF/PokemonGo-Bot · https://github.com/appscape/gips · https://github.com/sharedstreets/trip-simulator · https://github.com/Project-OSRM/osrm-backend · https://github.com/scikit-mobility/scikit-mobility · https://github.com/eclipse-sumo/sumo · https://github.com/davesc63/GeoPort
Realism numbers: https://www.mdpi.com/2071-1050/16/11/4813 (walk speed) · https://pmc.ncbi.nlm.nih.gov/articles/PMC4320483/ (mode speeds) · https://www.sciencedirect.com/science/article/pii/S1369847824001244 (accel/jerk) · https://users.wpi.edu/~yli15/courses/DS504Fall16/includes/BDA-TDM.pdf (stay-points) · https://arxiv.org/pdf/1408.4910 (heavy-tailed dwell) · https://freeletics.engineering/2019/06/03/ios_gps_testing.html (iPhone GPS) · https://www.ismll.uni-hildesheim.de/lehre/semSpatial-10s/script/6.pdf (Newson & Krumm) · https://valhalla.github.io/valhalla/meili/configuration/
Daily patterns: https://royalsocietypublishing.org/doi/10.1098/rsif.2013.0246 (motifs) · https://www.census.gov/newsroom/press-releases/2021/one-way-travel-time-to-work-rises.html · https://digitalcommons.usf.edu/etd/936/ (weekday/weekend) · https://nhts.ornl.gov/assets/2022/pub/2022_NHTS_Summary_Travel_Trends.pdf
Replay & data: https://www.topografix.com/gpx/1/1/ · https://github.com/tkrajina/gpxpy · https://valhalla.github.io/valhalla/api/map-matching/api-reference/ · https://github.com/merlos/iOS-Open-GPX-Tracker · https://www.openstreetmap.org/traces/ · https://www.microsoft.com/en-us/download/details.aspx?id=52367 (GeoLife) · https://www.strava.com/legal/api_policy (ruled out)
