// S3 f101-158: night desktop, frosted Dock with the Waypoint tile; the cursor rises, clicks the
// tile, the camera pans, a frosted console springs out of the tile and the command types; then
// the whole scene drifts up into a whip-tilt through a lavender tint.
//
// Coordinates: every number in the brief is the settled, post-pan stage position (Dock x228-852,
// tile 4 at 586, console x196-922 by f138). Content is laid out 125 px to the left and the pan
// carries it home, so the console sits over the tile it came out of. The console lives inside
// the pan layer for that reason.
'use strict';

(() => {
  const PAN = 125;
  const TILE_X = [310, 402, 494, 586, 678, 770].map(x => x - PAN), TILE_Y = 910, WP = 3;
  const CMD = 'play jfk-to-the-plaza';

  const pan = f => spline(f, [[115, 0], [116, 1.5], [117, 6], [118, 16], [119, 32], [120, 50], [121, 66], [122, 80], [124, 100], [126, 112], [128, 120], [130, PAN]], { v0: 0, v1: 0 });
  const settleS = f => approach(f, 101, 1.06, 1, 0.22);
  const settleY = f => approach(f, 101, 28, 0, 0.22);
  const settleBlur = f => approach(f, 101, 3, 0, 0.25);
  // whip: velocity grows as t^4 to 25 px/frame at f158
  const whip = f => (f < 136 ? 0 : -110 * Math.pow((f - 136) / 22, 5));
  const whipV = f => (f < 136 ? 0 : 25 * Math.pow((f - 136) / 22, 4));

  // console box in content coordinates (centre + size), springing out of tile 4
  const cw = f => spline(f, [[116, 84], [118, 250], [120, 470], [122, 640], [124, 724], [126, 744], [129, 738], [132, 727], [135, 724], [138, 726]], { v0: 70, v1: 0 });
  const chh = f => spline(f, [[116, 84], [118, 118], [120, 168], [122, 206], [124, 226], [126, 234], [129, 232], [132, 228.5], [135, 227.6], [138, 228]], { v1: 0 });
  const ccx = f => spline(f, [[116, 461], [120, 450], [124, 439], [128, 434], [138, 434]], { v1: 0 });
  const ccy = f => spline(f, [[116, 910], [118, 870], [120, 800], [122, 740], [124, 705], [126, 688], [129, 681], [132, 682.6], [138, 682.5]], { v0: -12, v1: 0 });

  // typing: one char a frame from f121, with a held frame every 2-3 chars, done at f150
  const HOLDS = new Set([2, 5, 9, 12, 15, 19, 22, 25, 27]); // indices into frames 122..150
  const COUNT = [];
  {
    let n = 0;
    for (let fr = 0; fr <= 160; fr++) {
      if (fr === 121) n = 1;
      else if (fr > 121 && fr <= 150 && !HOLDS.has(fr - 122)) n++;
      COUNT[fr] = Math.min(n, CMD.length);
    }
  }
  const typed = f => COUNT[Math.max(0, Math.min(160, Math.floor(f + 1e-6)))]; // text steps, it can't be fractional

  const curPos = f => [approach(f, 101.5, 515, 472, 0.2), approach(f, 101.5, 1160, 917, 0.21)];

  const GLYPHS = [
    '<rect x="24" y="24" width="15" height="15" rx="4"/><rect x="45" y="24" width="15" height="15" rx="4"/><rect x="24" y="45" width="15" height="15" rx="4"/><rect x="45" y="45" width="15" height="15" rx="4"/>',
    '<circle cx="42" cy="42" r="19"/><path d="M42 27 L47.5 42 L42 57 L36.5 42 Z"/>',
    '<path d="M25 30 H59 M25 42 H59 M25 54 H47"/>',
    null,
    '<circle cx="42" cy="42" r="16"/><circle cx="42" cy="42" r="5.5"/><path d="M42 20 V26 M42 58 V64 M20 42 H26 M58 42 H64"/>',
    '<path d="M22 46 C28 30, 34 30, 38 42 S 48 56, 54 42 S 60 30, 63 36"/>',
  ];

  let E = {};
  function build(root) {
    const scene = layer('', { transformOrigin: `${TILE_X[WP]}px ${TILE_Y}px` });
    root.appendChild(scene);
    E.scene = scene;
    E.whipBlur = dirBlur(0.1);
    const panL = layer();
    scene.appendChild(panL);
    E.pan = panL;
    E.panBlur = dirBlur(0.1);

    // wallpaper: #171a24 -> #08090d top to bottom, a soft lavender glow top right, dithered
    const top = rgb('#171a24'), bot = rgb('#08090d'), ac = rgb(C.accent);
    const wall = dithered(1480, 1500, (x, y, o) => {
      const sx = x - 300, sy = y - 200;
      const t = clamp(sy / 1080);
      for (let i = 0; i < 3; i++) o[i] = lerp(top[i], bot[i], t);
      const a = 0.11 * (1 - smoothstep(0, 1, Math.hypot(sx - 980, sy - 80) / 560));
      for (let i = 0; i < 3; i++) o[i] = lerp(o[i], ac[i], a);
    }, 0.02, 31);
    wall.className = 'abs';
    wall.style.left = '-300px'; wall.style.top = '-200px';
    panL.appendChild(wall);
    // line art at 14%, echoing the icon: big circle, two horizontals, one vertical, a sparkle
    const art = s('svg', { width: 1480, height: 1500, viewBox: '-300 -200 1480 1500', class: 'abs', style: { left: '-300px', top: '-200px' } }, [
      s('g', { fill: 'none', stroke: C.accent, opacity: 0.14 }, [
        s('circle', { cx: 700, cy: 420, r: 330, 'stroke-width': 2 }),
        s('path', { d: 'M-300 250 H1180 M-300 610 H1180', 'stroke-width': 1.5 }),
        s('path', { d: 'M862 -200 V1300', 'stroke-width': 1.5 }),
      ]),
      s('path', { d: 'M862 222 C864 244 868 248 890 250 C868 252 864 256 862 278 C860 256 856 252 834 250 C856 248 860 244 862 222 Z', fill: C.accent, opacity: 0.3 }),
    ]);
    panL.appendChild(art);

    // the Dock
    const dock = h('div', { class: 'abs', style: { left: `${228 - PAN}px`, top: '850px', width: '624px', height: '120px', borderRadius: '40px', background: 'rgba(30,32,40,.40)', backdropFilter: 'blur(22px) saturate(1.2) brightness(1.18)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), inset 0 0 0 1px rgba(255,255,255,.05), 0 24px 60px rgba(0,0,0,.45)' } });
    panL.appendChild(dock);
    E.tiles = TILE_X.map((x, i) => {
      let t;
      if (i === WP) {
        t = makeIcon();
        t.setSize(84);
        t.style.left = px(x - t._box / 2); t.style.top = px(TILE_Y - t._box / 2);
      } else {
        t = h('div', { class: 'abs', style: { left: px(x - 42), top: px(TILE_Y - 42), width: '84px', height: '84px', borderRadius: '19px', background: 'linear-gradient(160deg, #24262d 0%, #16171b 70%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12), inset 0 0 0 1px rgba(255,255,255,.05), 0 6px 14px rgba(0,0,0,.35)' } });
        t.innerHTML = `<svg width="84" height="84" viewBox="0 0 84 84" style="display:block"><g fill="none" stroke="#f4f4f5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity=".88">${GLYPHS[i]}</g></svg>`;
      }
      panL.appendChild(t);
      return t;
    });
    panL.appendChild(h('div', { class: 'abs', style: { left: px(TILE_X[WP] - 3), top: '959px', width: '6px', height: '6px', borderRadius: '3px', background: C.text } }));

    const cur = makeCursor();
    panL.appendChild(cur);
    E.cur = cur;

    // the console: graphite glass over the wallpaper
    const con = h('div', { class: 'abs', style: { overflow: 'hidden', background: 'rgba(18,19,24,.62)', backdropFilter: 'blur(26px) saturate(1.15) brightness(1.22)', boxShadow: 'inset 0 1.5px 0 rgba(236,228,255,.55), inset 0 0 0 1px rgba(255,255,255,.06), 0 0 0 .5px rgba(180,154,255,.16), 0 40px 100px rgba(0,0,0,.55)' } });
    panL.appendChild(con);
    E.con = con;
    E.conBlur = dirBlur(0.1);
    con.appendChild(h('div', { class: 'abs', style: { width: '100%', height: '90px', background: 'linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,0))' } }));
    // the backdrop blur irons the wallpaper's dither flat, so the glass gets its own grain
    const gr = grain(760, 250, 4, 33, 20);
    gr.className = 'abs';
    con.appendChild(gr);
    const inner = h('div', { class: 'abs', style: { width: '726px', height: '228px' } });
    con.appendChild(inner);
    E.inner = inner;
    const F = 40, ADV = F * 0.6;
    inner.appendChild(h('div', { class: 'abs mono', text: '›', style: { left: '44px', top: '52px', font: `500 ${F}px/1 "JetBrains Mono"`, color: C.accent } }));
    E.cmd = h('div', { class: 'abs mono nowrap', style: { left: `${44 + 2 * ADV}px`, top: '52px', font: `500 ${F}px/1 "JetBrains Mono"`, color: C.text } });
    inner.appendChild(E.cmd);
    E.caret = h('div', { class: 'abs', style: { top: '50px', width: `${ADV}px`, height: `${F * 1.08}px`, borderRadius: '3px', background: C.accent } });
    inner.appendChild(E.caret);
    E.adv = ADV; E.cmdX = 44 + 2 * ADV;
    let x = 44;
    for (const chip of ['--drive', '--mph 35', 'ls routes']) {
      const wch = textW(chip, '500 21px "JetBrains Mono"') + 32;
      inner.appendChild(h('div', { class: 'abs mono nowrap', text: chip, style: { left: px(x), top: '156px', height: '40px', width: px(wch), borderRadius: '20px', boxShadow: 'inset 0 0 0 1px rgba(107,114,128,.55)', font: '500 21px/40px "JetBrains Mono"', color: C.muted, textAlign: 'center' } }));
      x += wch + 12;
    }
    const run = h('div', { class: 'abs', style: { left: `${726 - 44 - 51}px`, top: `${176 - 25.5}px`, width: '51px', height: '51px', borderRadius: '50%', background: C.accent, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, [playTri(20, C.page)]);
    inner.appendChild(run);

    E.tint = layer('', { background: 'rgba(180,154,255,1)', opacity: 0 });
    root.appendChild(E.tint);
  }

  function render(lf, f) {
    // scene: settles in, then whips up
    const sc = settleS(f), ty = settleY(f) + whip(f);
    E.scene.style.transform = `translateY(${ty.toFixed(2)}px) scale(${sc.toFixed(5)})`;
    const wv = whipV(f);
    const vBlur = Math.max(0, (wv - 2) * 0.3);
    const rBlur = settleBlur(f);
    if (vBlur > 0.05) E.whipBlur.set(E.scene, rBlur, vBlur + rBlur);
    else E.scene.style.filter = blur(rBlur);

    // camera pan, smeared horizontally at speed
    const p = pan(f), pv = speed(pan, f);
    E.pan.style.transform = `translateX(${p.toFixed(2)}px)`;
    E.panBlur.set(E.pan, Math.max(0, (Math.abs(pv) - 1.5) * 0.22), 0);

    // click: the tile dips 6 px
    const dip = kf(f, [[113, 0], [115, 6], [117, 0]], [ease.outQuad, ease.inOutQuad]);
    const tile = E.tiles[WP];
    tile.style.transform = `translateY(${dip.toFixed(2)}px)`;
    tile.style.filter = dip > 0.05 ? `brightness(${(1 - dip * 0.02).toFixed(3)})` : 'none';

    // cursor rises from below, presses, then hides while typing
    const [cx, cy] = curPos(f);
    const [bx, by] = curPos(f - 0.25), [ax, ay] = curPos(f + 0.25);
    const press = kf(f, [[113, 1], [115, 0.85], [117, 1]], [ease.outQuad, ease.inOutQuad]);
    E.cur.place(cx, cy + dip, CURSOR_ANGLE, press, [(ax - bx) * 2, (ay - by) * 2], kf(f, [[123, 1], [129, 0]], ease.inOutSine));

    // console
    if (f < 116) { E.con.style.display = 'none'; }
    else {
      E.con.style.display = 'block';
      const w = cw(f), hh = chh(f), x = ccx(f), y = ccy(f);
      E.con.style.left = px(x - w / 2); E.con.style.top = px(y - hh / 2);
      E.con.style.width = px(w); E.con.style.height = px(hh);
      E.con.style.borderRadius = px(kf(f, [[116, 19], [121, 60]], ease.outCubic));
      E.con.style.opacity = kf(f, [[116, 0.55], [118, 1]], ease.outQuad);
      const vy = speed(ccy, f), vw = speed(cw, f);
      E.conBlur.set(E.con, Math.max(0, Math.abs(vw) * 0.5 - 2) * 0.12, Math.max(0, Math.abs(vy) - 2) * 0.16);
      // content is laid out for the settled box, anchored to its centre so it opens with it
      E.inner.style.left = px((w - 726) / 2); E.inner.style.top = px((hh - 228) / 2);
      E.inner.style.opacity = kf(f, [[120, 0], [125, 1]], ease.outQuad);
      const n = typed(f);
      E.cmd.textContent = CMD.slice(0, n);
      E.caret.style.left = px(E.cmdX + n * E.adv + 2);
    }
    E.tint.style.opacity = kf(f, [[154, 0], [158, 0.18], [159, 0.22]], [ease.inQuad, ease.linear]);
  }

  shot('S3', 101, 158, build, render);
})();
