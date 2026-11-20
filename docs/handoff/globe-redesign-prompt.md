I'm redesigning the world view in Waypoint (the vida-360 map + spoofing UI). It looks vibecoded right now. Read AGENTS.md and PROGRESS.md first like CLAUDE.md says. Then load the `design-taste-frontend` skill (the anti-slop one) and read its `references/app-screens.md`, because this is an app screen, not a landing page.

## What we decided in the last session

**The idea.** The 21st.dev "Interactive Globe Explorer" pattern (https://21st.dev/@support_596fe4b8/components/interactive-globe-explorer): a list next to a globe, and hovering a list item turns the globe to that place. I like the pattern. I don't like its globe, which is photoreal satellite texture, clouds and a blue glow, like old Google Earth. I want something modern and much less detailed.

**The globe.** A flat-shaded globe drawn from simplified country shapes:
- No texture, no atmosphere glow, no grid lines, no dot-matrix. Dot globes are the Stripe/Vercel landing page trope, so not that.
- It sits still when idle (no auto-spin). It eases round to face a country when I hover it in the list.
- Clicking a country eases/crossfades into the existing Leaflet street map, framed on that country.
- The globe only exists on the world view. Leaflet stays as the map everywhere else.
- Tiny places (St. Barths, Bora Bora, Maldives, Monaco, Singapore) don't show up at low detail, so they get a dot marker.

Three styles to prototype side by side so I can pick:
- **A. Solid silhouette:** the sphere one dark tone, land one step lighter, no country borders, and the hovered country fills with the accent.
- **B. Silhouette with my countries lit:** like A, but the 21 countries that have routes sit one more step lighter, and the hovered one gets the accent. This is the recommended one.
- **C. Outline only:** the sphere edge plus thin country borders, and only the selected country filled. It's the riskiest, since the skill dislikes thin lines.

**Country/city logic.** Countries first, with no city step:
- `core/destinations.json` has 21 countries and 28 cities. 16 of the countries have exactly one city. Only the US (Miami, New York, Los Angeles, Las Vegas, Aspen), France (Paris, Saint-Tropez, Courchevel) and Italy (Lake Como, Positano) have more.
- **World view:** a typographic country list next to the globe. Each row shows the country name, its cities in grey, and the route count. No cards, no thumbnails, no emoji flags. Sort by route count as now, or group by the `continent` field. Hovering a row turns the globe.
- **Clicking a country** zooms the map to it and opens that country's panel: one scrolling list with each city as a section heading and its routes + places under it. For a one-city country there's no city heading. Local time and the airport sit by the city heading.
- **Clicking a route** highlights it on the map and dims the rest to grey. The play controls dock at the bottom of the panel.
- It's always two clicks from the world view to a route.
- The backend needs nothing: `/api/cities` already returns country/continent/tz/center/flag, and `core/web/static/app.js` already has `countryOf` / `countryCities` / `countryItems` (around lines 640-790, the browse rendering). This is mostly a rewrite of that rendering.

**Drop the emoji flags.** Windows doesn't render flag emoji (🇺🇸 shows as "US"), and Windows is a target. The lit country shape on the globe replaces the flag.

## Constraints that bite

- **The stack:** the page is vanilla HTML/CSS/JS + Leaflet in `core/web/`, with no React and no build step. "Python end-to-end" is a project rule. 21st.dev components are React/shadcn, so port their structure by hand, never install. Don't spend `get_component` retrievals (they're paid) unless I ask.
- **New static JS:** any new file (e.g. `core/web/static/globe.js`) has to be added to `MINIFY_JS` in `mac-version/release/stage_assets.py`, using single-line strings only (rjsmin).
- **No CDN:** vendor everything locally like Leaflet is.
- **Country shapes:** Natural Earth 1:110m (public domain). Convert them once with a small Python tool in `core/tools/` into a trimmed JSON the page loads, simplified polygons in lon/lat. Do the orthographic projection ourselves (about 40 lines, onto a `<canvas>`) rather than pulling in d3.
- **Running it safely:** `VIDA_DRY_RUN=1` makes phone commands no-ops. Start it from `core/` with `VIDA_DRY_RUN=1 VIDA_PORT=8765 ../.venv/bin/python backend/server.py`, then call `skipLink()` to get past the connect screen. A non-dry run moves my real pin in front of my Life360 circle, so don't play routes outside dry run.
- **Screenshots:** Playwright is in `cini videos/v1/sting/node_modules`. Put the script in that folder temporarily so it resolves, and launch with `chromium.launch({ headless: false, args: ['--headless=new'] })` (the headless-shell build isn't installed).
- **Known world-view bug to fix along the way:** the Leaflet world view letterboxes (black bands top/bottom) and wraps (NORTH AMERICA twice). The globe replacing that view fixes it.
- **Where the rest is heading:** strip the costume (RGB window ring, CRT/vignette/flicker overlays, mono tiny-caps HUD chips, glows, glass). The ⌘K palette (`palette.js`) is the cleanest part of the app and is the visual reference for the rest. The accent `#b49aff` is violet, which the skill flags. Ask me before changing it, since the promo videos use it.
- **Git:** follow the git rules in my global CLAUDE.md: small commits, pushed as you go, human-sounding messages.

## What to do

1. **Prototype first, outside the app:** one standalone HTML file in your scratchpad. Show the three globe styles A/B/C side by side, each with the real 21 countries, the hover-to-turn list, and a mocked country panel for France (multi-city) and Japan (single city). Screenshot it and show me. Stop and let me pick.
2. **Then build the picked style into the app:**
   - `globe.js` plus the country data tool, then the browse rewrite (country list → country panel → route).
   - The globe → Leaflet transition.
   - Remove the emoji flags.
3. **Check it:**
   - Run the skill's `lint.mjs` on `core/web` before and after and report the counts.
   - Screenshot the world view, a multi-city country, a single-city country, a selected route, and a playing route.
4. **Finish up:** append a dated PROGRESS.md entry and update AGENTS.md if anything there changes.
