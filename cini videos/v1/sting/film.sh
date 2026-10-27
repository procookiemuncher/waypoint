#!/bin/sh
# The whole film: 720 frames (f0-f359.5, the 59.94 master) rendered in four parallel
# Playwright processes, the soundtrack, then H.264 + AAC into out/waypoint-sting.mp4.
#
#   ./film.sh            render, build the sound, encode
#   ./film.sh encode     encode only (frames/ and out/audio/sting.wav already there)
set -e
cd "$(dirname "$0")"
FF=node_modules/ffmpeg-static/ffmpeg

if [ "$1" != "encode" ]; then
  rm -rf frames && mkdir frames
  # file numbers are round(f / 0.5), so the four ranges land side by side in one folder
  for r in 0-89 90-179 180-269 270-359; do
    node render.mjs --frames "$r" --step 0.5 > "out/render-$r.log" 2>&1 &
  done
  wait
  n=$(ls frames | wc -l | tr -d ' ')
  [ "$n" = 720 ] || { echo "expected 720 frames, got $n"; exit 1; }
  node audio/build.mjs
fi

# RGB -> BT.709 limited range by the matrix the file is tagged with, so lavender and pink don't
# shift in players; aq-mode 3 and a low CRF keep the dark gradients from stepping
$FF -v error -y -framerate 60000/1001 -i frames/%05d.png -i out/audio/sting.wav \
  -map 0:v -map 1:a \
  -vf "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p" \
  -c:v libx264 -preset slow -crf 14 -x264-params aq-mode=3 -profile:v high \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 320k -ar 48000 \
  -movflags +faststart out/waypoint-sting.mp4
echo out/waypoint-sting.mp4
