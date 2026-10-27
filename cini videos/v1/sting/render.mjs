// Render the sting with Playwright, one screenshot per frame.
//
//   node render.mjs --stills 40,86,150,230     -> out/stills/f040.png ...
//   node render.mjs --frames 0-359 [--step 0.5] -> frames/00000.png ... (59.94 master = step 0.5)
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
const PAGE = '/' + path.relative(REPO, path.join(HERE, process.argv.includes('--page') ? process.argv[process.argv.indexOf('--page') + 1] : 'index.html')).split(path.sep).map(encodeURIComponent).join('/');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };

let frames = [], outFor;
if (opt('stills')) {
  frames = opt('stills').split(',').map(Number);
  const dir = path.join(HERE, 'out', opt('dir', 'stills'));
  fs.mkdirSync(dir, { recursive: true });
  outFor = f => path.join(dir, `f${String(f).replace('.', '_').padStart(3, '0')}.png`);
} else {
  const [a, b] = opt('frames', '0-359').split('-').map(Number);
  const step = Number(opt('step', '0.5'));
  for (let i = 0; a + i * step <= b + 0.5 - step + 1e-9; i++) frames.push(+(a + i * step).toFixed(4));
  const dir = path.join(HERE, opt('dir', 'frames'));
  fs.mkdirSync(dir, { recursive: true });
  outFor = f => path.join(dir, String(Math.round(f / step)).padStart(5, '0') + '.png');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.css': 'text/css' };
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
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.error('[page error]', e.message));
await page.route('**/*', route => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
await page.goto(origin + PAGE);
await page.waitForFunction(() => window.READY !== undefined, null, { timeout: 180000 });
if ((await page.evaluate(() => window.READY)) !== true) throw new Error('page failed to boot');
if (opt('eval')) await page.evaluate(opt('eval')); // debugging hook: poke the DOM before shooting

const t0 = Date.now();
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  await page.evaluate(f => new Promise(r => { window.seek(f); requestAnimationFrame(() => requestAnimationFrame(r)); }), f);
  await page.screenshot({ path: outFor(f), clip: { x: 0, y: 0, width: 1080, height: 1080 }, type: 'png' });
  if (frames.length > 8 && i % 30 === 0) console.log(`frame ${f} (${i + 1}/${frames.length}) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log(`rendered ${frames.length} frame(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await browser.close();
server.close();
