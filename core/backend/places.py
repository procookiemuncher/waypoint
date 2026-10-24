"""Static teleport presets, shared by the spoof CLI and the app. Edit core/places.json to add one;
every spot in core/destinations.json is a preset too (places.json wins on a clashing key)."""
import json
import os

from backend.destinations import spot_places

PLACES_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "places.json")


def load_places() -> dict:
    """key -> {name, region, lat, lon, zoom, accent}. Missing/broken files just add nothing."""
    try:
        with open(PLACES_FILE, encoding="utf-8") as f:
            own = json.load(f)
    except (OSError, json.JSONDecodeError):
        own = {}
    return {**spot_places(), **own}
