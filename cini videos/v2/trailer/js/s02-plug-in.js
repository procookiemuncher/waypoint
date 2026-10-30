// S2 · "Plug in your iPhone." (beats 8-16, the build). The app's real connect screen: the rainbow
// wire lights, the three checks tick on beats 12-13-14, the phone goes green on 15, then the
// camera dives into the phone's screen and the frame flashes lavender into the drop.
'use strict';

shot({
  name: 'plug-in', b0: 8, b1: 16, pre: 0.9, z: 10,
  build(el) {
    uiCss();
    this.bg = dithered(W, H, (x, y, o) => {
      const d = Math.hypot((x - W * 0.62) / W, (y - H * 0.45) / (H * 1.2));
      const v = 1 - smoothstep(0, 0.8, d);
      o[0] = lerp(6, 15, v); o[1] = lerp(7, 15, v); o[2] = lerp(10, 22, v);
    }, 0.018, 31, 2);
    el.appendChild(this.bg);
    this.world = h('div', { class: 'layer', style: { perspective: '2200px' } });
    el.appendChild(this.world);

    const type = { position: 'absolute', font: '600 132px/0.98 Inter', letterSpacing: '-0.045em', color: C.text };
    this.l1 = riseLine('Plug in', { ...type, left: '118px', top: '330px' });
    this.l2 = riseLine('your iPhone.', { ...type, left: '118px', top: '462px' });
    this.world.appendChild(this.l1);
    this.world.appendChild(this.l2);

    this.card = h('div', { class: 'abs', style: { transformStyle: 'preserve-3d' } });
    this.link = uiLink();
    this.card.appendChild(this.link);
    this.world.appendChild(this.card);
    this.flash = layer('', { background: C.accent, opacity: 0 });
    el.appendChild(this.flash);
    this.mb = dirBlur(0.2);
  },
  render(lb, t) {
    const K = TL.K, c = K.checks.map(b => b - 8), rd = K.ready - 8;
    // headline
    this.l1.set(ease.outQuart(prog(lb, 0.2, 1.3)), (1 - ease.outQuart(prog(lb, 0.2, 1.3))) * 10);
    this.l2.set(ease.outQuart(prog(lb, 0.55, 1.65)), (1 - ease.outQuart(prog(lb, 0.55, 1.65))) * 10);

    // the scene's state on the beat grid
    const draw = ease.inOutCubic(prog(lb, 0.4, 2.2));
    const st = i => (lb >= c[i] ? 2 : lb >= (i ? c[i - 1] : 1.6) ? 1 : 0);
    const checkP = lb - (c[2] - 0.4);
    this.link.set({
      draw, flow: t, glowA: lb >= rd ? 0.95 : 0.6,
      phone: checkP > 0 ? 'check' : 'lock',
      checkS: checkP > 0 ? spring(checkP, 1.8, 0.35) : 1,
      stepState: [st(0), st(1), st(2)],
      titleTxt: lb >= c[2] ? 'iPhone ready' : 'Connect your iPhone',
      subTxt: lb >= c[2] ? 'iPhone · iOS 27.0' : 'Plug it into this Mac with a USB cable.',
      markOn: draw,
    });
    // each check lands with a small kick of the card
    let kick = 0;
    for (const b of c) { const d = lb - b; if (d >= 0 && d < 1) kick += Math.exp(-7 * d) * Math.sin(d * 22) * 5; }

    // camera: the card drifts in 3D, then the dive into the phone on the build's last bar
    const dive = ease.inExpo(prog(lb, rd - 0.15, 8 - LEADB));
    const sc = lerp(1.62, 1.76, ease.outCubic(prog(lb, -0.9, rd))) * lerp(1, 9.5, dive);
    const ry = lerp(-16, -5, ease.outCubic(prog(lb, -0.9, rd))) * (1 - dive);
    const rx = lerp(6, 2, ease.outCubic(prog(lb, -0.9, rd))) * (1 - dive);
    // the phone's screen centre is at (466,108) in the 560x270 scene and is the transform origin,
    // so the translate alone says where the phone sits on screen; the dive brings it to the centre
    const ox = 466, oy = 108;
    const settle = ease.outCubic(prog(lb, -0.9, rd));
    const PX = lerp(lerp(1680, 1620, settle), W / 2, dive);
    const PY = lerp(lerp(372, 388, settle) + kick, H / 2, dive);
    const cx = PX - ox, cy = PY - oy;
    css(this.card, 'transform', `translate(${f2(cx)}px, ${f2(cy)}px) rotateY(${f2(ry)}deg) rotateX(${f2(rx)}deg) scale(${sc.toFixed(4)})`);
    css(this.card, 'transformOrigin', `${ox}px ${oy}px`);
    // the headline leaves as the camera dives
    const away = ease.inCubic(prog(lb, rd, 8));
    css(this.l1, 'transform', `translateX(${f2(-away * 700)}px)`);
    css(this.l2, 'transform', `translateX(${f2(-away * 820)}px)`);
    this.mb.set(this.world, away * 26, 0);
    op(this.flash, kf(lb, [[7.55, 0], [8 - LEADB, 1]], ease.inQuad));
  },
});
