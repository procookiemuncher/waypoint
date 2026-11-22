"""Small geometry helpers on (lat, lon) polylines, shared by the renderer and roads.py.

Distances are haversine meters, positions along a line are arc meters from its start (`cum` is
the cumulative distance at each vertex). Equirectangular local frames are fine at city scale.
"""
from __future__ import annotations

import bisect
import math

EARTH_R = 6_371_000.0
M_PER_DEG = 111_111.0      # meters per degree latitude (good enough at city scale)


def haversine(a, b) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(h))


def bearing(a, b) -> float:
    """Compass bearing a->b in radians (clockwise from north)."""
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlon = math.radians(b[1] - a[1])
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return math.atan2(x, y)


def cumulative(polyline) -> list[float]:
    cum = [0.0]
    for i in range(1, len(polyline)):
        cum.append(cum[-1] + haversine(polyline[i - 1], polyline[i]))
    return cum


def bracket(cum, d) -> int:
    """Index i (1..n-1) such that cum[i-1] <= d <= cum[i]: the polyline segment containing d."""
    i = bisect.bisect_left(cum, d)
    return min(max(i, 1), len(cum) - 1)


def interp(polyline, cum, d):
    """The point d meters along the polyline (clamped to its ends)."""
    if d <= 0:
        return polyline[0]
    if d >= cum[-1]:
        return polyline[-1]
    i = bracket(cum, d)
    d0, d1 = cum[i - 1], cum[i]
    (lat0, lon0), (lat1, lon1) = polyline[i - 1], polyline[i]
    f = (d - d0) / (d1 - d0) if d1 > d0 else 0.0
    return (lat0 + f * (lat1 - lat0), lon0 + f * (lon1 - lon0))


def heading_at(polyline, cum, d) -> float:
    i = bracket(cum, min(max(d, 0.0), cum[-1]))
    return bearing(polyline[i - 1], polyline[i])


def local_xy(origin, p):
    """Meters (east, north) of point p relative to origin."""
    de = (p[1] - origin[1]) * M_PER_DEG * math.cos(math.radians(origin[0]))
    dn = (p[0] - origin[0]) * M_PER_DEG
    return de, dn


def menger_radius(a, b, c) -> float:
    """Radius of the circle through a, b, c in meters; inf when they're (nearly) in a straight line.
    A line that folds back on itself (a hairpin, c on top of a) is in a line too, but it's the
    tightest turn there is, so that's half the shorter arm, not inf."""
    ax, ay = local_xy(b, a)
    cx, cy = local_xy(b, c)
    dab, dcb = math.hypot(ax, ay), math.hypot(cx, cy)
    if dab < 1e-6 or dcb < 1e-6:
        return math.inf
    dac = math.hypot(ax - cx, ay - cy)
    area2 = abs(ax * cy - ay * cx)          # twice the triangle area (b at the origin)
    if area2 < 1e-6 * dab * dcb:
        return min(dab, dcb) / 2.0 if ax * cx + ay * cy > 0 else math.inf
    return (dab * dcb * dac) / (2.0 * area2)


def turn_deg(polyline, cum, d, half: float = 20.0) -> float:
    """Signed heading change through the point d meters along, measured from `half` meters before
    to `half` meters after it: + = right turn, - = left, in degrees (-180..180). Measuring over a
    window instead of between neighbouring vertices keeps map-digitizing kinks out of it, and adds
    up a turn the map splits over several short edges (big intersections)."""
    total = cum[-1]
    a = interp(polyline, cum, max(0.0, d - half))
    b = interp(polyline, cum, d)
    c = interp(polyline, cum, min(total, d + half))
    if haversine(a, b) < 1.0 or haversine(b, c) < 1.0:
        return 0.0
    diff = math.degrees(bearing(b, c) - bearing(a, b))
    return (diff + 180.0) % 360.0 - 180.0
