# Handoff: a showcase README for Waypoint (2026-11-25)

Paste into a fresh session: **"Read docs/handoff/readme-redesign.md and do what it says."**

## Read first

CLAUDE.md says: **AGENTS.md**, then **PROGRESS.md**. Then, for this job:

- `cini videos/v2/brief.md`: the trailer's art direction (the Leap motif), shot list, rebuild steps.
- `cini videos/v2/trailer/`: `render.mjs` (Playwright, one frame per screenshot), `js/core.js`
  (palette, around line 145), `js/ui.js` (the app UI rebuilt from `app.css`), `js/maps.js`,
  `data/*.js` (real routes, catalog, world map, icon).
- `mac-version/app/icon.svg`: the master mark. `core/web/static/app.css` (tokens near line 258),
  `core/web/static/fonts/` (Inter, JetBrains Mono, woff2).
- `docs/MOVEMENT_ENGINE.md` (road-aware driving), `core/destinations.json` (catalog numbers).
- Load the `design-taste-frontend` skill (direction is already chosen, below; use it for the
  look-and-fix loop and the no-slop rules) and `artifact-diagramming` for the diagrams.

## Decisions (owner, 2026-11-25)

| Question | Answer |
|---|---|
| Audience | **Portfolio / LinkedIn.** Show off the engineering. Someone who's never heard of it should get it in 10 seconds and be impressed in 60. |
| Trailer | **Short loop.** Cut a 6–10 s loop that plays inline (animated WebP, GIF as fallback). No manual upload step. |
| Scope | **Root `README.md` only.** Sub-READMEs stay as they are. |
| Look | **Match the trailer:** the Leap motif, dark ground, lavender, Inter + JetBrains Mono. No new direction. |

## What GitHub allows (design inside this)

- **No CSS, no JS.** `style`, `class`, `<script>`, `<style>` are stripped. Allowed: `<p align="center">`,
  `<img width>`, `<picture>` + `<source media="(prefers-color-scheme: dark)">`, `<details>`,
  `<table>`, `<br>`, `<sub>/<sup>`, `<kbd>`, GitHub alerts (`> [!NOTE]`), Mermaid (weak styling,
  avoid for hero visuals).
