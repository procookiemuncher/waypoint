// S5 · "Right place. Right time." (beats 32-40). Inside Miami: the city page the card opened (local
// time there, routes / miles / minutes counting up, places with their real opening hours) beside
// the city's 8 real routes drawing themselves across a night map of Miami.
'use strict';

shot({
  name: 'city', b0: 32, b1: 40, z: 50,
  build(el) {
    uiCss();
    const ci = LIB.cities.Miami;
    this.world = h('div', { class: 'layer' });
    el.appendChild(this.world);
    // the map: all of Miami's routes, fitted to the left of the frame
    const rs = cityRoutes('Miami');
    const lines = rs.map(r => r.line);
    const fit = fitBox(lines.flat(), { x: -40, y: 40, w: 1240, h: 1000 }, 80);
    const msvg = s('svg', { width: W, height: H, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } });
    msvg.appendChild(mapGroup('mia', fit, { lineScale: 1.3, pal: { water: '#0b0e17', ground: '#121318', coast: '#272b38', park: '#141a18', road: '#1f2330', road2: '#2b3040' } }));
    this.routes = rs.map(r => { const g = routeGroup(routeGeom(fit, r.line), ci.color, 4, 14, 0.22); msvg.appendChild(g); return g; });
    this.ends = rs.map(r => { const g = endsGroup(this.routes[rs.indexOf(r)].geom, ci.color, 6, '#121318'); msvg.appendChild(g); return g; });
    this.mapLayer = h('div', { class: 'layer' }, [msvg]);
    this.world.appendChild(this.mapLayer);
    // scrim under the headline (neutral, bottom left)
    this.world.appendChild(dithered(W, H, (x, y, o) => {
      const v = smoothstep(0.45, 1.0, y / H) * (1 - smoothstep(0.35, 0.75, x / W));
      o[0] = 5; o[1] = 6; o[2] = 9; o[3] = 255 * v * 0.92;
    }, 0, 51, 2));

    const type = { position: 'absolute', font: '600 136px/0.98 Inter', letterSpacing: '-0.045em', color: C.text };
    this.l1 = riseLine('Right place.', { ...type, left: '92px', top: '676px' });
    this.l2 = riseLine('Right time.', { ...type, left: '92px', top: '810px' });
    this.world.appendChild(this.l1); this.world.appendChild(this.l2);

    // the city page, as a floating panel
    const pageW = 576;
    const panel = h('div', { class: 'wp', style: { width: px(pageW), height: '830px', background: '#101219', borderRadius: '22px', overflow: 'hidden',
      border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 50px 140px rgba(0,0,0,.7)' } });
    this.page = uiCity('Miami', pageW, { order: ['mia-to-faena-miami', 'faena-miami-to-sexy-fish-miami', 'faena-miami-to-liv-miami', 'miami-cruise'] });
    panel.appendChild(this.page);
    this.panel = h('div', { class: 'abs', style: { transformOrigin: '0 0' } }, [panel]);
    this.world.appendChild(this.panel);
    this.chips = this.page.chips;
    this.open = this.page.querySelector('.oc.on');
  },
  render(lb, t) {
    // ---- arrive: the panel comes in big (we were diving into the Miami card) and settles ----
    const arr = ease.outExpo(prog(lb, -LEADB, 1.5));
    const sc = lerp(2.1, 1.3, arr);
    const x = lerp(700, 1150, arr), y = lerp(-180, 60, arr);
    const ry = lerp(0, -10, arr);
    const drift = ease.inOutSine(prog(lb, 1.5, 8));
    css(this.panel, 'transform', `translate(${f2(x - drift * 14)}px, ${f2(y)}px) perspective(1800px) rotateY(${f2(ry + drift * 3)}deg) scale(${sc.toFixed(4)})`);
    css(this.panel, 'filter', blurCss((1 - arr) * 10));
    // map: fades up under the panel, slow push
    const mz = lerp(1.08, 1.0, ease.outCubic(prog(lb, 0, 2))) * lerp(1, 1.05, drift);
    camera(this.mapLayer, W / 2, H / 2, mz);
    op(this.mapLayer, ease.outCubic(prog(lb, 0.2, 1.4)));
    // routes draw in, staggered
    this.routes.forEach((g, i) => {
      const p = ease.inOutCubic(prog(lb, 0.5 + i * 0.28, 2.6 + i * 0.28));
      g.draw(p);
      op(this.ends[i].start, p > 0 ? 1 : 0);
      const e = lb - (2.6 + i * 0.28);
      this.ends[i].end.setAttribute('r', f2(7.8 * (e > 0 ? spring(e, 2, 0.4) : 0)));
    });

    // ---- the page comes alive: stats count up, chips slide in, "open now" pulses ----
    this.page.setStats(ease.outCubic(prog(lb, 1.0, 2.6)));
    this.chips.forEach((c, i) => {
      const p = ease.outQuart(prog(lb, 1.6 + i * 0.3, 2.6 + i * 0.3));
      css(c, 'transform', `translateX(${f2((1 - p) * 60)}px)`);
      op(c, p);
    });
    if (this.open) {
      const pulse = 0.5 + 0.5 * Math.cos(TAU * (lb - 3.5) / 1.0);
      css(this.open, 'textShadow', lb > 3.5 ? `0 0 ${f2(10 * pulse)}px rgba(74,222,128,${f2(0.6 * pulse)})` : 'none');
    }

    // ---- headline ----
    const p1 = ease.outQuart(prog(lb, 1.2, 2.3)), p2 = ease.outQuart(prog(lb, 2.2, 3.3));
    this.l1.set(p1, (1 - p1) * 12); this.l2.set(p2, (1 - p2) * 12);
    op(this.l1, p1 > 0 ? 1 : 0); op(this.l2, p2 > 0 ? 1 : 0);
  },
});
