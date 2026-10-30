// Engine for the Waypoint trailer. Everything on screen is a pure function of the clock: seek(t)
// with t in seconds (60 fps master, so t = frame / 60). Shots are laid out in beats of the music
// (124 BPM), so every move is written against the beat it plays on. No timers, no CSS
// transitions, no Math.random, only seeded hashes.
'use strict';

const W = 1920, H = 1080, FPS = 60;
const BPM = 124, BEAT = 60 / BPM;   // 0.48387 s, 29.03 frames
const DUR = 45;                      // 93 beats exactly
const LEAD = 3 / FPS;                // hard cuts land 3 frames ahead of their beat
const LEADB = LEAD / BEAT;
const bt = b => b * BEAT;            // beats -> seconds
const tb = t => t / BEAT;            // seconds -> beats
const SVGNS = 'http://www.w3.org/2000/svg';

// ---------- maths ----------
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (x, a, b) => clamp((x - a) / (b - a));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2, DEG = Math.PI / 180;

const ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  inCubic: t => t * t * t,
  outCubic: t => 1 - (1 - t) ** 3,
  inOutCubic: t => (t < 0.5 ? 4 * t ** 3 : 1 - 4 * (1 - t) ** 3),
  inQuart: t => t ** 4,
  outQuart: t => 1 - (1 - t) ** 4,
  inOutQuart: t => (t < 0.5 ? 8 * t ** 4 : 1 - 8 * (1 - t) ** 4),
  outQuint: t => 1 - (1 - t) ** 5,
  inOutSine: t => 0.5 - 0.5 * Math.cos(Math.PI * t),
  outExpo: t => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inExpo: t => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  inOutExpo: t => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  outBack: (t, k = 1.7) => 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2,
};

// Damped spring from 0 to 1: overshoots and settles. t in beats since release.
function spring(t, freq = 1.6, damp = 0.32) {
  if (t <= 0) return 0;
  const w = TAU * freq, z = damp;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}

// Keyframes with an ease per segment (one function, or an array, one per segment). Holds
// outside the table.
function kf(x, keys, ez = ease.linear) {
  const n = keys.length;
  if (x <= keys[0][0]) return keys[0][1];
  if (x >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (x > keys[i + 1][0]) i++;
  const [x0, a] = keys[i], [x1, b] = keys[i + 1];
  const e = Array.isArray(ez) ? ez[i] : ez;
  const t = e((x - x0) / (x1 - x0));
  return Array.isArray(a) ? a.map((v, k) => lerp(v, b[k], t)) : lerp(a, b, t);
}

// Smooth keyframes: monotone cubic (Fritsch-Carlson) through the keys, so velocity never jumps
// at a key. opts.v0 / opts.v1 pin the end slopes; opts.extend carries the end slope on past the
// table instead of holding.
const _slopeCache = new WeakMap();
function spline(x, keys, opts = {}) {
  const n = keys.length;
  let m = _slopeCache.get(keys);
  if (!m || m.v0 !== opts.v0 || m.v1 !== opts.v1) {
    const hh = [], d = [];
    for (let i = 0; i < n - 1; i++) {
      hh[i] = keys[i + 1][0] - keys[i][0];
      d[i] = (keys[i + 1][1] - keys[i][1]) / hh[i];
    }
    const sl = new Array(n);
    if (n === 2) sl[0] = sl[1] = d[0];
    else {
      for (let i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] <= 0) sl[i] = 0;
        else {
          const w1 = 2 * hh[i] + hh[i - 1], w2 = hh[i] + 2 * hh[i - 1];
          sl[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
        }
      }
      const end = (h0, h1, d0, d1) => {
        let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
        if (Math.sign(v) !== Math.sign(d0)) v = 0;
        else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > Math.abs(3 * d0)) v = 3 * d0;
        return v;
      };
      sl[0] = end(hh[0], hh[1], d[0], d[1]);
      sl[n - 1] = end(hh[n - 2], hh[n - 3], d[n - 2], d[n - 3]);
    }
    if (opts.v0 !== undefined) sl[0] = opts.v0;
    if (opts.v1 !== undefined) sl[n - 1] = opts.v1;
    m = { s: sl, v0: opts.v0, v1: opts.v1 };
    _slopeCache.set(keys, m);
  }
  const sl = m.s;
  if (x <= keys[0][0]) return opts.extend ? keys[0][1] + sl[0] * (x - keys[0][0]) : keys[0][1];
  if (x >= keys[n - 1][0]) return opts.extend ? keys[n - 1][1] + sl[n - 1] * (x - keys[n - 1][0]) : keys[n - 1][1];
  let i = 0;
  while (x > keys[i + 1][0]) i++;
  const [x0, y0] = keys[i], [x1, y1] = keys[i + 1];
  const hh = x1 - x0, t = (x - x0) / hh, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * hh * sl[i] +
    (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * hh * sl[i + 1];
}

