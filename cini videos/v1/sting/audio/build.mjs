// The sting's soundtrack, exactly 12.075 s at 48 kHz: Rising Forest cut so its drop lands on
// beat 5 (2.467 s), synthesized SFX on the picture's cues, mastered to -14 LUFS / -1 dBTP with
// only the last 60 ms faded.
//
//   node audio/build.mjs        -> out/audio/sting.wav (+ stems in out/audio/)
//
// Rising Forest (Diego Nava, Mixkit, free licence) measures 124.00 BPM as published, the tempo
// the cuts were timed to, so it plays at its own speed: the brief's "slowed to 124" is already
// true of the file.
import path from 'node:path';
import fs from 'node:fs';
import { decode, writeWav, meter, ffmpeg, biquad, rng, undb, db, fsec, beat, SR, ROOT } from './dsp.mjs';

const OUT = path.join(ROOT, 'out', 'audio');
const SRC = path.join(ROOT, 'cache', 'music', '471.mp3');
const LEN = Math.round(12.075 * SR); // 579600 samples
const TARGET_I = -14, CEIL_TP = -1.3; // a little under -1 so the AAC encode can't push it over

fs.mkdirSync(OUT, { recursive: true });
const mk = () => [new Float32Array(LEN), new Float32Array(LEN)];

// ---------- music ----------
// Source beat grid (from analyze.mjs): 124.00 BPM, beat 0.48386 s, bar 24 (the big drop after
// the eight-bar build) at 46.45 s. Find that kick's onset to the sample, then cut so it lands
// on beat 5. The 1.25 bars before it, the end of the build, are the soft intro.
const [mL, mR] = decode(SRC);
function kickOnset(t, x = mL) {
  // the kick's attack: the first 0.5 ms window whose peak more than doubles the loudest window
  // of the 25 ms before it (the low band only peaks 20-30 ms later, too late to call the beat)
  const W = 24, at = s => { let p = 0; for (let i = s; i < s + W; i++) p = Math.max(p, Math.abs(x[i])); return p; };
  const s0 = Math.round((t - 0.012) * SR);
  let base = 0;
  for (let s = s0 - Math.round(0.025 * SR); s < s0; s += W) base = Math.max(base, at(s));
  for (let s = s0; s < s0 + Math.round(0.03 * SR); s += 4) if (at(s) > 2 * base) return (s + W / 2) / SR;
  throw new Error('no kick near ' + t);
}
const DROP_SRC = kickOnset(46.4506);
const offset = Math.round(DROP_SRC * SR) - Math.round(beat(5) * SR);
const music = mk();
for (let i = 0; i < LEN; i++) { music[0][i] = mL[offset + i]; music[1][i] = mR[offset + i]; }
// the cut starts mid-build; 2 ms de-click so sample 0 doesn't pop (not a fade)
for (let i = 0; i < 96; i++) { const g = 0.5 - 0.5 * Math.cos(Math.PI * i / 96); music[0][i] *= g; music[1][i] *= g; }
console.log(`music: drop kick in source at ${DROP_SRC.toFixed(4)} s, cut from ${(offset / SR).toFixed(4)} s`);

// ---------- synth helpers ----------
const sfx = mk();
const add = (buf, t0, L, R = L, gain = 1) => {
  const s0 = Math.round(t0 * SR);
  for (let i = 0; i < L.length; i++) {
    const k = s0 + i;
    if (k < 0 || k >= LEN) continue;
    buf[0][k] += L[i] * gain; buf[1][k] += R[i] * gain;
  }
};
const noise = (n, seed) => { const r = rng(seed), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; return x; };
// pinkish noise (Paul Kellet's economy filter), softer than white for air and whooshes
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
function svf(x, fc, q, mode = 'bp') {
  const y = new Float32Array(x.length);
  let ic1 = 0, ic2 = 0;
  const k = 1 / q;
  for (let i = 0; i < x.length; i++) {
    const f = typeof fc === 'function' ? fc(i / SR) : fc;
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
const norm = (x, dbfs) => { const g = undb(dbfs) / peakOf(x); for (let i = 0; i < x.length; i++) x[i] *= g; return x; };
// equal-power pan of a mono signal by a pan curve in -1..1
function pan(x, p) {
  const L = new Float32Array(x.length), R = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const a = (clamp1(typeof p === 'function' ? p(i / SR) : p) + 1) * Math.PI / 4;
    L[i] = x[i] * Math.cos(a); R[i] = x[i] * Math.sin(a);
  }
  return [L, R];
}
const clamp1 = v => Math.max(-1, Math.min(1, v));

// ---------- the cues ----------
// soft impact under the header's first rise
{
  const n = Math.round(1.2 * SR);
  const thump = env(n, t => {
    const f = 42 + 50 * Math.exp(-t / 0.05);
    return Math.sin(2 * Math.PI * (42 * t + 50 * 0.05 * (1 - Math.exp(-t / 0.05)))) * (1 - Math.exp(-t / 0.003)) * Math.exp(-t / 0.32) + 0 * f;
  });
  const air = mul(svf(pink(n, 7), 380, 0.7, 'lp'), env(n, t => (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.18)));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = thump[i] + 0.9 * air[i]; R[i] = thump[i] + 0.9 * air[i] * 0.94; }
  const g = undb(-10) / peakOf(L);
  add(sfx, 0.100, L, R, g);
}

