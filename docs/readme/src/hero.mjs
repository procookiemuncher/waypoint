// hero.svg: the trailer's last shot (S11) as an animated SVG. The Leap builds in its own order
// (ring, arc, landing dot), settles into the app icon as the tile forms, slides left, and the
// wordmark comes out of the icon's edge with the tagline under it. Plays once, then holds. Plain
// CSS keyframes, so it runs inside GitHub's <img>; every resting style is the final frame, so a
// reader who asks for reduced motion just gets the finished lockup.
import { text, measure, svgDoc, write, card, T, LEAP, ICON, n1 } from './svgkit.mjs';

const W = 1800, H = 600;
const TILE = 300;                                        // the icon's squircle, px
const u = TILE / ICON.tile;                              // px per icon unit
const markK = ICON.markScale * u;                        // px per mark unit
const gap = 2 * LEAP.dotR * markK;                       // lockup gap = the landing dot's diameter
const WORD = { size: 172, weight: 600, tracking: -0.035 };
const TAG = { size: 52, weight: 500, tracking: -0.015 };
const wordW = measure('Waypoint', WORD);
const lockW = TILE + gap + wordW;
const lx = (W - lockW) / 2;                              // the tile's left edge in the lockup
const cy = 250;                                          // icon centre
const icx = lx + TILE / 2;                               // icon centre, final
const slide = W / 2 - icx;                               // it builds in the middle, then moves here
// the wordmark's cap band centred on the icon (Inter cap height 0.727 em)
const base = cy + 0.727 * WORD.size / 2;
const wx = lx + TILE + gap;

// ---- the mark, from strokes, in its own units (the trailer's makeLeap) ----
const [rx, ry] = LEAP.ring, [ax, ay] = LEAP.arcC;
const p0 = [ax + LEAP.arcR * Math.cos(LEAP.a0), ay + LEAP.arcR * Math.sin(LEAP.a0)];
const p1 = [ax + LEAP.arcR * Math.cos(LEAP.a1), ay + LEAP.arcR * Math.sin(LEAP.a1)];
const ringLen = 2 * Math.PI * LEAP.ringR, arcLen = LEAP.arcR * (LEAP.a1 - LEAP.a0);
const mark =
  `<g transform="translate(${rx} ${ry})"><g class="spin"><circle class="ring" r="${LEAP.ringR}" fill="none" stroke="${T.accent}" stroke-width="${LEAP.ringW}" transform="rotate(-90)"/></g></g>` +
  `<path class="arc" d="M${n1(p0[0])} ${n1(p0[1])}A${LEAP.arcR} ${LEAP.arcR} 0 0 1 ${n1(p1[0])} ${n1(p1[1])}" fill="none" stroke="${T.accent}" stroke-width="${LEAP.arcW}" stroke-linecap="round"/>` +
  `<g transform="translate(${LEAP.dot[0]} ${LEAP.dot[1]})"><circle class="dot" r="${LEAP.dotR}" fill="${T.accent}"/></g>`;

const body =
  card(W, H) +
  // wordmark + tagline, revealed from behind the icon's right edge
  `<g clip-path="url(#reveal)"><g class="word">${text('Waypoint', { ...WORD, x: wx, y: base, color: T.ink })}</g></g>` +
  `<g class="tag">${text('From here to anywhere.', { ...TAG, x: lx, y: cy + TILE / 2 + 116, color: T.ink2 })}</g>` +
  // the icon: tile + mark, centred on (icx, cy) once it has slid into place
  `<g class="slide"><g transform="translate(${n1(icx)} ${cy})">` +
  `<g class="tile"><rect x="${-TILE / 2}" y="${-TILE / 2}" width="${TILE}" height="${TILE}" rx="${n1(ICON.rx * u)}" fill="${T.tile}"/></g>` +
  `<g class="settle"><g transform="scale(${markK.toFixed(5)}) translate(${-LEAP.centre[0]} ${-LEAP.centre[1]})">${mark}</g></g>` +
  `</g></g>`;

const defs =
  `<clipPath id="reveal"><rect x="${n1(lx + TILE + gap * 0.25)}" y="0" width="${W}" height="${H}"/></clipPath>`;

// seconds
const style = `
.ring{stroke-dasharray:${n1(ringLen + 1)};animation:ring .7s cubic-bezier(.33,1,.68,1) .15s both}
.spin{animation:spin .7s cubic-bezier(.33,1,.68,1) .15s both}
.arc{stroke-dasharray:${n1(arcLen + 1)} ${n1(arcLen + 60)};animation:arc .62s cubic-bezier(.65,0,.35,1) .55s both}
.dot{animation:dot .75s linear 1.08s both}
.settle{animation:settle .8s cubic-bezier(.65,0,.35,1) 1.55s both}
.tile{animation:tile .8s cubic-bezier(.16,1,.3,1) 1.62s both}
.slide{animation:slide .85s cubic-bezier(.65,0,.35,1) 2.25s both}
.word{animation:word .9s cubic-bezier(.16,1,.3,1) 2.62s both}
.tag{animation:tag .8s cubic-bezier(.25,1,.5,1) 3.15s both}
@keyframes ring{from{stroke-dashoffset:${n1(ringLen + 1)}}to{stroke-dashoffset:0}}
@keyframes spin{from{transform:rotate(-120deg)}to{transform:none}}
@keyframes arc{0%{stroke-dashoffset:${n1(arcLen + 1)};opacity:0}1%{opacity:1}to{stroke-dashoffset:0}}
@keyframes dot{0%{transform:scale(0)}28%{transform:scale(1.16)}52%{transform:scale(.95)}74%{transform:scale(1.02)}to{transform:none}}
@keyframes settle{from{transform:scale(1.45)}to{transform:none}}
@keyframes tile{from{transform:scale(.35);opacity:0}to{transform:none;opacity:1}}
@keyframes slide{from{transform:translateX(${n1(slide)}px)}to{transform:none}}
@keyframes word{from{transform:translateX(${n1(-(wordW + gap))}px)}to{transform:none}}
@keyframes tag{from{transform:translateY(22px);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

write('hero.svg', svgDoc(W, H, body, {
  title: 'Waypoint. From here to anywhere.',
  desc: 'The Waypoint mark builds (a hollow start ring, one arc, a solid landing dot) and the wordmark slides out of it.',
  defs, style,
}));
