/* 3 · Ledger. The panel is a table you can sort: the List question (continent or route count) becomes a
   sort control, with local time and open-now beside them. A country is three tables, its cities, its
   routes and its places, every figure in a column you can compare. The pick gets a key-value sheet. */
(function(){
const SORTS = [['continent','Continent'],['routes','Routes'],['local','Local time'],['open','Open now']];
const spotsOf = k => k.cities.flatMap(cityPlaces).filter(p => p.hours);
const openCount = k => spotsOf(k).filter(p => openState(p).open).length;
const localT = k => parts(CI[k.cities[0]].tz).t;
const totalM = r => r.legs.reduce((s,l) => s+l.m, 0);

function row(k){
  const sp = spotsOf(k), p = parts(CI[k.cities[0]].tz);
  return `<tr class="p3-tr" data-country="${esc(k.name)}" style="--c:${hueOf(k.name)}" tabindex="0">
    <td class="id"><div class="idw"><span class="dot"></span><span class="t"><b>${esc(k.name)}</b><small>${esc(k.cities.join(', '))}</small></span></div></td>
    <td class="num">${ampm(p.h, p.m)}<small>${p.wd}</small></td>
    <td class="num">${k.routes}</td><td class="num">${k.places}</td>
    <td class="num">${sp.length ? `${openCount(k)}<span class="of"> /${sp.length}</span>` : '<span class="dash">—</span>'}</td></tr>`;
}
function world(){
  const by = { routes:(a,b) => b.routes-a.routes || a.name.localeCompare(b.name), local:(a,b) => localT(b)-localT(a), open:(a,b) => openCount(b)-openCount(a) || b.routes-a.routes };
  const head = `<thead><tr><th>Country</th><th class="num${S.sort==='local'?' on':''}">Local</th><th class="num${S.sort==='routes'?' on':''}">Routes</th><th class="num">Places</th><th class="num${S.sort==='open'?' on':''}">Open</th></tr></thead>`;
  const body = S.sort==='continent'
    ? byContinent(COUNTRIES).map(([c, ks]) => `<tbody><tr class="p3-gr"><th colspan="5">${esc(c)}<span class="num">${ks.reduce((s,k)=>s+k.routes,0)} routes</span></th></tr>${ks.map(row).join('')}</tbody>`).join('')
    : `<tbody>${[...COUNTRIES].sort(by[S.sort]).map(row).join('')}</tbody>`;
  return `<div class="scroll">
    <header class="p3-head"><div><h1>Destinations</h1><p class="p3-sub num">${TOTAL.countries} countries · ${TOTAL.cities} cities · ${TOTAL.routes} routes · ${TOTAL.places} places</p></div>${UI.search()}</header>
    <div class="p3-bar"><span>Sort by</span>
      <div class="ui-seg p3-sort" role="group" aria-label="Sort">${SORTS.map(([id, l]) => `<button data-sort="${id}" class="${S.sort===id?'on':''}" aria-pressed="${S.sort===id}">${l}</button>`).join('')}</div></div>
    <table class="p3-t p3-world">${head}${body}</table>
  </div>`;
}

/* ---- a country: cities, routes, places ---- */
const selRow = (kind, id) => (S.sel?.kind===kind && S.sel.id===id ? ' is-sel' : '') + (S.live?.kind===kind && S.live.id===id ? ' is-live' : '');
function countryView(k){
  const tzs = new Set(k.cities.map(c => utcOffset(CI[c].tz))), live = liveNow();
  const routes = k.cities.flatMap(cityRoutes), places = k.cities.flatMap(cityPlaces);
  const cities = `<table class="p3-t"><thead><tr><th>City</th><th>Arrival airport</th><th class="num">Local</th><th class="num">Routes</th><th class="num">Places</th></tr></thead><tbody>
    ${k.cities.map(c => `<tr><td class="id"><b>${esc(c)}</b><small>${esc(utcOffset(CI[c].tz))}</small></td><td>${esc(CI[c].airportName)}<small>${esc(CI[c].airport)}</small></td>
      <td class="num">${clockAt(CI[c].tz)}</td><td class="num">${cityRoutes(c).length}</td><td class="num">${cityPlaces(c).length}</td></tr>`).join('')}</tbody></table>`;
  const rt = `<table class="p3-t p3-rt"><thead><tr><th>Route</th><th>Legs</th><th class="num">Miles</th><th class="num">Time</th><th class="num">At the door</th></tr></thead><tbody>
    ${routes.map(r => { const isL = live && live.r.id===r.id;
      return `<tr class="p3-tr${selRow('route', r.id)}" data-route="${esc(r.id)}" style="--c:${hueOfCity(r.city)}" tabindex="0">
      <td class="id"><span><b>${esc(r.label)}</b><small>${esc(r.city)}${r.generated ? '' : ' · test route'}</small></span></td>
      <td class="lg">${isL ? `<span class="p3-pb" data-live-bar style="--pct:${(live.a.pct*100).toFixed(2)}%">${UI.legs(r)}<span class="ov">${UI.legs(r)}</span></span>` : UI.legs(r)}</td>
      <td class="num">${milesN(totalM(r))}</td><td class="num">${durShort(r.play)}</td>
      <td class="num">${isL ? `<span data-live="arrive">${live.arrive}</span>` : clockAt(CI[r.city].tz, nowMs()+r.play*1000)}</td></tr>`; }).join('')}</tbody></table>`;
  const pl = `<table class="p3-t"><thead><tr><th>Place</th><th>Hours, local</th><th class="num">Now</th></tr></thead><tbody>
    ${places.map(p => { const o = openState(p);
      return `<tr class="p3-tr${selRow('place', p.id)}" data-place="${esc(p.id)}" style="--c:${hueOfCity(p.city)}" tabindex="0">
      <td class="id"><span><b>${esc(p.name)}</b><small>${esc([kindLabel(p), p.city].join(' · '))}</small></span></td>
      <td>${p.hours ? esc(hoursLabel(p.hours)) : '<span class="dash">—</span>'}${p.note ? `<small>${esc(p.note)}</small>` : ''}</td>
      <td class="num ${o?.open ? 'open-now' : ''}">${S.live?.kind==='place' && S.live.id===p.id ? 'Holding' : o ? esc(o.label) : p.kind==='hotel' ? '<span class="of">Any hour</span>' : '<span class="dash">—</span>'}</td></tr>`; }).join('')}</tbody></table>`;
  return `<div class="scroll">
    <div class="p3-top">${UI.back()}${UI.search()}</div>
    <header class="p3-ch"><h1>${esc(k.name)}</h1><span class="p3-vibe"><span class="dot" style="--c:${hueOf(k.name)}"></span>${esc(cap(vibeOf(k.name)))}</span></header>
    <p class="p3-sub num">${tzs.size===1 ? `${clockAt(CI[k.cities[0]].tz, nowMs(), true)} · ${[...tzs][0]}` : `${tzs.size} time zones`} · ${esc(k.continent)}</p>
    <h2 class="p3-h2">Routes<span class="num">${routes.length}</span></h2>${rt}
    <h2 class="p3-h2">Places<span class="num">${places.length}</span></h2>${pl}
    <h2 class="p3-h2">${k.cities.length===1 ? 'City' : 'Cities'}<span class="num">${k.cities.length}</span></h2>${cities}
  </div>${dock()}`;
}

/* ---- the sheet for what's picked ---- */
const kv = list => `<dl class="p3-kv">${list.filter(Boolean).map(([k, v, cls]) => `<div><dt>${k}</dt><dd class="num ${cls||''}">${v}</dd></div>`).join('')}</dl>`;
function dock(){
  const showSel = S.sel && !(S.live && S.live.kind===S.sel.kind && S.live.id===S.sel.id);
  if(!showSel && !S.live) return '';
  let h = '';
  if(showSel && S.sel.kind==='route'){
    const r = ROUTE(S.sel.id), tz = CI[r.city].tz, end = routeEnd(r), st = end?.hours ? openState(end, nowMs()+r.play*1000) : null;
    const leg = m => r.legs.filter(l => l.mode===m).reduce((s,l) => s+l.s, 0);
    h += `<div class="p3-card"><div class="p3-ct"><b>${esc(r.label)}</b><span class="muted">${esc(r.city)}</span></div>${kv([
      ['From', r.from ? esc(r.from.name) : '<span class="dash">—</span>'], ['To', end ? esc(end.name) : '<span class="dash">—</span>'],
      ['Distance', miles(totalM(r))], ['Plays for', dur(r.play)],
      ['Driving', leg('drive') ? `${dur(leg('drive'))}${cruise(r) ? ` · cruise ${cruise(r)} mph` : ''}` : '<span class="dash">—</span>'], ['Walking · parked', `${leg('walk') ? dur(leg('walk')) : '0 min'} · ${leg('stop') ? dur(leg('stop')) : '0 min'}`],
      ['At the door if you start now', clockAt(tz, nowMs()+r.play*1000)], ['Open then', st ? (st.open ? 'Yes, '+esc(st.label.toLowerCase()) : 'No, '+esc(st.label.toLowerCase())) : end ? 'Any hour' : '<span class="dash">—</span>', st ? (st.open ? 'open-now' : 'warn') : ''],
    ])}<div class="p3-ctl">${UI.engines()}${UI.mph()}${UI.play()}</div>${UI.note()}</div>`;
  } else if(showSel && S.sel.kind==='pin'){
    const p = S.pin;
    h += `<div class="p3-card"><div class="p3-ct"><b>${esc(p.name)}</b><span class="muted">Dropped pin</span></div>${kv([['Address', esc(p.sub)], ['Coordinates', `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`]])}
      <div class="p3-ctl"><span class="muted p3-hint">Click the map to move it</span>${UI.set('Set location here')}</div></div>`;
  } else if(showSel){
    const p = PLACE(S.sel.id), o = openState(p);
    h += `<div class="p3-card"><div class="p3-ct"><b>${esc(p.name)}</b><span class="muted">${esc(kindLabel(p))} · ${esc(p.city)}</span></div>${kv([
      ['Hours, local', p.hours ? esc(hoursLabel(p.hours)) : '<span class="dash">—</span>'], ['Now', o ? esc(o.label) : 'Any hour', o?.open ? 'open-now' : ''],
      ['Note', p.note ? esc(p.note) : '<span class="dash">—</span>'], ['Coordinates', `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`]])}
      <div class="p3-ctl">${UI.set()}</div></div>`;
  }
  if(S.live?.kind==='place') h += `<div class="p3-card p3-live"><div class="p3-ct"><b>Holding at ${esc(S.live.name)}</b></div>${kv([['Coordinates', `${S.live.lat.toFixed(5)}, ${S.live.lon.toFixed(5)}`]])}<div class="p3-ctl">${UI.stop()}</div></div>`;
  else if(S.live){
    const L = liveNow(), r = L.r;
    h += `<div class="p3-card p3-live" style="--c:${hueOfCity(r.city)}"><div class="p3-ct"><b>${esc(r.label)}</b><span class="muted">${esc(L.how)}</span></div>
      <div class="p3-bar2" data-live-bar style="--pct:${(L.a.pct*100).toFixed(2)}%"><i></i></div>${kv([
      ['Elapsed', `<span data-live="elapsed">${clock(L.a.t)}</span> <span class="of">of ${clock(r.play)}</span>`], ['Left', `<span data-live="left">${clock(L.a.left)}</span>`],
      ['Now', `<span data-live="doing">${L.doing}</span> · <span data-live="mph">${Math.round(L.mphNow)}</span> mph`], ['At the door', `<span data-live="arrive">${L.arrive}</span>`],
      ['Covered', `<span data-live="dist">${milesN(L.a.dist)}</span> <span class="of">of ${miles(totalM(r))}</span>`], ['Position', `<span data-live="pos">${L.a.pos[0].toFixed(5)}, ${L.a.pos[1].toFixed(5)}</span>`],
    ])}<div class="p3-ctl">${UI.follow()}${UI.stop()}</div></div>`;
  }
  return `<div class="p3-dock">${h}</div>`;
}

design({ id:3, name:'Ledger',
  idea:'A table you can sort: continent, route count, local time or open now. A country is its cities, routes and places as columns you compare.',
  render: S => ({ panel: S.open ? countryView(country(S.open)) : world() }) });
})();
