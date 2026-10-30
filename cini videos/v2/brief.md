# Waypoint trailer (v2): treatment

45 seconds, 1920x1080, 60 fps, stereo, -14 LUFS. Rendered frame by frame from HTML
(`trailer/`), so every frame is a pure function of the clock and can be re-rendered exactly.

## The idea

Art direction came from the `design-taste-frontend` skill (direction **one-motif**, seed
663483750, brand palette and type kept) and the `logo-design` skill (motion built from the
mark's own construction, the resolve equals the master icon, the lockup gap comes from the mark).

> In this film, **the Leap** (the icon's hollow start ring, one arc, solid landing dot: "from
> here to anywhere") **becomes every transition and every stage.**

- The cold open builds the mark at monumental scale and rides its arc.
- Transitions are its parts: the landing dot swells and hollows into a ring that opens the
  next shot, a ring wipes out of the console's return, and the arc is the flight from MIA to JFK.
- Every route is drawn with a hollow ring where it starts and a solid dot where it lands.
- The film ends by building the mark one last time, on the real icon.

Everything shown is real: the app's own UI rebuilt from `app.css`, real road-snapped routes,
real catalog numbers and real console and `fly` output. The connect screen's laptop shows the
Leap. In the app it still has the old arrow (`core/web/index.html`, `#link-scene .mark`).
No Life360 name or logo, and no owner name or home coordinates.

## Music

"Rising Forest" by Diego Nava (Mixkit, free licence). It measures 124.00 BPM, so 45 s is exactly
93 beats. The cut starts on source bar 20, which puts the eight-bar breakdown's last four bars
under the cold open. The big drop (source bar 24) lands on film beat 16, the shutter. The 16 bars
of full groove run under the features and end on beat 80, where the track's own breakdown begins
under the logo. The track fades from beat 88.5. While the phone is offline in the fly shot, the
whole track sits behind a low-pass (the cabin) and snaps open on landing.

## Shots (beats; 1 beat = 0.484 s)

| # | beats | line on screen | what it shows |
|---|---|---|---|
| S1 | 0-8 | From here / to anywhere. | Letterboxed cold open. The Leap builds and the camera rides the arc. Pulls back to the full line, then the dot swells into a ring that opens S2 |
| S2 | 8-16 | Plug in / your iPhone. | The connect screen. The rainbow wire lights and Plugged in, Unlocked, Ready tick on beats 12-13-14. A dive into the phone, lavender flash |
| S3 | 16-24 | Put your iPhone / anywhere. | THE DROP. The flash settles into a flat lavender stage notched by a ring. The app window shutters open (the signature move) and the letterbox pulls away |
| S4 | 24-32 | Pick a place. | Through the window into the world map: city tags, the map's sweep, the Destinations panel. The cursor clicks Miami |
| S5 | 32-40 | Right place. / Right time. | Miami's city page: local time there, 8 routes, 57 mi, 122 min, places with real opening hours. All 8 routes drawn on Miami |
| S6 | 40-48 | Press play. | Hero card (Drive, 35 mph) and the console typing `play mia-to-faena-miami --drive --mph 35`. Return on beat 44, the app's log lines |
| S7 | 48-56 | Real roads. / Real speed. | The drive on a tilted night map, heading-up, with the HUD. Pull-out and ARRIVED · Faena Hotel |
| S8 | 56-64 | Or fly. | `fly nyc`: the Leap's arc from MIA to JFK while the phone is offline. Dive into New York, JFK to The Plaza, ARRIVED |
| S9 | 64-72 | (city names) | One city a beat, each in its own catalog colour: Paris, London, Dubai, Tokyo, Sydney, Cape Town, Monaco, Rio |
| S10 | 72-80 | 35 spots / 28 cities / 21 countries / 6 continents | Figures roll in over a world map where every spot lights up |
| S11 | 80-93 | Waypoint / From here to anywhere. / for Mac | The Leap builds on the real icon, the wordmark slides out of it, fade |

## Rebuild

```sh
cd "cini videos/v2/trailer"
ln -s ../../v1/sting/node_modules node_modules   # or: npm install
../../../.venv/bin/python prep/library.py          # routes + catalog -> data/library.js
../../../.venv/bin/python prep/world.py            # Natural Earth -> data/world.js
../../../.venv/bin/python prep/osm.py              # OSM regions -> data/maps.js (cached in cache/osm)
../../../.venv/bin/python prep/assets.py           # icon.svg -> data/icon.js
./sheet.sh name "120,464,900"                      # contact sheet of frames
./film.sh preview                                  # half-res 30 fps check with sound
./film.sh                                          # the master: out/waypoint-trailer.mp4
```

Timing lives in `js/timeline.js` (named beats). Shots and `audio/build.mjs` both read it, so a
retimed moment moves its sound with it. `node audio/cues.mjs` checks that every cue can be heard
over the track.

Credits: map data © OpenStreetMap contributors (ODbL). World land: Natural Earth (public domain).
Music: "Rising Forest" by Diego Nava, Mixkit licence. Fonts: Inter, JetBrains Mono (OFL).
