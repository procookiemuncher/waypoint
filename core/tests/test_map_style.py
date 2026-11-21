"""The map's look (tools/build_map_style.py -> web/static/map-style.json) and the page loading MapLibre
to draw it. No network."""
import copy
import json
import os
import re
import sys
import unittest

CORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CORE)

from tools import build_map_style as ms

WEB = os.path.join(CORE, "web")


def upstream():
    """The smallest style tune() accepts: every layer it touches, in OpenFreeMap's stock colours."""
    layers = [{"id": "background", "type": "background", "paint": {"background-color": "rgb(12,12,12)"}}]
    for lid in list(ms.OVERRIDES) + ["place_city", "place_town"] + list(ms.DROP):
        if any(l["id"] == lid for l in layers):
            continue
        layers.append({"id": lid, "type": "fill", "source": "openmaptiles",
                       "paint": {"fill-color": "#000", "fill-opacity": 0.5}, "layout": {}})
    for lid, (part, prop) in ms.DROP.items():
        next(l for l in layers if l["id"] == lid).setdefault(part, {})[prop] = "missing-image"
    return {"version": 8, "name": "Dark", "sources": {"openmaptiles": {"type": "vector"}}, "layers": layers}


class Tune(unittest.TestCase):
    def test_recolours_keeps_the_rest_and_drops_missing_images(self):
        style = ms.tune(upstream())
        by_id = {l["id"]: l for l in style["layers"]}
        for lid, paint in ms.OVERRIDES.items():
            for prop, value in paint.items():
                self.assertEqual(by_id[lid]["paint"][prop], value, f"{lid} {prop}")
        self.assertEqual(by_id["place_city"]["paint"]["text-color"], ms.PLACE_LABEL["text-color"])
        self.assertEqual(by_id["water"]["paint"]["fill-opacity"], 0.5)   # untouched props stay
        for lid, (part, prop) in ms.DROP.items():
            self.assertNotIn(prop, by_id[lid].get(part, {}), lid)

    def test_stops_when_a_layer_was_renamed_upstream(self):
        style = upstream()
        style["layers"] = [l for l in style["layers"] if l["id"] != "highway_minor"]
        with self.assertRaisesRegex(ValueError, "highway_minor"):
            ms.tune(style)

    def test_doesnt_touch_its_input(self):
        style = upstream()
        before = copy.deepcopy(style)
        ms.tune(style)
        self.assertEqual(style, before)


class Committed(unittest.TestCase):
    def setUp(self):
        with open(ms.OUT, encoding="utf-8") as f:
            self.style = json.load(f)

    def test_is_what_the_tool_makes(self):
        # tune() only sets values, so running it again on its own output changes nothing
        self.assertEqual(ms.tune(self.style), self.style)

    def test_everything_comes_from_openfreemap(self):
        s = self.style
        self.assertEqual(s["version"], 8)
        urls = [s["glyphs"], s["sprite"]]
        for src in s["sources"].values():
            urls += src.get("tiles", []) + ([src["url"]] if "url" in src else [])
        for url in urls:
            self.assertTrue(url.startswith("https://tiles.openfreemap.org/"), url)
        for layer in s["layers"]:
            if "source" in layer:
                self.assertIn(layer["source"], s["sources"], layer["id"])


class Page(unittest.TestCase):
    def test_every_static_file_the_page_and_map_ask_for_exists(self):
        with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
            html = f.read()
        with open(os.path.join(WEB, "static", "app.js"), encoding="utf-8") as f:
            app = f.read()
        wanted = re.findall(r'(?:src|href)="(static/[^"]+)"', html) + re.findall(r"'(static/[^']+\.json)'", app)
        for need in ("static/maplibre/maplibre-gl.js", "static/maplibre/leaflet-maplibre-gl.js",
                     "static/maplibre/maplibre-gl.css", "static/map-style.json"):
            self.assertIn(need, wanted)
        for path in wanted:
            self.assertTrue(os.path.isfile(os.path.join(WEB, path)), path)

    def test_maplibre_loads_after_leaflet_and_before_the_app(self):
        with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
            order = re.findall(r'<script src="static/([^"]+)"', f.read())
        self.assertLess(order.index("leaflet/leaflet.js"), order.index("maplibre/maplibre-gl.js"))
        self.assertLess(order.index("maplibre/maplibre-gl.js"), order.index("maplibre/leaflet-maplibre-gl.js"))
        self.assertLess(order.index("maplibre/leaflet-maplibre-gl.js"), order.index("app.js"))


if __name__ == "__main__":
    unittest.main()
