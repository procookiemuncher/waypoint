/* Shared by the five side panel mockups: the library grouped by country, formatting, the state (from the
   URL, so every state can be linked and screenshotted), the globe, clicks and hovers, and the console.
   A design is { id, name, idea, gives, render(S) -> { panel, strip? } }, registered with design().
   Everything a design shows comes from data.js (dump-data.py): nothing on screen is typed in by hand. */
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plural = (n, w) => `${n} ${n===1 ? w : w.endsWith('y') ? w.slice(0,-1)+'ies' : w+'s'}`;
const cap = s => s ? s[0].toUpperCase()+s.slice(1) : s;
const CI = LIB.cities;

/* ---- the clock. ?now=2026-11-20T19:30:00Z pins it, so a screenshot run shows one instant ---- */
const Q = new URLSearchParams(location.search);
const PINNED = Q.get('now') ? Date.parse(Q.get('now')) : null;
const nowMs = () => PINNED ?? Date.now();

/* ---- the library by country (same grouping as the prototype) ---- */
const cityRoutes = c => LIB.routes.filter(r => r.city===c);
const cityPlaces = c => LIB.places.filter(p => p.city===c);
const cityCount = c => cityRoutes(c).length + cityPlaces(c).length;
const COUNTRIES = (() => {
  const by = new Map();
  for(const c of Object.keys(CI)){
    const k = CI[c].country;
    if(!by.has(k)) by.set(k, { name:k, continent:CI[c].continent, cities:[] });
    by.get(k).cities.push(c);
  }
  for(const k of by.values()){
    k.cities.sort((a,b) => cityCount(b)-cityCount(a) || a.localeCompare(b));
    k.routes = k.cities.reduce((s,c) => s+cityRoutes(c).length, 0);
    k.places = k.cities.reduce((s,c) => s+cityPlaces(c).length, 0);
  }
  return [...by.values()].sort((a,b) => b.routes-a.routes || b.places-a.places || a.name.localeCompare(b.name));
})();
const country = name => COUNTRIES.find(k => k.name===name);
const TOTAL = { countries:COUNTRIES.length, cities:Object.keys(CI).length, routes:LIB.routes.length, places:LIB.places.length };
const ROUTE = id => LIB.routes.find(r => r.id===id);
const PLACE = id => LIB.places.find(p => p.id===id);
const CONTINENTS = [...new Set(COUNTRIES.map(k => k.continent))];
function byContinent(list){
  const g = new Map();
  for(const k of list){ if(!g.has(k.continent)) g.set(k.continent, []); g.get(k.continent).push(k); }
  return [...g];
}

// one colour per country, picked for the place's feel (the prototype's HUE table, unchanged)
const HUE = {
  'United States':['#f471aa','Miami neon pink'], 'Mexico':['#e08256','Cabo desert terracotta'],
  'Saint Barthélemy':['#47d6cf','Caribbean turquoise'], 'Monaco':['#e9504d','Grand Prix red'],
  'France':['#bca1ed','Provence lavender'], 'United Kingdom':['#53ae77','racing green'],
  'Greece':['#4c94ec','Aegean blue'], 'Spain':['#f59740','Ibiza sunset orange'],
  'Italy':['#efd956','Amalfi lemon'], 'Switzerland':['#afd9ea','glacier ice'],
  'United Arab Emirates':['#e1b75c','desert gold'], 'Japan':['#f1b8cd','sakura'],
  'Singapore':['#cf78d5','orchid'], 'Indonesia':['#67bb6b','Bali jungle green'],
  'Morocco':['#4170e9','Majorelle blue'], 'South Africa':['#ec8a92','protea coral'],
  'Brazil':['#79c24a','Copacabana green'], 'Uruguay':['#82c7f0','celeste'],
  'Australia':['#de844f','outback ochre'], 'Maldives':['#5ddae0','lagoon aqua'],
  'French Polynesia':['#ec6480','hibiscus'],
};
const hueOf = name => HUE[name][0];
const vibeOf = name => HUE[name][1];
const hueOfCity = c => hueOf(CI[c].country);

