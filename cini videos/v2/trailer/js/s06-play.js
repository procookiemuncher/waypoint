// S6 · "Press play." (beats 40-48). The hero card for MIA -> Faena Hotel with the Drive engine and
// 35 mph set, and the console typing the real command at poster size. Return on beat 44: the
// app's own log lines, the play button lights, and a ring opens out of the prompt onto S7.
'use strict';

const CMD = 'play mia-to-faena-miami --drive --mph 35';

shot({
  name: 'play', b0: 40, b1: 48, z: 60,
  build(el) {
    uiCss();
    this.bg = dithered(W, H, (x, y, o) => {
      const v = 1 - smoothstep(0, 1.0, Math.hypot((x - W * 0.5) / W, (y - H * 0.7) / H));
      o[0] = lerp(6, 14, v); o[1] = lerp(7, 15, v); o[2] = lerp(10, 22, v);
    }, 0.018, 61, 2);
    el.appendChild(this.bg);
    this.world = h('div', { class: 'layer' });
    el.appendChild(this.world);

    const type = { position: 'absolute', font: '600 150px/0.98 Inter', letterSpacing: '-0.045em', color: C.text };
    this.l1 = riseLine('Press play.', { ...type, left: '92px', top: '104px' });
    this.world.appendChild(this.l1);

    // hero card, top right
    const r = LIB.routes['mia-to-faena-miami'];
    this.hero = uiHero(r, 'drive', 35);
    this.heroWrap = h('div', { class: 'wp', style: { width: '552px', transformOrigin: '0 0' } }, [this.hero]);
    this.world.appendChild(this.heroWrap);

    // the console, poster size
    this.con = uiConsole();
    this.con.addLine('pick a route or place, or click the map to drop a pin.');
    this.con.addLine('phone unlocked — developer disk image is on', 'ok');
    this.echo = this.con.addLine(`<span class="ps">waypoint ›</span> ${esc(CMD)}`, 'cmd');
    this.l_build = this.con.addLine(`building mia-to-faena-miami for drive…`, 'dim');
    this.l_play = this.con.addLine(`playing mia-to-faena-miami via drive — keep the phone unlocked`, 'accent');
    this.conWrap = h('div', { class: 'wp', style: { width: '396px', height: '260px', borderRadius: '10px', overflow: 'hidden', transformOrigin: '0 0',
      border: '1px solid #1e2230', display: 'flex', flexDirection: 'column' } }, [this.con]);
    this.con.style.flex = '1';
    // the scrollback grows downward from under the label, like a fresh terminal
    this.con.log.style.flex = 'none'; this.con.log.style.justifyContent = 'flex-start';
    this.world.appendChild(this.conWrap);

    // ring wipe into S7
    this.ringSvg = s('svg', { width: W, height: H, style: { position: 'absolute', left: 0, top: 0 } });
    this.ring = s('circle', { fill: 'none', stroke: C.accent });
    this.ringSvg.appendChild(this.ring);
    el.appendChild(this.ringSvg);
    this.mb = dirBlur(0.2);
  },
  // characters typed by beat lb: about 16 a beat with seeded hesitations
  typed(lb) {
    const K = TL.K, a = K.typeStart - 40, b = K.typeEnd - 40;
    if (lb < a) return 0;
    // build per-char times once: uneven gaps, a pause after each word
    if (!this._times) {
      const gaps = [...CMD].map((c, i) => (0.7 + 0.6 * hash(i, 5)) * (c === ' ' ? 2.2 : 1));
      const tot = gaps.reduce((x, y) => x + y, 0);
      let acc = 0;
      this._times = gaps.map(g => (acc += g) / tot * (b - a) + a);
    }
    let n = 0;
    while (n < CMD.length && this._times[n] <= lb) n++;
    return n;
  },
  render(lb, t) {
    const K = TL.K, en = K.enter - 40;
    // ---- whip in from S5: content slides from the right, blurred ----
    const arr = ease.outExpo(prog(lb, -LEADB, 1.2));
    const wx = lerp(900, 0, arr);
    css(this.world, 'transform', `translateX(${f2(wx)}px)`);
    this.mb.set(this.world, perFrame(Math.abs(rate(b => lerp(900, 0, ease.outExpo(prog(b, -LEADB, 1.2))), lb))) * 0.5, 0);

    const p1 = ease.outQuart(prog(lb, 0.3, 1.4));
    this.l1.set(p1, (1 - p1) * 12); op(this.l1, p1 > 0 ? 1 : 0);

    // hero card: top right, gently tilted; the play button presses on return
    const press = lb > en && lb < en + 0.5 ? Math.sin(Math.PI * (lb - en) / 0.5) : 0;
    css(this.heroWrap, 'transform', `translate(960px, 84px) perspective(1600px) rotateY(-8deg) rotateX(4deg) scale(1.72)`);
    css(this.hero.act, 'transform', `scale(${(1 - 0.08 * press).toFixed(4)})`);
    css(this.hero.act, 'boxShadow', lb > en ? `0 0 ${f2(30 * Math.exp(-2 * (lb - en)))}px rgba(180,154,255,.6)` : 'none');
    this.hero.setTick((t * 80) % 360);

    // ---- console: types, returns, logs ----
    const n = this.typed(lb);
    const done = lb >= en;
    this.con.type(done ? '' : CMD.slice(0, n));
    // the caret blinks only while idle (the app's 1.05 s blink), solid while typing
    const typing = lb >= K.typeStart - 40 - 0.2 && lb < en;
    this.con.caret(typing || Math.floor(t / 0.525) % 2 === 0);
    show(this.echo, done); show(this.l_build, lb >= en + 0.15); show(this.l_play, lb >= en + 0.9);
    // camera: the console sits low and large, tracking the caret a little as the line grows
    const cs = 4.25;
    const track = -Math.max(0, n - 22) * 2.6 * (done ? 0 : 1);
    const settleTrack = done ? lerp(-Math.max(0, CMD.length - 22) * 2.6, 0, ease.outCubic(prog(lb, en, en + 1))) : track;
    const push = lerp(1, 1.04, ease.inOutSine(prog(lb, 1, en)));
    css(this.conWrap, 'transform', `translate(${f2(96 + settleTrack * cs)}px, ${f2(436 - (push - 1) * 300)}px) scale(${(cs * push).toFixed(4)})`);

    // ---- ring wipe: out of the prompt, its hole showing S7 ----
    const rp = prog(lb, 6.85, 8 - LEADB);
    if (rp > 0) {
      const ox = 96 + 150 * cs, oy = 436 + 132 * cs; // about where the prompt line sits after return
      const e = ease.inCubic(rp);
      const R = lerp(10, 2600, e), hole = R * lerp(0.44, 0.985, ease.inQuad(rp));
      this.ring.setAttribute('cx', f2(ox)); this.ring.setAttribute('cy', f2(oy));
      this.ring.setAttribute('r', f2((R + hole) / 2)); this.ring.setAttribute('stroke-width', f2(R - hole));
      const m = `radial-gradient(circle at ${f2(ox)}px ${f2(oy)}px, transparent ${f2(hole)}px, #000 ${f2(hole + 1)}px)`;
      css(this.el, 'webkitMaskImage', m); css(this.el, 'maskImage', m);
      show(this.ringSvg, true);
    } else {
      css(this.el, 'webkitMaskImage', ''); css(this.el, 'maskImage', '');
      show(this.ringSvg, false);
    }
  },
});