// whooshes: filtered noise swelling into the cut and dropping off just after it, sweeping
// across the stereo field
const WHOOSH = [
  { t: fsec(72), pre: 0.42, from: -0.7, to: 0.5, lvl: -6, top: 2600, seed: 11 },
  { t: fsec(101), pre: 0.30, from: 0.6, to: -0.4, lvl: -8, top: 2200, seed: 12 },
  { t: fsec(159), pre: 0.48, from: -0.5, to: 0.6, lvl: -5, top: 3200, seed: 13 },
  { t: fsec(301), pre: 0.40, from: 0.5, to: -0.5, lvl: -6, top: 2800, seed: 14 },
];
for (const w of WHOOSH) {
  const n = Math.round((w.pre + 0.5) * SR);
  const tp = w.pre; // peak position inside the buffer
  const shape = t => (t < tp ? Math.pow(Math.max(0, t / tp), 3.2) : Math.exp(-(t - tp) / 0.075));
  const fc = t => 220 + (w.top - 220) * (t < tp ? Math.pow(t / tp, 2) : Math.exp(-(t - tp) / 0.12));
  const a = svf(pink(n, w.seed), fc, 1.6, 'bp');
  const b = svf(pink(n, w.seed + 50), t => fc(t) * 0.5, 0.9, 'bp'); // a darker body under it
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (a[i] + 0.8 * b[i]) * shape(i / SR);
  norm(x, w.lvl);
  const [L, R] = pan(x, t => w.from + (w.to - w.from) * Math.min(1, t / (tp + 0.1)));
  add(sfx, w.t - tp, L, R);
}

// transition hits, on 6.240 s (f187) and 8.175 s (f245): a short reverse swell into a low hit
// with a bright transient
for (const [t, seed] of [[fsec(187), 21], [fsec(245), 22]]) {
  const pre = 0.22, n = Math.round((pre + 1.4) * SR);
  const x = new Float32Array(n);
  const boom = env(n, tt => {
    const u = tt - pre; if (u < 0) return 0;
    return Math.sin(2 * Math.PI * (46 * u + 40 * 0.04 * (1 - Math.exp(-u / 0.04)))) * (1 - Math.exp(-u / 0.002)) * Math.exp(-u / 0.42);
  });
  const crack = mul(svf(noise(n, seed), 1500, 0.8, 'bp'), env(n, tt => { const u = tt - pre; return u < 0 ? 0 : Math.exp(-u / 0.035); }));
  const swell = mul(svf(pink(n, seed + 7), tt => 600 + 4000 * Math.pow(Math.min(1, tt / pre), 2), 1.2, 'bp'),
    env(n, tt => (tt < pre ? Math.pow(tt / pre, 2.5) : Math.exp(-(tt - pre) / 0.02))));
  for (let i = 0; i < n; i++) x[i] = boom[i] + 0.55 * crack[i] + 0.35 * swell[i];
  const kb = undb(-5) / peakOf(x);
  for (let i = 0; i < n; i++) x[i] *= kb;
  // the boom stays centred, the crack and swell lean a hair left
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) R[i] = boom[i] * kb + (x[i] - boom[i] * kb) * 0.85;
  add(sfx, t - pre, x, R);
}

// mouse clicks on the presses (2.33 s and 3.83 s)
for (const [t, seed] of [[2.33, 31], [3.83, 32]]) {
  const n = Math.round(0.03 * SR);
  const tick = mul(svf(noise(n, seed), 3400, 1.4, 'bp'), env(n, u => Math.exp(-u / 0.0022)));
  const body = env(n, u => Math.sin(2 * Math.PI * 1750 * u) * Math.exp(-u / 0.004));
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = tick[i] + 0.4 * body[i];
  norm(x, -16);
  add(sfx, t, x, x.map(v => v * 0.92));
}

// key ticks, one per typed character (the frames where the console's text grows), very quiet
{
  const HOLDS = new Set([2, 5, 9, 12, 15, 19, 22, 25, 27]);
  const keys = [121];
  for (let fr = 122; fr <= 150; fr++) if (!HOLDS.has(fr - 122)) keys.push(fr);
  const r = rng(41);
  keys.forEach((fr, j) => {
    const n = Math.round(0.02 * SR);
    const f0 = 3000 + 2500 * r();
    const x = mul(svf(noise(n, 100 + j), f0, 1.8, 'bp'), env(n, u => Math.exp(-u / (0.0012 + 0.0008 * r()))));
    norm(x, -26 - 3 * r());
    const p = (r() - 0.5) * 0.5;
    const [L, R] = pan(x, p);
    add(sfx, fsec(fr) + 0.002 * r(), L, R);
  });
}