/* ---- a city's arrivals, worked out from the generated routes' ends ---- */
function chain(city){
  const rs = cityRoutes(city), ps = cityPlaces(city), gen = rs.filter(r => r.generated);
  const arrivals = gen.filter(r => r.from.kind==='airport');
  const onward = gen.filter(r => r.from.kind==='spot');
  const inChain = new Set(gen.flatMap(r => [r.to.id, r.from.kind==='spot' ? r.from.id : null]));
  return { arrivals, onward, other: rs.filter(r => !r.generated), loose: ps.filter(p => !inChain.has(p.id)), places: ps };
}

/* ---- time. Every local time is the city's own, from its tz ---- */
function parts(tz, ms = nowMs()){
  const p = new Intl.DateTimeFormat('en-US', { timeZone:tz, weekday:'short', hour:'numeric', minute:'2-digit', hourCycle:'h23', month:'short', day:'numeric' }).formatToParts(new Date(ms));
  const g = t => p.find(x => x.type===t)?.value;
  const h = +g('hour') % 24, m = +g('minute');
  return { h, m, t:h+m/60, wd:g('weekday'), mon:g('month'), day:+g('day') };
}
const ampm = (h, m) => `${(h%12)||12}${m ? ':'+String(m).padStart(2,'0') : ''} ${h%24<12 ? 'am' : 'pm'}`;
function clockAt(tz, ms = nowMs(), day = false){
  const p = parts(tz, ms);
  return (day ? p.wd+' ' : '') + `${(p.h%12)||12}:${String(p.m).padStart(2,'0')} ${p.h<12 ? 'am' : 'pm'}`;
}
const hourLabel = x => { const h = Math.floor(x)%24, m = Math.round((x-Math.floor(x))*60); return ampm(h, m); };
const hoursLabel = hs => `${hourLabel(hs[0])} – ${hs[1]%24===0 ? 'midnight' : hourLabel(hs[1])}`;
function utcOffset(tz){
  const s = new Intl.DateTimeFormat('en-US', { timeZone:tz, timeZoneName:'shortOffset' }).formatToParts(new Date(nowMs())).find(x => x.type==='timeZoneName').value;
  return s.replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0');
}
// a spot with hours, against the pinned (or real) clock. null = no hours (hotels, saved places)
function openState(p, ms = nowMs()){
  if(!p.hours) return null;
  const tz = CI[p.city].tz, t = parts(tz, ms).t, [a,b] = p.hours;
  const open = a<b ? t>=a && t<b : t>=a || t<b;
  const close = b%24===0 ? 'midnight' : hourLabel(b);
  return open ? { open:true, label:`Open till ${close}` } : { open:false, label:`Opens ${hourLabel(a)}` };
}
// part of the local day, for the clock design's groups
function dayPart(t){ return t<5 ? 'Late night' : t<12 ? 'Morning' : t<17 ? 'Afternoon' : t<21 ? 'Evening' : 'Night'; }

/* ---- numbers ---- */
const MPH = 2.23694;
const miles = m => { const x = m/1609.34; return x.toFixed(x<10 ? 1 : 0)+' mi'; };
const milesN = m => { const x = m/1609.34; return x.toFixed(x<10 ? 1 : 0); };
const dur = s => { const m = Math.max(1, Math.round(s/60)); return m<60 ? `${m} min` : `${Math.floor(m/60)} h ${m%60} min`; };
const durShort = s => { const m = Math.max(1, Math.round(s/60)); return m<60 ? `${m}m` : `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`; };
const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60;
  return (h ? h+':'+String(m).padStart(2,'0') : String(m)) + ':' + String(x).padStart(2,'0'); };
const cruise = r => r.speed ? Math.round(r.speed*MPH) : null;
const mainMode = r => r.modes.includes('drive') ? 'drive' : r.modes.includes('walk') ? 'walk' : 'stop';
const legDoing = (l, r, done) => done ? 'Arrived' : l.mode==='walk' ? 'Walking' : l.mode==='drive' ? 'Driving' : r.generated ? 'Parked at the door' : 'Stopped';
const legName = (l, r) => l.mode==='walk' ? 'Walk' : l.mode==='drive' ? 'Drive' : r.generated ? 'Parked' : 'Stopped';
const legsText = r => r.legs.map(l => `${legName(l, r).toLowerCase()} ${durShort(l.s)}`).join(' · ');
const legsLong = r => r.legs.map(l => `${legName(l, r).toLowerCase()} ${dur(l.s)}`).join(' · ');
const routeEnd = r => r.to ? PLACE(r.to.id) : null;
function kindLabel(p){ return p.kind ? cap(p.kind) : p.saved ? 'Saved place' : 'Place'; }

