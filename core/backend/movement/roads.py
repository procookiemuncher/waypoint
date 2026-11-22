"""Road-aware driving: what a real driver does along a snapped drive.

snap_route fills each snapped drive's `roads` with RoadEdges (Valhalla trace_attributes, laid on
the drive's own polyline by map_edges). plan() turns them into, for one render:

- **speed spans**: how fast a driver goes on each stretch. The tagged speed limit, or Valhalla's
  estimate clamped into a band for the road class; slower on ramps, service roads and roundabouts;
  times this driver's habit (Driver.pace_*); never over MAX_MPS.
- **controls**: where the car slows or stops.
  - `light`: a traffic light (Valhalla's, which come from OSM). Red or green is rolled per drive.
    A red is a full stop and a wait; one that's about to go green is a slow roll. Lights within
    LIGHT_MERGE_M of each other are one intersection (a dual carriageway has a signal node per
    carriageway) and get one roll.
  - `stop`: an inferred stop sign, give-way or pulling out of a parking lot (see _stop_for).
  - `turn`: a turn at an intersection, slower on the tight side (right when traffic drives on the
    right) than the wide one.

Stop signs are inferred because Valhalla's API has no stop-sign field and the public OSM query
server (Overpass) refuses automated use. The rule: at an unsignalled intersection, coming off a
smaller road onto or across a bigger one (or out of a lot) is a stop or a rolling stop; two small
roads of the same size are sometimes an all-way stop, sometimes a slow look. Ramps, motorways and
trunks never stop.

Pure logic over model.py + geo.py: no network, no pymobiledevice3.
"""
from __future__ import annotations

import bisect
import math
from dataclasses import dataclass

from . import geo
from .model import RoadEdge

# road class -> importance (bigger = more important). FAST and up never stop or get turn caps.
RANK = {"service_other": 0, "residential": 1, "unclassified": 1, "tertiary": 2, "secondary": 3,
        "primary": 4, "trunk": 5, "motorway": 6}
FAST = 5

# km/h band per class when OSM has no limit; Valhalla's own estimate is clamped into it
CLASS_KMH = {"motorway": (90, 115), "trunk": (70, 100), "primary": (45, 70), "secondary": (40, 60),
             "tertiary": (35, 55), "unclassified": (30, 50), "residential": (25, 40),
             "service_other": (25, 40)}   # airport and access roads are often tagged service; lots have their own use
# slow kinds of road, whatever their class says (km/h ceiling)
USE_KMH = {"ramp": 60, "turn_channel": 30, "driveway": 12, "parking_aisle": 10, "alley": 15,
           "drive_through": 8, "culdesac": 25, "emergency_access": 20}
ROUNDABOUT_KMH = 28
MAX_MPS = 32.5        # ~73 mph: under the validator's drive review cap (jitter adds a little) and Life360's 80 mph speeding flag
MIN_MPS = 3.0

LIGHT_MERGE_M = 50.0  # lights closer than this are one intersection
STOP_BACK_M = 6.0     # the stop line sits short of the middle of the intersection
EDGE_GAP_M = 20.0     # no control this close to where the drive starts or ends
TURN_MIN_DEG = 30.0   # less than this at an intersection is just following the road
TURN_MERGE_M = 25.0

# per light: (chance it's red, longest red wait in s)
LIGHT_MAIN = (0.35, 45.0)       # we're on the bigger road
LIGHT_SIDE = (0.55, 75.0)       # we're coming off the smaller one
LIGHT_MIDBLOCK = (0.25, 25.0)   # nothing crosses: a crosswalk or driveway signal
ROLL_UNDER_S = 6.0              # a red with less than this left gets a slow roll, not a stop
DRIFT = (0.95, 1.03)            # how far a driver's speed wanders around the road's


