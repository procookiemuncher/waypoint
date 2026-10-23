"""Static teleport presets, shared by the spoof CLI and the app. Edit core/places.json to add one."""
import json
import os

PLACES_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "places.json")


def load_places() -> dict:
    """key -> {name, region, lat, lon, zoom, accent}. Empty dict if the file is missing/broken."""
    try:
        with open(PLACES_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
