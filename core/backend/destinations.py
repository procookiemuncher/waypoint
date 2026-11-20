"""The destinations catalog (core/destinations.json): cities, their arrival airport, and the spots
worth being seen at. One file feeds three things:

- the app's city/country info and the country colours (/api/cities), instead of a hardcoded list in app.js
- a pin preset per spot, merged into load_places() so spoof.py and the app both get them
- core/tools/gen_destinations.py, which writes the airport -> hotel -> spot routes into core/routes/

Coordinates are (lat, lon). Each was looked up on OpenStreetMap, not typed from memory.
"""
import json
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from backend.secret import load_json

CATALOG_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "destinations.json")


def _load() -> dict:
    try:
        return load_json(CATALOG_FILE)
    except (OSError, json.JSONDecodeError):
        return {}


def load_catalog() -> dict:
    """city name -> city dict (see destinations.json). Empty dict if the file is missing/broken."""
    return _load().get("cities") or {}


def load_countries() -> dict:
    """country name -> {color, vibe}: one colour per country, for the globe and its routes."""
    return _load().get("countries") or {}


def city_info(catalog: dict | None = None, countries: dict | None = None) -> dict:
    """What the app needs per city: country (+ its colour and vibe), center, continent, tz, the
    arrival airport's code and name, the base hotel's spot id."""
    countries = countries if countries is not None else load_countries()
    out = {}
    for name, c in (catalog if catalog is not None else load_catalog()).items():
        k = countries.get(c["country"]) or {}
        ap = c.get("airport") or {}
        out[name] = {
            "country": c["country"], "color": k.get("color"), "vibe": k.get("vibe"),
            "lat": c["center"][0], "lon": c["center"][1],
            "continent": c["continent"], "tz": c["tz"],
            "airport": ap.get("code"), "airport_name": ap.get("name"), "base": c.get("base"),
        }
    return out


def spot_places(catalog: dict | None = None, countries: dict | None = None) -> dict:
    """Every spot as a pin preset, keyed by spot id, in the places.json shape (+ kind/hours/note/access)."""
    countries = countries if countries is not None else load_countries()
    out = {}
    for name, c in (catalog if catalog is not None else load_catalog()).items():
        color = (countries.get(c["country"]) or {}).get("color")
        for s in c.get("spots", []):
            out[s["id"]] = {
                "name": s["name"], "region": name, "lat": s["at"][0], "lon": s["at"][1],
                "zoom": 17, "accent": color, "kind": s["kind"], "hours": s.get("hours"),
                "note": s.get("note"), "access": s.get("access", "road"),
            }
    return out


def route_ends(catalog: dict | None = None) -> dict:
    """generated route id -> (from, to), worked out the way gen_destinations.py names them:
    '<airport code>-to-<spot>' and '<base>-to-<spot>'. Each end is {kind: airport|spot, id, name}."""
    out = {}
    for c in (catalog if catalog is not None else load_catalog()).values():
        ap = c.get("airport") or {}
        spots = c.get("spots", [])
        for s in spots:
            to = {"kind": "spot", "id": s["id"], "name": s["name"]}
            if ap.get("code"):
                out[f'{ap["code"].lower()}-to-{s["id"]}'] = ({"kind": "airport", "id": ap["code"], "name": ap.get("name")}, to)
            for f in spots:
                if f is not s:
                    out[f'{f["id"]}-to-{s["id"]}'] = ({"kind": "spot", "id": f["id"], "name": f["name"]}, to)
    return out


def is_open(hours, tz: str, now: datetime | None = None) -> bool | None:
    """hours = [open_hour, close_hour] in local time; close < open means it runs past midnight.
    None (a hotel, a beach) means always fine. Returns None when there are no hours."""
    if not hours:
        return None
    h = (now or datetime.now(ZoneInfo(tz))).astimezone(ZoneInfo(tz))
    t = h.hour + h.minute / 60
    start, end = hours
    return start <= t < end if start < end else (t >= start or t < end)
