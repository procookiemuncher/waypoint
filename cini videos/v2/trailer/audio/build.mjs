// The trailer's soundtrack, exactly 45.000 s at 48 kHz: Rising Forest cut so its big drop lands on
// film beat 16 (the shutter), synthesized SFX on the picture's cues, mastered to -14 LUFS / -1 dBTP.
// Every cue time comes from js/timeline.js, the same table the picture is drawn from.
//
//   node audio/build.mjs        -> out/audio/trailer.wav (+ stems in out/audio/)
//
// Rising Forest (Diego Nava, Mixkit, free licence) is 124.00 BPM as published (audio/analyze.mjs),
// so it plays at its own speed. Source bar 24 (46.45 s) is the drop after the eight-bar
// breakdown; starting four bars earlier puts the build under the cold open, the 16 bars after the
// drop under the features, and the next breakdown under the end card.
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { decode, writeWav, meter, ffmpeg, rng, undb, SR, ROOT } from './dsp.mjs';

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'timeline.js'), 'utf8'), ctx);
const TL = ctx.TL, K = TL.K;
const BEAT = 60 / TL.bpm;
const bt = b => b * BEAT;
const OUT = path.join(ROOT, 'out', 'audio');
const SRC = path.join(ROOT, 'cache', 'music', '471.mp3');
const LEN = Math.round(TL.dur * SR); // 2,160,000 samples
const TARGET_I = -14, CEIL_TP = -1.3; // a little under -1 so the AAC encode can't push it over
fs.mkdirSync(OUT, { recursive: true });
const mk = () => [new Float32Array(LEN), new Float32Array(LEN)];

// ---------- music ----------
const [mL, mR] = decode(SRC);
function kickOnset(t, x = mL) {
  // the kick's attack: the first 0.5 ms window whose peak more than doubles the loudest window
  // of the 25 ms before it
  const Wn = 24, at = s => { let p = 0; for (let i = s; i < s + Wn; i++) p = Math.max(p, Math.abs(x[i])); return p; };
  const s0 = Math.round((t - 0.012) * SR);
  let base = 0;
  for (let s = s0 - Math.round(0.025 * SR); s < s0; s += Wn) base = Math.max(base, at(s));
  for (let s = s0; s < s0 + Math.round(0.03 * SR); s += 4) if (at(s) > 2 * base) return (s + Wn / 2) / SR;
  throw new Error('no kick near ' + t);
}
const DROP_SRC = kickOnset(46.4506);
const offset = Math.round(DROP_SRC * SR) - Math.round(bt(K.drop) * SR);
const music = mk();
for (let i = 0; i < LEN; i++) { music[0][i] = mL[offset + i] || 0; music[1][i] = mR[offset + i] || 0; }
for (let i = 0; i < 96; i++) { const g = 0.5 - 0.5 * Math.cos(Math.PI * i / 96); music[0][i] *= g; music[1][i] *= g; }
console.log(`music: drop kick in source at ${DROP_SRC.toFixed(4)} s, cut from ${(offset / SR).toFixed(4)} s (bar ${((offset / SR) / (4 * BEAT)).toFixed(2)})`);

// ---------- synth helpers ----------
const noise = (n, seed) => { const r = rng(seed), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; return x; };
const pink = (n, seed) => {
  const w = noise(n, seed), x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    b0 = 0.99765 * b0 + w[i] * 0.0990460; b1 = 0.96300 * b1 + w[i] * 0.2965164; b2 = 0.57000 * b2 + w[i] * 1.0526913;
    x[i] = (b0 + b1 + b2 + w[i] * 0.1848) * 0.2;
  }
  return x;
};
// zero-delay state variable filter with a cutoff that can move every sample
function svf(x, fc, q, mode = 'bp', t0 = 0) {
  const y = new Float32Array(x.length);
  let ic1 = 0, ic2 = 0;
  const k = 1 / q;
  for (let i = 0; i < x.length; i++) {
    const f = typeof fc === 'function' ? fc(t0 + i / SR) : fc;
    const g = Math.tan(Math.PI * Math.min(f, SR * 0.45) / SR);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x[i] - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    y[i] = mode === 'bp' ? v1 * k : mode === 'lp' ? v2 : x[i] - k * v1 - v2;
  }
  return y;
}
const env = (n, fn) => { const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = fn(i / SR); return e; };
const mul = (a, b) => { const y = new Float32Array(a.length); for (let i = 0; i < a.length; i++) y[i] = a[i] * b[i]; return y; };
const peakOf = x => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; };
const norm = (x, dbfs) => { const g = undb(dbfs) / (peakOf(x) || 1); for (let i = 0; i < x.length; i++) x[i] *= g; return x; };
const clamp1 = v => Math.max(-1, Math.min(1, v));
function pan(x, p) {
  const L = new Float32Array(x.length), R = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const a = (clamp1(typeof p === 'function' ? p(i / SR) : p) + 1) * Math.PI / 4;
    L[i] = x[i] * Math.cos(a); R[i] = x[i] * Math.sin(a);
  }
  return [L, R];
}
const sfx = mk();
const add = (t0, L, R = L, gain = 1) => {
  const s0 = Math.round(t0 * SR);
  for (let i = 0; i < L.length; i++) {
    const k = s0 + i;
    if (k < 0 || k >= LEN) continue;
    sfx[0][k] += L[i] * gain; sfx[1][k] += R[i] * gain;
  }
};
const cues = []; // for audio/cues.mjs: [name, t0, t1, lo, hi]

