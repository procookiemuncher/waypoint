// Boot: fonts first (text gets measured during build), then every shot builds its DOM once.
// The repo's latin subsets have no → or ▸ (checked against the woff2 cmap), those are
// drawn as SVG in s1.js; › and · are in the files.
'use strict';

(async () => {
  FX = document.getElementById('fx');
  const loads = [];
  for (const w of [400, 500, 600, 700]) loads.push(document.fonts.load(`${w} 40px Inter`));
  for (const w of [500, 700]) loads.push(document.fonts.load(`${w} 40px "JetBrains Mono"`));
  await Promise.all(loads);
  await document.fonts.ready;
  const stage = document.getElementById('stage');
  for (const S of SHOTS) {
    S.el = h('div', { class: 'shot', 'data-shot': S.name });
    stage.appendChild(S.el);
    S.build(S.el);
  }
  window.seek = seek;
  window.READY = true;
})().catch(e => { console.error('boot failed: ' + (e && e.stack || e)); window.READY = 'error'; });
