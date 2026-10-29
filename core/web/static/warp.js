// the "you're in" moment: once the phone passes every check on first boot, the connect screen
// gives way to the brand: a droplet of glass lands, spreads into the app icon's squircle, bends the
// Leap mark round its rim, then settles into the flat Dock icon, and "Waypoint" rises letter by
// letter under it. the glass itself is glass.js. Warp.prep() compiles it and builds the mark's
// distance field ahead of time (do it while something else is on screen, it hitches), Warp.in()
// resolves once black covers the screen, Warp.finished() then plays the reveal and resolves once all of
// it has played (glass settled, word in, shimmer done) however slow the frames came, Warp.out() fades it.
// reduced motion or no WebGL2: all no-ops and the app just shows as before.
const Warp = (() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FADE = 500;
  const WORD = 3700;   // from .go to the word's shimmer ending (app.css: last letter + wp-shine)
  const BEAT = 500;    // a moment on the finished icon before the app comes in
  const CAP = 12000;   // never hold the app longer than this (a minimised window gets no frames)

  // the Leap from the Dock icon (mac-version/app/icon.svg), on its own; the tile is the glass
  const LEAP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 258 254"><path fill="#fff" fill-rule="evenodd" d="M62 162a32 32 0 1 1 0 64a32 32 0 1 1 0-64zM62 180a14 14 0 1 0 0 28a14 14 0 1 0 0-28zM58.09 140.37A151 151 0 0 1 129.15 62.65A15 15 0 0 1 142.85 89.35A121 121 0 0 0 85.90 151.63A15 15 0 0 1 58.09 140.37ZM194 28a34 34 0 1 1 0 68a34 34 0 1 1 0-68z"/></svg>`;

  let el = null, glass = null, played = null;
  const sleep = ms => new Promise(res => setTimeout(res, ms));

  function start(){
    el = document.createElement('div');
    el.id = 'warp';
    const word = [...'Waypoint'].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('');
    el.innerHTML = `<div class="brand"><div class="slot"></div><div class="word" aria-label="Waypoint">${word}</div></div>`;
    document.getElementById('frame').appendChild(el);
    document.fonts?.load('600 46px Inter');   // so the word doesn't swap fonts mid-reveal
    glass = GlassReveal.create(el, el.querySelector('.slot'), {
      logo: LEAP, tileSize: 168, logoScale: 0.58, speed: 1.3,
      background: '#000000', plateColor: '#17141f', logoColor: '#b49aff',
    });
    if(!glass){ el.remove(); el = null; return false; }
    return true;
  }

  function stop(){
    glass?.dispose();
    el?.remove();
    el = glass = played = null;
  }

  return {
    get active(){ return !!el; },
    prep(){ if(!RM && !el) start(); },
    async in(){
      if(RM || el?.classList.contains('in') || (!el && !start())) return;
      try { await glass.ready; } catch { stop(); return; }   // the mark never loaded: skip the intro
      if(!el) return;
      await new Promise(res => requestAnimationFrame(res));
      el.classList.add('in');
      await sleep(FADE);   // just the black: the reveal waits for finished(), so none of it plays under the fade
    },
    // plays the reveal on the covered screen (the app does its leaving work first, so that hitch
    // lands on black, not on the droplet) and resolves once all of it has played
    finished(){
      if(!el?.classList.contains('in')) return Promise.resolve();
      played ??= new Promise(res => requestAnimationFrame(() => {
        el?.classList.add('go');
        res(Promise.all([glass?.play(), sleep(WORD)]));
      })).then(() => sleep(BEAT));
      return Promise.race([played, sleep(CAP)]);
    },
    out(){
      if(!el) return Promise.resolve();
      el.classList.remove('in');
      el.classList.add('out');
      return new Promise(res => setTimeout(() => { stop(); res(); }, FADE + 300));
    },
  };
})();