// ---------- cue builders ----------
// low impact: a pitched-down sine thump with a crack and a reverse swell into it
function impact(t, { lvl = -6, pre = 0.2, f = 46, dec = 0.45, crack = 0.5, swell = 0.35, seed = 1, name = 'impact' } = {}) {
  const n = Math.round((pre + 1.6) * SR);
  const boom = env(n, tt => { const u = tt - pre; if (u < 0) return 0; return Math.sin(2 * Math.PI * (f * u + 40 * 0.04 * (1 - Math.exp(-u / 0.04)))) * (1 - Math.exp(-u / 0.002)) * Math.exp(-u / dec); });
  const cr = mul(svf(noise(n, seed), 1500, 0.8, 'bp'), env(n, tt => { const u = tt - pre; return u < 0 ? 0 : Math.exp(-u / 0.035); }));
  const sw = mul(svf(pink(n, seed + 7), tt => 600 + 4000 * Math.pow(Math.min(1, tt / pre), 2), 1.2, 'bp'), env(n, tt => (tt < pre ? Math.pow(tt / pre, 2.5) : Math.exp(-(tt - pre) / 0.02))));
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = boom[i] + crack * cr[i] + swell * sw[i];
  norm(x, lvl);
  add(t - pre, x, x.map((v, i) => v * 0.94 + boom[i] * 0.06 * undb(lvl)));
  cues.push([name, t, t + 0.3, 40, 200]);
}
// whoosh: filtered noise swelling into a peak at t and dropping off, sweeping across the field
function whoosh(t, { pre = 0.4, post = 0.5, from = -0.6, to = 0.6, lvl = -8, top = 2800, seed = 11, name = 'whoosh' } = {}) {
  const n = Math.round((pre + post) * SR);
  const shape = u => (u < pre ? Math.pow(Math.max(0, u / pre), 3.0) : Math.exp(-(u - pre) / (post * 0.18)));
  const fc = u => 220 + (top - 220) * (u < pre ? Math.pow(u / pre, 2) : Math.exp(-(u - pre) / (post * 0.3)));
  const a = svf(pink(n, seed), fc, 1.6, 'bp'), b = svf(pink(n, seed + 50), u => fc(u) * 0.5, 0.9, 'bp');
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (a[i] + 0.8 * b[i]) * shape(i / SR);
  norm(x, lvl);
  const [L, R] = pan(x, u => from + (to - from) * Math.min(1, u / (pre + 0.1)));
  add(t - pre, L, R);
  cues.push([name, t - pre * 0.6, t + 0.05, 300, 3000]);
}
// click: a short bright transient with a little body (mouse, keys, return)
function click(t, { lvl = -10, f0 = 3400, body = 1750, dec = 0.0022, seed = 31, p = 0, name = 'click' } = {}) {
  const n = Math.round(0.04 * SR);
  const tick = mul(svf(noise(n, seed), f0, 1.4, 'bp'), env(n, u => Math.exp(-u / dec)));
  const bd = env(n, u => Math.sin(2 * Math.PI * body * u) * Math.exp(-u / 0.004));
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = tick[i] + 0.4 * bd[i];
  norm(x, lvl);
  const [L, R] = pan(x, p);
  add(t, L, R);
  if (name) cues.push([name, t, t + 0.03, 2500, 6000]);
}
// a soft pitched blip (UI confirmations): sine + octave, quick attack, short ring
function blip(t, freq, { lvl = -13, dec = 0.16, p = 0, name = 'blip' } = {}) {
  const n = Math.round((dec * 5) * SR);
  const x = env(n, u => (Math.sin(2 * Math.PI * freq * u) + 0.35 * Math.sin(2 * Math.PI * freq * 2 * u) + 0.12 * Math.sin(2 * Math.PI * freq * 3 * u))
    * (1 - Math.exp(-u / 0.002)) * Math.exp(-u / dec));
  norm(x, lvl);
  const [L, R] = pan(x, p);
  add(t, L, R);
  if (name) cues.push([name, t, t + 0.1, freq * 0.8, freq * 3.5]);
}
// shimmer: detuned high partials that ring out
function shimmer(t, dur, { lvl = -12, seed = 51, base = 1318.5, name = 'shimmer' } = {}) {
  const n = Math.round(dur * SR);
  const r = rng(seed);
  const parts = [1, 1.5, 2, 2.378, 3, 4].map(m => base * m);
  const L = new Float32Array(n), R = new Float32Array(n);
  parts.forEach((f, j) => {
    for (const det of [-1, 1]) {
      const ff = f * (1 + det * 0.0016), ph = r() * 2 * Math.PI, side = det * (0.3 + 0.5 * r());
      const amp = 1 / (1 + j * 0.55), dec = (0.9 - j * 0.09) * dur / 2.2, trem = 4 + 3 * r();
      for (let i = 0; i < n; i++) {
        const u = i / SR;
        const v = Math.sin(2 * Math.PI * ff * u + ph) * amp * (1 - Math.exp(-u / 0.03)) * Math.exp(-u / dec) * (0.85 + 0.15 * Math.sin(2 * Math.PI * trem * u));
        L[i] += v * (1 - side) / 2; R[i] += v * (1 + side) / 2;
      }
    }
  });
  const sp = mul(svf(noise(n, seed + 1), 7000, 2, 'bp'), env(n, u => (1 - Math.exp(-u / 0.02)) * Math.exp(-u / 0.35)));
  for (let i = 0; i < n; i++) { L[i] += 0.5 * sp[i]; R[i] += 0.5 * sp[i]; }
  const g = undb(lvl) / Math.max(peakOf(L), peakOf(R));
  add(t, L, R, g);
  cues.push([name, t, t + 0.5, 1300, 6000]);
}
// riser: noise climbing in pitch and level into t1
function riser(t0, t1, { lvl = -14, seed = 61, from = 300, top = 6000, name = 'riser' } = {}) {
  const d = t1 - t0, n = Math.round((d + 0.05) * SR);
  const x = mul(svf(pink(n, seed), u => from * Math.pow(top / from, Math.min(1, u / d)), 2.2, 'bp'), env(n, u => Math.pow(Math.min(1, u / d), 2.2) * (u > d ? Math.exp(-(u - d) / 0.01) : 1)));
  norm(x, lvl);
  const [L, R] = pan(x, u => 0.4 * Math.sin(u * 3));
  add(t0, L, R);
  cues.push([name, t1 - 0.3, t1, 1000, 6000]);
}

