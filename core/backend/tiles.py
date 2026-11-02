"""Where the map's tiles come from. The page asks this server, which redirects to Stadia with the API key
if there is one, so the key stays out of the repo and the page's source. It lives in VIDA_STADIA_KEY or in
the gitignored .env at the repo root. No key (release builds, for now) = Stadia's rate limited keyless
localhost access, which is why the Referer surviving the redirect matters."""
import os
import re

STYLE = "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark"
ENV_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env")
_NAME = re.compile(r"\d+(@2x)?\.png")


def load_key(env_file: str = ENV_FILE) -> str | None:
    key = os.environ.get("VIDA_STADIA_KEY")
    if key:
        return key
    try:
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                name, _, value = line.partition("=")
                if name.strip() == "VIDA_STADIA_KEY" and value.strip():
                    return value.strip()
    except OSError:
        pass
    return None


def tile_url(z: int, x: int, name: str, key: str | None) -> str | None:
    """None when name isn't a tile, it ends up in a URL we send the page to."""
    if not _NAME.fullmatch(name):
        return None
    url = f"{STYLE}/{z}/{x}/{name}"
    return f"{url}?api_key={key}" if key else url
