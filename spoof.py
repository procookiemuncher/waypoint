"""vida-360 quick spoof runner.

Usage:
  python spoof.py                 # pick from the preset menu
  python spoof.py eiffel          # jump to a named preset
  python spoof.py 48.8584 2.2945  # jump to explicit  lat lon
  python spoof.py clear           # clear the spoof, back to real GPS

Keeps the fake location active until you press ENTER (or Ctrl+C) in this window.
Add more locations to PRESETS below as we go.

Requires: the iPhone plugged in + UNLOCKED, Developer Mode on. Uses the pure-Python
`--userspace` tunnel, so no admin is needed.
"""
import subprocess
import sys

# key -> (latitude, longitude, label)
PRESETS = {
    "eiffel": (48.8584, 2.2945, "Eiffel Tower, Paris"),
    "dubai": (25.1972, 55.2744, "Burj Khalifa, Dubai"),
    "miami": (25.7617, -80.1918, "Downtown Miami, FL"),
}


def pmd(*args):
    """Run a pymobiledevice3 subcommand with the current Python's venv."""
    return subprocess.run([sys.executable, "-m", "pymobiledevice3", *args])


def resolve_target(argv):
    if not argv:
        print("Presets:")
        for key, (_, _, label) in PRESETS.items():
            print(f"  {key:8} {label}")
        argv = input("\nPick a preset (or type 'lat lon'): ").strip().split()

    if len(argv) == 1:
        key = argv[0].lower()
        if key not in PRESETS:
            sys.exit(f"Unknown preset '{key}'. Options: {', '.join(PRESETS)}")
        return PRESETS[key]

    if len(argv) == 2:
        return float(argv[0]), float(argv[1]), f"{argv[0]}, {argv[1]}"

    sys.exit("Usage: python spoof.py [preset | lat lon | clear]")


def main():
    argv = sys.argv[1:]

    if argv and argv[0].lower() == "clear":
        print("> Clearing spoofed location...")
        pmd("developer", "dvt", "simulate-location", "clear", "--userspace")
        return

    lat, lon, label = resolve_target(argv)
    print(f"\n> Target: {label}  ({lat}, {lon})")

    print("> Mounting Developer Disk Image (the phone must be UNLOCKED)...")
    if pmd("mounter", "auto-mount", "--userspace").returncode != 0:
        print("  (mount returned an error — ignore if 'already mounted';")
        print("   if 'DeviceLocked', unlock the phone and run again)")

    print(f"\n> Spoofing to {label}. Keep this window open.")
    print("> Press ENTER (or Ctrl+C) here to stop and revert.\n")
    try:
        pmd("developer", "dvt", "simulate-location", "set", "--userspace", "--", str(lat), str(lon))
    except KeyboardInterrupt:
        pass
    print("\n> Stopped. Location reverts to real GPS shortly.")


if __name__ == "__main__":
    main()