@dataclass
class Driver:
    """One driver's habits, sampled once per render so no two drives look the same."""
    pace_city: float = 1.0     # times the speed limit on city roads
    pace_fast: float = 1.03    # ... and on fast ones (80 km/h and up)
    accel: float = 1.75        # m/s^2 pulling away from rest, falling off with speed (accel_at)
    brake: float = 1.7         # m/s^2 slowing for bends, turns and slower roads
    stop_brake: float = 1.3    # m/s^2 coming to rest (lights, stops, the end of the drive)
    corner_lat: float = 3.5    # m/s^2 sideways through a bend: v = sqrt(corner_lat * radius)

    def drift(self, rng, total: float):
        """Speed factor along the drive: nobody holds exactly the limit, so it wanders a few percent
        either side, a new target every 300-700 m, straight lines between them."""
        knots, s = [(0.0, rng.uniform(*DRIFT))], 0.0
        while s < total:
            s += rng.uniform(300.0, 700.0)
            knots.append((s, rng.uniform(*DRIFT)))
        starts = [k[0] for k in knots]

        def at(x):
            i = max(1, min(len(knots) - 1, bisect.bisect_right(starts, x)))
            (s0, f0), (s1, f1) = knots[i - 1], knots[i]
            return f0 + (f1 - f0) * min(1.0, max(0.0, (x - s0) / (s1 - s0)))
        return at

    @classmethod
    def sample(cls, rng) -> "Driver":
        def gauss(mu, sd, lo, hi):
            return max(lo, min(hi, rng.gauss(mu, sd)))
        return cls(pace_city=gauss(1.0, 0.04, 0.92, 1.08), pace_fast=gauss(1.03, 0.03, 0.96, 1.10),
                   accel=rng.uniform(1.55, 1.85), brake=rng.uniform(1.5, 1.9),
                   stop_brake=rng.uniform(1.1, 1.5), corner_lat=rng.uniform(3.1, 3.8))

    def accel_at(self, v: float) -> float:
        """Real cars pull hardest from rest: ~1.75 m/s^2 at 0, about half that at 55 mph."""
        return self.accel * max(0.4, 1.0 - v / 50.0)


@dataclass
class Control:
    s: float                   # meters along the drive's polyline
    kind: str                  # light / stop / turn
    dwell_s: float = 0.0       # > 0: come to rest here and wait this long
    v_cap: float | None = None  # otherwise: pass through no faster than this (m/s)
    why: str = ""


def _rank(road_class: str) -> int:
    return RANK.get(road_class, 1)


# ---- placing Valhalla's edges on our line ---------------------------------------------------------

def map_edges(raw, polyline) -> list[RoadEdge] | None:
    """Lay the compact edges from snapper.road_edges along `polyline` by distance. Their lengths are
    the matched lengths (the first and last edge only partly), so the running total, scaled to the
    polyline's own length, says where each one starts and ends. None if the two disagree by more
    than 5%: then it isn't this line, and the drive falls back to one cruise speed."""
    if not raw or len(polyline) < 2:
        return None
    total = geo.cumulative(polyline)[-1]
    meters = sum(float(e.get("km") or 0.0) for e in raw) * 1000.0
    if total <= 0 or meters <= 0 or abs(meters - total) > max(50.0, 0.05 * total):
        return None
    scale, s, out = total / meters, 0.0, []
    for e in raw:
        s1 = s + float(e.get("km") or 0.0) * 1000.0 * scale
        out.append(RoadEdge(
            s0=s, s1=s1, kmh=e.get("kmh"), limit_kmh=e.get("limit"), road_class=e.get("cls") or "",
            use=e.get("use") or "road", h0=e.get("h0"), h1=e.get("h1"), signal=bool(e.get("sig")),
            stop_impact=int(e.get("impact") or 0), cross=list(e.get("cross") or []),
            roundabout=bool(e.get("rb")), internal=bool(e.get("internal")),
            drive_on_right=e.get("rhs", True) is not False))
        s = s1
    out[-1].s1 = total
    return out


# ---- speeds ---------------------------------------------------------------------------------------

def edge_mps(e: RoadEdge, driver: Driver) -> float:
    lo, hi = CLASS_KMH.get(e.road_class, (25.0, 60.0))
    kmh = e.limit_kmh or min(hi, max(lo, e.kmh or lo))
    if e.use in USE_KMH:
        kmh = min(kmh, USE_KMH[e.use])
    if e.roundabout:
        kmh = min(kmh, ROUNDABOUT_KMH)
    pace = driver.pace_fast if kmh >= 80 else driver.pace_city
    return max(MIN_MPS, min(MAX_MPS, kmh * pace / 3.6))


