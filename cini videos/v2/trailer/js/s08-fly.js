// S8 · "Or fly." (beats 56-64). The real `fly nyc` trip (core/tools/fly.py): drive to MIA, the
// phone goes offline in airplane mode, the spoof reappears at JFK, then drives in. Drawn as the
// Leap itself: hollow ring on Miami, the arc up the coast while the phone is dark, the landing dot
// on JFK. Then down into New York and the drive to The Plaza, ending on the app's ARRIVED toast.
'use strict';

shot({
  name: 'fly', b0: 56, b1: 64, z: 70,
  build(el) {
    uiCss();
    const ny = LIB.cities['New York'], mi = LIB.cities.Miami;
    this.A = mi.airportInfo.at; this.B = ny.airportInfo.at;
    this.world = h('div', { class: 'layer' });
    el.appendChild(this.world);
    // coast view: both airports in frame, a little east for the arc's swing over the water
    const fit = this.fit = fitBox([[23.6, -84.6], [42.6, -64.0]], { x: 560, y: 110, w: 1260, h: 880 }, 10);
    this.base = s('svg', { width: W, height: H, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } });
    this.base.appendChild(worldGroup(fit, { pal: { water: '#07080c', land: '#1b1d26', coast: '#3d4457', border: '#2a2f42' }, lineScale: 1.5 }));
    // New York detail for the dive, faded in near the bottom of the zoom. Drawn in its own fit
    // (the one the dive ends on) and mapped into the coast view by one transform, so the 0.1 px
    // path rounding happens at street scale, not at 2 km a pixel.
    const r = this.r = LIB.routes['jfk-to-the-plaza'];
    const nyFit = this.nyFit = fitBox(r.line, { x: 560, y: 140, w: 1200, h: 820 }, 60);
    const kr = fit.k / nyFit.k;
    this.nyG = s('g', { transform: `translate(${fit.tx} ${fit.ty}) scale(${kr}) translate(${-nyFit.tx} ${-nyFit.ty})` });
    this.nyMap = mapGroup('nyc', nyFit, { lineScale: 1.2, counties: false, rect: [-4 * W, -4 * H, 9 * W, 9 * H], pal: { water: '#0a0d16', ground: '#121318', coast: '#272b38', park: '#141a18', road: '#20242f', road2: '#2c3141' } });
    this.nyG.appendChild(this.nyMap);
    this.rg = routeGroup(routeGeom(nyFit, r.line), ny.color, 5, 18, 0.25);
    this.nyG.appendChild(this.rg);
    const pe = r.line[r.line.length - 1], pp = project(nyFit, pe[0], pe[1]);
    this.plaza = s('circle', { cx: f2(pp[0]), cy: f2(pp[1]), r: 0, fill: ny.color });
    this.nyG.appendChild(this.plaza);
    this.base.appendChild(this.nyG);

    // the flight: the Leap's ring, arc and dot, at the mark's own proportions
    const a = this.a = project(fit, this.A[0], this.A[1]), b = this.b = project(fit, this.B[0], this.B[1]);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // the mark's arc spans 40.84 degrees: same circle, bowing east over the Atlantic
    const sweep = 40.84 * DEG, R = d / (2 * Math.sin(sweep / 2));
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nx = (b[1] - a[1]) / d, ny_ = -(b[0] - a[0]) / d;
    const off = R * Math.cos(sweep / 2);
    this.arcC = [mx - nx * off, my - ny_ * off];
    this.arcR = R;
    const w = this.unit = 0.9; // px per Leap unit at this scale
    this.flight = s('path', { d: `M${f2(a[0])} ${f2(a[1])}A${f2(R)} ${f2(R)} 0 0 1 ${f2(b[0])} ${f2(b[1])}`, fill: 'none', stroke: C.accent, 'stroke-width': LEAP.arcW * w, 'stroke-linecap': 'round' });
    this.flightLen = R * sweep;
    this.ringA = s('circle', { cx: f2(a[0]), cy: f2(a[1]), r: LEAP.ringR * w, fill: 'none', stroke: C.accent, 'stroke-width': LEAP.ringW * w });
    this.dotB = s('circle', { cx: f2(b[0]), cy: f2(b[1]), r: LEAP.dotR * w, fill: C.accent });
    this.ping = s('circle', { cx: f2(b[0]), cy: f2(b[1]), r: 10, fill: 'none', stroke: C.accent, 'stroke-width': 3 });
    this.base.appendChild(this.flight); this.base.appendChild(this.ringA); this.base.appendChild(this.dotB); this.base.appendChild(this.ping);
    const lab = (txt, p, dx, dy) => h('div', { class: 'abs mono', text: txt, style: { left: px(p[0] + dx), top: px(p[1] + dy), font: '500 26px "JetBrains Mono"', color: C.body, letterSpacing: '0.04em' } });
    this.labA = lab('MIA', a, 44, -16); this.labB = lab('JFK', b, 50, -16);
    this.world.appendChild(this.base);
    this.world.appendChild(this.labA); this.world.appendChild(this.labB);

    // the trip's own output, in a terminal
    const term = h('div', { class: 'wp', style: { width: '660px', padding: '18px 22px 20px', background: 'rgba(12,14,19,.94)', border: '1px solid #1e2230', borderRadius: '14px',
      font: '500 13px/1.75 "JetBrains Mono"', color: '#9aa4b2', boxShadow: '0 30px 80px rgba(0,0,0,.6)', whiteSpace: 'pre' } });
    const ln = (html, color) => { const l = h('div', { html, style: { color } }); term.appendChild(l); return l; };
    this.tl = [
      ln('<span style="color:#b49aff">$</span> fly nyc', '#dbe3ea'),
      ln('  vida-360 flight: Miami -> New York City', '#6b7280'),
      ln('> [1/3] Driving to the departure airport...', '#9aa4b2'),
      ln('> [2/3] Phone offline (airplane mode).', '#e3b341'),
      ln('        Moving the spoof to the arrival airport...', '#9aa4b2'),
      ln('> [3/3] Reconnected at the arrival airport.', '#7ee787'),
      ln('        Driving in (jfk-to-the-plaza)...', '#9aa4b2'),
    ];
    this.term = h('div', { class: 'abs', style: { transformOrigin: '0 0' } }, [term]);
    this.world.appendChild(this.term);

    const type = { position: 'absolute', font: '600 150px/0.98 Inter', letterSpacing: '-0.045em', color: C.text };
    this.l1 = riseLine('Or fly.', { ...type, left: '92px', top: '120px' });
    this.world.appendChild(this.l1);
    this.toast = uiToast('ARRIVED · The Plaza');
    this.toast.style.zoom = '2.2';
    el.appendChild(this.toast);
    this.mb = dirBlur(0.2);
  },
  render(lb, t) {
    const K = TL.K, off = K.offline - 56, on = K.online - 56, arr = K.arrive2 - 56;
    // the dive's zoom first: the flight marks are sized against it
    const dive = ease.inOutCubic(prog(lb, on + 0.25, arr - 0.2));
    const zoom = Math.exp(lerp(0, Math.log(this.nyFit.k / this.fit.k), dive));
    // ---- the flight ----
    const ringT = ease.outCubic(prog(lb, 0.2, 1.2));
    this.ringA.setAttribute('stroke-dasharray', `${f2(TAU * LEAP.ringR * this.unit * ringT)} 999`);
    this.ringA.setAttribute('transform', `rotate(-90 ${f2(this.a[0])} ${f2(this.a[1])})`);
    const fl = ease.inOutSine(prog(lb, off, on - 0.1));
    // offline: the arc is dashed (the phone isn't reporting), solid once it lands
    const L = this.flightLen;
    const landed = lb >= on - 0.1;
    if (landed) this.flight.setAttribute('stroke-dasharray', `${f2(L + 1)} ${f2(L + 60)}`);
    else {
      // dashes of the arc's own width with gaps, drawn up to the head
      const dash = LEAP.arcW * this.unit * 0.01, gap = LEAP.arcW * this.unit * 1.2;
      const n = Math.floor((L * fl) / (dash + gap));
      let arr2 = '';
      for (let i = 0; i < n; i++) arr2 += `${f2(dash)} ${f2(gap)} `;
      const rem = L * fl - n * (dash + gap);
      arr2 += `${f2(Math.min(dash, rem))} ${f2(L * 2)}`;
      this.flight.setAttribute('stroke-dasharray', fl > 0 ? arr2 : `0 ${f2(L * 2)}`);
    }
    const land = lb - on;
    this.dotB.setAttribute('r', f2(LEAP.dotR * this.unit * (land > 0 ? spring(land, 1.5, 0.38) : 0) / Math.pow(zoom, 0.92)));
    const pp = prog(lb, on, on + 1.6);
    this.ping.setAttribute('r', f2(LEAP.dotR * this.unit * lerp(1, 3, ease.outCubic(pp))));
    this.ping.setAttribute('opacity', pp > 0 && pp < 1 ? f2(0.6 * (1 - pp)) : 0);
    op(this.labA, ease.outCubic(prog(lb, 0.5, 1.3)));
    op(this.labB, ease.outCubic(prog(lb, on, on + 0.6)));

    // ---- camera: hold on the coast, then dive into New York ----
    const r = this.r, pe = r.line[r.line.length - 1];
    // the dive ends exactly on the city layer's own fit (scale 1, the route framed right of centre)
    const nyFit = this.nyFit;
    const c0 = [W / 2, H / 2];
    // the stage point that ends up at (1160, 550): where that pixel of the city fit sits in the coast fit
    const [elat, elon] = unproject(nyFit, 1160, 550);
    const c1 = project(this.fit, elat, elon);
    let fx = lerp(c0[0], c1[0], ease.inOutCubic(prog(dive, 0, 0.6))), fy = lerp(c0[1], c1[1], ease.inOutCubic(prog(dive, 0, 0.6)));
    const sx = lerp(W / 2, 1160, dive), sy = lerp(H / 2, 550, dive);
    // the opening: still down in Miami where S7 left us, pulling out to the whole coast
    const io = ease.outExpo(prog(lb, -LEADB, 1.25));
    let zoomV = zoom;
    if (io < 1) {
      const mia = project(this.fit, 25.80, -80.20);
      zoomV = Math.exp(lerp(Math.log(22), 0, io));
      fx = lerp(mia[0], c0[0], io); fy = lerp(mia[1], c0[1], io);
    }
    css(this.base, 'transformOrigin', '0 0');
    css(this.base, 'transform', `translate(${f2(sx)}px, ${f2(sy)}px) scale(${zoomV.toFixed(5)}) translate(${f2(-fx)}px, ${f2(-fy)}px)`);
    css(this.base, 'filter', blurCss((1 - io) * 9));
    const lw = 1 / zoom; // keep the flight strokes from ballooning
    this.flight.setAttribute('stroke-width', f2(LEAP.arcW * this.unit * Math.max(lw, 0.02)));
    op(this.flight, 1 - ease.inCubic(prog(dive, 0.2, 0.6)));
    op(this.ringA, 1 - ease.inCubic(prog(dive, 0.2, 0.6)));
    op(this.dotB, 1 - ease.inCubic(prog(dive, 0.5, 0.85)));
    op(this.nyG, ease.inOutCubic(prog(dive, 0.55, 0.95)));
    for (const l of [this.labA, this.labB]) {
      const p = project(this.fit, ...(l === this.labA ? this.A : this.B));
      const qx = (p[0] - fx) * zoomV + sx, qy = (p[1] - fy) * zoomV + sy;
      css(l, 'transform', `translate(${f2(qx - p[0])}px, ${f2(qy - p[1])}px)`);
      if (dive > 0.3) op(l, 1 - prog(dive, 0.3, 0.5));
    }
    // the drive in, once we're down
    const drv = ease.inOutCubic(prog(lb, on + 1.0, arr - 0.05));
    this.rg.draw(drv);
    this.plaza.setAttribute('r', f2(lb >= arr - 0.1 ? 10 * spring(lb - arr + 0.1, 2, 0.4) : 0));
    this.mb.set(this.base, 0, 0);

    // ---- terminal ----
    const shows = [0.15, 0.35, 0.6, off, off + 0.25, on, on + 0.3];
    this.tl.forEach((l, i) => { const p = clamp((lb - shows[i]) / 0.15); op(l, p); });
    css(this.term, 'transform', `translate(96px, 590px) scale(1.62)`);
    op(this.term, ease.outCubic(prog(lb, 0, 0.6)) * (1 - ease.inCubic(prog(lb, arr - 0.6, arr + 0.2))));

    // ---- headline ----
    const p1 = ease.outQuart(prog(lb, 0.25, 1.3));
    this.l1.set(p1, (1 - p1) * 12); op(this.l1, p1 > 0 ? 1 - ease.inCubic(prog(lb, on + 0.4, on + 1.4)) : 0);

    // ---- toast ----
    const tp = ease.outBack(clamp((lb - arr) / 0.6), 2.2);
    show(this.toast, lb >= arr);
    css(this.toast, 'left', px((W / 2) / 2.2 - this.toast.offsetWidth / 2));
    css(this.toast, 'top', px((H - 180) / 2.2 + (1 - tp) * 16));
    op(this.toast, clamp((lb - arr) / 0.3));
    void t;
  },
});
