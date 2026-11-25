// The README's still cards, built from the trailer's engine (core.js, maps.js, ui.js), its OSM and
// Natural Earth data, today's catalog (docs/readme/data/library.js), one real drive's speed
// profile (data/profile.js) and a dry-run capture of the app's palette (data/app-palette.png).
// One card shows per frame: seek(t) with frame = round(t * 60) picks it.
//   0 steps (900x360)  1-4 features (400x300)  5 numbers (900x420)
'use strict';

FX = document.getElementById('fx');   // core.js keeps its SVG filters here
const INK = '#f4f4f5', INK2 = '#d4d4d8', MUTED = '#9a9aa5', PANEL = '#121319', RAISED = '#191a21', GROUND = '#0a0b0f';
const CARDS = [];
function card(w, h_, build) {
  const el = h('div', { class: 'card', style: { width: px(w), height: px(h_) } });
  document.getElementById('cards').appendChild(el);
  build(el, w, h_);
  CARDS.push(el);
}
const put = (parent, el, x, y) => { el.style.left = px(x); el.style.top = px(y); parent.appendChild(el); return el; };
const line1 = (parent, text, x, y) => put(parent, h('div', { class: 't1', text }), x, y);
const line2 = (parent, html, x, y, w) => put(parent, h('div', { class: 't2', html, style: { width: px(w) } }), x, y);
const svgBox = (w, h_) => s('svg', { width: w, height: h_, viewBox: `0 0 ${w} ${h_}`, style: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' } });
const colorOf = city => LIB.cities[city].color;
const usColor = colorOf('Miami');

// a city tag in the app's map style, without the flags the app dropped
function tag(name, color, size = 11) {
  return h('div', { class: 'abs', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', height: px(size * 2), padding: `0 ${size * 0.8}px 0 ${size * 0.65}px`,
    borderRadius: px(size), background: 'rgba(14,14,17,.92)', boxShadow: `0 0 0 1px ${rgba(color, 0.5)}`, font: `600 ${size}px Inter`, color: INK, whiteSpace: 'nowrap' },
    html: `<i style="width:${size * 0.7}px;height:${size * 0.7}px;border-radius:50%;background:${color};display:block"></i>${esc(name)}` });
}
// every catalog spot as a dot in its country's colour
function spotDots(svg, fit, r = 2.6, halo = 2.4) {
  for (const c of Object.values(LIB.cities)) for (const sp of c.spots) {
    const [x, y] = project(fit, sp.at[0], sp.at[1]);
    svg.appendChild(s('circle', { cx: f2(x), cy: f2(y), r: f2(r * halo), fill: rgba(c.color, 0.22) }));
    svg.appendChild(s('circle', { cx: f2(x), cy: f2(y), r: f2(r), fill: c.color }));
  }
}
function check(size = 12) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 14 14" style="display:block;flex:none"><circle cx="7" cy="7" r="6.3" fill="rgba(63,192,122,.16)" stroke="#3fc07a" stroke-width="1.1"/><path d="M4.2 7.2 L6.2 9.2 L9.9 5.2" fill="none" stroke="#3fc07a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// ------------------------------------------------------------------ 0 · three steps
card(900, 360, (el) => {
  const PX = [20, 314, 608], PW = 272, PY = 20, PH = 204;
  const panels = PX.map(x => put(el, h('div', { class: 'panel', style: { width: px(PW), height: px(PH) } }), x, PY));

  // plug in: the connect screen's laptop, rainbow wire and phone (ui.js uiLink), all checks done
  const link = uiLink();
  link.set({ draw: 1, flow: 0.9, glowA: 0.9, phone: 'check', checkS: 1, stepState: [2, 2, 2], markOn: 1 });
  for (const k of [...link.children].slice(1)) k.style.display = 'none';
  const k = 0.53;
  link.style.transformOrigin = '0 0';
  link.style.transform = `translate(${f2(PW / 2 - 269 * k)}px, ${f2(6 - 24 * k)}px) scale(${k})`;
  panels[0].appendChild(link);
  const chips = h('div', { class: 'abs', style: { display: 'flex', gap: '6px', justifyContent: 'center', width: px(PW) } });
  for (const t of ['Plugged in', 'Unlocked', 'Ready']) chips.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', height: '24px', padding: '0 9px 0 6px', borderRadius: '12px', background: RAISED, font: '500 11px Inter', color: INK2, whiteSpace: 'nowrap' }, html: check(13) + esc(t) }));
  put(panels[0], chips, 0, 160);

  // pick a place: the world with every spot lit, a few cities tagged, the pointer on Miami
  {
    const svg = svgBox(PW, PH);
    const fit = fitBox([[58, -96], [6, 62]], { x: 0, y: 0, w: PW, h: PH });
    svg.appendChild(worldGroup(fit, { lineScale: 0.45, pal: { water: PANEL, land: '#1b1c25', coast: '#2a2c38', border: '#22232d' } }));
    spotDots(svg, fit, 2.3);
    panels[1].appendChild(svg);
    for (const [city, dx, dy] of [['Paris', 8, -26], ['Dubai', -60, -28], ['Marrakech', -30, 10], ['New York', 10, -28]]) {
      const c = LIB.cities[city]; if (!c) continue;
      const [x, y] = project(fit, c.lat, c.lon);
      put(panels[1], tag(city, c.color, 10), x + dx, y + dy);
    }
    const mia = LIB.cities.Miami, [mx, my] = project(fit, mia.lat, mia.lon);
    put(panels[1], tag('Miami', mia.color, 10), mx + 14, my + 14);
    const cur = makeCursor(0.75);
    cur.place(mx + 1, my + 1, CURSOR_ANGLE, 1, [0, 0]);
    panels[1].appendChild(cur);
  }

  // press play: the real MIA -> Faena Hotel line on Miami's streets and the app's Play button
  {
    const r = LIB.routes['mia-to-faena-miami'];
    const svg = svgBox(PW, PH);
    const fit = fitBox(r.line, { x: 0, y: 0, w: PW, h: PH }, 26);
    svg.appendChild(mapGroup('mia', fit, { lineScale: 0.5, rect: [0, 0, PW, PH], counties: false, pal: { water: '#0d1018', ground: PANEL, coast: '#262a36', park: '#141818', road: '#1e2029', road2: '#282a36' } }));
    const g = routeGeom(fit, r.line);
    const rg = routeGroup(g, usColor, 2.6, 9, 0.22); rg.draw(1); svg.appendChild(rg);
    svg.appendChild(endsGroup(g, usColor, 3.6, PANEL));
    panels[2].appendChild(svg);
    const btn = h('div', { class: 'abs', style: { display: 'inline-flex', alignItems: 'center', gap: '7px', height: '30px', padding: '0 15px 0 13px', borderRadius: '15px', background: INK, color: '#0d0d10', font: '600 12.5px Inter', whiteSpace: 'nowrap' } });
    btn.appendChild(playSvg(10, '#0d0d10')); btn.appendChild(h('span', { text: 'Play route' }));
    put(panels[2], btn, 12, PH - 42);
    put(panels[2], tag('MIA → Faena Hotel', usColor, 10), 12, 12);
  }

  // the Leap ties the three together: ring where it starts, dot where it lands
  const LY = 250;
  const leap = svgBox(900, 360);
  leap.appendChild(s('path', { d: `M${PX[0] + 8} ${LY}H${PX[2] + 8}`, stroke: C.accent, 'stroke-width': 2.5 }));
  leap.appendChild(s('circle', { cx: PX[0] + 8, cy: LY, r: 6, fill: GROUND, stroke: C.accent, 'stroke-width': 4.5 }));
  leap.appendChild(s('circle', { cx: PX[1] + 8, cy: LY, r: 4.5, fill: GROUND, stroke: C.accent, 'stroke-width': 2.5 }));
  leap.appendChild(s('circle', { cx: PX[2] + 8, cy: LY, r: 7.5, fill: C.accent }));
  el.appendChild(leap);
  const T = LIB.totals;
  const words = [['Plug in.', 'USB cable to your Mac, phone unlocked.'], ['Pick a place.', `${T.spots} spots in ${T.cities} cities, or drop a pin.`], ['Press play.', 'Hold a pin, or drive there at real speed.']];
  words.forEach(([a, b], i) => { line1(el, a, PX[i], LY + 24); line2(el, esc(b), PX[i], LY + 56, PW); });
});

// ------------------------------------------------------------------ features (400x300)
function feature(title, copy, build) {
  card(400, 300, (el) => {
    line1(el, title, 22, 22);
    line2(el, copy, 22, 52, 356);
    const vis = put(el, h('div', { class: 'abs', style: { width: '400px', height: '192px', overflow: 'hidden' } }), 0, 108);
    build(vis, 400, 192);
  });
}

// 1 · real speed: the drive under way on Miami's streets, the app's HUD reading it
feature('Real speed.', 'Drive sends a speed with every leg, so apps show mph and a trip, not a dot that teleports.', (vis, w, h_) => {
  const r = LIB.routes['mia-to-faena-miami'];
  const f0 = fitCentre(25.8, -80.2, 0, 0, 10), at = routeGeom(f0, r.line).at(0.56);
  const [lat, lon] = unproject(f0, at.x, at.y);
  const fit = fitCentre(lat, lon, w * 0.46, h_ * 0.58, 19);
  const svg = svgBox(w, h_);
  svg.appendChild(mapGroup('mia', fit, { lineScale: 0.8, rect: [0, 0, w, h_], counties: false, pal: { water: '#0b0e17', ground: '#121318', coast: '#272b38', park: '#141a18', road: '#20242f', road2: '#2c3141' } }));
  const g = routeGeom(fit, r.line);
  const ahead = s('path', { d: g.d, fill: 'none', stroke: rgba(usColor, 0.28), 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  svg.appendChild(ahead);
  const done = routeGroup(g, usColor, 4, 14, 0.25); done.draw(0.56); svg.appendChild(done);
  vis.appendChild(svg);
  const p = g.at(0.56), head = g.heading(0.56, 60);
  const m = uiMarker(usColor); m.style.transform = 'scale(1.3)'; put(vis, m, p.x, p.y);
  m.ring.style.transform = 'scale(.62)'; m.ring.style.opacity = '.55';
  const hdg = ((head / DEG + 90) % 360 + 360) % 360, card8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(hdg / 45) % 8];
  const [la, lo] = unproject(fit, p.x, p.y);
  const spd = uiHud([['SPD', '35.0 mph'], ['HDG', `${String(Math.round(hdg)).padStart(3, '0')}° ${card8}`]]);
  spd.style.zoom = '1.15'; put(vis, spd, 0, 12 / 1.15); spd.style.left = ''; spd.style.right = px(14 / 1.15);
  const pos = uiHud([['POS', `${la.toFixed(4)}, ${lo.toFixed(4)}`]]);
  pos.style.zoom = '1.15'; put(vis, pos, 14 / 1.15, (h_ - 40) / 1.15);
});

// 2 · real roads: one real drive's speed over time, with the reasons it slowed
feature('Real roads.', 'Each road at its own speed, red lights rolled per drive, stop signs, slower turns, gentle stops.', (vis, w, h_) => {
  const P = window.PROFILE;
  const L = 22, R = w - 22, B = h_ - 26, TOP = 44, VMAX = 40;
  const X = t => L + (R - L) * t / P.seconds, Y = v => B - (B - TOP) * v / VMAX;
  const svg = svgBox(w, h_);
  // the road's own speed, as the engine planned it (speed x the driver's pace)
  let d = '';
  P.limits.forEach(([a, b, v], i) => { d += `${i ? 'L' : 'M'}${f2(X(a))} ${f2(Y(v))}L${f2(X(b))} ${f2(Y(v))}`; });
  svg.appendChild(s('path', { d, fill: 'none', stroke: '#3a3b47', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }));
  // speed over time
  const pts = P.curve.map(([t, v]) => `${f2(X(t))} ${f2(Y(v))}`);
  svg.appendChild(s('path', { d: `M${f2(X(0))} ${B}L${pts.join('L')}L${f2(X(P.seconds))} ${B}Z`, fill: rgba(C.accent, 0.12) }));
  svg.appendChild(s('path', { d: 'M' + pts.join('L'), fill: 'none', stroke: C.accent, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  svg.appendChild(s('path', { d: `M${L} ${B}H${R}`, stroke: '#2a2b35', 'stroke-width': 1 }));
  vis.appendChild(svg);
  const small = (txt, x, y, col = MUTED, anchor = 'left') => put(vis, h('div', { class: 'abs', text: txt, style: { font: '500 10.5px Inter', color: col, whiteSpace: 'nowrap', transform: anchor === 'center' ? 'translateX(-50%)' : anchor === 'right' ? 'translateX(-100%)' : '' } }), x, y);
  // the waits at red lights, labelled with the engine's own reason
  for (const [a, b, why] of P.waits) {
    if (!/^red light/.test(why)) continue;
    small(why.replace('red light, ', 'red ') , X((a + b) / 2), B + 7, INK2, 'center');
  }
  // the drive, its peak, its length; the dashed line named where it runs longest
  const peak = P.curve.reduce((m, c) => (c[1] > m[1] ? c : m));
  small(`Faena Hotel → LIV, ${(P.meters / 1609.34).toFixed(1)} mi, seed ${P.seed}`, L, TOP - 34, MUTED);
  small(`${Math.round(peak[1])} mph`, X(peak[0]), Y(peak[1]) - 17, INK2, 'center');
  const [, lb_, lv] = P.limits.reduce((m, x) => (x[1] - x[0] > m[1] - m[0] ? x : m));
  small("the road's own speed", X(lb_) - 4, Y(lv) - 17, MUTED, 'right');
  small(`${Math.floor(P.seconds / 60)}:${String(P.seconds % 60).padStart(2, '0')}`, R, B + 7, MUTED, 'right');
});

// 3 · whole trips: fly nyc, Miami to New York with the phone offline for the flight
feature('Whole trips.', '<span class="mono" style="font-size:12.5px;color:#f4f4f5">fly nyc</span> drives to MIA, goes offline for the flight, lands at JFK, drives in and stays.', (vis, w, h_) => {
  const mia = LIB.cities.Miami.airportInfo.at, jfk = LIB.cities['New York'].airportInfo.at;
  const fit = fitBox([[41.6, -84], [24.6, -70]], { x: 0, y: 6, w, h: h_ - 52 }, 6);
  const svg = svgBox(w, h_);
  svg.appendChild(worldGroup(fit, { lineScale: 0.7, pal: { water: '#0b0d12', land: '#17181f', coast: '#2a2c38', border: '#24252f' } }));
  const [ax, ay] = project(fit, mia[0], mia[1]), [bx, by] = project(fit, jfk[0], jfk[1]);
  // the flight as the Leap's arc, bowed out over the ocean, dashed while the phone is offline
  const mx = (ax + bx) / 2 + 70, my = (ay + by) / 2 + 12;
  svg.appendChild(s('path', { d: `M${f2(ax)} ${f2(ay)}Q${f2(mx)} ${f2(my)} ${f2(bx)} ${f2(by)}`, fill: 'none', stroke: C.accent, 'stroke-width': 2.5, 'stroke-dasharray': '2 7', 'stroke-linecap': 'round' }));
  svg.appendChild(s('circle', { cx: f2(ax), cy: f2(ay), r: 5.5, fill: '#0b0d12', stroke: C.accent, 'stroke-width': 4 }));
  svg.appendChild(s('circle', { cx: f2(bx), cy: f2(by), r: 7, fill: C.accent }));
  vis.appendChild(svg);
  const lab = (html, x, y, style = {}) => put(vis, h('div', { class: 'abs', html, style: { font: '600 12px Inter', color: INK, whiteSpace: 'nowrap', ...style } }), x, y);
  lab('MIA', ax - 38, ay - 8);
  lab('JFK', bx - 38, by - 8);
  lab('airplane mode on', mx - 14, my - 7, { font: '500 11px Inter', color: MUTED });
  // the five beats of the trip
  const steps = ['drive to MIA', 'offline', 'land at JFK', 'drive in', 'dwell'];
  const row = h('div', { class: 'abs', style: { display: 'flex', gap: '4px', alignItems: 'center' } });
  steps.forEach((t, i) => {
    row.appendChild(h('span', { text: t, style: { font: '500 10.5px Inter', color: i === 1 ? C.accent : INK2, background: i === 1 ? C.tile : RAISED, padding: '4px 7px', borderRadius: '9px', whiteSpace: 'nowrap' } }));
  });
  put(vis, row, 14, h_ - 34);
});

// 4 · fast to use: the real palette, captured from the app in a dry run
feature('Fast to use.', '⌘K for every place and route, a globe to browse, and local hours and time zones for each spot.', (vis, w, h_) => {
  const k = 0.62, box = { x: 430, y: 117 };   // the palette's place in the 1440x900 window
  const img = h('img', { src: '/docs/readme/data/app-palette.png', style: { position: 'absolute', width: px(1440 * k), height: px(900 * k), left: px(-(box.x - 26) * k), top: px(-box.y * k) } });
  vis.appendChild(img);
});

// ------------------------------------------------------------------ 5 · in numbers
card(900, 420, (el, w, h_) => {
  const svg = svgBox(w, h_);
  const fit = fitCentre(16, 12, w / 2, 168, 43000);
  svg.appendChild(worldGroup(fit, { lineScale: 0.6, pal: { water: GROUND, land: '#16171e', coast: '#272a36', border: '#1e2029' } }));
  spotDots(svg, fit, 3.4, 2.3);
  el.appendChild(svg);
  el.appendChild(h('div', { class: 'abs', style: { width: px(w), height: '150px', top: px(h_ - 150), background: 'linear-gradient(rgba(10,11,15,0), rgba(10,11,15,.92) 55%)' } }));
  const T = LIB.totals;
  const stats = [[T.spots, 'spots'], [T.cities, 'cities'], [T.countries, 'countries'], [T.continents, 'continents']];
  stats.forEach(([n, word], i) => {
    const x = 36 + i * 214;
    put(el, h('div', { class: 'abs', text: String(n), style: { font: '600 58px/1 Inter', letterSpacing: '-0.04em', color: INK, fontVariantNumeric: 'tabular-nums' } }), x, h_ - 92);
    put(el, h('div', { class: 'abs', text: word, style: { font: '600 19px/1 Inter', letterSpacing: '-0.02em', color: C.accent } }), x + 2, h_ - 30);
  });
});

// ------------------------------------------------------------------ boot
window.seek = t => { const i = Math.round(t * 60); CARDS.forEach((c, k) => { c.style.display = k === i ? 'block' : 'none'; }); };
(async () => {
  for (const w of [400, 500, 600]) await document.fonts.load(`${w} 20px Inter`);
  await document.fonts.load('500 20px "JetBrains Mono"');
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  window.READY = true;
})().catch(e => { console.error(String(e && e.stack || e)); window.READY = 'error'; });
