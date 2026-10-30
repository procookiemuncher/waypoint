// Can each SFX actually be heard over the track? Broadband levels hide this: the kick and bass
// dominate them, while the ticks, clicks and shimmer live up with the hats. Per cue, in its own
// band: the SFX's loudest 10 ms against the music's RMS over the cue. About 0 dB or more reads
// clearly; more than ~6 dB under is buried. The cue list is written by audio/build.mjs.
//
//   node audio/cues.mjs        (after audio/build.mjs)
import path from 'node:path';
import fs from 'node:fs';
import { decode, biquad, db, undb, SR, ROOT } from './dsp.mjs';

const MUSIC_GAIN_DB = -1.5; // what build.mjs mixes the music stem at
const dir = path.join(ROOT, 'out', 'audio');
const stem = n => decode(path.join(dir, n));
const mono = c => { const y = new Float32Array(c[0].length); for (let i = 0; i < y.length; i++) y[i] = (c[0][i] + c[1][i]) / 2; return y; };
const m = mono(stem('stem-music.wav')).map(v => v * undb(MUSIC_GAIN_DB)), x = mono(stem('stem-sfx.wav'));
const band = (s, lo, hi) => biquad(biquad(biquad(biquad(s, 'hp', lo), 'hp', lo), 'lp', hi), 'lp', hi);
const CUES = JSON.parse(fs.readFileSync(path.join(dir, 'cues.json'), 'utf8')).filter(c => c[0]);
const bands = {};
for (const [name, t0, t1, lo, hi] of CUES) {
  const key = Math.round(lo) + '-' + Math.round(hi);
  bands[key] ||= [band(m, lo, hi), band(x, lo, hi)];
  const [mb, xb] = bands[key];
  const a = Math.round(t0 * SR), b = Math.max(a + 960, Math.round(t1 * SR));
  let ms = 0;
  for (let i = a; i < b; i++) ms += mb[i] * mb[i];
  let best = 0;
  for (let s0 = a; s0 + 480 <= b; s0 += 120) { let e = 0; for (let i = s0; i < s0 + 480; i++) e += xb[i] * xb[i]; best = Math.max(best, e / 480); }
  const mr = db(Math.sqrt(ms / (b - a))), xr = db(Math.sqrt(best));
  console.log(`${name.padEnd(14)} ${t0.toFixed(2).padStart(6)}s ${`${Math.round(lo)}-${Math.round(hi)} Hz`.padEnd(13)} music ${mr.toFixed(1).padStart(6)}  sfx ${xr.toFixed(1).padStart(6)}  ${(xr - mr >= 0 ? '+' : '') + (xr - mr).toFixed(1)} dB`);
}
