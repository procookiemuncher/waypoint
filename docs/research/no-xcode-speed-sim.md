# Dropping Xcode: the speed location sim over plain pmd3 (2026-11-18)

**Status (2026-11-18, on-device, iOS 27.0.1, iPhone19,3): the phone accepts set / route-with-speed /
clear from pmd3 11.59 over the no-admin userspace tunnel, no devicectl.** Still to confirm by eye:
the dot actually moves and Life360 shows the mph + car. Also not yet shown: pmd3 mounting the DDI by
itself, since this run found one already mounted (no reboot first).

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
| lock state | `phone_check.py` | pmd3 `DeviceInfoService.get_lockstate()` (already exists) |
| DDI usable | `phone_check.py` | pmd3 mounter `is_image_mounted("Personalized")` |
| airplane-mode Shortcut (`process openURL shortcuts://…`) | airplane flow | **unknown**. pmd3 has `launchapplication`. Need to check if it takes a URL, or capture what devicectl sends |
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
