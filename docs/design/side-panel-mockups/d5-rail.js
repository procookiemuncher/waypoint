/* 5 · Rail + sheet. Questions the frame. The panel splits into a country rail that never goes away and a
   sheet: hovering the rail turns the globe and previews that country in the sheet, a click opens it, and
   another country is one click away with no "back". What the phone is doing moves out of the panel into
   a strip under the map (route, progress, speed, position, Stop & clear, Follow), next to the console. */
(function(){
const totalM = r => r.legs.reduce((s,l) => s+l.m, 0);

function rail(){
  return `<nav class="p5-rail scroll" aria-label="Countries">${byContinent(COUNTRIES).map(([c, ks]) => `<h3>${esc(c)}</h3>${ks.map(k =>
    `<button class="p5-r${S.open===k.name ? ' on' : ''}" data-country="${esc(k.name)}" style="--c:${hueOf(k.name)}" aria-current="${S.open===k.name}"><span class="dot"></span><span class="n">${esc(k.name)}</span><span class="c num">${k.routes || ''}</span></button>`).join('')}`).join('')}</nav>`;
}

/* ---- the sheet ---- */
function routeRow(r){
  const sel = S.sel?.kind==='route' && S.sel.id===r.id, live = S.live?.kind==='route' && S.live.id===r.id;
  return `<button class="p5-it${sel?' is-sel':''}${live?' is-live':''}" data-route="${esc(r.id)}" style="--c:${hueOfCity(r.city)}">
    <span class="n">${esc(r.label)}</span><span class="v num">${durShort(r.play)}</span>
    <span class="b">${UI.legs(r)}</span><span class="s num">${miles(totalM(r))}</span></button>`;
}
function placeRow(p){
  const o = openState(p), sel = S.sel?.kind==='place' && S.sel.id===p.id, held = S.live?.kind==='place' && S.live.id===p.id;
  return `<button class="p5-it pl${sel?' is-sel':''}${held?' is-live':''}" data-place="${esc(p.id)}" style="--c:${hueOfCity(p.city)}">
    <span class="n">${esc(p.name)}</span><span class="v${o?.open?' open-now':''}">${held ? 'Holding' : o ? esc(o.label) : ''}</span>
    <span class="k">${esc([kindLabel(p), p.hours ? hoursLabel(p.hours) : null, p.note].filter(Boolean).join(' · '))}</span></button>`;
}
function countrySheet(k, preview){
  const tzs = new Set(k.cities.map(c => utcOffset(CI[c].tz))), one = k.cities.length===1;
  return `<div class="p5-sh scroll${preview?' preview':''}">
    <header class="p5-h"><h1>${esc(k.name)}</h1>${UI.search('')}</header>
    <p class="p5-vibe"><span class="dot" style="--c:${hueOf(k.name)}"></span>${esc(cap(vibeOf(k.name)))}</p>
    <p class="p5-sub num">${esc([one ? k.cities[0] : plural(k.cities.length,'city'), plural(k.routes,'route'), plural(k.places,'place')].join(' · '))} · ${tzs.size===1 ? clockAt(CI[k.cities[0]].tz, nowMs(), true) : tzs.size+' time zones'}</p>
    ${k.cities.map(c => `<section class="p5-city"><h2>${esc(c)}<span class="num">${esc(CI[c].airport)} · ${clockAt(CI[c].tz)}</span></h2>
      ${cityRoutes(c).map(routeRow).join('')}${cityPlaces(c).map(placeRow).join('')}</section>`).join('')}
  </div>`;
}
function restSheet(){
  // nothing hovered or open: what's open right now, everywhere
  const spots = LIB.places.filter(p => p.hours), open = spots.filter(p => openState(p).open);
  const next = spots.filter(p => !openState(p).open).map(p => ({ p, in:((p.hours[0]-parts(CI[p.city].tz).t)+24)%24 })).sort((a,b) => a.in-b.in);
  const row = (p, v, on) => `<button class="p5-it pl" data-place="${esc(p.id)}" data-open-country="${esc(CI[p.city].country)}" style="--c:${hueOfCity(p.city)}"><span class="n">${esc(p.name)}</span><span class="v${on?' open-now':''}">${v}</span><span class="k">${esc(p.city)} · ${clockAt(CI[p.city].tz)}</span></button>`;
  return `<div class="p5-sh scroll">
    <header class="p5-h"><h1>Destinations</h1>${UI.search('')}</header>
    <p class="p5-sub num">${TOTAL.countries} countries · ${TOTAL.cities} cities · ${TOTAL.routes} routes</p>
    <section class="p5-city"><h2>Open now<span class="num">${open.length} of ${spots.length}</span></h2>${open.map(p => row(p, esc(openState(p).label), true)).join('')}</section>
    <section class="p5-city"><h2>Opening next</h2>${next.slice(0, 6).map(x => row(x.p, `in ${dur(x.in*3600)}`)).join('')}</section>
  </div>`;
}
function sheetDock(){
  if(!S.sel || (S.live && S.live.kind===S.sel.kind && S.live.id===S.sel.id)) return '';
  if(S.sel.kind==='route'){
    const r = ROUTE(S.sel.id);
    return `<div class="p5-dock" style="--c:${hueOfCity(r.city)}"><div class="p5-dt"><b>${esc(r.label)}</b><span class="num">${miles(totalM(r))} · ${dur(r.play)} · at the door ${clockAt(CI[r.city].tz, nowMs()+r.play*1000)}</span></div>
      <div class="p5-ctl">${UI.engines()}${UI.mph()}</div><div class="p5-ctl">${UI.play()}</div>${UI.note()}</div>`;
  }
  if(S.sel.kind==='pin'){
    const p = S.pin;
    return `<div class="p5-dock"><div class="p5-dt"><b>${esc(p.name)}</b><span class="num">Dropped pin · ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span><span>${esc(p.sub)}. Click the map to move it.</span></div><div class="p5-ctl">${UI.set('Set location here')}</div></div>`;
  }
  const p = PLACE(S.sel.id);
  return `<div class="p5-dock"><div class="p5-dt"><b>${esc(p.name)}</b><span class="num">${esc(kindLabel(p))} · ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span></div><div class="p5-ctl">${UI.set()}</div></div>`;
}

/* ---- the phone, under the map ---- */
function strip(){
  const dev = `<span class="p5-dev"><span class="led"></span>iPhone · USB · iOS 27.0.1</span>`;
  if(!S.live) return `<div class="p5-ph idle">${dev}<p class="big">On its real location</p><p class="sm">Nothing is spoofed right now.</p></div>`;
  if(S.live.kind==='place') return `<div class="p5-ph"><div class="top"><div class="who"><p class="big">Holding at ${esc(S.live.name)}</p><p class="sm num">${S.live.lat.toFixed(5)}, ${S.live.lon.toFixed(5)} · the phone stays here until you stop</p></div>${dev}</div><div class="row"><div class="ctl">${UI.stop()}</div></div></div>`;
  const L = liveNow(), r = L.r;
  return `<div class="p5-ph" style="--c:${hueOfCity(r.city)}">
    <div class="top"><div class="who"><p class="big">${esc(r.label)}</p><p class="sm num">${esc(r.city)} · ${esc(L.how)} · <span data-live="pos">${L.a.pos[0].toFixed(5)}, ${L.a.pos[1].toFixed(5)}</span></p></div>${dev}</div>
    <div class="row"><div class="fig num"><b data-live="mph">${Math.round(L.mphNow)}</b><small>mph, <span data-live="doinglc">${L.doing.toLowerCase()}</span></small></div>
      <div class="fig num"><b data-live="elapsed">${clock(L.a.t)}</b><small>of ${clock(r.play)}</small></div>
      <div class="fig num"><b data-live="left">${clock(L.a.left)}</b><small>left</small></div>
      <div class="fig num"><b data-live="dist">${milesN(L.a.dist)}</b><small>of ${miles(totalM(r))}</small></div>
      <div class="fig num"><b data-live="arrive">${L.arrive}</b><small>at the door</small></div>
      <div class="ctl">${UI.follow()}${UI.stop()}</div></div>
    <div class="prog" data-live-bar style="--pct:${(L.a.pct*100).toFixed(2)}%">${UI.legs(r)}<span class="ov">${UI.legs(r)}</span></div>
  </div>`;
}

function render(S){
  const k = S.open ? country(S.open) : S.hover ? country(S.hover) : null;
  return { panel: `<div class="p5-wrap">${rail()}<div class="p5-right">${k ? countrySheet(k, !S.open) : restSheet()}${sheetDock()}</div></div>`, strip: strip() };
}
design({ id:5, name:'Rail + sheet', layout:'strip', keepHover:true,
  idea:'Questions the frame: a country rail that stays, a sheet that previews on hover, and the phone’s live state moved to a strip under the map.',
  onHover: S => { if(S.open) return; const k = country(S.hover); const right = document.querySelector('.p5-right'); if(right && k) right.innerHTML = countrySheet(k, true)+sheetDock(); markHover(); },
  render });
})();
