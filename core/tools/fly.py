"""vida-360 flight choreographer — double-click **windows-version/fly.cmd** / **mac-version/fly.command**
(or run `python core/tools/fly.py`).

Runs a believable *flight* between two cities so Life360 pushes "arrived at <destination>". It
choreographs the spoof around a manual **airplane-mode** gap: the phone goes offline exactly like a
real flight, so Life360 never sees the (impossible, compressed) flight itself — only the airport
departure before and the driven arrival after. Full rationale + the sequence table:
docs/superpowers/specs/2026-07-10-flight-arrival-spoofer-design.md.

Airplane mode flips through two Shortcuts on the phone, vida-airplane-on (Airplane Mode on +
Wi-Fi off) and vida-airplane-off (the reverse), run over the cable (backend.device
CoreDevice.airplane, no Xcode). The phone only says it took the request, so you confirm each flip;
if it didn't happen, you toggle it by hand and press ENTER. Sequence:

  1. Tool  : drive to the departure airport (a route), then hold there.
  2. YOU   : press ENTER to take off -> airplane mode ON (the hold keeps running through it).
  3. Tool  : move the spoof to the arrival airport (instant; phone offline, Life360 blind), hold.
  4. YOU   : press ENTER to land -> airplane mode OFF.
  5. Tool  : drive from the arrival airport into the destination Place, then dwell -> "arrived" push.

    fly.cmd                # list trips
    fly.cmd nyc            # run the Miami -> New York City trip
    fly.cmd airplane on    # just flip airplane mode (or off)

Before running:
  - Save the DESTINATION as a Life360 Place in the app (the API can't create Places). Point the
    arrival route's final waypoint at it (see the trip's arrive_route JSON).
  - Have a SECOND circle member's phone handy — only it can see the "arrived" push (the API can't).
  - Run the Observer alongside to confirm arrival state server-side:
        .venv\\Scripts\\python.exe tools\\observe.py --watch --member "<you>" --log flight.jsonl
  - Phone plugged in by CABLE (not Wi-Fi pairing) + UNLOCKED (Auto-Lock = Never), Developer Mode
    on, trusted. The vida-airplane-on / -off Shortcuts exist on the phone.

⚠ PREREQUISITE GATE (Step 0 in the spec), half checked: new tunnels reach the phone over the cable
in airplane mode (2026-11-21), so the OFF can always be sent. Still unchecked: does a hold that's
already running keep the spoof through the toggle? If it drops, the arrival can race the phone's
first real-location upload on reconnect — see the spec's fallback before trusting a real run.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)                       # make `backend` + spoof importable

# Reuse the transport glue + route builder already proven in spoof.py — no duplicated pmd calls.
from spoof import pmd, ensure_mounted, build_gpx, ROUTES_DIR  # noqa: E402
from backend.device import DRY_RUN, CoreDevice, Pmd3  # noqa: E402

# A trip is: drive to the departure airport, hold; (airplane ON); jump to the arrival airport,
# hold; (airplane OFF); drive into the destination Place. Coords are (lat, lon).
TRIPS = {
    "nyc": {
        "label": "Miami -> New York City",
        "depart_route": "mia-departure",       # played: drive to MIA
        "depart_hold": (25.79510, -80.28700),  # held after the drive: MIA terminal
        "arrive_hold": (40.64130, -73.77810),  # set while offline: JFK (reconnect point)
        "arrive_route": "jfk-to-hotel",        # played after reconnect: drive JFK -> hotel Place
    },
}


def route_path(name):
    return os.path.join(ROUTES_DIR, f"{name}.json")


def _pmd_line(line):
    if not line.startswith("Press "):   # the hold's own "Press ENTER to exit" / "Press Ctrl+C", fly asks itself
        print("  " + line)


def hold(lat, lon):
    """Hold a fixed point in the background, so it's still held while airplane mode flips.
    Returns the Job; .stop() lets go."""
    return Pmd3().hold(lat, lon, _pmd_line)


def play(gpx):
    if DRY_RUN:   # the holds + toggles are dry too (backend.device), so a dry fly touches nothing
        print(f"  [dry run] play {os.path.basename(gpx)}")
        return
    pmd("developer", "dvt", "simulate-location", "play", "--userspace", gpx)


def airplane(on, cd):
    """Flip airplane mode through the phone's Shortcut, then have the owner confirm it: the phone
    only says it took the launch. A failed send or anything but a yes means doing it by hand."""
    state = "ON" if on else "OFF"
    if cd.airplane(on, _pmd_line):
        ask = "Is the airplane icon showing" if on else "Are Wi-Fi and cellular back"
        if input(f"  Sent. {ask} on the phone? [y/n] ").strip().lower() in ("y", "yes"):
            return
    else:
        print("  Couldn't send it to the phone.")
    input(f"  >> Toggle AIRPLANE MODE {state} by hand on the phone, then press ENTER. <<")


def run_trip(trip):
    label = trip["label"]
    print("\n" + "=" * 60)
    print(f"  vida-360 flight: {label}")
    print("=" * 60)

    # Build (render + validate + snap) both routes up front so a bad route fails before we touch
    # the phone. build_gpx returns None on validation failure.
    print("\n> Building the two ground routes (departure + arrival)...")
    depart_gpx = build_gpx(route_path(trip["depart_route"]))
    arrive_gpx = build_gpx(route_path(trip["arrive_route"]))
    if not depart_gpx or not arrive_gpx:
        print("  A route failed to build/validate — aborting.")
        return

    print("\n  Reminders before we start:")
    print("   - Destination saved as a Life360 Place? (the arrival push needs it)")
    print("   - A 2nd circle member watching their phone for the push?")
    print("   - Observer running?  core/tools/observe.py --watch --member \"<you>\" --log flight.jsonl")
    print("   - Phone on the CABLE + unlocked, Developer Mode on.")
    input("\n  Press ENTER to begin the departure drive...")

    if not DRY_RUN:
        ensure_mounted()
    cd, job = CoreDevice(), None
    try:
        # Leg 1 — drive to the departure airport, then hold there (phone still ONLINE).
        dlat, dlon = trip["depart_hold"]
        print(f"\n> [1/3] Driving to the departure airport ({trip['depart_route']})...")
        play(depart_gpx)
        job = hold(dlat, dlon)
        print("\n> You're at the departure airport, holding.")
        input("  >> Press ENTER to take off (turns AIRPLANE MODE ON). <<")
        airplane(True, cd)

        # Leg 2 — phone is offline now; jump the spoof to the arrival airport and hold.
        alat, alon = trip["arrive_hold"]
        print("\n> [2/3] Phone offline (airplane mode). Moving the spoof to the arrival airport...")
        job.stop()
        job = hold(alat, alon)
        print("  Spoof is at the arrival airport (invisible while offline).")
        input("  >> Press ENTER to land (turns AIRPLANE MODE OFF). <<")
        airplane(False, cd)
    finally:
        if job:
            job.stop()

    # Leg 3 — phone reconnects at the arrival airport; drive into the destination Place.
    print(f"\n> [3/3] Reconnected at the arrival airport. Driving in ({trip['arrive_route']})...")
    print("  (this ends with a ~5 min dwell inside the destination Place — let it finish)")
    play(arrive_gpx)

    print("\n> Trip complete. Watch the 2nd member's phone for the 'arrived' push")
    print("  (Life360's push latency is ~1-5 min). Location reverts to real GPS shortly.")


def list_trips():
    print("\n  vida-360 flights (fly <name>):")
    for name, t in TRIPS.items():
        print(f"   - {name:<6} {t['label']}")
    print("\n  fly airplane on / fly airplane off   just flip airplane mode")
    print()


def main():
    argv = sys.argv[1:]
    if not argv:
        list_trips()
        return
    if argv[0].lower() == "airplane" and argv[1:] in (["on"], ["off"]):
        ok = CoreDevice().airplane(argv[1] == "on", print)
        print("  sent, check the phone" if ok else "  couldn't send it to the phone")
        sys.exit(0 if ok else 1)
    name = argv[0].lower()
    trip = TRIPS.get(name)
    if not trip:
        print(f"  Unknown trip '{name}'.")
        list_trips()
        return
    run_trip(trip)


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\n> Cancelled. Location reverts to real GPS shortly.")
