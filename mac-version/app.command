#!/bin/bash
# Open the Waypoint app window from Terminal (same as the Dock app make-app.command builds).
#   ./mac-version/app.command            VIDA_DRY_RUN=1 ./mac-version/app.command   (doesn't touch the phone)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "Could not find the virtual environment at .venv — run ./mac-version/setup.command first."
  exit 1
fi
exec "$PY" "$ROOT/mac-version/app.py"
