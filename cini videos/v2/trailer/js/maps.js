// Maps: OSM regions baked by prep/osm.py (data/maps.js), Natural Earth land (data/world.js) and
// the app's real routes (data/library.js), all drawn as SVG. One fit per shot, never per frame,
// so lines can't wobble.
'use strict';

const R_EARTH = 6378137;
function merc(lat, lon) {
  return [R_EARTH * lon * DEG, R_EARTH * Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2))];
}
function unmerc(x, y) {
  return [(2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2) / DEG, x / R_EARTH / DEG];
}

// A fit maps Web Mercator metres to stage px: uniform scale k, north up, offset (tx, ty).
// Region data is stored relative to the region's north-west corner with y down.
function fitBox(latlons, box, pad = 0) {
  const p = latlons.map(([la, lo]) => merc(la, lo));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, -y); x1 = Math.max(x1, x); y1 = Math.max(y1, -y); }
  const k = Math.min((box.w - 2 * pad) / (x1 - x0), (box.h - 2 * pad) / (y1 - y0));
  return { k, tx: box.x + (box.w - (x1 - x0) * k) / 2 - x0 * k, ty: box.y + (box.h - (y1 - y0) * k) / 2 - y0 * k };
}
// centre lat/lon at stage point (cx, cy) with `mpp` metres per px
function fitCentre(lat, lon, cx, cy, mpp) {
  const [x, y] = merc(lat, lon), k = 1 / mpp;
  return { k, tx: cx - x * k, ty: cy + y * k };
}
const project = (fit, lat, lon) => { const [x, y] = merc(lat, lon); return [x * fit.k + fit.tx, -y * fit.k + fit.ty]; };
const unproject = (fit, px_, py) => unmerc((px_ - fit.tx) / fit.k, -(py - fit.ty) / fit.k);

// region-relative flat arrays -> path data for this fit
function regionPath(region, list, fit, closed, minLen = 0) {
  const M = MAPS[region];
  const [ox, oy] = merc(M.origin[0], M.origin[1]);
  let d = '';
  for (const a of list) {
    let seg = '', len = 0, lx = 0, ly = 0;
    for (let i = 0; i < a.length; i += 2) {
      const x = (ox + a[i]) * fit.k + fit.tx, y = (-oy + a[i + 1]) * fit.k + fit.ty;
      if (i) len += Math.hypot(x - lx, y - ly);
      seg += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      lx = x; ly = y;
    }
    if (len < minLen && !closed) continue;
    d += seg + (closed ? 'Z' : '');
  }
  return d;
}

// Dark stylised map as an SVG <g>: water is the background, land on top with a hairline coast,
// parks a shade up, roads in graphite by class. `pal` recolours it (the city chapters).
let _mapN = 0;
function mapGroup(region, fit, opts = {}) {
  const M = MAPS[region];
  const pal = { water: C.water, ground: C.ground, coast: C.hair2, park: C.park, road: C.hair, road2: '#262b3b', ...(opts.pal || {}) };
  const lw = opts.lineScale ?? 1;
  const id = 'map' + _mapN++;
  const g = s('g', { class: 'map' });
  const [wx, wy, ww, wh] = opts.rect || [-2 * W, -2 * H, 5 * W, 5 * H];
  g.appendChild(s('rect', { x: wx, y: wy, width: ww, height: wh, fill: pal.water }));
  const landD = regionPath(region, M.land, fit, true);
  g.appendChild(s('path', { d: landD, fill: pal.ground, stroke: pal.coast, 'stroke-width': 1.2 * lw, 'stroke-linejoin': 'round' }));
  if (M.parks.length && opts.parks !== false) g.appendChild(s('path', { d: regionPath(region, M.parks, fit, true), fill: pal.park }));
  if (M.water.length) g.appendChild(s('path', { d: regionPath(region, M.water, fit, true), fill: pal.water, stroke: pal.coast, 'stroke-width': 0.6 * lw }));
  const r = M.roads;
  const st = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const add = (cls, w, col, o = 1) => { if (r[cls]) g.appendChild(s('path', { ...st, stroke: col, d: regionPath(region, r[cls], fit, false, 1.5), 'stroke-width': w * lw, opacity: o })); };
  add('minor', 0.8, pal.road, 0.8);
  add('secondary', 1.1, pal.road);
  add('primary', 1.6, pal.road2);
  add('major', 2.4, pal.road2);
  if (M.counties && M.counties.length && opts.counties !== false) {
    g.appendChild(s('defs', {}, [s('clipPath', { id: id + '-land' }, [s('path', { d: landD })])]));
    g.appendChild(s('g', { 'clip-path': `url(#${id}-land)` }, [
      s('path', { d: regionPath(region, M.counties, fit, false), fill: 'none', stroke: pal.coast, 'stroke-width': 1.2 * lw, 'stroke-dasharray': `${5 * lw} ${4 * lw}` }),
    ]));
  }
  return g;
}

