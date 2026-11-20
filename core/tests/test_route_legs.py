"""What the side panel reads from the catalog and the route summary: one colour per country, the
arrival airport and base hotel, the ends of each generated route, and how long each part of a route
really plays (the renderer at seed 0, kept on disk, an estimate until then)."""
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["VIDA_DRY_RUN"] = "1"   # before backend imports: never touch a real phone

from backend import routes
from backend.destinations import city_info, load_catalog, load_countries, route_ends, spot_places
from backend.movement import load_route, RouteRenderer
from backend.movement.model import parse_route

CORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# a walk-only route, like The Dorchester -> Sexy Fish London: the old summary gave the walk no time
WALK = {"name": "walk-test", "label": "A → B", "city": "London", "segments": [
    {"mode": "walk", "waypoints": [[51.5072, -0.1527], [51.5090, -0.1440], [51.5098, -0.1420]]},
    {"mode": "stop", "dwell_s": 600}]}


class CatalogTest(unittest.TestCase):
    def test_every_country_has_one_colour(self):
        countries = load_countries()
        for name, c in load_catalog().items():
            self.assertIn(c["country"], countries, f"{name}'s country has no colour")
            self.assertNotIn("flag", c)
            self.assertNotIn("color", c)   # the country's colour, not the city's
        for k in countries.values():
            self.assertRegex(k["color"], r"^#[0-9a-f]{6}$")
            self.assertTrue(k["vibe"])

    def test_cities_of_a_country_share_its_colour(self):
        info = city_info()
        self.assertEqual(info["Paris"]["color"], info["Saint-Tropez"]["color"])
        self.assertEqual(info["Paris"]["color"], load_countries()["France"]["color"])
        self.assertEqual(info["Paris"]["airport_name"], load_catalog()["Paris"]["airport"]["name"])
        self.assertEqual(info["Paris"]["base"], load_catalog()["Paris"].get("base"))
        self.assertNotIn("flag", info["Paris"])

    def test_spots_carry_their_note_and_access(self):
        spots = spot_places()
        self.assertEqual(spots["liv-miami"]["note"], "Wed–Sun")
        self.assertEqual(spots["liv-miami"]["access"], "road")
        self.assertEqual(spots["liv-miami"]["accent"], load_countries()["United States"]["color"])
        boats = [s for s in spots.values() if s["access"] == "boat"]
        self.assertTrue(boats)

    def test_every_generated_route_has_its_ends(self):
        ends = route_ends()
        for path in routes.route_files():
            rid = os.path.splitext(os.path.basename(path))[0]
            data = routes.load_json(path)
            if not data.get("generated"):
                continue
            self.assertIn(rid, ends, f"{rid} has no ends")
            start, end = ends[rid]
            self.assertIn(start["kind"], ("airport", "spot"))
            self.assertEqual(end["kind"], "spot")
        self.assertEqual(ends["cdg-to-ritz-paris"][0], {"kind": "airport", "id": "CDG", "name": load_catalog()["Paris"]["airport"]["name"]})
        self.assertEqual(ends["faena-miami-to-liv-miami"][0]["id"], "faena-miami")


class LegsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patch = mock.patch.object(routes, "LEGS_DIR", self.tmp.name)
        patch.start()
        self.addCleanup(patch.stop)
        self.route = parse_route(WALK)

    def test_rendered_legs_add_up_to_the_render(self):
        legs = routes.render_legs(self.route)
        fixes = RouteRenderer(0).render(self.route)
        self.assertEqual([g["mode"] for g in legs], ["walk", "stop"])
        self.assertAlmostEqual(sum(g["s"] for g in legs), fixes[-1].t - fixes[0].t, delta=2)
        self.assertGreater(legs[0]["s"], 300)   # the walk takes real time now
        self.assertEqual(legs[1]["m"], 0)

    def test_estimate_gives_walks_time(self):
        legs = routes.estimate_legs(self.route)
        self.assertEqual([g["mode"] for g in legs], ["walk", "stop"])
        self.assertGreater(legs[0]["s"], 300)
        self.assertEqual(legs[1]["s"], 600)

    def test_cache_round_trip_and_invalidation(self):
        self.assertIsNone(routes.cached_legs(self.route))
        legs = routes.render_legs(self.route)
        routes.store_legs(self.route, legs)
        self.assertEqual(routes.cached_legs(self.route), legs)
        moved = parse_route({**WALK, "segments": [WALK["segments"][0], {"mode": "stop", "dwell_s": 300}]})
        self.assertIsNone(routes.cached_legs(moved))   # a changed route doesn't get stale times

    def test_summary_is_an_estimate_until_warmed(self):
        path = os.path.join(CORE, "routes", "the-dorchester-to-sexy-fish-london.json")
        with mock.patch.object(routes, "route_files", return_value=[path]):
            before = routes.summary(path, snap=False)
            self.assertFalse(before["exact"])
            self.assertEqual(routes.warm_legs(log=lambda line: None), 1)
            self.assertEqual(routes.warm_legs(log=lambda line: None), 0)   # already on disk
        # warm_legs snaps the route and summary(snap=False) doesn't, so ask the same way it stored them
        after = routes.summary(path)
        self.assertTrue(after["exact"])
        self.assertEqual(after["seconds"], sum(g["s"] for g in after["legs"]))
        self.assertGreater(after["seconds"], 600 + 300)   # walk + 10 min at the door, not just the stop
        self.assertTrue(after["generated"])
        self.assertEqual(after["from"]["id"], "the-dorchester")
        self.assertEqual(after["to"]["id"], "sexy-fish-london")

    def test_hand_made_routes_have_no_ends(self):
        path = os.path.join(CORE, "routes", "demo-drive.json")
        s = routes.summary(path, snap=False)
        self.assertFalse(s["generated"])
        self.assertIsNone(s["from"])
        self.assertIsNone(s["to"])


if __name__ == "__main__":
    unittest.main()
