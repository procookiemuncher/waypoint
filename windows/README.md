# vida-360 on Windows

The original setup. All the real code (`spoof.py`, `tools/`, `backend/`, `data/routes/`) is
shared at the repo root — this folder only has the Windows launchers.

## First time

1. Install the **Apple Devices** app (Microsoft Store) or **iTunes** — Windows needs it for the
   Apple Mobile Device Service (usbmuxd), otherwise `usbmux list` fails with a socket error.
2. From the repo root: `uv venv --python 3.12` then `uv pip install -r requirements.txt`
   (3.12 or 3.13, not 3.14 — see docs/BUILD_PLAN.md).
3. Plug in the iPhone, unlock it, trust the computer, Developer Mode on.

## Running

| What | Command |
|---|---|
| "Where do you want to go?" menu | double-click `windows\spoof.cmd` |
| Play a route / hold a preset | `windows\spoof.cmd miami` · `windows\spoof.cmd eiffel` |
| Explicit coordinate | `windows\spoof.cmd 48.8584 2.2945` |
| Clear the spoof | `windows\spoof.cmd clear` |
| List flights / run one | `windows\fly.cmd` · `windows\fly.cmd nyc` |
| Any other tool | `.venv\Scripts\python.exe tools\observe.py --watch` |
