// S8 f301-359: hard cut to the end card. Black radial background with the faintest lavender
// cast, the "Waypoint" wordmark (tight white glow, wide soft lavender halo) zooming out from
// 1650 px wide through zoom streaks, settling, then collapsing; the film ends mid-collapse.
'use strict';

(() => {
  // word width (ink) from the brief; a monotone spline so the uneven table doesn't kink
  const WIDTH = [[301, 1650], [302, 1350], [303, 1110], [304, 1049], [309, 734], [311, 678], [320, 563],
    [342, 516], [350, 492], [355, 450], [359, 267]];
  const width = f => spline(f, WIDTH, { extend: true });
  const endBlur = f => kf(f, [[354, 0], [359, 3.5], [359.5, 4]], [ease.inQuad, ease.linear]);
  const N = 24; // zoom-streak copies
  const FS = 200; // the word is set at 200 px and scaled

  let E = {};
  function build(root) {
    // background: #1a1824 around the word falling to #020204 in the corners, dithered
    const c0 = rgb('#1a1824'), c1 = rgb('#020204');
    const bg = dithered(W, H, (x, y, o) => {
      const d = Math.hypot((x - 540) / 700, (y - 540) / 520);
      const t = Math.pow(smoothstep(0, 1, d), 0.75);
      for (let i = 0; i < 3; i++) o[i] = lerp(c0[i], c1[i], t);
    }, 0.02, 81);
    bg.className = 'abs';
    root.appendChild(bg);

    // measure the ink after the fonts have loaded
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `600 ${FS}px Inter`;
    ctx.letterSpacing = `${-0.02 * FS}px`;
    const m = ctx.measureText('Waypoint');
    E.inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    // origin so the ink is centred on x, and the optical centre (caps with a nod to the
    // descenders) on y
    const ox = -(m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, oy = 0.30 * FS;

    const svg = s('svg', { width: W, height: H, class: 'abs', style: { overflow: 'visible' } });
    root.appendChild(svg);
    E.svg = svg;
    const text = attrs => s('text', { x: ox, y: oy, 'font-family': 'Inter', 'font-weight': 600, 'font-size': FS, 'letter-spacing': -0.02 * FS, ...attrs, text: 'Waypoint' });
    svg.appendChild(s('defs', {}, [
      s('filter', { id: 'wm-glow', x: '-40%', y: '-160%', width: '180%', height: '420%', 'color-interpolation-filters': 'sRGB' }, [
        s('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: 46, result: 'wide' }),
        s('feFlood', { 'flood-color': C.accent, 'flood-opacity': 0.25 }),
        s('feComposite', { in2: 'wide', operator: 'in', result: 'halo' }),
        s('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: 3.2, result: 'tight' }),
        s('feFlood', { 'flood-color': '#fff', 'flood-opacity': 0.5 }),
        s('feComposite', { in2: 'tight', operator: 'in', result: 'glow' }),
        s('feMerge', {}, [s('feMergeNode', { in: 'halo' }), s('feMergeNode', { in: 'glow' }), s('feMergeNode', { in: 'SourceGraphic' })]),
      ]),
    ]));
    // streak copies under the word, then the word itself
    E.copies = [];
    for (let i = 0; i < N; i++) {
      const g = s('g', {}, [text({ fill: '#F3F3F5' })]);
      svg.appendChild(g);
      E.copies.push(g);
    }
    E.word = s('g', { filter: 'url(#wm-glow)' }, [text({ fill: '#F3F3F5' })]);
    svg.appendChild(E.word);
    E.smear = dirBlur(0.05);
  }

  function render(lf, f) {
    const k = width(f) / E.inkW;
    const tr = sc => `translate(540 540) scale(${sc.toFixed(5)})`;
    E.word.setAttribute('transform', tr(k));
    // streaks: copies spread between this frame's size and the previous frame's, fading out
    // toward the old size; they only show while the size is changing fast
    const kPrev = width(f - 1) / E.inkW;
    const rel = kPrev / k - 1;
    const amt = clamp((rel - 0.012) / 0.05);
    for (let i = 0; i < N; i++) {
      const g = E.copies[i];
      if (amt <= 0) { g.setAttribute('opacity', 0); continue; }
      const u = (i + 1) / N;
      g.setAttribute('transform', tr(k * (1 + rel * u)));
      g.setAttribute('opacity', (amt * 0.16 * Math.pow(1 - u, 1.4)).toFixed(4));
    }
    // horizontal smear on the fast opening frames; the collapse gets the streaks and a round
    // blur rising to 3.5 px, so the word still reads as it goes
    const sx = f < 330 ? Math.max(0, rel - 0.03) * 40 : 0, rb = endBlur(f);
    if (sx > 0.05) E.smear.set(E.svg, sx + rb, rb + sx * 0.15);
    else E.svg.style.filter = blur(rb);
  }

  shot('S8', 301, 359, build, render);
})();
