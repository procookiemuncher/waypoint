"""vida-360 flight-detection test & fallback choreographer.

Built to probe Life360's "landed" flight push (docs/handoff/flight-push.md, step 2) and, as a
fallback, the reliable "arrived at <airport>" geofence push (step 3). CoreDevice only
(backend.device.CoreDevice, over pmd3) so every fix carries a real speed and Life360 shows mph +
the car icon — pmd3's DVT sim reports speed -1 and can never clear the >100 mph gate.

The gates come straight from the decompiled Android app (g5g.java, confirmed against g5g.smali,
26.44.0 — see docs/research/life360-flight-detection.md, "pass 2" + the 2026-11-22 update):

  Takeoff fires when a fix has accuracy <=100 m, a real speed, speed >=100 mph, is <=100 m from a
  runway (Life360's own runways.csv, point-to-segment distance), and acceleration >0.5 m/s2 (this
  sample's speed minus one buffered 3-6 s earlier). Debounced 20 min.

  Landing fires when a later fix is <=1000 m from a *different* airport's runway, ground speed
  <=100 mph, within 24 h of takeoff, the two runways >=64,373.6 m (40 mi) apart, and
  altitude <= runway elevation + 1000 m — which a spoof at altitude 0 clears for free (the gate's
  an upper bound). No airplane-mode or mock-location check exists in g5g; the airplane toggle here
  only recreates the real connectivity gap so Life360 never sees the compressed flight.

Runway geometry below is taken from Life360's bundled runways.csv (the exact rows the gates use),
not OSM or memory, so proximity is measured the same way the app measures it.

Sequence (run_flight_test, MIA -> MCO, ~310 km apart):
  1. Hold at the MIA terminal (703 m from the runway -> arms the <=1000 m candidate), online, dwell.
  2. Taxi -> stepped takeoff roll along the real runway (45/55/65/75 m/s, each <=100 m from the
     centreline, each step +10 m/s over ~5 s so accel ~2 m/s2) -> online climb pulling east off the
     runway. Played with backend.drive.play_chunks so each leg is held for its own distance/speed.
  3. Airplane ON (CoreDevice Shortcut, owner confirms, by hand if not). Phone goes offline.
  4. Move the spoof to the MCO landing hold (405 m from an MCO runway, speed 0 -> clears the <=1000 m
     + <=100 mph + altitude gates). Hold through the simulated flight.
  5. Airplane OFF when the owner lands it. Phone reconnects at MCO -> uploads the "landed" fix.
  6. Post-landing dwell, then clear.

If interrupted (Ctrl+C / SIGTERM) or on any error: if airplane mode was turned on, it is turned
back off (owner confirms, by hand if not), then the location sim is cleared — the phone never gets
left offline or on a fake location.

Usage:
  python core/tools/flight_test.py              # MIA -> MCO flight-detection test
  python core/tools/flight_test.py --quick      # short dwells/waits, for dry runs
  python core/tools/flight_test.py geofence     # fallback geofence arrival at MCO
  python core/tools/flight_test.py airplane on  # just toggle airplane mode (on|off)
  python core/tools/flight_test.py --clear      # clear any active location sim and exit
"""
import argparse
import math
import os
import signal
import sys
import threading
import time

CORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CORE)

from backend.device import DRY_RUN, CoreDevice, Pmd3, write_route_input  # noqa: E402
from backend.drive import MPH, plan_chunks, play_chunks, write_chunks  # noqa: E402
from backend.routes import BUILD_DIR, ROUTES_DIR, haversine  # noqa: E402

# --- Life360 runway rows (assets/runways.csv in the 26.44.0 APK): the exact data the gates read.
# (airportCode, startLat, startLon, runwayN_m, runwayE_m, elevation_ft). The runway is the segment
# from (startLat, startLon) along the flat-earth vector (north=runwayN_m, east=runwayE_m).
MIA_RWY = ("MIA", 25.78610, -80.31484, 182.0, 3961.0, 1)     # 09/27, ~3963 m, heads ~due east
MCO_RWY = ("MCO", 28.43561, -81.29588, -3056.0, 28.0, 28)    # nearest MCO runway to the landing hold