// Numerical rate of any x -> value function (units per beat when x is in beats).
const rate = (fn, x, d = 0.01) => (fn(x + d) - fn(x - d)) / (2 * d);
// px per beat -> px per frame, for blur that follows speed
const perFrame = v => v * BEAT / FPS;

// ---------- seeded hashes ----------
function hash(n, seed = 0) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const hash2 = (x, y, seed = 0) => hash(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663), seed);
// smooth 1D value noise, for handheld drift
function vnoise(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1;
}

// ---------- colour ----------
function rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return '#' + A.map((v, i) => Math.round(lerp(v, B[i], t)).toString(16).padStart(2, '0')).join('');
}

// Waypoint's real tokens (core/web/static/app.css, mac-version/app/icon.svg)
const C = {
  page: '#050609', win0: '#0d0f14', win1: '#0a0b0f', bar: '#12141b', panel: '#121318', panel2: '#18181b',
  hair: '#1e2230', hair2: '#2a3042', text: '#f4f4f5', body: '#c9d1d9', muted: '#6b7280',
  accent: '#b49aff', accentDim: '#63548c', tile: '#17141f', green: '#22c55e', amber: '#f5a524',
  ground: '#0a0b0f', water: '#0d1220', park: '#0d0f14',
};
const RAINBOW = ['#b49aff', '#7a8cff', '#c47aff', '#ff7ab8', '#ffb37a', '#b8e67a'];

// ---------- DOM ----------
function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) el.appendChild(c);
  return el;
}
function s(tag, attrs = {}, kids = []) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) el.appendChild(c);
  return el;
}
const px = v => `${v}px`;
const f2 = v => v.toFixed(2);
const blurCss = v => (v > 0.05 ? `blur(${v.toFixed(2)}px)` : 'none');
const layer = (cls = '', style = {}) => h('div', { class: 'layer ' + cls, style });
// set a style property only when it changes (the render loop touches hundreds per frame)
function css(el, prop, v) { if (el.style[prop] !== v) el.style[prop] = v; }
function show(el, on) { css(el, 'display', on ? '' : 'none'); }
function op(el, v) { css(el, 'opacity', v >= 0.999 ? '' : String(Math.max(0, +v.toFixed(4)))); }

// ---------- filters ----------
let FX; // hidden <svg> holding every filter
let _fxId = 0;

// Directional gaussian blur, separate x/y deviations, for smears. Returns a setter.
function dirBlur(margin = 0.25) {
  const id = 'db' + _fxId++;
  const g = s('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0 0', edgeMode: 'none' });
  FX.appendChild(s('filter', {
    id, x: `${-margin * 100}%`, y: `${-margin * 100}%`, width: `${100 + margin * 200}%`,
    height: `${100 + margin * 200}%`, 'color-interpolation-filters': 'sRGB',
  }, [g]));
  return {
    css: `url(#${id})`,
    set(el, sx, sy) {
      sx = Math.max(0, sx); sy = Math.max(0, sy);
      if (sx < 0.05 && sy < 0.05) { css(el, 'filter', 'none'); return; }
      g.setAttribute('stdDeviation', `${sx.toFixed(2)} ${sy.toFixed(2)}`);
      css(el, 'filter', `url(#${id})`);
    },
  };
}