/* ---- the state. ?d=1..5&s=world|france|japan|route|playing|place|pin ---- */
const STATES = ['world','france','japan','route','playing','place','pin'];
const STATE_NAMES = { world:'World', france:'France', japan:'Japan', route:'Route', playing:'Playing', place:'Place', pin:'Pin' };
const DEMO = { route:'cdg-to-ritz-paris', place:'club-55', elapsed:845,
  // a pin as ⌘K `go place vendome` leaves it (Photon's answer for Place Vendôme)
  pin:{ lat:48.86750, lon:2.32940, name:'Place Vendôme', sub:'75001 Paris, France' } };
const S = { d:1, s:'world', hover:null, open:null, sel:null, engine:'drive', mph:'', live:null, follow:true, pin:null, sort:'continent', log:[] };

function setState(s){
  S.s = s; S.sel = null; S.live = null; S.pin = null; S.hover = null; S.mph = ''; S.engine = 'drive'; S.follow = true;
  S.open = s==='world' ? null : s==='japan' ? 'Japan' : 'France';
  if(s==='world') S.hover = 'France';
  if(s==='route' || s==='playing') S.sel = { kind:'route', id:DEMO.route };
  if(s==='playing') S.live = { kind:'route', id:DEMO.route, engine:'drive', mph:null, started:nowMs()-DEMO.elapsed*1000 };
  if(s==='place') S.sel = { kind:'place', id:DEMO.place };
  if(s==='pin'){ S.pin = DEMO.pin; S.sel = { kind:'pin' }; }
  S.log = baseLog();
  if(S.live) S.log.push(...playLog(ROUTE(S.live.id), 'drive', null, DEMO.elapsed));
}