# Holds. MIA terminal is 703 m from MIA_RWY (clears the <=1000 m candidate arm). MCO landing hold is
# 405 m from MCO_RWY (clears the <=1000 m landing gate); MCO's main passenger terminal is ~1200 m
# from any runway and would MISS the gate, so the "landing" fix sits airside, where it really fires.
MIA_TERMINAL = (25.79524, -80.28015)
MCO_LANDING = (28.43360, -81.30000)

# Taxi from the terminal out to the runway threshold (f=0), roughly along the taxiways.
TAXI_SPEED = 8.0   # m/s (~18 mph)

# Takeoff roll + climb, as fractions along MIA_RWY and the speed (m/s) to hold over each leg.
# a1..vr are all >=44.704 m/s (>=100 mph) and each +10 m/s step over ~5 s gives accel ~2 m/s2.
# climb runs past f=1.0 (off the runway end) out along the departure heading.
TAKEOFF_LEGS = [
    ("roll", 0.00, 0.05, 20.0),
    ("accel1", 0.05, 0.11, 45.0),
    ("accel2", 0.11, 0.18, 55.0),
    ("accel3", 0.18, 0.26, 65.0),
    ("rotate", 0.26, 0.42, 75.0),
    ("climb", 0.42, 1.10, 85.0),
]

MPH_100 = 100.0 * MPH          # 44.704 m/s, the takeoff/landing speed gate
SEP_MIN_M = 64373.6            # takeoff/landing runways must be at least this far apart
QUICK_SECS = 1.0              # per-leg wait in --quick (geometry stays real, only the clock shrinks)


def runway_point(rwy, f: float) -> tuple[float, float]:
    """Point at fraction f along a runway row, in Life360's own flat-earth convention
    (so it lands exactly on the centreline the app measures from). f>1 extrapolates past the end."""
    _, slat, slon, north_m, east_m, _ = rwy
    cos_lon = math.cos(math.radians(slat)) * 111319.0
    return (slat + f * north_m / 111132.0, slon + f * east_m / cos_lon)


def runway_distance(rwy, lat: float, lon: float) -> float:
    """Port of Runway.distanceFromMeters: distance (m) from (lat, lon) to the runway *segment*."""
    _, slat, slon, north_m, east_m, _ = rwy
    cos_lon = math.cos(math.radians(lat)) * 111319.0
    length = math.hypot(east_m, north_m)
    dn = (lat - slat) * 111132.0
    de = (lon - slon) * cos_lon
    proj = (de * east_m + dn * north_m) / length
    if proj > length:
        dn -= north_m
        de -= east_m
    elif proj > 0:
        dn -= north_m * proj / length
        de -= east_m * proj / length
    return math.hypot(de, dn)


def taxi_waypoints() -> list[tuple[float, float]]:
    """Terminal out to the runway threshold, roughly following the taxiways."""
    return [MIA_TERMINAL, (25.79200, -80.29000), (25.78800, -80.30500), runway_point(MIA_RWY, 0.0)]


def build_flight_chunks(quick: bool = False, build_dir: str = BUILD_DIR) -> list[dict]:
    """The taxi + stepped takeoff roll + climb as a play_chunks() list, each leg written to its own
    CoreDevice route file. Each chunk's `secs` is its real distance/speed so the leg is held for as
    long as it takes to fly it (no teleporting past it); --quick only shrinks the wait, not the
    geometry. `real_secs` keeps the true duration for inspection/tests."""
    out = os.path.join(build_dir, "flight")
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        if old.endswith(".route.json"):
            os.remove(os.path.join(out, old))

    legs: list[tuple[str, list[tuple[float, float]], float]] = []
    legs.append(("taxi", taxi_waypoints(), TAXI_SPEED))
    for name, f0, f1, speed in TAKEOFF_LEGS:
        legs.append((name, [runway_point(MIA_RWY, f0), runway_point(MIA_RWY, f1)], speed))

    chunks: list[dict] = []
    for name, pts, speed in legs:
        span = sum(haversine(a, b) for a, b in zip(pts, pts[1:]))
        real_secs = span / speed
        path = os.path.join(out, f"{name}.route.json")
        write_route_input(path, pts, speed)
        chunks.append({
            "kind": "move", "name": name, "file": path, "waypoints": pts,
            "speed": speed, "dist": span, "real_secs": real_secs,
            "secs": QUICK_SECS if quick else real_secs,
        })
    return chunks


def _safe_input(prompt: str = "") -> str:
    """input() that treats a closed/empty stream (piped dry runs, Ctrl+C mid-prompt) as ENTER."""
    try:
        return input(prompt)
    except EOFError:
        return ""


