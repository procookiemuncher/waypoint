// S11 · resolve (beats 80-93). The music drops into its breakdown and the Leap builds one last time,
// at icon scale: ring, arc, landing dot, then the tile forms behind it, ending exactly on the master
// icon (mac-version/app/icon.svg). The wordmark slides out of it into the horizontal lockup (gap =
// the landing dot's diameter), the tagline lands under it, and the film fades out.
'use strict';

shot({
  name: 'resolve', b0: 80, b1: 93, post: 0.2, z: 100,
  build(el) {
    this.bg = dithered(W, H, (x, y, o) => {
      const v = 1 - smoothstep(0, 0.7, Math.hypot((x - W / 2) / W, (y - H / 2) / (H * 1.3)));
      o[0] = lerp(4, 13, v); o[1] = lerp(5, 11, v); o[2] = lerp(8, 19, v);
    }, 0.02, 91, 2);
    el.appendChild(this.bg);
    this.group = h('div', { class: 'layer' });
    el.appendChild(this.group);
    // the icon at a 300 px tile: box = 300 * 1024 / 824
    const TILE = this.TILE = 300, box = TILE * ICON.box / ICON.tile, u = TILE / ICON.tile; // px per icon unit
    this.iconBox = box;
    this.svg = s('svg', { width: box, height: box, viewBox: '0 0 1024 1024', style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } });
    this.tile = s('rect', { x: 100, y: 100, width: 824, height: 824, rx: ICON.rx, fill: C.tile });
    this.svg.appendChild(this.tile);
    this.leap = makeLeap(C.accent);
    this.leap.setAttribute('transform', `translate(512 512) scale(${ICON.markScale}) translate(${-LEAP.centre[0]} ${-LEAP.centre[1]})`);
    this.svg.appendChild(this.leap);
    this.iconWrap = h('div', { class: 'abs', style: { width: px(box), height: px(box) } }, [this.svg]);
    this.group.appendChild(this.iconWrap);
    // wordmark: Inter 600, cap height ~0.42 of the tile, gap = the landing dot's diameter
    this.dotD = 2 * LEAP.dotR * ICON.markScale * u; // ~38 px at a 300 tile... measured in icon units
    this.word = h('div', { class: 'abs', text: 'Waypoint', style: { font: '600 172px/1 Inter', letterSpacing: '-0.035em', color: C.text, whiteSpace: 'nowrap' } });
    this.wordClip = h('div', { class: 'abs', style: { overflow: 'hidden', height: '230px' } }, [this.word]);
    this.group.appendChild(this.wordClip);
    this.tag = h('div', { class: 'abs', text: 'From here to anywhere.', style: { font: '500 46px/1.2 Inter', letterSpacing: '-0.015em', color: C.body, whiteSpace: 'nowrap' } });
    this.group.appendChild(this.tag);
    this.mac = h('div', { class: 'abs', text: 'for Mac', style: { font: '500 30px/1.2 Inter', letterSpacing: '-0.005em', color: C.muted, whiteSpace: 'nowrap' } });
    this.group.appendChild(this.mac);
    this.shine = h('div', { class: 'abs', style: { width: '260px', height: '230px', background: 'linear-gradient(100deg, transparent, rgba(255,255,255,.55), transparent)', mixBlendMode: 'overlay' } });
    this.wordClip.appendChild(this.shine);
    // billing line: the map data's required attribution and the music
    this.credits = h('div', { class: 'abs', text: 'Map data \u00a9 OpenStreetMap contributors \u00b7 Natural Earth \u00b7 Music \u201cRising Forest\u201d by Diego Nava (Mixkit)',
      style: { left: '0', width: px(W), top: '1014px', textAlign: 'center', font: '500 17px/1 Inter', letterSpacing: '0.01em', color: '#5b606c' } });
    el.appendChild(this.credits);
    this.black = layer('', { background: '#000', opacity: 0 });
    el.appendChild(this.black);
  },
  render(lb, t) {
    const K = TL.K, wm = K.wordmark - 80, tg = K.tagline - 80;
    if (!this._m) { // measure once, fonts are in
      this._m = { ww: this.word.getBoundingClientRect().width };
    }
    const box = this.iconBox, TILE = this.TILE;
    const gap = 2 * LEAP.dotR * ICON.markScale * (TILE / ICON.tile);
    // lockup geometry, centred on the frame as a whole
    const lockW = TILE + gap + this._m.ww;
    const lx = (W - lockW) / 2 - (box - TILE) / 2;             // icon box left so the tile starts the lockup
    const iconCx = W / 2, iconCy = H / 2 - 66;
    // the icon starts centred alone, then slides left as the word comes out of it
    const slide = ease.inOutCubic(prog(lb, wm, wm + 1.4));
    const ix = lerp(iconCx - box / 2, lx, slide), iy = iconCy - box / 2;
    // build big: ring, arc, dot (the mark's own order) at 2.6x in the middle of the frame; once the
    // dot has landed the whole mark settles down to icon size as the tile forms around it
    const settle = ease.inOutCubic(prog(lb, 2.05, 3.05));
    const big = lerp(2.6, 1, settle);
    css(this.iconWrap, 'transformOrigin', '50% 50%');
    css(this.iconWrap, 'transform', `translate(${f2(ix)}px, ${f2(iy)}px) scale(${big.toFixed(4)})`);
    const ringT = ease.outCubic(prog(lb, 0.05, 0.95));
    const arcT = ease.inOutCubic(prog(lb, 0.7, 1.75));
    const land = lb - 1.85;
    const dotS = land > 0 ? spring(land, 1.5, 0.42) : 0;
    const tileP = ease.outExpo(prog(lb, 2.15, 3.2));
    const settled = lb > 4.5;
    this.leap.set(ringT, arcT, settled ? 1 : dotS, { solid: settled, ringSpin: lerp(-120, 0, ringT) });
    this.tile.setAttribute('transform', `translate(512 512) scale(${tileP.toFixed(4)}) translate(-512 -512)`);
    this.tile.setAttribute('rx', f2(lerp(412, ICON.rx, tileP)));
    op(this.tile, tileP > 0 ? 1 : 0);
    // whole lockup: a slow push across the shot
    const push = lerp(0.97, 1.03, ease.inOutSine(prog(lb, 0, 13)));
    css(this.group, 'transformOrigin', `${W / 2}px ${H / 2}px`);
    css(this.group, 'transform', `scale(${push.toFixed(5)})`);

    // wordmark: revealed from the icon's edge (clip slides with the icon)
    const tileRight = ix + (box + TILE) / 2;
    const wx = tileRight + gap;
    // Inter: ascender 0.96875em, descender 0.2421875em, cap height 0.727em. With line-height 1 the
    // baseline sits 0.96875em - (1.2109em - 1em) / 2 below the line box top; put the cap band's
    // middle on the tile's centre
    const fs = 172, base = fs * (0.96875 - (1.2109375 - 1) / 2);
    const wy = iconCy + 0.727 * fs / 2 - base;
    css(this.wordClip, 'transform', `translate(${f2(wx)}px, ${f2(wy - 20)}px)`);
    css(this.wordClip, 'width', px(Math.max(0, (this._m.ww + 30) * slide)));
    const wIn = ease.outCubic(prog(lb, wm + 0.2, wm + 1.5));
    css(this.word, 'transform', `translate(${f2((1 - wIn) * -120)}px, 20px)`);
    // a light passes once across the word
    const sh = prog(lb, wm + 2.2, wm + 3.4);
    css(this.shine, 'transform', `translate(${f2(lerp(-300, this._m.ww + 40, ease.inOutSine(sh)))}px, 0)`);
    op(this.shine, sh > 0 && sh < 1 ? 1 : 0);

    // tagline + for Mac
    const tp = ease.outQuart(prog(lb, tg, tg + 1.1));
    css(this.tag, 'transform', `translate(${f2(lx + (box - TILE) / 2)}px, ${f2(iconCy + TILE / 2 + 64 + (1 - tp) * 26)}px)`);
    op(this.tag, tp);
    const mp = ease.outQuart(prog(lb, tg + 0.9, tg + 2.0));
    css(this.mac, 'transform', `translate(${f2(lx + (box - TILE) / 2)}px, ${f2(iconCy + TILE / 2 + 132 + (1 - mp) * 20)}px)`);
    op(this.mac, mp);
    op(this.credits, ease.outCubic(prog(lb, tg + 1.6, tg + 2.6)));
    // fade to black over the last beat and a half
    op(this.black, ease.inQuad(prog(lb, 11.4, 13 - LEADB)));
  },
});
