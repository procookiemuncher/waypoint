# core/ — the shared engine

Both `mac-version/` and `windows-version/` launch things from here. Nothing in this folder is
platform-specific — if something only works on one OS, it goes in that version's folder instead.

| Path | What |
|---|---|
| `spoof.py` | The "where do you want to go?" launcher (routes, presets, clear). |
| `routes/` | Route files (`*.json`). Drop a new one in and it shows up in the spoof menu and `drive`. |
| `backend/movement/` | The movement engine: road-snapping, speed planning, jitter, validation, GPX output. |
| `backend/life360/` | Read-only Life360 client used by the Observer. |
| `tools/` | `fly.py` (flight choreographer), `observe.py` + `correlate.py` (Observer), `build_route.py`, `play_route.py`. |
| `tests/` | Offline unit tests: `.venv/bin/python core/tests/test_speed_planning.py` |
| `map-visualizer.html` | Self-contained waypoint map UI (open in a browser). |
| `build/` | Generated GPX + road-snap cache. Git-ignored. |

The `.venv`, `.env` and `requirements.txt` stay at the repo root.
