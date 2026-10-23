#!/bin/bash
# Double-click to list flights, or run a trip:  mac/fly.command nyc
# Choreographs an airplane-mode "flight" so Life360 pushes "arrived at <destination>".
# Read tools/fly.py header first; verify the airplane-mode tunnel gate (Step 0) once.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo
  echo "Could not find the virtual environment at .venv"
  echo "Set it up first (see mac/README.md):"
  echo "    ./mac/setup.command"
  echo
  read -r -p "Press ENTER to close..."
  exit 1
fi
"$PY" "$ROOT/tools/fly.py" "$@"
read -r -p "Press ENTER to close..."
