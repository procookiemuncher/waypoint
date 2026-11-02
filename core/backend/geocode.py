"""Address lookup for the palette, through Photon (OSM data, made for search-as-you-type, which
Nominatim's usage policy doesn't allow). Goes through the server so it sits behind the key gate
and the page never has to know Photon's field order."""
from functools import lru_cache

import requests

URL = "https://photon.komoot.io/api/"
TIMEOUT = 6
LIMIT = 6


class GeocodeError(Exception):
    pass


def _result(feature: dict) -> dict | None:
    try:
        lon, lat = feature["geometry"]["coordinates"]   # GeoJSON order
        lat, lon = float(lat), float(lon)
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None

    p = feature.get("properties") or {}
    street = " ".join(str(x) for x in (p.get("housenumber"), p.get("street")) if x)
    name = p.get("name") or street or p.get("city") or p.get("country")
    if not name:
        return None
    sub = []
    for part in (street, p.get("city"), p.get("state"), p.get("country")):
        if part and part != name and part not in sub:
            sub.append(part)

    result = {"name": name, "sub": ", ".join(sub), "lat": lat, "lon": lon, "bounds": None}
    extent = p.get("extent")   # [west, north, east, south]
    if isinstance(extent, list) and len(extent) == 4:
        try:
            west, north, east, south = (float(x) for x in extent)
            result["bounds"] = [[south, west], [north, east]]
        except (TypeError, ValueError):
            pass
    return result


@lru_cache(maxsize=128)   # backspacing shouldn't ask Photon again. Errors raise, so they aren't kept
def _lookup(q: str) -> tuple:
    try:
        r = requests.get(URL, params={"q": q, "limit": LIMIT, "lang": "en"},
                         headers={"User-Agent": "Waypoint"}, timeout=TIMEOUT)
        r.raise_for_status()
        features = r.json().get("features") or []
    except (requests.RequestException, ValueError, AttributeError) as e:
        raise GeocodeError("address search isn't reachable right now") from e

    seen, out = set(), []
    for f in features:
        res = _result(f) if isinstance(f, dict) else None
        if res and (res["name"], res["sub"]) not in seen:
            seen.add((res["name"], res["sub"]))
            out.append(res)
    return tuple(out)


def search(q: str) -> list[dict]:
    q = " ".join(q.split())[:200]
    return list(_lookup(q)) if len(q) >= 3 else []
