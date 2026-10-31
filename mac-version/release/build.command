#!/bin/bash
# Build the self-contained Waypoint.app for testers: compiled with Nuitka (Python -> C -> native),
# no repo or .venv needed on their Mac. Output: dist/Waypoint.app at the repo root.
#
#   ./mac-version/release/build.command                 # release build, dev switches ignored
#   ./mac-version/release/build.command --test          # honours VIDA_DRY_RUN etc, for checking it
#   VERSION=0.1.0-beta.2 ./mac-version/release/build.command
#
# For day to day use make-app.command instead, it's instant. This one takes a while.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$ROOT/.venv/bin/python"
VERSION="${VERSION:-0.1.0-beta.1}"
TEST=False
[ "$1" = "--test" ] && TEST=True

if ! "$PY" -c "import nuitka" 2>/dev/null; then
  echo "> installing build tools"
  "$HOME/.local/bin/uv" pip install --python "$PY" -r "$ROOT/mac-version/release/requirements.txt" 2>/dev/null \
    || uv pip install --python "$PY" -r "$ROOT/mac-version/release/requirements.txt"
fi

STAGE="$ROOT/build/release"
rm -rf "$STAGE"
mkdir -p "$STAGE"
printf 'VERSION = "%s"\nTEST = %s\n' "$VERSION" "$TEST" > "$STAGE/waypoint_build.py"

echo "> icon"
"$PY" "$ROOT/mac-version/app/make_icon.py" >/dev/null

# Data lands next to the compiled modules, where the code already looks for it: backend/*.py go
# up one level for web/, routes/ and the json files, app.py looks in app/ for the icon.
echo "> compiling Waypoint $VERSION (test build: $TEST)"
cd "$STAGE"
PYTHONPATH="$ROOT/core:$ROOT/mac-version:$STAGE" "$PY" -m nuitka \
  --mode=app \
  --output-dir="$ROOT/dist" \
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
  --include-data-dir="$ROOT/core/web=web" \
  --include-data-dir="$ROOT/core/routes=routes" \
  --include-data-files="$ROOT/core/destinations.json=destinations.json" \
  --include-data-files="$ROOT/core/places.json=places.json" \
  --include-data-dir="$ROOT/core/build/snap-cache=snap-cache" \
  --include-data-files="$ROOT/mac-version/app/Waypoint.icns=app/Waypoint.icns" \
  --assume-yes-for-downloads \
  --quiet \
  "$ROOT/mac-version/release/waypoint.py"

echo
echo "Done: $ROOT/dist/Waypoint.app"
