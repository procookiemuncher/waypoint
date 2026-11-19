#!/bin/bash
# Research probe: can the phone's speed-carrying location sim (what devicectl uses) be driven
# with pmd3 alone, no Xcode? See core/tools/probe_coredevice_location.py.
# Uses its own throwaway venv with the newest pmd3, so the app's pinned .venv stays as is.
# Reboot the phone first, then plug in + unlock it.
set -e
cd "$(dirname "$0")/.."
V="${VIDA_PROBE_VENV:-$HOME/.cache/vida-probe-venv}"
if [ ! -x "$V/bin/python" ]; then
  uv venv --python 3.12 "$V"
  VIRTUAL_ENV="$V" uv pip install "pymobiledevice3>=11.59"
fi
"$V/bin/python" core/tools/probe_coredevice_location.py "$@"
