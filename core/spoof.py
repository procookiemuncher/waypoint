"""vida-360 spoof launcher — double-click **windows-version/spoof.cmd** / **mac-version/spoof.command**
(or run `python core/spoof.py`).

Shows a "where do you want to go?" menu:
  - **Routes** (realistic movement) — every core/routes/*.json, built by the movement engine
    into a validated GPX and replayed on the phone (walk/drive/stop, ramps, jitter).
  - **Static presets** — hold a fixed point (quick teleport).
  - **Clear** — revert to the phone's real GPS.

Also takes a direct argument, e.g.:
  spoof.cmd miami         # play the route whose name matches "miami"
  spoof.cmd eiffel        # hold a static preset
  spoof.cmd 48.8584 2.2945  # hold explicit lat lon
  spoof.cmd clear         # clear the spoof

Requires: the .venv with pymobiledevice3 (see docs/BUILD_PLAN.md -> Environment), the Apple
Mobile Device Service installed (Windows only), and the iPhone plugged in + UNLOCKED with Developer Mode on.
"""
import glob
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)                       # make `backend` importable
ROUTES_DIR = os.path.join(ROOT, "routes")
BUILD_DIR = os.path.join(ROOT, "build")

# Static teleport presets: key -> (lat, lon, label). Just hold a fixed point.
PRESETS = {
    "eiffel": (48.8584, 2.2945, "Eiffel Tower, Paris"),
    "dubai": (25.1972, 55.2744, "Burj Khalifa, Dubai"),
}


def pmd(*args):
    """Run a pymobiledevice3 subcommand with the current (venv) Python."""
    return subprocess.run([sys.executable, "-m", "pymobiledevice3", *args])


def ensure_mounted():
    print("> Mounting Developer Disk Image (the phone must be UNLOCKED)...")
    if pmd("mounter", "auto-mount", "--userspace").returncode != 0:
        print("  (ignore if already mounted; if 'DeviceLocked', unlock the phone and retry)")


def load_routes():
    """Return [(path, name, description)] for every readable route JSON, sorted by name."""
    routes = []
    for path in sorted(glob.glob(os.path.join(ROUTES_DIR, "*.json"))):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            routes.append((path, data.get("name") or os.path.basename(path),
                           data.get("description", "")))
        except (OSError, json.JSONDecodeError):
            pass
    return routes


def build_gpx(route_path):
    """Render + validate a route into build/<name>.gpx. Returns the path, or None on failure."""
    from backend.movement import load_route, RouteRenderer, validate, snap_route
    route = load_route(route_path)
    route, snap_warnings = snap_route(route)
    for w in snap_warnings:
        print(f"  ! {w}")
    fixes = RouteRenderer().render(route)
    result = validate(fixes)
    for w in result.warnings:
        print(f"  ! {w}")
    if not result.ok:
        print("  route FAILED validation — not playing:")
        for e in result.errors:
            print(f"    - {e}")
        return None
    os.makedirs(BUILD_DIR, exist_ok=True)
    out = os.path.join(BUILD_DIR, f"{route.name}.gpx")
    with open(out, "w", encoding="utf-8") as f:
        f.write(RouteRenderer.to_gpx(fixes))
    mins = (fixes[-1].t - fixes[0].t) / 60 if fixes else 0
    print(f"  built '{route.name}': {len(fixes)} points, ~{mins:.1f} min, "
          f"top {result.max_smoothed_speed * 3.6:.0f} km/h")
    return out


def play_route(route_path):
    gpx = build_gpx(route_path)
    if not gpx:
        return
    ensure_mounted()
    print("\n> Playing the route. Keep the phone unlocked; watch Find My / Life360.")
    print("> Press Ctrl+C here to stop and revert.\n")
    pmd("developer", "dvt", "simulate-location", "play", "--userspace", gpx)
    print("\n> Stopped. Location reverts to real GPS shortly.")


def hold_preset(lat, lon, label):
    ensure_mounted()
    print(f"\n> Holding at {label} ({lat}, {lon}). Keep the phone unlocked.")
    print("> Press ENTER or Ctrl+C here to stop and revert.\n")
    pmd("developer", "dvt", "simulate-location", "set", "--userspace", "--", str(lat), str(lon))
    print("\n> Stopped. Location reverts to real GPS shortly.")


def clear():
    print("> Clearing spoofed location...")
    pmd("developer", "dvt", "simulate-location", "clear", "--userspace")


def choose_from_menu():
    """Print the menu and return ('route', path) | ('preset', key) | ('clear', None) | None."""
    routes = load_routes()
    print("\n" + "=" * 52)
    print("  vida-360 - where do you want to go?")
    print("=" * 52)

    items = []
    if routes:
        print("\n  Routes (realistic movement):")
        for path, name, desc in routes:
            items.append(("route", path))
            short = (desc[:64] + "...") if len(desc) > 64 else desc
            print(f"   {len(items):>2}. {name}")
            if short:
                print(f"       {short}")

    print("\n  Static presets (hold a fixed point):")
    for key, (_, _, label) in PRESETS.items():
        items.append(("preset", key))
        print(f"   {len(items):>2}. {label}")

    items.append(("clear", None))
    print(f"\n   {len(items):>2}. Clear the spoof (back to real GPS)")

    raw = input("\n  Pick a number: ").strip()
    if not raw.isdigit() or not (1 <= int(raw) <= len(items)):
        print("  Not a valid choice.")
        return None
    return items[int(raw) - 1]


def resolve_arg(argv):
    """Map a direct CLI arg to an action. Returns the same tuple shape as the menu, or None."""
    if len(argv) == 2:                                   # explicit "lat lon"
        try:
            return ("coord", (float(argv[0]), float(argv[1])))
        except ValueError:
            return None
    key = argv[0].lower()
    if key == "clear":
        return ("clear", None)
    if key in PRESETS:
        return ("preset", key)
    for path, name, _ in load_routes():                  # match a route by name/filename
        stem = os.path.splitext(os.path.basename(path))[0].lower()
        if key == name.lower() or key == stem or key in name.lower():
            return ("route", path)
    print(f"  Unknown target '{key}'. Try a route name, a preset ({', '.join(PRESETS)}), "
          f"'lat lon', or 'clear'.")
    return None


def run(action):
    kind, val = action
    if kind == "route":
        play_route(val)
    elif kind == "preset":
        lat, lon, label = PRESETS[val]
        hold_preset(lat, lon, label)
    elif kind == "coord":
        lat, lon = val
        hold_preset(lat, lon, f"{lat}, {lon}")
    elif kind == "clear":
        clear()


def main():
    argv = sys.argv[1:]
    action = resolve_arg(argv) if argv else choose_from_menu()
    if action:
        run(action)


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\n> Cancelled.")
