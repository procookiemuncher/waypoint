// S9 · colour chapters (beats 64-72). One city a beat, hard cut on every kick: the whole field in
// the city's own colour from core/destinations.json, its name huge, and a landing-dot disc holding
// the real airport -> spot drive on a night map of that city, drawn within the beat.
'use strict';

const CHAPTERS = [
  ['Paris', 'cdg-to-ritz-paris'], ['London', 'lhr-to-the-dorchester'], ['Dubai', 'dxb-to-burj-al-arab'],
  ['Tokyo', 'hnd-to-aman-tokyo'], ['Sydney', 'syd-to-bondi-icebergs'], ['Cape Town', 'cpt-to-the-silo'],
  ['Monaco', 'nce-to-hotel-de-paris-monte-carlo'], ['Rio de Janeiro', 'gig-to-copacabana-palace'],
];

shot({
  name: 'chapters', b0: 64, b1: 72, z: 80,
  build(el) {
    const D = 840, CX = 1420, CY = 540;
    this.ch = CHAPTERS.map(([city, rid], i) => {
      const ci = LIB.cities[city], r = LIB.routes[rid];
      const lay = layer('', { background: ci.color, display: 'none' });
      // the disc: a night map of the city clipped to the landing dot
      const box = { x: CX - D / 2, y: CY - D / 2, w: D, h: D };
      const fit = fitBox(r.line, box, 150);
      const svg = s('svg', { width: W, height: H, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } });
      const cid = 'chc' + i;
      svg.appendChild(s('defs', {}, [s('clipPath', { id: cid }, [s('circle', { cx: CX, cy: CY, r: D / 2 })])]));
      const disc = s('g', { 'clip-path': `url(#${cid})` });
      const region = regionFor(city);
      if (region) disc.appendChild(mapGroup(region, fit, { lineScale: 1.5, counties: false, rect: [box.x, box.y, D, D],
        pal: { water: '#0b0d15', ground: '#14151b', coast: '#2b2f3c', park: '#16191a', road: '#252935', road2: '#323747' } }));
      else disc.appendChild(s('rect', { x: box.x, y: box.y, width: D, height: D, fill: '#121319' }));
      const geom = routeGeom(fit, r.line);
      const rg = routeGroup(geom, ci.color, 8, 30, 0.3);
      disc.appendChild(rg);
      const ends = endsGroup(geom, ci.color, 13, '#14151b');
      disc.appendChild(ends);
      const discG = s('g', {}, [disc]);
      svg.appendChild(discG);
      lay.appendChild(svg);
      // name, fitted to the left column
      const name = h('div', { class: 'abs', text: city, style: { left: '96px', top: '0', font: '700 230px/0.9 Inter', letterSpacing: '-0.055em', color: '#0b0b10', whiteSpace: 'nowrap' } });
      lay.appendChild(name);
      const air = r.id.split('-to-')[0].toUpperCase();
      const spot = ci.spots.find(sp => r.id.endsWith(sp.id))?.name || routeLabel(r);
      const line = h('div', { class: 'abs', style: { left: '102px', top: '0', font: '500 36px/1.2 Inter', letterSpacing: '-0.01em', color: rgba('#0b0b10', 0.78), whiteSpace: 'nowrap' } });
      line.appendChild(document.createTextNode(`${air} `));
      line.appendChild(arrowSvg(34, rgba('#0b0b10', 0.78), 2.4));
      line.appendChild(document.createTextNode(` ${spot} · ${miles(r).toFixed(1)} mi`));
      lay.appendChild(line);
      el.appendChild(lay);
      return { lay, name, line, rg, ends, discG, D, CX, CY };
    });
  },
  render(lb, t) {
    // fit each name once fonts are in (first render)
    if (!this._fitted) {
      for (const c of this.ch) {
        show(c.lay, true);
        const w = c.name.getBoundingClientRect().width;
        const size = Math.min(230, 230 * 900 / w);
        c.name.style.fontSize = px(size);
        c.name.style.top = px(540 - size * 0.62);
        c.line.style.top = px(540 + size * 0.36);
        show(c.lay, false);
      }
      this._fitted = true;
    }
    const i = clamp(Math.floor(lb + LEADB), 0, this.ch.length - 1);
    this.ch.forEach((c, k) => show(c.lay, k === i));
    const c = this.ch[i], u = lb - i; // beats into this chapter (from -LEADB)
    // disc lands: scale + a quarter turn of drift
    const land = ease.outExpo(clamp((u + LEADB) / 0.7));
    const sc = lerp(0.84, 1, land) * (1 + 0.025 * u);
    c.discG.setAttribute('transform', `translate(${c.CX} ${c.CY}) scale(${sc.toFixed(4)}) rotate(${f2(lerp(-7, 0, land))}) translate(${-c.CX} ${-c.CY})`);
    c.rg.draw(ease.outCubic(clamp((u - 0.02) / 0.8)));
    const e = u - 0.78;
    c.ends.end.setAttribute('r', f2(16.9 * (e > 0 ? spring(e * 2, 1.6, 0.4) : 0)));
    // type slams in from the right with a short blur
    const ty = ease.outExpo(clamp((u + LEADB) / 0.45));
    css(c.name, 'transform', `translateX(${f2((1 - ty) * 90)}px)`);
    css(c.name, 'filter', blurCss((1 - ty) * 12));
    const tl = ease.outExpo(clamp((u - 0.1) / 0.5));
    css(c.line, 'transform', `translateX(${f2((1 - tl) * 60)}px)`);
    op(c.line, tl);
  },
});
