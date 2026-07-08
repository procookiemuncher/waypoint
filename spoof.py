"""vida-360 quick spoof runner.

Usage:
  python spoof.py                 # pick from the preset menu
  python spoof.py eiffel          # jump to a named preset
  python spoof.py 48.8584 2.2945  # jump to explicit  lat lon
  python spoof.py clear           # clear the spoof, back to real GPS

Static presets hold the location until you press ENTER (or Ctrl+C).
The "miami" preset is a movement demo: from the start point it walks (~12s), then
drives 100mph (~12s), then holds there. Handy for testing whether Life360 flips its
walking/driving activity emoji.

Requires: iPhone plugged in + UNLOCKED, Developer Mode on. Uses the pure-Python
`--userspace` tunnel, so no admin is needed.
"""
import math
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

# key -> (latitude, longitude, label)
PRESETS = {
    "eiffel": (48.8584, 2.2945, "Eiffel Tower, Paris"),
    "dubai": (25.1972, 55.2744, "Burj Khalifa, Dubai"),
    "miami": (25.7617, -80.1918, "Downtown Miami, FL"),
}

# Presets that play a walk-then-drive movement instead of a static hold.
MOVEMENT_PRESETS = {"miami"}

# Movement tuning. Bump the *_SECS if Life360 is too slow to register the change.
WALK_MPS = 1.4       # ~3 mph
DRIVE_MPS = 44.704   # 100 mph
WALK_SECS = 12
DRIVE_SECS = 12
HOLD_SECS = 300      # keep the final spot for ~5 min (Ctrl+C to stop sooner)
HEADING_DEG = 0      # travel due north (inland from downtown Miami)


def pmd(*args):
    """Run a pymobiledevice3 subcommand with the current venv's Python."""
    return subprocess.run([sys.executable, "-m", "pymobiledevice3", *args])


def _step(lat, lon, meters, heading_deg):
    """Move `meters` along a compass heading from (lat, lon)."""
    h = math.radians(heading_deg)
    dlat = meters * math.cos(h) / 111111.0
    dlon = meters * math.sin(h) / (111111.0 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def build_walk_drive_gpx(start_lat, start_lon):
    """Write a GPX (start -> walk -> drive -> hold) at 1s per point and return its path.

    pymobiledevice3's `play` moves at distance/time-delta between points, so the
    per-second spacing is what sets the speed.
    """
    base = datetime(2020, 1, 1, tzinfo=timezone.utc)
    lat, lon, t = start_lat, start_lon, 0
    points = [(lat, lon, t)]
    for speed, secs in ((WALK_MPS, WALK_SECS), (DRIVE_MPS, DRIVE_SECS)):
        for _ in range(secs):
            lat, lon = _step(lat, lon, speed, HEADING_DEG)
            t += 1
            points.append((lat, lon, t))
    points.append((lat, lon, t + HOLD_SECS))  # dwell so the final spot holds

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<gpx version="1.1" creator="vida-360"><trk><trkseg>']
    for lat, lon, t in points:
        ts = (base + timedelta(seconds=t)).strftime("%Y-%m-%dT%H:%M:%SZ")
        lines.append(f'  <trkpt lat="{lat:.6f}" lon="{lon:.6f}"><time>{ts}</time></trkpt>')
    lines.append("</trkseg></trk></gpx>")

    path = os.path.join(tempfile.gettempdir(), "vida360_route.gpx")
    with open(path, "w") as f:
        f.write("\n".join(lines))
    return path


def resolve_target(argv):
    """Return (lat, lon, label, key). key is the preset name, or None for raw coords."""
    if not argv:
        print("Presets:")
        for k, (_, _, label) in PRESETS.items():
            print(f"  {k:8} {label}")
        argv = input("\nPick a preset (or type 'lat lon'): ").strip().split()

    if len(argv) == 1:
        key = argv[0].lower()
        if key not in PRESETS:
            sys.exit(f"Unknown preset '{key}'. Options: {', '.join(PRESETS)}")
        lat, lon, label = PRESETS[key]
        return lat, lon, label, key

    if len(argv) == 2:
        return float(argv[0]), float(argv[1]), f"{argv[0]}, {argv[1]}", None

    sys.exit("Usage: python spoof.py [preset | lat lon | clear]")


def ensure_mounted():
    print("> Mounting Developer Disk Image (the phone must be UNLOCKED)...")
    if pmd("mounter", "auto-mount", "--userspace").returncode != 0:
        print("  (mount returned an error — ignore if 'already mounted';")
        print("   if 'DeviceLocked', unlock the phone and run again)")


def main():
    argv = sys.argv[1:]

    if argv and argv[0].lower() == "clear":
        print("> Clearing spoofed location...")
        pmd("developer", "dvt", "simulate-location", "clear", "--userspace")
        return

    lat, lon, label, key = resolve_target(argv)
    print(f"\n> Target: {label}  ({lat}, {lon})")
    ensure_mounted()

    if key in MOVEMENT_PRESETS:
        gpx = build_walk_drive_gpx(lat, lon)
        print(f"\n> {label}: walking ~{WALK_SECS}s, then driving 100mph ~{DRIVE_SECS}s,")
        print(f"> then holding ~{HOLD_SECS // 60} min. Keep this window open; Ctrl+C to stop.\n")
        pmd("developer", "dvt", "simulate-location", "play", "--userspace", gpx)
    else:
        print(f"\n> Spoofing to {label}. Keep this window open.")
        print("> Press ENTER (or Ctrl+C) here to stop and revert.\n")
        pmd("developer", "dvt", "simulate-location", "set", "--userspace", "--", str(lat), str(lon))

    print("\n> Stopped. Location reverts to real GPS shortly.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\n> Cancelled.")
