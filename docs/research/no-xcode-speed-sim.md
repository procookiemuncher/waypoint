---
title: Dropping Xcode — the speed location sim and the airplane-mode Shortcut over plain pmd3
status: device-verified         # research | device-verified | superseded
last_verified: 2026-11-21
device_verified: full           # 2026-11-19 Mac: set / route with speed / clear / DDI mount. 2026-11-21 Windows: opening a URL (airplane Shortcut) + tunnel reaching the phone in airplane mode
open_gates: []
depends_on: []
source_tier: mixed              # primary (pmd3 source, CoreDeviceUtilities symbols, the phone's own RSD list) + one OSS project's code for payloadURL (DIYgod/pinky)
recheck_if: [pmd3 version bump, iOS update, Xcode/CoreDevice version bump (coreDeviceVersion 629.3), phone refuses a launch or location input]
---

# Dropping Xcode: the speed location sim over plain pmd3 (2026-11-18)

**Status (2026-11-19, on-device, iOS 27.0.1, iPhone19,3, pmd3 11.59.0): DONE, built into the app.**
The owner confirmed on the phone: a pin through `setsimulatedlocation` shows in Maps and stays after
our helper process exits, a steady 30 mph `startlocationsimulation` shows **mph + the car icon on
Life360**, the varying-speed chain (one call per chunk, ~0.8s each) shows a changing mph, and
`clearsimulatedlocation` stops it. pmd3 mounted its own DDI: Xcode's image came back by itself after a
reboot (Xcode's CoreDeviceService runs on this Mac), so we unmounted it with `mounter
umount-personalized`, saw it stay off for 30s, and the app's connect path then downloaded the Cryptex1
DDI, had it signed and mounted it in 10s ("DeveloperDiskImage mounted successfully", image 651.32,
not Xcode's 651.13.5). Code: `core/backend/device.py` (`CoreDevice`, `coredevice_child`),
`core/backend/drive.py`, lock state in `Pmd3.lock_state`.

Working shapes (feature `com.apple.coredevice.feature.simulatelocation` on `com.apple.coredevice.locationservice`):

```
setsimulatedlocation     {"latitude": 48.85837, "longitude": 2.29448}
startlocationsimulation  {"waypoints": [{"latitude": .., "longitude": ..}, ...],
                          "speed": 13.4112,                       # m/s, a double
                          "pacing": {"interval": {"_0": 1.0}}}    # or {"distance": {"_0": 10.0}}
clearsimulatedlocation   {}
```

The call returns `{}` right away and the phone keeps playing after the tunnel closes, like devicectl.
`{"interval": {"interval": 1.0}}` is refused with "Expected to find key _0".

## Why we need Xcode today

Every Xcode dependency goes through `xcrun devicectl` in `mac-version/`:

| What | Where | Replacement without Xcode |
|---|---|---|
| route with real speed (`simulate location route --speed`) | `drive_engine.py`, `devicectl_route.py` | CoreDevice `startlocationsimulation` (below) |
| hold a pin (`simulate location coordinate`) | `drive_engine.py` (placer) | CoreDevice `setsimulatedlocation` |
| clear | `drive_engine.py` | CoreDevice `clearsimulatedlocation` |
| lock state | `phone_check.py` | ~~pmd3 `DeviceInfoService.get_lockstate()`~~ refused on iOS 27 ("Action 'com.apple.coredevice.feature.getlockstate' is not implemented", also with action ids `...action.lockstate` / `...action.getlockstate`). **Used instead: lockdown `PasswordProtected`** (`lockdown get "" PasswordProtected`), true while locked and false once unlocked, same as devicectl's `passcodeRequired`, checked both ways on the phone. Plain USB, no tunnel |
| DDI usable | `phone_check.py` | just run `mounter auto-mount` once per plug-in; 11.59 says "already mounted" (exit 0) or mounts it, and exits non-zero when it can't |
| airplane-mode Shortcut (`process openURL shortcuts://…`) | airplane flow | **CoreDevice `launchapplication` with the URL in `options.payloadURL`** (2026-11-21, Windows, see "Opening a URL" below). `CoreDevice.airplane(on)` in device.py, used by `fly` |
| the DDI itself | Xcode mounted it; pmd3 9.33.1 `auto-mount` crashes (`KeyError: 'ApBoardID'`) | pmd3 11.59 skips the Cryptex1 identity that has no board ID, which should fix it |

## What devicectl actually calls

The speed sim is not a Mac-side thing. It's a service on the **phone**:

- Xcode ships the device-side launchd plist `com.apple.coredevice.dtlocationd`: program
  `/usr/libexec/dtlocationd`, Mach service `com.apple.coredevice.feature.simulatelocation`.
  It comes in with the DDI.
- Over RSD it shows up as `com.apple.coredevice.locationservice`. pmd3 already has a
  `LocationService` stub for it (`remote/core_device/location_service.py`), but it only
  implements `availablelocationscenarios`, even on the newest 11.59.0.
- From `CoreDeviceUtilities` (symbols + strings) the actions are:
  - `com.apple.coredevice.action.setsimulatedlocation`, input `SimulatedLocation {latitude, longitude}`
  - `com.apple.coredevice.action.startlocationsimulation`, input `{waypoints: [SimulatedLocation], speed, pacing}`
    where `pacing` is a Swift enum `distance(distance)` / `interval(interval)` (matches devicectl's
    `--mode distance|interval`)
  - `com.apple.coredevice.action.clearsimulatedlocation`
  - plus `availablelocationscenarios` and `setlocationscenario`
- `devicectl ... route` returns right away (`devicectl_route.py` launches chunks on a timer), so
  the phone plays the route itself. One call per chunk, no host session kept open. That also
  matches the "one speed per call" limit.

Still guessed: how the `pacing` enum is encoded (`{"interval": {"interval": 1.0}}` vs
`{"interval": {"_0": 1.0}}`) and whether the input needs an outer wrapper. The probe tries
several shapes and prints the phone's decode error for each.

## Why it's worth it

- No Xcode for users (it's ~10+ GB, and they'd need to open it once to get the DDI on the phone).
- It's pure pmd3, so the **speed path works on Windows too**. Drive could move from
  `mac-version/` into `core/backend/device.py`, back to the same code on both platforms.
- One transport instead of two (pmd3 DVT for spoof, devicectl for drive).

## Risks

- `isSimulatedBySoftware`: same Apple sim family as devicectl, so it doesn't change anything.
  Whatever devicectl gets, this gets.
- Upgrading pmd3 9.33.1 → 11.x in the app: the pins in `requirements.txt` exist because newer
  deps broke the tunnel before, and the Nuitka release build has segfaulted on new imports
  (xmod / IPython stubs). The upgrade has to pass `release/build.command`'s real pmd3 check.
  The probe uses its own venv so the app isn't touched until it's proven.
- Apple can change the CoreDevice input format with an Xcode/iOS update. devicectl hides that
  from us today. pmd3 sends `coreDeviceVersion` 629.3 and we'd have to keep up.

## How to run the probe

1. **Reboot the phone.** Xcode's DDI stays mounted until reboot, and we need to see pmd3 mount its own.
2. Plug in with the cable, unlock.
3. `./mac-version/probe-no-xcode.command` (makes `~/.cache/vida-probe-venv` the first time).
4. It mounts the DDI, lists services, then sets a pin at the Eiffel Tower (check Maps), then plays
   a ~1 km route at 25 mph (`--mph` to change). Have a circle member check Life360 for mph + the car.
5. Paste the output back. The accepted shapes go into `core/backend/device.py`.

## What got built (2026-11-19)

- `device.py` `CoreDevice`: `set_cmd` / `route_cmd` / `clear_cmd` build `python -c <helper> <action>
  <json | @file>` commands. The helper (`coredevice_child`) opens a userspace tunnel, sends one invoke
  and exits; routes go through a file so a long one fits a Windows command line. Input builders
  (`cd_point`, `cd_route_input`, `cd_input`) force floats and the `{"interval": {"_0": s}}` pacing.
  `selftest` only imports the tunnel + CoreDevice code; `release/build.command` runs it on the compiled
  app (the compiled app also passed a real `scenarios` call to the phone).
- pmd3 11.59.0's CLI has `developer core-device location available-scenarios` only, and
  `get-lockstate` fails on iOS 27, hence the helper and the lockdown lock check.
- Each call is ~1s (process start + tunnel 0.2-0.3s). devicectl was ~1s too.
- Seen once: after clearing a route Maps kept a grey dot on the last spoofed point until Location
  Services was toggled. The next clear was clean. Not known whether devicectl did the same.
- Still on devicectl: only the airplane-mode Shortcut (`process openURL`), which isn't in the app.
  pmd3 11.59 has `core-device launch-application`; whether it takes a URL is unchecked.
  (Done 2026-11-21, below. Nothing calls devicectl any more.)

## Opening a URL: the airplane-mode Shortcut (2026-11-21, Windows, iOS 27.2.1, pmd3 11.59.0)

- **No CoreDevice feature just opens a URL.** The phone's RSD list (85 services) has none. The
  closest thing is `com.apple.coredevice.appservice` → `com.apple.coredevice.feature.launchapplication`.
  The other appservice features: installapp, installroot, listapps, listprocesses, listroots,
  monitorprocesstermination, rebootdevice, sendmemorywarningtoprocess, sendsignaltoprocess,
  spawnexecutable, streamapplist, streamprocesslist, uninstallapp, uninstallroot.
- **The URL rides the launch as `options.payloadURL = {"relative": "<url>"}`**, the field devicectl's
  `process launch --payload-url` fills. pmd3's `AppServiceService.launch_application` has no slot for
  it (its `extra_options` go into `platformSpecificOptions`), so `device.py` builds the input itself
  (`cd_launch_input`) and sends it through `CoreDeviceService.invoke`. No pmd3 upgrade.
- Source of the shape: DIYgod/pinky's Go driver (`internal/driver/ios/apps.go`), which opened links in
  Safari this way on iOS 27 and found `__PayloadURL` inside `platformSpecificOptions` did nothing. We
  never tried the `platformSpecificOptions` form. **devicectl itself wasn't captured** (this was on
  Windows), so "devicectl's openURL sends this" is inferred, not seen.
