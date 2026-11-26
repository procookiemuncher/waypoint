<p align="center">
  <img src="docs/readme/hero.svg" width="900" alt="Waypoint. From here to anywhere.">
</p>

<p align="center">
  Set your own iPhone's location from your Mac or PC: pins, real-speed drives on real roads, whole trips.<br>
  No jailbreak, no Xcode. One USB cable.
</p>

<p align="center">
  <img src="docs/readme/badges.svg" width="400" alt="macOS · Windows · Python 3.12–3.13 · iOS 17+">
</p>

<p align="center">
  <picture>
    <source srcset="docs/readme/loop.webp" type="image/webp">
    <img src="docs/readme/loop.gif" width="900" alt="The console runs play mia-to-faena-miami --drive --mph 35. The phone's location then drives from Miami International to the Faena Hotel on real roads at 35 mph, and the app reports ARRIVED.">
  </picture>
</p>

## Three steps

<p align="center">
  <img src="docs/readme/steps.png" width="900" alt="Plug in: USB cable to your Mac, phone unlocked. Pick a place: 35 spots in 28 cities, or drop a pin. Press play: hold a pin, or drive there at real speed.">
</p>

## What it does

<p align="center">
  <img src="docs/readme/features-speed.png" width="400" alt="Real speed. Drive sends a speed with every leg, so apps show mph and a trip, not a dot that teleports.">
  <img src="docs/readme/features-roads.png" width="400" alt="Real roads. A real drive from the Faena Hotel to LIV at seed 0: each road at its own speed, red lights of 6, 25 and 18 seconds, slower turns.">
  <br>
  <img src="docs/readme/features-trips.png" width="400" alt="Whole trips. fly nyc drives to MIA, goes offline for the flight, lands at JFK, drives in and stays.">
  <img src="docs/readme/features-fast.png" width="400" alt="Fast to use. ⌘K for every place and route, a globe to browse, local opening hours and time zones. The command palette with palm typed, showing Palm Jumeirah, a drive to Atlantis The Palm and more.">
</p>

## How it works

