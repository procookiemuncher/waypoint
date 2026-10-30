// the window border: the turning rainbow sitting right on the window edge, plus one brighter
// light (a comet) going round it in the same colours. drawn on a canvas so the light can take
// the rainbow's exact colour wherever it is.
(() => {
  // picked in the border playground (comet preset, then tuned)
  const S = {
    speed: 0.35,  // overall clock, scales the two below
    w: 4,         // ring thickness px
    R: 14,        // outer corner radius px
    m: 0,         // gap from the window edge px
    rot: 5,       // s per rainbow turn (at speed 1)
    lap: 13,      // s per light lap (at speed 1)
    tail: 12,     // % of the perimeter the tail covers
    lead: 1.5,    // % fade in front of the head
    light: 0.4,   // light brightness
    base: 0.55,   // rest of the ring
    glow: 16,     // bloom radius px
  };
  const RAINBOW = ['#b49aff', '#7a8cff', '#c47aff', '#ff7ab8', '#ffb37a', '#b8e67a', '#b49aff'];
  const RGB = RAINBOW.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // the ring only ever paints the outer ~35px (the head's flare is the widest thing), so instead of one
  // full-window canvas it's four strips round the edge. clearing and compositing a whole retina window
  // 30 times a second was most of what the ring cost. each strip draws the same scene in window
  // coordinates, shifted to its own corner, so the pixels come out the same as the one big canvas
  const BAND = 40;   // css px, > the flare's reach (G * 1.3 + w * 3 from a line 2px in)
  const host = document.getElementById('ring');
  const strips = ['top', 'bottom', 'left', 'right'].map(() => {
    const c = document.createElement('canvas'); host.appendChild(c);
    return { c, ctx: c.getContext('2d') };
  });
  let ctx = strips[0].ctx;   // the strip being drawn
  let W = 0, H = 0, dpr = 1, t = 0, last = performance.now();

  // ring centre line as a rounded rect, walked at constant speed so the light doesn't rush the corners
  let segs = [], L = 0, cx = 0, cy = 0;
  function geometry() {
    const { w, m, R } = S, P = Math.PI;
    const x0 = m + w / 2, y0 = m + w / 2, x1 = W - m - w / 2, y1 = H - m - w / 2, r = Math.max(R - w / 2, 0);
    cx = W / 2; cy = H / 2;
    segs = [
      { k:'l', ax:x0 + r, ay:y0, bx:x1 - r, by:y0 },
      { k:'a', cx:x1 - r, cy:y0 + r, a0:-P / 2 },
      { k:'l', ax:x1, ay:y0 + r, bx:x1, by:y1 - r },
      { k:'a', cx:x1 - r, cy:y1 - r, a0:0 },
      { k:'l', ax:x1 - r, ay:y1, bx:x0 + r, by:y1 },
      { k:'a', cx:x0 + r, cy:y1 - r, a0:P / 2 },
      { k:'l', ax:x0, ay:y1 - r, bx:x0, by:y0 + r },
      { k:'a', cx:x0 + r, cy:y0 + r, a0:P },
    ];
    L = 0;
    for (const g of segs) { g.r = r; g.len = g.k === 'l' ? Math.hypot(g.bx - g.ax, g.by - g.ay) : P / 2 * r; g.s0 = L; L += g.len; }
  }
  function at(s) {
    s = ((s % L) + L) % L;
    for (const g of segs) if (s <= g.s0 + g.len) {
      const u = g.len ? (s - g.s0) / g.len : 0;
      if (g.k === 'l') return [g.ax + (g.bx - g.ax) * u, g.ay + (g.by - g.ay) * u];
      const a = g.a0 + u * Math.PI / 2; return [g.cx + g.r * Math.cos(a), g.cy + g.r * Math.sin(a)];
    }
    return [segs[0].ax, segs[0].ay];
  }
  // [s0, s1] (perimeter distance, may run past L or below 0) cut where the ring's segments meet,
  // as [from, to, segment] pieces
  function pieces(s0, s1) {
    const out = [];
    for (let s = s0; s < s1 - 1e-6;) {
      const m = ((s % L) + L) % L, g = segs.find(g => m < g.s0 + g.len - 1e-9) || segs[segs.length - 1];
      const e = Math.min(s1, s - m + g.s0 + g.len);
      out.push([s, e, g]); s = e;
    }
    return out;
  }
  function ringPath() {
    ctx.beginPath();
    for (const g of segs) {
      if (g.k === 'l') { ctx.lineTo(g.ax, g.ay); ctx.lineTo(g.bx, g.by); }
      else if (g.r > 0) ctx.arc(g.cx, g.cy, g.r, g.a0, g.a0 + Math.PI / 2);
    }
    ctx.closePath();
  }

  // the colour the conic gradient paints at a point, for the bloom (which isn't a stroke)
  function uAt(x, y, rot) {
    const u = (Math.atan2(y - cy, x - cx) - rot) / (2 * Math.PI); return u - Math.floor(u);
  }
  function rainbow(u) {
    const f = u * 6, i = Math.min(Math.floor(f), 5), k = f - i, a = RGB[i], b = RGB[i + 1];
    return [0, 1, 2].map(j => Math.round(a[j] + (b[j] - a[j]) * k));
  }
  const colorAt = (x, y, rot) => rainbow(uAt(x, y, rot));

  // the bloom is ~100 soft dots a frame. making each one its own radial gradient was most of the
  // ring's cost, so each rainbow colour's dot is painted once here (at full strength) and stamped
  // with globalAlpha after. 96 colours round the rainbow is finer than a 16% glow can show
  const HUES = 96;
  let dots = [];
  function dot(u) {
    const k = Math.round(u * HUES) % HUES;
    if (dots[k]) return dots[k];
    const G = S.glow, n = Math.ceil(G * 2 * dpr), c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d'), [r, gr, bl] = rainbow(k / HUES), rg = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    rg.addColorStop(0, `rgba(${r},${gr},${bl},${.16 * S.light})`);
    rg.addColorStop(.4, `rgba(${r},${gr},${bl},${.06 * S.light})`);
    rg.addColorStop(1, `rgba(${r},${gr},${bl},0)`);
    g.fillStyle = rg; g.fillRect(0, 0, n, n);
    return dots[k] = c;
  }

  // one frame is worked out once as a list of [x0, y0, x1, y1, draw] (window px, the box the draw can
  // touch), then each strip replays the ones that reach it, in the same order
  function scene() {
    const w = S.w, rot = (t / (S.rot * 1000)) * 2 * Math.PI, ops = [];

    // the light, added on top of the ring so it brightens the colours already there
    const head = (t / (S.lap * 1000)) * L % L, tail = L * S.tail / 100, lead = L * S.lead / 100, Lt = S.light, G = S.glow;
    const fall = d => d >= 0 ? Math.pow(Math.max(1 - d / tail, 0), 1.7) : Math.pow(Math.max(1 + d / lead, 0), 2);   // d = px behind the head
    const box = (pts, m) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return [x0 - m, y0 - m, x1 + m, y1 + m];
    };

    // the tail fades along its length in the rainbow's own colours: a wide soft pass, the line, and
    // white-hot only right at the head. along a straight edge each pass is one stroke whose linear
    // gradient carries the colour and the fade (stops every 8px); the tiny corner arcs are short solid
    // chunks. it used to be ~60 chunks x 3 strokes every frame, which was nearly all of the ring's cpu
    const passes = [
      [f => Math.min(f * .45 * Lt, 1), w * 3.2, false],
      [f => Math.min(f * 1.1 * Lt, 1), w, false],
      [f => Math.min(Math.pow(f, 5) * .85 * Lt, 1), w * .75, true],
    ];
    const reach = w * 1.6 + 1;   // half the widest pass, plus a pixel of antialiasing
    for (const [s0, s1, g] of pieces(head - tail, head + lead)) {
      if (g.k === 'l') {
        const [ax, ay] = at(s0), [bx, by] = at(s1), n = Math.max(Math.ceil((s1 - s0) / 8), 1), stops = [];
        for (let j = 0; j <= n; j++) { const s = s0 + (s1 - s0) * j / n; stops.push([j / n, fall(head - s), colorAt(...at(s), rot)]); }
        ops.push([...box([[ax, ay], [bx, by]], reach), () => {
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
          for (const [alpha, lw, white] of passes) {
            if (white && !stops.some(([, f]) => alpha(f) > .01)) continue;
            const lg = ctx.createLinearGradient(ax, ay, bx, by);
            for (const [p, f, c] of stops) lg.addColorStop(p, `rgba(${white ? '255,255,255' : c},${alpha(f)})`);
            ctx.strokeStyle = lg; ctx.lineWidth = lw; ctx.stroke();
          }
        }]);
      } else {
        const n = Math.max(Math.ceil((s1 - s0) / 10), 1);
        for (let c = 0; c < n; c++) {
          const a = s0 + c * (s1 - s0) / n, b = s0 + (c + 1) * (s1 - s0) / n, f = fall(head - (a + b) / 2);
          if (f <= .002) continue;
          const pts = [at(a)];
          for (let s = a + 2; s < b; s += 2) pts.push(at(s));
          pts.push(at(b));   // end exactly where the next piece starts, no gap
          const col = `rgb(${colorAt(...at((a + b) / 2), rot)})`;
          ops.push([...box(pts, reach), () => {
            ctx.beginPath(); ctx.moveTo(...pts[0]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(...pts[i]);
            for (const [alpha, lw, white] of passes) {
              if (white && alpha(f) <= .01) continue;
              ctx.strokeStyle = white ? '#fff' : col; ctx.globalAlpha = alpha(f); ctx.lineWidth = lw; ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }]);
        }
      }
    }

    // bloom spilling off the line, plus a flare at the head
    if (G > 0) {
      for (let d = -lead; d <= tail; d += Math.max(G / 3, 4)) {
        const f = fall(d); if (f < .02) continue;
        const [x, y] = at(head - d), img = dot(uAt(x, y, rot));
        ops.push([x - G, y - G, x + G, y + G, () => { ctx.globalAlpha = f; ctx.drawImage(img, x - G, y - G, G * 2, G * 2); ctx.globalAlpha = 1; }]);
      }
      const [x, y] = at(head), [r, g, bl] = colorAt(x, y, rot), F = G * 1.3 + w * 3;
      ops.push([x - F, y - F, x + F, y + F, () => {
        const rg = ctx.createRadialGradient(x, y, 0, x, y, F);
        rg.addColorStop(0, `rgba(255,255,255,${.5 * Lt})`);
        rg.addColorStop(.12, `rgba(${r},${g},${bl},${.35 * Lt})`);
        rg.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = rg; ctx.fillRect(x - F, y - F, F * 2, F * 2);
      }]);
    }
    return { rot, ops };
  }

  function draw() {
    const { rot, ops } = scene(), w = S.w;
    for (const st of strips) {
      if (!st.w || !st.h) continue;
      ctx = st.ctx;
      // window coordinates, moved so this strip's corner is the canvas origin
      ctx.setTransform(dpr, 0, 0, dpr, -st.dx, -st.dy);
      ctx.clearRect(st.x0, st.y0, st.x1 - st.x0, st.y1 - st.y0);
      ctx.lineJoin = 'round';

      // the rainbow ring, with a little soft glow under it
      const grad = ctx.createConicGradient(rot, cx, cy);
      RAINBOW.forEach((c, i) => grad.addColorStop(i / 6, c));
      ctx.globalCompositeOperation = 'source-over';
      ringPath(); ctx.strokeStyle = grad;
      ctx.globalAlpha = S.base * .18; ctx.lineWidth = w * 4; ctx.stroke();
      ctx.globalAlpha = S.base;       ctx.lineWidth = w;     ctx.stroke();

      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 1;   // the fade is in the gradients (straight) or set per chunk (corners)
      for (const [x0, y0, x1, y1, fn] of ops)
        if (x1 > st.x0 && x0 < st.x1 && y1 > st.y0 && y0 < st.y1) fn();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
  }

  function resize() {
    W = innerWidth; H = innerHeight; dpr = devicePixelRatio || 1; dots = [];
    // in device px, so the seams land on whole pixels: top and bottom run the full width, the
    // sides fill in between them (no overlap, or the corners would be drawn twice). every strip
    // starts on a multiple of 8 so the gradients' dither noise lines up with the one-canvas version
    const Wd = Math.round(W * dpr), Hd = Math.round(H * dpr), snap = v => Math.floor(v / 8) * 8;
    const B = Math.ceil(BAND * dpr / 8) * 8;
    const yb = Math.max(snap(Hd - B), B), xr = Math.max(snap(Wd - B), B);   // bottom / right strip origins
    const rects = [[0, 0, Wd, Math.min(B, Hd)], [0, yb, Wd, Hd - yb], [0, B, Math.min(B, Wd), yb - B], [xr, B, Wd - xr, yb - B]];
    strips.forEach((st, i) => {
      const [x, y] = rects[i], w = Math.max(rects[i][2], 0), h = Math.max(rects[i][3], 0);
      Object.assign(st, { w, h, dx: x, dy: y, x0: x / dpr, y0: y / dpr, x1: (x + w) / dpr, y1: (y + h) / dpr });
      st.c.width = w; st.c.height = h;
      Object.assign(st.c.style, { left: x / dpr + 'px', top: y / dpr + 'px', width: w / dpr + 'px', height: h / dpr + 'px' });
    });
    geometry(); draw();
  }

  // frozen while the map moves or the list scrolls, and still under reduced motion. the motion is
  // slow (a 37s lap) so 30fps looks the same as 120 on a ProMotion screen; the wait is a timer, not
  // skipped rAFs, so the frames in between don't wake the page at all
  const FPS = 30;
  let timer = 0, raf = 0;
  const still = () => document.body.classList.contains('panning') || document.body.classList.contains('scrolling');
  function tick(now) {
    raf = 0;
    if (!still()) { t += (now - last) * S.speed; draw(); }
    last = now;
    timer = setTimeout(() => { timer = 0; raf = requestAnimationFrame(tick); }, 1000 / FPS - 4);
  }
  function start() {
    if (RM || timer || raf) return;
    last = performance.now(); raf = requestAnimationFrame(tick);
  }
  function stop() { clearTimeout(timer); cancelAnimationFrame(raf); timer = raf = 0; }

  addEventListener('resize', resize);
  resize();
  // nobody's looking when the window is in the background or minimised, so hold the last frame
  addEventListener('blur', stop);
  addEventListener('focus', start);
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : document.hasFocus() && start());
  start();
})();
