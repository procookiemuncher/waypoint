// The "Fast to use" card's picture: the real app, served by a VIDA_DRY_RUN=1 server (build.sh
// starts it; no phone is touched), with ⌘K open and "palm" typed. A 1440x900 window at 2x, saved
// to data/app-palette.png.
//
//   node src/capture-app.mjs <port>
import path from 'node:path';
import { TRAILER, ROOT } from './svgkit.mjs';

const { chromium } = await import(path.join(TRAILER, 'node_modules/playwright/index.mjs'));
const port = process.argv[2];
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('#panel .p1-head h1', { state: 'visible', timeout: 90000 });
await page.waitForTimeout(3000);          // the globe settles, the boot log finishes
await page.keyboard.press('Meta+k');
await page.waitForSelector('#pal-box', { state: 'visible' });
await page.keyboard.type('palm', { delay: 60 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(ROOT, 'data/app-palette.png') });
await browser.close();
console.log('data/app-palette.png');
