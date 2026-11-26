// The "How it works" diagrams, drawn by hand in the brand: the three layers, the two location
// services side by side, and the movement pipeline. Facts are from AGENTS.md and
// docs/MOVEMENT_ENGINE.md; every word is outlines (svgkit), so they look the same everywhere.
import { text, lines, wrap, measure, arrow, svgDoc, write, card, ringEnd, dotEnd, leapMark, T, n1 } from './svgkit.mjs';

const NAME = { size: 44, weight: 600, tracking: -0.02, color: T.ink };
const BODY = { size: 28, weight: 400, color: T.ink2 };
const NOTE = { size: 28, weight: 400, color: T.muted };
const LABEL = { size: 26, weight: 500, color: T.muted };
const MONO = { font: 'mono', size: 27, weight: 500 };
const box = (x, y, w, h, fill = T.panel, rx = 20) => `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" rx="${rx}" fill="${fill}"/>`;
function fit(str, width, o) { if (measure(str, o) > width) throw new Error(`"${str}" is ${Math.round(measure(str, o))} px, room for ${width}`); return str; }

// ---------------------------------------------------------------- layers
{
  const W = 1800, P = 56;
  const SX = P, SW = 1290;                 // the stack
  const BH = 156, GAP = 72;
  const ys = [P, P + BH + GAP, P + 2 * (BH + GAP)];
  const H = ys[2] + BH + P;
  const DX = SX + 260;                     // details column
  const rows = [
    ['UI', ['Map page: Leaflet + MapLibre, the globe, ⌘K palette', 'pywebview window on Mac and Windows, or a browser'], T.panel, T.ink],
    ['Core', ['Session: one job at a time, Stop clears every sim', 'spoof (DVT) · drive (CoreDevice) · movement engine'], T.panel, T.ink],
    ['Adapter', ['device.py, the only app module that talks to pymobiledevice3', 'disk image · DVT set, play · CoreDevice set, route, clear'], T.tile, T.accent],
  ];
  let body = card(W, H);
  rows.forEach(([name, ls, fill, ink], i) => {
    const y = ys[i];
    body += box(SX + 16, y, SW - 16, BH, fill);
    body += text(name, { ...NAME, color: ink, x: SX + 56, y: y + BH / 2 + 16 });
    body += text(fit(ls[0], SX + SW - DX - 40, BODY), { ...BODY, x: DX, y: y + 66 });
    body += text(fit(ls[1], SX + SW - DX - 40, NOTE), { ...NOTE, x: DX, y: y + 110 });
  });
  // what crosses each boundary
  const ax = SX + 120;
  const between = [['HTTP on 127.0.0.1 (FastAPI, Host-checked)', 0], ['set · route · clear', 1]];
  for (const [lab, i] of between) {
    const y0 = ys[i] + BH + 8, y1 = ys[i + 1] - 8;
    body += arrow(ax, y0, ax, y1, { color: T.muted });
    body += text(lab, { ...LABEL, x: ax + 28, y: (y0 + y1) / 2 + 9 });
  }
  // the phone, and the one road to it
  const PX = SX + SW + 150, PW = W - P - PX - 16, PY = P + 40, PH = H - 2 * P - 80;
  body += `<rect x="${n1(PX)}" y="${n1(PY)}" width="${n1(PW)}" height="${n1(PH)}" rx="46" fill="${T.raised}"/>`;
  body += `<rect x="${n1(PX + PW / 2 - 46)}" y="${n1(PY + 22)}" width="92" height="26" rx="13" fill="${T.ground}"/>`;
  body += text('iPhone', { ...NAME, size: 38, x: PX + PW / 2, y: PY + 112, anchor: 'middle' });
  body += text('iOS 17+', { ...NOTE, size: 26, x: PX + PW / 2, y: PY + 152, anchor: 'middle' });
  const stops = ['location sim', 'CoreLocation', 'every app'];
  stops.forEach((s, i) => {
    const y = PY + 236 + i * 104;
    body += box(PX + 22, y - 40, PW - 44, 60, T.panel, 14);
    body += text(s, { ...BODY, size: 26, x: PX + PW / 2, y: y - 1, anchor: 'middle' });
    if (i) body += arrow(PX + PW / 2, y - 40 - 42, PX + PW / 2, y - 44, { color: T.muted, w: 2.5, head: 11 });
  });
  const ay = ys[2] + BH / 2;
  body += arrow(SX + SW + 8, ay, PX - 10, ay, { color: T.accent, w: 4, head: 16 });
  body += text('USB', { ...LABEL, color: T.ink2, x: (SX + SW + PX) / 2, y: ay - 22, anchor: 'middle' });
  body += text('RemoteXPC', { ...LABEL, x: (SX + SW + PX) / 2, y: ay + 44, anchor: 'middle' });
  body += text('tunnel', { ...LABEL, x: (SX + SW + PX) / 2, y: ay + 78, anchor: 'middle' });
  write('layers.svg', svgDoc(W, H, body, {
    title: 'Three layers: UI, Core, Adapter, then the iPhone',
    desc: 'The UI talks HTTP to the Core on 127.0.0.1. The Core asks the Adapter to set, route or clear. In the app only the Adapter, device.py, talks to pymobiledevice3, which reaches the phone over USB through the RemoteXPC tunnel. On the phone the location simulation feeds CoreLocation, so every app sees it.',
  }));
}

