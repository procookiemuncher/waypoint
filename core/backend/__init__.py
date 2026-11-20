"""vida-360 backend package.

Layered per AGENTS.md: Core (LocationBackend + movement engine) depends only on its own
interfaces; the pymobiledevice3 adapter is the single place that imports pmd3. The movement
engine lives in `backend.movement` and knows nothing about the transport.
"""
import os
import sys

# Windows writes to pipes and log files as cp1252, and a log line with — or → in it raised
# UnicodeEncodeError (it killed the phone check). UTF-8 here, and for every python we start.
if sys.platform == "win32":
    os.environ.setdefault("PYTHONUTF8", "1")
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
