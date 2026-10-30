// S10 · the numbers (beats 72-80): 35 spots, 28 cities, 21 countries, 6 continents, every figure
// counted from core/destinations.json by prep/library.py. Each rolls in on its beat over a world
// map where every real spot lights up in its city's colour.
'use strict';

shot({
  name: 'numbers', b0: 72, b1: 80, z: 90,
  build(el) {
    const T = LIB.totals;
    this.stats = [[T.spots, 'spots'], [T.cities, 'cities'], [T.countries, 'countries'], [T.continents, 'continents']];
    el.appendChild(layer('', { background: '#050609' }));
    const fit = this.fit = fitCentre(18, 12, W / 2, H / 2 + 40, 21500);
    const svg = s('svg', { width: W, height: H, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } });
    svg.appendChild(worldGroup(fit, { water: false, pal: { land: '#15161d', coast: '#272b39', border: '#1c1f2b' } }));
    this.dots = [];
    for (const [name, c] of Object.entries(LIB.cities)) {
      for (const sp of c.spots) {
        const [x, y] = project(fit, sp.at[0], sp.at[1]);
        const halo = s('circle', { cx: f2(x), cy: f2(y), r: 14, fill: rgba(c.color, 0.22) });
        const d = s('circle', { cx: f2(x), cy: f2(y), r: 5.5, fill: c.color });
        svg.appendChild(halo); svg.appendChild(d);
        this.dots.push({ d, halo, x, city: name });
      }
    }
    this.dots.sort((a, b) => a.x - b.x);
    this.mapL = h('div', { class: 'layer' }, [svg]);
    el.appendChild(this.mapL);
    // scrim behind the figures so the type sits on calm ground
    el.appendChild(dithered(W, H, (x, y, o) => {
      const v = 1 - smoothstep(0.15, 0.62, Math.hypot((x - W / 2) / W, (y - H / 2) / (H * 1.6)));
      o[0] = 5; o[1] = 6; o[2] = 9; o[3] = 255 * v * 0.8;
    }, 0, 81, 2));
    // figure (right-aligned at x 930) + word (left at 978), sharing a baseline
    this.figs = this.stats.map(([n]) => {
      const f = h('div', { class: 'abs', text: String(n), style: { right: px(W - 930), top: '300px', font: '600 400px/1 Inter', letterSpacing: '-0.06em', color: C.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' } });
      el.appendChild(f);
      return f;
    });
    this.words = this.stats.map(([, w]) => {
      const e = h('div', { class: 'abs', text: w, style: { left: '978px', top: '505px', font: '600 132px/1 Inter', letterSpacing: '-0.045em', color: C.accent, whiteSpace: 'nowrap' } });
      el.appendChild(e);
      return e;
    });
    this.mb = dirBlur(0.3);
  },
  render(lb, t) {
    // which stat: one per two beats
    const i = clamp(Math.floor((lb + LEADB) / 2), 0, 3), u = lb - i * 2;
    this.figs.forEach((f, k) => {
      // incoming rises from below, outgoing leaves upward, both blurred along the move
      let y = 0, o = 0, bl = 0;
      if (k === i) { const p = ease.outExpo(clamp((u + LEADB) / 0.55)); y = (1 - p) * 220; o = p; bl = (1 - p) * 26; }
      else if (k === i - 1) { const p = ease.inCubic(clamp((u + LEADB) / 0.22)); y = -p * 260; o = 1 - p; bl = p * 26; }
      show(f, o > 0.001);
      css(f, 'transform', `translateY(${f2(y)}px)`); op(f, o); css(f, 'filter', bl > 0.05 ? `blur(${f2(bl * 0.25)}px)` : 'none');
    });
    this.words.forEach((w_, k) => {
      let x = 0, o = 0;
      if (k === i) { const p = ease.outExpo(clamp((u - 0.08) / 0.5)); x = (1 - p) * 70; o = p; }
      show(w_, o > 0.001);
      css(w_, 'transform', `translateX(${f2(x)}px)`); op(w_, o);
    });
    // the map: every spot lights west to east during the first stat, then the dots of the
    // current stat's grouping breathe on each beat
    const sweep = prog(lb, 0, 1.6);
    this.dots.forEach((d, k) => {
      const on = clamp((sweep * this.dots.length - k) / 3);
      const beat = Math.exp(-5 * ((lb + 10) % 1));
      d.d.setAttribute('r', f2(5.5 * on * (1 + 0.25 * beat)));
      d.halo.setAttribute('r', f2(14 * on * (1 + 0.6 * beat)));
      d.halo.setAttribute('opacity', f2(on * (0.6 + 0.4 * beat)));
    });
    const z = lerp(1.0, 1.08, lb / 8);
    camera(this.mapL, W / 2 + lerp(0, 60, lb / 8), H / 2, z);
    op(this.mapL, ease.outCubic(prog(lb, -LEADB, 0.8)) * 0.9);
  },
});
