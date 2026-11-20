/* 1 · Arrival plan. A city is an arrival in order: land at the airport, check in, go out. Routes are the
   links between stops, places are the stops, and the picked link says when you'd be at the door and
   whether the place is open then. Leftovers (test drives, saved places) sit under "Also in". */
(function(){
const airportsOf = k => [...new Set(k.cities.map(c => CI[c].airport))];
const orList = a => a.length<2 ? a.join('') : a.slice(0,-1).join(', ')+' or '+a[a.length-1];

function worldRow(k){
  const pinOnly = !k.routes;
  const sub = pinOnly ? `Pin only · ${cityPlaces(k.cities[0]).map(p => p.name).join(', ')}` : `Land at ${orList(airportsOf(k))}`;
  return `<button class="p1-row" data-country="${esc(k.name)}" style="--c:${hueOf(k.name)}"><span class="dot"></span>
    <span class="n">${esc(k.name)}</span><span class="s">${esc(sub)}</span>
    <span class="r num">${k.routes ? plural(k.routes,'route') : plural(k.places,'place')}</span></button>`;
}
function world(){
  const arrivals = LIB.routes.filter(r => r.generated && r.from.kind==='airport').length;
  return `<div class="scroll">
    <header class="p1-head"><div><h1>Destinations</h1>
      <p class="p1-sub num">${TOTAL.countries} countries · ${TOTAL.cities} cities · ${arrivals} airport arrivals</p></div>${UI.search()}</header>
    ${byContinent(COUNTRIES).map(([c, ks]) => `<section class="p1-cg"><h2>${esc(c)}</h2>${ks.map(worldRow).join('')}</section>`).join('')}
  </div>`;
}

/* ---- a country ---- */
const isSel = (kind, id) => S.sel && S.sel.kind===kind && S.sel.id===id;
const isLive = (kind, id) => S.live && S.live.kind===kind && S.live.id===id;

function linkRow(r, fromLabel, open){
  const live = isLive('route', r.id), sel = isSel('route', r.id);
  const exp = open && !sel && !live ? `<span class="p1-exp"><span class="p1-when">Land now, at the door <b class="num">${clockAt(CI[r.city].tz, nowMs()+r.play*1000)}</b> local</span>${legCols(r)}</span>` : '';
  return `<li class="p1-link${sel?' is-sel':''}${live?' is-live':''}"><button data-route="${esc(r.id)}" style="--c:${hueOfCity(r.city)}">
    ${fromLabel ? `<span class="p1-from">${esc(r.label)}</span>` : ''}
    <span class="p1-lk"><span class="p1-bar" ${live?'data-live-bar':''}>${UI.legs(r)}${live ? `<span class="p1-over">${UI.legs(r)}</span>` : ''}</span>
      <span class="p1-t num">${dur(r.play)}</span><span class="p1-d num">${miles(r.legs.reduce((s,l)=>s+l.m,0))}</span></span>
    ${exp || `<span class="p1-ls">${esc(cap(legsLong(r)))}</span>`}
  </button></li>`;
}
function spotNode(p){
  if(!p) return '';
  const o = openState(p), live = isLive('place', p.id), sel = isSel('place', p.id);
  const sub = [kindLabel(p), p.hours ? hoursLabel(p.hours) : null, p.note].filter(Boolean).join(' · ');
  return `<li class="p1-node p1-spot${sel?' is-sel':''}${live?' is-live':''}"><button data-place="${esc(p.id)}" style="--c:${hueOfCity(p.city)}">
    <span class="p1-m"></span><span class="n">${esc(p.name)}</span><span class="s">${esc(sub)}</span>
    <span class="v${o && o.open ? ' open-now' : ''}">${live ? 'Holding here' : o ? esc(o.label) : ''}</span></button></li>`;
}
function cityPlan(c, one, oneTz){
  const ch = chain(c), out = [];
  for(const a of ch.arrivals){
    out.push(`<li class="p1-node p1-air"><span class="p1-m"></span><span class="n">${esc(CI[c].airportName)}</span><span class="s">Arrival airport · ${esc(CI[c].airport)}</span></li>`);
    out.push(linkRow(a, false, one), spotNode(routeEnd(a)));
    const next = ch.onward.filter(o => o.from.id===a.to.id);
    if(next.length===1) out.push(linkRow(next[0], false, one), spotNode(routeEnd(next[0])));
    else if(next.length) out.push(`<li class="p1-branch"><span class="p1-bl">From ${esc(a.to.name)}, ${next.length} ways out</span><ol>${next.map(o => linkRow(o, true)+spotNode(routeEnd(o))).join('')}</ol></li>`);
  }
  const also = ch.other.map(r => `<button class="p1-also-r${isSel('route', r.id)?' is-sel':''}${isLive('route', r.id)?' is-live':''}" data-route="${esc(r.id)}" style="--c:${hueOfCity(r.city)}">
      <span class="n">${esc(r.label)}</span><span class="b">${UI.legs(r)}</span><span class="v num">${dur(r.play)}</span></button>`)
    .concat(ch.loose.map(p => { const o = openState(p);
      return `<button class="p1-also-r${isSel('place', p.id)?' is-sel':''}${isLive('place', p.id)?' is-live':''}" data-place="${esc(p.id)}" style="--c:${hueOfCity(p.city)}">
      <span class="n">${esc(p.name)}</span><span class="b muted">${esc([kindLabel(p), p.note].filter(Boolean).join(' · '))}</span><span class="v${o&&o.open?' open-now':''}">${o ? esc(o.label) : ''}</span></button>`; }));
  return `<section class="p1-city${one?' one':''}">
    ${one ? '' : `<div class="p1-cityh"><h2>${esc(c)}</h2><span class="num">${oneTz ? [plural(cityRoutes(c).length,'route'), plural(cityPlaces(c).length,'place')].join(' · ') : clockAt(CI[c].tz, nowMs(), true)+' · '+utcOffset(CI[c].tz)}</span></div>`}
    ${out.length ? `<ol class="p1-chain">${out.join('')}</ol>` : ''}
    ${also.length ? `<div class="p1-also"><h3>${out.length ? 'Also in '+esc(c) : esc(c)}</h3>${also.join('')}</div>` : ''}
  </section>`;
}
function countryView(k){
  const one = k.cities.length===1, c0 = k.cities[0];
  const oneTz = new Set(k.cities.map(c => utcOffset(CI[c].tz))).size===1;
  const sub = one ? `${c0} · ${clockAt(CI[c0].tz, nowMs(), true)} · ${utcOffset(CI[c0].tz)}`
    : [plural(k.cities.length,'city'), plural(k.routes,'route'), plural(k.places,'place')].join(' · ') + (oneTz ? ` · ${clockAt(CI[c0].tz, nowMs(), true)} · ${utcOffset(CI[c0].tz)}` : '');
  return `<div class="scroll">
    <div class="p1-top">${UI.back()}${UI.search()}</div>
    <header class="p1-chead" style="--c:${hueOf(k.name)}"><h1>${esc(k.name)}</h1><p class="num">${esc(sub)}</p></header>
    ${k.cities.map(c => cityPlan(c, one, oneTz)).join('')}
  </div>${dock()}`;
}

/* ---- the dock: the plan for what's picked, then what the phone is doing ---- */
function arrivalCheck(r){
  const p = routeEnd(r), at = nowMs()+r.play*1000;
  if(!p) return `<p class="p1-chk">A test route, not a catalog arrival. It ends where its last leg stops.</p>`;
  const note = p.note ? ` Its note says ${esc(p.note)}.` : '';
  if(!p.hours) return `<p class="p1-chk">${esc(p.name)} is a ${esc((p.kind||'place').toLowerCase())}, any hour works.${note}</p>`;
  const o = openState(p, at);
  return o.open ? `<p class="p1-chk"><b class="open-now">Open when you get there</b>, ${esc(o.label.toLowerCase())}.${note}</p>`
                : `<p class="p1-chk"><b class="warn">Closed when you get there.</b> ${esc(p.name)} ${esc(o.label.toLowerCase())}, hours ${esc(hoursLabel(p.hours))}.${note}</p>`;
}
function legCols(r){
  return `<div class="p1-legs">${r.legs.map(l => `<div class="p1-leg lg-${l.mode}" style="--c:${hueOfCity(r.city)};flex:${Math.max(l.s, r.play*.16)} 1 0">
    <span class="k">${legName(l, r)}</span><span class="v num">${dur(l.s)}</span>
    <span class="s num">${l.mode==='stop' ? (r.generated ? 'at the door' : 'in place') : l.mode==='drive' && cruise(r) ? `${miles(l.m)} · cruise ${cruise(r)} mph` : `${l.m<1000 ? l.m+' m' : miles(l.m)}`}</span></div>`).join('')}</div>`;
}
function selCard(){
  if(S.sel.kind==='route'){
    const r = ROUTE(S.sel.id), tz = CI[r.city].tz;
    return `<div class="p1-card" style="--c:${hueOfCity(r.city)}">
      <div class="p1-ct"><span class="dot"></span><b>${esc(r.label)}</b><span class="muted">${esc(r.city)}</span></div>
      <p class="p1-big">Leave now, at the door <span class="num">${clockAt(tz, nowMs()+r.play*1000)}</span></p>
      ${arrivalCheck(r)}
      ${UI.legs(r, 'p1-wide')}${legCols(r)}
      <div class="p1-ctl">${UI.engines()}${UI.mph()}${UI.play()}</div>${UI.note()}
    </div>`;
  }
  if(S.sel.kind==='pin'){
    const p = S.pin;
    return `<div class="p1-card"><div class="p1-ct">${icon('map-pin',16)}<b>${esc(p.name)}</b><span class="muted">Dropped pin</span></div>
      <p class="p1-chk">${esc(p.sub)} · <span class="num">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>. Click the map to move it.</p>
      <div class="p1-ctl end">${UI.set('Set location here')}</div></div>`;
  }
  const p = PLACE(S.sel.id), o = openState(p);
  return `<div class="p1-card" style="--c:${hueOfCity(p.city)}">
    <div class="p1-ct"><span class="dot"></span><b>${esc(p.name)}</b><span class="muted">${esc(kindLabel(p))} · ${esc(p.city)}</span></div>
    <p class="p1-chk">${p.hours ? `${o.open ? '<b class="open-now">Open now</b>' : '<b>Closed now</b>'}, ${esc(hoursLabel(p.hours))} local, it's ${clockAt(CI[p.city].tz)} there.` : `No opening hours, any time works. It's ${clockAt(CI[p.city].tz)} there.`}${p.note ? ` Note: ${esc(p.note)}.` : ''}</p>
    <div class="p1-ctl"><span class="p1-co num">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>${UI.set()}</div></div>`;
}
function liveCard(){
  if(S.live.kind==='place') return `<div class="p1-card p1-live"><div class="p1-ct">${icon('map-pin',16)}<b>Holding at ${esc(S.live.name)}</b></div>
    <p class="p1-chk">Since <span class="num">${new Date(S.live.started).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase()}</span> here. The phone stays there until you stop.</p>
    <div class="p1-ctl">${UI.stop()}</div></div>`;
  const L = liveNow(), r = L.r;
  return `<div class="p1-card p1-live" style="--c:${hueOfCity(r.city)}">
    <div class="p1-ct"><span class="dot"></span><b>${esc(r.label)}</b><span class="muted">${esc(L.how)}</span></div>
    <p class="p1-big"><span><span data-live="doing">${L.doing}</span>${L.a.leg.mode==='stop'||L.a.done ? '' : `, <span class="num" data-live="mph">${Math.round(L.mphNow)}</span> mph`}</span><span class="p1-at">at the door <span class="num" data-live="arrive">${L.arrive}</span></span></p>
    <div class="p1-prog" data-live-bar style="--pct:${(L.a.pct*100).toFixed(2)}%">${UI.legs(r, 'p1-wide')}<span class="p1-over">${UI.legs(r, 'p1-wide')}</span><i class="p1-cur"></i></div>
    <div class="p1-nums num"><span><b data-live="elapsed">${clock(L.a.t)}</b> of ${clock(r.play)}</span><span><b data-live="left">${clock(L.a.left)}</b> left</span><span><b data-live="dist">${milesN(L.a.dist)}</b> of ${miles(r.legs.reduce((s,l)=>s+l.m,0))}</span></div>
    <div class="p1-ctl">${UI.stop()}${UI.follow()}</div></div>`;
}
function dock(){
  const showSel = S.sel && !(S.live && S.live.kind===S.sel.kind && S.live.id===S.sel.id);
  if(!showSel && !S.live) return '';
  return `<div class="p1-dock">${showSel ? selCard() : ''}${S.live ? liveCard() : ''}</div>`;
}

design({ id:1, name:'Arrival plan',
  idea:'A city is an arrival in order: land, check in, go out. Routes are the links, places the stops; the picked link says when you’d be at the door.',
  render: S => ({ panel: S.open ? countryView(country(S.open)) : world() }) });
})();