def speed_spans(edges: list[RoadEdge], driver: Driver) -> list[tuple[float, float, float]]:
    """[(s0, s1, m/s)] over the whole drive, runs of one speed joined. A short plain-road edge that's
    slower or faster than both neighbours (a connector inside an intersection, a mis-tagged 20 m)
    takes the nearer neighbour speed instead of making the car dip or surge for nothing."""
    v = [edge_mps(e, driver) for e in edges]
    out = list(v)
    for i, e in enumerate(edges):
        if e.use != "road" or e.roundabout or not (e.internal or e.s1 - e.s0 < 25.0):
            continue
        near = [v[j] for j in (i - 1, i + 1) if 0 <= j < len(v)]
        if near and v[i] < min(near):
            out[i] = min(near)
        elif near and v[i] > max(near):
            out[i] = max(near)
    spans: list[tuple[float, float, float]] = []
    for e, speed in zip(edges, out):
        if spans and abs(spans[-1][2] - speed) < 0.3:
            spans[-1] = (spans[-1][0], e.s1, spans[-1][2])
        else:
            spans.append((e.s0, e.s1, speed))
    return spans


def typical_mps(edges: list[RoadEdge]) -> float:
    """Average moving speed over the drive for an average driver (distance over time), for the
    app's "cruise" figure and the before-it's-rendered estimate."""
    d = Driver()
    secs = sum((e.s1 - e.s0) / edge_mps(e, d) for e in edges)
    return (edges[-1].s1 - edges[0].s0) / secs if secs > 0 else MIN_MPS


# ---- controls -------------------------------------------------------------------------------------

def _light(e: RoadEdge, nxt: RoadEdge, s: float, rng) -> Control | None:
    cross = [_rank(c) for c in e.cross if _rank(c) >= 1]
    if not cross and nxt.road_class == e.road_class:
        p_red, longest = LIGHT_MIDBLOCK
    elif _rank(e.road_class) >= max(cross + [_rank(nxt.road_class)]):
        p_red, longest = LIGHT_MAIN
    else:
        p_red, longest = LIGHT_SIDE
    if rng.random() >= p_red:
        return None   # green: drive straight through
    wait = rng.uniform(2.0, longest)
    at = s - STOP_BACK_M
    if wait < ROLL_UNDER_S:
        return Control(at, "light", v_cap=rng.uniform(2.5, 5.0), why="light turning green")
    return Control(at, "light", dwell_s=float(round(wait)), why=f"red light, {round(wait)} s")


def _stop_for(e: RoadEdge, nxt: RoadEdge, s: float, rng) -> Control | None:
    """An unsignalled intersection at the end of edge e, heading onto nxt."""
    if not e.cross or e.use == "ramp" or _rank(e.road_class) >= FAST or e.roundabout:
        return None
    at = s - STOP_BACK_M
    if nxt.roundabout:
        if rng.random() < 0.3:
            return Control(at, "stop", dwell_s=float(rng.randint(1, 3)), why="gives way at the roundabout")
        return Control(at, "stop", v_cap=rng.uniform(3.0, 5.0), why="slows into the roundabout")
    ours = _rank(e.road_class)
    roads = [r for r in [_rank(c) for c in e.cross] + [_rank(nxt.road_class)] if r >= 1]
    bigger = max(roads) if roads else 0
    if e.road_class == "service_other" or e.use in ("driveway", "parking_aisle", "drive_through"):
        if bigger >= 1 and _rank(nxt.road_class) >= 1:
            return Control(at, "stop", dwell_s=float(rng.randint(2, 4)), why="pulls out onto the road")
        return None
    if bigger > ours and bigger >= 2:
        if rng.random() < 0.7:
            return Control(at, "stop", dwell_s=float(rng.randint(1, 3)), why="stop sign")
        return Control(at, "stop", v_cap=rng.uniform(1.5, 3.0), why="rolling stop")
    if bigger == ours == 1 and any(_rank(c) == 1 for c in e.cross):
        r = rng.random()
        if r < 0.3:
            return Control(at, "stop", dwell_s=float(rng.randint(1, 2)), why="all-way stop")
        if r < 0.75:
            return Control(at, "stop", v_cap=rng.uniform(4.0, 6.0), why="slows to look")
        return None
    if e.stop_impact >= 6 and ours < FAST:
        return Control(at, "stop", v_cap=rng.uniform(4.0, 6.0), why="busy intersection")
    return None


