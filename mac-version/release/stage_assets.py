"""Build-time: copy core/web + the data files into a staging tree the release build bundles, with
the web JS/CSS minified and the destination/route JSON obfuscated. The repo copies stay plain; only
what ships inside Waypoint.app gets this treatment.

    python stage_assets.py <core_dir> <out_dir>

out_dir ends up with: web/ (icons/glass/warp/app/palette/ring/globe .js + app.css minified, leaflet,
maplibre, fonts, the globe's countries.json and the map style as-is),
destinations.json, places.json, routes/ — the JSON as WPX1 blobs that backend.secret.load_json reads.
"""
import os
import shutil
import subprocess
import sys

import rcssmin
import rjsmin

CORE, OUT = sys.argv[1], sys.argv[2]
sys.path.insert(0, CORE)
from backend.secret import obfuscate   # noqa: E402

# Our own front-end files. leaflet/ and maplibre/ are third-party (already minified) and fonts/
# aren't code, so they're copied untouched.
MINIFY_JS = {"icons.js", "glass.js", "warp.js", "app.js", "palette.js", "ring.js", "globe.js"}
MINIFY_CSS = {"app.css"}


def _node_check(path):
    """If node is around, fail the build rather than ship JS a minifier quietly corrupted."""
    if shutil.which("node"):
        subprocess.run(["node", "--check", path], check=True)


def stage_web():
    src = os.path.join(CORE, "web")
    dst = os.path.join(OUT, "web")
    shutil.copytree(src, dst)
    for name in MINIFY_JS:
        p = os.path.join(dst, "static", name)
        with open(p) as f:
            out = rjsmin.jsmin(f.read())
        with open(p, "w") as f:
            f.write(out)
        _node_check(p)
    for name in MINIFY_CSS:
        p = os.path.join(dst, "static", name)
        with open(p) as f:
            out = rcssmin.cssmin(f.read())
        with open(p, "w") as f:
            f.write(out)


def obf_file(src, dst):
    with open(src, "rb") as f:
        raw = f.read()
    with open(dst, "wb") as f:
        f.write(obfuscate(raw))


def stage_data():
    for name in ("destinations.json", "places.json"):
        obf_file(os.path.join(CORE, name), os.path.join(OUT, name))
    src = os.path.join(CORE, "routes")
    dst = os.path.join(OUT, "routes")
    os.makedirs(dst, exist_ok=True)
    for name in os.listdir(src):
        if name.endswith(".json"):
            obf_file(os.path.join(src, name), os.path.join(dst, name))
        else:                                   # demo-drive.gpx etc. — not secret
            shutil.copy2(os.path.join(src, name), os.path.join(dst, name))


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    stage_web()
    stage_data()
    print(f"> staged protected assets into {OUT}")


if __name__ == "__main__":
    main()
