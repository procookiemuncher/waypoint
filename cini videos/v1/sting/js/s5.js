// S5 f187-214: the route's hero card rises over the night map (which keeps creeping, blurs a
// touch and dims behind it): Manhattan cover with the same route, grabber, title, caption and
// the top of the PLAY bar. Exit: the card shrinks and lifts while the whole frame blurs out.
'use strict';

(() => {
  const ROUTE = 'jfk-to-the-plaza';
  const X = 203, CW = 675, INSET = 24, TW = 627, TH = 536, CH = 900;
  // the cover's top edge, from the brief, then a steady drift up
  const coverTop = f => spline(f, [[187, 642], [191, 456], [196, 395], [200, 369], [205, 348]], { v1: -4, extend: true });
  // exit: the card lifts and shrinks about 5%, both accelerating, while the frame blurs 1 -> 7
  const exitT = f => clamp((f - 207) / 7.5, 0, 2);
  const lift = f => -26 * exitT(f) ** 2;
  const shrink = f => 1 - 0.05 * exitT(f) ** 2;
  const cardTop = f => coverTop(f) - INSET + lift(f);
  const cardBlur = f => kf(f, [[187, 2.6], [189, 3.8], [201, 0]], [ease.outQuad, ease.inOutQuad]);
  const frameBlur = f => kf(f, [[205.5, 0], [207, 1], [214.5, 7]], [ease.linear, ease.inQuad]);
  const mapBlur = f => kf(f, [[187, 0], [196, 2.5]], ease.outCubic);
  const mapDim = f => kf(f, [[187, 1], [196, 0.7]], ease.outCubic);

  let E = {};
  function cover() {
    // Midtown East at ~12 m/px: the tunnel, the run up the East Side and the turn to the Plaza
    const pts = ROUTES[ROUTE].points;
    const tail = pts.filter(([, lon]) => lon < -73.94);
    const fit = fitPoints('mnh', tail, { x: 70, y: 110, w: 470, h: 330 });
    const svg = s('svg', { width: TW, height: TH, style: { display: 'block' } });
    svg.appendChild(mapGroup(fit, { lineScale: 1.15, waterRect: [0, 0, TW, TH] }));
    const rg = routeGroup(fit, ROUTE, C.accent, 7, 22, 0.2);
    rg.draw(1);
    svg.appendChild(rg);
    const [ex, ey] = project(fit, pts[pts.length - 1][0], pts[pts.length - 1][1]);
    svg.appendChild(s('circle', { cx: ex, cy: ey, r: 27, fill: rgba(C.accent, 0.14) }));
    svg.appendChild(s('circle', { cx: ex, cy: ey, r: 14, fill: C.accent, stroke: C.page, 'stroke-width': 3 }));
    svg.appendChild(s('circle', { cx: ex, cy: ey, r: 5, fill: '#fff' }));
    return svg;
  }

  function build(root) {
    const all = layer();
    root.appendChild(all);
    E.all = all;
    E.map = NIGHT.build();
    all.appendChild(E.map.el);

    const card = h('div', { class: 'abs', style: { left: px(X), width: px(CW), height: px(CH), transformOrigin: `${CW / 2}px 320px` } });
    all.appendChild(card);
    E.card = card;
    E.cardBlur = dirBlur(0.05);
    card.appendChild(h('div', { class: 'abs', style: { width: px(CW), height: px(CH), borderRadius: '88px', background: C.panel, boxShadow: `inset 0 0 0 1px ${C.hair}, inset 0 1px 0 rgba(255,255,255,.05), 0 30px 120px rgba(0,0,0,.6)` } }));
    const thumb = h('div', { class: 'abs', style: { left: px(INSET), top: px(INSET), width: px(TW), height: px(TH), borderRadius: '64px', overflow: 'hidden', background: C.water } }, [cover()]);
    card.appendChild(thumb);
    thumb.appendChild(h('div', { class: 'abs', style: { width: px(TW), height: px(TH), borderRadius: '64px', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)' } }));
    // sheet grabber, in the card's top margin
    card.appendChild(h('div', { class: 'abs', style: { left: px(CW / 2 - 32), top: '9px', width: '64px', height: '6px', borderRadius: '3px', background: C.hair2 } }));

    const y0 = INSET + TH;
    card.appendChild(h('div', { class: 'abs nowrap', style: { left: px(INSET + 6), top: px(y0 + 30), font: '600 38px/1 Inter', letterSpacing: '-0.015em', color: C.text } }, [titleWithArrow('JFK', 'The Plaza', 9)]));
    card.appendChild(h('div', { class: 'abs nowrap mono', text: 'NEW YORK · DRIVE · 35 MPH', style: { left: px(INSET + 7), top: px(y0 + 84), font: '500 23px/1 "JetBrains Mono"', letterSpacing: '0.04em', color: C.muted } }));
    const play = h('div', { class: 'abs', style: { left: px(INSET), top: px(y0 + 130), width: px(TW), height: '76px', borderRadius: '38px', background: C.accent, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', font: '700 26px/1 Inter', letterSpacing: '0.1em', color: C.page } }, [
      playTri(22, C.page), h('span', { text: 'PLAY' }),
    ]);
    card.appendChild(play);

    // the cursor from S4 stays on top, drifting right, and fades as the card comes up
    E.cur = makeCursor();
    all.appendChild(E.cur);
  }

  function render(lf, f) {
    E.map.render(f, `blur(${mapBlur(f).toFixed(2)}px) brightness(${mapDim(f).toFixed(3)})`);

    const top = cardTop(f), v = Math.abs(speed(cardTop, f));
    E.card.style.transform = `translateY(${top.toFixed(2)}px) scale(${shrink(f).toFixed(5)})`;
    const rb = cardBlur(f), sm = Math.max(0, v - 8) * 0.06;
    E.cardBlur.set(E.card, rb, rb + sm);

    const op = kf(f, [[187, 1], [191, 0]], ease.inQuad);
    if (op > 0) {
      E.cur.style.display = 'block';
      E.cur.place(NIGHT.curX(f), NIGHT.curY(f), -90, 1, [speed(NIGHT.curX, f), speed(NIGHT.curY, f)], op);
    } else E.cur.style.display = 'none';

    E.all.style.filter = blur(frameBlur(f));
  }

  shot('S5', 187, 214, build, render);
})();