- **Every bit of beauty is an image.** SVG, PNG, WebP, GIF from the repo all render (served via
  GitHub's camo proxy).
- **Animated SVG in `<img>` animates** (CSS `@keyframes` / SMIL inside the file), but it can't load
  external fonts. **Convert text to paths, or embed a subsetted font as base64 `@font-face`
  in the SVG.** Otherwise it falls back to a system font on GitHub. Check this on github.com.
- **An `.mp4` committed to the repo does not play inline.** Hence the WebP loop.
- **Content column is ~830–1010 px wide.** Render art at 2× (e.g. 1800 px wide) and set
  `width="900"` so it's crisp on retina.
- **Both themes.** Simplest robust approach: art lives on **dark rounded cards with transparent
  corners**, which look intentional on light and dark GitHub. Use `<picture>` dark/light variants
  only where art sits directly on the page background (e.g. a transparent wordmark/divider).
- Keep each asset light: loops ≤ ~4 MB, stills ≤ ~400 KB. Total under ~15 MB.

## Brand tokens (don't invent new ones)

- Ground `#0a0b0f` / `#0d0d10`, panel `#121319`, raised `#191a21`, line `#22232b`.
- Ink `#f4f4f5`, ink2 `#d4d4d8`, muted `#9a9aa5`.
- **Lavender `#b49aff`** (accent, the mark), deep `#63548c`, icon tile `#17141f`.
- Positive `#22c55e` / `#3fc07a`, warn `#f5a524`.
- Per-country catalog colours live in `core/destinations.json` → `"countries"`.
- Type: **Inter** (display + body), **JetBrains Mono** (console, numbers, code).
- Motif: **the Leap** = hollow start ring → one arc → solid landing dot ("from here to anywhere").
  Every route is drawn with a ring where it starts and a dot where it lands. Flat, no gradients
  on the mark.

## The README, top to bottom

1. **Hero** (animated SVG or WebP): the Leap builds, the wordmark **Waypoint** slides out of it,
   tagline *From here to anywhere.* One line under it: what it is in plain words, e.g.
   "Set your own iPhone's location from your Mac: pins, real-speed drives on real roads, whole trips."
   A small row of quiet badges (macOS · Windows · Python 3.12 · iOS 17+), styled in the palette
   (shields.io with custom colours, or our own SVG pills).
2. **The loop**: 6–10 s from the trailer, ideally S6→S7 (press play → the drive on the tilted
   night map → ARRIVED). Render it fresh from the trailer pipeline at README size; don't
   transcode the 4K mp4 if rendering is cleaner.
3. **Three steps** strip (one image, three cards): *Plug in* → *Pick a place* → *Press play*,
   mirroring trailer S2–S6.
4. **Features** (2×2 card grid as images, or an image + short text table):
   - **Real speed.** The drive path reports a real speed, so apps show mph and driving, not a
     teleporting dot.
   - **Real roads.** Valhalla-snapped routes, each road at its speed limit, red lights rolled per
     drive, stop signs, slower turns, gentle stops.
   - **Whole trips.** `fly`: drive to the airport, go offline for the flight, land, drive in, dwell.
   - **Fast to use.** ⌘K palette, a globe, a catalog with local opening hours and time zones.
5. **How it works** (the engineering showcase). Branded SVG diagrams, not Mermaid:
   - The **three layers**: UI (web page, Leaflet + MapLibre, pywebview) → Core (session, engines,
     movement engine) → Adapter (`device.py`, the only module that touches pymobiledevice3) →
     iPhone over the RemoteXPC tunnel. Caption: why the adapter is isolated (Apple's transport churn).
   - **Two location services** side by side: DVT simulate-location (lat/lon only, speed −1) vs
     CoreDevice location service (waypoints + speed). That difference is the whole "real speed"
     story.
   - **The movement pipeline**: route JSON → snap (Valhalla) → road attributes → driver model
     (lights, stops, turns, jitter) → validator (refuses unrealistic routes) → timed fixes → phone.
     Mention seeded drives (same seed = identical drive, byte for byte).
   - A few engineering bullets: no Xcode, no admin, no jailbreak; local-only FastAPI with
     Host checks; signed (Ed25519) auto-updates; 160+ tests.
6. **In numbers** (one image over the trailer's world map, S10): spots / cities / countries /
   continents. **Recount from `core/destinations.json` when you build it**, don't copy the trailer's.
7. **Quickstart**: Mac and Windows side by side (a two-column table), 3–4 lines each, linking to
   `mac-version/README.md` and `windows-version/README.md`.
8. **Limits, honestly** (`<details>` or a short list): cable only, phone unlocked, Developer Mode,
   motion-based driver reports can't be faked, an iOS update turns Developer Mode off.
9. **For agents / future me** (`<details>`, collapsed): keep the existing links to AGENTS.md,
   ROADMAP.md, PROGRESS.md and the folder table. CLAUDE.md onboarding depends on these.
10. Footer: credits (OpenStreetMap ODbL, Natural Earth, Inter / JetBrains Mono OFL, music
    credit only if audio ever ships), a thin Leap divider.

Copy voice: short, confident, concrete. Numbers over adjectives. No emoji walls, no
"blazingly fast", no em-dash-heavy marketing prose.

## Guardrails

- **Framing:** the copy describes simulating *your own* iPhone's location. No "undetected", no
  naming Uber / Tinder / Pokémon Go or any use case about fooling a service. Don't feature the
  detection research.
- **Visuals:** no Life360 name or logo, no other app's branding, no owner name, no home
  coordinates (same rule as the trailer brief). In prose, say "location-sharing apps" generically.
- **Screenshots** only from `VIDA_DRY_RUN=1` + headless Chrome, or rebuilt in the trailer
  pipeline. **Never touch the real phone.** `docs/design/side-panel-mockups/shots/` are old mockups,
  not the current UI, don't use them.
- Everything shown must be real (real routes, real catalog numbers, real console output), like
  the trailer.

## How to build it

- New folder **`docs/readme/`**: `src/` (HTML scenes for each asset, sharing the trailer's
  `js/core.js` palette, `data/*.js` and fonts by relative import, no copying), `build.sh`, and the
  output assets (`hero.svg` or `hero.webp`, `loop.webp`, `steps.png`, `features-*.png`,
  `layers.svg`, `services.svg`, `pipeline.svg`, `numbers.png`, `divider.svg`).
- Reuse `cini videos/v2/trailer/render.mjs` (it already takes `--page` and serves the repo root
  offline). It hard-codes 1920×1080, so add a `--size WxH` option there, or a thin sibling
  renderer in `docs/readme/`. Keep the trailer rendering exactly as before.
- Loop: render frames → ffmpeg (`node_modules/ffmpeg-static/ffmpeg`) → animated WebP
  (`-c:v libwebp -loop 0 -q:v 70`, check `-encoders | grep webp` first). GIF fallback via
  `palettegen`/`paletteuse`. Make the loop seamless (end frame flows into the first).
- Diagrams: hand-authored SVG in the brand, text as paths or embedded subset font. Check each
  at 100% and at phone width.
- `build.sh` regenerates every asset from source, so the README art can be re-rendered when the
  app changes.

## Done means

- [ ] Rendered through GitHub's sanitizer:
      `gh api markdown -f mode=gfm -f context=procookiemuncher/waypoint -f text=@README.md > /tmp/readme.html`,
      opened, nothing stripped that you relied on.
- [ ] Pushed and looked at **on github.com in dark and light theme**, desktop width and a narrow
      window. Screenshot both themes for the owner (headless Chrome against the logged-in page
      isn't possible, so ask the owner to look, or check the rendered HTML with the same images).
- [ ] Animations play on GitHub; SVG text renders in Inter/JetBrains Mono, not a fallback font.
- [ ] Asset sizes within budget; `docs/readme/build.sh` rebuilds them all.
- [ ] Every number and claim checked against the code/catalog today.
- [ ] The "for agents" links still work.
- [ ] Small signed commits pushed one by one (scaffold, renderer size option, each asset, the
      README copy, fixes from the look-and-fix loop), then a PROGRESS.md entry.

## Open, for the owner (not blocking the build)

- **The repo is private.** A LinkedIn link needs it public, or a separate public showcase repo
  with just the README + assets. Going public as-is would expose AGENTS.md, the research docs,
  license/dashboard URLs and the commit emails. Recommend a separate showcase repo; decide before
  linking.
- The GitHub repo description ("undetected spoofing for find my, life 360, pokemon go, tinder,
  uber, etc") doesn't match the showcase framing. Worth rewording before it goes public.