// ---------- the cues, on the film's beats ----------
const B = b => bt(b);
// S1: a soft open, the arc's travel, the dot landing, the iris
impact(B(0) + 0.02, { lvl: -16, pre: 0.01, f: 40, dec: 0.5, crack: 0.15, swell: 0, seed: 2, name: 'open' });
whoosh(B(4.6), { pre: 0.9, post: 0.7, from: -0.7, to: 0.5, lvl: -11, top: 1800, seed: 12, name: 'arc travel' });
impact(B(K.dotLand), { lvl: -7, pre: 0.12, f: 50, dec: 0.38, crack: 0.45, swell: 0.4, seed: 3, name: 'dot lands' });
blip(B(K.dotLand) + 0.01, 1567.98, { lvl: -16, dec: 0.5, name: 'dot ping' });
whoosh(B(8), { pre: 0.36, post: 0.4, from: 0.5, to: -0.3, lvl: -9, top: 3200, seed: 13, name: 'iris' });
// S2: the wire lights, three checks climb a little arpeggio, then the riser into the drop
riser(B(8.4), B(10.2), { lvl: -15, seed: 62, from: 900, top: 5000, name: 'wire' });
K.checks.forEach((b, i) => { blip(B(b), [1046.5, 1318.5, 1568][i], { lvl: -12, dec: 0.12, p: (i - 1) * 0.3, name: 'check ' + (i + 1) }); click(B(b), { lvl: -16, f0: 4200, seed: 70 + i, name: '' }); });
blip(B(K.ready), 2093, { lvl: -13, dec: 0.3, name: 'ready' });
riser(B(14), B(16) - 0.02, { lvl: -12, seed: 63, from: 400, top: 9000, name: 'drop riser' });
// S3: the drop and the shutter
impact(B(K.drop), { lvl: -3, pre: 0.22, f: 44, dec: 0.6, crack: 0.6, swell: 0.4, seed: 21, name: 'DROP' });
whoosh(B(17.6), { pre: 0.7, post: 0.5, from: 0, to: 0, lvl: -14, top: 1600, seed: 14, name: 'shutter' });
whoosh(B(24), { pre: 0.5, post: 0.4, from: -0.5, to: 0.6, lvl: -6, top: 3400, seed: 15, name: 'into map' });
// S4: the sweep, the panel, the click, the swell
whoosh(B(25.9), { pre: 1.0, post: 0.6, from: -0.8, to: 0.8, lvl: -11, top: 5200, seed: 16, name: 'sweep' });
whoosh(B(K.cardsIn + 0.6), { pre: 0.45, post: 0.5, from: 0.8, to: 0.2, lvl: -8, top: 2400, seed: 17, name: 'panel in' });
click(B(K.clickCity), { lvl: -1, seed: 32, name: 'click Miami' });
whoosh(B(32), { pre: 0.5, post: 0.4, from: -0.2, to: 0.3, lvl: -7, top: 3000, seed: 18, name: 'into city' });
// S5: counters, chips
for (let k = 0; k < 10; k++) click(B(33 + k * 0.16), { lvl: -7, f0: 5200, body: 2600, seed: 200 + k, p: 0.3, name: k ? '' : 'count' });
for (let k = 0; k < 4; k++) whoosh(B(33.9 + k * 0.3), { pre: 0.12, post: 0.15, from: 0.6, to: 0.2, lvl: -10, top: 4000, seed: 120 + k, name: k ? '' : 'chips' });
// S6: whip, typing, return, the ring
whoosh(B(40), { pre: 0.3, post: 0.35, from: 0.8, to: -0.4, lvl: -8, top: 3600, seed: 19, name: 'whip' });
{
  const CMD = 'play mia-to-faena-miami --drive --mph 35';
  const a = K.typeStart, b = K.typeEnd;
  const gaps = [...CMD].map((c, i) => (0.7 + 0.6 * ((x => { let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(5, 0x27d4eb2d); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; })(i))) * (c === ' ' ? 2.2 : 1));
  const tot = gaps.reduce((x, y) => x + y, 0);
  let acc = 0;
  const r = rng(41);
  gaps.forEach((g, j) => {
    acc += g;
    const tb_ = acc / tot * (b - a) + a; // the beat the j-th character appears (same as s06 typed())
    click(B(tb_ - 40 + 40) - 0.004, { lvl: -3 - 3 * r(), f0: 3000 + 2000 * r(), body: 1000 + 400 * r(), dec: 0.0035 + 0.0015 * r(), seed: 300 + j, p: (r() - 0.5) * 0.5, name: j ? '' : 'keys' });
  });
}
click(B(K.enter), { lvl: -2, f0: 2600, body: 900, dec: 0.004, seed: 33, name: 'return' });
blip(B(K.enter) + 0.03, 1318.5, { lvl: -14, dec: 0.2, name: 'play' });
whoosh(B(48), { pre: 0.55, post: 0.45, from: -0.3, to: 0.5, lvl: -8, top: 2800, seed: 20, name: 'ring wipe' });
// S7: arrival chime
blip(B(K.arrive1), 1568, { lvl: -12, dec: 0.25, p: -0.2, name: 'arrived 1' });
blip(B(K.arrive1) + 0.12, 2093, { lvl: -13, dec: 0.35, p: 0.2, name: '' });
// S8: cut, offline (power-down), the flight's air, landing, the dive, arrival
whoosh(B(56), { pre: 0.4, post: 0.4, from: 0.6, to: -0.4, lvl: -9, top: 3000, seed: 22, name: 'to the coast' });
{
  const t0 = B(K.offline), d = 0.35, n = Math.round((d + 0.2) * SR);
  const x = env(n, u => Math.sin(2 * Math.PI * (880 * u - 880 * 0.6 * u * u / (2 * d))) * Math.exp(-u / 0.18) * (1 - Math.exp(-u / 0.003)));
  norm(x, -15);
  add(t0, x, x);
  cues.push(['offline', t0, t0 + 0.2, 300, 1500]);
  const air = bt(K.online) - t0, m = Math.round(air * SR);
  const w = mul(svf(pink(m, 81), 520, 0.6, 'lp'), env(m, u => Math.min(1, u / 0.4) * Math.min(1, (air - u) / 0.15)));
  norm(w, -20);
  const [L, R] = pan(w, u => 0.3 * Math.sin(u * 1.3));
  add(t0, L, R);
}
impact(B(K.online), { lvl: -6, pre: 0.14, f: 52, dec: 0.4, crack: 0.5, swell: 0.5, seed: 23, name: 'landing' });
whoosh(B(K.online + 1.2), { pre: 0.6, post: 0.5, from: 0.4, to: -0.4, lvl: -12, top: 2200, seed: 24, name: 'dive' });
blip(B(K.arrive2), 1568, { lvl: -12, dec: 0.25, p: -0.2, name: 'arrived 2' });
blip(B(K.arrive2) + 0.12, 2093, { lvl: -13, dec: 0.35, p: 0.2, name: '' });
// S9: a swish on every chapter cut, alternating sides
for (let k = 0; k < 8; k++) whoosh(B(64 + k), { pre: 0.14, post: 0.2, from: k % 2 ? 0.7 : -0.7, to: k % 2 ? -0.2 : 0.2, lvl: -9, top: 5200, seed: 140 + k, name: k ? '' : 'chapters' });
// S10: each figure rolls in
for (let k = 0; k < 4; k++) {
  for (let j = 0; j < 4; j++) click(B(72 + 2 * k) + j * 0.022, { lvl: -16 - j * 2, f0: 3800, body: 1400, seed: 400 + k * 4 + j, name: '' });
  blip(B(72 + 2 * k) + 0.02, [523.25, 587.33, 659.25, 783.99][k], { lvl: -17, dec: 0.18, name: k ? '' : 'figures' });
}
// S11: the last landing, the word, the shimmer
impact(B(K.resolve), { lvl: -5, pre: 0.25, f: 40, dec: 0.9, crack: 0.3, swell: 0.6, seed: 25, name: 'resolve' });
impact(B(81.85), { lvl: -11, pre: 0.08, f: 58, dec: 0.3, crack: 0.25, swell: 0.2, seed: 26, name: 'logo dot' });
blip(B(81.85) + 0.01, 1567.98, { lvl: -15, dec: 0.6, name: 'logo ping' });
whoosh(B(K.wordmark + 0.6), { pre: 0.5, post: 0.6, from: -0.3, to: 0.6, lvl: -14, top: 2200, seed: 27, name: 'wordmark' });
shimmer(B(K.wordmark + 2.2), 3.2, { lvl: -14, seed: 52, name: 'shine' });

