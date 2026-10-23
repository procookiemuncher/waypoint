#!/bin/bash
# Drive a route with a REAL speed (Life360 shows mph + the car icon). Mac + Xcode only.
#   mac-version/drive.command emoji-test  /  mac-version/drive.command miami-cruise --mph 25  /  mac-version/drive.command --clear
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo
  echo "Could not find the virtual environment at .venv"
  echo "Set it up first (see mac-version/README.md):"
  echo "    ./mac-version/setup.command"
  echo
  read -r -p "Press ENTER to close..."
  exit 1
fi
"$PY" "$ROOT/mac-version/devicectl_route.py" "$@"
read -r -p "Press ENTER to close..."
