#!/bin/bash
# Rebuilds every asset the root README shows, from source. Run it again when the app changes.
#
#   docs/readme/build.sh            everything
#   docs/readme/build.sh svg        only the hand-drawn SVGs (hero, pills, divider, diagrams)
#   docs/readme/build.sh cards      only the still cards (steps, features, numbers)
#   docs/readme/build.sh loop       only the loop
#
# Needs the repo's .venv, the trailer's node_modules (Playwright + ffmpeg, see its brief) and the
# snap cache in build/ (the route lines and road data). Nothing reaches the phone: the palette
# capture runs the app with VIDA_DRY_RUN=1. Frames go to $TMPDIR, not the iCloud-synced repo.
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
REPO=$(cd ../.. && pwd)
TRAILER="$REPO/cini videos/v2/trailer"
FF="$TRAILER/node_modules/ffmpeg-static/ffmpeg"
PY="$REPO/.venv/bin/python"
TMP="${TMPDIR:-/tmp}/waypoint-readme"
WHAT=${1:-all}
render() { (cd "$TRAILER" && node render.mjs --page "../../../docs/readme/src/$1" "${@:2}" 2>&1 | grep -v '^\[page\]' || true); }

[ -d node_modules ] || npm install --no-audit --no-fund
mkdir -p data "$TMP"

if [ "$WHAT" = all ] || [ "$WHAT" = cards ] || [ "$WHAT" = loop ]; then
  # today's catalog, routes and colours, and one real drive's speed profile
  "$PY" "$TRAILER/prep/library.py" "$HERE/data/library.js" | tail -1
  "$PY" src/profile.py faena-miami-to-liv-miami 0
fi

if [ "$WHAT" = all ] || [ "$WHAT" = svg ]; then
  node src/hero.mjs
  node src/marks.mjs
  node src/diagrams.mjs
fi

if [ "$WHAT" = all ] || [ "$WHAT" = cards ]; then
  # the real palette, from a dry-run app on a spare port
  PORT=$("$PY" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
  VIDA_DRY_RUN=1 VIDA_PORT=$PORT "$PY" "$REPO/core/backend/server.py" > "$TMP/server.log" 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null || true' EXIT
  node src/capture-app.mjs "$PORT"
  kill $SERVER; wait $SERVER 2>/dev/null || true; trap - EXIT

  rm -rf "$TMP/cards"
  render cards.html --size 900x360 --scale 2 --alpha --stills 0 --dir "$TMP/cards"
  render cards.html --size 400x300 --scale 2 --alpha --stills 1,2,3,4 --dir "$TMP/cards"
  render cards.html --size 900x420 --scale 2 --alpha --stills 5 --dir "$TMP/cards"
  cp "$TMP/cards/f0000.png" steps.png
  cp "$TMP/cards/f0001.png" features-speed.png
  cp "$TMP/cards/f0002.png" features-roads.png
  cp "$TMP/cards/f0003.png" features-trips.png
  cp "$TMP/cards/f0004.png" features-fast.png
  cp "$TMP/cards/f0005.png" numbers.png
fi

if [ "$WHAT" = all ] || [ "$WHAT" = loop ]; then
  # S6 -> S7 of the trailer at 1200x675, 30 fps: 7.9 s, the last 0.4 s dissolving into the first frame
  rm -rf "$TMP/loop" "$TMP/loopx" && mkdir -p "$TMP/loop" "$TMP/loopx"
  for r in 0-158 160-318 320-474; do
    render loop.html --frames "$r" --step 2 --scale 0.625 --dir "$TMP/loop" &
  done
  wait
  N=$(ls "$TMP/loop" | grep -cE '^[0-9]{5}\.png$'); K=12; B=$((N - K - 1))
  [ "$N" = 238 ] || { echo "expected 238 loop frames, got $N"; exit 1; }
  "$FF" -v error -y -framerate 30 -i "$TMP/loop/%05d.png" -loop 1 -framerate 30 -i "$TMP/loop/00000.png" \
    -filter_complex "[0:v][1:v]blend=shortest=1:all_expr='A*(1-clip((N-$B)/($K+1),0,1))+B*clip((N-$B)/($K+1),0,1)'" \
    -frames:v "$N" "$TMP/loopx/%05d.png"
  # rounded corners like every other card (alpha), then lossy WebP
  R=19
  "$FF" -v error -y -framerate 30 -i "$TMP/loopx/%05d.png" -filter_complex \
    "color=c=white:s=1200x675:r=30,format=gray,geq=lum='255*clip($R+0.5-hypot(max(max($R-X\,X-(W-1-$R))\,0)\,max(max($R-Y\,Y-(H-1-$R))\,0))\,0\,1)'[m];[0:v]format=rgba[v];[v][m]alphamerge,format=yuva420p" \
    -frames:v "$N" -c:v libwebp_anim -loop 0 -q:v 72 -compression_level 6 loop.webp
  # GIF fallback: smaller, 12 fps, square corners
  "$FF" -v error -y -framerate 30 -i "$TMP/loopx/%05d.png" -vf \
    "fps=12,scale=640:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
    -loop 0 loop.gif
fi

ls -la *.svg *.png *.webp *.gif 2>/dev/null | awk '{ printf "%-24s %7.0f KB\n", $9, $5 / 1024 }'
