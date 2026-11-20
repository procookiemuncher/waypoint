/* 2 · Local clock. Time is the axis. The world list runs round the clock (what time is it there, what's
   open), and a city is a 24-hour strip in its own time: each route a bar starting now, laid out as its
   walk / drive / parked legs, each spot its opening hours, a line at now. A route that plays slides
   along that same strip. */
(function(){
const SPAN = 4, BEFORE = .5;   // the strip shows 30 min back and 3.5 h ahead, local: the window a 'go now' needs
const GROUPS = ['Night','Evening','Afternoon','Morning','Late night'];

function countryClock(k){
  const tzs = [...new Map(k.cities.map(c => [utcOffset(CI[c].tz), c])).values()];
  return { main:k.cities[0], tzs, t:parts(CI[k.cities[0]].tz).t };
}
function whatsOn(k){
  const spots = k.cities.flatMap(cityPlaces).filter(p => p.hours);
  if(!spots.length){
    if(!k.routes) return 'Pin only, by boat or seaplane';
    return k.cities.flatMap(cityPlaces).some(p => p.kind==='hotel') ? 'Hotels only, any hour works' : 'No opening hours to watch';
  }
  const tNext = p => { const t = parts(CI[p.city].tz).t; return ((p.hours[0]-t)+24)%24; };
  const open = spots.filter(p => openState(p).open), shut = spots.filter(p => !openState(p).open).sort((a,b) => tNext(a)-tNext(b));
  return [...open, ...shut].slice(0, 2).map(p => `${p.name} ${openState(p).label.toLowerCase()}`).join(' · ') + (spots.length>2 ? ` · ${spots.length-2} more` : '');
}
function worldRow(k){
  const c = countryClock(k), p = parts(CI[c.main].tz);
  const multi = c.tzs.length>1;
  const on = whatsOn(k), anyOpen = k.cities.flatMap(cityPlaces).some(x => openState(x)?.open);
  return `<button class="p2-row" data-country="${esc(k.name)}" style="--c:${hueOf(k.name)}">
    <span class="t num">${ampm(p.h, p.m).replace(' ', '<small> ')}</small></span>
    <span class="w">${esc(multi ? `${c.main}` : p.wd)}</span>
    <span class="n"><span class="dot"></span>${esc(k.name)}</span>
    <span class="s${anyOpen?' on':''}">${multi ? esc(c.tzs.slice(1).map(x => `${x} ${clockAt(CI[x].tz)}`).join(' · '))+' · ' : ''}${esc(on)}</span>
    <span class="r num">${k.routes || '—'}</span></button>`;
}
function world(){
  const by = new Map(GROUPS.map(g => [g, []]));
  for(const k of COUNTRIES) by.get(dayPart(countryClock(k).t)).push(k);
  for(const ks of by.values()) ks.sort((a,b) => countryClock(b).t-countryClock(a).t);
  return `<div class="scroll">
    <header class="p2-head"><div><h1>Destinations</h1><p class="sub">Round the clock, local time where you'd land</p></div>${UI.search()}</header>
    <div class="p2-colh"><span>Local time</span><span>Country, what’s open</span><span>Routes</span></div>
    ${[...by].filter(([, ks]) => ks.length).map(([g, ks]) => `<section class="p2-g"><h2>${g}<span class="num">${plural(ks.length,'country')}</span></h2>${ks.map(worldRow).join('')}</section>`).join('')}
  </div>`;
}

/* ---- a city's day strip ---- */
function strip(c){
  const tz = CI[c].tz, now = parts(tz).t, w0 = now-BEFORE, w1 = w0+SPAN;
  const x = h => ((h-w0)/SPAN*100).toFixed(2)+'%';
  const clip = (a, b) => [Math.max(a, w0), Math.min(b, w1)];
  const ticks = [];
  for(let h = Math.ceil(w0); h<w1-.3; h += 1) if(Math.abs(h-now)>.62) ticks.push(`<span class="tk" style="left:${x(h)}">${hourLabel(((h%24)+24)%24)}</span>`);
  const hue = hueOfCity(c), rows = [];
  const live = S.live && S.live.kind==='route' ? liveNow() : null;
  for(const r of cityRoutes(c)){
    const isLive = live && live.r.id===r.id, sel = S.sel?.kind==='route' && S.sel.id===r.id;
    const start = isLive ? now-live.a.t/3600 : now, end = start+r.play/3600;
    const [a, b] = clip(start, end);
    const legs = `<span class="legsbar${isLive?' live':''}" ${isLive?'data-live-bar':''} style="left:${x(a)};width:calc(${x(b)} - ${x(a)})${isLive?`;--pct:${(live.a.pct*100).toFixed(2)}%`:''}">${UI.legs(r)}${isLive ? `<span class="ov">${UI.legs(r)}</span>` : ''}</span>`;
    rows.push(`<button class="p2-sr rt${sel?' is-sel':''}${isLive?' is-live':''}" data-route="${esc(r.id)}" style="--c:${hue}">
      <span class="l"><span class="n">${esc(r.to ? '→ '+r.to.name : r.label)}</span><span class="s num">${r.from ? 'from '+esc(r.from.kind==='airport' ? r.from.id : r.from.name)+' · ' : ''}${dur(r.play)} · ${miles(r.legs.reduce((s,l)=>s+l.m,0))}</span></span>
      <span class="trk">${legs}<span class="end num" style="left:${x(b)}">${isLive ? 'at the door ' : ''}${clockAt(tz, nowMs()+(end-now)*3600000)}</span></span></button>`);
  }
  for(const p of cityPlaces(c)){
    const sel = S.sel?.kind==='place' && S.sel.id===p.id, held = S.live?.kind==='place' && S.live.id===p.id;
    let bars = '', label;
    if(p.hours){
      const [o, cl] = p.hours, close = cl<=o ? cl+24 : cl;
      for(const d of [-24, 0, 24]){
        const [a, b] = clip(o+d, close+d);
        if(b>a) bars += `<i class="open" style="left:${x(a)};width:calc(${x(b)} - ${x(a)})"></i>`;
      }
      const st = openState(p); label = `<span class="${st.open?'open-now':''}">${esc(st.label)}</span>`;
    } else { bars = `<i class="any"></i>`; label = esc(p.kind==='hotel' ? 'Any hour' : p.access==='boat' ? 'Pin only' : 'No hours'); }
    rows.push(`<button class="p2-sr pl${sel?' is-sel':''}${held?' is-live':''}" data-place="${esc(p.id)}" style="--c:${hue}">
      <span class="l"><span class="n">${esc(p.name)}</span><span class="s">${esc([kindLabel(p), p.note].filter(Boolean).join(' · '))}</span></span>
      <span class="trk">${bars}<span class="lab">${held ? 'Holding here' : label}</span></span></button>`);
  }
  return `<div class="p2-strip"><div class="p2-axis"><span></span><span class="trk">${ticks.join('')}<span class="nowl" style="left:${x(now)}"><b class="num">${clockAt(tz)}</b></span></span></div>
    <div class="p2-rows" style="--now:${x(now)}">${rows.join('')}</div></div>`;
}
function countryView(k){
  const one = k.cities.length===1, tzs = [...new Set(k.cities.map(c => utcOffset(CI[c].tz)))];
  const c0 = k.cities[0], p = parts(CI[c0].tz);
  return `<div class="scroll">
    <div class="p2-top">${UI.back()}${UI.search()}</div>
    <header class="p2-chead"><div><h1>${esc(k.name)}</h1><p class="sub">${esc(one ? c0 : [plural(k.cities.length,'city'), plural(k.routes,'route'), plural(k.places,'place')].join(' · '))}</p></div>
      ${tzs.length===1 ? `<div class="p2-now"><span class="num">${ampm(p.h, p.m)}</span><small>${p.wd} ${p.mon} ${p.day} · ${tzs[0]}</small></div>` : ''}</header>
    ${k.cities.map(c => `<section class="p2-city">${one ? '' : `<div class="p2-cityh"><h2>${esc(c)}</h2><span class="num">${tzs.length>1 ? clockAt(CI[c].tz, nowMs(), true)+' · '+utcOffset(CI[c].tz) : esc(CI[c].airportName)}</span></div>`}${strip(c)}</section>`).join('')}
  </div>${dock()}`;
}

/* ---- the dock ---- */
function dock(){
  const showSel = S.sel && !(S.live && S.live.kind===S.sel.kind && S.live.id===S.sel.id);
  if(!showSel && !S.live) return '';
  let h = '';
  if(showSel && S.sel.kind==='route'){
    const r = ROUTE(S.sel.id), tz = CI[r.city].tz, end = routeEnd(r);
    const st = end?.hours ? openState(end, nowMs()+r.play*1000) : null;
    h += `<div class="p2-card" style="--c:${hueOfCity(r.city)}">
      <div class="p2-ct"><b>${esc(r.label)}</b><span>${esc(cap(legsLong(r)))}</span></div>
      <div class="p2-times num"><div><small>Leave</small><b>now, ${clockAt(tz)}</b></div><div><small>At the door</small><b>${clockAt(tz, nowMs()+r.play*1000)}</b></div>
        <div><small>${end ? esc(end.name) : 'Ends'}</small><b class="${st ? (st.open ? 'open-now' : 'warn') : ''}">${st ? (st.open ? 'open then' : 'closed then') : end ? 'any hour' : 'test route'}</b></div></div>
      <div class="p2-ctl">${UI.engines()}${UI.mph()}${UI.play()}</div>${UI.note()}</div>`;
  } else if(showSel && S.sel.kind==='pin'){
    const p = S.pin;
    h += `<div class="p2-card"><div class="p2-ct"><b>${esc(p.name)}</b><span>Dropped pin · ${esc(p.sub)}</span></div>
      <div class="p2-ctl"><span class="p2-co num">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} · click the map to move it</span>${UI.set('Set location here')}</div></div>`;
  } else if(showSel){
    const p = PLACE(S.sel.id), st = openState(p), tz = CI[p.city].tz;
    const until = p.hours && !st.open ? ` · in ${dur((((p.hours[0]-parts(tz).t)+24)%24)*3600)}` : '';
    h += `<div class="p2-card" style="--c:${hueOfCity(p.city)}"><div class="p2-ct"><b>${esc(p.name)}</b><span>${esc([kindLabel(p), p.city, p.note].filter(Boolean).join(' · '))}</span></div>
      <div class="p2-times num"><div><small>There now</small><b>${clockAt(tz, nowMs(), true)}</b></div><div><small>Hours</small><b>${p.hours ? esc(hoursLabel(p.hours)) : 'any hour'}</b></div>
        <div><small>${p.hours ? (st.open ? 'Open now' : 'Closed now') : 'No hours'}</small><b class="${st?.open ? 'open-now' : ''}">${p.hours ? esc(st.label)+until : '—'}</b></div></div>
      <div class="p2-ctl"><span class="p2-co num">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>${UI.set()}</div></div>`;
  }
  if(S.live?.kind==='place') h += `<div class="p2-card p2-live"><div class="p2-ct"><b>Holding at ${esc(S.live.name)}</b><span class="num">${S.live.lat.toFixed(5)}, ${S.live.lon.toFixed(5)}</span></div><div class="p2-ctl">${UI.stop()}</div></div>`;
  else if(S.live){
    const L = liveNow(), r = L.r;
    h += `<div class="p2-card p2-live" style="--c:${hueOfCity(r.city)}">
      <div class="p2-ct"><b>${esc(r.label)}</b><span>${esc(L.how)}</span></div>
      <div class="p2-times num"><div><small>Started</small><b>${clockAt(L.tz, S.live.started)}</b></div>
        <div><small><span data-live="doing">${L.doing}</span>, <span data-live="mph">${Math.round(L.mphNow)}</span> mph</small><b><span data-live="elapsed">${clock(L.a.t)}</span><span class="of"> of ${clock(r.play)}</span></b></div>
        <div><small>At the door</small><b data-live="arrive">${L.arrive}</b></div></div>
      <div class="p2-ctl"><span class="p2-co num"><b data-live="left">${clock(L.a.left)}</b> left · <b data-live="dist">${milesN(L.a.dist)}</b> of ${miles(r.legs.reduce((s,l)=>s+l.m,0))}</span>${UI.follow()}${UI.stop()}</div></div>`;
  }
  return `<div class="p2-dock">${h}</div>`;
}

design({ id:2, name:'Local clock',
  idea:'Time is the axis: the list runs round the clock, a city is a 24-hour strip in its own time, routes are bars starting now, spots show their hours.',
  render: S => ({ panel: S.open ? countryView(country(S.open)) : world() }) });
})();
