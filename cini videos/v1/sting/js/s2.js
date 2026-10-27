// S2 f72-100: hard cut on the drop to the real app icon on a graphite halo; four squares spin in
// counter-clockwise and lock into a cross, then the icon collapses and the squares fall into a
// row on its right (the graphite one slips behind it) while the blur ramps up.
'use strict';

(() => {
  const CX = 540, CY = 540;
  // counter-clockwise spin still to go (degrees) and orbit radius, both decelerating into the lock
  const spin = f => spline(f, [[72, 118], [75, 62], [78, 30], [81, 12], [84, 3], [86, 0]], { v1: 0 });
  const orbit = f => spline(f, [[72, 330], [76, 262], [80, 232], [86, 216], [88, 215]], { v1: -0.4 });
  const sqScaleA = f => spline(f, [[72, 0.74], [78, 0.95], [86, 1]], { v1: 0 });
  // icon squircle size: ease out to 178, then collapse accelerating to about 40 by f100
  const iconA = f => spline(f, [[72, 276], [75, 232], [79, 200], [83, 184], [86, 178], [88, 177]], { v1: -0.5 });
  const pB = f => Math.pow(Math.max(0, f - 88) / 12, 2.2);
  const iconSize = f => (f <= 88 ? iconA(f) : 177 - 137 * pB(f));
  const halo = f => (f <= 88 ? spline(f, [[72, 196], [75, 240], [80, 294], [86, 326], [88, 330]], { v1: 1 }) : 330 * iconSize(f) / 177);

  // final cross slots: left graphite, top lavender, right blue, bottom pink (angle CCW, screen)
  const SQ = [
    { phi: 180, row: [461, 540], rowSize: 30, style: 'graphite' },
    { phi: 90, row: [513, 540], rowSize: 40, color: C.accent },
    { phi: 0, row: [561, 540], rowSize: 40, color: C.ny },
    { phi: 270, row: [609, 540], rowSize: 40, color: C.mia },
  ];
  // the icon ends on x461, where the Waypoint tile sits in the Dock on the next frame
  const iconPos = f => [lerp(CX, 461, pB(f)), CY];

  function sqState(q, f) {
    const p = pB(f);
    const phi = (q.phi - spin(f)) * Math.PI / 180;
    const r = orbit(Math.min(f, 88));
    const ax = CX + r * Math.cos(phi), ay = CY - r * Math.sin(phi);
    const size = 92 * (f <= 88 ? sqScaleA(f) : 1);
    return {
      x: lerp(ax, q.row[0], p), y: lerp(ay, q.row[1], p),
      size: lerp(size, q.rowSize, p),
      rot: spin(f), // rigid with the orbit, so they turn upright as the spin dies
    };
  }

  let E = {};
  function build(root) {
    const ac = rgb(C.accent), pg = rgb(C.page);
    const bloom = dithered(W, H, (x, y, o) => {
      const a = 0.07 * (1 - smoothstep(0, 1, Math.hypot(x - CX, y - CY) / 560));
      for (let i = 0; i < 3; i++) o[i] = lerp(pg[i], ac[i], a);
    }, 0.02, 21);
    bloom.className = 'abs';
    root.appendChild(bloom);

    const g = layer();
    root.appendChild(g);
    E.g = g;
    E.halo = h('div', { class: 'abs', style: { borderRadius: '50%', background: C.panel, boxShadow: `inset 0 0 0 1px ${C.hair}, 0 30px 90px rgba(0,0,0,.5)` } });
    g.appendChild(E.halo);

    E.sq = SQ.map(q => {
      const inner = h('div', { class: 'abs', style: { width: '92px', height: '92px', borderRadius: '26px' } });
      if (q.style === 'graphite') {
        inner.style.background = `linear-gradient(160deg, #1f2025 0%, ${C.panel2} 55%)`;
        inner.style.boxShadow = `inset 0 0 0 1px ${C.hair2}, inset 0 1.5px 0 rgba(180,154,255,.42), 0 0 22px rgba(180,154,255,.10), 0 18px 40px rgba(0,0,0,.5)`;
      } else {
        const [r, gg, b] = rgb(q.color);
        const hi = `rgb(${Math.min(255, r + 38)},${Math.min(255, gg + 38)},${Math.min(255, b + 38)})`;
        inner.style.background = `linear-gradient(160deg, ${hi} 0%, ${q.color} 58%)`;
        inner.style.boxShadow = 'inset 0 1.5px 0 rgba(255,255,255,.38), inset 0 0 0 1px rgba(255,255,255,.10), 0 18px 40px rgba(0,0,0,.45)';
      }
      const turn = h('div', { class: 'abs', style: { width: '92px', height: '92px', transformOrigin: '46px 46px' } }, [inner]);
      // pos sits on the square's centre; mb is a 160 px box around it that turns to face the
      // motion so its x-only blur smears along the path
      const mb = h('div', { class: 'abs', style: { left: '-80px', top: '-80px', width: '160px', height: '160px', transformOrigin: '80px 80px' } }, [turn]);
      turn.style.left = '34px'; turn.style.top = '34px';
      const pos = h('div', { class: 'abs' }, [mb]);
      g.appendChild(pos);
      return { pos, mb, turn, inner, blur: dirBlur(0.5), q };
    });
    // the graphite square slips behind the icon, so the icon sits above all four
    const icon = makeIcon();
    g.appendChild(icon);
    E.icon = icon;
  }

  function render(lf, f0) {
    // the row is complete at f100; the last half frame keeps collapsing the whole row instead
    // of letting the squares overshoot their slots
    const f = Math.min(f0, 100);
    const k = iconSize(f0) / iconSize(f);
    E.g.style.transform = k < 1 ? `scale(${k.toFixed(4)})` : 'none';
    E.g.style.transformOrigin = '535px 540px';

    const hd = halo(f);
    E.halo.style.width = E.halo.style.height = px(hd);
    const [ix, iy] = iconPos(f);
    E.halo.style.transform = `translate(${(ix - hd / 2).toFixed(2)}px, ${(iy - hd / 2).toFixed(2)}px)`;

    const size = iconSize(f);
    E.icon.setSize(size);
    E.icon.style.transform = `translate(${(ix - E.icon._box / 2).toFixed(2)}px, ${(iy - E.icon._box / 2).toFixed(2)}px)`;

    for (const S of E.sq) {
      const a = sqState(S.q, f), b = sqState(S.q, Math.min(f + 0.25, 100)), c = sqState(S.q, f - 0.25);
      const vx = (b.x - c.x) * 2, vy = (b.y - c.y) * 2;
      const ang = Math.atan2(vy, vx) * 180 / Math.PI;
      S.pos.style.transform = `translate(${a.x.toFixed(2)}px, ${a.y.toFixed(2)}px)`;
      S.mb.style.transform = `rotate(${ang.toFixed(2)}deg)`;
      S.turn.style.transform = `rotate(${(-ang + a.rot).toFixed(2)}deg) scale(${(a.size / 92).toFixed(4)})`;
      S.blur.set(S.mb, Math.min(18, Math.hypot(vx, vy) * 0.2), 0);
    }
    // blur ramps as everything collapses into the row
    E.g.style.filter = blur(f0 < 88 ? 0 : kf(f0, [[88, 0.3], [100, 6], [101, 7]], [ease.inQuad, ease.linear]));
  }

  shot('S2', 72, 100, build, render);
})();