// ---------- dithered paint ----------
// Paint fn(x, y, out) -> [r, g, b] (floats 0..255) into a canvas with seeded triangular noise of
// about +-amp, so dark gradients don't band after H.264.
function dithered(w, h_, fn, amp = 0.02, seed = 1, scale = 1) {
  const cw = Math.round(w / scale), ch = Math.round(h_ / scale);
  const c = h('canvas', { width: cw, height: ch });
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const d = img.data, out = [0, 0, 0, 255];
  const a = amp * 255;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      out[3] = 255;
      fn((x + 0.5) * scale, (y + 0.5) * scale, out);
      const n = (hash2(x, y, seed) + hash2(x, y, seed + 101) - 1) * a;
      const i = (y * cw + x) * 4;
      d[i] = out[0] + n; d[i + 1] = out[1] + n; d[i + 2] = out[2] + n; d[i + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  c.style.display = 'block';
  c.style.width = px(w); c.style.height = px(h_);
  return c;
}

// Film grain tile: each pixel nudges the image up or down by about +-levels (8-bit), seeded.
// Laid over the whole frame and shifted per frame. base is the grey the alphas are tuned for:
// mid-grey keeps the speckle about as strong on white type as on the dark grounds.
function grainTile(size = 384, levels = 2.6, seed = 7, base = 128) {
  const c = h('canvas', { width: size, height: size });
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = hash2(x, y, seed) + hash2(x, y, seed + 101) - 1; // triangular, -1..1
      const i = (y * size + x) * 4;
      const v = n > 0 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = Math.round(255 * Math.abs(n) * levels / (n > 0 ? 255 - base : base));
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

// ---------- shots ----------
// A shot owns beats [b0, b1) of the film; it shows from 3 frames before b0 (hard cuts lead the
// beat) to 3 frames before b1, widened by `pre` / `post` beats when it overlaps a neighbour.
// render(lb, t): lb = beats since b0 (slightly negative on the cut frames), t = seconds.
const SHOTS = [];
function shot(o) { SHOTS.push({ pre: 0, post: 0, z: SHOTS.length, ...o, el: null }); }

const POST = []; // whole-frame passes run after the shots: fn(t)
function seek(t) {
  const b = tb(t);
  for (const S of SHOTS) {
    const on = b >= S.b0 - S.pre - LEADB && b < S.b1 + S.post - LEADB;
    show(S.el, on);
    if (on) S.render(b - S.b0, t);
  }
  for (const fn of POST) fn(t, b);
}

// ---------- camera ----------
// Look at world point (x, y) with zoom z and roll r (degrees): the point lands on the frame
// centre. The element's own box is the world, origin top-left.
function camera(el, x, y, z = 1, r = 0, extra = '') {
  css(el, 'transformOrigin', '0 0');
  css(el, 'transform', `translate(${W / 2}px, ${H / 2}px) rotate(${f2(r)}deg) scale(${z.toFixed(5)}) translate(${f2(-x)}px, ${f2(-y)}px)${extra}`);
}

// ---------- the Leap (mac-version/app/icon.svg) ----------
// The mark in its own units: hollow start ring, one arc, solid landing dot. Measured from the
// icon's path: ring centre (62,194) r 32/14 (so a 23 radius stroke 18 wide), arc around
// (198,197) at radius 136, 30 wide with round ends, from 202.03 to 242.87 degrees, dot (194,62) r 34.
const LEAP = {
  ring: [62, 194], ringR: 23, ringW: 18,
  arcC: [198, 197], arcR: 136, arcW: 30, a0: 202.03 * DEG, a1: 242.87 * DEG,
  dot: [194, 62], dotR: 34,
  centre: [129, 127], // the icon centres the mark on this point
  path: 'M62 162a32 32 0 1 1 0 64a32 32 0 1 1 0-64zM62 180a14 14 0 1 0 0 28a14 14 0 1 0 0-28zM58.09 140.37A151 151 0 0 1 129.15 62.65A15 15 0 0 1 142.85 89.35A121 121 0 0 0 85.90 151.63A15 15 0 0 1 58.09 140.37ZM194 28a34 34 0 1 1 0 68a34 34 0 1 1 0-68z',
};
LEAP.arcLen = LEAP.arcR * (LEAP.a1 - LEAP.a0);
LEAP.ringLen = TAU * LEAP.ringR;
// a point along the arc's centre line, u 0..1
LEAP.at = u => {
  const a = lerp(LEAP.a0, LEAP.a1, u);
  return [LEAP.arcC[0] + LEAP.arcR * Math.cos(a), LEAP.arcC[1] + LEAP.arcR * Math.sin(a)];
};
// icon geometry: the squircle is 824 of the 1024 box, the mark sits at scale 2.32 on its centre
const ICON = { box: 1024, tile: 824, rx: 186, markScale: 2.32 };

// The Leap drawn from strokes so each part can build on its own. The resolved state is the
// same shape as the master path (swap to `solid` for the final frames).
function makeLeap(color = C.accent) {
  const [rx, ry] = LEAP.ring, [cx, cy] = LEAP.arcC;
  const p0 = LEAP.at(0), p1 = LEAP.at(1);
  const ring = s('circle', { cx: rx, cy: ry, r: LEAP.ringR, fill: 'none', stroke: color, 'stroke-width': LEAP.ringW });
  const arc = s('path', {
    d: `M${f2(p0[0])} ${f2(p0[1])}A${LEAP.arcR} ${LEAP.arcR} 0 0 1 ${f2(p1[0])} ${f2(p1[1])}`,
    fill: 'none', stroke: color, 'stroke-width': LEAP.arcW, 'stroke-linecap': 'round',
  });
  const dotG = s('g', {}, [s('circle', { cx: LEAP.dot[0], cy: LEAP.dot[1], r: LEAP.dotR, fill: color })]);
  const solid = s('path', { d: LEAP.path, fill: color, 'fill-rule': 'evenodd', style: { display: 'none' } });
  const g = s('g', {}, [ring, arc, dotG, solid]);
  void cx; void cy;
  // ring 0..1 drawn (starts at its top, runs clockwise), arc 0..1 drawn, dot scale
  g.set = (ringT, arcT, dotS, opts = {}) => {
    const solidOn = opts.solid && ringT >= 1 && arcT >= 1 && Math.abs(dotS - 1) < 1e-4;
    show(solid, solidOn);
    show(ring, !solidOn && ringT > 0.001);
    show(arc, !solidOn && arcT > 0.001);
    show(dotG, !solidOn && dotS > 0.001);
    const rl = LEAP.ringLen;
    ring.setAttribute('stroke-dasharray', `${f2(rl * ringT)} ${f2(rl + 1)}`);
    ring.setAttribute('transform', `rotate(${f2(-90 + (opts.ringSpin || 0))} ${rx} ${ry})`);
    const al = LEAP.arcLen + 0.5;
    arc.setAttribute('stroke-dasharray', `${f2(al * arcT)} ${f2(al + 40)}`);
    dotG.setAttribute('transform', `translate(${LEAP.dot[0]} ${LEAP.dot[1]}) scale(${dotS.toFixed(4)}) translate(${-LEAP.dot[0]} ${-LEAP.dot[1]})`);
  };
  g.paint = c => { ring.setAttribute('stroke', c); arc.setAttribute('stroke', c); dotG.firstChild.setAttribute('fill', c); solid.setAttribute('fill', c); };
  return g;
}

// The real app icon, scaled: `size` is the squircle's width (824 of the 1024 box).
let _iconN = 0;
function makeIcon() {
  const n = 'ic' + _iconN++ + '-';
  const svg = window.ICON_SVG.replace(/id="(\w+)"/g, `id="${n}$1"`).replace(/url\(#(\w+)\)/g, `url(#${n}$1)`);
  const wrap = h('div', { class: 'abs', html: svg });
  const el = wrap.firstElementChild;
  el.removeAttribute('width'); el.removeAttribute('height');
  el.style.width = el.style.height = '100%';
  el.style.display = 'block';
  wrap.setSize = size => { const b = size * ICON.box / ICON.tile; wrap.style.width = wrap.style.height = px(b); wrap._box = b; };
  return wrap;
}

// ---------- glyphs the font subsets lack (→ ▸) ----------
function arrowSvg(size, color, weight = 2) {
  return s('svg', { width: size, height: size, viewBox: '0 0 24 24', style: { display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' } }, [
    s('path', { d: 'M4 12 H19 M13 6 L19 12 L13 18', fill: 'none', stroke: color, 'stroke-width': weight * 24 / size * 1.0, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ]);
}
function playSvg(size, color) {
  return s('svg', { width: size, height: size, viewBox: '0 0 10 10', style: { display: 'inline-block', verticalAlign: 'middle' } }, [
    s('path', { d: 'M2.5 1.5 L8.5 5 L2.5 8.5 Z', fill: color }),
  ]);
}

// ---------- cursor ----------
// macOS-style arrow pointer (generic shape, not Apple's asset): black body, white outline, soft
// shadow. The tip sits at the element origin; rotation and scale pivot there.
const CURSOR_ANGLE = -112.9;
function makeCursor(k = 1.6) {
  const pts = [[0, 0], [0, 22.5], [5.2, 17.6], [8.9, 26.2], [12.6, 24.6], [9.0, 16.2], [15.8, 16.2]]
    .map(([x, y]) => `${(x * k).toFixed(2)},${(y * k).toFixed(2)}`).join(' ');
  const svg = s('svg', { width: 40 * k, height: 48 * k, viewBox: `-4 -3 ${40 * k} ${48 * k}`, style: { position: 'absolute', left: '-4px', top: '-3px', overflow: 'visible' } }, [
    s('polygon', { points: pts, fill: '#000', stroke: '#fff', 'stroke-width': 1.8 * k, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }),
  ]);
  const body = h('div', { class: 'cursor-body' }, [svg]);
  const spin = h('div', { class: 'cursor-spin' }, [body]);
  const outer = h('div', { class: 'cursor' }, [spin]);
  const mb = dirBlur(1.5);
  outer.place = (x, y, rot = CURSOR_ANGLE, sc = 1, vel = [0, 0], opacity = 1) => {
    css(outer, 'transform', `translate(${f2(x)}px, ${f2(y)}px)`);
    op(outer, opacity);
    const sp = Math.hypot(vel[0], vel[1]);
    const a = Math.atan2(vel[1], vel[0]) / DEG;
    css(spin, 'transform', `rotate(${f2(a)}deg)`);
    css(body, 'transform', `rotate(${f2(rot - CURSOR_ANGLE - a)}deg) scale(${sc.toFixed(4)})`);
    mb.set(spin, sp * 0.22, 0);
  };
  return outer;
}

// ---------- type ----------
// One line of display type that rises into place out of a mask. Returns the element with
// .set(p, blurPx): p 0 -> 1 is the reveal (0 hidden below the baseline, 1 in place).
function riseLine(text, style) {
  const inner = h('div', { class: 'rise-in', text, style: { whiteSpace: 'pre' } });
  const outer = h('div', { class: 'rise', style }, [inner]);
  outer.inner = inner;
  outer.set = (p, bl = 0, dy = 1.0) => {
    css(inner, 'transform', `translateY(${f2((1 - p) * dy * 100)}%)`);
    css(inner, 'filter', blurCss(bl));
  };
  return outer;
}
// Per-word display type: each word its own span, for staggered entries.
function words(text, style, wordStyle = {}) {
  const el = h('div', { style: { whiteSpace: 'pre', ...style } });
  el.w = text.split(' ').map((t, i, a) => {
    const sp = h('span', { text: t + (i < a.length - 1 ? ' ' : ''), style: { display: 'inline-block', whiteSpace: 'pre', ...wordStyle } });
    el.appendChild(sp);
    return sp;
  });
  return el;
}
