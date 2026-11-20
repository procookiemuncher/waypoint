// Refreshes lib.js: the app's own library (cities, and routes/places as app.js assigns them to cities)
// pulled out of a running dry-run app, so every count in the prototype is the app's real count.
//
//   cd core && VIDA_DRY_RUN=1 VIDA_PORT=8765 ../.venv/bin/python backend/server.py     (in another terminal)
//   node docs/design/world-view-prototype/dump-lib.mjs
//
// Playwright comes from the promo-film folder's node_modules (there's no package.json here).
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../../cini videos/v1/sting/package.json'));
const { chromium } = require('playwright');

const b = await chromium.launch({ headless: false, args: ['--headless=new'] });   // the headless-shell build isn't installed
const p = await b.newPage();
await p.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) {
  if (await p.evaluate(() => typeof ROUTES !== 'undefined' && ROUTES.length > 0).catch(() => false)) break;
  await p.waitForTimeout(500);
}
const data = await p.evaluate(() => {
  const cities = {};
  for (const [k, v] of Object.entries(CITY_INFO)) { const { flag, color, ...rest } = v; cities[k] = rest; }
  const routes = ROUTES.map(r => ({ id: r.id, label: r.label, city: r.city, meters: r.meters, seconds: r.seconds,
    modes: r.modes, speed: r.speed_mps, generated: !!r.generated,
    line: r.line.filter((_, i) => i % Math.max(1, Math.floor(r.line.length / 40)) === 0 || i === r.line.length - 1) }));
  const places = PLACES.map(q => ({ id: q.id, name: q.name, city: q.city, kind: q.kind || null, hours: q.hours || null, lat: q.lat, lon: q.lon }));
  return { cities, routes, places };
});
writeFileSync(path.join(here, 'lib.js'), 'window.LIB = ' + JSON.stringify(data) + ';\n');
console.log(`lib.js: ${Object.keys(data.cities).length} cities, ${data.routes.length} routes, ${data.places.length} places`);
await b.close();
