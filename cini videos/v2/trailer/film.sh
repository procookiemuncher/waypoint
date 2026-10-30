#!/bin/sh
# The whole trailer: 2700 frames (45 s at 60 fps) rendered in six parallel Playwright processes,
# the soundtrack, then H.264 + AAC into out/waypoint-trailer.mp4.
#
#   ./film.sh            render, build the sound, encode
#   ./film.sh encode     encode only (frames and out/audio/trailer.wav already there)
#   ./film.sh preview    half-res, every 2nd frame (30 fps) to out/preview.mp4, for timing checks
set -e
cd "$(dirname "$0")"
FF=node_modules/ffmpeg-static/ffmpeg
# ~4 GB of PNGs: kept out of the project, which sits in an iCloud-synced Desktop
FRAMES=${FRAMES:-${TMPDIR:-/tmp}/waypoint-trailer-frames}
mkdir -p out

if [ "$1" = "preview" ]; then
  P=${TMPDIR:-/tmp}/waypoint-trailer-preview; rm -rf "$P" && mkdir -p "$P"
  for r in 0-449 450-899 900-1349 1350-1799 1800-2249 2250-2699; do
    node render.mjs --frames "$r" --step 2 --scale 0.5 --dir "$P" > "out/preview-$r.log" 2>&1 &
  done
  wait
  [ -f out/audio/trailer.wav ] || node audio/build.mjs
  $FF -v error -y -framerate 30 -i "$P/%05d.png" -i out/audio/trailer.wav -map 0:v -map 1:a \
    -vf "format=yuv420p" -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 192k -shortest out/preview.mp4
  echo out/preview.mp4; exit 0
fi

if [ "$1" != "encode" ]; then
  rm -rf "$FRAMES" && mkdir -p "$FRAMES"
  for r in 0-449 450-899 900-1349 1350-1799 1800-2249 2250-2699; do
    node render.mjs --frames "$r" --dir "$FRAMES" > "out/render-$r.log" 2>&1 &
  done
  wait
  n=$(ls "$FRAMES" | grep -cE '^[0-9]{5}\.png$')
  [ "$n" = 2700 ] || { echo "expected 2700 frames, got $n"; exit 1; }
  node audio/build.mjs
fi

# RGB -> BT.709 limited range by the matrix the file is tagged with, so lavender and the city
# colours don't shift in players; aq-mode 3 and a low CRF keep the dark gradients from stepping
$FF -v error -y -framerate 60 -i "$FRAMES/%05d.png" -i out/audio/trailer.wav \
  -map 0:v -map 1:a \
  -vf "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p" \
  -c:v libx264 -preset slow -crf 14 -x264-params aq-mode=3 -profile:v high -g 120 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 320k -ar 48000 \
  -movflags +faststart out/waypoint-trailer.mp4
echo out/waypoint-trailer.mp4
