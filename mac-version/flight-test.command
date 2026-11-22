#!/bin/bash
# Double-click to run the Life360 Flight Detection test (MIA -> MCO):
#   mac-version/flight-test.command
# Or fallback geofence arrival:
#   mac-version/flight-test.command geofence
# Clear:
#   mac-version/flight-test.command --clear

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
"$PY" "$ROOT/core/tools/flight_test.py" "$@"
read -r -p "Press ENTER to close..."
