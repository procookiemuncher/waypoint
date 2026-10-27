// S7 f245-300: the lone logo disc rises into the centre, smeared on the cut frame, holds
// perfectly still f269-287 (the film's only frozen stretch), then shrinks, accelerating, into
// the hard cut to the end card.
'use strict';

(() => {
  const D = 168;
  // the disc's top edge, from the brief; the approach is about 20% of the way per frame
  const top = f => spline(f, [[245, 569], [250, 491], [255, 468], [262, 458.5], [269, 456]], { v1: 0 });
  const dia = f => (f <= 287 ? D : D - 45 * Math.pow((f - 287) / 13, 2.6));
  const inBlur = f => kf(f, [[245, 5], [249, 0]], ease.outQuad);

  let E = {};
  function build(root) {
    E.disc = makeDisc();
    root.appendChild(E.disc);
    E.smear = dirBlur(0.6);
  }

  function render(lf, f) {
    // the hold: one state, nothing computed from the frame number
    const hold = f >= 269 && f <= 287;
    const d = hold ? D : dia(f);
    const cy = hold ? 540 : f < 269 ? top(f) + D / 2 : 540;
    E.disc.setSize(d);
    E.disc.style.transform = `translate(${(540 - d / 2).toFixed(2)}px, ${(cy - d / 2).toFixed(2)}px)`;
    if (hold) { E.disc.style.filter = 'none'; return; }
    if (f < 269) {
      const rb = inBlur(f), sm = Math.abs(speed(top, f)) * 0.4;
      E.smear.set(E.disc, rb, rb + sm);
    } else {
      // the shrink: a little round blur as the edge picks up speed
      const edge = Math.abs(speed(dia, f)) / 2;
      E.disc.style.filter = blur(Math.max(0, edge - 1.5) * 0.25);
    }
  }

  shot('S7', 245, 300, build, render);
})();
