// Engine for the Waypoint sting. Everything on screen is a pure function of the frame number:
// seek(f) with f in 29.97 fps frames (the 59.94 master asks for halves). No timers, no CSS
// transitions, no Math.random, only seeded hashes.
'use strict';

const W = 1080, H = 1080;
const FPS = 30000 / 1001;
const SVGNS = 'http://www.w3.org/2000/svg';

// ---------- maths ----------
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (f, a, b) => clamp((f - a) / (b - a));

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
  inOutSine: t => 0.5 - 0.5 * Math.cos(Math.PI * t),
  outExpo: t => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inExpo: t => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
};

// Keyframes with an ease per segment (one function, or an array, one per segment). Holds
// outside the table.
function kf(f, keys, ez = ease.linear) {
  const n = keys.length;
  if (f <= keys[0][0]) return keys[0][1];
  if (f >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (f > keys[i + 1][0]) i++;
  const [f0, a] = keys[i], [f1, b] = keys[i + 1];
  const e = Array.isArray(ez) ? ez[i] : ez;
  const t = e((f - f0) / (f1 - f0));
  return Array.isArray(a) ? a.map((v, k) => lerp(v, b[k], t)) : lerp(a, b, t);
}

// Smooth keyframes: monotone cubic (Fritsch-Carlson) through the keys, so velocity never jumps
// at a key. opts.v0 / opts.v1 pin the end velocities (units per frame); opts.extend carries
// the end velocity on past the table instead of holding.
const _slopeCache = new WeakMap();
function spline(f, keys, opts = {}) {
  const n = keys.length;
  let m = _slopeCache.get(keys);
  if (!m || m.v0 !== opts.v0 || m.v1 !== opts.v1) {
    const h = [], d = [];
    for (let i = 0; i < n - 1; i++) {
      h[i] = keys[i + 1][0] - keys[i][0];
      d[i] = (keys[i + 1][1] - keys[i][1]) / h[i];
    }
    const s = new Array(n);
    if (n === 2) s[0] = s[1] = d[0];
    else {
      for (let i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] <= 0) s[i] = 0;
        else {
          const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
          s[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
        }
      }
      const end = (h0, h1, d0, d1) => {
        let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
        if (Math.sign(v) !== Math.sign(d0)) v = 0;
        else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > Math.abs(3 * d0)) v = 3 * d0;
        return v;
      };
      s[0] = end(h[0], h[1], d[0], d[1]);
      s[n - 1] = end(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
    }
    if (opts.v0 !== undefined) s[0] = opts.v0;
    if (opts.v1 !== undefined) s[n - 1] = opts.v1;
    m = { s, v0: opts.v0, v1: opts.v1 };
    _slopeCache.set(keys, m);
  }
  const s = m.s;
  if (f <= keys[0][0]) return opts.extend ? keys[0][1] + s[0] * (f - keys[0][0]) : keys[0][1];
  if (f >= keys[n - 1][0]) return opts.extend ? keys[n - 1][1] + s[n - 1] * (f - keys[n - 1][0]) : keys[n - 1][1];
  let i = 0;
  while (f > keys[i + 1][0]) i++;
  const [x0, y0] = keys[i], [x1, y1] = keys[i + 1];
  const hh = x1 - x0, t = (f - x0) / hh, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * hh * s[i] +
    (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * hh * s[i + 1];
}

// Per-frame lookup table starting at frame f0, linear between whole frames (the half frames).
function lut(f, f0, values) {
  const x = f - f0;
  if (x <= 0) return values[0];
  if (x >= values.length - 1) return values[values.length - 1];
  const i = Math.floor(x); // index into the table, the value itself stays continuous
  return lerp(values[i], values[i + 1], x - i);
}

// Exponential approach: covers `rate` of the remaining distance every frame.
const approach = (f, f0, from, to, rate) => to + (from - to) * Math.pow(1 - rate, Math.max(0, f - f0));

// Numerical speed of any f -> value function, per frame.
const speed = (fn, f, d = 0.25) => (fn(f + d) - fn(f - d)) / (2 * d);

// ---------- seeded hashes ----------
function hash(n, seed = 0) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const hash2 = (x, y, seed = 0) => hash(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663), seed);

// ---------- colour ----------
function rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };

