# vida-360 on Mac

Same tool as the Windows version. All the real code (`spoof.py`, `tools/`, `backend/`,
`data/routes/`) is shared at the repo root — this folder only has the Mac launchers.

## First time

1. Install [uv](https://docs.astral.sh/uv/) if you don't have it:
   `curl -LsSf https://astral.sh/uv/install.sh | sh`
2. Run `./mac/setup.command` (or double-click it). Builds `.venv` on Python 3.12 and installs
   `pymobiledevice3`. Don't use the Mac's built-in `python3`, it's 3.9 and too old.
3. Plug in the iPhone, unlock it, tap **Trust This Computer**. Developer Mode has to be on
   (Settings → Privacy & Security → Developer Mode).

No iTunes / Apple Devices install needed — macOS already has the Apple device service
(usbmuxd) built in. That's the main difference from Windows.

## Running

| What | Command |
|---|---|
| "Where do you want to go?" menu | `./mac/spoof.command` (or double-click) |
| Play a route / hold a preset | `./mac/spoof.command miami` · `./mac/spoof.command eiffel` |
| Explicit coordinate | `./mac/spoof.command 48.8584 2.2945` |
| Clear the spoof | `./mac/spoof.command clear` |
| List flights / run one | `./mac/fly.command` · `./mac/fly.command nyc` |
| Drive with real speed (Life360 shows mph) | `.venv/bin/python tools/devicectl_route.py data/routes/emoji-test.json` |
| Stop the devicectl drive | `.venv/bin/python tools/devicectl_route.py --clear` |
| Any other tool | `.venv/bin/python tools/observe.py --watch` |

Wherever the docs say `.venv\Scripts\python.exe tools\x.py`, the Mac equivalent is
`.venv/bin/python tools/x.py`.

If Finder blocks a double-click the first time ("unidentified developer"), right-click →
Open once, or just run it from Terminal.

## Status

Verified on a Mac (2026-10-22, no phone attached): venv builds, `usbmux list` talks to
usbmuxd fine, offline route build + all 7 movement tests pass, `fly.command` lists trips.
**Not yet tested with the phone plugged in** — first on-device run is still to do.
