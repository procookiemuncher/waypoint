#!/bin/bash
# Double-click for the "where do you want to go?" menu, or run:
#   mac-version/spoof.command miami  /  mac-version/spoof.command eiffel  /  mac-version/spoof.command 48.8584 2.2945  /  mac-version/spoof.command clear
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
"$PY" "$ROOT/core/spoof.py" "$@"
read -r -p "Press ENTER to close..."
