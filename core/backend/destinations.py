"""The destinations catalog (core/destinations.json): cities, their arrival airport, and the spots
worth being seen at. One file feeds three things:

- the app's city/country/flag info (/api/cities), instead of a hardcoded list in app.js
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


def load_catalog() -> dict:
    """city name -> city dict (see destinations.json). Empty dict if the file is missing/broken."""
    try:
        return load_json(CATALOG_FILE)["cities"]
    except (OSError, json.JSONDecodeError, KeyError):
        return {}


def city_info(catalog: dict | None = None) -> dict:
    """What the app needs per city: country, flag, color, center, continent, tz, airport code."""
    out = {}
    for name, c in (catalog if catalog is not None else load_catalog()).items():
        out[name] = {
            "country": c["country"], "flag": c["flag"], "color": c["color"],
            "lat": c["center"][0], "lon": c["center"][1],
            "continent": c["continent"], "tz": c["tz"],
            "airport": (c.get("airport") or {}).get("code"),
        }
    return out


def spot_places(catalog: dict | None = None) -> dict:
    """Every spot as a pin preset, keyed by spot id, in the places.json shape (+ kind/hours)."""
    out = {}
    for name, c in (catalog if catalog is not None else load_catalog()).items():
        for s in c.get("spots", []):
            out[s["id"]] = {
                "name": s["name"], "region": name, "lat": s["at"][0], "lon": s["at"][1],
                "zoom": 17, "accent": c["color"], "kind": s["kind"], "hours": s.get("hours"),
            }
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