/* ---- the live route: where it is at the elapsed time, all from the route's legs and line ---- */
function elapsed(){ return S.live ? Math.max(0, (nowMs()-S.live.started)/1000) : 0; }
function hav(a, b){
  const R = Math.PI/180, la1 = a[0]*R, la2 = b[0]*R;
  const h = Math.sin((la2-la1)/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin((b[1]-a[1])*R/2)**2;
  return 2*6371000*Math.asin(Math.sqrt(h));
}
function along(r, f){   // the point a fraction f of the way along the drawn line
  const L = r.line, cum = [0];
  for(let i=1;i<L.length;i++) cum.push(cum[i-1]+hav(L[i-1], L[i]));
  const d = f*cum[cum.length-1];
  let i = 1; while(i<cum.length-1 && cum[i]<d) i++;
  const t = (d-cum[i-1])/((cum[i]-cum[i-1]) || 1);
  return [L[i-1][0]+(L[i][0]-L[i-1][0])*t, L[i-1][1]+(L[i][1]-L[i-1][1])*t];
}
function routeAt(r, t){
  t = Math.min(t, r.play);
  let acc = 0, accM = 0, i = 0;
  while(i<r.legs.length-1 && acc+r.legs[i].s<t){ acc += r.legs[i].s; accM += r.legs[i].m; i++; }
  const leg = r.legs[i], lf = leg.s ? (t-acc)/leg.s : 1, totalM = r.legs.reduce((s,l) => s+l.m, 0);
  const dist = accM + leg.m*lf;
  return { t, leg, i, legLeft:leg.s-(t-acc), pct:t/r.play, left:r.play-t, dist, fdist:totalM ? dist/totalM : 0,
    pos:along(r, totalM ? dist/totalM : 0), mph: leg.mode==='stop' ? 0 : Math.round(leg.m/leg.s*MPH*10)/10, done:t>=r.play };
}
function liveNow(){
  if(!S.live || S.live.kind!=='route') return null;
  const r = ROUTE(S.live.id), a = routeAt(r, elapsed());
  const tz = CI[r.city].tz;
  return { r, a, tz, arrive:clockAt(tz, nowMs()+a.left*1000), how:howLine(S.live), doing:legDoing(a.leg, r, a.done),
    mphNow: a.done || a.leg.mode==='stop' ? 0 : S.live.engine==='drive' && S.live.mph ? S.live.mph : a.mph };
}
const howLine = l => l.engine==='drive' ? (l.mph ? `Drive · ${Math.round(l.mph)} mph` : 'Drive · varying') : 'Spoof';
const engineNote = () => S.engine==='drive'
  ? (S.mph ? 'Real speed, held steady at the mph you typed. No stops.' : 'Real speed: Life360 shows mph and the car. Speeds up, slows for bends, stops at the door. Type an mph to hold one speed.')
  : 'Position only: Life360 shows 0 mph, but follows the route’s slow-downs and stops.';

/* ---- pieces every design uses, styled by each design's CSS ---- */
const UI = {
  icon: (n, s = 16) => icon(n, s),
  search: (label = 'Search') => `<button class="ui-search" data-act="search" title="Search (⌘K)" aria-label="Search, ⌘K">${icon('search',16)}<span>${label}</span><kbd>⌘K</kbd></button>`,
  engines: () => `<div class="ui-seg" role="group" aria-label="Engine">${['drive','spoof'].map(e => `<button data-engine="${e}" class="${S.engine===e?'on':''}" aria-pressed="${S.engine===e}">${e==='drive'?'Drive':'Spoof'}</button>`).join('')}</div>`,
  mph: () => S.engine!=='drive' ? '' : `<label class="ui-mph"><input data-mph type="number" min="1" max="200" step="1" placeholder="Auto" value="${esc(S.mph)}" aria-label="Speed in mph, blank for the route's own"><span>mph</span></label>`,
  note: () => `<p class="ui-note" data-enote>${esc(engineNote())}</p>`,
  play: (label = 'Play route') => `<button class="ui-primary" data-act="play">${icon('play',14)}${label}</button>`,
  set: (label = 'Set location') => `<button class="ui-primary" data-act="set">${icon('map-pin',15)}${label}</button>`,
  stop: () => `<button class="ui-secondary" data-act="stop">${icon('square',13)}Stop &amp; clear</button>`,
  follow: () => `<button class="ui-toggle${S.follow?' on':''}" data-act="follow" aria-pressed="${S.follow}">${icon('locate-fixed',15)}Follow</button>`,
  back: (label = 'All countries') => `<button class="ui-back" data-back>${icon('chevron-left',16)}${label}</button>`,
  // walk / drive / parked, as long as each takes. Drive in the country's colour, walk a pale step of it, parked hatched
  legs: (r, cls = '') => `<span class="ui-legs ${cls}" style="--c:${hueOfCity(r.city)}" role="img" aria-label="${esc(legsText(r))}">${r.legs.map(l => `<i class="lg-${l.mode}" style="flex:${l.s} 0 3px"></i>`).join('')}</span>`,
  // the route's own line, fitted into w x h (equirectangular, scaled by the latitude)
  line(r, w, h, o = {}){
    const L = r.line, k = Math.cos(L[0][0]*Math.PI/180);
    const xs = L.map(p => p[1]*k), ys = L.map(p => -p[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pad = o.pad ?? 6;
    const s = Math.min((w-2*pad)/((x1-x0)||1e-9), (h-2*pad)/((y1-y0)||1e-9));
    const ox = (w-(x1-x0)*s)/2, oy = (h-(y1-y0)*s)/2;
    const P = p => [(p[1]*k-x0)*s+ox, (-p[0]-y0)*s+oy].map(v => v.toFixed(1));
    const d = L.map((p,i) => (i?'L':'M')+P(p).join(' ')).join('');
    const c = hueOfCity(r.city), a = P(L[0]), b = P(L[L.length-1]);
    let done = '', dot = '';
    if(o.at != null){
      const n = Math.max(1, Math.round(o.at*(L.length-1)));
      const pos = o.pos ? P(o.pos) : P(L[n]);
      done = `<path d="${L.slice(0, n).map((p,i) => (i?'L':'M')+P(p).join(' ')).join('')}L${pos.join(' ')}" stroke="${c}" stroke-width="${o.sw ? o.sw+.5 : 2.5}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
      dot = `<circle cx="${pos[0]}" cy="${pos[1]}" r="${o.dot || 5}" fill="${c}" stroke="#121319" stroke-width="2"/>`;
    }
    return `<svg class="ui-line" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <path d="${d}" stroke="${c}" stroke-opacity="${o.at != null ? .35 : 1}" stroke-width="${o.sw || 2}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>${done}
      <circle cx="${a[0]}" cy="${a[1]}" r="${o.end || 3}" fill="#121319" stroke="${c}" stroke-width="1.5"/><circle cx="${b[0]}" cy="${b[1]}" r="${o.end || 3}" fill="${c}"/>${dot}</svg>`;
  },
};

/* ---- the console: the app's own lines (taken from a dry run), no monospace ---- */
function baseLog(){
  return [
    { c:'dim', t:'mounting developer disk image (phone must be unlocked)…' },
    { c:'ok', t:'phone unlocked — developer disk image is on' },
    { c:'sys', t:'pick a route or place, or click the map to drop a pin.' },
  ];
}
function playLog(r, engine, mph, upTo){
  const out = [{ c:'cmd', t:`play ${r.id} --${engine}`+(mph?` --mph ${mph}`:'') },
    { c:'dim', t:`building ${r.id} for ${engine}…` }];
  // the drive plan's line from the dry run of this route; another route gets its own numbers in the app
  if(engine==='drive' && !mph && r.id==='cdg-to-ritz-paris') out.push({ c:'dim', t:'wrote build/cdg-to-ritz-paris.vary: 108 moving chunks, 1 stops, 2-41 mph, ~44.9 min' });
  out.push({ c:'accent', t:`playing ${r.id} via ${engine} — keep the phone unlocked` });
  for(let t=30; t<=upTo; t+=30){
    if(upTo-t > 120) continue;   // the console keeps the last few
    const a = routeAt(r, t);
    out.push({ c:'dim', t:`[t+${clock(t)}] ${a.pos[0].toFixed(4)},${a.pos[1].toFixed(4)} · ${a.mph.toFixed(1)}mph` });
  }
  return out;
}
function renderConsole(){
  const el = $('console-log'); if(!el) return;
  el.innerHTML = S.log.slice(-40).map(l => l.c==='cmd'
    ? `<div class="ln cmd"><span class="ps">waypoint ›</span> ${esc(l.t)}</div>` : `<div class="ln ${l.c}">${esc(l.t)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}
const HELP = ['clear — clear the console', 'stop — stop whatever is running and clear the spoof', 'set <place> — hold at a saved place',
  'set <lat> <lon> — hold at a coordinate', 'play <route> [--spoof|--drive] [--mph N]', 'ls [routes|places] — list what you can set or play'];
function runPrompt(line){
  const [name, ...args] = line.trim().split(/\s+/);
  if(!name) return;
  S.log.push({ c:'cmd', t:line.trim() });
  const say = (t, c = 'sys') => S.log.push({ c, t });
  if(name==='help') HELP.forEach(l => say(l));
  else if(name==='clear') S.log = [];
  else if(name==='stop') act('stop', true);
  else if(name==='ls') (args[0]==='places' ? LIB.places.map(p => `place  ${p.id}  ${p.name}`) : LIB.routes.map(r => `route  ${r.id}  ${r.label}`)).forEach(l => say(l));
  else if(name==='play'){ const r = ROUTE(args[0]); if(!r) say(`no route called '${args[0]||''}' — try ls routes`, 'warn'); else { S.engine = args.includes('--spoof') ? 'spoof' : 'drive'; S.open = CI[r.city].country; S.sel = { kind:'route', id:r.id }; act('play', true); } }
  else if(name==='set'){ const p = PLACE(args[0]); if(!p) say(`no place called '${args[0]||''}' — try ls places`, 'warn'); else { S.open = CI[p.city].country; S.sel = { kind:'place', id:p.id }; act('set', true); } }
  else say(`command not found: ${name} — try help`, 'warn');
  render();
}

/* ---- the globe ---- */
const globes = [];
function eachGlobe(f){ globes.forEach(f); }
function focusGlobe(){
  if(S.open) eachGlobe(g => g.focus(S.open, 1.6));
  else if(S.hover) eachGlobe(g => { g.focus(S.hover); g.zoomTo(1); });
  else eachGlobe(g => { g.highlight(null); g.zoomTo(1); });
}
window.globeSettled = () => globes.length>0 && globes.every(g => !g.raf);

/* ---- designs ---- */
const DESIGNS = {};
function design(d){ DESIGNS[d.id] = d; }
const current = () => DESIGNS[S.d];

let resetScroll = false;
function render(){
  const D = current();
  const keep = [...$('panel').querySelectorAll('.scroll')].map(e => e.scrollTop);
  document.body.className = 'd'+S.d + (D.layout ? ' lay-'+D.layout : '');
  const out = D.render(S);
  $('panel').innerHTML = out.panel;
  $('strip').innerHTML = out.strip || '';
  if(!resetScroll) $('panel').querySelectorAll('.scroll').forEach((e, i) => { e.scrollTop = keep[i] || 0; });
  resetScroll = false;
  markHover();
  renderConsole();
  tickLive();
  $('d-seg').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.d===S.d));
  $('s-seg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s===S.s));
  $('idea').textContent = D.idea; $('idea').title = D.idea;
  const sel = $('panel').querySelector('.is-live, .is-sel');
  if(sel) sel.scrollIntoView({ block:'nearest' });
}
function markHover(){
  document.querySelectorAll('[data-country]').forEach(b => b.classList.toggle('hov', !S.open && b.dataset.country===S.hover));
}
// values that change while a route plays, updated in place so a re-render never resets scroll or hover
function tickLive(){
  const L = liveNow(); if(!L) return;
  const set = (k, v) => document.querySelectorAll(`[data-live="${k}"]`).forEach(e => { e.textContent = v; });
  set('elapsed', clock(L.a.t)); set('left', clock(L.a.left)); set('arrive', L.arrive); set('pct', Math.round(L.a.pct*100)+'%');
  set('mph', String(Math.round(L.mphNow))); set('leg', L.a.done ? 'Arrived' : legName(L.a.leg, L.r)); set('doing', L.doing); set('legleft', dur(L.a.legLeft));
  set('dist', milesN(L.a.dist)); set('pos', `${L.a.pos[0].toFixed(5)}, ${L.a.pos[1].toFixed(5)}`);
  document.querySelectorAll('[data-live-bar]').forEach(e => e.style.setProperty('--pct', (L.a.pct*100).toFixed(2)+'%'));
}
setInterval(() => { if(S.live && !PINNED) tickLive(); }, 1000);

function syncUrl(){
  const q = new URLSearchParams(location.search); q.set('d', S.d); q.set('s', S.s);
  history.replaceState(null, '', '?'+q.toString());
}

/* ---- what clicks do ---- */
function openCountry(name){ S.open = name; S.sel = null; S.pin = null; S.hover = null; focusGlobe(); resetScroll = true; render(); }
function closeCountry(){ const was = S.open; S.open = null; S.sel = null; S.pin = null; S.hover = null; focusGlobe(); render();
  document.querySelector(`[data-country="${CSS.escape(was)}"]`)?.scrollIntoView({ block:'nearest' }); }
function act(a, quiet){
  if(a==='play' && S.sel?.kind==='route'){
    const r = ROUTE(S.sel.id), mph = S.engine==='drive' && +S.mph>0 ? +S.mph : null;
    S.live = { kind:'route', id:r.id, engine:S.engine, mph, started:nowMs() };
    if(!quiet) S.log.push(...playLog(r, S.engine, mph, 0));
    else S.log.push(...playLog(r, S.engine, mph, 0).slice(1));
  } else if(a==='set' && (S.sel?.kind==='place' || S.sel?.kind==='pin')){
    const p = S.sel.kind==='pin' ? { name:S.pin.name, lat:S.pin.lat, lon:S.pin.lon } : PLACE(S.sel.id);
    if(!quiet) S.log.push({ c:'cmd', t:S.sel.kind==='pin' ? `set ${p.lat.toFixed(5)} ${p.lon.toFixed(5)}` : `set ${S.sel.id}` });
    S.live = { kind:'place', id:S.sel.id, name:p.name, lat:p.lat, lon:p.lon, started:nowMs() };
    S.log.push({ c:'accent', t:`holding at ${p.name} (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})` });
  } else if(a==='stop'){
    if(!quiet) S.log.push({ c:'cmd', t:'stop' });
    if(S.live) S.log.push({ c:'dim', t:`clearing ${S.live.kind==='route' && S.live.engine==='drive' ? 'coredevice' : 'pmd3'} location sim…` }, { c:'ok', t:'cleared — phone is back on real GPS' });
    S.live = null;
  } else if(a==='follow') S.follow = !S.follow;
  else if(a==='search') S.log.push({ c:'sys', t:'⌘K opens the command palette here (go, play, pin, open, stop).' });
  if(!quiet) render();
}

function wire(){
  const stage = $('stage');
  stage.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-country]');
    if(!t || (S.open && !current().hoverOpen)) return;
    if(S.hover===t.dataset.country) return;
    S.hover = t.dataset.country;
    if(!S.open) focusGlobe();
    if(current().onHover) current().onHover(S); else markHover();
  });
  $('panel').addEventListener('mouseleave', () => {
    if(S.open || current().keepHover) return;
    S.hover = null; focusGlobe(); markHover();
  });
  stage.addEventListener('click', e => {
    const t = e.target.closest('[data-country],[data-back],[data-route],[data-place],[data-pin],[data-act],[data-engine],[data-sort]');
    if(!t) return;
    if(t.dataset.back !== undefined) return closeCountry();
    if(t.dataset.engine){ S.engine = t.dataset.engine; return render(); }
    if(t.dataset.sort){ S.sort = t.dataset.sort; return render(); }
    if(t.dataset.act) return act(t.dataset.act);
    if(t.dataset.route){ S.sel = { kind:'route', id:t.dataset.route }; return render(); }
    if(t.dataset.place){ S.sel = { kind:'place', id:t.dataset.place }; return render(); }
    if(t.dataset.pin !== undefined){ S.sel = { kind:'pin' }; return render(); }
    if(t.dataset.country) return openCountry(t.dataset.country);
  });
  stage.addEventListener('input', e => {
    if(!e.target.matches('[data-mph]')) return;
    S.mph = e.target.value;
    document.querySelectorAll('[data-enote]').forEach(n => { n.textContent = engineNote(); });
  });
  $('console-in').addEventListener('keydown', e => {
    if(e.key==='Enter'){ const v = e.target.value; e.target.value = ''; runPrompt(v); }
  });
  document.addEventListener('keydown', e => {
    if(e.key==='Escape' && S.open && document.activeElement!==$('console-in')) closeCountry();
    if((e.metaKey || e.ctrlKey) && e.key==='k'){ e.preventDefault(); act('search'); }
  });
  $('d-seg').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; S.d = +b.dataset.d; render(); syncUrl(); });
  $('s-seg').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; setState(b.dataset.s); focusGlobe(); resetScroll = true; render(); syncUrl(); });
}

