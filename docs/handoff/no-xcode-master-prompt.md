# Master prompt: make Waypoint work without Xcode

Paste everything below the line into a fresh Claude Code session opened in
`~/Desktop/projects/vida-360`.

---

You're picking up a task in the **vida-360 / Waypoint** repo
(`~/Desktop/projects/vida-360`, GitHub remote now `procookiemuncher/waypoint`). Waypoint is a
personal Mac app (pywebview + FastAPI + a web UI) that spoofs the GPS of the owner's own iPhone over
USB so Life360 shows believable movement: places, dropped pins, drives with real speed. It uses
Apple's developer location-simulation services through `pymobiledevice3` ("pmd3"), and on the Mac
also through Xcode's `xcrun devicectl`.

**The goal:** remove the Xcode requirement from the app, so users don't have to install Xcode
(10+ GB, plus opening it once to get the developer disk image onto the phone). The research is done
and the key part is **already proven on the real phone**. Your job is to build it into the app.

## Read first (repo rules)

1. `AGENTS.md` (how it works + decisions), then the top of `PROGRESS.md` (newest entry on top),
   then `docs/research/no-xcode-speed-sim.md` (this task's research), then follow `ROADMAP.md` order.
2. When you finish, add a dated entry at the **top** of PROGRESS.md and update AGENTS.md wherever it
   says Xcode/devicectl is required.
3. Git: do it on a branch (e.g. `no-xcode`), not `main`, because the owner's Dock app runs straight
   from the repo checkout and has to keep working until this is verified. Make small commits that read
   like a human wrote them and push each one: no AI attribution, no file lists, signed commits (already
   configured, never `--no-gpg-sign`), never force-push main. Expect roughly 10-20 commits. Merge back
   with `--no-ff` only after the owner has verified on the phone.

## What's proven on the phone (2026-11-18, iPhone19,3, iOS 27.0.1, pmd3 11.59.0)

devicectl's speed-carrying location sim isn't a Mac thing. It's a **phone-side** CoreDevice service
(`/usr/libexec/dtlocationd`, which comes in with the DDI). pmd3 reaches it over the **no-admin
userspace tunnel**:

- RSD service `com.apple.coredevice.locationservice`, feature `com.apple.coredevice.feature.simulatelocation`
- Call it with pmd3's `CoreDeviceService(rsd, "com.apple.coredevice.locationservice").invoke(feature, input, action_identifier=...)`.
  pmd3's own `LocationService` class only implements `availablelocationscenarios`, so you write the rest.
- Accepted inputs (each returns `{}` right away):

```
com.apple.coredevice.action.setsimulatedlocation     {"latitude": 48.85837, "longitude": 2.29448}
com.apple.coredevice.action.startlocationsimulation  {"waypoints": [{"latitude": .., "longitude": ..}, ...],
                                                      "speed": 13.4112,                     # m/s, float
                                                      "pacing": {"interval": {"_0": 1.0}}}  # or {"distance": {"_0": 10.0}}
com.apple.coredevice.action.clearsimulatedlocation   {}
com.apple.coredevice.action.availablelocationscenarios  {}
```

  `{"interval": {"interval": 1.0}}` is rejected with "Expected to find key _0". Coordinates and speed
  must be floats.
- The route keeps playing on the phone after the tunnel closes, same as `devicectl ... route`, which
  also hands off and exits. That's why `mac-version/devicectl_route.py`'s chunk timing works.
- Working code: `core/tools/probe_coredevice_location.py` (the full probe) and the launcher
  `mac-version/probe-no-xcode.command` (its own venv at `~/.cache/vida-probe-venv`, newest pmd3).

**Not yet proven, check these yourself:**
1. **pmd3 mounting the DDI without Xcode.** In the probe run a DDI was already mounted, likely Xcode's.
   pmd3 9.33.1's `auto-mount` crashes on iOS 27 (`KeyError: 'ApBoardID'`). 11.59's mounter skips the
   Cryptex1 build identity that has no board ID, which should fix it. To test it fairly, ask the owner
   to **reboot the phone** (that unmounts the DDI), then run `./mac-version/probe-no-xcode.command`
   and confirm step [1] says "pmd3 mounted the DDI itself".
2. **Speed reaching Life360.** Last time, the 30 mph `emoji-test` route was sent this way but nobody had
   confirmed the mph + car icon on Life360 yet (no Life360 creds on this Mac). Ask the owner. October's
   devicectl test showed mph + car on another circle member's phone, and this is the same phone service,
   so it's expected to match.

## Where Xcode is used today (everything to replace)

- `mac-version/drive_engine.py`, the `drive` engine (`real_speed = True`):
  - `available()` checks `shutil.which("xcrun")`
  - `start()` steady route = `xcrun devicectl device simulate location route --route-file <json>`
  - `hold()` = `... simulate location coordinate` (the app's places/pins go through this via `session.use_placer(drive)` in `mac-version/app.py:132`)
  - `clear()` = `... simulate location clear`
  - `ChainJob` → `devicectl_route.play_chunks()` → `chunk_cmd()` for the varying-speed drive (a timed chain of route/coordinate calls)
- `mac-version/devicectl_route.py` builds the route JSON (`build_route_file`, `plan_chunks`,
  `write_chunks`), finds the device (`find_device` via `devicectl list devices`), and plays chunks.
  The route/plan logic is worth keeping. Only the transport calls change.
- `mac-version/phone_check.py` (`DevicectlReadiness`, plugged in with `session.use_readiness()`):
  lock state from `devicectl device info lockState` (`passcodeRequired`) and DDI usable from
  `devicectl device info ddiServices` (`ddiMetadata.isUsable`). Its error text tells users to open Xcode.
  Replacements: pmd3 `DeviceInfoService(rsd).get_lockstate()` and `MobileImageMounterService.is_image_mounted("Personalized")`.
  If the DDI isn't mounted, mount it (`auto_mount`) instead of telling them to open Xcode.
- `core/backend/session.py` has comments and timing tuned for devicectl (poll every 6s/20s because each
  check spawned devicectl). Update them to match.
- The airplane-mode Shortcut trick (`devicectl device process openURL shortcuts://...`) is **not in the
  app**. `core/tools/fly.py` asks for a manual toggle. Ignore it for this task.

## Constraints that will bite you

- **Ground rule: `core/backend/device.py` is the only place that talks to pmd3**, and today it does
  that by running the **pmd3 CLI as a subprocess** (`sys.executable -m pymobiledevice3 ...`,
  `--userspace`). Keep that pattern. The userspace tunnel is a process-global singleton (one per
  process), and Session expects `Job` handles with `stop()`/`poll()`.
- **The compiled release app** (`mac-version/release/build.command`, Nuitka) re-runs itself as python,
  and `mac-version/release/waypoint.py` `child()` only handles `-m pymobiledevice3 ...` and `-c <code>`.
  So any new CoreDevice helper has to run through one of those. Easiest is `-c` that imports a small
  `backend` module, or check whether pmd3 11.59's CLI already exposes something usable. Make sure the
  module gets compiled in.
- **Upgrade pmd3 9.33.1 → 11.59.0 in the app.** The pins in `requirements.txt` (pmd-pytcp 0.0.5,
  pmd-net-addr/proto 0.0.2, construct-typing 0.7.0) were there because newer deps broke 9.33.1's tunnel.
  With 11.59 an unpinned install resolved pmd-pytcp 0.3.9, pmd-net-addr/proto 0.0.3, qh3 1.9.4,
  construct 2.10.70, and the userspace tunnel worked on the phone. Rewrite the pins for 11.59 and keep
  them exact. Re-check the CLI commands `device.py` uses (`usbmux list`, `mounter auto-mount --userspace`,
  `developer dvt simulate-location set|play|clear --userspace`): they still exist in 11.59, but check
  the flags and output, because `mount()` parses what auto-mount prints.
- **Nuitka history:** the compiled app has segfaulted on new pmd3 imports before (IPython, and
  `editor` → runs → xmod, both stubbed in `waypoint.py`). After upgrading, run the real
  `./mac-version/release/build.command`. It now checks that `Waypoint -m pymobiledevice3 usbmux list`
  works, because dry runs never touch pmd3 and can't prove anything.
- **Dry runs:** `VIDA_DRY_RUN=1` makes every phone command a printed no-op (`_dry()` in device.py),
  and `VIDA_DRY_PHONE=slow|none|flaky` fakes connect-screen states. New code has to respect both.
- **Windows:** this path is pure pmd3, so the speed drive could run on Windows too. If it's cheap, move
  the drive engine into `core/` (behind device.py) instead of `mac-version/`. Windows is untested and
  isn't the priority, so don't block on it.
- Static JS added to the web UI must go into `MINIFY_JS` in `mac-version/release/stage_assets.py` and
  use single-line strings only (rjsmin). Probably not needed here.
- Anything that moves the phone shows up for the owner's whole Life360 circle. Use dry runs while you
  build, and ask before sending real locations. Always clear when done.

## Suggested order

1. Branch. Upgrade pmd3 in a fresh `.venv`, rewrite the pins, and make sure the existing pmd3 calls
   (spoof hold/play/clear, auto-mount, usbmux list) still work. Commit.
2. Add CoreDevice set/route/clear to `device.py` (or a helper it calls through `-c`), returning
   `Job`-shaped handles. Commit.
3. Switch `drive_engine.py` and the chunk player to it, keeping the route planning. Drop the
   `xcrun` requirement from `available()`. Commit per piece.
4. Replace `phone_check.py`'s devicectl calls with pmd3 lock state + DDI check, auto-mounting if
   needed. Fix the "open Xcode" message. Commit.
5. Make it work in dry runs. Run the unit tests: `core/tests/` uses stdlib unittest
   (`.venv/bin/python -m unittest discover -s core/tests`), since there's no pytest in the venv.
   Add tests for the new input-building code.
6. Run the real release build and its pmd3 check.
7. Hand off to the owner for the on-device check: reboot phone → plug in + unlock → launch the dev
   app (`./mac-version/app.command`) → confirm the connect screen goes ready with no Xcode involvement,
   drop a pin (Maps dot moves), play a drive (Life360 shows mph + car), stop (location clears).
   For a true no-Xcode test, run `sudo xcode-select -s /Library/Developer/CommandLineTools`
   temporarily or test on a Mac without Xcode. Ask the owner before switching xcode-select.
8. After the owner signs off: update AGENTS.md + PROGRESS.md, merge `--no-ff`, push.

Don't say it works until the owner has confirmed it on the phone. Report what was tested and what wasn't.
