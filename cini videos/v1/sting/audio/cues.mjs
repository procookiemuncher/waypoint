// Can each SFX actually be heard over the track? Broadband levels hide this: the kick and bass
// dominate them, while the ticks, clicks and shimmer live up with the hats. Per cue, in its own
// band: the SFX's loudest 10 ms against the music's RMS over the cue. About 0 dB or more reads
// clearly; more than ~6 dB under is buried.
//
//   node audio/cues.mjs        (after audio/build.mjs has written the stems)
import path from 'node:path';
import { decode, biquad, db, undb, fsec, SR, ROOT } from './dsp.mjs';

const MUSIC_GAIN_DB = -1.5; // what build.mjs mixes the music stem at
const stem = n => decode(path.join(ROOT, 'out', 'audio', n));
const mono = c => { const y = new Float32Array(c[0].length); for (let i = 0; i < y.length; i++) y[i] = (c[0][i] + c[1][i]) / 2; return y; };
const m = mono(stem('stem-music.wav')).map(v => v * undb(MUSIC_GAIN_DB)), x = mono(stem('stem-sfx.wav'));
const band = (s, lo, hi) => biquad(biquad(biquad(biquad(s, 'hp', lo), 'hp', lo), 'lp', hi), 'lp', hi);

const CUES = [
  ['impact', 0.10, 0.5, 40, 200],
  ['click 2.33', 2.33, 2.36, 2500, 6000],
  ['click 3.83', 3.83, 3.86, 2500, 6000],
  ['whoosh f72', fsec(72) - 0.3, fsec(72) + 0.05, 300, 3000],
  ['whoosh f101', fsec(101) - 0.25, fsec(101) + 0.05, 300, 3000],
  ['whoosh f159', fsec(159) - 0.3, fsec(159) + 0.05, 300, 3000],
  ['whoosh f301', fsec(301) - 0.3, fsec(301) + 0.05, 300, 3000],
  ['hit f187', fsec(187), fsec(187) + 0.3, 40, 200],
  ['hit f245', fsec(245), fsec(245) + 0.3, 40, 200],
  ['key ticks', 4.03, 5.02, 2500, 6000],
  ['shimmer', 10.05, 10.6, 1300, 6000],
];
const bands = {};
for (const [name, t0, t1, lo, hi] of CUES) {
  const key = lo + '-' + hi;
  bands[key] ||= [band(m, lo, hi), band(x, lo, hi)];
  const [mb, xb] = bands[key];
  const a = Math.round(t0 * SR), b = Math.round(t1 * SR);
  let ms = 0;
  for (let i = a; i < b; i++) ms += mb[i] * mb[i];
  let best = 0;
  for (let s0 = a; s0 + 480 <= b; s0 += 120) {
    let e = 0;
    for (let i = s0; i < s0 + 480; i++) e += xb[i] * xb[i];
    best = Math.max(best, e / 480);
  }
  const mr = db(Math.sqrt(ms / (b - a))), xr = db(Math.sqrt(best));
  console.log(`${name.padEnd(12)} ${`${lo}-${hi} Hz`.padEnd(13)} music ${mr.toFixed(1).padStart(6)}  sfx ${xr.toFixed(1).padStart(6)}  ${(xr - mr >= 0 ? '+' : '') + (xr - mr).toFixed(1)} dB`);
}
