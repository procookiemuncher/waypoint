"""Turn Natural Earth's 1:110m country shapes into the small JSON the world-view globe draws.

Natural Earth is public domain (naturalearthdata.com). The source GeoJSON is ~840 KB with ~170
properties per country; the globe only needs the outlines, so this keeps the rings (lon/lat, 2 dp),
the ADM0_A3 code and, for countries in core/destinations.json, the catalog's own country name so
the page can match a shape to /api/cities without an alias table of its own.

Long straight edges (the 49th parallel is a handful of points) are filled in every STEP_DEG degrees,
or they'd cut across the curve on a sphere. Lon/lat interpolation on purpose: NE's edges are straight
in lon/lat, which is also what the 49th parallel really is.

A few catalog countries are too small for 1:110m and aren't in the file at all (TINY below); the
globe gives those a dot at their city's centre instead. Any other catalog country that doesn't match
a shape is an error and nothing is written, so a misspelt country added later gets caught here.

    .venv/bin/python core/tools/build_countries.py                    # download NE, write core/web/static/countries.json
    .venv/bin/python core/tools/build_countries.py --src ne.geojson   # use a local copy
    .venv/bin/python core/tools/build_countries.py --out /tmp/c.json  # write somewhere else
"""
import argparse
import json
import math
import os
import sys
import urllib.request

CORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CORE)

from backend.destinations import load_catalog  # noqa: E402

NE_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
          "geojson/ne_110m_admin_0_countries.geojson")
OUT_DEFAULT = os.path.join(CORE, "web", "static", "countries.json")
STEP_DEG = 1.5
DP = 2

# catalog name -> the name NE uses, where they differ
ALIASES = {"United States": "United States of America"}
# not in 1:110m at all, they get a dot
TINY = {"Saint Barthélemy", "Monaco", "Singapore", "Maldives", "French Polynesia"}


def load_source(src: str) -> dict:
    if src.startswith(("http://", "https://")):
        with urllib.request.urlopen(src, timeout=60) as r:
            return json.load(r)
    with open(src, encoding="utf-8") as f:
        return json.load(f)


def densify(ring: list) -> list:
    """Add points along edges longer than STEP_DEG, round, and drop repeats. Keeps the ring closed."""
    out = []
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        n = max(1, math.ceil(max(abs(x1 - x0), abs(y1 - y0)) / STEP_DEG))
        for i in range(n):
            t = i / n
            out.append((round(x0 + (x1 - x0) * t, DP), round(y0 + (y1 - y0) * t, DP)))
    out.append((round(ring[-1][0], DP), round(ring[-1][1], DP)))
    pts = [p for i, p in enumerate(out) if i == 0 or p != out[i - 1]]
    return pts


def rings_of(geom: dict) -> list:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    out = []
    for poly in polys:
        for ring in poly:            # outer ring + holes; the page fills with evenodd
            pts = densify(ring)
            if len(pts) >= 4:
                out.append([c for p in pts for c in p])   # flat [lon, lat, lon, lat, ...]
    return out


def build(src: dict, catalog: dict) -> dict:
    wanted = {c["country"] for c in catalog.values()}
    by_name = {}
    for f in src["features"]:
        p = f["properties"]
        for k in ("ADMIN", "NAME", "NAME_LONG"):
            by_name.setdefault(p[k], f)

    named = {}
    for country in sorted(wanted):
        f = by_name.get(ALIASES.get(country, country))
        if f:
            named[f["properties"]["ADM0_A3"]] = country
        elif country not in TINY:
            raise SystemExit(f"no 1:110m shape for {country!r}: fix the name in destinations.json, "
                             f"add it to ALIASES, or to TINY if it's really too small for this scale")

    countries = []
    for f in src["features"]:
        a3 = f["properties"]["ADM0_A3"]
        c = {"a3": a3, "rings": rings_of(f["geometry"])}
        if a3 in named:
            c["name"] = named[a3]
        countries.append(c)
    return {
        "source": "Natural Earth 1:110m Admin 0 Countries (public domain), via core/tools/build_countries.py",
        "dots": sorted(wanted & TINY - set(named.values())),
        "countries": countries,
    }


def main():
    ap = argparse.ArgumentParser(description="Build the globe's country shapes from Natural Earth 1:110m.")
    ap.add_argument("--src", default=NE_URL, help="NE admin 0 countries GeoJSON, a path or a URL")
    ap.add_argument("--out", default=OUT_DEFAULT)
    a = ap.parse_args()

    catalog = load_catalog()
    if not catalog:
        raise SystemExit("couldn't read core/destinations.json")
    data = build(load_source(a.src), catalog)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    pts = sum(len(r) // 2 for c in data["countries"] for r in c["rings"])
    lit = [c["name"] for c in data["countries"] if "name" in c]
    print(f"> {len(data['countries'])} countries, {pts} points, {os.path.getsize(a.out) // 1024} KB -> {a.out}")
    print(f"  shapes for {len(lit)} catalog countries, dots for {len(data['dots'])}: {', '.join(data['dots'])}")


if __name__ == "__main__":
    main()
