"""vida-360 movement engine (Core layer).

Turns human-authored route.json into a validated, believable point stream (and GPX for
`simulate-location play`). No pymobiledevice3 imports live here — the transport stays below
the LocationBackend interface. See docs/MOVEMENT_ENGINE.md.
"""
from .model import Route, Segment, LocationFix, load_route, parse_route
from .renderer import RouteRenderer
from .validator import validate, validate_or_raise, ValidationResult

__all__ = [
    "Route", "Segment", "LocationFix", "load_route", "parse_route",
    "RouteRenderer", "validate", "validate_or_raise", "ValidationResult",
]
