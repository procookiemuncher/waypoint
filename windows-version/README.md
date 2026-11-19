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
| "Where do you want to go?" menu | double-click `windows-version\spoof.cmd` |
| Play a route / hold a preset | `windows-version\spoof.cmd miami-cruise` · `windows-version\spoof.cmd eiffel` |
| Explicit coordinate | `windows-version\spoof.cmd 48.8584 2.2945` |
| Clear the spoof | `windows-version\spoof.cmd clear` |
| List flights / run one | `windows-version\fly.cmd` · `windows-version\fly.cmd nyc` |
| Life360 Observer | `.venv\Scripts\python.exe core\tools\observe.py --watch` |

## What Windows can't do yet

**Real speed (mph + the car icon on Life360) is untested on Windows.** It used to need Xcode's
`devicectl`; since 2026-11 it goes through pymobiledevice3 like everything else, so
`.venv\Scripts\python.exe core\tools\drive.py emoji-test` should work here, but nobody has tried it.
There's no `drive.cmd` launcher yet. Spoofed drives show 0 mph on Life360.
