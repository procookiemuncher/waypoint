# Side panel mockups

Five ideas for the world view's side panel, built on the prototype in `../world-view-prototype/` (same globe,
same colours, same data). Brief: `docs/handoff/side-panel-brainstorm-prompt.md`. **Design 1 (Arrival plan)
was picked and built into `core/web/` on 2026-11-20**; these pages aren't loaded by the app. One page, a design switch (1–5) and a state switch (World, France, Japan, Route,
Playing, Place, Pin). Everything clicks: hover a country to turn the globe, open it, pick a route, choose
Drive or Spoof, type an mph, play, stop, follow, set a place, type `help` in the console.

## Run it

```
python3 -m http.server 8791 --bind 127.0.0.1 --directory docs/design/side-panel-mockups
```

then http://127.0.0.1:8791/ (serve this folder only, the repo root has `.env`). `?d=3&s=playing` opens a
design in a state; add `&now=2026-11-20T19:30:00Z` to pin the clock (otherwise it's the real time, and
open/closed and local times are live).

Screenshots: `node docs/design/side-panel-mockups/shoot.mjs [designs] [states]` with the server running
writes `shots/` (gitignored), 1440×900 at 2x, the clock pinned to Friday 20 Nov 2026 19:30 UTC (8:30 pm in
Paris, 4:30 am Saturday in Tokyo), and a contact sheet at `shots/index.html`. From a worktree set
`PW_ROOT` to a folder with playwright in its node_modules (`cini videos/v1/sting`).

## The five

| | Idea | What the panel is |
| --- | --- | --- |
| 1 Arrival plan | A city is an arrival in order: airport → hotel → spot. Routes are the links, places the stops. The picked link says when you'd be at the door and whether the place is open then. | a plan |
| 2 Local clock | Time is the axis. The world list runs round the clock by local time with what's open; a city is a strip from 30 min ago to 3.5 h ahead, routes as bars starting now in their legs, spots in their hours. | a clock |
| 3 Ledger | A sortable table: continent, routes, local time, open now. A country is its routes, places and cities as tables; the pick gets a key-value sheet. | a table |
| 4 Atlas | A guidebook page: an index in large type, a cover in the country's colour, each city's facts, every route drawn as its own line. Bends "no thumbnails": the pictures are the routes. | a guide |
| 5 Rail + sheet | Questions the frame: a country rail that stays, a sheet that previews on hover, and the phone's live state moved into a strip under the map, beside the console. | a switchboard |

The List question gets a different answer in each: 1 and 5 group by continent, 2 by local time, 3 lets
you sort by any of them, 4 sorts by route count.

## Files

| File | What |
| --- | --- |
| `index.html`, `shared.css`, `shared.js` | the page, tokens, the state (from the URL), formatting, the globe, clicks, the console |
| `d1-plan.*` … `d5-rail.*` | one renderer + stylesheet per design |
| `data.js` | from `dump-data.py`: the prototype's `lib.js` plus what the panel can use (below) |
| `globe.js`, `countries.json`, `icons.js`, `fonts/` | copied from the prototype so this folder serves on its own |
| `shoot.mjs` | the screenshots + contact sheet |

## Data, and what it turned up

`dump-data.py` (run from the repo root with `.venv/bin/python`) adds, all read from the repo:
airport names and base hotels and spot notes from `core/destinations.json`, the `generated` flag from the
route files, where each generated route starts and ends (from its id, the way `gen_destinations.py` builds
it), and each route's legs: walk / drive / parked, seconds and metres, from the movement renderer at seed 0
(the GPX Spoof plays; Drive starts from the same render with a new seed, about a minute either way).

- **`/api/routes` under-reports play time.** `summary()` is distance ÷ first moving speed + stops, so a
  walk-only route gets no time for the walk: The Dorchester → Sexy Fish London says 10 min and plays 19, The
  Plaza → The Polo Bar 10 vs 15, CDG → Ritz 42 vs 44. The mockups show the rendered time. The build
  should send the legs (or at least the rendered total).
- `/api/routes` doesn't send `generated`, and `/api/places` doesn't send `note` or `access`.
- Spot notes are free text ("Apr–Oct", "winter only, Dec–Apr", "peak Dec–Apr", "Wed–Sun"). The mockups print
  them as written and never turn them into open/closed. On 20 Nov, Club 55 and Cheval Blanc (Apr–Oct) and
  Les Airelles (Dec–Apr) are out of season, which is exactly what a believable arrival needs to know. A
  structured `season` / `days` field in the catalog would let the panel say so.
- Console lines are the app's own, copied from a dry run (`play cdg-to-ritz-paris --drive` and `set
  club-55`), including the drive plan line "108 moving chunks, 1 stops, 2-41 mph, ~44.9 min".
- The dropped pin is a pin at Place Vendôme with its name and coordinates typed in by hand (not looked up
  through Photon); the playing state is 14:05 into CDG → Ritz.

## Known limits

- Made for the Mac window at 1440×900. The skill's inspector passes at 1440 (one WARN: the console's
  blank band under a few lines); at 768 and 390 the mockup's switch bar overflows and the 60/40 frame
  doesn't fold. Not worked on.
- Single-city countries (Japan) are short in 1, 2 and 5: one route and one hotel is all there is.
- Design 2's strip only moves when re-rendered (the numbers tick, the bar doesn't slide yet).
