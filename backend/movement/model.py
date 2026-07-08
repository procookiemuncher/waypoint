"""Movement-engine data model + route loader.

Pure data + parsing. Knows nothing about pymobiledevice3, GPX, or rendering — those live in
renderer.py / validator.py. This is the authoring format: JSON separates *intent* (walk this
bit, then drive at 50 km/h, then dwell 3 min) from the geometry a GPX carries.
See docs/MOVEMENT_ENGINE.md for the design.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

# Travel modes. `stop` holds position for a dwell; walk/drive move along waypoints.
WALK = "walk"
DRIVE = "drive"
STOP = "stop"
MODES = (WALK, DRIVE, STOP)

# Plausible default cruise speed per mode (m/s) when a segment omits speed_mps.
DEFAULT_SPEED_MPS = {WALK: 1.4, DRIVE: 13.9}          # ~3 mph walk, ~50 km/h drive

# Hard "impossible speed" ceiling per mode (m/s) — the validator rejects anything above.
SPEED_CEILING_MPS = {WALK: 3.0, DRIVE: 40.0, STOP: 1.0}   # jog / 144 km/h / jitter-only
GLOBAL_SPEED_CEILING_MPS = 70.0                            # ~252 km/h; catches teleports

# Comfortable acceleration used to ramp in/out of stops (m/s^2), per mode.
DEFAULT_ACCEL_MPS2 = {WALK: 0.6, DRIVE: 1.5}

Coord = tuple[float, float]   # (lat, lon)


@dataclass
class LocationFix:
    """One emitted position sample. iOS reads speed/heading from successive fixes, so the
    spacing + timing of these *is* the speed signal Life360 sees (see AGENTS.md)."""
    lat: float
    lon: float
    t: float                 # seconds from route start (strictly increasing)
    mode: str | None = None  # mode that produced this fix (used by the validator/reporting)


@dataclass
class Segment:
    mode: str
    waypoints: list[Coord] = field(default_factory=list)  # walk/drive path
    speed_mps: float | None = None                        # target cruise speed (intent)
    jitter_m: float = 0.0                                 # per-segment GPS jitter magnitude
    at: Coord | None = None                              # stop location (default: prev pos)
    dwell_s: float = 0.0                                 # stop hold time

    def cruise_speed(self) -> float:
        if self.speed_mps is not None:
            return self.speed_mps
        return DEFAULT_SPEED_MPS.get(self.mode, DEFAULT_SPEED_MPS[DRIVE])


@dataclass
class Route:
    name: str
    description: str = ""
    segments: list[Segment] = field(default_factory=list)


def _coord(v) -> Coord:
    if not (isinstance(v, (list, tuple)) and len(v) == 2):
        raise ValueError(f"coordinate must be [lat, lon], got {v!r}")
    lat, lon = float(v[0]), float(v[1])
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        raise ValueError(f"coordinate out of range: {v!r}")
    return (lat, lon)


def parse_route(data: dict) -> Route:
    """Validate + build a Route from a parsed-JSON dict. Raises ValueError on bad input."""
    name = data.get("name")
    if not name:
        raise ValueError("route needs a 'name'")

    raw_segments = data.get("segments") or []
    if not raw_segments:
        raise ValueError("route has no segments")

    segments: list[Segment] = []
    for i, s in enumerate(raw_segments):
        mode = s.get("mode")
        if mode not in MODES:
            raise ValueError(f"segment {i}: mode must be one of {MODES}, got {mode!r}")

        jitter = float(s.get("jitter_m", 0.0))
        if mode == STOP:
            dwell = float(s.get("dwell_s", 0.0))
            if dwell <= 0:
                raise ValueError(f"segment {i}: stop needs a positive dwell_s")
            at = _coord(s["at"]) if s.get("at") is not None else None
            segments.append(Segment(mode=STOP, at=at, dwell_s=dwell, jitter_m=jitter))
        else:
            wps = [_coord(w) for w in (s.get("waypoints") or [])]
            if len(wps) < 2:
                raise ValueError(f"segment {i}: {mode} needs >= 2 waypoints")
            speed = s.get("speed_mps")
            segments.append(Segment(
                mode=mode,
                waypoints=wps,
                speed_mps=float(speed) if speed is not None else None,
                jitter_m=jitter,
            ))

    return Route(name=name, description=data.get("description", ""), segments=segments)


def load_route(path) -> Route:
    with open(path, "r", encoding="utf-8") as f:
        return parse_route(json.load(f))
