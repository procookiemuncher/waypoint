// S4 f159-186: the whip-tilt lands in the night map through a lavender flash. The map arrives
// 420 px low and smeared, scrolls into place while the route draws itself from JFK T4 to The
// Plaza, and a cursor pointing straight up rides the scroll and stops under The Plaza.
'use strict';

// The night map, also used by S5, where it keeps creeping under the hero card. One Web Mercator
// fit for the whole sequence, north up: least squares on the brief's anchors, JFK T4 at
// (820,860) and The Plaza at (330,560).
const NIGHT = (() => {
  const ROUTE = 'jfk-to-the-plaza';
  // how far below its resting place the map is drawn: the brief's table, then the creep, which
  // runs on slowly under S5 (nothing but S7 may freeze)
  const OFF = [[159, 420], [160, 315], [161, 210], [162, 170], [163, 140], [164, 116], [165, 96], [166, 81],
    [167, 66.6], [168, 54.8], [169, 45.1], [170, 37.1], [171, 30.5], [172, 25.1], [173, 20.7], [174, 17], [175, 14],
    [176, 11.1], [177, 8.2], [178, 5.4], [179, 2.7], [180, 0], [181, -1.6], [182, -2.8], [183, -3.8], [184, -4.6],
    [185, -5.3], [186, -6], [214, -20]];
  const offset = f => spline(f, OFF, { v0: -105, v1: -0.5, extend: true });
  // 24 px along the motion on f159 (16 round + the speed smear), less across it, so Manhattan,
  // the Hudson and the label still read through the flash instead of a flat lavender frame
  const roundBlur = f => kf(f, [[159, 16], [165, 1.5], [168, 0]], [ease.outQuad, ease.outQuad]);
  const smearOf = v => Math.max(0, v - 3) * 0.08;
  const draw = f => 1 - Math.pow(1 - prog(f, 159, 180), 1.8);

  // the area the map has to cover: the stage, the 420 px it scrolls in from, blur margins
  const BOX = [-120, -560, 1320, 2200];
  let fit = null, start, end, label;
  function geometry() {
    if (fit) return;
    const pts = ROUTES[ROUTE].points;
    fit = fitAnchors('nyc', pts[0], [820, 860], pts[pts.length - 1], [330, 560]);
    start = project(fit, pts[0][0], pts[0][1]);
    end = project(fit, pts[pts.length - 1][0], pts[pts.length - 1][1]);
    // the cursor tip rests just under "The Plaza" (the brief's spot relative to the pin, nudged
    // up so the arrow sits between the label and the route line)
    label = [end[0] + 66, end[1] + 26];
  }

  // builds one copy of the map; returns { el, render(f) }
  function build() {
    geometry();
    const [bx, by, bw, bh] = BOX;
    const el = h('div', { class: 'abs', style: { left: px(bx), top: px(by), width: px(bw), height: px(bh) } });
    const svg = s('svg', { width: bw, height: bh, viewBox: `${bx} ${by} ${bw} ${bh}`, style: { display: 'block' } });
    el.appendChild(svg);
    svg.appendChild(mapGroup(fit, { lineScale: 1, waterRect: BOX }));
    const route = routeGroup(fit, ROUTE, C.accent, 6, 18, 0.18);
    svg.appendChild(route);

    const lab = (x, y, text, font, fill, anchor = 'start') => s('text', { x, y, fill, 'text-anchor': anchor, style: { font }, text });
    const at = (lat, lon) => project(fit, lat, lon);
    // place labels, muted, sitting on their areas
    const [qx, qy] = at(40.7215, -73.7905);
    svg.appendChild(lab(qx, qy, 'Queens', '500 26px Inter', C.muted, 'middle'));
    const [kx, ky] = at(40.6455, -73.9515);
    svg.appendChild(lab(kx, ky, 'Brooklyn', '500 26px Inter', C.muted, 'middle'));
    // Central Park is a 20 px sliver at this scale, so its label sits just west of it
    const [cx, cy] = at(40.7850, -73.9700);
    svg.appendChild(lab(cx - 26, cy + 9, 'Central Park', '500 26px Inter', C.muted, 'end'));

    // JFK T4: city-blue dot with a mono tag
    svg.appendChild(s('circle', { cx: start[0], cy: start[1], r: 8, fill: C.ny, stroke: C.page, 'stroke-width': 3 }));
    svg.appendChild(lab(start[0] + 18, start[1] + 26, 'JFK T4', '500 22px "JetBrains Mono"', C.body));
    // The Plaza: lavender pin with a white core, and the one bright label
    const ring = s('circle', { cx: end[0], cy: end[1], r: 11, fill: 'none', stroke: C.accent, 'stroke-width': 2, opacity: 0 });
    svg.appendChild(ring);
    svg.appendChild(s('circle', { cx: end[0], cy: end[1], r: 21, fill: rgba(C.accent, 0.14) }));
    svg.appendChild(s('circle', { cx: end[0], cy: end[1], r: 11, fill: C.accent, stroke: C.page, 'stroke-width': 2.5 }));
    svg.appendChild(s('circle', { cx: end[0], cy: end[1], r: 4, fill: '#fff' }));
    svg.appendChild(lab(end[0] + 24, end[1] + 11, 'The Plaza', '600 32px Inter', C.text));

    const smear = dirBlur(0.02);
    return {
      el,
      // extra: additional css filter for S5 (dim + blur behind the card)
      render(f, extra = null) {
        const o = offset(f);
        el.style.transform = `translateY(${o.toFixed(2)}px)`;
        route.draw(draw(f));
        // arrival ping on the pin as the line gets there
        const p = prog(f, 179, 192);
        ring.setAttribute('r', (11 + 26 * ease.outCubic(p)).toFixed(2));
        ring.setAttribute('opacity', f < 179 ? 0 : (0.3 * (1 - p)).toFixed(3));
        const v = Math.abs(speed(offset, f));
        const rb = roundBlur(f), sm = smearOf(v);
        if (extra) el.style.filter = extra;
        else if (sm > 0.05) smear.set(el, rb, rb + sm);
        else el.style.filter = blur(rb);
      },
    };
  }

  // the cursor: rides the scroll (fixed to the map) until it stops under the label at f180,
  // then drifts right
  const curY = f => {
    geometry();
    const w = f <= 179 ? 1 : f >= 181 ? 0 : 1 - smoothstep(179, 181, f);
    return label[1] + offset(f) * w;
  };
  const curX = f => {
    geometry();
    const t = Math.max(0, f - 180);
    return label[0] + 1.5 * (t - 2 * (1 - Math.exp(-t / 2)));
  };
  return { build, offset, curX, curY, roundBlur, smearOf };
})();