const C = {
  page: '#050609', win0: '#0d0f14', win1: '#0a0b0f', panel: '#121318', panel2: '#18181b',
  hair: '#1e2230', hair2: '#2a3042', text: '#f4f4f5', body: '#c9d1d9', muted: '#6b7280',
  accent: '#b49aff', accentDim: '#63548c', mark0: '#d4c4ff', mark1: '#8f74e6',
  ny: '#5ea2ff', mia: '#ff5ecd', stt: '#ffa3c4', green: '#22c55e',
  ground: '#0a0b0f', water: '#0d1220',
};

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
const blur = v => (v > 0.05 ? `blur(${v.toFixed(2)}px)` : 'none');

// Absolutely positioned layer covering the stage.
const layer = (cls = '', style = {}) => h('div', { class: 'layer ' + cls, style });

// ---------- filters ----------
let FX; // hidden <svg> holding every filter
let _fxId = 0;

// Directional gaussian blur, separate x/y deviations, for smears. Returns a setter.
function dirBlur(margin = 0.25) {
  const id = 'db' + _fxId++;
  const g = s('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0 0', 'edgeMode': 'none' });
  FX.appendChild(s('filter', {
    id, x: `${-margin * 100}%`, y: `${-margin * 100}%`, width: `${100 + margin * 200}%`,
    height: `${100 + margin * 200}%`, 'color-interpolation-filters': 'sRGB',
  }, [g]));
  return {
    css: `url(#${id})`,
    set(el, sx, sy) {
      sx = Math.max(0, sx); sy = Math.max(0, sy);
      if (sx < 0.05 && sy < 0.05) { el.style.filter = 'none'; return; }
      g.setAttribute('stdDeviation', `${sx.toFixed(2)} ${sy.toFixed(2)}`);
      el.style.filter = `url(#${id})`;
    },
  };
}

