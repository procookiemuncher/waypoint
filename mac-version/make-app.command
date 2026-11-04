#!/bin/bash
# Build Waypoint.app into ~/Applications so it can live in the Dock / Launchpad. Needs clang
# (Xcode or its command line tools — you have Xcode anyway for drive.command).
# The app is a thin wrapper that runs this repo's .venv + mac-version/app.py, so it has the repo
# path baked in: if you move the repo, just run this again.
# This is the dev build: no access key, and it says DEV BUILD in the titlebar. Only the release
# build (release/build.command) asks for a key.
# LICENSE_URL=https://waypoint-key-dashboard.vercel.app ./mac-version/make-app.command to try the key gate here.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
APP="${1:-$HOME/Applications}/Waypoint.app"
LICENSE_URL="${LICENSE_URL-}"

if [ ! -x "$PY" ]; then
  echo "No .venv yet — run ./mac-version/setup.command first."
  exit 1
fi
if ! "$PY" -c "import webview" 2>/dev/null; then
  echo "pywebview missing — installing it into .venv…"
  "$HOME/.local/bin/uv" pip install --python "$PY" -r "$ROOT/requirements.txt" 2>/dev/null \
    || uv pip install --python "$PY" -r "$ROOT/requirements.txt"
fi

echo "> icon"
"$PY" "$ROOT/mac-version/app/make_icon.py" >/dev/null

echo "> $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/mac-version/app/Waypoint.icns" "$APP/Contents/Resources/Waypoint.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Waypoint</string>
  <key>CFBundleDisplayName</key><string>Waypoint</string>
  <key>CFBundleIdentifier</key><string>local.vida360.waypoint</string>
  <key>CFBundleExecutable</key><string>Waypoint</string>
  <key>CFBundleIconFile</key><string>Waypoint</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# A tiny compiled launcher that execs the venv python (same process → one Dock icon, not a
# second "Python" one). Repo path is baked in; LaunchServices gives apps a bare PATH.
REPO_C="${ROOT//\\/\\\\}"; REPO_C="${REPO_C//\"/\\\"}"
/usr/bin/clang -O2 -mmacosx-version-min=13.0 -DREPO="\"$REPO_C\"" -DLICENSE_URL="\"$LICENSE_URL\"" \
  -o "$APP/Contents/MacOS/Waypoint" "$ROOT/mac-version/app/launcher.c"
/usr/bin/codesign --force --sign - "$APP" >/dev/null 2>&1 || true

# nudge Finder/Dock to pick up the new icon
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null || true

echo
[ -n "$LICENSE_URL" ] && echo "Asks for an access key from $LICENSE_URL" || echo "No access key needed (LICENSE_URL is empty)"
echo "Done. Open it from Launchpad / ~/Applications, then right-click its Dock icon →"
echo "Options → Keep in Dock. Logs go to ~/Library/Logs/Waypoint.log."
