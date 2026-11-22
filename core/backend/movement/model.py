"""Movement-engine data model + route loader.

Pure data + parsing. Knows nothing about pymobiledevice3, GPX, or rendering — those live in
renderer.py / validator.py. This is the authoring format: JSON separates *intent* (walk this
bit, then drive at 50 km/h, then dwell 3 min) from the geometry a GPX carries.

Constants are tuned to the research briefs in docs/research/ (life360-detection-and-realism.md
and behavioral-engine-prior-art.md) — walk speed N(1.34, 0.30), accel ≲2 m/s² / jerk ≲2 m/s³,
GPS σ≈5 m, and Life360's plausible-speed bands. See docs/MOVEMENT_ENGINE.md for the design.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from backend.secret import load_json

# Travel modes. `stop` holds position for a dwell; walk/drive move along waypoints.
WALK = "walk"
DRIVE = "drive"
STOP = "stop"
MODES = (WALK, DRIVE, STOP)

# --- Speed model -----------------------------------------------------------------
# Default cruise speed per mode (m/s) when a segment omits speed_mps. Walk is sampled from a
# distribution by the renderer (below); drive default is an urban median (Valhalla per-edge
# speeds will replace this at Increment 2).
DEFAULT_SPEED_MPS = {WALK: 1.34, DRIVE: 13.0}
WALK_SPEED_MEAN_MPS = 1.34            # measured pedestrian mean (research §3)
WALK_SPEED_STD_MPS = 0.30
WALK_SPEED_CLAMP = (0.75, 2.4)        # clamp the sampled walk speed to a sane range

# --- Motion smoothness (biggest synthetic tell is a velocity step) ---------------
DEFAULT_ACCEL_MPS2 = {WALK: 0.7, DRIVE: 1.8}   # peak accel; kept well under the ~2.85 wall
DEFAULT_JERK_MPS3 = {WALK: 1.0, DRIVE: 2.0}    # rate-of-change of accel (ISO 15622 ≲2 m/s³)

# --- Cornering (slow for turns like a real car) ---------------------------------
# Lateral-acceleration budget when cornering: v_corner = sqrt(CORNER_LAT_ACCEL * radius).
# 3.5 m/s^2 is brisk-but-believable street driving; exposed here so on-device feedback can tune
# it without touching code. Floor keeps the tightest hairpins crawling rather than stalling.
CORNER_LAT_ACCEL_MPS2 = 3.5
CORNER_MIN_SPEED_MPS = 2.0

# --- GPS noise -------------------------------------------------------------------
# Default 1σ jitter (meters) when a segment omits jitter_m. Open-sky iPhone σ≈5 m; a "still"
# phone still wanders a couple meters (never emit a pixel-frozen point).
DEFAULT_JITTER_M = {WALK: 4.0, DRIVE: 5.0, STOP: 2.0}

# --- Validator thresholds --------------------------------------------------------
# Per-mode plausible cruise ceiling (m/s) — smoothed speed above this is a *review* warning.
SPEED_REVIEW_MPS = {WALK: 2.5, DRIVE: 33.0, STOP: 1.5}
# Global two-tier gates on raw inter-point speed.
SPEED_REVIEW_GLOBAL_MPS = 35.8        # ~80 mph  — warn (Life360 "speeding" territory)
SPEED_HARDFAIL_MPS = 53.6             # ~120 mph — reject (teleport / impossible)
# Acceleration gates (checked on a jitter-smoothed speed signal).
ACCEL_REVIEW_MPS2 = 2.0               # warn
ACCEL_HARDFAIL_MPS2 = 2.85            # reject (instantaneous velocity step)

Coord = tuple[float, float]   # (lat, lon)


@dataclass
class LocationFix:
    """One emitted position sample. iOS reads speed/heading from successive fixes, so the
    spacing + timing of these *is* the speed signal Life360 sees (see AGENTS.md)."""
    lat: float
    lon: float
    t: float                 # seconds from route start (strictly increasing)
    mode: str | None = None  # mode that produced this fix (used by the validator/reporting)
    hold: bool = False       # waiting mid-drive (red light, stop sign): parked, but still driving


@dataclass
class RoadEdge:
    """One stretch of road the drive uses (a Valhalla graph edge), placed on the segment's own
    polyline by arc distance. Filled in at snap time from Valhalla's trace_attributes, never
    authored. roads.py turns a list of these into speeds, traffic lights, stops and turns."""
    s0: float                       # meters along the segment polyline where this edge starts
    s1: float                       # ... and ends (the intersection, if there is one)
    kmh: float | None = None        # Valhalla's estimate for the road
    limit_kmh: float | None = None  # tagged speed limit, None when OSM doesn't say
    road_class: str = ""            # motorway / trunk / primary / ... / residential / service_other
    use: str = "road"               # road / ramp / turn_channel / driveway / parking_aisle / ...
    h0: float | None = None         # heading where the edge starts, degrees from north
    h1: float | None = None         # heading where it ends
    signal: bool = False            # traffic light on this edge in our direction, or at its end node
    stop_impact: int = 0            # Valhalla's 0-7 "how much this intersection slows you"
    cross: list[str] = field(default_factory=list)   # classes of the drivable roads meeting at the end
    roundabout: bool = False
    internal: bool = False          # a connector inside a big intersection
    drive_on_right: bool = True


@dataclass
class Segment:
    mode: str
    waypoints: list[Coord] = field(default_factory=list)  # walk/drive path
    speed_mps: float | None = None                        # target cruise speed (intent)
    jitter_m: float = 0.0                                 # per-segment GPS jitter (0 = mode default)
    snap: bool = False                                    # snap waypoints to real roads (build time)
    at: Coord | None = None                              # stop location (default: prev pos)
    dwell_s: float = 0.0                                 # stop hold time
    steady: bool = False                                  # hold speed_mps: no road speeds, lights or stops
    roads: list[RoadEdge] | None = None                   # filled by snap_route, None = no road data


@dataclass
class Route:
    name: str
    description: str = ""
    segments: list[Segment] = field(default_factory=list)
    label: str = ""          # display name ("MIA → Faena Hotel"); the app derives one when empty
    city: str = ""           # city it belongs to; the app guesses from the end point when empty


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
                snap=bool(s.get("snap", False)),
                steady=bool(s.get("steady", False)),
            ))

    return Route(name=name, description=data.get("description", ""), segments=segments,
                 label=data.get("label", ""), city=data.get("city", ""))


def load_route(path) -> Route:
    return parse_route(load_json(path))
