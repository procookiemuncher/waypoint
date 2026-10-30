// Small DSP kit for the trailer's sound: decode/encode through ffmpeg, biquads, a seeded PRNG.
// Plain Float32Arrays, no dependencies beyond the ffmpeg binary we already have.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(HERE);
export const FFMPEG = path.join(ROOT, 'node_modules/ffmpeg-static/ffmpeg');
export const SR = 48000;

// Decode any file to planar float channels at `sr`.
export function decode(file, { sr = SR, channels = 2, filter = null } = {}) {
  const args = ['-v', 'error', '-i', file];
  if (filter) args.push('-af', filter);
  args.push('-f', 'f32le', '-ac', String(channels), '-ar', String(sr), 'pipe:1');
  const r = spawnSync(FFMPEG, args, { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg decode failed: ' + r.stderr);
  const all = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  const n = all.length / channels;
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = all[i * channels + c];
  return out;
}

// 32-bit float WAV, interleaved.
export function writeWav(file, chans, sr = SR) {
  const n = chans[0].length, nc = chans.length;
  const data = Buffer.alloc(n * nc * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) data.writeFloatLE(chans[c][i], (i * nc + c) * 4);
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(3, 20); hdr.writeUInt16LE(nc, 22);
  hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * nc * 4, 28); hdr.writeUInt16LE(nc * 4, 32); hdr.writeUInt16LE(32, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([hdr, data]));
}

export function ffmpeg(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', ...args], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
  return r.stderr.toString();
}

// Integrated loudness and true peak, as ffmpeg's EBU R128 meter reports them.
export function meter(file) {
  const log = ffmpeg(['-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const tail = log.slice(log.lastIndexOf('Summary:'));
  const I = parseFloat(/I:\s+(-?[\d.]+) LUFS/.exec(tail)[1]);
  const TP = parseFloat(/Peak:\s+(-?[\d.]+) dBFS/.exec(tail)[1]);
  const LRA = parseFloat(/LRA:\s+(-?[\d.]+) LU/.exec(tail)[1]);
  return { I, TP, LRA };
}

// RBJ biquad, run in place or into a copy. type: lp, hp, bp (constant peak), peak, lowshelf, highshelf
export function biquad(x, type, f0, q = 0.707, gainDb = 0, sr = SR) {
  const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * f0 / sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  else if (type === 'lowshelf' || type === 'highshelf') {
    const sq = 2 * Math.sqrt(A) * al, sgn = type === 'lowshelf' ? 1 : -1;
    b0 = A * ((A + 1) - sgn * (A - 1) * cw + sq); b1 = sgn * 2 * A * ((A - 1) - sgn * (A + 1) * cw); b2 = A * ((A + 1) - sgn * (A - 1) * cw - sq);
    a0 = (A + 1) + sgn * (A - 1) * cw + sq; a1 = -sgn * 2 * ((A - 1) + sgn * (A + 1) * cw); a2 = (A + 1) + sgn * (A - 1) * cw - sq;
  }
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// Seeded PRNG (mulberry32), so every noise burst is the same on every build.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const db = v => 20 * Math.log10(Math.max(1e-12, v));
export const undb = d => Math.pow(10, d / 20);
