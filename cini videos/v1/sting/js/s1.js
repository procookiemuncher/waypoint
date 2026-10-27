// S1 f0-71: the Waypoint header rises out of a lavender haze, the dark app window fades in
// around it, the cursor glides in, turns toward the logo, dives, grows on hover and clicks.
'use strict';

// "→" and "▸" aren't in the repo's latin woff2 subsets (checked against the cmap), so they're
// drawn: an arrow sized to sit in a line of Inter, and a small play triangle.
function arrowGlyph(stroke = 9, color = 'currentColor') {
  return s('svg', { viewBox: '0 0 100 100', class: 'arr', style: { display: 'inline-block', width: '0.92em', height: '1em', verticalAlign: '-0.12em', margin: '0 0.2em', overflow: 'visible' } }, [
    s('path', { d: 'M6 54 H90 M62 26 L91 54 L62 82', fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ]);
}
function titleWithArrow(a, b, stroke) {
  const span = h('span', { class: 'nowrap' });
  span.append(a, arrowGlyph(stroke), b);
  return span;
}
function playTri(size, color) {
  return s('svg', { width: size, height: size, viewBox: '0 0 10 10', style: { display: 'block' } }, [
    s('path', { d: 'M2.6 1.4 L8.6 5 L2.6 8.6 Z', fill: color, 'stroke-linejoin': 'round', stroke: color, 'stroke-width': 0.6 }),
  ]);
}

function textW(str, font, spacing = 0) {
  const ctx = (textW._c ||= document.createElement('canvas').getContext('2d'));
  ctx.font = font;
  ctx.letterSpacing = spacing + 'px';
  return ctx.measureText(str).width;
}

(() => {
  // header centre line, from the brief; afterwards it drifts up 1 px a frame
  const LOCK_Y = [[0, 932], [2, 776], [5, 683], [10, 608], [24, 546], [37, 536]];
  const lockY = f => spline(f, LOCK_Y, { v1: -1, extend: true });
  // everything else eases into the same 1 px/frame drift
  const drift = f => (f < 28 ? 0 : f < 40 ? -((f - 28) ** 2) / 24 : -6 - (f - 40));

  // cursor: glide in, then a swooping dive onto the disc's lower right
  const curX0 = f => approach(f, 27, 891, 770, 0.2);
  const curY0 = f => approach(f, 27, 393, 383, 0.2);
  const DIVE_X = [[44, 770.7], [47, 768], [51, 724], [56, 629], [59, 587], [65, 566], [71, 555]];
  const DIVE_Y = [[44, 383.3], [47, 392], [51, 468], [56, 564], [59, 546], [65, 536], [71, 531]];
  const curX = f => (f < 44 ? curX0(f) : spline(f, DIVE_X, { v0: -0.6, extend: true }));
  const curY = f => (f < 44 ? curY0(f) : spline(f, DIVE_Y, { v0: -0.05, extend: true }));
  const POINT_DOWN_LEFT = 128 - 360; // turning counter-clockwise from the natural -113
  const curRot = f => kf(f, [[47, CURSOR_ANGLE], [51, POINT_DOWN_LEFT]], ease.inOutCubic);
  const curScale = f => kf(f, [[56, 1], [61, 1.55], [69, 1.55], [71, 1.55 * 0.85]], [ease.outCubic, ease.linear, ease.inOutQuad]) *
    (f > 71 ? 1 - 0.07 * (f - 71) : 1);

  // camera: zoom about the centre, in to 1.2, a beat at the top, then out and accelerating
  const zoom = f => {
    if (f <= 46) return 1;
    if (f <= 60) return 1 + 0.2 * ease.inOutCubic((f - 46) / 14);
    if (f <= 61) return 1.2;
    const t = (f - 61) / 10;
    return 1.2 - 0.16 * t * t;
  };

  let E = {};

  function build(root) {
    const cam = layer('', { transformOrigin: '540px 540px' });
    root.appendChild(cam);

    // page with the faint lavender floor glow (stays), and the haze over it (fades out)
    const ac = rgb(C.accent), pg = rgb(C.page), hz = rgb(C.accentDim);
    const floorGlow = (x, y, o) => {
      const d = Math.hypot((x - 540) / 780, (y - 1170) / 400);
      const a = 0.10 * (1 - smoothstep(0, 1, d));
      for (let i = 0; i < 3; i++) o[i] = lerp(o[i], ac[i], a);
    };
    const base = dithered(W, H, (x, y, o) => { o[0] = pg[0]; o[1] = pg[1]; o[2] = pg[2]; floorGlow(x, y, o); }, 0.02, 11);
    const haze = dithered(W, H, (x, y, o) => {
      const t = clamp(Math.hypot(x - 600, y - 820) / 980);
      const a = 0.40 * (1 - 0.62 * smoothstep(0, 1, t));
      for (let i = 0; i < 3; i++) o[i] = lerp(pg[i], hz[i], a);
      floorGlow(x, y, o);
    }, 0.02, 12);
    for (const c of [base, haze]) { c.className = 'abs'; cam.appendChild(c); }
    E.haze = haze;

    // ---- the app window (top-left corner at 408,405, runs off right and bottom) ----
    const win = h('div', { class: 'abs', style: { left: '408px', top: '405px', width: '760px', height: '760px', borderRadius: '93px', overflow: 'hidden', background: C.win1, boxShadow: `0 0 0 1px ${C.hair}, 0 50px 140px rgba(0,0,0,.65)` } });
    cam.appendChild(win);
    E.win = win;
    // body gradient + faint lavender floor glow, dithered
    const wb = rgb(C.win0), wa = rgb(C.win1);
    const winBg = dithered(760, 760, (x, y, o) => {
      const t = clamp(y / 500);
      for (let i = 0; i < 3; i++) o[i] = lerp(wb[i], wa[i], t);
      const d = Math.hypot((x - 250) / 520, (y - 760) / 260);
      const a = 0.075 * (1 - smoothstep(0, 1, d));
      for (let i = 0; i < 3; i++) o[i] = lerp(o[i], ac[i], a);
    }, 0.02, 13);
    winBg.className = 'abs';
    win.appendChild(winBg);
    // title band (window-local coordinates from here on: stage minus 408,405)
    win.appendChild(h('div', { class: 'abs', style: { width: '760px', height: '248px', background: C.win0, borderBottom: `1px solid ${C.hair}` } }));
    // phone status pill, top right of the band, clear of the cursor's glide path
    const pill = h('div', { class: 'abs nowrap', style: { left: '474px', top: '18px', height: '36px', padding: '0 16px 0 14px', borderRadius: '18px', background: C.panel, boxShadow: `inset 0 0 0 1px ${C.hair2}`, display: 'flex', alignItems: 'center', gap: '10px', font: '500 18px Inter', color: C.body } }, [
      h('div', { style: { width: '6px', height: '6px', borderRadius: '3px', background: C.green } }),
      h('span', { text: 'iPhone · Ready' }),
    ]);
    win.appendChild(pill);
    // city rows
    const row = (y, dot, name, count, selected) => {
      const r = h('div', { class: 'abs', style: { left: '40px', top: `${y - 405 - 56}px`, width: '296px', height: '112px', borderRadius: '30px', background: selected ? C.panel : 'transparent', boxShadow: selected ? `inset 0 0 0 1px ${C.hair}` : 'none', opacity: selected ? 1 : 0.42 } }, [
        h('div', { class: 'abs', style: { left: '29px', top: '35px', width: '10px', height: '10px', borderRadius: '5px', background: dot } }),
        h('div', { class: 'abs nowrap', text: name, style: { left: '52px', top: '17px', font: '500 36px Inter', letterSpacing: '-0.01em', color: C.text } }),
        h('div', { class: 'abs nowrap', text: count, style: { left: '52px', top: '62px', font: '400 26px Inter', color: C.muted } }),
      ]);
      win.appendChild(r);
    };
    row(739, C.ny, 'New York', '2 spots', true);
    row(900, C.mia, 'Miami', '3 spots', false);
    // route card from (764,700), off frame to the right and bottom
    const card = h('div', { class: 'abs', style: { left: `${764 - 408}px`, top: `${700 - 405}px`, width: '520px', height: '520px', borderRadius: '46px', background: C.panel, boxShadow: `inset 0 0 0 1px ${C.hair}` } });
    win.appendChild(card);
    const thumb = h('div', { class: 'abs', style: { left: '16px', top: '16px', width: '488px', height: '240px', borderRadius: '32px', overflow: 'hidden', boxShadow: `inset 0 0 0 1px ${C.hair}` } });
    card.appendChild(thumb);
    // map in stage coordinates, shifted into the thumbnail; the route fits the visible part
    const fit = fitPoints('nyc_thumb', ROUTES['jfk-to-the-plaza'].points, { x: 812, y: 734, w: 238, h: 196 });
    const tsvg = s('svg', { width: 488, height: 240, style: { display: 'block' } });
    const tg = s('g', { transform: 'translate(-780 -716)' }, [mapGroup(fit, { lineScale: 0.7 }), routeGroup(fit, 'jfk-to-the-plaza', C.accent, 3.2, 10, 0.2)]);
    tsvg.appendChild(tg);
    thumb.appendChild(tsvg);
    const st = ROUTES['jfk-to-the-plaza'].points;
    const [ax, ay] = project(fit, st[0][0], st[0][1]);
    const [bx, by] = project(fit, st[st.length - 1][0], st[st.length - 1][1]);
    tg.appendChild(s('circle', { cx: ax, cy: ay, r: 4, fill: C.ny }));
    tg.appendChild(s('circle', { cx: bx, cy: by, r: 5.5, fill: C.accent }));
    tg.appendChild(s('circle', { cx: bx, cy: by, r: 2.2, fill: '#fff' }));
    card.appendChild(h('div', { class: 'abs nowrap', style: { left: '22px', top: '276px', font: '600 36px Inter', letterSpacing: '-0.015em', color: C.text } }, [titleWithArrow('JFK', 'The Plaza', 9)]));
    card.appendChild(h('div', { class: 'abs nowrap mono', text: 'New York · drive', style: { left: '23px', top: '330px', font: '500 23px "JetBrains Mono"', color: C.muted } }));

    // ---- header lockup: disc, name, pill; scaled so it spans x474-1063 ----
    const D = 132;
    const base1 = { gap1: 30, name: 80, gap2: 22, pillFont: 33, pillPadX: 20, pillH: 52 };
    const nameW = textW('Waypoint', `500 ${base1.name}px Inter`, -0.02 * base1.name);
    const pillTextW = textW('for Mac', `600 ${base1.pillFont}px Inter`, 0);
    const restW = base1.gap1 + nameW + base1.gap2 + pillTextW + 2 * base1.pillPadX;
    const k = (1063 - 474 - D) / restW;
    const lock = h('div', { class: 'layer' });
    cam.appendChild(lock);
    E.lock = lock;
    E.lockBlur = dirBlur(0.6);

    const ring = h('div', { class: 'abs', style: { left: `${540 - 87}px`, top: `${536 - 87}px`, width: '174px', height: '174px', borderRadius: '50%', background: 'radial-gradient(circle closest-side, rgba(180,154,255,0) 72%, rgba(180,154,255,.35) 76%, rgba(180,154,255,.12) 88%, rgba(180,154,255,0) 100%)' } });
    lock.appendChild(ring);
    E.ring = ring;
    const disc = makeDisc();
    disc.setSize(D);
    disc.style.left = `${474}px`; disc.style.top = `${536 - D / 2}px`;
    lock.appendChild(disc);
    E.disc = disc;

    const nameSize = base1.name * k;
    const name = h('div', { class: 'abs nowrap', text: 'Waypoint', style: { left: `${474 + D + base1.gap1 * k}px`, top: `${536 - nameSize * 0.6}px`, font: `500 ${nameSize}px/1.2 Inter`, letterSpacing: '-0.02em', color: C.text } });
    lock.appendChild(name);
    E.name = name;
    const pillW = (pillTextW + 2 * base1.pillPadX) * k, pillH = base1.pillH * k;
    const forMac = h('div', { class: 'abs nowrap', style: { left: `${1063 - pillW}px`, top: `${536 - pillH / 2}px`, width: `${pillW}px`, height: `${pillH}px`, borderRadius: `${pillH / 2}px`, background: C.accent, color: C.page, font: `600 ${base1.pillFont * k}px/${pillH}px Inter`, textAlign: 'center' }, text: 'for Mac' });
    lock.appendChild(forMac);
    E.forMac = forMac;

    const cur = makeCursor();
    cam.appendChild(cur);
    E.cur = cur;
    E.cam = cam;
  }

  function render(f) {
    // camera
    const z = zoom(f);
    const zs = Math.abs(speed(zoom, f)) * 540; // edge speed, px/frame
    E.cam.style.transform = `scale(${z.toFixed(5)})`;
    E.cam.style.filter = blur(Math.max(0, zs - 3) * 0.08);

    E.haze.style.opacity = 1 - ease.inOutSine(prog(f, 0, 28));

    const d = drift(f);
    E.win.style.opacity = kf(f, [[14, 0], [15, 0.53], [19, 0.7], [24, 1]], [ease.linear, ease.outQuad, ease.outQuad]);
    E.win.style.transform = `translateY(${d.toFixed(2)}px)`;

    // header rise, smeared along its speed
    const y = lockY(f), vy = speed(lockY, f);
    E.lock.style.transform = `translateY(${(y - 536).toFixed(2)}px)`;
    E.lockBlur.set(E.lock, 0, Math.min(22, Math.abs(vy) * 0.24));
    E.name.style.opacity = kf(f, [[1.6, 0], [2, 0.3], [7, 1]], ease.outQuad);
    E.name.style.filter = blur(kf(f, [[2, 16], [10, 0]], ease.outCubic));
    E.forMac.style.opacity = kf(f, [[3.6, 0], [4, 0.25], [5, 0.55], [10, 1]], ease.outQuad);
    E.forMac.style.filter = blur(kf(f, [[4, 22], [5, 16], [13, 0]], [ease.linear, ease.outCubic]));
    E.forMac.style.transform = `translateX(${kf(f, [[4, 15], [14, 0]], ease.outCubic).toFixed(2)}px)`;
    E.ring.style.opacity = kf(f, [[53, 0], [58, 1]], ease.outQuad);
    const press = kf(f, [[69, 1], [71, 0.955]], ease.inOutQuad);
    E.disc.style.transform = `scale(${press})`;

    // cursor
    if (f < 27) { E.cur.style.opacity = 0; return; }
    const cx = curX(f), cy = curY(f);
    const vx = (curX(f + 0.25) - curX(f - 0.25)) * 2, vy2 = (curY(f + 0.25) - curY(f - 0.25)) * 2;
    E.cur.place(cx, cy, curRot(f), curScale(f), f < 27.5 ? [0, 0] : [vx, vy2], kf(f, [[27, 0.5], [28, 1]]));
  }

  shot('S1', 0, 71, build, render);
})();
