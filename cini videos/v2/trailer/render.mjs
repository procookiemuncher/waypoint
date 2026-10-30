// Render the trailer with Playwright, one screenshot per frame (60 fps, t = frame / 60).
//
//   node render.mjs --stills 120,464,900          -> out/stills/f0120.png ...
//   node render.mjs --stills 2.5s,7.74s            (seconds work too)
//   node render.mjs --frames 0-2699 --dir DIR      -> DIR/00000.png ... (the master)
//   node render.mjs --frames 0-2699 --step 4 --scale 0.5 --dir DIR   (quick half-res animatic)
//
// The page is served from the repo root on 127.0.0.1 so it can load the repo's fonts; every
// other request is refused, nothing reaches the network during a render.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const W = 1920, H = 1080, FPS = 60;

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const PAGE = '/' + path.relative(REPO, path.join(HERE, opt('page', 'index.html'))).split(path.sep).map(encodeURIComponent).join('/');
const scale = Number(opt('scale', '1'));

let frames = [], outFor;
if (opt('stills')) {
  frames = opt('stills').split(',').map(v => (v.endsWith('s') ? Math.round(parseFloat(v) * FPS) : Number(v)));
  const dir = path.resolve(HERE, 'out', opt('dir', 'stills'));
  fs.mkdirSync(dir, { recursive: true });
  outFor = f => path.join(dir, `f${String(f).padStart(4, '0')}.png`);
} else {
  const [a, b] = opt('frames', '0-2699').split('-').map(Number);
  const step = Number(opt('step', '1'));
  for (let f = a; f <= b; f += step) frames.push(f);
  const dir = path.resolve(HERE, opt('dir', 'frames'));
  fs.mkdirSync(dir, { recursive: true });
  // numbered by output index when stepping so ffmpeg reads a gapless sequence
  outFor = f => path.join(dir, String(step > 1 ? Math.round(f / step) : f).padStart(5, '0') + '.png');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.normalize(path.join(REPO, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(REPO)) { res.writeHead(403).end(); return; }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(data);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.error('[page error]', e.message));
await page.route('**/*', route => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
await page.goto(origin + PAGE);
await page.waitForFunction(() => window.READY !== undefined, null, { timeout: 300000 });
if ((await page.evaluate(() => window.READY)) !== true) throw new Error('page failed to boot');
if (opt('eval')) await page.evaluate(opt('eval')); // debugging hook: poke the DOM before shooting

const t0 = Date.now();
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  await page.evaluate(t => new Promise(r => { window.seek(t); requestAnimationFrame(() => requestAnimationFrame(r)); }), f / FPS);
  await page.screenshot({ path: outFor(f), clip: { x: 0, y: 0, width: W, height: H }, type: 'png' });
  if (frames.length > 8 && i % 60 === 0) console.log(`frame ${f} (${i + 1}/${frames.length}) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log(`rendered ${frames.length} frame(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await browser.close();
server.close();