// soft shimmer on the end card (10.05 s): detuned high partials that ring out under the word
{
  const t0 = 10.05, n = LEN - Math.round(t0 * SR);
  const r = rng(51);
  const parts = [1318.5, 1975.5, 2637, 3135.9, 3951, 5274];
  const L = new Float32Array(n), R = new Float32Array(n);
  parts.forEach((f, j) => {
    for (const det of [-1, 1]) {
      const ff = f * (1 + det * 0.0016), ph = r() * 2 * Math.PI, side = det * (0.3 + 0.5 * r());
      const amp = 1 / (1 + j * 0.55), dec = 0.9 - j * 0.09, trem = 4 + 3 * r();
      for (let i = 0; i < n; i++) {
        const u = i / SR;
        const v = Math.sin(2 * Math.PI * ff * u + ph) * amp * (1 - Math.exp(-u / 0.03)) * Math.exp(-u / dec) * (0.85 + 0.15 * Math.sin(2 * Math.PI * trem * u));
        L[i] += v * (1 - side) / 2; R[i] += v * (1 + side) / 2;
      }
    }
  });
  const sparkle = mul(svf(noise(n, 52), 7000, 2, 'bp'), env(n, u => (1 - Math.exp(-u / 0.02)) * Math.exp(-u / 0.35)));
  for (let i = 0; i < n; i++) { L[i] += 0.5 * sparkle[i]; R[i] += 0.5 * sparkle[i]; }
  const g = undb(-11) / Math.max(peakOf(L), peakOf(R));
  add(sfx, t0, L, R, g);
}

// ---------- a little room on the SFX (Freeverb-style), so they sit with the track ----------
function reverb([L, R], { size = 0.78, damp = 0.35, wet = 0.16 } = {}) {
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
      for (let i = 0; i < y.length; i++) {
        const bo = buf[idx], v = y[i];
        y[i] = -v + bo;
        buf[idx] = v + bo * 0.5;
        idx = (idx + 1) % d;
      }
    }
    return y;
  };
  const wl = run(L, 0), wr = run(R, 23);
  return [L.map((v, i) => v + wet * wl[i]), R.map((v, i) => v + wet * wr[i])];
}
const sfxWet = reverb(sfx);

// ---------- mix and master ----------
const MUSIC_GAIN = undb(-1.5), SFX_GAIN = undb(0);
let mix = mk();
for (let c = 0; c < 2; c++) for (let i = 0; i < LEN; i++) mix[c][i] = music[c][i] * MUSIC_GAIN + sfxWet[c][i] * SFX_GAIN;

const tmp = p => path.join(OUT, p);
writeWav(tmp('stem-music.wav'), music);
writeWav(tmp('stem-sfx.wav'), sfxWet);
writeWav(tmp('premaster.wav'), mix);
const pre = meter(tmp('premaster.wav'));
console.log(`premaster: ${pre.I} LUFS, true peak ${pre.TP} dBTP`);

// gain to the target, then a 4x-oversampled lookahead limiter only if the peaks need it
let gain = TARGET_I - pre.I;
for (let pass = 0; pass < 4; pass++) {
  const g = undb(gain);
  const m = mix.map(ch => ch.map(v => v * g));
  writeWav(tmp('gained.wav'), m);
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
    for (const ch of fin) ch.length !== LEN && console.warn('length drift', ch.length);
    const done = fin.map(ch => { const y = new Float32Array(LEN); y.set(ch.subarray(0, LEN)); return y; });
    // the only fade: the last 60 ms
    const F = Math.round(0.06 * SR);
    for (let i = 0; i < F; i++) { const gg = 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / F); done[0][LEN - F + i] *= gg; done[1][LEN - F + i] *= gg; }
    writeWav(tmp('sting.wav'), done);
    const last = meter(tmp('sting.wav'));
    console.log(`sting.wav: ${(LEN / SR).toFixed(3)} s, ${last.I} LUFS, ${last.TP} dBTP`);
    break;
  }
  gain += TARGET_I - out.I;
}
void db;

// ---------- beat grid check: every kick from the drop on should sit on 0.048 + 0.4838 k ----------
{
  const [fl] = decode(tmp('sting.wav'));
  const dev = [];
  for (let k = 5; beat(k) < 12.0; k++) {
    try { dev.push([k, ((kickOnset(beat(k), fl) - beat(k)) * 1000).toFixed(1)]); } catch { dev.push([k, 'none']); }
  }
  console.log('kick vs grid (ms): ' + dev.map(([k, d]) => `b${k} ${d}`).join(', '));
}