// ---------------------------------------------------------------- the two services
{
  const W = 1800, P = 56, LH = 236, LG = 40;
  const H = P * 2 + LH * 2 + LG;
  const cols = { a: [P, 500], b: [P + 500 + 330, 420], c: [P + 500 + 330 + 420 + 110, 0] };
  cols.c[1] = W - P - cols.c[0];
  const lanes = [
    { engine: 'spoof', service: 'DVT simulate-location', sends: 'lat, lon', sends2: 'no speed field', speed: 'speed −1', speed2: 'no valid speed', show: 'a dot at 0 mph', show2: 'position only', hi: T.muted, fill: T.panel },
    { engine: 'drive', service: 'CoreDevice location service', sends: 'waypoints + speed', sends2: 'and pacing', speed: 'speed 15.6 m/s', speed2: 'that is 35 mph', show: 'a drive at 35 mph', show2: 'like a real trip', hi: T.accent, fill: T.tile },
  ];
  let body = card(W, H);
  lanes.forEach((L, i) => {
    const y = P + i * (LH + LG), mid = y + LH / 2;
    const [ax, aw] = cols.a, [bx, bw] = cols.b, [cx, cw] = cols.c;
    body += box(ax, y, aw, LH, T.panel);
    body += text(L.engine, { ...NAME, x: ax + 44, y: y + 96 });
    body += text(L.service, { ...NOTE, x: ax + 44, y: y + 150 });
    // what goes over the wire: the whole difference
    body += arrow(ax + aw + 14, mid, bx - 14, mid, { color: L.hi, w: 4, head: 16 });
    body += text(L.sends, { ...MONO, color: i ? T.accent : T.ink2, x: (ax + aw + bx) / 2, y: mid - 26, anchor: 'middle' });
    body += text(L.sends2, { ...LABEL, x: (ax + aw + bx) / 2, y: mid + 52, anchor: 'middle' });
    body += box(bx, y, bw, LH, L.fill);
    body += text('iOS reports', { ...LABEL, x: bx + 40, y: y + 64 });
    body += text(L.speed, { ...MONO, size: 40, color: i ? T.accent : T.amber, x: bx + 40, y: y + 134 });
    body += text(L.speed2, { ...NOTE, size: 26, x: bx + 40, y: y + 188 });
    body += arrow(bx + bw + 14, mid, cx - 14, mid, { color: T.muted, w: 3 });
    body += text('apps show', { ...LABEL, x: cx, y: y + 64 });
    body += text(L.show, { ...NAME, size: 40, color: T.ink, x: cx, y: y + 134 });
    body += text(L.show2, { ...NOTE, x: cx, y: y + 188 });
  });
  write('services.svg', svgDoc(W, H, body, {
    title: 'Two location services: DVT simulate-location versus the CoreDevice location service',
    desc: 'spoof uses DVT simulate-location, which takes only latitude and longitude, so iOS reports speed -1 and apps show a dot with no mph. drive uses the CoreDevice location service, which takes waypoints and a speed, so iOS reports a real speed and apps show a car at 35 mph.',
  }));
}

// ---------------------------------------------------------------- the movement pipeline
{
  const W = 1800, P = 56;
  const stations = [
    ['Route JSON', ['airport → spot,', 'from the catalog']],
    ['Snap', ['Valhalla lays it', 'on real roads']],
    ['Road data', ['speed limits,', 'lights, junctions']],
    ['Driver', ['red lights, stops,', 'turns, GPS jitter']],
    ['Validator', ['refuses impossible', 'speed or braking']],
    ['Timed fixes', ['position + speed,', 'in drive chunks']],
    ['iPhone', ['CoreDevice sim,', 'real speed']],
  ];
  const LY = 196, x0 = P + 92, x1 = W - P - 92, step = (x1 - x0) / (stations.length - 1);
  const colW = step - 18;
  const H = LY + 196 + P;
  let body = card(W, H);
  body += `<path d="M${x0} ${LY}H${x1}" stroke="${T.accent}" stroke-width="6" stroke-linecap="round"/>`;
  const NM = { ...NAME, size: 34 }, DT = { ...BODY, size: 25, color: T.ink2 };
  stations.forEach(([name, det], i) => {
    const x = x0 + i * step;
    if (i === 0) body += ringEnd(x, LY, 17, T.accent, T.ground);
    else if (i === stations.length - 1) body += dotEnd(x, LY, 17, T.accent);
    else body += `<circle cx="${n1(x)}" cy="${LY}" r="13" fill="${T.ground}" stroke="${T.accent}" stroke-width="6"/>`;
    body += text(fit(name, colW, NM), { ...NM, x, y: LY + 80, anchor: 'middle' });
    det.forEach((d, k) => { body += text(fit(d, colW, DT), { ...DT, color: k ? T.muted : T.ink2, x, y: LY + 128 + k * 38, anchor: 'middle' }); });
  });
  // the seed: one number in, the same drive out
  const dx = x0 + 3 * step;
  const sw = measure('seed', { ...MONO, size: 26 }) + 44;
  body += `<rect x="${n1(dx - sw / 2)}" y="${P - 8}" width="${n1(sw)}" height="50" rx="25" fill="${T.tile}"/>`;
  body += text('seed', { ...MONO, size: 26, color: T.accent, x: dx, y: P + 26, anchor: 'middle' });
  body += arrow(dx, P + 48, dx, LY - 24, { color: T.accent, w: 3, head: 12 });
  body += text('same seed, same drive, call for call', { ...LABEL, x: dx + sw / 2 + 22, y: P + 26 });
  write('pipeline.svg', svgDoc(W, H, body, {
    title: 'The movement pipeline, from route file to phone',
    desc: 'A route JSON is snapped to real roads by Valhalla, gets road data (speed limits, lights, junctions), is driven by a driver model (red lights, stop signs, turns, GPS jitter), checked by a validator that refuses impossible speed or braking, turned into timed fixes and played on the phone through the CoreDevice simulation at real speed. A seed makes the drive identical every time.',
  }));
}
