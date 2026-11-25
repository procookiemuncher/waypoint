// Shared bits for the README's hand-made SVGs: the brand (read from the trailer's core.js and the
// app's app.css, not retyped), the Leap's geometry, and text set in the repo's own Inter and
// JetBrains Mono, turned into paths. An SVG shown through <img> on GitHub can't load a font, so
// no <text> ever goes out: every word is outlines, shaped with kerning by fontkit.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import woff2 from 'wawoff2';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');            // docs/readme
export const REPO = path.resolve(ROOT, '../..');
export const TRAILER = path.join(REPO, 'cini videos/v2/trailer');

// ---------- brand ----------
// core.js is a browser script; run it in a bare context and read its constants back.
const ctx = vm.createContext({ Math, console, window: {}, document: {} });
vm.runInContext(fs.readFileSync(path.join(TRAILER, 'js/core.js'), 'utf8'), ctx);
const { C, LEAP, ICON, RAINBOW } = vm.runInContext('({ C, LEAP, ICON, RAINBOW })', ctx);
export { C, LEAP, ICON, RAINBOW };

// the side panel's tokens, straight from app.css (--ground, --panel, --raised, --line, --ink...)
const css = fs.readFileSync(path.join(REPO, 'core/web/static/app.css'), 'utf8');
const P = {};
for (const m of css.matchAll(/--([a-z0-9]+):\s*(#[0-9a-f]{6})/gi)) if (!(m[1] in P)) P[m[1]] = m[2];
export const T = {
  page: C.page, ground: C.ground, ground2: P.ground, panel: P.panel, raised: P.raised, raised2: P.raised2,
  line: P.line, rule: P.rule, ink: P.ink, ink2: P.ink2, muted: P.muted, faint: P.faint,
  accent: C.accent, deep: C.accentDim, tile: C.tile, green: C.green, positive: P.positive, amber: C.amber,
};

// per-country colours from the catalog
const catalog = JSON.parse(fs.readFileSync(path.join(REPO, 'core/destinations.json'), 'utf8'));
export const COUNTRY = Object.fromEntries(Object.entries(catalog.countries).map(([k, v]) => [k, v.color]));
export const CATALOG = catalog;

// ---------- fonts ----------
const FONT_FILES = { inter: 'inter-latin.woff2', mono: 'jetbrains-mono-latin.woff2' };
const base = {};
for (const [k, f] of Object.entries(FONT_FILES)) {
  const ttf = Buffer.from(await woff2.decompress(fs.readFileSync(path.join(REPO, 'core/web/static/fonts', f))));
  base[k] = fontkit.create(ttf);
}
const inst = {};
function face(font, weight) {
  const key = font + weight;
  if (!inst[key]) {
    const b = base[font], ax = b.variationAxes.wght;
    inst[key] = b.getVariation({ wght: Math.max(ax.min, Math.min(ax.max, weight)) });
  }
  return inst[key];
}

const n1 = v => { const r = Math.round(v * 10) / 10; return Object.is(r, -0) ? '0' : String(r); };

// Glyphs the latin subsets don't have, drawn to match: each returns stroke path data in em units
// (baseline at y 0, y down) and an advance. Stroke width comes from the text's weight.
const SPECIAL = {
  '→': { adv: 0.78, d: 'M0.08 -0.36H0.68M0.46 -0.58L0.68 -0.36L0.46 -0.14' },
  '←': { adv: 0.78, d: 'M0.7 -0.36H0.1M0.32 -0.58L0.1 -0.36L0.32 -0.14' },
  '✓': { adv: 0.7, d: 'M0.1 -0.36L0.27 -0.18L0.6 -0.56' },
  '⌘': { adv: 0.8, d: 'M0.28 -0.62V-0.18M0.52 -0.62V-0.18M0.18 -0.52H0.62M0.18 -0.28H0.62M0.28 -0.62A0.1 0.1 0 1 0 0.18 -0.52M0.52 -0.62A0.1 0.1 0 1 1 0.62 -0.52M0.28 -0.18A0.1 0.1 0 1 1 0.18 -0.28M0.52 -0.18A0.1 0.1 0 1 0 0.62 -0.28' },
};
// scale + translate an em-unit path (absolute M/L/H/V/A/Z only, as written above)
function emPath(d, x, y, size) {
  return d.replace(/([MLHVAZ])([^MLHVAZ]*)/g, (_, c, args) => {
    const n = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
    if (c === 'H') return 'H' + n1(x + n[0] * size);
    if (c === 'V') return 'V' + n1(y + n[0] * size);
    if (c === 'A') return 'A' + [n[0] * size, n[1] * size, n[2], n[3], n[4], x + n[5] * size, y + n[6] * size].map(n1).join(' ');
    if (c === 'Z') return 'Z';
    const out = [];
    for (let i = 0; i < n.length; i += 2) out.push(n1(x + n[i] * size) + ' ' + n1(y + n[i + 1] * size));
    return c + out.join(' ');
  });
}

// Each glyph's outline goes into the document's <defs> once, in font units, and every use of it
// is a <use> scaled into place, which keeps a diagram with a few hundred letters small.
let GLYPHS = new Map();
function glyphDef(font, weight, g) {
  const id = `${font[0]}${weight}-${g.id}`;
  if (!GLYPHS.has(id)) {
    let d = '';
    const r = v => Math.round(v);
    for (const c of g.path.commands) {
      const a = c.args, pt = j => r(a[j]) + ' ' + r(-a[j + 1]);
      if (c.command === 'moveTo') d += 'M' + pt(0);
      else if (c.command === 'lineTo') d += 'L' + pt(0);
      else if (c.command === 'quadraticCurveTo') d += 'Q' + pt(0) + ' ' + pt(2);
      else if (c.command === 'bezierCurveTo') d += 'C' + pt(0) + ' ' + pt(2) + ' ' + pt(4);
      else if (c.command === 'closePath') d += 'Z';
    }
    GLYPHS.set(id, d ? `<path id="${id}" d="${d}"/>` : '');
  }
  return GLYPHS.get(id) ? id : null;
}

// Shape one line. Returns { width, uses (<use> elements), strokes ([d, width]) } in px, with the
// baseline's left end at (x, y). tracking is in em, like CSS letter-spacing.
export function shape(str, { font = 'inter', weight = 400, size = 16, tracking = 0, features = [], x = 0, y = 0 } = {}) {
  const f = face(font, weight), k = size / f.unitsPerEm;
  let pen = 0, uses = '';
  const strokes = [];
  const sw = size * (0.055 + (weight - 400) / 500 * 0.03);
  // split around the special glyphs
  for (const part of str.split(/([→←✓⌘])/u)) {
    if (!part) continue;
    if (SPECIAL[part]) {
      strokes.push([emPath(SPECIAL[part].d, x + pen, y, size), sw]);
      pen += SPECIAL[part].adv * size + tracking * size;
      continue;
    }
    const run = f.layout(part, features);
    run.glyphs.forEach((g, i) => {
      if (g.id === 0) throw new Error(`a character in ${JSON.stringify(part)} has no glyph in ${font}`);
      const p = run.positions[i];
      const ox = x + pen + p.xOffset * k, oy = y - p.yOffset * k;
      const id = glyphDef(font, weight, g);
      if (id) uses += `<use href="#${id}" transform="translate(${n1(ox)} ${n1(oy)}) scale(${+k.toFixed(6)})"/>`;
      pen += p.xAdvance * k + tracking * size;
    });
  }
  return { width: pen - tracking * size, uses, strokes };
}

export const measure = (str, o) => shape(str, o).width;

// <g> for one line of type. anchor: start | middle | end.
export function text(str, o = {}) {
  const { anchor = 'start', color = T.ink, opacity, cls, id } = o;
  let x = o.x || 0;
  if (anchor !== 'start') {
    const w = measure(str, { ...o, x: 0, y: 0 });
    x -= anchor === 'middle' ? w / 2 : w;
  }
  const r = shape(str, { ...o, x });
  const attrs = [cls && `class="${cls}"`, id && `id="${id}"`, opacity != null && `opacity="${opacity}"`].filter(Boolean).join(' ');
  let out = `<g${attrs ? ' ' + attrs : ''}>`;
  if (r.uses) out += `<g fill="${color}">${r.uses}</g>`;
  for (const [d, w] of r.strokes) out += `<path fill="none" stroke="${color}" stroke-width="${n1(w)}" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;
  return out + '</g>';
}

// ---------- the Leap ----------
// The master mark (mac-version/app/icon.svg path), placed with its centre at (x, y), `h` px tall.
export function leapMark(x, y, size, color = T.accent) {
  const k = size / 200; // the mark spans about 200 units (28..226)
  return `<path fill="${color}" fill-rule="evenodd" transform="translate(${n1(x)} ${n1(y)}) scale(${k.toFixed(4)}) translate(${-LEAP.centre[0]} ${-LEAP.centre[1]})" d="${LEAP.path}"/>`;
}
// The app icon (tile + mark), `tile` px wide, centred on (x, y).
export function icon(x, y, tile) {
  const k = tile / ICON.tile;
  return `<g transform="translate(${n1(x)} ${n1(y)}) scale(${k.toFixed(4)}) translate(-512 -512)"><rect x="100" y="100" width="824" height="824" rx="${ICON.rx}" fill="${T.tile}"/>` +
    `<path fill="${T.accent}" fill-rule="evenodd" transform="translate(512 512) scale(${ICON.markScale}) translate(-129 -127)" d="${LEAP.path}"/></g>`;
}
// A route's ends: hollow ring where it starts, solid dot where it lands (the trailer's endsGroup).
export const ringEnd = (x, y, r, color, ground = T.ground) =>
  `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="${ground}" stroke="${color}" stroke-width="${n1(r * 0.78)}"/>`;
export const dotEnd = (x, y, r, color) => `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r * 1.3)}" fill="${color}"/>`;

// ---------- documents ----------
// A dark rounded card with transparent corners, so it reads as intended on GitHub light and dark.
// No outline: the card is set apart from the page by its own tone.
export function card(w, h, { rx = 28, fill = T.ground } = {}) {
  return `<rect width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
}
export function svgDoc(w, h, body, { title, desc, defs = '', style = '' } = {}) {
  defs = [...GLYPHS.values()].join('') + defs;
  GLYPHS = new Map();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"${title ? ' aria-labelledby="t"' : ''}>` +
    (title ? `<title id="t">${esc(title)}</title>` : '') + (desc ? `<desc>${esc(desc)}</desc>` : '') +
    (style ? `<style>${style}</style>` : '') + (defs ? `<defs>${defs}</defs>` : '') + body + '</svg>\n';
}
export const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function write(name, svg) {
  if (/<text[\s>]/.test(svg)) throw new Error(name + ' has a <text> element');
  const p = path.join(ROOT, name);
  fs.writeFileSync(p, svg);
  console.log(`${name.padEnd(22)} ${(svg.length / 1024).toFixed(1)} KB`);
}
export { n1 };

// Greedy word wrap to a width; returns the lines.
export function wrap(str, width, o) {
  const out = [];
  let line = '';
  for (const w of str.split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (line && measure(t, o) > width) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
// Several lines of type, `lead` px apart, first baseline at y.
export const lines = (list, o, lead) => list.map((l, i) => text(l, { ...o, y: o.y + i * lead })).join('');

// An arrow from (x1,y1) to (x2,y2) with a filled head.
export function arrow(x1, y1, x2, y2, { color = T.muted, w = 3, head = 14 } = {}) {
  const a = Math.atan2(y2 - y1, x2 - x1), bx = x2 - Math.cos(a) * head, by = y2 - Math.sin(a) * head;
  const px = Math.sin(a) * head * 0.55, py = -Math.cos(a) * head * 0.55;
  return `<path d="M${n1(x1)} ${n1(y1)}L${n1(bx)} ${n1(by)}" stroke="${color}" stroke-width="${w}" fill="none"/>` +
    `<path d="M${n1(x2)} ${n1(y2)}L${n1(bx + px)} ${n1(by + py)}L${n1(bx - px)} ${n1(by - py)}Z" fill="${color}"/>`;
}
