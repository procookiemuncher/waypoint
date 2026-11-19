"""Can we get devicectl's speed-carrying location sim WITHOUT Xcode? (research probe, 2026-11-18)

devicectl's `simulate location route --speed` doesn't use the DVT LocationSimulation channel pmd3
drives. It calls the CoreDevice feature `com.apple.coredevice.feature.simulatelocation`, served on
the phone by /usr/libexec/dtlocationd (comes in with the DDI) and reachable over RSD as
`com.apple.coredevice.locationservice`. pmd3 already speaks CoreDevice and even has a stub
LocationService (only `availablelocationscenarios`). The actions and input keys come from
Xcode's CoreDeviceUtilities binary:

    setsimulatedlocation     SimulatedLocation {latitude, longitude}
    startlocationsimulation  Input {waypoints: [SimulatedLocation], speed, pacing}
                             pacing = enum Pacing { distance(distance), interval(interval) }
    clearsimulatedlocation   Input {}

Swift enum encoding of `pacing` and the outer wrapping are guesses, so every step tries a few
shapes and prints what the phone says. The phone's decode errors name the missing key.

Needs pmd3 >= 11.59 (9.33.1's auto-mount crashes on iOS 27 with KeyError 'ApBoardID'). Run it
through mac-version/probe-no-xcode.command, which uses a throwaway venv so the app's pinned
.venv isn't touched. NOT imported by the app; once a shape works it moves into core/backend/device.py.

For a fair test, REBOOT the phone first. Xcode's DDI stays mounted until reboot, and the point
is proving pmd3 can mount its own.
"""
import argparse
import asyncio
import json
import sys

from pymobiledevice3.exceptions import CoreDeviceError, NoDeviceConnectedError
from pymobiledevice3.remote.core_device.core_device_service import CoreDeviceService
from pymobiledevice3.remote.userspace_tunnel import UserspaceRsdTunnel
from pymobiledevice3.services.mobile_image_mounter import MobileImageMounterService, auto_mount

SERVICE = "com.apple.coredevice.locationservice"
FEATURE = "com.apple.coredevice.feature.simulatelocation"
ACT = "com.apple.coredevice.action."
MPH = 0.44704

# Eiffel Tower, then a short straight-ish run down Av. de Suffren (~1 km)
SET_AT = (48.85837, 2.29448)
ROUTE = [(48.85837, 2.29448), (48.85620, 2.29800), (48.85370, 2.30160), (48.85110, 2.30540)]


def ok(msg):
    print(f"  \033[32mOK\033[0m  {msg}")


def bad(msg):
    print(f"  \033[31m--\033[0m  {msg}")


def wait(msg):
    try:
        input(f"\n>>> {msg}  [Enter to go on] ")
    except EOFError:
        pass


def pt(lat, lon):
    return {"latitude": float(lat), "longitude": float(lon)}


async def try_shapes(svc, action, shapes):
    """Send each input shape until one is accepted. Returns (label, output) or None."""
    for label, inp in shapes:
        try:
            out = await svc.invoke(FEATURE, inp, action_identifier=ACT + action)
            ok(f"{action} accepted shape '{label}' -> {json.dumps(out, default=str)[:300]}")
            return label, out
        except CoreDeviceError as e:
            bad(f"{action} shape '{label}': {e}")
        except Exception as e:  # a dropped connection etc. — keep trying the other shapes
            bad(f"{action} shape '{label}': {type(e).__name__}: {e}")
    return None


async def step_mount(rsd, mount):
    print("\n[1] Developer disk image")
    async with MobileImageMounterService(rsd) as m:
        mounted = await m.is_image_mounted("Personalized")
    if mounted:
        ok("a personalized DDI is already mounted (if you didn't reboot, it may be Xcode's)")
        return True
    if not mount:
        bad("no DDI mounted and --no-mount given")
        return False
    print("  mounting with pmd3 (downloads the image the first time)...")
    try:
        await auto_mount(rsd)
    except Exception as e:
        bad(f"auto_mount failed: {type(e).__name__}: {e}")
        return False
    ok("pmd3 mounted the DDI itself, no Xcode")
    return True


def step_services(rsd):
    print("\n[2] Services on the phone")
    names = sorted(n for n in rsd.peer_info["Services"] if "coredevice" in n)
    for n in names:
        print(f"      {n}")
    if SERVICE not in names:
        bad(f"{SERVICE} isn't offered. Nothing below can work.")
        return False
    feats = sorted(rsd.get_service_features(SERVICE))
    ok(f"{SERVICE} is there, features: {feats or '(none listed)'}")
    return True


async def run(args):
    tunnel = UserspaceRsdTunnel(serial=args.udid)
    print("Opening the userspace tunnel (no admin)... phone must be plugged in + unlocked")
    try:
        rsd = await tunnel.aopen()
    except NoDeviceConnectedError:
        bad("no phone over USB. Plug it in with the cable, unlock it, and run again.")
        return 1
    try:
        print(f"  iOS {rsd.product_version} ({rsd.product_build_version}), udid {rsd.udid}")
        if not await step_mount(rsd, not args.no_mount):
            return 1
        if not step_services(rsd):
            return 1

        svc = CoreDeviceService(rsd, SERVICE)
        async with svc:
            print("\n[3] Known-good call: availablelocationscenarios")
            if not await try_shapes(svc, "availablelocationscenarios", [("empty", {})]):
                return 1

            print("\n[4] setsimulatedlocation (the 'coordinate' command)")
            lat, lon = SET_AT
            got = await try_shapes(svc, "setsimulatedlocation", [
                ("flat", pt(lat, lon)),
                ("location", {"location": pt(lat, lon)}),
                ("simulatedLocation", {"simulatedLocation": pt(lat, lon)}),
            ])
            if got:
                wait("Open Maps on the phone. Is the blue dot at the Eiffel Tower?")

            print(f"\n[5] startlocationsimulation (the 'route --speed' command) at {args.mph} mph")
            speed = args.mph * MPH
            wps = [pt(a, b) for a, b in ROUTE]
            shapes = []
            for plabel, pacing in [
                ("interval{_0}", {"interval": {"_0": 1.0}}),   # this one works on iOS 27.0.1
                ("interval{interval}", {"interval": {"interval": 1.0}}),
                ("distance{distance}", {"distance": {"distance": 10.0}}),
                ("distance{_0}", {"distance": {"_0": 10.0}}),
            ]:
                shapes.append((plabel, {"waypoints": wps, "speed": speed, "pacing": pacing}))
            # last resort: the plain devicectl JSON-file layout
            shapes.append(("devicectl-json", {"mode": "interval", "interval": 1.0, "speed": speed, "waypoints": wps}))
            got = await try_shapes(svc, "startlocationsimulation", shapes)
            if got:
                wait("Watch Maps: is the dot moving down Av. de Suffren? If a circle member can, "
                     f"check Life360 shows ~{args.mph:.0f} mph + the car icon. (route is ~1 km)")

            print("\n[6] clearsimulatedlocation")
            await try_shapes(svc, "clearsimulatedlocation", [("empty", {})])
    finally:
        await tunnel.aclose()
    print("\nDone. Paste this whole output back so the working shapes can go into device.py.")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--udid", help="phone UDID (default: first USB device)")
    ap.add_argument("--mph", type=float, default=25.0)
    ap.add_argument("--no-mount", action="store_true", help="don't mount a DDI, just report")
    sys.exit(asyncio.run(run(ap.parse_args())))


if __name__ == "__main__":
    main()
