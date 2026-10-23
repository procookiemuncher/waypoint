"""Offline validator — the gate before any on-device run.

Two tiers (per docs/research/life360-detection-and-realism.md):
- **errors** (reject): impossible-speed teleports, instantaneous velocity steps
  (acceleration over the wall), non-monotonic time.
- **warnings** (review): plausible-but-notable speeds/accels worth a human glance.

Speed for the teleport check is the raw inter-point value. Speed for the *mode* and
*acceleration* checks is smoothed over a short time window, because GPS jitter makes
instantaneous speed noisy — exactly as a real detector would smooth before judging motion.
Run this before ever pushing points to the phone.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .model import (
    LocationFix,
    SPEED_REVIEW_MPS, SPEED_REVIEW_GLOBAL_MPS, SPEED_HARDFAIL_MPS,
    ACCEL_REVIEW_MPS2, ACCEL_HARDFAIL_MPS2,
)

_EARTH_R = 6_371_000.0
_SPEED_WINDOW_S = 4.0     # centered window for jitter-smoothed speed


def _haversine(a: LocationFix, b: LocationFix) -> float:
    lat1, lon1 = math.radians(a.lat), math.radians(a.lon)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lon)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_R * math.asin(math.sqrt(h))


@dataclass
class ValidationResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    max_step_speed: float = 0.0      # m/s, raw inter-point
    max_smoothed_speed: float = 0.0  # m/s
    max_accel: float = 0.0           # m/s^2, on smoothed speed

    @property
    def ok(self) -> bool:
        return not self.errors


def _smoothed_speeds(fixes: list[LocationFix]) -> list[float]:
    """Speed at each fix over a centered ±(window/2) time window, from cumulative distance —
    robust to variable cadence and to jitter (which averages out over the baseline)."""
    n = len(fixes)
    cum = [0.0] * n
    for i in range(1, n):
        cum[i] = cum[i - 1] + _haversine(fixes[i - 1], fixes[i])
    half = _SPEED_WINDOW_S / 2
    speeds = [0.0] * n
    a = b = 0
    for i in range(n):
        while a < i and fixes[i].t - fixes[a].t > half:
            a += 1
        while b < n - 1 and fixes[b + 1].t - fixes[i].t <= half:
            b += 1
        dt = fixes[b].t - fixes[a].t
        speeds[i] = (cum[b] - cum[a]) / dt if dt > 0 else 0.0
    return speeds


def _summarize(store: dict, template) -> list[str]:
    """Collapse a per-fix category (count, worst_value, worst_idx) into one line each."""
    out = []
    for key, (count, worst, idx) in store.items():
        out.append(template(key, count, worst, idx))
    return out


def validate(fixes: list[LocationFix]) -> ValidationResult:
    """Return a ValidationResult. `.ok` is False iff there are errors."""
    res = ValidationResult()
    if len(fixes) < 2:
        res.errors.append("trajectory has fewer than 2 fixes")
        return res

    err: dict = {}
    warn: dict = {}

    def bump(store, key, val, idx):
        c, w, wi = store.get(key, (0, 0.0, -1))
        store[key] = (c + 1, max(w, val), idx if val >= w else wi)

    # raw inter-point speed (teleport check) + monotonic time
    for i in range(1, len(fixes)):
        dt = fixes[i].t - fixes[i - 1].t
        if dt <= 0:
            bump(err, "time not strictly increasing", 1.0, i)
            continue
        s = _haversine(fixes[i - 1], fixes[i]) / dt
        res.max_step_speed = max(res.max_step_speed, s)
        if s > SPEED_HARDFAIL_MPS:
            bump(err, "step speed over hard-fail (teleport)", s, i)

    # smoothed speed -> per-mode review + acceleration
    sm = _smoothed_speeds(fixes)
    res.max_smoothed_speed = max(sm)
    for i, fx in enumerate(fixes):
        cap = SPEED_REVIEW_MPS.get(fx.mode, SPEED_REVIEW_GLOBAL_MPS)
        if sm[i] > cap:
            bump(warn, f"smoothed speed over {fx.mode or 'global'} review cap ({cap:g} m/s)", sm[i], i)
    for i in range(1, len(fixes)):
        dt = fixes[i].t - fixes[i - 1].t
        if dt <= 0:
            continue
        acc = abs(sm[i] - sm[i - 1]) / dt
        res.max_accel = max(res.max_accel, acc)
        if acc > ACCEL_HARDFAIL_MPS2:
            bump(err, "acceleration over hard-fail (velocity step)", acc, i)
        elif acc > ACCEL_REVIEW_MPS2:
            bump(warn, "acceleration over review", acc, i)

    res.errors += _summarize(
        err, lambda k, c, w, i: f"{k}: {c} fix(es), worst {w:.2f} @ fix {i}")
    res.warnings += _summarize(
        warn, lambda k, c, w, i: f"{k}: {c} fix(es), worst {w:.2f} @ fix {i}")
    return res


def validate_or_raise(fixes: list[LocationFix]) -> None:
    res = validate(fixes)
    if not res.ok:
        raise ValueError("trajectory failed validation:\n  - " + "\n  - ".join(res.errors))
