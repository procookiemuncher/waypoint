"""Makes web/static/map-style.json, the look of the map: OpenFreeMap's "dark" style with our colours on
top, nudged toward the Stadia dark map the app used before (lighter land, darker roads, readable labels).
The tiles, fonts and icons it points at stay on OpenFreeMap. Rerun to pick up their changes:

    python core/tools/build_map_style.py

Stops if a layer we recolour isn't upstream any more, so a rename there can't quietly bring back the
stock near-black look."""
import copy
import json
import os
import urllib.request

UPSTREAM = "https://tiles.openfreemap.org/styles/dark"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "static", "map-style.json")

ROAD, MOTORWAY, WATER, PARK = "#1c1c1e", "#18181a", "#18181a", "#2e332e"
OVERRIDES = {
    "background": {"background-color": "#2a2a2c"},
    "water": {"fill-color": WATER},
    "waterway": {"line-color": WATER},
    "landuse_residential": {"fill-color": "#2d2d2f"},
    "landcover_wood": {"fill-color": PARK},
    "landuse_park": {"fill-color": PARK},
    "building": {"fill-color": "#333336", "fill-outline-color": "#3a3a3d"},
    "highway_path": {"line-color": "#3a3a3c"},
    "highway_minor": {"line-color": ROAD},
    "highway_major_casing": {"line-color": ROAD},
    "highway_major_inner": {"line-color": ROAD},
    "highway_major_subtle": {"line-color": ROAD},
    "highway_motorway_casing": {"line-color": MOTORWAY},
    "highway_motorway_inner": {"line-color": MOTORWAY},
    "highway_motorway_subtle": {"line-color": MOTORWAY},
    "railway": {"line-color": "#555"},
    "railway_minor": {"line-color": "#444"},
    "railway_transit": {"line-color": "#444"},
    "highway_name_other": {"text-color": "#9a9a9a", "text-halo-color": ROAD},
    "highway_name_motorway": {"text-color": "#aaa"},
    "water_name": {"text-color": "#777", "text-halo-color": WATER},
}
PLACE_LABEL = {"text-color": "#b4b4b4", "text-halo-color": "rgba(0,0,0,.6)"}   # every place_* layer
# images the dark style asks for that OpenFreeMap's sprite doesn't have: they only drew nothing and
# filled the console with warnings (and the wood pattern hid the wood colour above)
DROP = {
    "landcover_wood": ("paint", "fill-pattern"),
    "place_town": ("layout", "icon-image"),
    "place_city": ("layout", "icon-image"),
    "place_city_large": ("layout", "icon-image"),
}


def tune(upstream: dict) -> dict:
    style = copy.deepcopy(upstream)
    style["name"] = "Waypoint dark (OpenFreeMap dark, recoloured)"
    layers = {l["id"]: l for l in style["layers"]}
    gone = sorted(set(OVERRIDES) - set(layers))
    if gone:
        raise ValueError(f"not in the upstream style any more: {', '.join(gone)}")
    for lid, paint in OVERRIDES.items():
        layers[lid].setdefault("paint", {}).update(paint)
    for lid, layer in layers.items():
        if lid.startswith("place_"):
            layer.setdefault("paint", {}).update(PLACE_LABEL)
    for lid, (part, prop) in DROP.items():
        if lid in layers:
            layers[lid].get(part, {}).pop(prop, None)
    return style


def main():
    req = urllib.request.Request(UPSTREAM, headers={"User-Agent": "waypoint-map-style"})   # 403s urllib's own
    with urllib.request.urlopen(req, timeout=30) as r:
        upstream = json.load(r)
    style = tune(upstream)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(style, f, indent=1)
        f.write("\n")
    print(f"wrote {OUT}: {len(style['layers'])} layers")


if __name__ == "__main__":
    main()