iOS ships a developer location-simulation service, the one Xcode uses. It feeds CoreLocation
directly, so every app on the phone sees the simulated position. Waypoint reaches it over Apple's
RemoteXPC tunnel with [pymobiledevice3](https://github.com/doronz88/pymobiledevice3), in three layers.

<p align="center">
  <img src="docs/readme/layers.svg" width="900" alt="Three layers: the UI talks HTTP to the Core on 127.0.0.1, the Core asks the Adapter to set, route or clear, and only the Adapter (device.py) talks to pymobiledevice3, which reaches the iPhone over USB through the RemoteXPC tunnel.">
</p>

Apple changes that transport from time to time (it broke between iOS 16 and 17). Every transport
detail lives in one module, `core/backend/device.py`, so the next break is a one-file fix.

<p align="center">
  <img src="docs/readme/services.svg" width="900" alt="Two location services. DVT simulate-location takes only latitude and longitude, so iOS reports speed -1 and apps show a dot at 0 mph. The CoreDevice location service takes waypoints and a speed, so iOS reports 15.6 m/s and apps show a drive at 35 mph.">
</p>

There are two simulation services on the phone, and the difference between them is the whole
real-speed story. The older DVT service takes a position and nothing else, so iOS reports the speed
as invalid. The CoreDevice service takes waypoints with a speed, so location-sharing apps see mph
and a moving trip. Waypoint's `spoof` engine uses the first, `drive` the second.

<p align="center">
  <img src="docs/readme/pipeline.svg" width="900" alt="The movement pipeline: route JSON, snapped to real roads by Valhalla, road data (speed limits, lights, junctions), a driver model (red lights, stop signs, turns, GPS jitter), a validator that refuses impossible speed or braking, timed fixes, and the iPhone.">
</p>

Every drive goes through the same pipeline. The driver model brakes 1.4 to 1.75 m/s² before a
cap and pulls away more gently the faster it goes; the validator refuses any route it can't
believe before a single fix reaches the phone. A route can carry a seed, and the same seed gives
the same drive call for call: lights, stops, turns, jitter and timing.

- **No Xcode, no admin, no jailbreak.** pymobiledevice3's userspace tunnel is pure Python, needs no
  driver, and mounts Apple's developer disk image itself.
- **Local only.** One FastAPI process on 127.0.0.1 that refuses any other Host header (DNS
  rebinding) and any cross-origin write.
- **Signed updates.** The Mac release build checks the download's sha256, an Ed25519 signature
  and the code signature before it swaps a new build in, and only after the app quits.
- **163 tests**, all offline: `.venv/bin/python -m unittest discover -s core/tests`

## In numbers

<p align="center">
  <img src="docs/readme/numbers.png" width="900" alt="35 spots, 28 cities, 21 countries, 6 continents, every spot lit on a world map in its country's colour.">
</p>

Every city in the catalog has its arrival airport and its time zone, and its restaurants and
clubs carry their local opening hours. Coordinates come from OpenStreetMap. The routes (airport,
hotel, spot) are generated from the catalog, and a route that fails validation is never written.

## Quickstart

<table>
<tr><th width="50%" align="left">macOS</th><th width="50%" align="left">Windows</th></tr>
<tr><td valign="top">

```sh
# Python env + pymobiledevice3 (needs uv)
./mac-version/setup.command
# Waypoint.app in ~/Applications
./mac-version/make-app.command
# or try it with no phone at all
VIDA_DRY_RUN=1 ./mac-version/app.command
```

Full guide: [mac-version/README.md](mac-version/README.md)

</td><td valign="top">

```bat
:: needs the Apple Devices app or iTunes, and uv
windows-version\setup.cmd
:: the Waypoint window
windows-version\waypoint.cmd
:: or try it with no phone at all
set VIDA_DRY_RUN=1 & windows-version\waypoint.cmd
```

Full guide: [windows-version/README.md](windows-version/README.md)

</td></tr>
</table>

Then plug the iPhone in, unlock it, tap **Trust**, and turn on Developer Mode (Settings → Privacy
& Security). The first connection downloads Apple's developer disk image, which takes a few
minutes once.

## Limits, honestly

- **Cable only.** The phone stays plugged in by USB while it plays. Closing Waypoint puts it back
  on its real GPS.
- **Unlocked and awake.** A phone that locks can drop the session.
- **Developer Mode,** which an iOS update turns off again.
- **Position, not motion.** Features built on the accelerometer, like driving reports or crash
  detection, can't be faked on a phone that is sitting still.
- **Your own phone.** Each person runs it on their own iPhone, from their own computer.
- **Windows runs from the repo:** no installer or auto-update yet.

<details>
<summary><b>For agents / future me</b></summary>
<br>

- **[AGENTS.md](AGENTS.md)**: how it works, architecture, locked decisions, ground rules. *Read first.*
- **[ROADMAP.md](ROADMAP.md)**: milestones and current focus.
- **[PROGRESS.md](PROGRESS.md)**: running dev log and current state.

| Folder | What's in it |
|---|---|
| **[mac-version/](mac-version/README.md)** | Mac launchers and the Waypoint app, including **real-speed driving**. |
| **[windows-version/](windows-version/README.md)** | Windows launchers and the Waypoint window. Same engine, real speed works there too. |
| [core/](core/README.md) | The shared engine both versions run: route engine, routes, tests. You don't run anything from here directly. |
| [docs/](docs/) | Design docs and research. `docs/readme/` holds this page's art; `docs/readme/build.sh` rebuilds it. |

Fix something in `core/` and both versions get it.

</details>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/divider-dark.svg">
    <img src="docs/readme/divider-light.svg" width="900" alt="">
  </picture>
</p>

<p align="center"><sub>
Map data © OpenStreetMap contributors (ODbL) · World outlines from Natural Earth · Routes snapped with Valhalla<br>
Inter and JetBrains Mono under the SIL Open Font License · Simulates the location of your own iPhone only
</sub></p>
