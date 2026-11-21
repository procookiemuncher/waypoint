# vida-360 — Windows version

Everything you run on Windows. The engine itself is shared in `..\core\`.

## First time

1. Install the **Apple Devices** app (Microsoft Store) or **iTunes** — Windows needs it for the
   Apple Mobile Device Service (usbmuxd), otherwise the phone isn't found.
2. Install [uv](https://docs.astral.sh/uv/), then run `windows-version\setup.cmd` (or
   double-click it). Builds `.venv` on Python 3.12 and installs `pymobiledevice3`.
3. Plug in the iPhone, unlock it, trust the computer, Developer Mode on.

## Running

All commands from the repo root.

| What | Command |
|---|---|
| **Waypoint app** (map, globe, palette) | double-click `windows-version\waypoint.cmd` |
| Waypoint without touching the phone | `set VIDA_DRY_RUN=1 & windows-version\waypoint.cmd` |
| Waypoint with its log in the console | `.venv\Scripts\python.exe windows-version\app.py` |
| Real-speed drive (mph + car on Life360) | `windows-version\drive.cmd emoji-test` · `windows-version\drive.cmd --clear` |
| "Where do you want to go?" menu | double-click `windows-version\spoof.cmd` |
| Play a route / hold a preset | `windows-version\spoof.cmd miami-cruise` · `windows-version\spoof.cmd eiffel` |
| Explicit coordinate | `windows-version\spoof.cmd 48.8584 2.2945` |
| Clear the spoof | `windows-version\spoof.cmd clear` |
| List flights / run one | `windows-version\fly.cmd` · `windows-version\fly.cmd nyc` |
| Life360 Observer | `.venv\Scripts\python.exe core\tools\observe.py --watch` |

The app runs in Edge WebView2 (built into Windows 11). `waypoint.cmd` has no console; its log is
`%LOCALAPPDATA%\Waypoint\Waypoint.log`. Closing the window stops what's playing and clears the
phone first (a couple of seconds). Killing it from Task Manager leaves the spoof on: recover with
`spoof.cmd clear` + `drive.cmd --clear`.

## What Windows can't do yet

- No installer or auto-update; run it from this folder.
- No airplane-mode Shortcut: `fly` asks you to toggle airplane mode by hand.
