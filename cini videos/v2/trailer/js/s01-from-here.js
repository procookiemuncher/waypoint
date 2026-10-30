// S1 · "From here to anywhere." (beats 0-8). Cold open in the letterbox: the Leap builds itself at
// monumental scale, the camera riding its arc from the hollow ring to the landing dot. Then the dot
// swells and hollows into a ring whose hole opens on S2.
'use strict';

shot({
  name: 'from-here', b0: 0, b1: 8, z: 20,
  build(el) {
    const K = TL.K;
    this.bg = dithered(W, H, (x, y, o) => {
      const d = Math.hypot((x - W * 0.45) / W, (y - H * 0.55) / H);
      const v = 1 - smoothstep(0, 0.75, d);
      o[0] = lerp(5, 13, v); o[1] = lerp(6, 11, v); o[2] = lerp(9, 20, v);
    }, 0.018, 21, 2);
    el.appendChild(this.bg);
    this.world = h('div', { class: 'layer' });
    el.appendChild(this.world);

    // the mark: ring centre at world (0,0), k px per Leap unit
    const k = this.k = 4.1;
    this.svg = s('svg', { width: 10, height: 10, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } });
    this.leap = makeLeap(C.accent);
    this.leap.setAttribute('transform', `scale(${k}) translate(${-LEAP.ring[0]} ${-LEAP.ring[1]})`);
    this.ping = s('circle', { cx: 0, cy: 0, r: 10, fill: 'none', stroke: C.accent, 'stroke-width': 3 });
    this.svg.appendChild(this.leap);
    this.svg.appendChild(this.ping);
    this.world.appendChild(this.svg);
    this.dotW = [(LEAP.dot[0] - LEAP.ring[0]) * k, (LEAP.dot[1] - LEAP.ring[1]) * k];

    const type = { position: 'absolute', font: '600 156px/0.95 Inter', letterSpacing: '-0.045em', color: C.text, whiteSpace: 'pre' };
    this.from = words('From here', { ...type, left: px(32 * k + 64), top: '-74px' });
    this.any = words('to anywhere.', { ...type, left: px(this.dotW[0] + 34 * k + 64), top: px(this.dotW[1] - 74) });
    for (const wd of [...this.from.w, ...this.any.w]) wd.style.willChange = 'transform';
    this.world.appendChild(this.from);
    this.world.appendChild(this.any);
    this.mb = dirBlur(0.3);
    this.K = K;
  },
  render(lb, t) {
    const K = this.K, k = this.k;
    // ---- the mark builds ----
    const ringT = ease.outCubic(prog(lb, K.ringIn, K.ringIn + 1.4));
    const arcT = ease.inOutCubic(prog(lb, K.arcGo, K.dotLand - 0.35));
    const land = lb - (K.dotLand - 0.18);
    const dotS = land <= 0 ? 0 : spring(land, 1.25, 0.38);
    this.leap.set(ringT, arcT, dotS, { ringSpin: lerp(-140, 0, ringT) });
    // landing ping: a thin ring off the dot
    const pp = prog(lb, K.dotLand - 0.05, K.dotLand + 1.6);
    const [dx, dy] = this.dotW;
    this.ping.setAttribute('cx', dx); this.ping.setAttribute('cy', dy);
    this.ping.setAttribute('r', f2(34 * k * lerp(1.0, 2.3, ease.outCubic(pp))));
    this.ping.setAttribute('stroke-width', f2(lerp(5, 0.5, pp)));
    this.ping.setAttribute('opacity', pp > 0 && pp < 1 ? f2(0.55 * (1 - pp)) : 0);

    // ---- camera: hold on the ring, ride the arc, settle on the dot ----
    const travel = (b) => {
      const u = spline(b, [[K.arcGo - 0.4, 0], [K.arcGo + 0.6, 0.06], [K.dotLand - 1.2, 0.8], [K.dotLand - 0.1, 1.0]], { v0: 0, v1: 0 });
      return u;
    };
    const u = travel(lb);
    const A = [420, 14], B = [this.dotW[0] + 520, this.dotW[1] + 10];
    // follow the arc's curve, not a straight line: bend the path through the arc's mid point
    const mid = LEAP.at(0.55).map((v, i) => (v - LEAP.ring[i]) * k);
    let bx = (1 - u) ** 2 * A[0] + 2 * (1 - u) * u * (mid[0] + 330) + u * u * B[0];
    let by = (1 - u) ** 2 * A[1] + 2 * (1 - u) * u * (mid[1] + 40) + u * u * B[1];
    // a slow push while we travel; roll leans into the climb
    let zoom = lerp(0.96, 1.06, clamp(lb / 6));
    const roll = -2.2 * Math.sin(Math.PI * clamp(u));
    // after the landing the camera pulls back to the whole line: ring + "From here" low left,
    // dot + "to anywhere." high right, the mark between them (the frame the iris opens from)
    const back = ease.inOutCubic(prog(lb, K.dotLand + 0.25, K.irisOpen + 0.1));
    if (back > 0) {
      const card = this._card || (this._card = (() => {
        const fw = this.from.getBoundingClientRect ? this.from.scrollWidth : 760, aw = this.any.scrollWidth;
        const x0 = -34 * k, x1 = this.dotW[0] + 34 * k + 64 + aw;
        const y0 = this.dotW[1] - 34 * k, y1 = 34 * k;
        void fw;
        return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, z: Math.min(W * 0.86 / (x1 - x0), (H - 276) * 0.9 / (y1 - y0)) };
      })());
      bx = lerp(bx, card.cx, back); by = lerp(by, card.cy, back);
      zoom = lerp(zoom, card.z, back);
    }
    // impact shake on the landing, decaying
    const sh = land > 0 && land < 0.8 ? Math.exp(-6 * land) * 7 : 0;
    const shx = sh * vnoise(t * 40, 3), shy = sh * vnoise(t * 40, 4);
    camera(this.world, bx + shx, by + shy, zoom, roll);
    // motion blur along the travel
    const vx = rate(b => spline(b, [[K.arcGo - 0.4, 0], [K.arcGo + 0.6, 0.06], [K.dotLand - 1.2, 0.8], [K.dotLand - 0.1, 1.0]], { v0: 0, v1: 0 }), lb);
    const speedPx = perFrame(vx * Math.hypot(B[0] - A[0], B[1] - A[1]) * zoom);
    const ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
    this.mb.set(this.world, Math.abs(Math.cos(ang)) * speedPx * 0.35, Math.abs(Math.sin(ang)) * speedPx * 0.35);

    // ---- type ----
    this.from.w.forEach((wd, i) => {
      const p = ease.outQuart(prog(lb, K.fromHere + i * 0.22, K.fromHere + i * 0.22 + 1.1));
      css(wd, 'transform', `translateY(${f2((1 - p) * 70)}px)`);
      op(wd, p);
      css(wd, 'filter', blurCss((1 - p) * 14));
    });
    this.any.w.forEach((wd, i) => {
      const p = ease.outQuart(prog(lb, K.anywhere + 0.05 + i * 0.2, K.anywhere + 0.05 + i * 0.2 + 1.0));
      css(wd, 'transform', `translateX(${f2((1 - p) * -60)}px)`);
      op(wd, p);
      css(wd, 'filter', blurCss((1 - p) * 16));
    });

    // ---- the dot swells and hollows into a ring that opens S2 ----
    const ip = prog(lb, K.irisOpen, 8 - LEADB);
    if (ip > 0) {
      const sw = ease.inCubic(ip);
      const scale = 1 + sw * 24;
      this.leap.set(1, 1, dotS * scale);
      // the dot's centre on screen (camera maths, no shake by then)
      const cx = W / 2 + ((dx - bx) * Math.cos(roll * DEG) - (dy - by) * Math.sin(roll * DEG)) * zoom;
      const cy = H / 2 + ((dx - bx) * Math.sin(roll * DEG) + (dy - by) * Math.cos(roll * DEG)) * zoom;
      const R = 34 * k * zoom * dotS * scale;
      const hole = R * kf(ip, [[0, 0], [0.35, 0.44], [1, 0.97]], ease.inOutQuad);
      const m = `radial-gradient(circle at ${f2(cx)}px ${f2(cy)}px, transparent ${f2(hole)}px, #000 ${f2(hole + 1)}px)`;
      css(this.el, 'webkitMaskImage', m);
      css(this.el, 'maskImage', m);
    } else {
      css(this.el, 'webkitMaskImage', '');
      css(this.el, 'maskImage', '');
    }
  },
});