// ---------- a little room on the SFX (Freeverb-style), so they sit with the track ----------
function reverb([L, R], { size = 0.8, damp = 0.35, wet = 0.18 } = {}) {
  const sc = SR / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], apT = [556, 441, 341, 225];
  const run = (x, spread) => {
    const y = new Float32Array(x.length);
    for (const T of combT) {
      const d = Math.round((T + spread) * sc), buf = new Float32Array(d);
      let idx = 0, store = 0;
      for (let i = 0; i < x.length; i++) {
        const out = buf[idx];
        store = out * (1 - damp) + store * damp;
        buf[idx] = x[i] * 0.015 + store * size;
        idx = (idx + 1) % d;
        y[i] += out;
      }
    }
    for (const T of apT) {
      const d = Math.round((T + spread) * sc), buf = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < y.length; i++) { const bo = buf[idx], v = y[i]; y[i] = -v + bo; buf[idx] = v + bo * 0.5; idx = (idx + 1) % d; }
    }
    return y;
  };
  const wl = run(L, 0), wr = run(R, 23);
  return [L.map((v, i) => v + wet * wl[i]), R.map((v, i) => v + wet * wr[i])];
}
const sfxWet = reverb(sfx);

// ---------- music moves: airplane mode muffles the track, the ending lets it go ----------
{
  // offline: the whole track drops behind a low-pass (the cabin), snaps open on landing
  const a = bt(K.offline), b = bt(K.online);
  const fc = u => {
    if (u < a || u > b + 0.25) return 20000;
    const down = Math.min(1, (u - a) / 0.18), up = Math.max(0, (u - b) / 0.06);
    const lo = 380, hi = 20000;
    const k = u <= b ? down : 1 - Math.min(1, up);
    return Math.exp(Math.log(hi) + (Math.log(lo) - Math.log(hi)) * k);
  };
  const s0 = Math.round((a - 0.05) * SR), s1 = Math.round((b + 0.35) * SR);
  for (let c = 0; c < 2; c++) {
    const seg = music[c].subarray(s0, s1);
    const f1 = svf(seg, fc, 0.75, 'lp', (s0) / SR);
    // crossfade in and out of the filtered copy over 20 ms so nothing clicks
    const X = Math.round(0.02 * SR);
    for (let i = 0; i < seg.length; i++) {
      const w = Math.min(1, i / X, (seg.length - 1 - i) / X);
      const dip = (() => { const u = (s0 + i) / SR; return u > a && u < b ? undb(-2.5) : 1; })();
      seg[i] = seg[i] * (1 - w) + f1[i] * w * dip;
    }
  }
  // the end: let the breakdown ring under the lockup, then fade it out over the last bars
  const f0 = bt(88.5), f1 = bt(93);
  for (let i = Math.round(f0 * SR); i < LEN; i++) {
    const u = Math.min(1, (i / SR - f0) / (f1 - f0));
    const g = Math.cos(u * Math.PI / 2) ** 1.6;
    music[0][i] *= g; music[1][i] *= g;
  }
}

