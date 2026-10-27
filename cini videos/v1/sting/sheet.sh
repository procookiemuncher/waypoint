#!/bin/sh
# contact sheet: ./sheet.sh name "f1,f2,..." cols  -> out/debug/sheet-name.png (frame numbers burned in)
set -e
cd "$(dirname "$0")"
name=$1; frames=$2; cols=${3:-4}
rm -rf "out/sheet-$name"; node render.mjs --stills "$frames" --dir "sheet-$name" > /dev/null
i=0; for f in out/sheet-$name/f*.png; do
  lab=$(basename "$f" .png | sed 's/^f0*//;s/_/./'); [ -z "$lab" ] && lab=0
  node_modules/ffmpeg-static/ffmpeg -v error -y -i "$f" -vf "scale=360:360,drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='f$lab':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6" "out/sheet-$name/s$(printf %03d $i).png"
  i=$((i+1)); done
n=$i; rows=$(( (n + cols - 1) / cols ))
node_modules/ffmpeg-static/ffmpeg -v error -y -framerate 1 -i "out/sheet-$name/s%03d.png" -vf "tile=${cols}x${rows}:padding=4:color=0x333333" -frames:v 1 "out/debug/sheet-$name.png"
echo "out/debug/sheet-$name.png"