def turn_mps(angle_deg: float, drive_on_right: bool, rng) -> float:
    """How fast a driver takes a turn of this many degrees (+ right, - left). The tight side (right
    when driving on the right) is ~10 mph at 90 degrees, the wide side ~13 mph, a U-turn a crawl."""
    a = abs(angle_deg)
    tight = (angle_deg > 0) == drive_on_right
    v = (4.5 if tight else 6.0) * (90.0 / max(a, TURN_MIN_DEG)) ** 0.6
    if a >= 150:
        v = min(v, 3.0)
    return max(2.5, min(9.0, v * rng.uniform(0.9, 1.1)))


def _turns(edges: list[RoadEdge], poly, cum, rng) -> list[Control]:
    found: list[tuple[float, float, bool]] = []   # (s, angle, drive_on_right)
    for k in range(len(edges) - 1):
        e, nxt = edges[k], edges[k + 1]
        if e.roundabout or nxt.roundabout or "ramp" in (e.use, nxt.use):
            continue
        if _rank(e.road_class) >= FAST and _rank(nxt.road_class) >= FAST:
            continue   # interchanges: the curve itself slows the car
        if not e.cross and e.road_class == nxt.road_class and e.use == nxt.use:
            continue   # the road bends at a node with nothing joining: the curve handles it
        ang = geo.turn_deg(poly, cum, e.s1)
        if abs(ang) < TURN_MIN_DEG:
            continue
        if found and e.s1 - found[-1][0] < TURN_MERGE_M:
            if abs(ang) > abs(found[-1][1]):
                found[-1] = (found[-1][0], ang, e.drive_on_right)
            continue
        found.append((e.s1, ang, e.drive_on_right))
    return [Control(s, "turn", v_cap=turn_mps(ang, rhs, rng),
                    why=f"{'right' if ang > 0 else 'left'} turn, {abs(ang):.0f} deg")
            for s, ang, rhs in found]


def plan(edges: list[RoadEdge], poly, cum, driver: Driver, rng):
    """(speed spans, controls sorted by position) for one render of one drive."""
    total = cum[-1]
    spans = speed_spans(edges, driver)
    signals = [edges[k].s1 for k in range(len(edges) - 1) if edges[k].signal]
    controls: list[Control] = []
    last = -math.inf
    for k in range(len(edges) - 1):
        e, s = edges[k], edges[k].s1
        if e.signal:
            if s - last >= LIGHT_MERGE_M:   # the first signal of a cluster gets the one red/green roll
                c = _light(e, edges[k + 1], s, rng)
                if c:
                    controls.append(c)
            last = s
        elif all(abs(s - x) >= LIGHT_MERGE_M for x in signals):
            c = _stop_for(e, edges[k + 1], s, rng)
            if c:
                controls.append(c)
    controls = _merge_close(controls) + _turns(edges, poly, cum, rng)
    controls = [c for c in controls if EDGE_GAP_M <= c.s <= total - EDGE_GAP_M]
    controls.sort(key=lambda c: c.s)
    return spans, controls


def _merge_close(controls: list[Control]) -> list[Control]:
    """Lights and stops closer than TURN_MERGE_M are one intersection to a driver: keep the one that
    slows the car most (a full stop beats a slow roll, a lower cap beats a higher one)."""
    out: list[Control] = []
    for c in sorted(controls, key=lambda c: c.s):
        if out and c.s - out[-1].s < TURN_MERGE_M:
            keep = out[-1]
            if (c.dwell_s, -(c.v_cap or 0.0)) > (keep.dwell_s, -(keep.v_cap or 0.0)):
                out[-1] = Control(keep.s, c.kind, c.dwell_s, c.v_cap, c.why)
            continue
        out.append(c)
    return out
