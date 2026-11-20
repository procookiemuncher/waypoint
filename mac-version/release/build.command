#!/bin/bash
# Build the self-contained Waypoint.app for testers: compiled with Nuitka (Python -> C -> native),
# no repo or .venv needed on their Mac. Output: ~/Library/Caches/Waypoint-release/Waypoint.app.
# Builds outside the repo on purpose: ~/Desktop is in iCloud Drive here, and iCloud tags every file
# with xattrs that codesign refuses to sign ("resource fork, Finder information... not allowed").
#
#   ./mac-version/release/build.command                 # release build, dev switches ignored
#   ./mac-version/release/build.command --test          # honours VIDA_DRY_RUN etc, for checking it
#   VERSION=0.1.0-beta.2 ./mac-version/release/build.command
#   LICENSE_URL=https://your-dashboard.vercel.app ./mac-version/release/build.command
#   BUILD=3 ...                                         # update number, release.command sets it
#
# BUILD is the integer the auto-updater compares (backend/updater.py). 0 = never updates itself.
# Shipping to testers goes through release.command, which picks the next BUILD and publishes it.
#
# LICENSE_URL is the key dashboard (the "key dashboard" folder). With it, the app asks for an access
# key before it does anything. A release build won't build without one; a --test build can skip it.
#
# For day to day use make-app.command instead, it's instant. This one takes a while.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$ROOT/.venv/bin/python"
VERSION="${VERSION:-0.1.0-beta.1}"
BUILD="${BUILD:-0}"
TEST=False
[ "$1" = "--test" ] && TEST=True
LICENSE_URL="${LICENSE_URL:-}"
if [ -z "$LICENSE_URL" ] && [ "$TEST" = False ]; then
  echo "LICENSE_URL isn't set: a release build needs the key dashboard's address, e.g."
  echo "  LICENSE_URL=https://your-dashboard.vercel.app $0"
  exit 1
fi

if ! "$PY" -c "import nuitka, rjsmin, rcssmin" 2>/dev/null; then
  echo "> installing build tools"
  "$HOME/.local/bin/uv" pip install --python "$PY" -r "$ROOT/mac-version/release/requirements.txt" 2>/dev/null \
    || uv pip install --python "$PY" -r "$ROOT/mac-version/release/requirements.txt"
fi

OUT="${OUT:-$HOME/Library/Caches/Waypoint-release}"
STAGE="$OUT/stage"
rm -rf "$STAGE" "$OUT/Waypoint.app" "$OUT/tmp.app"   # (Waypoint.app is waypoint.app too)
mkdir -p "$STAGE"
printf 'VERSION = "%s"\nBUILD = %d\nTEST = %s\nLICENSE_URL = "%s"\n' "$VERSION" "$BUILD" "$TEST" "$LICENSE_URL" > "$STAGE/waypoint_build.py"

echo "> icon"
"$PY" "$ROOT/mac-version/app/make_icon.py" >/dev/null

# Minify the web JS/CSS and obfuscate the destination/route JSON into a staging tree, so the bundle
# doesn't ship them as readable source (stops the casual Show-Package-Contents copy, not a determined
# reverse-engineer). The repo copies stay plain; backend.secret.load_json reads either kind.
echo "> protecting web + data assets"
ASSETS="$STAGE/assets"
PYTHONPATH="$ROOT/core" "$PY" "$ROOT/mac-version/release/stage_assets.py" "$ROOT/core" "$ASSETS"

# Data lands next to the compiled modules, where the code already looks for it: backend/*.py go
# up one level for web/, routes/ and the json files, app.py looks in app/ for the icon.
echo "> compiling Waypoint $VERSION (test build: $TEST)"
cd "$STAGE"
PYTHONPATH="$ROOT/core:$ROOT/mac-version:$STAGE" "$PY" -m nuitka \
  --mode=app \
  --output-dir="$OUT" \
  --output-filename=Waypoint \
  --macos-app-name=Waypoint \
  --macos-signed-app-name=com.procookiemuncher.waypoint \
  --macos-app-version="${VERSION%%-*}" \
  --macos-app-icon="$ROOT/mac-version/app/Waypoint.icns" \
  --include-package=pymobiledevice3 \
  --include-package=uvicorn \
  --noinclude-IPython-mode=nofollow \
  --noinclude-pytest-mode=nofollow \
  --noinclude-setuptools-mode=nofollow \
  --nofollow-import-to=jedi \
  --nofollow-import-to=tkinter \
  --include-data-dir="$ASSETS/web=web" \
  --include-data-dir="$ASSETS/routes=routes" \
  --include-data-files="$ASSETS/destinations.json=destinations.json" \
  --include-data-files="$ASSETS/places.json=places.json" \
  --include-data-dir="$ROOT/core/build/snap-cache=snap-cache" \
  --include-data-files="$ROOT/mac-version/app/Waypoint.icns=app/Waypoint.icns" \
  --no-deployment-flag=self-execution \
  --assume-yes-for-downloads \
  --quiet \
  "$ROOT/mac-version/release/waypoint.py"

# Nuitka names the bundle after the script. Two steps since the file system ignores case.
mv "$OUT/waypoint.app" "$OUT/tmp.app" && mv "$OUT/tmp.app" "$OUT/Waypoint.app"
codesign --verify --deep --strict "$OUT/Waypoint.app"

# The app runs itself as pmd3 for every phone call, and a dry run skips those, so check it for real.
echo "> checking the compiled pmd3 runs"
if ! "$OUT/Waypoint.app/Contents/MacOS/Waypoint" -m pymobiledevice3 usbmux list >/dev/null; then
  echo "The compiled app can't run pmd3 (usbmux list failed), not shipping this"
  exit 1
fi
# usbmux list never loads the userspace tunnel or CoreDevice code, and drive / pins / clear all
# go through them (backend.device's -c helper), so load those too. No phone needed.
if ! "$OUT/Waypoint.app/Contents/MacOS/Waypoint" -c "from backend.device import coredevice_child; coredevice_child()" selftest >/dev/null; then
  echo "The compiled app can't load the coredevice helper (tunnel/CoreDevice imports), not shipping this"
  exit 1
fi
# the updater checks every download with Ed25519 from cryptography, make sure that compiled in
if ! "$OUT/Waypoint.app/Contents/MacOS/Waypoint" -c "from backend.updater import verify; verify(1, 'x', 'AA==')" >/dev/null; then
  echo "The compiled app can't load the updater's signature check, not shipping this"
  exit 1
fi
echo
echo "Done: $OUT/Waypoint.app"