- **On the phone**, bundle `com.apple.shortcuts`, `user: {"active": true}`:
  - `shortcuts://open-shortcut?name=vida-airplane-on` opened that Shortcut's editor (URL delivered,
    nothing ran).
  - `shortcuts://run-shortcut?name=vida-ping` (a throwaway Vibrate Shortcut) ran silently, no prompt,
    with Shortcuts closed, with it open, with `terminateExisting` false and true (3/3 in a row with
    true while it was open). Every launch we sent ran its Shortcut.
  - `vida-airplane-on` / `vida-airplane-off`: 3 full on/off runs, all flipped (owner watched). The last
    one through the built code (`fly airplane on|off`).
  - ~0.25-0.45 s a call including the tunnel (Windows).
  - The reply is just a `processToken` for Shortcuts (pid, executable URL): it comes back before the
    Shortcut runs and says nothing about whether it worked. So success = "sent", not "toggled".
- `device.py` sets `terminateExisting: true`, so Shortcuts always starts fresh with the URL. Both
  settings worked; this one doesn't lean on how a running app takes a new URL.
- **Airplane mode doesn't cut the cable path** (flight spec's Step 0, tunnel half): with airplane mode
  on and Wi-Fi off, usbmuxd still listed the phone on USB, lockdown answered, new userspace tunnels came
  up in ~0.23 s, read-only CoreDevice calls worked, and the OFF went through. A second process can open
  a tunnel while another process holds one open (needed by `fly`, whose holds keep a tunnel).
  **Not tested:** whether a hold that's already running keeps the spoof through the toggle.