def _log_line(line: str):
    if line.strip():
        print("  " + line.strip())


def prompt_airplane(on: bool, cd: CoreDevice) -> bool:
    """Flip airplane mode via the phone's Shortcut, owner confirms; manual fallback if the send
    failed or the owner says it didn't take. Always returns True (airplane mode is now in the
    requested state, by hand if need be)."""
    state = "ON" if on else "OFF"
    print(f"\n> Requesting AIRPLANE MODE {state} via CoreDevice...")
    sent = cd.airplane(on, _log_line)
    if sent:
        ask = "Is the airplane icon showing" if on else "Are Wi-Fi and cellular back"
        if _safe_input(f"  Sent. {ask} on the phone? [y/n] ").strip().lower() in ("y", "yes"):
            print(f"  [OK] Airplane mode {state} confirmed.")
            return True
    else:
        print("  Could not send the shortcut request to the phone.")
    _safe_input(f"  >> Toggle AIRPLANE MODE {state} by hand on the phone, then press ENTER. << ")
    return True


def _mount_or_die():
    if DRY_RUN:
        return
    state, msg = Pmd3().mount(_log_line)
    if state != "ready":
        sys.exit(f"Phone not ready ({state}): {msg}")


def run_flight_test(quick: bool = False, cd: CoreDevice | None = None):
    """Execute the MIA -> MCO flight-detection test."""
    cd = cd or CoreDevice()
    print("\n" + "=" * 68)
    print("  vida-360: Life360 Flight Detection 'Landed' Push Test")
    print("  Trip: Miami International (MIA) -> Orlando International (MCO)")
    print("=" * 68)
    print("  Gates (from the decompiled app): >=100 mph + accel >0.5 within 100 m of the MIA")
    print("  runway for takeoff; <=1000 m of an MCO runway, <=100 mph, altitude<=elev+1000,")
    print("  runways >40 mi apart for landing. Airplane mode just makes the flight-gap offline.")
    print("-" * 68)

    _mount_or_die()

    print("\n> [1/6] Building taxi + takeoff + climb legs along the real MIA runway...")
    chunks = build_flight_chunks(quick=quick)
    for c in chunks:
        on_rwy = c["name"] != "taxi"
        near = runway_distance(MIA_RWY, *c["waypoints"][-1]) if on_rwy else None
        tag = f", {near:.0f} m from runway" if on_rwy else ""
        print(f"  {c['name']:7s} {c['speed'] / MPH:5.0f} mph  {c['dist']:5.0f} m  ~{c['real_secs']:4.0f}s{tag}")

    cancel = threading.Event()
    airplane_on = False
    try:
        # Phase 1 — terminal hold, online.
        d_mia = runway_distance(MIA_RWY, *MIA_TERMINAL)
        print(f"\n> [2/6] Holding at MIA terminal {MIA_TERMINAL} ({d_mia:.0f} m from runway, ONLINE)...")
        cd.hold(*MIA_TERMINAL, _log_line)
        dwell = 5 if quick else 20 * 60
        print(f"  Dwelling {dwell}s so Life360 settles 'at MIA' and arms the runway candidate...")
        time.sleep(dwell)
        _safe_input("  >> Press ENTER to taxi and take off... << ")

        # Phase 2 — taxi, stepped takeoff roll, climb (each leg held for its own distance/speed).
        print("\n> [3/6] Taxi -> takeoff roll -> climb (watch for >100 mph on the observer)...")
        if not play_chunks(chunks, cd, cancel, _log_line):
            print("  ! A leg was refused by the phone — check the output above.")

        # Phase 3 — airplane ON (take off into the offline gap).
        _safe_input("\n  >> Press ENTER to turn AIRPLANE MODE ON (take off into the gap)... << ")
        prompt_airplane(True, cd)
        airplane_on = True

        # Phase 4 — offline: move the spoof to the MCO landing hold and sit there.
        dist_km = haversine(MIA_TERMINAL, MCO_LANDING) / 1000
        d_mco = runway_distance(MCO_RWY, *MCO_LANDING)
        print(f"\n> [4/6] OFFLINE. Spoof moved to MCO landing hold {MCO_LANDING} ({dist_km:.0f} km, "
              f"{d_mco:.0f} m from runway)...")
        cd.hold(*MCO_LANDING, _log_line)
        print("  Held airside at MCO with no transmission (simulated ~55 min flight).")
        _safe_input("  >> Press ENTER to LAND (turns AIRPLANE MODE OFF)... << ")

        # Phase 5 — airplane OFF: reconnect uploads the landing fix.
        prompt_airplane(False, cd)
        airplane_on = False

        # Phase 6 — post-landing dwell.
        print(f"\n> [6/6] Reconnected at MCO. Holding the landing fix (<=1000 m from runway, 0 mph,")
        print("  altitude 0 <= elev+1000). Watch the 2nd device / observer for the push.")
        dwell = 5 if quick else 12 * 60
        print(f"  Dwelling {dwell}s...")
        time.sleep(dwell)
        print("\n  >> Flight sequence complete. <<")
        _safe_input("  Press ENTER to clear the location sim and return to real GPS... ")

    finally:
        cancel.set()
        if airplane_on:
            print("\n> Cleanup: airplane mode was left ON — turning it back OFF...")
            prompt_airplane(False, cd)
        print("\n> Cleanup: clearing the simulated location...")
        cd.clear(_log_line)
        print("  [OK] Location sim cleared, phone back on real GPS.")


