"""Play a prebuilt route GPX onto the connected iPhone (device-side test harness).

Thin runner over pymobiledevice3's CLI (same approach as spoof.py): mounts the Developer Disk
Image over the userspace tunnel (no admin), then replays the GPX with `simulate-location
play`. The GPX comes from tools/build_route.py (authored + validated offline). This is the
interim device path; the formal LocationBackend.play_route() lands in Increment 3 / M2.

Run with the venv's python so pymobiledevice3 is importable:

    .venv\\Scripts\\python.exe tools\\play_route.py build\\miami-demo.gpx
    .venv\\Scripts\\python.exe tools\\play_route.py build\\miami-demo.gpx --noise 500

Requires: iPhone plugged in + UNLOCKED (Auto-Lock = Never), Developer Mode on, trusted.
Playing holds the tunnel open for the route's duration; Ctrl+C stops it and location reverts.
"""
import argparse
import subprocess
import sys


def pmd(*args):
    """Run a pymobiledevice3 subcommand with the current (venv) Python."""
    return subprocess.run([sys.executable, "-m", "pymobiledevice3", *args])


def main():
    ap = argparse.ArgumentParser(description="Play a route GPX on the connected iPhone.")
    ap.add_argument("gpx", help="path to a built .gpx (from tools/build_route.py)")
    ap.add_argument("--noise", type=int, default=0,
                    help="+/- ms timing jitter added to each inter-point wait")
    args = ap.parse_args()

    print("> Mounting Developer Disk Image (the phone must be UNLOCKED)...")
    if pmd("mounter", "auto-mount", "--userspace").returncode != 0:
        print("  (ignore if already mounted; if 'DeviceLocked', unlock the phone and retry)")

    play_args = ["developer", "dvt", "simulate-location", "play", "--userspace", args.gpx]
    if args.noise:
        play_args.append(str(args.noise))

    print(f"\n> Playing {args.gpx} (timing noise +/-{args.noise} ms). Keep the phone unlocked.")
    print("> Watch Find My / Life360. Press ENTER or Ctrl+C here to stop and revert.\n")
    pmd(*play_args)
    print("\n> Stopped. Location reverts to real GPS shortly.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\n> Cancelled.")