(() => {
  let E = {};
  function build(root) {
    E.map = NIGHT.build();
    root.appendChild(E.map.el);
    // the cursor sits in its own stage-sized layer so it can take the map's blur while it rides
    E.cur = makeCursor();
    E.curL = layer();
    E.curL.appendChild(E.cur);
    root.appendChild(E.curL);
    E.curBlur = dirBlur(0.02);
    E.flash = layer('', { background: C.accent, opacity: 0 });
    root.appendChild(E.flash);
  }

  function render(lf, f) {
    E.map.render(f);
    const x = NIGHT.curX(f), y = NIGHT.curY(f);
    const vx = speed(NIGHT.curX, f), vy = speed(NIGHT.curY, f), mv = speed(NIGHT.offset, f);
    // riding: the map's blur covers the motion, so its own smear only counts what's left over
    E.cur.place(x, y, -90, 1, [vx, f < 180 ? vy - mv : vy], 1);
    const rb = NIGHT.roundBlur(f), sm = NIGHT.smearOf(Math.abs(mv));
    if (f < 180 && sm > 0.05) E.curBlur.set(E.curL, rb, rb + sm);
    else E.curL.style.filter = blur(rb);
    E.flash.style.opacity = (0.30 * Math.pow(1 - prog(f, 159, 165), 2)).toFixed(4);
  }

  shot('S4', 159, 186, build, render);
})();
