# World view prototype

A standalone mock of the redesigned world view, outside the app, used to pick the globe and to work
on the side panel before any of it goes into `core/web/`. Not shipped and not loaded by the app.

Decided so far (2026-11-20):

- **Globe style A, solid silhouette:** sphere one dark tone, land one step lighter, no borders, no
  texture, glow or grid. Still when idle, eases round on hover (critically damped spring).
- **Colour on hover:** each catalog country has its own colour (the `HUE` table in `index.html`,
  picked by the place's feel, all held near the same lightness so none shouts). Only the hovered or
  open country shows it; at rest the globe is one tone. The list rows carry a small dot in it, which
  is what replaces the emoji flags.
- Tiny countries missing from Natural Earth 1:110m (St. Barths, Monaco, Singapore, Maldives,
  French Polynesia) are dots at their city.
- On trial (2026-11-20, switches in the bar, not decided): **Stars** (the real sky behind the globe,
  Yale Bright Star Catalog to mag 6.5, placed by sidereal time; no twinkle, there's no air in space),
  **Depth** (sphere darkens toward its edge), **Night** (the real night side right now, soft through
  twilight; the hovered country is drawn over it so its colour holds), **Rim** (thin atmosphere; this
  one goes against "no glow", so it's off by default). **Sky: Drifts** turns the stars 12% as far as
  the globe, **Real** turns them all the way, which is true but busy on every hover.
- Still open: the side panel (it works but reads as too basic), and whether the country list is
  grouped by continent or sorted by route count (the List switch in the bar).

## Run it

```
python3 -m http.server 8790 --bind 127.0.0.1 --directory docs/design/world-view-prototype
```

then http://127.0.0.1:8790/. Serve this folder only, not the repo root (the root has `.env`).

## Files

| File | What |
| --- | --- |
| `index.html` | the page: globe on the left 60%, the panel on the right 40% (country list, country panel, play dock, a console stub for its real height) |
| `globe.js` | the globe, written to drop into `core/web/static/` as is (single-line strings for rjsmin). `new Globe(canvas, shapes, { style, tint, onHover, onClick })`, then `setPlaces`, `setLit`, `setPalette`, `focus(name, zoom)`, `highlight`, `zoomTo` |
| `countries.json` | Natural Earth 1:110m outlines from `core/tools/build_countries.py --out <here>/countries.json` |
| `sky.js` | the star sky, its own canvas under the globe's. `new Sky(canvas, stars, { follow, lon })`, redrawn from the globe's `onView` |
| `stars.json` | 8,404 stars (RA, Dec, magnitude, temperature) from `core/tools/build_stars.py --out <here>/stars.json` |
| `lib.js` | the app's real cities/routes/places, from `dump-lib.mjs` against a dry-run app |
| `icons.js`, `fonts/` | copies of the app's Lucide icons and Inter (latin), so this folder serves on its own |
