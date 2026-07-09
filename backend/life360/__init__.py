"""vida-360 Life360 Observer (read path).

The mirror of the movement engine: that engine WRITES a location onto the phone; this READS what
Life360's servers report back about our own member, so on-device experiments produce data instead
of eyeballed guesses. Read-only; all HTTP/JSON stays quarantined in client.py. See
docs/LIFE360_OBSERVER.md.
"""
from .model import MemberState
from .client import Life360Client, Life360Error

__all__ = ["MemberState", "Life360Client", "Life360Error"]