function boot(){
  $('d-seg').innerHTML = Object.values(DESIGNS).map(d => `<button data-d="${d.id}"><b>${d.id}</b> ${esc(d.name)}</button>`).join('');
  $('s-seg').innerHTML = STATES.map(s => `<button data-s="${s}">${STATE_NAMES[s]}</button>`).join('');
  S.d = DESIGNS[+Q.get('d')] ? +Q.get('d') : 1;
  setState(STATES.includes(Q.get('s')) ? Q.get('s') : 'world');
  wire();
  render();
  fetch('countries.json').then(r => r.json()).then(shapes => {
    const g = new Globe(document.querySelector('#mapzone canvas'), shapes, { style:'silhouette', tint:'hover', lon:-35, lat:28,
      onHover: name => { if(S.open || name===S.hover) return; S.hover = name; eachGlobe(g => g.highlight(name)); markHover(); if(current().onHover) current().onHover(S); },
      onClick: name => { if(name) openCountry(name); } });
    g.setPlaces(Object.values(CI).map(c => ({ country:c.country, lat:c.lat, lon:c.lon })));
    g.setLit(COUNTRIES.map(k => k.name));
    g.setPalette(Object.fromEntries(Object.entries(HUE).map(([k, v]) => [k, v[0]])));
    globes.push(g);
    focusGlobe();
  });
}
