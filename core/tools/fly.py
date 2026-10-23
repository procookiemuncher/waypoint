"""vida-360 flight choreographer — double-click **windows-version/fly.cmd** / **mac-version/fly.command**
(or run `python core/tools/fly.py`).

Runs a believable *flight* between two cities so Life360 pushes "arrived at <destination>". It
choreographs the spoof around a manual **airplane-mode** gap: the phone goes offline exactly like a
real flight, so Life360 never sees the (impossible, compressed) flight itself — only the airport
departure before and the driven arrival after. Full rationale + the sequence table:
docs/superpowers/specs/2026-07-10-flight-arrival-spoofer-design.md.

The tool cannot toggle airplane mode — you do that by hand when prompted. Sequence:

  1. Tool  : drive to the departure airport (a route), then hold there.
  2. YOU   : toggle airplane mode ON  -> press ENTER.
  3. Tool  : move the spoof to the arrival airport (instant; phone offline, Life360 blind), hold.
  4. YOU   : toggle airplane mode OFF -> press ENTER.
  5. Tool  : drive from the arrival airport into the destination Place, then dwell -> "arrived" push.

    fly.cmd                # list trips
    fly.cmd nyc            # run the Miami -> New York City trip

Before running:
  - Save the DESTINATION as a Life360 Place in the app (the API can't create Places). Point the
    arrival route's final waypoint at it (see the trip's arrive_route JSON).
  - Have a SECOND circle member's phone handy — only it can see the "arrived" push (the API can't).
  - Run the Observer alongside to confirm arrival state server-side:
        .venv\\Scripts\\python.exe tools\\observe.py --watch --member "<you>" --log flight.jsonl
  - Phone plugged in + UNLOCKED (Auto-Lock = Never), Developer Mode on, trusted.

⚠ PREREQUISITE GATE (verify once, Step 0 in the spec): does the userspace tunnel survive an
airplane-mode toggle? Hold any spoof (spoof.cmd eiffel), toggle airplane mode on then off, and
confirm the spoof holds / re-establishes. If it drops, the arrival can race the phone's first
real-location upload on reconnect — see the spec's fallback before trusting a real run.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)                       # make `backend` + spoof importable

# Reuse the transport glue + route builder already proven in spoof.py — no duplicated pmd calls.
from spoof import pmd, ensure_mounted, build_gpx, ROUTES_DIR  # noqa: E402

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


def hold(lat, lon, prompt):
    """Set-hold a fixed point; the pmd `set` keeps the location until the user presses ENTER.
    We print `prompt` first so the ENTER that exits `set` is the same ENTER that gates the
    manual airplane-mode step."""
    print(prompt)
    pmd("developer", "dvt", "simulate-location", "set", "--userspace", "--", str(lat), str(lon))


def play(gpx):
    pmd("developer", "dvt", "simulate-location", "play", "--userspace", gpx)


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
    print("   - Phone unlocked, Developer Mode on.")
    input("\n  Press ENTER to begin the departure drive...")

    ensure_mounted()

    # Leg 1 — drive to the departure airport, then hold there (phone still ONLINE).
    dlat, dlon = trip["depart_hold"]
    print(f"\n> [1/3] Driving to the departure airport ({trip['depart_route']})...")
    play(depart_gpx)
    hold(dlat, dlon,
         "\n> You're at the departure airport, holding.\n"
         "  >> Now toggle AIRPLANE MODE ON on the phone, then press ENTER here. <<")

    # Leg 2 — phone is offline now; jump the spoof to the arrival airport and hold.
    alat, alon = trip["arrive_hold"]
    print("\n> [2/3] Phone offline (airplane mode). Moving the spoof to the arrival airport...")
    hold(alat, alon,
         "\n> Spoof is at the arrival airport (invisible while offline).\n"
         "  >> Now toggle AIRPLANE MODE OFF on the phone, then press ENTER here. <<")

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
    print()


def main():
    argv = sys.argv[1:]
    if not argv:
        list_trips()
        return
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
