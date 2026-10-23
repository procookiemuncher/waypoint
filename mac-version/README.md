# vida-360 — Mac version

Everything you run on the Mac. The engine itself is shared in `../core/`.

## First time

1. Install [uv](https://docs.astral.sh/uv/) if you don't have it:
   `curl -LsSf https://astral.sh/uv/install.sh | sh`
2. Run `./mac-version/setup.command` (or double-click it). Builds `.venv` on Python 3.12 and
   installs `pymobiledevice3`. Don't use the Mac's built-in `python3`, it's 3.9 and too old.
3. Install **Xcode** (needed for `drive.command` — real speed).
4. Plug in the iPhone, unlock it, tap **Trust This Computer**. Developer Mode has to be on
   (Settings → Privacy & Security → Developer Mode).

No iTunes / Apple Devices install needed — macOS already has the Apple device service built in.

## The app (Waypoint)

A real Mac app with a map: pick a route or a place, or click the map to drop a pin, and hit play.
**Drive** = real mph (Life360 shows speed + the car icon), **Spoof** = follows the route's stops and
slow-downs but shows 0 mph. The pin on the map moves on the same clock as the phone, so when it
says *arrived*, the phone's there. Closing the window stops everything and puts the phone back on
real GPS.

| What | Command |
|---|---|
| Build the Dock app (once) | `./mac-version/make-app.command` → `~/Applications/Waypoint.app` |
| Open the window from Terminal | `./mac-version/app.command` |
| Play with the UI without touching the phone | `VIDA_DRY_RUN=1 ./mac-version/app.command` |

After `make-app`, open Waypoint from Launchpad, then right-click its Dock icon → Options → Keep in
Dock. The app has this repo's path baked in, so **if you move the repo, run `make-app` again**.
Logs: `~/Library/Logs/Waypoint.log`.

## Running from Terminal

All commands from the repo root: `cd ~/Desktop/projects/vida-360`

| What | Command |
|---|---|
| **Drive with real speed** (mph + car icon) | `./mac-version/drive.command emoji-test` |
| Drive a route at a speed you pick | `./mac-version/drive.command miami-cruise --mph 25` |
| Stop a drive | `./mac-version/drive.command --clear` |
| "Where do you want to go?" menu | `./mac-version/spoof.command` (or double-click) |
| Play a route / hold a preset | `./mac-version/spoof.command miami-cruise` · `./mac-version/spoof.command eiffel` |
| Explicit coordinate | `./mac-version/spoof.command 48.8584 2.2945` |
| Clear the spoof | `./mac-version/spoof.command clear` |
| List flights / run one | `./mac-version/fly.command` · `./mac-version/fly.command nyc` |
| Life360 Observer | `.venv/bin/python core/tools/observe.py --watch` |

**`drive` vs `spoof`:** `drive` uses Xcode's location sim, which sends a real speed, so Life360
shows mph and the car icon. `spoof` uses pymobiledevice3, which can only send a position (Life360
shows 0 mph), but it follows the route's speed changes and stops. `drive` holds one speed for
the whole route for now.

If Finder blocks a double-click the first time ("unidentified developer"), right-click →
Open once, or just run it from Terminal.

## Status

Confirmed on-device (2026-10-22, iOS 27.0.1): spoof works, and `drive` gets **35 mph + the car
icon** onto Life360.
