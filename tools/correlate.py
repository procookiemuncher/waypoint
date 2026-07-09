"""Correlate an Observer JSONL log against the route GPX that was played (offline analysis).

Closes the loop: `observe.py --watch --log run.jsonl` records what Life360's servers reported while
`simulate-location play` fed the phone a route GPX. This tool aligns the two and answers the
questions the whole Observer effort exists for:

  - **Speed unit + under-read:** is Life360's `speed` in mph? and how much lower than what we emitted?
  - **isDriving timeline:** did the driving flag ever flip, and at what speed / how far in?
  - **Stutter / cadence:** how often does Life360's server actually record a new position?

Alignment is **by position, not timestamp** — the played GPX uses a synthetic epoch (2020) while the
observer stamps real wall-clock time, so absolute times don't line up, but the pin's *location* is the
common reference. Each observed sample is matched to the nearest emitted GPX point.

Pure stdlib, offline, read-only. See docs/LIFE360_OBSERVER.md §7.

    .venv\\Scripts\\python.exe tools\\correlate.py --log run.jsonl --gpx build\\emoji-test.gpx
    .venv\\Scripts\\python.exe tools\\correlate.py --log run.jsonl --gpx build\\emoji-test.gpx --member Juan
"""
import argparse
import json
import math
import re
from datetime import datetime, timezone

_EARTH_R = 6_371_000.0
_MPS_TO_MPH = 2.2369362920544
_SMOOTH_WINDOW_S = 4.0     # centered window for emitted-speed smoothing (matches the validator)
_TRKPT_RE = re.compile(
    r'<trkpt[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)".*?(?:<time>([^<]+)</time>)?\s*</trkpt>',
    re.DOTALL)


def _haversine(a, b):
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_R * math.asin(math.sqrt(h))


