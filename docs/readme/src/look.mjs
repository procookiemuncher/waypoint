// Look at README art the way GitHub shows it: through an <img>, on GitHub's dark and light page
// colours, at the column width, in Chromium and WebKit, at moments of an animation.
//
//   node src/look.mjs hero.svg --width 900 --times 0,800,1600,4000 --out /tmp/look
//   node src/look.mjs some.html --width 1280 --height 900 --out /tmp/look      (a page, as is)
//
// Writes <out>/<name>-<engine>-<bg>-<ms>.png. Nothing outside 127.0.0.1 is fetched.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { TRAILER, REPO } from './svgkit.mjs';

const { chromium, webkit } = await import(path.join(TRAILER, 'node_modules/playwright/index.mjs'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const file = path.resolve(args[0]);
const width = Number(opt('width', '900'));
const height = opt('height') ? Number(opt('height')) : null;
const times = opt('times', '0').split(',').map(Number);
const engines = opt('engines', 'chromium,webkit').split(',');
const bgs = opt('bg', 'dark,light').split(',');
const scale = Number(opt('scale', '2'));
const out = path.resolve(opt('out', '.'));
fs.mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
// serve the repo, or the file's own folder when it lives outside it (scratch checks)
const ROOTDIR = file.startsWith(REPO + path.sep) ? REPO : path.dirname(file);
const BG = { dark: '#0d1117', light: '#ffffff' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__wrap') {
    const src = u.searchParams.get('src'), bg = BG[u.searchParams.get('bg')];
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><body style="margin:0;padding:16px;background:${bg}"><img src="${src}" width="${width}" style="display:block;max-width:100%"></body>`);
    return;
  }
  const p = path.normalize(path.join(ROOTDIR, decodeURIComponent(u.pathname)));
  if (!p.startsWith(ROOTDIR)) { res.writeHead(403).end(); return; }
  fs.readFile(p, (err, data) => err ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const rel = '/' + path.relative(ROOTDIR, file).split(path.sep).map(encodeURIComponent).join('/');
const isPage = file.endsWith('.html');
const name = path.basename(file).replace(/\.\w+$/, '');

for (const eng of engines) {
  const browser = await ({ chromium, webkit })[eng].launch(eng === 'chromium' ? { channel: 'chromium' } : {});
  for (const bg of isPage ? ['page'] : bgs) {
    const page = await browser.newPage({ viewport: { width: width + (isPage ? 0 : 32), height: height || 600 }, deviceScaleFactor: scale, colorScheme: bg === 'light' ? 'light' : 'dark' });
    await page.route('**/*', r => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
    const t0 = Date.now();
    await page.goto(isPage ? origin + rel : `${origin}/__wrap?src=${encodeURIComponent(rel)}&bg=${bg}`);
    for (const t of times) {
      const wait = t - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      await page.screenshot({ path: path.join(out, `${name}-${eng}-${bg}-${t}.png`), fullPage: !height });
    }
    await page.close();
  }
  await browser.close();
}
server.close();
console.log(out);
