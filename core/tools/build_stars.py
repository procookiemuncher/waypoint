"""Turn the Yale Bright Star Catalog into the small JSON the world-view sky draws behind the globe.

The BSC (5th ed., Hoffleit & Warren, CDS V/50) is every star down to about magnitude 6.5, so the
stars you'd see by eye on a dark night, ~9,100 of them. The copy used here is brettonw's JSON
conversion of it (MIT, github.com/brettonw/YaleBrightStarCatalog): J2000 RA/Dec, V magnitude and
a colour temperature in kelvin per star.

Out comes one flat list, four numbers per star: RA and Dec in degrees (2 dp, ~0.01 deg is well under
a pixel at the sky's field of view), V magnitude (2 dp) and temperature in hundreds of kelvin. The
page works out size, brightness and tint from those, so the look can change without rebuilding this.

    .venv/bin/python core/tools/build_stars.py                     # download, write core/web/static/stars.json
    .venv/bin/python core/tools/build_stars.py --src bsc5.json     # use a local copy
    .venv/bin/python core/tools/build_stars.py --out /tmp/s.json   # write somewhere else
"""
import argparse
import json
import os
import re
import sys
import urllib.request

CORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_URL = "https://raw.githubusercontent.com/brettonw/YaleBrightStarCatalog/master/bsc5-short.json"
OUT_DEFAULT = os.path.join(CORE, "web", "static", "stars.json")
MAG_LIMIT = 6.5      # naked-eye limit; the catalog runs a little past it in places
K_DEFAULT = 6000     # a few entries have no temperature, draw them about white

NUM = re.compile(r"[-+]?\d+(?:\.\d+)?")


def ra_deg(s):
    h, m, sec = (float(x) for x in NUM.findall(s)[:3])
    return (h + m / 60 + sec / 3600) * 15


def dec_deg(s):
    d, m, sec = (abs(float(x)) for x in NUM.findall(s)[:3])
    v = d + m / 60 + sec / 3600
    return -v if s.strip().startswith("-") else v


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", help="local copy of bsc5-short.json instead of downloading it")
    ap.add_argument("--out", default=OUT_DEFAULT)
    a = ap.parse_args()

    if a.src:
        with open(a.src, encoding="utf-8") as f:
            rows = json.load(f)
    else:
        with urllib.request.urlopen(SRC_URL, timeout=60) as r:
            rows = json.load(r)

    flat, skipped = [], 0
    for row in rows:
        try:
            mag = float(row["V"])
            ra, dec = ra_deg(row["RA"]), dec_deg(row["Dec"])
        except (KeyError, ValueError, TypeError):
            skipped += 1
            continue
        if mag > MAG_LIMIT:
            continue
        try:
            k = int(float(row.get("K") or K_DEFAULT))
        except ValueError:
            k = K_DEFAULT
        flat += [round(ra, 2), round(dec, 2), round(mag, 2), round(k / 100)]

    n = len(flat) // 4
    if n < 8000:
        sys.exit(f"only {n} stars came out (expected ~9,000), not writing {a.out}")
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"source": "Yale Bright Star Catalog 5th ed. (CDS V/50), via brettonw/YaleBrightStarCatalog (MIT)",
                   "fields": ["ra", "dec", "mag", "k/100"], "stars": flat}, f, separators=(",", ":"))
    print(f"{n} stars to mag {MAG_LIMIT} ({skipped} rows without a position or magnitude) -> {a.out} "
          f"({os.path.getsize(a.out) // 1024} KB)")


if __name__ == "__main__":
    main()