// Natural Earth land + borders for a fit (lon/lat rings).
function worldGroup(fit, opts = {}) {
  const pal = { water: '#07080c', land: '#111219', coast: '#232838', border: '#1c2030', ...(opts.pal || {}) };
  const g = s('g', { class: 'world' });
  const lw = opts.lineScale ?? 1;
  let offPrev = 0;
  const ring = (a, closed) => {
    let d = '', off = 0;
    for (let i = 0; i < a.length; i += 2) {
      const lat = clamp(a[i + 1], -85, 85);
      // rings that cross the antimeridian jump 360 degrees; unwrap them so the edge runs off the
      // map instead of streaking straight across it
      if (i && Math.abs(a[i] + off - (a[i - 2] + offPrev)) > 180) off += a[i] + off < a[i - 2] + offPrev ? 360 : -360;
      offPrev = off;
      const [x, y] = project(fit, lat, a[i] + off);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d + (closed ? 'Z' : '');
  };
  if (opts.water !== false) g.appendChild(s('rect', { x: -W, y: -H, width: 4 * W, height: 4 * H, fill: pal.water }));
  g.appendChild(s('path', { d: WORLD.land.map(a => ring(a, true)).join(''), fill: pal.land, stroke: pal.coast, 'stroke-width': 1 * lw, 'stroke-linejoin': 'round' }));
  if (opts.borders !== false) g.appendChild(s('path', { d: WORLD.borders.map(a => ring(a, false)).join(''), fill: 'none', stroke: pal.border, 'stroke-width': 0.8 * lw, 'stroke-linejoin': 'round' }));
  return g;
}

// A route's real road line projected once, with length bookkeeping so a marker can sit at any
// fraction of the driven distance.
function routeGeom(fit, line) {
  const pts = line.map(([la, lo]) => project(fit, la, lo));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum[cum.length - 1];
  let d = '';
  pts.forEach(([x, y], i) => { d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2); });
  const at = u => { // point + heading (radians, screen) at fraction u of the length
    const L = clamp(u) * len;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < L) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1, f = (L - cum[lo]) / seg;
    const [x0, y0] = pts[lo], [x1, y1] = pts[hi];
    return { x: lerp(x0, x1, f), y: lerp(y0, y1, f), a: Math.atan2(y1 - y0, x1 - x0) };
  };
  // a heading smoothed over +-win px of road, so the camera doesn't snap at every corner
  const heading = (u, win = 40) => {
    const a = at(u - win / len), b = at(u + win / len);
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  return { pts, cum, len, d, at, heading };
}

// The route stroke: soft under-glow plus the line, drawn by length. Returns the group with
// .draw(t0, t1) (fractions of the length) and its geometry.
function routeGroup(geom, color, width = 6, glow = 18, glowAlpha = 0.2) {
  const common = { d: geom.d, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const under = s('path', { ...common, stroke: rgba(color, glowAlpha), 'stroke-width': glow });
  const line = s('path', { ...common, stroke: color, 'stroke-width': width });
  const g = s('g', {}, [under, line]);
  const L = geom.len + 2;
  g.draw = (t1, t0 = 0) => {
    const vis = t1 - t0 > 0.0005;
    g.style.visibility = vis ? 'visible' : 'hidden';
    for (const p of [under, line]) {
      p.setAttribute('stroke-dasharray', `${f2((t1 - t0) * L)} ${f2(L * 2)}`);
      p.setAttribute('stroke-dashoffset', f2(-t0 * L));
    }
  };
  g.geom = geom; g.line = line; g.under = under;
  return g;
}

// The Leap's ends on a route: hollow ring where it starts, solid dot where it lands.
function endsGroup(geom, color, r = 9, ground = C.ground) {
  const a = geom.pts[0], b = geom.pts[geom.pts.length - 1];
  const start = s('circle', { cx: f2(a[0]), cy: f2(a[1]), r: r, fill: ground, stroke: color, 'stroke-width': r * 0.78 });
  const end = s('circle', { cx: f2(b[0]), cy: f2(b[1]), r: r * 1.3, fill: color });
  const g = s('g', {}, [start, end]);
  g.start = start; g.end = end;
  return g;
}
