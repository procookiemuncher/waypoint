/* 4 · Atlas. A guidebook page. The index sets each country large with its vibe name (in its colour only
   when hovered, like the globe). An open country gets a cover in its colour, then each city with its
   facts, and each route drawn as its own line, small, so routes are told apart by shape.
   Bends "no thumbnails in the list": the pictures are the routes themselves, drawn from their lines. */
(function(){
function indexRow(k){
  return `<button class="p4-row" data-country="${esc(k.name)}" style="--c:${hueOf(k.name)}">
    <span class="n">${esc(k.name)}</span><span class="v">${esc(cap(vibeOf(k.name)))}</span>
    <span class="s">${esc(k.cities.join(' · '))}</span>
    <span class="r num">${k.routes ? `<b>${k.routes}</b> ${k.routes===1?'route':'routes'}` : `<b>${k.places}</b> pin only`}</span></button>`;
}
function world(){
  return `<div class="scroll">
    <header class="p4-head"><div><h1>Destinations</h1><p class="sub num">${TOTAL.countries} countries, most routes first</p></div>${UI.search()}</header>
    <div class="p4-index">${COUNTRIES.map(indexRow).join('')}</div>
  </div>`;
}

const totalM = r => r.legs.reduce((s,l) => s+l.m, 0);
function plate(r, big){
  const sel = S.sel?.kind==='route' && S.sel.id===r.id, live = S.live?.kind==='route' && S.live.id===r.id;
  const L = live ? liveNow() : null;
  const w = big ? 528 : 104, h = big ? 168 : 68;
  return `<button class="p4-plate${big?' big':''}${sel?' is-sel':''}${live?' is-live':''}" data-route="${esc(r.id)}" style="--c:${hueOfCity(r.city)}">
    <span class="pic">${UI.line(r, w, h, L ? { at:L.a.fdist, pos:L.a.pos, sw:big?2.5:2, end:big?4:3, dot:big?6:4 } : { sw:big?2.5:1.75, end:big?4:2.5 })}</span>
    <span class="tx"><span class="n">${esc(r.label)}</span><span class="s">${esc(cap(legsLong(r)))}</span><span class="m num">${miles(totalM(r))} · ${dur(r.play)}${r.generated ? '' : ' · test route'}</span></span></button>`;
}
function placeRow(p){
  const o = openState(p), sel = S.sel?.kind==='place' && S.sel.id===p.id, held = S.live?.kind==='place' && S.live.id===p.id;
  return `<button class="p4-pl${sel?' is-sel':''}${held?' is-live':''}" data-place="${esc(p.id)}" style="--c:${hueOfCity(p.city)}">
    <span class="n">${esc(p.name)}</span><span class="k">${esc(kindLabel(p))}${p.hours ? ' · '+esc(hoursLabel(p.hours)) : ''}${p.note ? ' · '+esc(p.note) : ''}</span>
    <span class="v${o?.open?' open-now':''}">${held ? 'Holding here' : o ? esc(o.label) : ''}</span></button>`;
}
function citySection(c, one){
  const ci = CI[c], base = ci.base ? PLACE(ci.base) : null, rs = cityRoutes(c);
  const facts = [['Land at', `${esc(ci.airportName)} (${esc(ci.airport)})`], base ? ['Base', esc(base.name)] : null, ['Local', `${clockAt(ci.tz, nowMs(), true)} · ${utcOffset(ci.tz)}`]].filter(Boolean);
  return `<section class="p4-city">
    ${one ? '' : `<h2>${esc(c)}</h2>`}
    <dl class="p4-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join('')}</dl>
    ${rs.length ? `<div class="p4-plates">${rs.map(r => plate(r, one && rs.length===1)).join('')}</div>` : ''}
    <div class="p4-places">${cityPlaces(c).map(placeRow).join('')}</div>
  </section>`;
}
function countryView(k){
  const one = k.cities.length===1, tzs = new Set(k.cities.map(c => utcOffset(CI[c].tz)));
  return `<div class="scroll">
    <div class="p4-cover" style="--c:${hueOf(k.name)}">
      <div class="p4-top">${UI.back()}${UI.search('')}</div>
      <h1>${esc(k.name)}</h1>
      <p class="vibe">${esc(cap(vibeOf(k.name)))}</p>
      <p class="facts num">${esc(one ? k.cities[0] : plural(k.cities.length,'city'))} · ${plural(k.routes,'route')} · ${plural(k.places,'place')} · ${tzs.size===1 ? clockAt(CI[k.cities[0]].tz, nowMs(), true) : tzs.size+' time zones'}</p>
    </div>
    <div class="p4-body">${k.cities.map(c => citySection(c, one)).join('')}</div>
  </div>${dock()}`;
}

function dock(){
  const showSel = S.sel && !(S.live && S.live.kind===S.sel.kind && S.live.id===S.sel.id);
  if(!showSel && !S.live) return '';
  let h = '';
  if(showSel && S.sel.kind==='route'){
    const r = ROUTE(S.sel.id), end = routeEnd(r);
    h += `<div class="p4-card" style="--c:${hueOfCity(r.city)}">
      <div class="p4-big">${UI.line(r, 528, 120, { sw:2.5, end:4, pad:10, labels:[r.from ? (r.from.kind==='airport' ? r.from.id : r.from.name) : 'Start', end ? end.name : 'End'] })}</div>
      <div class="p4-ct"><b>${esc(r.label)}</b><span class="num">${miles(totalM(r))} · ${dur(r.play)} · at the door ${clockAt(CI[r.city].tz, nowMs()+r.play*1000)}</span></div>
      <div class="p4-ctl">${UI.engines()}${UI.mph()}${UI.play()}</div>${UI.note()}</div>`;
  } else if(showSel && S.sel.kind==='pin'){
    const p = S.pin;
    h += `<div class="p4-card"><div class="p4-ct"><b>${esc(p.name)}</b><span>Dropped pin · ${esc(p.sub)}</span></div>
      <div class="p4-ctl"><span class="p4-co num">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} · click the map to move it</span>${UI.set('Set location here')}</div></div>`;
  } else if(showSel){
    const p = PLACE(S.sel.id), o = openState(p);
    h += `<div class="p4-card" style="--c:${hueOfCity(p.city)}"><div class="p4-ct"><b>${esc(p.name)}</b><span>${esc(kindLabel(p))} in ${esc(p.city)}${p.hours ? ` · ${esc(hoursLabel(p.hours))}, ${o.open ? 'open now' : 'closed now'}` : ''}${p.note ? ' · '+esc(p.note) : ''}</span></div>
      <div class="p4-ctl"><span class="p4-co num">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>${UI.set()}</div></div>`;
  }
  if(S.live?.kind==='place') h += `<div class="p4-card"><div class="p4-ct"><b>Holding at ${esc(S.live.name)}</b><span class="num">${S.live.lat.toFixed(5)}, ${S.live.lon.toFixed(5)}</span></div><div class="p4-ctl">${UI.stop()}</div></div>`;
  else if(S.live){
    const L = liveNow(), r = L.r;
    h += `<div class="p4-card p4-live" style="--c:${hueOfCity(r.city)}">
      <div class="p4-big">${UI.line(r, 528, 104, { at:L.a.fdist, pos:L.a.pos, sw:2.5, end:4, dot:6, pad:10, labels:[r.from ? (r.from.kind==='airport' ? r.from.id : r.from.name) : 'Start', routeEnd(r)?.name || 'End'] })}</div>
      <div class="p4-ct"><b>${esc(r.label)}</b><span>${esc(L.how)} · <span data-live="doing">${L.doing}</span>, <span class="num" data-live="mph">${Math.round(L.mphNow)}</span> mph</span></div>
      <div class="p4-nums num"><div><b data-live="elapsed">${clock(L.a.t)}</b><small>of ${clock(r.play)}</small></div><div><b data-live="left">${clock(L.a.left)}</b><small>left</small></div><div><b data-live="arrive">${L.arrive}</b><small>at the door</small></div></div>
      <div class="p4-ctl">${UI.follow()}${UI.stop()}</div></div>`;
  }
  return `<div class="p4-dock">${h}</div>`;
}

design({ id:4, name:'Atlas',
  idea:'A guidebook page: an index in large type, a cover in the country’s colour, each city’s facts, each route drawn as its own line.',
  render: S => ({ panel: S.open ? countryView(country(S.open)) : world() }) });
})();
