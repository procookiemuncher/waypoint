"""vida-360 backend package.

Layered per AGENTS.md: Core (LocationBackend + movement engine) depends only on its own
interfaces; the pymobiledevice3 adapter is the single place that imports pmd3. The movement
engine lives in `backend.movement` and knows nothing about the transport.
"""
