I want to brainstorm the side panel of Waypoint's world view (the vida-360 map + spoofing UI) and then see **5 mockup designs** of it. Read AGENTS.md and PROGRESS.md first like CLAUDE.md says. Then load the `design-taste-frontend` skill and read its `references/app-screens.md`, because this is an app screen, not a landing page.

## Where we are

The globe is decided and prototyped in `docs/design/world-view-prototype/` (its README says how to run it and what each file is). Run it and click around before you design anything:

```
python3 -m http.server 8790 --bind 127.0.0.1 --directory docs/design/world-view-prototype
```

- **Globe: style A, solid silhouette.** Sphere one dark tone, land one step lighter, no borders. It holds still and eases round when I hover a country in the list.
- **Colour on hover.** Each of my 21 countries has its own colour, picked for the place's feel (Miami neon pink for the US, Provence lavender for France, Majorelle blue for Morocco...). The table is `HUE` in the prototype's `index.html`. Only the hovered or open country shows its colour; at rest the globe is one tone. The list rows carry a small dot in that colour.
- None of this is in the app yet. `globe.js` was written to drop into `core/web/static/` as is.

**The panel is the problem.** It works, but it feels too basic: a plain typographic list of countries (name, cities in grey, route count), and a country panel that's a list of route and place rows under city headings, with the play controls docked at the bottom. I want ideas for making it feel like a real product, not a template.

## What stays fixed

- The globe and its colours. Don't redesign them.
- Countries first, no city step: hovering a country row turns the globe, clicking it opens that country's panel (in the app the globe zooms into the Leaflet street map there). Always two clicks from the world view to a route.
- No emoji flags anywhere (Windows shows 🇺🇸 as "US"). The country's colour is its identity now.
- Everything the current panel can do still has to be there, so check `core/web/index.html` and `core/web/static/app.js` (`selectItem`, `renderEngines`, the `#nowplaying` card):
  - Pick a route, choose the engine (Drive = real speed, Life360 shows mph and the car; Spoof = position only), optionally type an mph, then play.
  - While it plays: the progress, elapsed time, Stop & clear, and Follow.
  - Pick a place and set the location there.
  - A dropped pin (from a map click, or ⌘K `go <address>`) and its "set location here".
  - The ⌘K search button.
  - The console with its prompt sits under the panel today. It can be restyled or moved, but it can't disappear.
- The stack: vanilla HTML/CSS/JS, no React, no build step, no CDN. 21st.dev is fine for inspiration (search is free), but don't spend `get_component` retrievals unless I ask.

## What's open

Everything about how the panel looks and what it shows, in four states: the world list, a country (France has three cities, Japan has one), a selected route, and a route playing. Also still undecided: whether the list is grouped by continent or sorted by route count (the prototype's List switch). Last time I said no cards and no thumbnails in the list. Flags stay out, but if a design really earns a picture (say the route's own line drawn small, or the city's street map), show me and tell me which rule it bends.

There's more real material than the panel uses today. Use it instead of ornament:
- **Per country:** its colour and the vibe name, its continent, its cities.
- **Per city:** local time and timezone, the arrival airport, a base hotel, the centre.
- **Per spot:** its kind (hotel, restaurant, club, beach...), opening hours (so "open now" / "opens 11 pm" in local time), and sometimes a note ("Wed–Sun").
- **Per route:** label, distance, duration, cruise speed, its modes (walk / drive / stop), and the line itself (you can draw it). The route files also say whether they were generated from the catalog (`"generated": true`), but `/api/routes` doesn't pass that on yet.
- **What it's for:** I'm LARPing being there. A believable arrival is airport → hotel → spot, at a time when the spot is actually open. Timing and order matter.
- Most of this is in `core/destinations.json` and `/api/cities` / `/api/routes` / `/api/places`. The prototype's `lib.js` only carries part of it; extend `dump-lib.mjs` if you need more.

## What I want from you

1. **Brainstorm first.** Give me a short list of directions (one or two lines each) before building, and say which five you're mocking and why. The five should be genuinely different ideas about what the panel *is*, not five colourways of the same list. At most one or two of them may question the frame (map left 60%, panel right 40%, console under the panel); say so when one does.
2. **Build the 5 mockups** on top of the prototype: same globe, same `lib.js` data, real numbers only, nothing invented. One page with a switch (1–5) or five pages, whichever is easier to compare. Put them in `docs/design/side-panel-mockups/`. Each mockup covers all four states: world list with a country hovered, France, Japan, a selected route, and a route playing.
3. **Follow the skill's app-screen rules:** no monospace, no tiny tracked caps, no glass, glows or gradients, no icons in tinted tiles, colour on data. "Too basic" should be fixed with real content, hierarchy and scale, not decoration. The violet accent `#b49aff` is used in my promo videos: ask before changing it.
4. **Show me.** Screenshot every mockup in every state (1440×900, deviceScaleFactor 2). Read each one yourself before showing it. For each design, give me one paragraph on the idea and one line on what it gives up. Then serve the mockups on a throwaway localhost so I can click through them. Serve the folder, not the repo root, because the root has `.env`.
5. **Then stop and let me pick** (or mix). Don't touch `core/web/` this session.

## Practical bits

- **Screenshots:** Playwright lives in `cini videos/v1/sting/node_modules`. Resolve it with `createRequire` (`dump-lib.mjs` shows how) or put a script in that folder temporarily. Launch with `chromium.launch({ headless: false, args: ['--headless=new'] })`, since the headless-shell build isn't installed.
- **The real app,** if you need it: from `core/`, run `VIDA_DRY_RUN=1 VIDA_PORT=8765 ../.venv/bin/python backend/server.py`, then call `skipLink()` to get past the connect screen. Never play a route outside dry run; it moves my real pin in front of my Life360 circle.
- **Git:** follow my global rules. Small commits pushed as you go, human-sounding messages. Add a dated PROGRESS.md entry at the end.

## For later, not this session

Once I've picked a panel, the build is:
- `globe.js` + `countries.json` into `core/web/static/` (add the JS to `MINIFY_JS` in `mac-version/release/stage_assets.py`, single-line strings only).
- The country colours into `destinations.json`, probably replacing the per-city colours so a country's routes draw in its colour.
- The browse rewrite, and the globe → Leaflet crossfade.
- Removing the emoji flags.
- The skill's `lint.mjs` on `core/web` before and after. Before, on 2026-11-20, was 19 FAIL / 120 WARN.
- Screenshots of the world view, a multi-city country, a single-city country, a selected route and a playing route.
