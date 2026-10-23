#!/bin/bash
# One-time setup on a Mac: creates .venv (Python 3.12) and installs pymobiledevice3.
# Needs uv (https://docs.astral.sh/uv/). macOS's built-in python3 is 3.9, too old.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if ! command -v uv >/dev/null; then
  echo "uv isn't installed. Get it with:  curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi
uv venv --python 3.12
uv pip install -r requirements.txt
echo
echo "Done. Plug in the iPhone, unlock it, then try:  ./mac/spoof.command"