// ---------- mix and master ----------
const MUSIC_GAIN = undb(-1.5), SFX_GAIN = undb(0);
const mix = mk();
for (let c = 0; c < 2; c++) for (let i = 0; i < LEN; i++) mix[c][i] = music[c][i] * MUSIC_GAIN + sfxWet[c][i] * SFX_GAIN;
const tmp = p => path.join(OUT, p);
writeWav(tmp('stem-music.wav'), music);
writeWav(tmp('stem-sfx.wav'), sfxWet);
writeWav(tmp('premaster.wav'), mix);
fs.writeFileSync(tmp('cues.json'), JSON.stringify(cues));
const pre = meter(tmp('premaster.wav'));
console.log(`premaster: ${pre.I} LUFS, true peak ${pre.TP} dBTP`);
let gain = TARGET_I - pre.I;
for (let pass = 0; pass < 5; pass++) {
  const g = undb(gain);
  writeWav(tmp('gained.wav'), mix.map(ch => ch.map(v => v * g)));
  const mg = meter(tmp('gained.wav'));
  let file = tmp('gained.wav');
  if (mg.TP > CEIL_TP) {
    ffmpeg(['-y', '-i', tmp('gained.wav'), '-af', `aresample=192000,alimiter=limit=${undb(CEIL_TP - 0.3).toFixed(4)}:attack=1:release=60:level=disabled,aresample=48000`, '-c:a', 'pcm_f32le', tmp('limited.wav')]);
    file = tmp('limited.wav');
  }
  const out = meter(file);
  console.log(`pass ${pass}: gain ${gain.toFixed(2)} dB -> ${out.I} LUFS, ${out.TP} dBTP${file.endsWith('limited.wav') ? ' (limited)' : ''}`);
  if (Math.abs(out.I - TARGET_I) <= 0.1 && out.TP <= CEIL_TP + 0.05) {
    const fin = decode(file, { sr: SR });
    const done = fin.map(ch => { const y = new Float32Array(LEN); y.set(ch.subarray(0, LEN)); return y; });
    const F = Math.round(0.06 * SR);
    for (let i = 0; i < F; i++) { const gg = 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / F); done[0][LEN - F + i] *= gg; done[1][LEN - F + i] *= gg; }
    writeWav(tmp('trailer.wav'), done);
    const last = meter(tmp('trailer.wav'));
    console.log(`trailer.wav: ${(LEN / SR).toFixed(3)} s, ${last.I} LUFS, ${last.TP} dBTP`);
    break;
  }
  gain += TARGET_I - out.I;
}

// ---------- beat grid check: kicks from the drop on should sit on the film's beats ----------
{
  const [fl] = decode(tmp('trailer.wav'));
  const dev = [];
  for (const k of [16, 17, 20, 24, 32, 40, 48, 56, 64, 72, 79]) {
    try { dev.push(`b${k} ${((kickOnset(bt(k), fl) - bt(k)) * 1000).toFixed(1)}`); } catch { dev.push(`b${k} none`); }
  }
  console.log('kick vs grid (ms): ' + dev.join(', '));
}
