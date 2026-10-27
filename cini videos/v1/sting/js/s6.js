// S6 f215-244: two stacked destination cards, Miami and St-Tropez. Covers are dark stylised maps
// of each city with its route in the city colour (no text baked in); the giant titles are
// frosted glass: a blurred, lightened copy of the cover clipped to the letters, cut off by the
// card's bottom edge.
'use strict';

(() => {
  const CW = 538, CH = 348, GAP = 36, X0 = 540 - CW / 2;
  const CARDS = [
    { title: 'Miami', spots: '3 spots', color: C.mia, region: 'mia', route: 'mia-to-faena-miami', box: { x: 50, y: 96, w: 438, h: 120 } },
    { title: 'St-Tropez', spots: '2 spots', color: C.stt, region: 'stt', route: 'cheval-blanc-st-tropez-to-club-55', box: { x: 200, y: 64, w: 138, h: 196 } },
  ];

  const topY = f => {
    if (f <= 230) return spline(f, [[215, 264], [218, 212], [221, 189], [224, 177.5], [227, 171], [230, 168]], { v1: -3 });
    if (f <= 238) return 168 - 3 * (f - 230);
    return 144 - 3 * (f - 238) - 0.33 * (f - 238) ** 3;
  };
  const botY = f => topY(f) + CH + GAP + approach(f, 215, 927 - 264 - CH - GAP, 0, 0.3);
  const topScale = f => approach(f, 215, 1.08, 1, 0.2);
  const inBlur = f => kf(f, [[215, 12], [224, 0]], ease.outCubic);
  const outBlur = f => kf(f, [[238, 0], [244.5, 6]], ease.inQuad);

  let E = {};
  let _n = 0;
  function card(spec) {
    const id = 'dc' + _n++;
    const wrap = h('div', { class: 'abs', style: { left: px(X0), width: px(CW), height: px(CH), transformOrigin: `${CW / 2}px ${CH / 2}px` } });
    const body = h('div', { class: 'abs', style: { width: px(CW), height: px(CH), borderRadius: '57px', overflow: 'hidden', background: C.water, boxShadow: '0 40px 90px rgba(0,0,0,.6)' } });
    wrap.appendChild(body);

    const fit = fitPoints(spec.region, ROUTES[spec.route].points, spec.box);
    const svg = s('svg', { width: CW, height: CH, class: 'abs', style: { display: 'block' } });
    body.appendChild(svg);
    const cover = s('g', { id: id + '-cover' }, [mapGroup(fit, { lineScale: 0.85, waterRect: [0, 0, CW, CH] })]);
    const rg = routeGroup(fit, spec.route, spec.color, 4.5, 14, 0.2);
    cover.appendChild(rg);
    const pts = ROUTES[spec.route].points;
    const [ax, ay] = project(fit, pts[0][0], pts[0][1]);
    const [bx, by] = project(fit, pts[pts.length - 1][0], pts[pts.length - 1][1]);
    cover.appendChild(s('circle', { cx: ax, cy: ay, r: 5, fill: spec.color, stroke: C.page, 'stroke-width': 2 }));
    cover.appendChild(s('circle', { cx: bx, cy: by, r: 8, fill: spec.color, stroke: C.page, 'stroke-width': 2 }));
    cover.appendChild(s('circle', { cx: bx, cy: by, r: 3, fill: '#fff' }));

    // title size: St-Tropez fits the card, Miami uses the same size
    const size = E.titleSize;
    const baseline = CH + size * 0.13;
    const text = (attrs) => s('text', { x: 30, y: baseline, 'font-family': 'Inter', 'font-weight': 700, 'font-size': size, 'letter-spacing': `${-0.035 * size}`, ...attrs, text: spec.title });
    const defs = s('defs', {}, [
      s('clipPath', { id: id + '-t' }, [text({})]),
      s('filter', { id: id + '-frost', x: '-10%', y: '-10%', width: '120%', height: '120%', 'color-interpolation-filters': 'sRGB' }, [
        s('feGaussianBlur', { stdDeviation: 9 }),
        s('feComponentTransfer', {}, ['R', 'G', 'B'].map(c => s('feFunc' + c, { type: 'linear', slope: 2.7, intercept: 0.13 }))),
      ]),
      s('linearGradient', { id: id + '-shade', x1: 0, y1: 0, x2: 0, y2: 1 }, [
        s('stop', { offset: 0.45, 'stop-color': C.page, 'stop-opacity': 0 }),
        s('stop', { offset: 1, 'stop-color': C.page, 'stop-opacity': 0.55 }),
      ]),
      // glass edge from the filled letters' alpha: a thin inner ring plus a brighter top lip.
      // Stroking the text instead would trace Inter's overlapping contours inside S and z.
      s('filter', { id: id + '-edge', x: '-5%', y: '-5%', width: '110%', height: '110%', 'color-interpolation-filters': 'sRGB' }, [
        s('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: 1.2, result: 'in' }),
        s('feComposite', { in: 'SourceAlpha', in2: 'in', operator: 'out', result: 'ring' }),
        s('feOffset', { in: 'SourceAlpha', dy: 2, result: 'down' }),
        s('feComposite', { in: 'SourceAlpha', in2: 'down', operator: 'out', result: 'lip' }),
        s('feFlood', { 'flood-color': '#fff', 'flood-opacity': 0.26 }),
        s('feComposite', { in2: 'ring', operator: 'in', result: 'ringC' }),
        s('feFlood', { 'flood-color': '#fff', 'flood-opacity': 0.34 }),
        s('feComposite', { in2: 'lip', operator: 'in', result: 'lipC' }),
        s('feMerge', {}, [s('feMergeNode', { in: 'ringC' }), s('feMergeNode', { in: 'lipC' })]),
      ]),
    ]);
    svg.appendChild(defs);
    svg.appendChild(cover);
    svg.appendChild(s('rect', { width: CW, height: CH, fill: `url(#${id}-shade)` }));
    svg.appendChild(s('g', { 'clip-path': `url(#${id}-t)` }, [
      s('use', { href: `#${id}-cover`, filter: `url(#${id}-frost)` }),
      s('rect', { width: CW, height: CH, fill: '#fff', opacity: 0.1 }),
    ]));
    svg.appendChild(text({ fill: '#fff', filter: `url(#${id}-edge)` }));

    // frosted pill and the round menu button
    const glass = { background: 'rgba(10,11,15,.42)', backdropFilter: 'blur(14px) brightness(1.12)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.09), inset 0 1px 0 rgba(255,255,255,.12)' };
    body.appendChild(h('div', { class: 'abs nowrap', style: { left: '26px', top: '26px', height: '44px', padding: '0 18px 0 16px', borderRadius: '22px', display: 'flex', alignItems: 'center', gap: '9px', font: '600 19px Inter', color: C.text, ...glass } }, [
      h('div', { style: { width: '8px', height: '8px', borderRadius: '4px', background: spec.color } }),
      h('span', { text: spec.spots }),
    ]));
    body.appendChild(h('div', { class: 'abs', style: { left: px(CW - 26 - 44), top: '26px', width: '44px', height: '44px', borderRadius: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', ...glass } },
      [0, 1, 2].map(() => h('div', { style: { width: '5px', height: '5px', borderRadius: '2.5px', background: C.text } }))));
    // hairline edge on top of everything
    body.appendChild(h('div', { class: 'abs', style: { width: px(CW), height: px(CH), borderRadius: '57px', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' } }));
    return { wrap, smear: dirBlur(0.3) };
  }

  function build(root) {
    // one title size for both cards, the longest title fits the card with a 30 px margin
    const sp = -0.035;
    const w100 = textW('St-Tropez', '700 100px Inter', sp * 100);
    E.titleSize = Math.floor(100 * (CW - 60) / w100);
    E.cards = CARDS.map(card);
    // bottom card first so the top card sits above it
    root.appendChild(E.cards[1].wrap);
    root.appendChild(E.cards[0].wrap);
  }

  function render(lf, f) {
    const [top, bot] = E.cards;
    const ty = topY(f), by = botY(f);
    top.wrap.style.top = px(0);
    top.wrap.style.transform = `translateY(${ty.toFixed(2)}px) scale(${topScale(f).toFixed(5)})`;
    bot.wrap.style.top = px(0);
    bot.wrap.style.transform = `translateY(${by.toFixed(2)}px)`;
    for (const [c, yf] of [[top, topY], [bot, botY]]) {
      const v = Math.abs(speed(yf, f));
      const round = inBlur(f) + outBlur(f);
      const smear = f > 236 ? Math.max(0, v - 4) * 0.24 : Math.max(0, v - 6) * 0.08;
      if (smear > 0.05) c.smear.set(c.wrap, round, round + smear);
      else c.wrap.style.filter = blur(round);
    }
  }

  shot('S6', 215, 244, build, render);
})();
