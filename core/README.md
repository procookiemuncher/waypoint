# core/ — the shared engine

Both `mac-version/` and `windows-version/` launch things from here. Nothing in this folder is
platform-specific — if something only works on one OS, it goes in that version's folder instead.

| Path | What |
|---|---|
| `spoof.py` | The "where do you want to go?" launcher (routes, presets, clear). |
| `routes/` | Route files (`*.json`). Drop a new one in and it shows up in the spoof menu, `drive` and the app. The ones with `"generated": true` come from `destinations.json`, don't edit those by hand. |
| `destinations.json` | The LARP catalog: cities, arrival airport, base hotel, spots + opening hours. `tools/gen_destinations.py` writes the routes from it; `backend/destinations.py` feeds the app's city info and the spot pins. |
| `backend/movement/` | The movement engine: road-snapping, speed planning, jitter, validation, GPX output. |
| `backend/life360/` | Read-only Life360 client used by the Observer. |
| `tools/` | `fly.py` (flight choreographer), `observe.py` + `correlate.py` (Observer), `build_route.py`, `play_route.py`, `gen_destinations.py` (catalog → routes). |
| `tests/` | Offline unit tests: `.venv/bin/python core/tests/test_speed_planning.py` |
| `web/` | The Waypoint app page (Leaflet map + panel), served by `backend/server.py`. Leaflet + fonts vendored, map tiles from Stadia. |
| `backend/server.py` | Local FastAPI server for the app (127.0.0.1 only). Run bare: `.venv/bin/python core/backend/server.py` and open the URL. |
| `backend/session.py` · `device.py` | One phone job at a time + the pmd3 adapter (the only place that shells out to pymobiledevice3). `VIDA_DRY_RUN=1` = touch nothing. |
| `backend/routes.py` · `places.py` · `places.json` | Route list/summary/GPX build shared by spoof.py and the app; static presets. |
| `map-visualizer.html` | The original single-file design mock that `web/` was built from. Kept for reference only. |
| `build/` | Generated GPX + road-snap cache. Git-ignored. |

The `.venv`, `.env` and `requirements.txt` stay at the repo root.
