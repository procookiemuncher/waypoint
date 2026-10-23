"""Life360 Observer data model.

One clean dataclass for a single member's current server-side state. Pure data — no HTTP, no
JSON parsing (that lives in client.py, quarantined). See docs/LIFE360_OBSERVER.md §4.

`speed_raw` is documented as MPH by the pnbruckner/life360 package, but we keep it raw here and
confirm the unit live in build Increment 1 against a known emoji-test speed before trusting it.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class MemberState:
    name: str
    lat: float | None
    lon: float | None
    speed_raw: float | None      # life360 pkg documents MPH — VERIFY live before trusting
    is_driving: bool | None      # the isDriving flag — the key emoji signal to watch
    battery: float | None
    wifi_state: bool | None
    gps_accuracy: float | None
    address: str | None
    place_name: str | None       # location.name — the Place name while INSIDE a Place (arrival state)
    since_ts: int | None         # Life360's "last location update" epoch (server side)
    fetched_ts: int              # when WE polled (for cadence measurement)

    def oneline(self) -> str:
        """A compact single-line readout for one-shot / watch output."""
        drv = {True: "YES", False: "no", None: "?"}[self.is_driving]
        wifi = {True: "on", False: "off", None: "?"}[self.wifi_state]
        loc = (f"{self.lat:.5f},{self.lon:.5f}"
               if self.lat is not None and self.lon is not None else "?,?")
        spd = f"{self.speed_raw:.1f}" if self.speed_raw is not None else "?"
        batt = f"{self.battery:.0f}%" if self.battery is not None else "?"
        acc = f"{self.gps_accuracy:.0f}m" if self.gps_accuracy is not None else "?"
        # The Place name (when inside one) is the arrival signal — surface it prominently.
        at = f" | @{self.place_name}" if self.place_name else ""
        return (f"{self.name} | {loc} | speed {spd} | driving={drv} | "
                f"batt {batt} | wifi {wifi} | acc {acc}{at}")
