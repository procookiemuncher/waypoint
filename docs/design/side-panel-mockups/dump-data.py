"""Writes data.js for the side panel mockups: the prototype's lib.js (the app's own cities, routes and
places, from dump-lib.mjs) plus what the panel could show and lib.js doesn't carry yet.

  .venv/bin/python docs/design/side-panel-mockups/dump-data.py      (from the repo root)

Added, all read from the repo, nothing typed in:
  cities  airportName, base (the base hotel's spot id), from core/destinations.json
  places  note, access (core/destinations.json), saved = from places.json, not the catalog
  routes  generated (the route file; /api/routes doesn't send it yet), from/to (airport or spot, worked
          out from the generated id the way gen_destinations.py builds it), legs + play

legs/play come from the movement renderer at seed 0, which is the GPX Spoof plays. Drive starts from
the same render with a new seed and a little wander each run, so its time moves by a minute or so.
/api/routes' `seconds` is distance / first speed + stops: walk-only routes get no time for the walk
(The Dorchester -> Sexy Fish London says 600 s, plays 1132 s). The mockups show `play`.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../.."))
CORE = os.path.join(ROOT, "core")
sys.path.insert(0, CORE)

from backend.movement import RouteRenderer, load_route, snap_route  # noqa: E402
from backend.routes import haversine  # noqa: E402


def read_lib():
    with open(os.path.join(HERE, "../world-view-prototype/lib.js"), encoding="utf-8") as f:
        text = f.read().strip()
    return json.loads(text[text.index("=") + 1:].rstrip(";"))


def legs_of(path):
    route, _ = snap_route(load_route(path))   # cached on disk, same as the app
    fixes = RouteRenderer(0).render(route)
    legs = []
    for a, b in zip(fixes, fixes[1:]):
        m = 0.0 if b.mode == "stop" else haversine((a.lat, a.lon), (b.lat, b.lon))
        if legs and legs[-1]["mode"] == b.mode:
            legs[-1]["s"] += b.t - a.t
            legs[-1]["m"] += m
        else:
            legs.append({"mode": b.mode, "s": b.t - a.t, "m": m})
    for leg in legs:
        leg["s"], leg["m"] = round(leg["s"]), round(leg["m"])
    return legs


def ends(rid, catalog):
    """(from, to) for a generated route id: '<airport>-to-<spot>' or '<base>-to-<spot>'."""
    for city, c in catalog.items():
        ap, spots = c["airport"], {s["id"]: s for s in c["spots"]}
        for sid, s in spots.items():
            to = {"kind": "spot", "id": sid, "name": s["name"]}
            if rid == f'{ap["code"].lower()}-to-{sid}':
                return {"kind": "airport", "id": ap["code"], "name": ap["name"]}, to
            for fid, f in spots.items():
                if rid == f"{fid}-to-{sid}":
                    return {"kind": "spot", "id": fid, "name": f["name"]}, to
    return None, None


def main():
    lib = read_lib()
    with open(os.path.join(CORE, "destinations.json"), encoding="utf-8") as f:
        catalog = json.load(f)["cities"]
    with open(os.path.join(CORE, "places.json"), encoding="utf-8") as f:
        saved = json.load(f)
    spots = {s["id"]: s for c in catalog.values() for s in c["spots"]}

    for name, c in lib["cities"].items():
        cat = catalog[name]
        c["airportName"] = cat["airport"]["name"]
        c["base"] = cat.get("base")

    for p in lib["places"]:
        s = spots.get(p["id"], {})
        p["note"] = s.get("note")
        p["access"] = s.get("access")
        p["saved"] = p["id"] in saved

    for r in lib["routes"]:
        path = os.path.join(CORE, "routes", r["id"] + ".json")
        with open(path, encoding="utf-8") as f:
            r["generated"] = bool(json.load(f).get("generated"))
        r["legs"] = legs_of(path)
        r["play"] = sum(leg["s"] for leg in r["legs"])
        r["from"], r["to"] = ends(r["id"], catalog) if r["generated"] else (None, None)
        assert not r["generated"] or r["to"], f"no ends for {r['id']}"

    with open(os.path.join(HERE, "data.js"), "w", encoding="utf-8") as f:
        f.write("window.LIB = " + json.dumps(lib, ensure_ascii=False, separators=(",", ":")) + ";\n")
    gen = sum(r["generated"] for r in lib["routes"])
    print(f"data.js: {len(lib['cities'])} cities, {len(lib['routes'])} routes ({gen} generated), "
          f"{len(lib['places'])} places")


if __name__ == "__main__":
    main()
