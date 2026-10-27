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

  const cv = document.getElementById('ring'), ctx = cv.getContext('2d');
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
  function ringPath() {
    ctx.beginPath();
    for (const g of segs) {
      if (g.k === 'l') { ctx.lineTo(g.ax, g.ay); ctx.lineTo(g.bx, g.by); }
      else if (g.r > 0) ctx.arc(g.cx, g.cy, g.r, g.a0, g.a0 + Math.PI / 2);
    }
    ctx.closePath();
  }

  // the colour the conic gradient paints at a point, for the bloom (which isn't a stroke)
  function colorAt(x, y, rot) {
    let u = (Math.atan2(y - cy, x - cx) - rot) / (2 * Math.PI); u -= Math.floor(u);
    const f = u * 6, i = Math.min(Math.floor(f), 5), k = f - i, a = RGB[i], b = RGB[i + 1];
    return [0, 1, 2].map(j => Math.round(a[j] + (b[j] - a[j]) * k));
  }

  function draw() {
    const w = S.w, rot = (t / (S.rot * 1000)) * 2 * Math.PI;
    const grad = ctx.createConicGradient(rot, cx, cy);
    RAINBOW.forEach((c, i) => grad.addColorStop(i / 6, c));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';

    // the rainbow ring, with a little soft glow under it
    ctx.globalCompositeOperation = 'source-over';
    ringPath(); ctx.strokeStyle = grad;
    ctx.globalAlpha = S.base * .18; ctx.lineWidth = w * 4; ctx.stroke();
    ctx.globalAlpha = S.base;       ctx.lineWidth = w;     ctx.stroke();

    // the light, added on top so it brightens the colours already there
    const head = (t / (S.lap * 1000)) * L % L, tail = L * S.tail / 100, lead = L * S.lead / 100, Lt = S.light, G = S.glow;
    const fall = d => d >= 0 ? Math.pow(Math.max(1 - d / tail, 0), 1.7) : Math.pow(Math.max(1 + d / lead, 0), 2);   // d = px behind the head
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';

    // short chunks so the alpha fades along the tail while the colour stays the gradient's own
    const STEP = 2, CH = 10, n = Math.max(Math.ceil((tail + lead) / CH), 1);
    for (let c = 0; c < n; c++) {
      const a = -lead + c * (tail + lead) / n, b = -lead + (c + 1) * (tail + lead) / n, f = fall((a + b) / 2);
      if (f <= .002) continue;
      ctx.beginPath();
      ctx.moveTo(...at(head - a));
      for (let d = a + STEP; d < b; d += STEP) ctx.lineTo(...at(head - d));
      ctx.lineTo(...at(head - b));   // end exactly where the next chunk starts, no gap
      ctx.strokeStyle = grad;
      ctx.globalAlpha = Math.min(f * .45 * Lt, 1); ctx.lineWidth = w * 3.2; ctx.stroke();
      ctx.globalAlpha = Math.min(f * 1.1 * Lt, 1); ctx.lineWidth = w;       ctx.stroke();
      const hot = Math.pow(f, 5) * .85 * Lt;   // white-hot only right at the head
      if (hot > .01) { ctx.strokeStyle = '#fff'; ctx.globalAlpha = Math.min(hot, 1); ctx.lineWidth = w * .75; ctx.stroke(); }
    }

    // bloom spilling off the line, plus a flare at the head
    if (G > 0) {
      ctx.globalAlpha = 1;
      for (let d = -lead; d <= tail; d += Math.max(G / 3, 4)) {
        const f = fall(d); if (f < .02) continue;
        const [x, y] = at(head - d), [r, g, bl] = colorAt(x, y, rot);
        const rg = ctx.createRadialGradient(x, y, 0, x, y, G);
        rg.addColorStop(0, `rgba(${r},${g},${bl},${.16 * f * Lt})`);
        rg.addColorStop(.4, `rgba(${r},${g},${bl},${.06 * f * Lt})`);
        rg.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = rg; ctx.fillRect(x - G, y - G, G * 2, G * 2);
      }
      const [x, y] = at(head), [r, g, bl] = colorAt(x, y, rot), F = G * 1.3 + w * 3;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, F);
      rg.addColorStop(0, `rgba(255,255,255,${.5 * Lt})`);
      rg.addColorStop(.12, `rgba(${r},${g},${bl},${.35 * Lt})`);
      rg.addColorStop(1, `rgba(${r},${g},${bl},0)`);
      ctx.fillStyle = rg; ctx.fillRect(x - F, y - F, F * 2, F * 2);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }

  function resize() {
    W = innerWidth; H = innerHeight; dpr = devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
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