def parse_gpx(path):
    """Return [(lat, lon, t_seconds)] from a GPX. Tuned to our generated format; tolerant of a
    missing <time> (falls back to 1 Hz indexing). t is seconds from the file's first point."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    pts = []
    for i, m in enumerate(_TRKPT_RE.finditer(text)):
        lat, lon, tstr = float(m.group(1)), float(m.group(2)), m.group(3)
        if tstr:
            dt = datetime.strptime(tstr.strip(), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            t = dt.timestamp()
        else:
            t = float(i)   # assume 1 Hz if the GPX carries no time
        pts.append((lat, lon, t))
    if not pts:
        raise ValueError(f"no <trkpt> points found in {path}")
    t0 = pts[0][2]
    return [(lat, lon, t - t0) for lat, lon, t in pts]


def emitted_speeds_mps(pts):
    """Smoothed emitted speed (m/s) at each GPX point over a centered +/-window/2 time window."""
    n = len(pts)
    cum = [0.0] * n
    for i in range(1, n):
        cum[i] = cum[i - 1] + _haversine(pts[i - 1], pts[i])
    half = _SMOOTH_WINDOW_S / 2
    speeds = [0.0] * n
    a = b = 0
    for i in range(n):
        while a < i and pts[i][2] - pts[a][2] > half:
            a += 1
        while b < n - 1 and pts[b + 1][2] - pts[i][2] <= half:
            b += 1
        dt = pts[b][2] - pts[a][2]
        speeds[i] = (cum[b] - cum[a]) / dt if dt > 0 else 0.0
    return speeds


def load_jsonl(path, needle):
    """Load observer samples (optionally filtered to one member), sorted by fetched_ts."""
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if needle and needle not in (rec.get("name") or "").lower():
                continue
            rows.append(rec)
    rows.sort(key=lambda r: r.get("fetched_ts") or 0)
    return rows


def nearest_index(pts, lat, lon):
    best_i, best_d = 0, float("inf")
    for i, p in enumerate(pts):
        d = _haversine((lat, lon), (p[0], p[1]))
        if d < best_d:
            best_i, best_d = i, d
    return best_i, best_d


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return None
    mid = n // 2
    return xs[mid] if n % 2 else (xs[mid - 1] + xs[mid]) / 2


def _infer_unit(ratio):
    if ratio is None:
        return "unknown (no speed samples)"
    if 0.80 <= ratio <= 1.25:
        return "MPH (observed ~= emitted mph)"
    if 0.35 <= ratio <= 0.55:
        return "m/s (observed ~= emitted mph x 0.447)"
    if 3.0 <= ratio <= 4.0:
        return "km/h (observed ~= emitted mph x 1.61) - unlikely, check"
    return "inconclusive — see raw ratio"


def correlate(pts, emitted_mps, samples):
    """Build the report dict from GPX points, their emitted speeds, and observer samples."""
    speed_pairs = []          # (observed_speed_raw, emitted_mph, match_dist_m)
    driving_timeline = []     # (elapsed_est, observed_speed_raw, is_driving)
    for r in samples:
        lat, lon = r.get("lat"), r.get("lon")
        if lat is None or lon is None:
            continue
        i, dist = nearest_index(pts, lat, lon)
        emph = emitted_mps[i] * _MPS_TO_MPH
        obs = r.get("speed_raw")
        if obs is not None and obs >= 0:
            speed_pairs.append((obs, emph, dist))
        driving_timeline.append((pts[i][2], obs, r.get("is_driving")))

    # server cadence: distinct "since" server-update timestamps
    sinces = [r.get("since_ts") for r in samples if r.get("since_ts")]
    distinct = sorted(set(sinces))
    cadence = [b - a for a, b in zip(distinct, distinct[1:]) if b > a]

    obs_speeds = [o for o, _, _ in speed_pairs]
    emi_speeds = [e for _, e, _ in speed_pairs]
    med_obs, med_emi = _median(obs_speeds), _median(emi_speeds)
    ratio = (med_obs / med_emi) if (med_obs and med_emi) else None

    return {
        "n_gpx": len(pts),
        "n_samples": len(samples),
        "n_speed_pairs": len(speed_pairs),
        "median_observed_speed": med_obs,
        "median_emitted_mph": med_emi,
        "ratio": ratio,
        "unit_guess": _infer_unit(ratio),
        "match_dist_median_m": _median([d for _, _, d in speed_pairs]),
        "driving_ever_true": any(d is True for _, _, d in driving_timeline),
        "driving_timeline": driving_timeline,
        "cadence_s": cadence,
    }


def print_report(rep):
    print("=" * 60)
    print("  Observer x Route correlation")
    print("=" * 60)
    print(f"  GPX points:        {rep['n_gpx']}")
    print(f"  Observer samples:  {rep['n_samples']} ({rep['n_speed_pairs']} with a usable speed)")
    md = rep["match_dist_median_m"]
    if md is not None:
        print(f"  Position match:    median {md:.0f} m from the emitted path")

    print("\n  -- Speed ------------------------------------------------")
    if rep["median_observed_speed"] is None:
        print("  No usable speed samples (Life360 reported none / -1).")
    else:
        print(f"  median observed speed : {rep['median_observed_speed']:.1f}")
        print(f"  median emitted speed  : {rep['median_emitted_mph']:.1f} mph")
        print(f"  observed / emitted    : {rep['ratio']:.2f}")
        print(f"  => Life360 speed unit : {rep['unit_guess']}")
        if rep["ratio"] and rep["ratio"] < 0.8:
            print(f"  => under-reading by ~{(1 - rep['ratio']) * 100:.0f}% "
                  f"(sparse sampling smooths our speed down)")

    print("\n  -- Driving flag (the emoji signal) ----------------------")
    if rep["driving_ever_true"]:
        first = next((t for t, s, d in rep["driving_timeline"] if d is True), None)
        print(f"  isDriving flipped TRUE (first at ~{first:.0f}s into the emitted route).")
        print("  => the driving classification IS reachable on this run.")
    else:
        print("  isDriving never flipped TRUE across the whole run.")
        print("  => the car emoji stayed suppressed (the CoreMotion-contradiction wall).")

    print("\n  -- Server cadence (the 'stutter') -----------------------")
    if rep["cadence_s"]:
        c = rep["cadence_s"]
        print(f"  distinct server updates: {len(c) + 1}")
        print(f"  interval  min/median/max: {min(c):.0f}s / {_median(c):.0f}s / {max(c):.0f}s")
        print("  => this is how often Life360 actually recorded a new position.")
    else:
        print("  Not enough distinct server updates to measure cadence "
              "(need a longer run or more movement).")
    print("=" * 60)


def main():
    ap = argparse.ArgumentParser(description="Correlate an Observer JSONL log against a played route GPX.")
    ap.add_argument("--log", required=True, help="observer JSONL from `observe.py --log`")
    ap.add_argument("--gpx", required=True, help="the route GPX that was played")
    ap.add_argument("--member", help="only analyze samples for this member (case-insensitive)")
    args = ap.parse_args()

    pts = parse_gpx(args.gpx)
    emitted = emitted_speeds_mps(pts)
    samples = load_jsonl(args.log, args.member.lower() if args.member else None)
    if not samples:
        who = f" for '{args.member}'" if args.member else ""
        print(f"! no samples{who} found in {args.log}")
        return
    print_report(correlate(pts, emitted, samples))


if __name__ == "__main__":
    main()
