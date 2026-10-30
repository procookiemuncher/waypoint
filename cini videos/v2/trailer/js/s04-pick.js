// S4 · "Pick a place." (beats 24-32). Through the window's map into the world: the app's city
// tags, the map's power-on sweep lighting them in turn. The real Destinations panel floats in,
// the cursor clicks Miami and the card swells toward the camera into S5.
'use strict';

shot({
  name: 'pick', b0: 24, b1: 32, z: 40,
  build(el) {
    uiCss();
    this.world = h('div', { class: 'layer' });
    el.appendChild(this.world);
    const fit = this.fit = fitCentre(24, 6, W / 2, H / 2, 19500);
    const msvg = s('svg', { width: W, height: H, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } });
    msvg.appendChild(worldGroup(fit, { pal: { water: '#08090d', land: '#17181f', coast: '#2e3342', border: '#20242f' }, lineScale: 1.2 }));
    this.mapLayer = h('div', { class: 'layer' }, [msvg]);
    this.world.appendChild(this.mapLayer);
    // the sweep (app.css #sweep): a soft lavender band crossing the map once
    this.sweep = layer('', { background: `linear-gradient(105deg, transparent 0%, ${rgba(C.accent, 0.10)} 40%, ${rgba(C.accent, 0.22)} 50%, ${rgba(C.accent, 0.10)} 60%, transparent 100%)`, width: '900px' });
    this.mapLayer.appendChild(this.sweep);
    this.tags = clusterCities(fit, 104).map(c => {
      const b = uiBub(c.name, c.c.color, c.c.flag, c.more, c.total);
      b.style.left = px(c.p[0]); b.style.top = px(c.p[1]);
      b.style.zoom = '1.75';
      // zoom scales left/top too: pre-divide
      b.style.left = px(c.p[0] / 1.75); b.style.top = px(c.p[1] / 1.75);
      this.mapLayer.appendChild(b);
      // tags that would sit behind the headline block are kept faint so the type stays clean
      const under = c.p[0] > 40 && c.p[0] < 1160 && c.p[1] > 650 && c.p[1] < 990;
      return { el: b, x: c.p[0], under };
    });

    // headline, bottom left
    const type = { position: 'absolute', font: '600 150px/0.98 Inter', letterSpacing: '-0.045em', color: C.text };
    this.l1 = riseLine('Pick a place.', { ...type, left: '92px', top: '700px' });
    this.sub = h('div', { class: 'abs', text: `${LIB.totals.spots} spots in ${LIB.totals.cities} cities, each a real drive from its airport.`,
      style: { left: '98px', top: '880px', width: '760px', font: '500 30px/1.35 Inter', letterSpacing: '-0.01em', color: C.body } });
    this.head = h('div', { class: 'abs' }, [this.l1, this.sub]);
    this.world.appendChild(this.head);

    // the Destinations panel, lifted out of the window
    const panel = h('div', { class: 'wp', style: { width: '576px', height: '860px', background: '#101219', borderRadius: '22px', overflow: 'hidden',
      border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 50px 140px rgba(0,0,0,.7)' } });
    this.gal = uiGallery(576);
    panel.appendChild(this.gal);
    this.panel = h('div', { class: 'abs', style: { transformOrigin: '0 0' } }, [panel]);
    this.world.appendChild(this.panel);
    this.cursor = makeCursor(1.25);
    this.world.appendChild(this.cursor);
    this.mb = dirBlur(0.2);
    this.pmb = dirBlur(0.3);
  },
  render(lb, t) {
    const K = TL.K;
    // ---- arrive through the window: start deep and blurred, settle ----
    const arr = ease.outExpo(prog(lb, -LEADB, 1.6));
    const z = lerp(2.6, 1.0, arr) * lerp(1, 1.06, ease.inOutSine(prog(lb, 1.2, 8)));
    const driftX = lerp(0, -70, ease.inOutSine(prog(lb, 0, 8)));
    camera(this.mapLayer, W / 2 - driftX, H / 2, z);
    css(this.mapLayer, 'filter', blurCss((1 - arr) * 16));
    // the sweep crosses once, lighting each tag as it passes
    const sx = lerp(-900, W + 200, ease.inOutSine(prog(lb, 0.3, 3.1)));
    css(this.sweep, 'transform', `translateX(${f2(sx)}px)`);
    op(this.sweep, prog(lb, 0.3, 3.1) > 0 && prog(lb, 0.3, 3.1) < 1 ? 1 : 0);
    for (const tg of this.tags) {
      const hit = (sx + 450 - tg.x) / 380; // >0 once the band's middle has passed
      const pop = hit > 0 ? spring(hit * 0.55, 1.9, 0.4) : 0;
      css(tg.el, 'transform', `translate(-50%, -50%) scale(${(0.82 + 0.18 * pop).toFixed(4)})`);
      op(tg.el, (0.35 + 0.65 * clamp(hit * 2)) * (tg.under ? 0.12 : 1));
    }
    // map recedes a little when the panel arrives
    const pin = ease.outExpo(prog(lb, K.cardsIn - 24, K.cardsIn - 24 + 1.6));
    op(this.mapLayer, lerp(1, 0.55, pin));
    if (arr >= 1) css(this.mapLayer, 'filter', blurCss(3 * pin));

    // ---- headline ----
    const p1 = ease.outQuart(prog(lb, 0.6, 1.7));
    this.l1.set(p1, (1 - p1) * 12);
    const ps = ease.outQuart(prog(lb, 1.1, 2.2));
    op(this.sub, ps); css(this.sub, 'transform', `translateY(${f2((1 - ps) * 24)}px)`);
    const hout = ease.inCubic(prog(lb, 4.2, 5.2));
    css(this.head, 'transform', `translateX(${f2(-hout * 120)}px)`);
    op(this.head, 1 - hout);

    // ---- the panel floats in from the right, tilted ----
    const pz = lerp(1.7, 1.42, pin);
    const px_ = lerp(W + 200, 1060, pin), py = lerp(140, 36, pin);
    // the click on Miami and the swell toward the camera
    const click = lb - (K.clickCity - 24);
    const press = click > 0 && click < 0.5 ? Math.sin(Math.PI * click / 0.5) : 0;
    const swell = ease.inExpo(prog(lb, K.clickCity - 24 + 0.45, 8 - LEADB));
    const ry = lerp(-24, -8, pin) * (1 - swell);
    css(this.panel, 'transform', `translate(${f2(px_)}px, ${f2(py)}px) perspective(1800px) rotateY(${f2(ry)}deg) scale(${pz.toFixed(4)})`);
    const card = this.gal.cards.Miami;
    css(card, 'transform', `scale(${(1 - 0.035 * press).toFixed(4)})`);
    // measure the card with no frame-wide transform on, so every frame (and every render worker)
    // reads the same layout whatever was drawn before it
    css(this.world, 'transform', '');
    const rr = card.getBoundingClientRect();
    // the swell: the whole frame dives onto the Miami card
    if (swell > 0) {
      const r = rr;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      css(this.world, 'transformOrigin', `${f2(cx)}px ${f2(cy)}px`);
      css(this.world, 'transform', `translate(${f2((W / 2 - cx) * ease.outCubic(swell))}px, ${f2((H / 2 - cy) * ease.outCubic(swell))}px) scale(${lerp(1, 6, swell).toFixed(4)})`);
      this.mb.set(this.world, swell * 8, swell * 8);
    } else { css(this.world, 'transform', ''); this.mb.set(this.world, 0, 0); }

    // ---- cursor: in from the bottom right, onto Miami, click ----
    const ci = prog(lb, K.clickCity - 24 - 1.6, K.clickCity - 24 - 0.05);
    if (ci > 0 && swell < 0.02) {
      const tx = rr.left + rr.width * 0.42, ty = rr.top + rr.height * 0.55;
      const e = ease.outCubic(ci);
      const x = lerp(W + 40, tx, e), y = lerp(H + 60, ty, e);
      const vx = rate(b => lerp(W + 40, tx, ease.outCubic(prog(b, K.clickCity - 24 - 1.6, K.clickCity - 24 - 0.05))), lb);
      const vy = rate(b => lerp(H + 60, ty, ease.outCubic(prog(b, K.clickCity - 24 - 1.6, K.clickCity - 24 - 0.05))), lb);
      this.cursor.place(x, y, CURSOR_ANGLE, 1 - 0.12 * press, [perFrame(vx), perFrame(vy)], 1);
      show(this.cursor, true);
    } else show(this.cursor, false);
  },
});
