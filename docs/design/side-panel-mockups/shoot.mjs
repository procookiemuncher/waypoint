// Screenshots every design in every state at 1440x900, deviceScaleFactor 2, into shots/ (gitignored).
//
//   python3 -m http.server 8791 --bind 127.0.0.1 --directory docs/design/side-panel-mockups   (another terminal)
//   node docs/design/side-panel-mockups/shoot.mjs [designs, e.g. 1,3] [states, e.g. world,route]
//
// The clock is pinned (NOW below) so open/closed and local times are the same in every shot.
// Playwright comes from the promo-film folder's node_modules, like dump-lib.mjs in the prototype.
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
// PW_ROOT: a folder with playwright in node_modules (a worktree has no node_modules of its own)
const require = createRequire(path.join(process.env.PW_ROOT || path.join(here, '../../../cini videos/v1/sting'), 'package.json'));
const { chromium } = require('playwright');

const NOW = '2026-11-20T19:30:00Z';   // Friday: 8:30 pm in Paris, 2:30 pm in Miami, 4:30 am Saturday in Tokyo
const BASE = process.env.MOCKUPS_URL || 'http://127.0.0.1:8791/';
const designs = (process.argv[2] || '1,2,3,4,5').split(',').map(Number);
const states = (process.argv[3] || 'world,france,japan,route,playing,place,pin').split(',');
const out = path.join(here, 'shots');
mkdirSync(out, { recursive: true });

const b = await chromium.launch({ headless: false, args: ['--headless=new'] });   // the headless-shell build isn't installed
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
p.on('requestfailed', r => errors.push('failed: ' + r.url()));
p.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(r.status() + ' ' + r.url()); });
for (const d of designs) {
  for (const s of states) {
    await p.goto(`${BASE}?d=${d}&s=${s}&now=${NOW}`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForFunction(() => window.globeSettled && window.globeSettled(), null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(250);
    if (s === 'world') await p.mouse.move(1100, 60);   // keep the pointer off the panel so the hover stays on France
    const file = path.join(out, `d${d}-${s}.png`);
    await p.screenshot({ path: file });
    console.log(file);
  }
}
// a contact sheet next to the shots: designs down, states across, click one to open it full size
const names = { 1: 'Arrival plan', 2: 'Local clock', 3: 'Ledger', 4: 'Atlas', 5: 'Rail + sheet' };
const all = [1, 2, 3, 4, 5], every = ['world', 'france', 'japan', 'route', 'playing', 'place', 'pin'];
writeFileSync(path.join(out, 'index.html'), `<!DOCTYPE html><meta charset="utf-8"><title>Side panel mockups, every state</title>
<style>body{margin:0;padding:24px;background:#0d0d10;color:#d4d4d8;font:14px/20px system-ui,sans-serif}h1{font-size:20px;margin:0 0 4px;color:#f4f4f5}p{margin:0 0 20px;color:#9a9aa5}
table{border-collapse:collapse}th{text-align:left;font-weight:500;color:#9a9aa5;padding:0 8px 8px 0}td{padding:0 8px 12px 0;vertical-align:top}td:first-child{color:#f4f4f5;font-weight:600;white-space:nowrap;padding-right:16px}
img{width:300px;display:block;border-radius:4px}a{color:inherit}</style>
<h1>Side panel mockups, every state</h1><p>1440 x 900 at 2x, clock pinned to ${NOW}. <a href="../">Open the clickable mockups</a>.</p>
<table><tr><th></th>${every.map(s => `<th>${s}</th>`).join('')}</tr>${all.map(d => `<tr><td>${d} ${names[d]}</td>${every.map(s => `<td><a href="d${d}-${s}.png"><img src="d${d}-${s}.png" alt="design ${d}, ${s}" loading="lazy"></a></td>`).join('')}</tr>`).join('')}</table>`);
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].join('\n'));
await b.close();
