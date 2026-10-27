"""Bake the dark base maps for the sting from OpenStreetMap, once, before anything renders.

Per region: coastline -> land polygons (OSM coastline has land on its left, so the clipped
pieces get closed counter-clockwise along the box edge), plus inland water, parks, roads by
class and county lines. Raw Overpass answers are cached in cache/osm/ (ignored); the processed
result lands in data/maps.js as integer Web Mercator metres relative to each region's
north-west corner, so the page never touches the network.

    python3 prep/osm.py              # every region
    python3 prep/osm.py mia stt      # just these
"""
import hashlib
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "cache", "osm")
OUT_JS = os.path.join(ROOT, "data", "maps.js")
OVERPASS_URLS = [os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
                 "https://overpass.private.coffee/api/interpreter",
                 "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
UA = "waypoint-sting-build/1.0 (personal project, one-off fetch)"

# bbox = (south, west, north, east). tol = Douglas-Peucker tolerance and min_area = smallest
# water/park ring kept, both in Mercator metres, picked from how big a pixel is in that shot.
REGIONS = {
    "nyc_thumb": dict(bbox=(40.600, -74.060, 40.800, -73.720), tol=30, min_area=70_000,
                      roads=["motorway", "trunk", "primary", "secondary"], counties=True),
    "mia": dict(bbox=(25.680, -80.360, 25.920, -80.060), tol=15, min_area=25_000,
                roads=["motorway", "trunk", "primary", "secondary"], counties=False),
    "stt": dict(bbox=(43.190, 6.550, 43.300, 6.740), tol=5, min_area=5_000,
                roads=["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
                       "residential"], counties=False),
}

ROAD_CLASS = {"motorway": "major", "trunk": "major", "primary": "primary",
              "secondary": "secondary", "tertiary": "minor", "unclassified": "minor",
              "residential": "minor"}

R = 6378137.0


def merc(lat, lon):
    """Web Mercator metres, y pointing north."""
    lat = max(min(lat, 85.0), -85.0)
    return (R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


def overpass(query, tag):
    os.makedirs(CACHE, exist_ok=True)
    key = hashlib.sha1(query.encode()).hexdigest()[:12]
    path = os.path.join(CACHE, f"{tag}-{key}.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    body = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(6):
        url = OVERPASS_URLS[attempt % len(OVERPASS_URLS)]
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.load(r)
            if "remark" in data and not data.get("elements"):
                raise RuntimeError(data["remark"][:200])
            break
        except Exception as e:  # the public servers get busy, rotate and back off
            print(f"  overpass {tag} via {url.split('/')[2]} failed: {e}")
            time.sleep(5 * (attempt + 1))
    else:
        sys.exit(f"overpass gave up on {tag}")
    with open(path, "w") as f:
        json.dump(data, f)
    return data


def bbox_str(b):
    return ",".join(f"{v:.5f}" for v in b)


def grow(b, frac):
    s, w, n, e = b
    dy, dx = (n - s) * frac, (e - w) * frac
    return (s - dy, w - dx, n + dy, e + dx)


# ---------- geometry helpers (all in Mercator metres, y north) ----------

def dp(points, tol):
    """Douglas-Peucker, iterative so long coastlines don't blow the stack."""
    if len(points) < 3:
        return points[:]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    t2 = tol * tol
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if L == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / L
                t = max(0.0, min(1.0, t))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, bi = d, i
        if best > t2:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(points, keep) if k]


def ring_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2


def join_ways(ways):
    """Chain ways that share end nodes. ways: list of (node_ids, coords). Keeps direction,
    coastline orientation matters."""
    pool = {i: (list(n), list(c)) for i, (n, c) in enumerate(ways) if len(n) >= 2}
    by_start, by_end = {}, {}
    for i, (n, _) in pool.items():
        if n[0] != n[-1]:
            by_start[n[0]] = i
            by_end[n[-1]] = i
    chains = []
    while pool:
        i, (n, c) = pool.popitem()
        if n[0] != n[-1]:
            by_start.pop(n[0], None)
            by_end.pop(n[-1], None)
        while n[0] != n[-1] and n[-1] in by_start:
            n2, c2 = pool.pop(by_start.pop(n[-1]))
            by_end.pop(n2[-1], None)
            n, c = n + n2[1:], c + c2[1:]
        while n[0] != n[-1] and n[0] in by_end:
            n2, c2 = pool.pop(by_end.pop(n[0]))
            by_start.pop(n2[0], None)
            n, c = n2 + n[1:], c2 + c[1:]
        chains.append((n, c))
    return chains


def join_rings_any_direction(ways):
    """For water/park multipolygons: member ways can point either way."""
    pending = [(list(n), list(c)) for n, c in ways if len(n) >= 2]
    rings = []
    while pending:
        n, c = pending.pop()
        grew = True
        while n[0] != n[-1] and grew:
            grew = False
            for k, (n2, c2) in enumerate(pending):
                if n2[0] == n[-1]:
                    n, c = n + n2[1:], c + c2[1:]
                elif n2[-1] == n[-1]:
                    n, c = n + n2[::-1][1:], c + c2[::-1][1:]
                else:
                    continue
                pending.pop(k)
                grew = True
                break
        if n[0] == n[-1]:
            rings.append(c)
    return rings


def clip_polyline(pts, box):
    """Cut a polyline to the box. Returns a list of pieces; each piece is (points, entered,
    exited) where entered/exited say whether the ends sit on the box edge."""
    x0, y0, x1, y1 = box

    def inside(p):
        return x0 <= p[0] <= x1 and y0 <= p[1] <= y1

    def seg_clip(p, q):
        # Liang-Barsky, returns (t_in, t_out) or None
        dx, dy = q[0] - p[0], q[1] - p[1]
        t0, t1 = 0.0, 1.0
        for pk, qk in ((-dx, p[0] - x0), (dx, x1 - p[0]), (-dy, p[1] - y0), (dy, y1 - p[1])):
            if pk == 0:
                if qk < 0:
                    return None
            else:
                t = qk / pk
                if pk < 0:
                    t0 = max(t0, t)
                else:
                    t1 = min(t1, t)
        if t0 > t1:
            return None
        return t0, t1

    def at(p, q, t):
        return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)

    pieces = []
    cur = None
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        r = seg_clip(p, q)
        if r is None:
            continue
        t0, t1 = r
        if cur is None:
            entered = t0 > 0 or not inside(p)
            cur = [at(p, q, t0) if t0 > 0 else p]
            cur_entered = entered
        cur.append(at(p, q, t1) if t1 < 1 else q)
        if t1 < 1:
            pieces.append((cur, cur_entered, True))
            cur = None
    if cur is not None:
        pieces.append((cur, cur_entered, False))
    return pieces


def perim_s(p, box):
    """Position along the box edge, counter-clockwise from the south-west corner (y north)."""
    x0, y0, x1, y1 = box
    W, H = x1 - x0, y1 - y0
    x, y = p
    e = 1e-6 * max(W, H)
    if abs(y - y0) <= e:
        return x - x0
    if abs(x - x1) <= e:
        return W + (y - y0)
    if abs(y - y1) <= e:
        return W + H + (x1 - x)
    return 2 * W + H + (y1 - y)


def land_from_coast(chains, box):
    x0, y0, x1, y1 = box
    W, H = x1 - x0, y1 - y0
    P = 2 * (W + H)
    corners = [(0.0, (x0, y0)), (W, (x1, y0)), (W + H, (x1, y1)), (2 * W + H, (x0, y1))]
    rings, pieces = [], []
    for nodes, coords in chains:
        closed = nodes[0] == nodes[-1]
        if closed and all(x0 <= p[0] <= x1 and y0 <= p[1] <= y1 for p in coords):
            rings.append(coords[:-1])
            continue
        if closed:  # start the ring outside the box so it clips like an open chain
            k = next(i for i, p in enumerate(coords) if not (x0 <= p[0] <= x1 and y0 <= p[1] <= y1))
            coords = coords[k:-1] + coords[:k + 1]
        for pts, entered, exited in clip_polyline(coords, box):
            if not entered or not exited:
                print(f"    coastline end inside the box near {pts[0] if not entered else pts[-1]}, skipped")
                continue
            pieces.append(dict(pts=pts, s_in=perim_s(pts[0], box), s_out=perim_s(pts[-1], box)))
    unused = set(range(len(pieces)))
    while unused:
        start = min(unused)
        unused.discard(start)
        ring = list(pieces[start]["pts"])
        cur = pieces[start]["s_out"]
        for _ in range(len(pieces) + 1):
            # next entry going counter-clockwise from where we left the box
            best, bd = None, None
            for k in list(unused) + [start]:
                d = (pieces[k]["s_in"] - cur) % P
                if bd is None or d < bd:
                    best, bd = k, d
            for cs, cp in sorted(corners, key=lambda c: (c[0] - cur) % P):
                if 0 < (cs - cur) % P < bd:
                    ring.append(cp)
            if best == start:
                break
            unused.discard(best)
            ring.extend(pieces[best]["pts"])
            cur = pieces[best]["s_out"]
        rings.append(ring)
    return rings


def process_region(name, cfg):
    s, w, n, e = cfg["bbox"]
    q = bbox_str(grow(cfg["bbox"], 0.25))
    b = bbox_str(cfg["bbox"])
    print(f"{name}: fetching")
    coast = overpass(f'[out:json][timeout:240];way["natural"="coastline"]({q});out geom;', name + "-coast")
    water = overpass(
        f'[out:json][timeout:240];(way["natural"="water"]({b});relation["natural"="water"]({b});'
        f'way["waterway"="riverbank"]({b});relation["waterway"="riverbank"]({b}););out geom;',
        name + "-water")
    parks = overpass(
        f'[out:json][timeout:240];(way["leisure"="park"]({b});relation["leisure"="park"]({b}););out geom;',
        name + "-parks")
    road_re = "|".join(cfg["roads"])
    roads = overpass(f'[out:json][timeout:240];way["highway"~"^({road_re})$"]({b});out geom;', name + "-roads")
    counties = None
    if cfg["counties"]:
        counties = overpass(
            f'[out:json][timeout:240];relation["boundary"="administrative"]["admin_level"="6"]({b});out geom;',
            name + "-counties")

    ox, oy = merc(n, w)  # north-west corner is the origin, y flips to point down at the end
    bx0, by0 = merc(s, w)
    bx1, by1 = merc(n, e)
    box = (bx0, by0, bx1, by1)

    def proj(geom):
        return [merc(g["lat"], g["lon"]) for g in geom]

    # coastline -> land
    cways = [(el["nodes"], proj(el["geometry"])) for el in coast["elements"] if el["type"] == "way"]
    chains = join_ways(cways)
    land = land_from_coast(chains, box)
    print(f"  coast: {len(cways)} ways -> {len(chains)} chains -> {len(land)} land rings")

    def polys(data):
        rings = []
        for el in data["elements"]:
            if el["type"] == "way" and el.get("geometry"):
                if el["nodes"][0] == el["nodes"][-1]:
                    rings.append(proj(el["geometry"])[:-1])
            elif el["type"] == "relation":
                outer = [(m.get("ref"), m["geometry"]) for m in el.get("members", [])
                         if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("geometry")]
                ways = []
                for ref, g in outer:
                    pts = proj(g)
                    # member ways carry no node ids in out geom, key their ends by rounded coords
                    ids = [(round(p[0], 1), round(p[1], 1)) for p in pts]
                    ways.append((ids, pts))
                for r in join_rings_any_direction(ways):
                    rings.append(r[:-1])
        return [r for r in rings if len(r) >= 3 and abs(ring_area(r)) >= cfg["min_area"]]

    water_r = polys(water)
    park_r = polys(parks)

    road_lines = {}
    for el in roads["elements"]:
        if el["type"] != "way" or not el.get("geometry"):
            continue
        cls = ROAD_CLASS[el["tags"]["highway"]]
        road_lines.setdefault(cls, []).append(proj(el["geometry"]))

    county_lines = []
    if counties:
        seen = set()
        for el in counties["elements"]:
            for m in el.get("members", []):
                if m.get("type") == "way" and m.get("geometry") and m.get("ref") not in seen:
                    seen.add(m.get("ref"))
                    county_lines.append(proj(m["geometry"]))

    tol = cfg["tol"]

    def pack(pts, closed):
        pts = dp(pts + [pts[0]] if closed else pts, tol)
        if closed:
            pts = pts[:-1]
            if len(pts) < 3:
                return None
        elif len(pts) < 2:
            return None
        flat = []
        for x, y in pts:
            flat += [round(x - ox), round(oy - y)]  # y down from the north edge
        return flat

    def pack_all(items, closed):
        return [p for p in (pack(i, closed) for i in items) if p]

    out = {
        "bbox": [s, w, n, e],
        "origin": [n, w],
        "size": [round(bx1 - bx0), round(by1 - by0)],
        "land": pack_all(land, True),
        "water": pack_all(water_r, True),
        "parks": pack_all(park_r, True),
        "roads": {k: pack_all(v, False) for k, v in road_lines.items()},
        "counties": pack_all(county_lines, False),
    }
    npts = sum(len(r) for r in out["land"]) // 2
    print(f"  land pts {npts}, water {len(out['water'])}, parks {len(out['parks'])}, "
          + ", ".join(f"{k} {len(v)}" for k, v in out["roads"].items())
          + f", county lines {len(out['counties'])}")
    return out


def main():
    want = sys.argv[1:] or list(REGIONS)
    existing = {}
    if os.path.exists(OUT_JS):  # keep the regions this run doesn't touch
        with open(OUT_JS) as f:
            existing = json.loads(f.read().split("window.MAPS = ", 1)[1].rstrip().rstrip(";"))
    for name in want:
        existing[name] = process_region(name, REGIONS[name])
    with open(OUT_JS, "w") as f:
        f.write("// generated by prep/osm.py from OpenStreetMap (ODbL), don't edit by hand\n")
        f.write("window.MAPS = " + json.dumps(existing, separators=(",", ":")) + ";\n")
    print(f"wrote {OUT_JS} ({os.path.getsize(OUT_JS) // 1024} KB)")


if __name__ == "__main__":
    main()
