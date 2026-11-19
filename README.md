# vida-360

Personal tool to spoof the GPS location of my own iPhone from a Mac or a Windows PC, using
iOS's built-in developer location-simulation service via
[`pymobiledevice3`](https://github.com/doronz88/pymobiledevice3). No Xcode needed.

## Pick your version

| Folder | What's in it |
|---|---|
| **[mac-version/](mac-version/README.md)** | Mac launchers. Has everything, including **real-speed driving** (Life360 shows mph + the car icon). |
| **[windows-version/](windows-version/README.md)** | Windows launchers. Spoof, routes, flights. Real speed should work too now (same pmd3 path as the Mac), but it's untested on Windows. |
| [core/](core/README.md) | The shared engine both versions run: route engine, routes, Life360 observer, tests. You don't run anything from here directly. |
| [docs/](docs/) | Design docs and research. |

Fix something in `core/` and both versions get it.

## Start here (for agents / future me)

- **[AGENTS.md](AGENTS.md)** — how it works, architecture, locked decisions, ground rules. *Read first.*
- **[ROADMAP.md](ROADMAP.md)** — milestones and current focus.
- **[PROGRESS.md](PROGRESS.md)** — running dev log / current state.

Status: **MVP in progress.** Personal use, own device.
