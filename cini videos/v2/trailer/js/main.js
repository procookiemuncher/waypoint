// Boot: fonts first (text gets measured while shots build), then every shot builds its DOM once,
// then the frame-wide passes: letterbox bars, vignette, film grain.
// The repo's latin font subsets have no → or ▸ (checked in v1), so those are drawn as SVG.
'use strict';

(async () => {
  FX = document.getElementById('fx');
  const loads = [];
  for (const w of [400, 500, 600, 700]) loads.push(document.fonts.load(`${w} 40px Inter`));
  for (const w of [400, 500, 700]) loads.push(document.fonts.load(`${w} 40px "JetBrains Mono"`));
  await Promise.all(loads);
  await document.fonts.ready;
  const stage = document.getElementById('stage');
  SHOTS.sort((a, b) => a.z - b.z);
  for (const S of SHOTS) {
    S.el = h('div', { class: 'shot', 'data-shot': S.name, style: { display: 'none' } });
    stage.appendChild(S.el);
    S.build(S.el);
  }

  // letterbox: 2.39:1 bars over the cold open that pull away on the drop
  const bars = h('div', { id: 'bars' }, [h('i'), h('i')]);
  stage.appendChild(bars);
  const [top, bot] = bars.children;
  const BAR = (H - W / 2.39) / 2; // 138 px
  POST.push((t, b) => {
    const k = b < TL.K.drop - 0.2 ? 1 : 1 - ease.outQuart(prog(b, TL.K.drop - 0.12, TL.K.drop + 1.1));
    const hgt = BAR * k;
    show(bars, hgt > 0.2);
    css(top, 'top', '0px'); css(top, 'height', px(hgt));
    css(bot, 'top', px(H - hgt)); css(bot, 'height', px(hgt));
  });

  // vignette: dithered so the dark falloff doesn't band
  const vig = dithered(W, H, (x, y, out) => {
    const dx = (x - W / 2) / (W * 0.62), dy = (y - H / 2) / (H * 0.78);
    const v = smoothstep(0.55, 1.25, Math.hypot(dx, dy));
    out[0] = out[1] = out[2] = 0; out[3] = 255 * v * 0.55;
  }, 0, 3, 2);
  vig.id = 'vignette';
  stage.appendChild(vig);

  // grain: one seeded tile, a new offset every frame
  const grain = h('div', { id: 'grain', style: { backgroundImage: `url(${grainTile()})`, backgroundSize: '384px 384px' } });
  stage.appendChild(grain);
  POST.push(t => {
    const f = Math.round(t * FPS);
    css(grain, 'backgroundPosition', `${Math.floor(hash(f, 11) * 384)}px ${Math.floor(hash(f, 12) * 384)}px`);
  });

  window.seek = seek;
  window.READY = true;
})().catch(e => { console.error('boot failed: ' + (e && e.stack || e)); window.READY = 'error'; });