// ---------- dithered gradients ----------
// Paint fn(x, y) -> [r, g, b] (floats, 0..255) into a canvas with seeded triangular noise of
// about +-amp, so dark gradients don't band after H.264.
function dithered(w, h_, fn, amp = 0.02, seed = 1) {
  const c = h('canvas', { width: w, height: h_ });
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h_);
  const d = img.data, out = [0, 0, 0];
  const a = amp * 255;
  for (let y = 0; y < h_; y++) {
    for (let x = 0; x < w; x++) {
      fn(x + 0.5, y + 0.5, out);
      const n = (hash2(x, y, seed) + hash2(x, y, seed + 101) - 1) * a;
      const i = (y * w + x) * 4;
      d[i] = out[0] + n; d[i + 1] = out[1] + n; d[i + 2] = out[2] + n; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  c.style.display = 'block';
  return c;
}
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------- shots ----------
const SHOTS = [];
function shot(name, f0, f1, build, render) {
  SHOTS.push({ name, f0, f1, build, render, el: null });
}

function seek(f) {
  for (const S of SHOTS) {
    const on = f >= S.f0 && f < S.f1 + 1;
    if (S.el.style.display !== (on ? 'block' : 'none')) S.el.style.display = on ? 'block' : 'none';
    if (on) S.render(f - S.f0, f);
  }
}

// ---------- shared parts ----------
const ICON_SVG = window.ICON_SVG; // mac-version/app/icon.svg, inlined by prep/assets.py
let _iconN = 0;

// The real app icon, scaled. `size` is the squircle width (824 of the 1024 viewBox), so the
// element box is size * 1024 / 824. Gradient ids get a per-copy prefix so a hidden copy
// can't blank the others.
function makeIcon() {
  const n = 'ic' + _iconN++ + '-';
  const svg = ICON_SVG.replace(/id="(\w+)"/g, `id="${n}$1"`).replace(/url\(#(\w+)\)/g, `url(#${n}$1)`);
  const wrap = h('div', { class: 'icon', html: svg });
  const el = wrap.firstElementChild;
  el.removeAttribute('width'); el.removeAttribute('height');
  el.style.width = el.style.height = '100%';
  el.style.display = 'block';
  wrap.setSize = size => { const b = size * 1024 / 824; wrap.style.width = wrap.style.height = px(b); wrap._box = b; };
  return wrap;
}

// The lavender arrow mark, the same path icon.svg draws.
const MARK_PATH = 'M512 262 L692 742 L512 628 L332 742 Z';
let _markN = 0;
function markSvg(sizePx) {
  const id = 'mk' + _markN++;
  return s('svg', { viewBox: '332 262 360 480', width: sizePx * 360 / 480, height: sizePx, style: { display: 'block', overflow: 'visible' } }, [
    s('defs', {}, [s('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 1 }, [
      s('stop', { offset: 0, 'stop-color': C.mark0 }), s('stop', { offset: 1, 'stop-color': C.mark1 }),
    ])]),
    s('path', { d: MARK_PATH, fill: `url(#${id})` }),
  ]);
}

// Logo disc: graphite circle, 1px rim, the arrow mark. Sized by the caller through setSize.
function makeDisc() {
  const disc = h('div', { class: 'disc' });
  const mark = h('div', { class: 'disc-mark' }, [markSvg(100)]);
  disc.appendChild(mark);
  disc.setSize = d => {
    disc.style.width = disc.style.height = px(d);
    const mh = d * 0.44;
    const svg = mark.firstChild;
    svg.setAttribute('height', mh); svg.setAttribute('width', mh * 0.75);
    mark.style.width = px(mh * 0.75); mark.style.height = px(mh);
    mark.style.left = px((d - mh * 0.75) / 2); mark.style.top = px((d - mh) / 2 - d * 0.015);
  };
  return disc;
}

// macOS-style arrow pointer (generic shape, not Apple's asset): black body, white outline,
// soft shadow. Hotspot (the tip) sits at the element origin; rotation and scale pivot there.
// Natural pointing direction is about -113 degrees (up and a little left).
const CURSOR_ANGLE = -112.9;
function makeCursor() {
  const k = 1.32;
  const pts = [[0, 0], [0, 22.5], [5.2, 17.6], [8.9, 26.2], [12.6, 24.6], [9.0, 16.2], [15.8, 16.2]]
    .map(([x, y]) => `${(x * k).toFixed(2)},${(y * k).toFixed(2)}`).join(' ');
  const svg = s('svg', { width: 32, height: 39, viewBox: '-4 -3 32 39', style: { position: 'absolute', left: '-4px', top: '-3px', overflow: 'visible' } }, [
    s('polygon', { points: pts, fill: '#000', stroke: '#fff', 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'paint-order': 'stroke', 'shape-rendering': 'geometricPrecision' }),
  ]);
  const body = h('div', { class: 'cursor-body' }, [svg]);
  const spin = h('div', { class: 'cursor-spin' }, [body]);
  const outer = h('div', { class: 'cursor' }, [spin]);
  const mb = dirBlur(1.5);
  // pos (x, y), rot = pointing angle in degrees (screen), sc = scale, vel = [vx, vy] px/frame
  outer.place = (x, y, rot = CURSOR_ANGLE, sc = 1, vel = [0, 0], opacity = 1) => {
    outer.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    outer.style.opacity = opacity;
    const sp = Math.hypot(vel[0], vel[1]);
    const a = Math.atan2(vel[1], vel[0]) * 180 / Math.PI;
    // the blur runs along the spin wrapper's x axis, which is turned to face the motion
    spin.style.transform = `rotate(${a.toFixed(2)}deg)`;
    body.style.transform = `rotate(${(rot - CURSOR_ANGLE - a).toFixed(2)}deg) scale(${sc.toFixed(4)})`;
    mb.set(spin, sp * 0.22, 0);
  };
  return outer;
}

// ---------- maps ----------
// Web Mercator metres (y north) for lat/lon; region data is stored relative to its north-west
// corner with y down, so a point maps as ((mx - ox), (oy - my)).
const R_EARTH = 6378137;
function merc(lat, lon) {
  return [R_EARTH * lon * Math.PI / 180, R_EARTH * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
}

// A fit is a uniform scale + offset from region metres to px. Made once per shot, never per
// frame, so lines can't wobble.
function fitPoints(region, latlons, box) {
  const [olat, olon] = MAPS[region].origin;
  const [ox, oy] = merc(olat, olon);
  const p = latlons.map(([la, lo]) => { const [x, y] = merc(la, lo); return [x - ox, oy - y]; });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const k = Math.min(box.w / (x1 - x0), box.h / (y1 - y0));
  return { region, k, tx: box.x + (box.w - (x1 - x0) * k) / 2 - x0 * k, ty: box.y + (box.h - (y1 - y0) * k) / 2 - y0 * k };
}
// Fit from two anchors: put latlon a at stage point A and b near B (least squares, north up).
function fitAnchors(region, a, A, b, B) {
  const [olat, olon] = MAPS[region].origin;
  const [ox, oy] = merc(olat, olon);
  const pa = merc(a[0], a[1]), pb = merc(b[0], b[1]);
  const va = [pa[0] - ox, oy - pa[1]], vb = [pb[0] - ox, oy - pb[1]];
  const d = [vb[0] - va[0], vb[1] - va[1]], t = [B[0] - A[0], B[1] - A[1]];
  const k = (d[0] * t[0] + d[1] * t[1]) / (d[0] * d[0] + d[1] * d[1]);
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], vm = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2];
  return { region, k, tx: mid[0] - vm[0] * k, ty: mid[1] - vm[1] * k };
}
function project(fit, lat, lon) {
  const [olat, olon] = MAPS[fit.region].origin;
  const [ox, oy] = merc(olat, olon);
  const [x, y] = merc(lat, lon);
  return [(x - ox) * fit.k + fit.tx, (oy - y) * fit.k + fit.ty];
}

function flatPath(list, fit, closed, minLen = 0) {
  let d = '';
  for (const a of list) {
    let seg = '', len = 0, lx = 0, ly = 0;
    for (let i = 0; i < a.length; i += 2) {
      const x = a[i] * fit.k + fit.tx, y = a[i + 1] * fit.k + fit.ty;
      if (i) len += Math.hypot(x - lx, y - ly);
      seg += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      lx = x; ly = y;
    }
    if (len < minLen && !closed) continue;
    d += seg + (closed ? 'Z' : '');
  }
  return d;
}

function routePath(fit, name) {
  const pts = ROUTES[name].points.map(([la, lo]) => project(fit, la, lo));
  let d = '', len = 0;
  pts.forEach(([x, y], i) => {
    d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
    if (i) len += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
  });
  return { d, len, pts };
}

// Dark stylised map as an SVG <g>: water is the background, land on top with a hairline coast,
// parks a shade up, roads in hairline graphite, county lines clipped to land.
let _mapN = 0;
function mapGroup(fit, opts = {}) {
  const M = MAPS[fit.region];
  const id = 'map' + _mapN++;
  const lw = opts.lineScale ?? 1;
  const landD = flatPath(M.land, fit, true);
  const g = s('g', { class: 'map' });
  g.appendChild(s('defs', {}, [s('clipPath', { id: id + '-land' }, [s('path', { d: landD })])]));
  // water is the background; keep the rect to the area that's shown, a huge one blows up the
  // region of any filter applied to a copy of this group
  const [wx, wy, ww, wh] = opts.waterRect || [-2000, -2000, 6000, 6000];
  g.appendChild(s('rect', { x: wx, y: wy, width: ww, height: wh, fill: C.water }));
  g.appendChild(s('path', { d: landD, fill: C.ground, stroke: C.hair2, 'stroke-width': 1 * lw, 'stroke-linejoin': 'round' }));
  if (M.parks.length) g.appendChild(s('path', { d: flatPath(M.parks, fit, true), fill: '#0d0f14' }));
  if (M.water.length) g.appendChild(s('path', { d: flatPath(M.water, fit, true), fill: C.water, stroke: C.hair, 'stroke-width': 0.6 * lw }));
  const r = M.roads;
  const roadStyle = { fill: 'none', stroke: C.hair, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const add = (cls, w, op = 1) => { if (r[cls]) g.appendChild(s('path', { ...roadStyle, d: flatPath(r[cls], fit, false, 1.5), 'stroke-width': w * lw, opacity: op })); };
  add('minor', 0.7, 0.8);
  add('secondary', 1);
  add('primary', 1.4);
  add('major', 2);
  if (M.counties.length) {
    g.appendChild(s('g', { 'clip-path': `url(#${id}-land)` }, [
      s('path', { d: flatPath(M.counties, fit, false), fill: 'none', stroke: C.hair2, 'stroke-width': 1 * lw, 'stroke-dasharray': `${4 * lw} ${3 * lw}` }),
    ]));
  }
  return g;
}

// The route stroke: soft under-glow plus the line. Returns the group, its length and points.
function routeGroup(fit, name, color, width = 6, glow = 18, glowAlpha = 0.18) {
  const { d, len, pts } = routePath(fit, name);
  const common = { d, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const under = s('path', { ...common, stroke: rgba(color, glowAlpha), 'stroke-width': glow });
  const line = s('path', { ...common, stroke: color, 'stroke-width': width });
  const g = s('g', {}, [under, line]);
  g.draw = t => { // 0..1 of the real path length
    for (const p of [under, line]) {
      p.setAttribute('stroke-dasharray', `${len + 2} ${len + 2}`);
      p.setAttribute('stroke-dashoffset', ((1 - t) * (len + 2)).toFixed(2));
    }
  };
  g.len = len; g.pts = pts;
  return g;
}
