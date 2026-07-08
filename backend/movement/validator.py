"""Offline validator — the gate before any on-device run.

Checks a rendered trajectory for the realism/sanity invariants from docs/MOVEMENT_ENGINE.md:
strictly-increasing time, and no impossible inter-point speed (per mode, plus a global
teleport ceiling). Pure + fast — run it before ever pushing points to the phone, so a route
that would look physically impossible to Life360 never reaches the device.
"""
from __future__ import annotations

import math

from .model import LocationFix, SPEED_CEILING_MPS, GLOBAL_SPEED_CEILING_MPS

_EARTH_R = 6_371_000.0


def _haversine(a: LocationFix, b: LocationFix) -> float:
    lat1, lon1 = math.radians(a.lat), math.radians(a.lon)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lon)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_R * math.asin(math.sqrt(h))


def validate(fixes: list[LocationFix]) -> list[str]:
    """Return a list of problems (empty means the trajectory is safe to play)."""
    if len(fixes) < 2:
        return ["trajectory has fewer than 2 fixes"]

    issues: list[str] = []
    for i in range(1, len(fixes)):
        a, b = fixes[i - 1], fixes[i]
        dt = b.t - a.t
        if dt <= 0:
            issues.append(f"fix {i}: time not strictly increasing ({a.t} -> {b.t})")
            continue
        speed = _haversine(a, b) / dt
        ceiling = min(
            SPEED_CEILING_MPS.get(b.mode, GLOBAL_SPEED_CEILING_MPS),
            GLOBAL_SPEED_CEILING_MPS,
        )
        if speed > ceiling:
            issues.append(
                f"fix {i}: speed {speed:.1f} m/s exceeds "
                f"{b.mode or 'global'} ceiling {ceiling:.1f} m/s"
            )
    return issues


def validate_or_raise(fixes: list[LocationFix]) -> None:
    problems = validate(fixes)
    if problems:
        raise ValueError("trajectory failed validation:\n  - " + "\n  - ".join(problems))
