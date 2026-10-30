#!/bin/sh
# contact sheet: ./sheet.sh name "f1,f2,..." [cols] [tileW]  -> out/sheets/name.png (frame + time burned in)
set -e
cd "$(dirname "$0")"
name=$1; frames=$2; cols=${3:-4}; tw=${4:-480}
FF=node_modules/ffmpeg-static/ffmpeg
rm -rf "out/sheet-$name"; node render.mjs --stills "$frames" --dir "sheet-$name" > "out/sheet-$name.log" 2>&1 || { cat "out/sheet-$name.log"; exit 1; }
grep -i "error" "out/sheet-$name.log" || true
th=$((tw * 9 / 16)); i=0
for f in out/sheet-$name/f*.png; do
  n=$(basename "$f" .png | sed 's/^f0*//'); [ -z "$n" ] && n=0
  sec=$(echo "scale=2; $n/60" | bc); beat=$(echo "scale=2; $n/60/0.48387096774" | bc)
  $FF -v error -y -i "$f" -vf "scale=$tw:$th,drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='f$n  ${sec}s  b$beat':x=6:y=6:fontsize=15:fontcolor=white:box=1:boxcolor=black@0.6" "out/sheet-$name/s$(printf %03d $i).png"
  i=$((i+1)); done
rows=$(( (i + cols - 1) / cols )); mkdir -p out/sheets
$FF -v error -y -framerate 1 -i "out/sheet-$name/s%03d.png" -vf "tile=${cols}x${rows}:padding=4:color=0x333333" -frames:v 1 "out/sheets/$name.png"
echo "out/sheets/$name.png"
