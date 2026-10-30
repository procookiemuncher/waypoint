// S3 · "Put your iPhone anywhere." (beats 16-24, the drop). The lavender flash settles into a flat
// stage bleeding off the bottom right, its corner notched by the Leap's ring. On it the app window
// shutters open from the bottom edge while its picture settles from 1.12 to rest (the film's one
// signature move). Then the camera pushes into the window's world map and through it into S4.
'use strict';

// world map + city tags as the app's home screen shows them (used here and in S4)
function cityItemCounts() {
  const n = {};
  for (const r of Object.values(LIB.routes)) n[r.city] = (n[r.city] || 0) + 1;
  for (const p of LIB.places) n[p.city] = (n[p.city] || 0) + 1;
  return n;
}
// greedy screen-space clustering like app.js cityClusters(): biggest city keeps the tag
function clusterCities(fit, minPx) {
  const counts = cityItemCounts();
  const cs = Object.entries(LIB.cities).map(([name, c]) => ({ name, c, n: counts[name] || 0, p: project(fit, c.lat, c.lon) }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const out = [];
  for (const c of cs) {
    const hit = out.find(o => Math.hypot(o.p[0] - c.p[0], o.p[1] - c.p[1]) < minPx);
    if (hit) { hit.more++; hit.total += c.n; } else out.push({ ...c, more: 0, total: c.n });
  }
  return out;
}

shot({
  name: 'anywhere', b0: 16, b1: 24, z: 30,
  build(el) {
    uiCss();
    this.bg = dithered(W, H, (x, y, o) => {
      const v = 1 - smoothstep(0, 1.1, Math.hypot((x - 300) / W, (y - 200) / H));
      o[0] = lerp(5, 12, v); o[1] = lerp(6, 11, v); o[2] = lerp(9, 18, v);
    }, 0.018, 41, 2);
    el.appendChild(this.bg);
    this.world = h('div', { class: 'layer' });
    el.appendChild(this.world);

    // headline, upper left
    const type = { position: 'absolute', font: '600 128px/0.98 Inter', letterSpacing: '-0.045em', color: C.text };
    this.l1 = riseLine('Put your iPhone', { ...type, left: '96px', top: '118px' });
    this.l2 = riseLine('anywhere.', { ...type, left: '96px', top: '244px' });
    this.head = h('div', { class: 'abs' }, [this.l1, this.l2]);
    this.world.appendChild(this.head);

    // the stage: flat lavender, corner notched by a ring centred on its corner
    this.stageSvg = s('svg', { width: W, height: H, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } });
    this.stagePath = s('path', { fill: C.accent });
    this.stageSvg.appendChild(this.stagePath);
    this.world.appendChild(this.stageSvg);

    // the window on the stage
    const mapEl = h('div', { style: { position: 'absolute', inset: '0' } });
    const MW = 864, MH = 824;
    const fit = this.fit = fitCentre(22, -8, MW / 2, MH / 2 + 30, 26000);
    const msvg = s('svg', { width: MW, height: MH });
    msvg.appendChild(worldGroup(fit, { pal: { water: '#0a0b0f', land: '#15161c', coast: '#262a36', border: '#1d212c' } }));
    mapEl.appendChild(msvg);
    this.bubs = clusterCities(fit, 64).map(c => {
      const b = uiBub(c.name, c.c.color, c.c.flag, c.more, c.total);
      b.style.left = px(c.p[0]); b.style.top = px(c.p[1]);
      mapEl.appendChild(b);
      return b;
    });
    const hudA = uiHud([['POS', '25.7617, -80.1918']]), hudB = uiHud([['SPD', '0.0 mph'], ['HDG', '—']]);
    Object.assign(hudA.style, { left: '12px', top: '12px' }); Object.assign(hudB.style, { right: '12px', top: '12px' });
    mapEl.appendChild(hudA); mapEl.appendChild(hudB);
    const panel = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } });
    const browse = h('div', { class: 'wp-browse' }, [uiGallery(576)]);
    browse.style.flex = 'none'; browse.style.height = '70%';
    panel.appendChild(browse);
    this.con = uiConsole();
    this.con.addLine('pick a route or place, or click the map to drop a pin.');
    this.con.addLine('phone unlocked — developer disk image is on', 'ok');
    panel.appendChild(this.con);
    this.win = uiWindow({ map: mapEl, panel });
    this.winWrap = h('div', { class: 'abs', style: { transformOrigin: '0 0', boxShadow: '0 40px 120px rgba(5,6,9,.55)' , borderRadius: '14px' } }, [this.win]);
    this.world.appendChild(this.winWrap);
    this.mb = dirBlur(0.2);
    this.flash = layer('', { background: C.accent });
    el.appendChild(this.flash);
  },
  render(lb, t) {
    // ---- the flash settles into the stage ----
    const sp = ease.outQuart(prog(lb, -LEADB, 1.0));
    const X0 = lerp(-60, 760, sp), Y0 = lerp(-60, 452, sp), R = lerp(0, 230, sp);
    // rectangle to the bottom right with a concave quarter-circle notch at (X0, Y0)
    this.stagePath.setAttribute('d', `M${f2(X0 + R)} ${f2(Y0)} H${W + 400} V${H + 400} H${f2(X0)} V${f2(Y0 + R)} A${f2(R)} ${f2(R)} 0 0 0 ${f2(X0 + R)} ${f2(Y0)} Z`);
    op(this.flash, 1 - ease.outQuad(prog(lb, -LEADB, 0.12)));

    // ---- the shutter: the window opens from the bottom edge, its picture settling 1.12 -> 1 ----
    const sh = ease.inOutCubic(prog(lb, 0.2, 2.45));
    const settle = lerp(1.12, 1.0, ease.outCubic(prog(lb, 0.2, 2.9)));
    const wx = 832, wy = 548, ws = 0.86;
    // push-in all shot long, then the dive into the map
    const dive = ease.inExpo(prog(lb, 6.6, 8 - LEADB));
    const push = lerp(1, 1.035, ease.inOutSine(prog(lb, 1, 6.6)));
    // the dive aims at the map's middle (window coords ~(436, 470))
    const tx = 436, ty = 470;
    const dz = lerp(1, 7.5, dive);
    const sx = wx + tx * ws, sy = wy + ty * ws;           // that point on screen before the dive
    const ex = lerp(sx, W / 2, ease.outCubic(dive)), ey = lerp(sy, H / 2, ease.outCubic(dive));
    css(this.world, 'transformOrigin', `${f2(sx)}px ${f2(sy)}px`);
    css(this.world, 'transform', `translate(${f2(ex - sx)}px, ${f2(ey - sy)}px) scale(${(push * dz).toFixed(4)})`);
    this.mb.set(this.world, dive * 10, dive * 10);

    css(this.winWrap, 'transform', `translate(${wx}px, ${wy}px) scale(${ws})`);
    const inset = (1 - sh) * 100;
    css(this.win, 'clipPath', `inset(${f2(inset)}% 0 0 0 round 14px)`);
    const fr = this.win.firstChild.nextSibling ? this.win.querySelector('.wp-frame') : null;
    if (fr) { css(fr, 'transformOrigin', '50% 100%'); css(fr, 'transform', `scale(${settle.toFixed(4)})`); }
    css(this.winWrap, 'boxShadow', `0 40px 120px rgba(5,6,9,${f2(0.6 * sh)})`);
    this.win.setRing(t + 3, 0.55 * sh);

    // city tags pop in, two per beat
    this.bubs.forEach((b, i) => {
      const p = lb - (1.6 + i * 0.5);
      const k = p <= 0 ? 0 : spring(p, 1.6, 0.42);
      css(b, 'transform', `translate(-50%, -50%) scale(${k.toFixed(4)})`);
      op(b, clamp(p * 4));
    });
    this.con.type('');
    this.con.caret(Math.floor(t / 0.525) % 2 === 0);

    // ---- headline ----
    const p1 = ease.outQuart(prog(lb, 0.45, 1.6)), p2 = ease.outQuart(prog(lb, 0.8, 1.95));
    this.l1.set(p1, (1 - p1) * 12); this.l2.set(p2, (1 - p2) * 12);
    css(this.head, 'transform', `translateY(${f2(-ease.inCubic(prog(lb, 6.4, 8)) * 260)}px)`);
  },
});
