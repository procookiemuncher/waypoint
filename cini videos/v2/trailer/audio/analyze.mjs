// Look at the source track before cutting it: tempo, where the beats fall, and a bar-by-bar
// energy map (kick band and full band) to find a drop.
//
//   node audio/analyze.mjs cache/music/471.mp3
import { decode, biquad, SR } from './dsp.mjs';

const file = process.argv[2];
const [L, R] = decode(file);
const n = L.length;
const mono = new Float32Array(n);
for (let i = 0; i < n; i++) mono[i] = 0.5 * (L[i] + R[i]);
console.log(`length ${(n / SR).toFixed(2)} s`);

// onset envelope: half-wave rectified rise of log energy in three bands, 5 ms hop
const HOP = 240;
const bands = [biquad(mono, 'lp', 150), biquad(biquad(mono, 'hp', 150), 'lp', 2000), biquad(mono, 'hp', 2000)];
const frames = Math.floor(n / HOP);
const env = bands.map(b => {
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i++) s += b[i] * b[i];
    e[f] = Math.log(1e-9 + s / HOP);
  }
  return e;
});
const onset = new Float32Array(frames);
for (let f = 1; f < frames; f++) for (const e of env) onset[f] += Math.max(0, e[f] - e[f - 1]);

// tempo: autocorrelation of the onset envelope over 90-150 BPM, refined with a parabola
const ac = lag => { let s = 0; for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag]; return s; };
const hopS = HOP / SR;
let best = 0, bestLag = 0;
for (let lag = Math.floor(60 / 150 / hopS); lag <= Math.ceil(60 / 90 / hopS); lag++) {
  const v = ac(lag) + 0.5 * ac(2 * lag); // favour the beat over half-beat
  if (v > best) { best = v; bestLag = lag; }
}
const y0 = ac(bestLag - 1) + 0.5 * ac(2 * bestLag - 2), y1 = best, y2 = ac(bestLag + 1) + 0.5 * ac(2 * bestLag + 2);
const lagF = bestLag + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2);
// tighten over long spans: try periods around it and pick the one that keeps the comb sharpest
let period = lagF * hopS, bestScore = -1;
for (let p = period * 0.995; p <= period * 1.005; p += period * 0.00005) {
  // best phase for this period
  let score = -1;
  for (let ph = 0; ph < p; ph += hopS) {
    let s = 0;
    for (let t = ph; t < n / SR; t += p) s += onset[Math.round(t / hopS)] || 0;
    if (s > score) score = s;
  }
  if (score > bestScore) { bestScore = score; period = p; }
}
let phase = 0, ps = -1;
for (let ph = 0; ph < period; ph += hopS / 4) {
  let s = 0;
  for (let t = ph; t < n / SR; t += period) {
    const k = t / hopS, i = Math.floor(k);
    s += (onset[i] || 0) * (1 - (k - i)) + (onset[i + 1] || 0) * (k - i);
  }
  if (s > ps) { ps = s; phase = ph; }
}
console.log(`tempo ${(60 / period).toFixed(3)} BPM, beat ${period.toFixed(5)} s, first beat at ${phase.toFixed(4)} s`);

// bar map: 4 beats a bar from the first beat, RMS of the kick band and the full mix in dB
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return 10 * Math.log10(1e-12 + s / Math.max(1, b - a)); };
const kick = biquad(mono, 'lp', 120);
const hats = biquad(mono, 'hp', 6000);
console.log('bar  start(s)  kick dB  full dB  hats dB');
for (let bar = 0; ; bar++) {
  const t0 = phase + (bar * 4 - 1) * period; // allow a pickup beat
  const a = Math.max(0, Math.round((phase + bar * 4 * period) * SR)), b = Math.round((phase + (bar * 4 + 4) * period) * SR);
  if (b > n) break;
  console.log(`${String(bar).padStart(3)}  ${(a / SR).toFixed(3).padStart(7)}  ${rms(kick, a, b).toFixed(1).padStart(7)}  ${rms(mono, a, b).toFixed(1).padStart(7)}  ${rms(hats, a, b).toFixed(1).padStart(7)}`);
  void t0;
}
