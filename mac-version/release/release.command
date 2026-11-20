#!/bin/bash
# Ship a Waypoint release: build it, sign it, upload it, tell the key dashboard. Every copy out there
# picks it up within a few hours (backend/updater.py) and swaps itself in the next time it's quit.
# Also leaves a DMG on the Desktop for anyone new.
#
#   VERSION=0.1.0-beta.3 ./mac-version/release/release.command
#   VERSION=0.1.0-beta.3 NOTES="faster drives" ./mac-version/release/release.command
#   NO_PUBLISH=1 VERSION=... ./mac-version/release/release.command   # build + DMG only, nobody gets it
#
# Needs: a clean, pushed main (it ships what's committed), the signing key at
# ~/.config/waypoint/update_ed25519.pem (back it up, without it no installed copy can update again),
# and the Vercel CLI logged in (it pulls the dashboard's admin password + blob token on the fly,
# nothing gets saved).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$ROOT/.venv/bin/python"
DASH_DIR="${DASH_DIR:-$HOME/Desktop/projects/key dashboard}"
DASH="${DASH:-https://waypoint-key-dashboard.vercel.app}"
SIGNING_KEY="${SIGNING_KEY:-$HOME/.config/waypoint/update_ed25519.pem}"
OUT="${OUT:-$HOME/Library/Caches/Waypoint-release}"
VERSION="${VERSION:-}"
NOTES="${NOTES:-}"
VERCEL=(npx -y vercel@latest)

[ -n "$VERSION" ] || { echo "Set VERSION, e.g. VERSION=0.1.0-beta.3 $0"; exit 1; }
[ -f "$SIGNING_KEY" ] || { echo "No signing key at $SIGNING_KEY"; exit 1; }
cd "$ROOT"
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes, commit them first (a release is what's in git)"; exit 1
fi
git fetch -q origin
if [ "$(git rev-parse HEAD)" != "$(git rev-parse '@{u}')" ]; then
  echo "main isn't the same as origin, push/pull first"; exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "> pulling dashboard secrets"
(cd "$DASH_DIR" && "${VERCEL[@]}" env pull --environment production --yes "$TMP/prod.env" >/dev/null 2>&1)
envval() { grep "^$1=" "$TMP/prod.env" | head -1 | sed -e "s/^$1=//" -e 's/^"//' -e 's/"$//'; }
ADMIN="$(envval ADMIN_PASSWORD)"
BLOB="$(envval BLOB_READ_WRITE_TOKEN)"
rm -f "$TMP/prod.env"
[ -n "$ADMIN" ] && [ -n "$BLOB" ] || { echo "Couldn't get ADMIN_PASSWORD / BLOB_READ_WRITE_TOKEN from Vercel"; exit 1; }

CURRENT=$(curl -sf -H "authorization: Bearer $ADMIN" "$DASH/api/release" \
  | "$PY" -c "import json,sys; r=json.load(sys.stdin)['release']; print(r['build'] if r else 0)")
BUILD="${BUILD:-$((CURRENT + 1))}"
[ "$BUILD" -gt "$CURRENT" ] || { echo "BUILD $BUILD isn't above the live build $CURRENT, copies wouldn't take it"; exit 1; }
echo "> Waypoint $VERSION is build $BUILD (live now: $CURRENT)"

LICENSE_URL="$DASH" VERSION="$VERSION" BUILD="$BUILD" OUT="$OUT" "$ROOT/mac-version/release/build.command"
APP="$OUT/Waypoint.app"

echo "> zipping + signing"
ZIP="$TMP/Waypoint-$VERSION.zip"
ditto -c -k --keepParent "$APP" "$ZIP"   # ditto keeps the xattrs Nuitka's data-file signatures live in
SHA=$(shasum -a 256 "$ZIP" | cut -d' ' -f1)
SIZE=$(stat -f %z "$ZIP")
SIG=$(PYTHONPATH="$ROOT/core" "$PY" - "$SIGNING_KEY" "$BUILD" "$SHA" <<'EOF'
import base64, sys
from cryptography.hazmat.primitives import serialization
from backend.updater import signed_message, verify
key = serialization.load_pem_private_key(open(sys.argv[1], "rb").read(), None)
sig = base64.b64encode(key.sign(signed_message(sys.argv[2], sys.argv[3]))).decode()
assert verify(sys.argv[2], sys.argv[3], sig), "signing key doesn't match PUBLIC_KEY in updater.py"
print(sig)
EOF
)

echo "> DMG"
OUT="$OUT" VERSION="$VERSION" "$ROOT/mac-version/release/make-dmg.command"

if [ -n "${NO_PUBLISH:-}" ]; then
  echo "NO_PUBLISH set: built, not uploaded. Nobody gets this one."
  exit 0
fi

echo "> uploading ($((SIZE / 1048576)) MB)"
URL=$(cd "$DASH_DIR" && BLOB_READ_WRITE_TOKEN="$BLOB" "${VERCEL[@]}" blob put "$ZIP" \
  --pathname "waypoint/Waypoint-$VERSION.zip" --access public --add-random-suffix 2>&1 \
  | grep -oE 'https://[^ ]+\.blob\.vercel-storage\.com/[^ ]+\.zip' | head -1)
[ -n "$URL" ] || { echo "Upload didn't give back a URL"; exit 1; }
# make sure what's up there is byte for byte what got signed
[ "$(curl -sfL "$URL" | shasum -a 256 | cut -d' ' -f1)" = "$SHA" ] || { echo "Uploaded file doesn't match"; exit 1; }

echo "> publishing"
BODY=$("$PY" -c 'import json,sys; print(json.dumps(dict(zip(["build","version","url","size","sha256","sig","notes"], [int(sys.argv[1]), *sys.argv[2:4], int(sys.argv[4]), *sys.argv[5:]]))))' \
  "$BUILD" "$VERSION" "$URL" "$SIZE" "$SHA" "$SIG" "$NOTES")
curl -sf -X PUT -H "authorization: Bearer $ADMIN" -H "content-type: application/json" \
  --data "$BODY" "$DASH/api/release" >/dev/null || { echo "Dashboard refused the release"; exit 1; }

git tag -a "v$VERSION" -m "Waypoint $VERSION (build $BUILD)" && git push -q origin "v$VERSION" || echo "(tag not pushed)"
echo
echo "Live: Waypoint $VERSION, build $BUILD. Installed copies pick it up within ~3 h and swap on quit."
echo "DMG for new people: ~/Desktop/Waypoint-$VERSION.dmg"