def run_geofence_arrival(quick: bool = False, cd: CoreDevice | None = None):
    """Fallback: drive into the saved MCO airport Place via CoreDevice at real speed and dwell,
    firing the reliable 'arrived at Orlando International Airport' geofence push."""
    cd = cd or CoreDevice()
    print("\n" + "=" * 68)
    print("  vida-360: Fallback Airport Geofence Arrival")
    print("  Target: 'arrived at Orlando International Airport'")
    print("=" * 68)
    print("  Drives into the saved MCO Place (real mph + car icon), crossing the boundary, then dwells.")

    route_json = os.path.join(ROUTES_DIR, "mco-geofence-arrival.json")
    if not os.path.exists(route_json):
        sys.exit(f"Route file missing: {route_json}")

    _mount_or_die()

    print("\n> Planning the approach drive (varying road speed)...")
    name, chunks = plan_chunks(route_json, seed=42)
    write_chunks(name, chunks)
    if quick:
        chunks = chunks[:2]
        print(f"  --quick: playing the first {len(chunks)} chunk(s) only.")

    cancel = threading.Event()
    try:
        print("\n> Playing the approach. Watch for the car icon + speed on Life360...")
        play_chunks(chunks, cd, cancel, _log_line)
        print("\n> Arrival drive done (ends with a dwell inside the Place).")
        _safe_input("  Press ENTER to clear the location sim... ")
    finally:
        cancel.set()
        cd.clear(_log_line)
        print("  [OK] Location sim cleared.")


def main():
    ap = argparse.ArgumentParser(description="Life360 flight-detection test & fallback choreographer.")
    ap.add_argument("command", nargs="?", default="flight",
                    choices=["flight", "geofence", "airplane", "status"],
                    help="flight (default), geofence, airplane, or status")
    ap.add_argument("state", nargs="?", choices=["on", "off"], help="state for the 'airplane' command")
    ap.add_argument("--quick", action="store_true", help="short dwells/waits (dry runs)")
    ap.add_argument("--clear", action="store_true", help="clear the location sim and exit")
    args = ap.parse_args()

    cd = CoreDevice()

    def handle_interrupt(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, handle_interrupt)
    signal.signal(signal.SIGTERM, handle_interrupt)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, handle_interrupt)

    try:
        if args.clear:
            print("> Clearing the simulated location...")
            cd.clear(_log_line)
            return
        if args.command == "airplane":
            if not args.state:
                sys.exit("Usage: flight_test.py airplane on|off")
            prompt_airplane(args.state == "on", cd)
            return
        if args.command == "status":
            pmd = Pmd3()
            devs = pmd.list_devices()
            print(f"> Connected devices: {devs}")
            if devs:
                print(f"  Lock state: {pmd.lock_state(devs[0].get('udid'))}")
            return
        if args.command == "geofence":
            run_geofence_arrival(quick=args.quick, cd=cd)
            return
        run_flight_test(quick=args.quick, cd=cd)
    except KeyboardInterrupt:
        print("\n> Interrupted — clearing the location sim...")
        cd.clear(_log_line)
        sys.exit(130)


if __name__ == "__main__":
    main()
