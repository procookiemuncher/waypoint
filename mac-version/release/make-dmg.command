#!/bin/bash
# Pack the release Waypoint.app (from build.command) into a DMG on the Desktop for testers.
# APFS on purpose: Nuitka keeps data files in Contents/MacOS, their signatures live in xattrs, and an
# HFS+ image adds FinderInfo to them, so the copy a tester drags out fails codesign --strict.
set -e
OUT="${OUT:-$HOME/Library/Caches/Waypoint-release}"
VERSION="${VERSION:-0.1.0-beta.1}"
APP="$OUT/Waypoint.app"
STAGE="$HOME/Library/Caches/Waypoint-dmg"
DMG="Waypoint-$VERSION.dmg"

codesign --verify --deep --strict "$APP"
rm -rf "$STAGE" && mkdir -p "$STAGE/src"
ditto "$APP" "$STAGE/src/Waypoint.app"
xattr -dr com.apple.provenance "$STAGE/src/Waypoint.app" 2>/dev/null || true
ln -s /Applications "$STAGE/src/Applications"
hdiutil create -volname Waypoint -srcfolder "$STAGE/src" -fs APFS -format UDZO -ov "$STAGE/$DMG" -quiet

# attach sometimes fails with "Resource temporarily unavailable", it works on a retry
for i in 1 2 3 4 5; do
  M=$(hdiutil attach "$STAGE/$DMG" -nobrowse -readonly 2>/dev/null | tail -1 | awk -F'\t' '{print $NF}') && [ -n "$M" ] && break
  M=""; sleep 3
done
[ -n "$M" ] || { echo "couldn't mount the DMG to check it"; exit 1; }
codesign --verify --deep --strict "$M/Waypoint.app"
hdiutil detach "$M" -quiet

cp "$STAGE/$DMG" "$HOME/Desktop/$DMG"
echo "Done: ~/Desktop/$DMG"
