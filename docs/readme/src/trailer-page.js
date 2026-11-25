// Boots the trailer's own page (its stage CSS, every shot, the engine) inside a README scene, with
// one change: the catalog data is docs/readme/data/library.js, today's routes and per-country
// colours, instead of the copy the trailer was filmed with. Nothing is copied out of the trailer.
//
// A scene sets window.SCENE = { start, tweak(api) } before this loads. start is the trailer time
// (seconds) that the scene's t = 0 maps to; tweak runs once everything is built and before the
// renderer sees READY, so it can retime or hide shots.
'use strict';
(async () => {
  const base = '/cini%20videos/v2/trailer/';
  const doc = new DOMParser().parseFromString(await (await fetch(base + 'index.html')).text(), 'text/html');
  document.head.appendChild(doc.querySelector('style'));
  for (const el of doc.body.children) if (el.tagName !== 'SCRIPT') document.body.appendChild(document.importNode(el, true));

  // the renderer waits for READY; hold it back until the scene's tweaks are in
  let ready;
  Object.defineProperty(window, 'READY', {
    configurable: true,
    get: () => ready,
    set(v) {
      if (v === true) {
        const sc = window.SCENE || {};
        const seek0 = window.seek;
        // per-frame grain only costs bytes at README size
        document.getElementById('grain').style.display = 'none';
        if (sc.tweak) sc.tweak({ shot: n => SHOTS.find(S => S.name === n) });
        window.seek = t => seek0((sc.start || 0) + t);
      }
      ready = v;
    },
  });

  for (const s of doc.querySelectorAll('script[src]')) {
    const src = s.getAttribute('src') === 'data/library.js' ? '/docs/readme/data/library.js' : base + s.getAttribute('src');
    await new Promise((res, rej) => {
      const e = document.createElement('script');
      e.src = src; e.onload = res; e.onerror = () => rej(new Error('failed to load ' + src));
      document.body.appendChild(e);
    });
  }
})().catch(e => { console.error(String(e && e.stack || e)); window.READY = 'error'; });
