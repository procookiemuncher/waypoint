// S7 · "Real roads. Real speed." (beats 48-56). The drive plays: MIA -> Faena Hotel on the real
// road-snapped line, the camera riding the marker heading-up over a tilted night map of Miami,
// the app's HUD reading position, mph and heading. Then a pull-out to the whole route and the
// app's ARRIVED toast as the marker reaches the hotel.
'use strict';

shot({
  name: 'drive', b0: 48, b1: 56, pre: 1.2, z: 55,
  build(el) {
    uiCss();
    const ci = LIB.cities.Miami;
    this.r = LIB.routes['mia-to-faena-miami'];
    this.bg = layer('', { background: '#0b0e17' });
    el.appendChild(this.bg);
    // the map plane: drawn once at 9 m/px around the route, posed in 3D every frame
    const MPP = 9;
    const fit = this.fit = fitCentre(25.80, -80.20, 0, 0, MPP);
    const geom = this.geom = routeGeom(fit, this.r.line);
    this.plane = h('div', { class: 'abs', style: { width: '10px', height: '10px', transformStyle: 'preserve-3d' } });
    const svg = s('svg', { width: 10, height: 10, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible' } });
    svg.appendChild(mapGroup('mia', fit, { lineScale: 1.6, rect: [-5000, -5000, 10000, 10000], pal: { water: '#0b0e17', ground: '#121318', coast: '#272b38', park: '#141a18', road: '#232838', road2: '#30364a' } }));
    this.ahead = s('path', { d: geom.d, fill: 'none', stroke: rgba(ci.color, 0.28), 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    svg.appendChild(this.ahead);
    this.done = routeGroup(geom, ci.color, 9, 34, 0.3);
    svg.appendChild(this.done);
    this.ends = endsGroup(geom, ci.color, 9, '#121318');
    svg.appendChild(this.ends);
    this.plane.appendChild(svg);
    this.marker = uiMarker(ci.color);
    css(this.marker, 'transform', 'scale(4.2)');
    this.markerWrap = h('div', { class: 'abs' }, [this.marker]);
    this.plane.appendChild(this.markerWrap);
    this.view = h('div', { class: 'layer', style: { perspective: '1300px', perspectiveOrigin: '50% 30%' } }, [this.plane]);
    el.appendChild(this.view);
    // fog toward the horizon
    el.appendChild(dithered(W, H, (x, y, o) => { o[0] = 11; o[1] = 14; o[2] = 23; o[3] = 255 * (1 - smoothstep(0.0, 0.42, y / H)) * 0.95; }, 0, 71, 2));

    // HUD (screen space, the app's chips at 2x)
    const hudWrap = h('div', { class: 'layer' });
    this.hPos = uiHud([['POS', '25.7952, -80.2802']]);
    this.hSpd = uiHud([['SPD', '35.0 mph'], ['HDG', '090° E']]);
    this.hEta = uiHud([['ETA', '19:42']]);
    for (const [e, l, tp] of [[this.hPos, 64, 236], [this.hSpd, 1330, 236], [this.hEta, 64, 980]]) {
      e.style.zoom = '2.4'; e.style.left = px(l / 2.4); e.style.top = px(tp / 2.4);
      hudWrap.appendChild(e);
    }
    el.appendChild(hudWrap);
    this.hud = hudWrap;
    this.np = uiNowPlaying('mia-to-faena-miami', 'drive');
    this.npWrap = h('div', { class: 'wp', style: { width: '400px', zoom: '2.2', left: px(1000 / 2.2), top: px(800 / 2.2), position: 'absolute' } }, [this.np]);
    el.appendChild(this.npWrap);
    this.toast = uiToast('ARRIVED · Faena Hotel');
    this.toast.style.zoom = '2.2';
    el.appendChild(this.toast);

    const type = { position: 'absolute', font: '600 136px/0.98 Inter', letterSpacing: '-0.045em', color: C.text };
    this.l1 = riseLine('Real roads.', { ...type, left: '92px', top: '330px' });
    this.l2 = riseLine('Real speed.', { ...type, left: '92px', top: '464px' });
    el.appendChild(this.l1); el.appendChild(this.l2);
    this.l1.style.zIndex = this.l2.style.zIndex = 20;
  },
  render(lb, t) {
    const K = TL.K, arrive = K.arrive1 - 48;
    // progress along the road: a steady time-lapse, then the last stretch while we pull out
    const u = spline(lb, [[-1.2, 0.0], [0, 0.03], [5, 0.36], [6.6, 0.98], [arrive, 1]], { v0: 0.02 });
    const p = this.geom.at(u);
    const head = this.geom.heading(u, 220);
    // camera: heading-up and close, then up and out to frame the whole route
    const out = ease.inOutCubic(prog(lb, 4.8, 6.9));
    const g = this.geom;
    let cx = 0, cy = 0;
    for (const q of [g.pts[0], g.pts[g.pts.length - 1]]) { cx += q[0] / 2; cy += q[1] / 2; }
    const fx = lerp(p.x, cx, out), fy = lerp(p.y, cy, out);
    // smooth the heading so corners don't snap the camera, and blend to north-up on the way out
    const rot = lerp(-head / DEG - 90, -8, out);
    const z = lerp(2.0, 0.34, ease.inOutCubic(out)) * lerp(1.06, 1, ease.outCubic(prog(lb, -1.2, 1.5)));
    const tilt = lerp(58, 14, out);
    css(this.plane, 'transform', `translate(${W / 2}px, ${H * 0.62}px) rotateX(${f2(tilt)}deg) rotate(${f2(rot)}deg) scale(${z.toFixed(5)}) translate(${f2(-fx)}px, ${f2(-fy)}px)`);
    css(this.plane, 'transformOrigin', '0 0');
    this.done.draw(u);
    css(this.markerWrap, 'transform', `translate(${f2(p.x)}px, ${f2(p.y)}px) scale(${f2(1 / Math.max(z, 0.35))})`);
    const ping = (lb * 1.25) % 1;
    css(this.marker.ring, 'transform', `scale(${(0.273 + 0.727 * ease.outCubic(ping)).toFixed(4)})`);
    op(this.marker.ring, 1 - ping);

    // HUD values from the route: real position, 35 mph with a little GPS breath, smoothed heading
    const [lat, lon] = unproject(this.fit, p.x, p.y);
    const hdg = ((head / DEG + 90) % 360 + 360) % 360;
    const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(hdg / 45) % 8];
    const arrived = lb >= arrive;
    const mph = arrived ? 0 : 35 + 0.35 * vnoise(t * 3, 9);
    this.hPos.set(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    this.hSpd.set(`${mph.toFixed(1)} mph`, `${String(Math.round(hdg)).padStart(3, '0')}° ${card}`);
    const total = this.r.meters / 15.65; // seconds at 35 mph
    const left = Math.max(0, (1 - u) * total);
    this.hEta.set(`${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
    this.np.set(u * total, u);
    const hudIn = ease.outCubic(prog(lb, 0.2, 1.2));
    op(this.hud, hudIn); op(this.npWrap, hudIn);

    // headline
    const p1 = ease.outQuart(prog(lb, 0.4, 1.5)), p2 = ease.outQuart(prog(lb, 1.0, 2.1));
    this.l1.set(p1, (1 - p1) * 12); this.l2.set(p2, (1 - p2) * 12);
    op(this.l1, p1 > 0 ? 1 - ease.inCubic(prog(lb, 5.6, 6.6)) : 0);
    op(this.l2, p2 > 0 ? 1 - ease.inCubic(prog(lb, 5.7, 6.7)) : 0);

    // arrival toast (app.css #toast: rises 16px and fades in)
    const tp = ease.outBack(clamp((lb - arrive) / 0.6), 2.2);
    show(this.toast, lb >= arrive);
    css(this.toast, 'left', px((W / 2) / 2.2 - this.toast.offsetWidth / 2));
    css(this.toast, 'top', px((H - 190) / 2.2 + (1 - tp) * 16));
    op(this.toast, clamp((lb - arrive) / 0.3));
  },
});
