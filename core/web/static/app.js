'use strict';
/* Waypoint — the vida-360 front end. Talks to core/backend/server.py; everything that touches
   the phone goes through /api. The map animation follows the server's timeline in real time,
   so when the pin here arrives, the phone arrives. */

/* ============ WINDOW CHROME ============ */
function winMinimize(){ if(window.pywebview?.api) window.pywebview.api.minimize(); }
// outside links open in the real browser; in the app window they'd replace the page with no way back
document.addEventListener('click', e=>{
  const a=e.target.closest('a[href]');
  if(!a || a.origin===location.origin || !/^https?:/.test(a.protocol)) return;
  e.preventDefault();
  if(window.pywebview?.api?.open_url) window.pywebview.api.open_url(a.href);
  else window.open(a.href, '_blank', 'noopener');
});
function winClose(){ if(window.pywebview?.api) window.pywebview.api.close(); else window.close(); }
// the titlebar drags the window natively (AppKit). pywebview's own drag region moved it with a
// bridge call per mousemove, which lagged way behind the cursor
document.getElementById('titlebar').addEventListener('mousedown', e=>{
  if(e.button!==0 || e.target.closest('.no-drag') || !window.pywebview?.api?.drag) return;
  window.pywebview.api.drag();
});

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ============ API ============ */
async function api(path, body){
  const opts = body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) };
  const r = await fetch(path, opts);
  const data = await r.json().catch(()=>({}));
  // 402: the server wants an access key (the saved one was turned off while we were open)
  if(r.status===402){ keyLost(); const e=new Error('access key needed'); e.locked=true; throw e; }
  if(!r.ok) throw new Error(data.detail || ('HTTP '+r.status));
  return data;
}

let PLACES = [], ROUTES = [], ENGINES = [], STATUS = null;
const PALETTE = ['#ff5ecd','#5ea2ff','#ef3f4f','#7ee787','#e8c25a','#ffb37a','#b49aff','#5ee6d0'];
const MPS_TO_MPH = 2.23694;

/* ============ GEO HELPERS ============ */
const R = 6371000;
function dist(a, b){
  const dLat=(b[0]-a[0])*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180;
  const la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
  const h=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function heading(a, b){
  const la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180;
  const y=Math.sin(dLon)*Math.cos(la2);
  const x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLon);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
const COMPASS=['N','NE','E','SE','S','SW','W','NW'];
const compass = h => COMPASS[Math.round(h/45)%8];
const fmtT = s => {
  s=Math.max(0,Math.floor(s));
  const h=Math.floor(s/3600), m=Math.floor(s%3600/60), ss=s%60;
  return (h? h+':'+String(m).padStart(2,'0') : String(m).padStart(2,'0'))+':'+String(ss).padStart(2,'0');
};

/* ============ CONSOLE ============ */
const consoleEl = $('console');
function logLine(text, cls='sys', html=false){
  const d=document.createElement('div');
  d.className='ln '+cls;
  if(html) d.innerHTML=text; else d.textContent=text;
  consoleEl.appendChild(d);
  while(consoleEl.children.length>200) consoleEl.removeChild(consoleEl.firstChild);
  consoleEl.scrollTop=consoleEl.scrollHeight;
  return d;
}
let typeChain = Promise.resolve();
function typeLine(text, cls='sys'){
  typeChain = typeChain.then(()=>new Promise(res=>{
    const d=logLine('', cls);
    if(RM){ d.textContent=text; res(); return; }
    let i=0;
    const t=setInterval(()=>{
      d.textContent=text.slice(0,++i);
      consoleEl.scrollTop=consoleEl.scrollHeight;
      if(i>=text.length){ clearInterval(t); res(); }
    }, 12);
  }));
  return typeChain;
}
function echoCommand(cmd){
  if(promptRunning) return typeChain;
  typeChain = typeChain.then(()=>new Promise(res=>{
    const input=$('prompt-in');
    const done=()=>{ logLine('','cmd',true).innerHTML='<span class="ps">waypoint ›</span> '+esc(cmd); res(); };
    // don't type over whatever the user is writing in the prompt
    if(RM || input.value || document.activeElement===input){ done(); return; }
    let i=0;
    const t=setInterval(()=>{
      input.value=cmd.slice(0,++i); sizePrompt();
      if(i>=cmd.length){ clearInterval(t); setTimeout(()=>{ input.value=''; sizePrompt(); done(); }, 140); }
    }, 22);
  }));
  return typeChain;
}
// server log feed
let logSeq = 0;
async function pollLogs(){
  try{
    const lines = await api('/api/logs?since='+logSeq);
    for(const l of lines){ logSeq=Math.max(logSeq,l.n); typeChain=typeChain.then(()=>logLine(l.text, l.level)); }
  }catch(e){ /* server gone — status poll reports it */ }
}

/* ============ ACCENT THEMING ============ */
const DEFAULT_ACCENT='#b49aff';
function rgbOf(hex){ return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]; }
function dimOf(hex){ const [r,g,b]=rgbOf(hex); return 'rgb('+(r*.55|0)+','+(g*.55|0)+','+(b*.55|0)+')'; }
function setAccent(hex){
  hex = hex || DEFAULT_ACCENT;
  const [r,g,b]=rgbOf(hex), rs=document.documentElement.style;
  rs.setProperty('--accent', hex);
  rs.setProperty('--accent-rgb', r+','+g+','+b);
  rs.setProperty('--accent-dim', dimOf(hex));
  if(lineGlow) lineGlow.setStyle({ color:hex });
  if(lineDone) lineDone.setStyle({ color:hex });
  if(lineHead) lineHead.setStyle({ color:hex });
  if(lineDim) lineDim.setStyle({ color:dimOf(hex) });
}

/* ============ MAP ============ */
const TILE_URL='https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png';
let map, tilesReady=false;
let marker=null, lineDim=null, lineGlow=null, lineDone=null, lineHead=null;   // live layers
let preview=null, pinCandidate=null;                           // selection layers
function initMap(){
  map = L.map('map', { zoomControl:false, attributionControl:true, zoomSnap:.5 })
    .setView([25.7617,-80.1918], 13);
  L.control.zoom({ position:'bottomright' }).addTo(map);
  // the blurred route glow gets its own layer under the lines, so redrawing the line as the
  // marker moves doesn't re-blur it every frame
  map.createPane('glow').style.zIndex=399;
  // Stadia's dark style is keyless from localhost (CARTO wants an API key now)
  const tiles = L.tileLayer(TILE_URL, {
    attribution:'© Stadia Maps © OpenMapTiles © OpenStreetMap', maxZoom:20,
  });
  tiles.once('load', ()=>{ tilesReady=true; });
  // only after the page's load event: pywebview keeps the window black until load fires, and
  // load waits on every image, so internet tiles on a slow cold start held the whole app back
  if(document.readyState==='complete') tiles.addTo(map);
  else window.addEventListener('load', ()=>tiles.addTo(map), { once:true });
  // the border light + frosted HUDs repaint every frame; pause them while the map moves
  map.on('movestart', ()=> document.body.classList.add('panning'));
  map.on('moveend', ()=> document.body.classList.remove('panning'));
  map.on('zoomend', ()=>{ $('v-zoom').textContent = map.getZoom(); if(!openCity) drawBrowseMap(); });
  map.on('mousemove', e=>{ if(!live) setCoord(e.latlng.lat, e.latlng.lng); });
  map.on('click', e=> dropPin(e.latlng.lat, e.latlng.lng));
}
function setText(id, s){ const e=$(id); if(e.textContent!==s) e.textContent=s; }
function setCoord(lat, lon){
  const s = lat.toFixed(4)+', '+lon.toFixed(4);
  setText('v-coord', s);
  setText('sb-coord', s);
}
function makeMarker(latlng){
  return L.marker(latlng, { icon: L.divIcon({ className:'wp-marker', html:'<span class="ring"></span><span class="core"></span>', iconSize:[12,12] }), interactive:false }).addTo(map);
}
function clearPreview(){
  [preview,pinCandidate].forEach(l=>{ if(l) map.removeLayer(l); });
  preview=pinCandidate=null;
}
function clearLiveLayers(){
  [marker,lineDim,lineGlow,lineDone,lineHead].forEach(l=>{ if(l) map.removeLayer(l); });
  marker=lineDim=lineGlow=lineDone=lineHead=null;
}

/* ============ LIVE STATE (what the phone is doing) ============ */
// live = { key, kind, label, started, timeline, cum, total, accent, arrived }
let live=null, follow=true, clockOffset=0, rafId=null, tickTimer=null, lastLogAt=-99;

function serverNow(){ return Date.now()/1000 + clockOffset; }

function syncLive(active){
  const key = active ? active.kind+':'+active.started : null;
  if(key === (live && live.key)){
    if(live && active.state==='failed' && !live.failed){
      live.failed=true; setMode('FAILED');
      logLine('the phone command exited — check the console above','warn');
    }
    return;
  }
  // something new (or nothing) is on the phone
  cancelAnimationFrame(rafId); clearTimeout(tickTimer);
  clearLiveLayers();
  live=null;
  $('nowplaying').classList.remove('on');
  $('v-leg').textContent='—'; $('v-hdg').textContent='—'; $('v-speed').textContent='0.0 mph';
  $('sb-elapsed').textContent='--:--'; $('gauge-fill').style.transform='scaleX(0)';
  if(!active){ setMode('IDLE'); markLive(); return; }

  live = { key, kind:active.kind, label:active.label, started:active.started, engine:active.engine, mph:active.mph };
  clearPreview();
  $('nowplaying').classList.add('on');
  if(active.kind==='place'){
    const pl = PLACES.find(p=>p.name===active.label);
    live.accent = pl?.accent || DEFAULT_ACCENT;
    setAccent(live.accent);
    marker = makeMarker([active.lat, active.lon]);
    setCoord(active.lat, active.lon);
    map.flyTo([active.lat, active.lon], Math.max(map.getZoom(), pl?.zoom || 15), { duration:1.2 });
    $('np-name').innerHTML = esc(active.label)+'<small>holding</small>';
    $('np-fill').style.width='100%';
    setMode('HOLDING');
  } else {
    const rt = ROUTES.find(r=>r.id===active.route);
    live.accent = rt?.accent || DEFAULT_ACCENT;
    setAccent(live.accent);
    const tl = active.timeline || [];
    live.timeline = tl;
    live.total = tl.length ? tl[tl.length-1][0] : 0;
    const latlngs = tl.map(p=>[p[1],p[2]]);
    lineGlow=L.polyline(latlngs,{ color:live.accent, weight:9, opacity:.28, className:'glowcase', pane:'glow' }).addTo(map);
    lineDim=L.polyline(latlngs,{ color:dimOf(live.accent), weight:2.5, opacity:.55 }).addTo(map);
    lineDone=L.polyline([latlngs[0]],{ color:live.accent, weight:3, opacity:.95 }).addTo(map);
    lineHead=L.polyline([latlngs[0]],{ color:live.accent, weight:3, opacity:.95 }).addTo(map);
    live.doneTo=0;
    marker=makeMarker(latlngs[0]);
    map.flyToBounds(lineDim.getBounds().pad(.25), { duration:1.1 });
    const how = active.engine==='drive' ? (active.mph ? `drive · ${Math.round(active.mph)} mph` : 'drive · varying') : 'spoof';
    $('np-name').innerHTML = esc(rt?.name || active.route)+'<small>'+esc(how)+'</small>';
    setMode('EN ROUTE');
    lastLogAt=-99;
  }
  markLive();
  rafId=requestAnimationFrame(tick);
}

function sampleAt(tl, t){
  // binary search the [t, lat, lon] timeline
  let lo=0, hi=tl.length-1;
  if(t<=tl[0][0]) return { lat:tl[0][1], lon:tl[0][2], i:0, spd:0, hdg:null };
  if(t>=tl[hi][0]) return { lat:tl[hi][1], lon:tl[hi][2], i:hi, spd:0, hdg:null };
  while(hi-lo>1){ const m=(lo+hi)>>1; if(tl[m][0]<=t) lo=m; else hi=m; }
  const a=tl[lo], b=tl[hi], f=(t-a[0])/((b[0]-a[0])||1);
  const pa=[a[1],a[2]], pb=[b[1],b[2]], d=dist(pa,pb);
  return { lat:a[1]+(b[1]-a[1])*f, lon:a[2]+(b[2]-a[2])*f, i:lo,
           spd: d/((b[0]-a[0])||1), hdg: d>0.5 ? heading(pa,pb) : null };
}

// the marker creeps a few px a second, so 30fps is as smooth as the screen's 60/120; the numbers
// only need a few updates a second. between frames it's a timer, so nothing wakes the page
const LIVE_FPS=30, READOUT_MS=250;
function tick(now){
  rafId=null;
  if(!live) return;
  const el = serverNow() - live.started, readout = !(now-live.readAt < READOUT_MS);
  if(readout){
    live.readAt=now;
    setText('np-time', 't+'+fmtT(el));
    setText('sb-elapsed', fmtT(el));
  }
  if(live.kind==='route' && live.timeline.length){
    const tl=live.timeline, s=sampleAt(tl, el);
    // drive mode holds one speed; spoof follows the route's own speeds
    const mph = el>=live.total ? 0 : (live.engine==='drive' ? (live.mph||s.spd*MPS_TO_MPH) : s.spd*MPS_TO_MPH);
    marker.setLatLng([s.lat,s.lon]);
    // the long finished part only changes when we pass a timeline point; the bit from there to
    // the marker is its own two-point line
    if(s.i!==live.doneTo){ live.doneTo=s.i; lineDone.setLatLngs(tl.slice(0, s.i+1).map(q=>[q[1],q[2]])); }
    lineHead.setLatLngs([[tl[s.i][1],tl[s.i][2]], [s.lat,s.lon]]);
    if(follow && !map.getBounds().pad(-.2).contains([s.lat,s.lon])) map.panTo([s.lat,s.lon]);
    if(readout){
      setCoord(s.lat,s.lon);
      setText('v-speed', mph.toFixed(1)+' mph');
      if(s.hdg!==null) setText('v-hdg', Math.round(s.hdg)+'° '+compass(s.hdg));
      setText('v-leg', el>=live.total ? 'arrived' : fmtT(live.total-el));
      $('np-fill').style.width=Math.min(100, el/live.total*100).toFixed(1)+'%';
      $('gauge-fill').style.transform='scaleX('+Math.min(1, mph/90)+')';
    }
    if(el-lastLogAt>=30 && el<live.total){
      lastLogAt=el;
      logLine(`[t+${fmtT(el)}] ${s.lat.toFixed(4)},${s.lon.toFixed(4)} · ${mph.toFixed(1)}mph`,'dim');
    }
    if(el>=live.total && !live.arrived) arrive();
  }
  // holding a spot (or arrived) nothing moves, only the clock ticks
  const still = live.kind==='place' || live.arrived;
  tickTimer=setTimeout(()=>{ rafId=requestAnimationFrame(tick); }, still ? READOUT_MS : 1000/LIVE_FPS-4);
}
function arrive(){
  live.arrived=true;
  setMode('ARRIVED');
  const rt=ROUTES.find(r=>r.id===live.label);
  const name=(rt?.name||live.label);
  logLine(`▸ ARRIVED — ${name} · the phone holds the last point until you stop`,'ok');
  toast('ARRIVED — '+name.toUpperCase());
}
function toast(msg){
  const t=$('toast');
  $('toast-msg').textContent=msg;
  t.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'), 4200);
}
function toggleFollow(){
  follow=!follow;
  $('btn-follow').classList.toggle('on', follow);
}

/* ============ STATUS POLL ============ */
let statusFails=0;
let booted=false, hadPhone=false;   // after boot, losing a phone we had brings the connect screen back
async function pollStatus(){
  try{
    const st = await api('/api/status');
    statusFails=0;
    STATUS=st;
    clockOffset = st.now - Date.now()/1000;
    const engIds=e=>e.map(x=>x.id).join();
    const enginesChanged = engIds(st.engines)!==engIds(ENGINES);
    ENGINES = st.engines;
    if(enginesChanged && selected?.type==='route'){ renderEngines(); updateRouteNote(); }
    const dev = st.devices[0];
    if(dev) hadPhone=true;
    else if(booted && hadPhone && !linkDone){
      hadPhone=false;
      typeLine('phone disconnected — plug it back in + unlock it.','warn');
      linkPhone();
    }
    $('sb-phone').textContent = dev ? `${dev.name} · iOS ${dev.ios}` : 'not found';
    $('drybadge').hidden = !st.dry_run;
    if(st.busy) setMode(st.busy.toUpperCase()+'…');
    syncLive(st.active);
    refreshHeroButton();
  }catch(e){
    if(e.locked) return;
    if(++statusFails===3) logLine('lost the local server — restart the app','warn');
  }
  renderDevice();
}

/* ============ DEVICE PILL + STATUS DROPDOWN ============ */
// every thing the app leans on, each ok / warn / err / off. The pill sums them up, the dropdown lists them.
let devOpen=false, lastDevice=null;
const ST_RANK={ ok:0, off:1, warn:2, err:3 };
const worstSt=(...sts)=> sts.reduce((a,b)=> ST_RANK[b]>ST_RANK[a] ? b : a, 'ok');
function deviceChecks(){
  const dev=STATUS?.devices?.[0], ph=STATUS?.phone?.state || (dev ? 'checking' : 'none');
  const act=STATUS?.active, online=navigator.onLine;
  const lock = !dev ? ['off','—']
    : ph==='ready' ? ['ok','Unlocked']
    : ph==='locked' ? ['warn','Locked','Unlock your iPhone to continue.']
    : ph==='error' ? ['err','Not ready', STATUS.phone.message || 'Unplug it and plug it back in.']
    : ['off','Checking…'];
  let loc;
  if(!act) loc=['off','Real GPS'];
  else if(act.state==='failed') loc=['err','Command failed','Check the console, then stop and try again.'];
  else if(act.kind==='place') loc=['ok','Holding · '+act.label];
  else loc=['ok',(live?.arrived ? 'Arrived · ' : 'En route · ')+(ROUTES.find(r=>r.id===act.route)?.name || act.route)];
  const C=(id, group, label, ic, [st, text, fix])=>({ id, group, label, icon:ic, st, text, fix });
  return [
    C('usb','iPhone','USB','cable', dev ? ['ok', dev.connection==='Network' ? 'Connected · Wi-Fi' : 'Connected'] : ['off','Unplugged']),
    C('lock','iPhone','Screen lock','lock-keyhole-open', lock),
    C('server','Connection','Local server','server', statusFails>=3 ? ['err','Not responding','Restart the app.'] : ['ok','Running']),
    C('speed','Connection','Speed engine','gauge', ENGINES.some(e=>e.id==='drive') ? ['ok','Real speed'] : ['off','Mac + Xcode only']),
    C('loc','Waypoint','Location','navigation', loc),
    C('map','Waypoint','Map','map', tilesReady ? ['ok','Tiles loaded'] : online ? ['off','Loading…'] : ['err','Tiles failed','Map tiles need internet. Spoofing still works.']),
    C('net','Waypoint','Internet','globe', online ? ['ok','Online'] : ['err','Offline','Check your Wi-Fi.']),
  ];
}
function deviceSummary(by, checks){
  const errs=checks.filter(c=>c.st==='err').length, warns=checks.filter(c=>c.st==='warn').length;
  if(errs) return ['err', errs===1 ? '1 problem' : errs+' problems'];
  if(by.usb.st==='off') return ['off','Not connected'];
  if(warns) return ['warn','Needs attention'];
  return ['ok', by.loc.st==='ok' ? 'Live' : 'Ready'];
}
function glassPhone(h, st, pulse){
  return `<svg class="gp${pulse ? ' live' : ''}" data-st="${st}" width="${h*.6}" height="${h}" viewBox="0 0 30 50" aria-hidden="true">
    <rect class="body" x=".75" y=".75" width="28.5" height="48.5" rx="7.5" stroke-width="1"></rect>
    <rect class="inner" x="2.8" y="2.8" width="24.4" height="44.4" rx="5.4" stroke-width=".6"></rect>
    <path class="sheen" d="M3 3 H17 L3 30 Z"></path>
    <rect class="island" x="11" y="5.4" width="8" height="2.6" rx="1.3"></rect>
    <circle class="halo" cx="15" cy="27" r="4"></circle>
    <circle class="core" cx="15" cy="27" r="3.4"></circle>
  </svg>`;
}
function renderDevice(){
  const checks=deviceChecks(), by=Object.fromEntries(checks.map(c=>[c.id,c]));
  const [sumSt, sumText]=deviceSummary(by, checks);
  const dev=STATUS?.devices?.[0];
  if(dev) lastDevice=dev;
  const phoneSt = dev ? worstSt(by.usb.st, by.lock.st, by.server.st) : 'off';
  const pulse = by.loc.st==='ok';
  const name = esc(lastDevice?.name || 'iPhone');
  const mini=(ic, st, title)=>`<span class="ico" data-st="${st}" title="${esc(title)}">${icon(ic,14)}<span class="dot"></span></span>`;

  const pill=$('devpill');
  const pillHtml = glassPhone(22, phoneSt, pulse)
    + `<span class="name">${name}</span>`
    + `<span class="stat" data-st="${sumSt}"><i></i>${sumText}</span>`
    + `<span class="mini">${mini('map', worstSt(by.map.st, by.net.st), 'Map: '+by.map.text)}${mini('radio', by.loc.st, 'Location: '+by.loc.text)}`
    + `${mini('link', by.lock.st, 'Phone: '+(dev ? by.lock.text : 'not connected'))}${mini('gauge', by.speed.st, 'Speed engine: '+by.speed.text)}</span>`
    + `<span class="chev">${icon('chevron-down',14)}</span>`;
  if(pill.innerHTML!==pillHtml) pill.innerHTML=pillHtml;
  pill.setAttribute('aria-expanded', devOpen);

  const dd=$('devdd');
  dd.classList.toggle('open', devOpen);
  if(!devOpen) return;
  const alerts = checks.filter(c=>c.fix).map(c=>`<div class="alert" data-st="${c.st}">
      ${icon(c.st==='err' ? 'circle-alert' : 'triangle-alert', 16)}
      <div><div class="at">${esc(c.label)} · ${esc(c.text)}</div><div class="ah">${esc(c.fix)}</div></div>
    </div>`).join('');
  const tile = c=>`<div class="tile" data-st="${c.st}" title="${esc(c.label+': '+c.text)}">
      <div class="ti">${icon(c.icon,16)}${c.st!=='ok' ? '<span class="dot"></span>' : ''}</div>
      <div><div class="tl">${esc(c.label)}</div><div class="ts">${esc(c.text)}</div></div>
    </div>`;
  const groups=[...new Set(checks.map(c=>c.group))];
  const ddHtml = `<div class="head">
      ${glassPhone(56, phoneSt, pulse)}
      <div class="who">
        <div class="n">${name}</div>
        <div class="m">${dev ? `iOS ${esc(dev.ios)} · ${esc(dev.connection || 'USB')}` : lastDevice ? 'Not connected' : 'No phone yet — plug it in'}</div>
        <span class="badge" data-st="${sumSt}"><i></i>${sumText}</span>
      </div>
    </div>
    ${alerts ? `<div class="alerts">${alerts}</div>` : ''}
    ${groups.map(g=>`<div class="sec"><h4>${g}</h4><div class="grid">${checks.filter(c=>c.group===g).map(tile).join('')}</div></div>`).join('')}
    <div class="foot">
      <span class="note">${STATUS?.dry_run ? 'Dry run' : ''}</span>
      <button class="btn" onclick="pollStatus()">${icon('refresh-cw',13)}Check again</button>
      ${STATUS?.active ? `<button class="btn primary" onclick="stopAll(); toggleDevice()">${icon('locate-fixed',13)}Back to real GPS</button>` : ''}
    </div>`;
  if(dd.innerHTML!==ddHtml) dd.innerHTML=ddHtml;
}
function toggleDevice(e, open=!devOpen){
  e?.stopPropagation();
  devOpen=open;
  renderDevice();
}
// capture phase: a click outside just closes the dropdown, it shouldn't also drop a pin on the map
document.addEventListener('click', e=>{
  if(!devOpen || e.target.closest('#devdd')) return;
  e.stopPropagation();
  toggleDevice(null, false);
}, true);
window.addEventListener('online', renderDevice);
window.addEventListener('offline', renderDevice);

/* ============ COMMANDS ============ */
function setMode(m){ $('sb-mode-v').textContent=m; }
async function send(cmd, path, body){
  echoCommand(cmd);
  try{ await api(path, body); }
  catch(e){ typeLine('✗ '+e.message,'warn'); }
  setTimeout(pollStatus, 250);
}
function setPlace(p){
  send('set '+p.id, '/api/place', { key:p.id });
}
function setPoint(lat, lon){
  send(`set ${lat.toFixed(5)} ${lon.toFixed(5)}`, '/api/place', { lat, lon, label:`Pin ${lat.toFixed(4)}, ${lon.toFixed(4)}` });
}
function playRoute(rt){
  const engine = selEngine();
  const mphRaw = parseFloat($('mph').value);
  const mph = engine==='drive' && mphRaw>0 ? mphRaw : null;
  send(`play ${rt.id} --${engine}`+(mph?` --mph ${mph}`:''), '/api/play', { route:rt.id, engine, mph });
}
function stopAll(){
  send('stop', '/api/stop', {});
}
function resetView(){
  echoCommand('reset view');
  clearPreview();
  if(live && marker) map.flyTo(marker.getLatLng(), 14, { duration:1.2 });
  else frameBrowse();
}

/* ============ PROMPT (typed commands) ============ */
const promptIn=$('prompt-in');
const cmdHistory=[]; let histAt=0, promptRunning=false;
// native caret is hidden, the blinking .cursor block after the input is the caret. 2px spare so the text doesn't scroll
function sizePrompt(){ promptIn.style.width=`calc(${promptIn.value.length}ch + 2px)`; }
function clearConsole(){ consoleEl.innerHTML=''; }
const HELP = [
  'clear                     clear the console (ctrl+L)',
  'reset                     stop, put the phone back on real GPS, reset the map + console',
  'stop                      stop whatever is running and clear the spoof',
  'set <place>               hold at a saved place',
  'set <lat> <lon>           hold at a coordinate',
  'play <route> [--spoof|--drive] [--mph N]',
  'ls [routes|places]        list what you can set / play',
  'help                      this',
];
const COMMANDS = {
  help(){ HELP.forEach(l=>logLine(l,'sys')); },
  clear(){ clearConsole(); },
  reset(){
    clearConsole();
    if(STATUS?.active || STATUS?.busy) stopAll();
    clearPreview();
    if(openCity){ openCity=null; renderBrowse(true); }
    frameBrowse(true);   // same whole-world view as on load
    setAccent(DEFAULT_ACCENT);
    if(!STATUS?.active) typeLine('phone is on real GPS.','ok');
  },
  stop(){ stopAll(); },
  set(args){
    if(args.length===2 && args.every(a=>isFinite(parseFloat(a)))) return setPoint(parseFloat(args[0]), parseFloat(args[1]));
    const p=PLACES.find(p=>p.id===args[0]);
    if(!p) return logLine(args.length ? `no place called '${args[0]}' — try ls places` : 'usage: set <place> | set <lat> <lon>','warn');
    setPlace(p);
  },
  play(args){
    const rt=ROUTES.find(r=>r.id===args[0]);
    if(!rt) return logLine(args.length ? `no route called '${args[0]}' — try ls routes` : 'usage: play <route> [--spoof|--drive] [--mph N]','warn');
    const ids=availableEngines().map(e=>e.id);
    const engine=ids.find(id=>args.includes('--'+id)) || selEngine();
    const mi=args.indexOf('--mph'), mph=mi>=0 ? parseFloat(args[mi+1]) : null;
    if(mi>=0 && !(mph>0)) return logLine('--mph needs a number','warn');
    if(mph && engine!=='drive') return logLine('--mph only works with --drive','warn');
    send(`play ${rt.id} --${engine}`+(mph?` --mph ${mph}`:''), '/api/play', { route:rt.id, engine, mph });
  },
  ls(args){
    const what=args[0];
    if(what && !['routes','places'].includes(what)) return logLine('usage: ls [routes|places]','warn');
    if(what!=='places') ROUTES.forEach(r=>logLine(`route  ${r.id.padEnd(16)} ${r.sub}`,'sys'));
    if(what!=='routes') PLACES.forEach(p=>logLine(`place  ${p.id.padEnd(16)} ${p.name}`,'sys'));
  },
};
function runPrompt(line){
  const [name, ...args]=line.trim().split(/\s+/);
  if(!name) return;
  const fn=COMMANDS[name.toLowerCase()];
  logLine('','cmd',true).innerHTML='<span class="ps">waypoint ›</span> '+esc(line.trim());
  if(!fn) return logLine(`command not found: ${name} — try help`,'warn');
  promptRunning=true;   // already echoed above, so send() shouldn't echo again
  try{ fn(args); } finally{ promptRunning=false; }
}
promptIn.addEventListener('input', sizePrompt);
promptIn.addEventListener('keydown', e=>{
  if(e.key==='Enter'){
    const line=promptIn.value;
    if(line.trim()){ cmdHistory.push(line); histAt=cmdHistory.length; }
    promptIn.value=''; sizePrompt();
    runPrompt(line);
  } else if(e.key==='ArrowUp' && histAt>0){
    e.preventDefault(); promptIn.value=cmdHistory[--histAt]; sizePrompt();
  } else if(e.key==='ArrowDown' && histAt<cmdHistory.length){
    e.preventDefault(); histAt++; promptIn.value=cmdHistory[histAt]||''; sizePrompt();
  } else if(e.key==='l' && e.ctrlKey){
    e.preventDefault(); clearConsole();
  } else if(e.key==='Escape'){
    promptIn.value=''; sizePrompt(); promptIn.blur();
  }
});
$('promptline').addEventListener('mousedown', e=>{ if(e.target!==promptIn){ e.preventDefault(); promptIn.focus(); } });
// clicking anywhere in the console box focuses the prompt, unless the click was a drag to select output text
$('consolewrap').addEventListener('click', e=>{
  if(e.target===promptIn || !window.getSelection().isCollapsed) return;
  promptIn.focus();
  const n=promptIn.value.length; promptIn.setSelectionRange(n, n);
});

/* ============ COMMAND PANEL (hero + thumbs) ============ */
let selected=null, engineChoice=null;

function tileUrl(lat, lon, z){
  const n=2**z;
  const x=Math.floor((lon+180)/360*n);
  const rad=lat*Math.PI/180;
  const y=Math.floor((1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*n);
  return TILE_URL.replace('{z}',z).replace('{x}',x).replace('{y}',y).replace('{r}','@2x');
}
function routeGlyph(pts, s){
  if(pts.length<2) return '';
  const step=Math.max(1, Math.floor(pts.length/60));
  pts=pts.filter((_,i)=>i%step===0 || i===pts.length-1);
  const lats=pts.map(p=>p[0]), lons=pts.map(p=>p[1]);
  const mnLa=Math.min(...lats), mxLa=Math.max(...lats), mnLo=Math.min(...lons), mxLo=Math.max(...lons);
  const spanLa=mxLa-mnLa||1e-9, spanLo=mxLo-mnLo||1e-9, span=Math.max(spanLa,spanLo);
  const pad=s*0.2, inner=s-pad*2;
  const oxy=pts.map(p=>[
    pad+((p[1]-mnLo)/span)*inner + (span===spanLa?(inner*(1-spanLo/span))/2:0),
    pad+((mxLa-p[0])/span)*inner + (span===spanLo?(inner*(1-spanLa/span))/2:0)
  ]);
  const d=oxy.map(q=>q[0].toFixed(1)+','+q[1].toFixed(1)).join(' ');
  const a=oxy[0], b=oxy[oxy.length-1];
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" fill="none">
    <polyline points="${d}" stroke="rgba(var(--accent-rgb),.18)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline class="draw" points="${d}" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" pathLength="120"/>
    <circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="2" fill="var(--accent)"/>
    <circle cx="${b[0].toFixed(1)}" cy="${b[1].toFixed(1)}" r="2.2" stroke="var(--accent)" stroke-width="1.2" fill="none"/>
  </svg>`;
}
function thumbHtml(item, s){
  if(item.type==='route') return routeGlyph(item.def.line, s);
  const p=item.def;
  return `<img src="${tileUrl(p.lat,p.lon,Math.max(3,(p.zoom||14)-2))}" alt="" draggable="false"><span class="pin"></span>`;
}
function countUp(el, target, decimals, suffix){
  if(RM){ el.innerHTML=target.toFixed(decimals)+suffix; return; }
  const t0=performance.now(), dur=650;
  setTimeout(()=>{ el.innerHTML=target.toFixed(decimals)+suffix; }, dur+80);   // land exactly, even if rAF stalls
  (function step(t){
    const k=Math.min(1,Math.max(0,(t-t0)/dur)), e=1-Math.pow(1-k,3);
    el.innerHTML=(target*e).toFixed(decimals)+suffix;
    if(k<1) requestAnimationFrame(step);
  })(t0);
}
/* ============ DESTINATIONS (city gallery → a city's places + route map cards) ============ */
// Cities aren't stored anywhere: a place's region names its city, a route belongs to whichever
// known city (or place region) its last point is nearest to, within NEAR_KM. Add a city here to
// give it a flag + color; anything unknown still gets its own card, just with a pin and a palette color.
// filled from /api/cities (core/destinations.json) in loadLibrary
const CITY_INFO = {};
const NEAR_KM = 100;
let openCity=null;

function cityOf(lat, lon){
  const cands=[...Object.entries(CITY_INFO).map(([n,c])=>[n,c.lat,c.lon]),
               ...PLACES.filter(p=>p.region).map(p=>[p.region,p.lat,p.lon])];
  let best='Elsewhere', bd=NEAR_KM*1000;
  for(const [n,la,lo] of cands){ const d=dist([lat,lon],[la,lo]); if(d<bd){ bd=d; best=n; } }
  return best;
}
// a city's local clock, so a club pin at 2pm local doesn't give the LARP away
function localTime(tz){
  try{ return new Intl.DateTimeFormat('en-US',{ timeZone:tz, weekday:'short', hour:'numeric', minute:'2-digit' }).format(new Date()); }
  catch(e){ return ''; }
}
function openNow(hours, tz){
  if(!hours || !tz) return null;
  const p=new Intl.DateTimeFormat('en-US',{ timeZone:tz, hour:'numeric', minute:'numeric', hourCycle:'h23' }).formatToParts(new Date());
  const t=+p.find(x=>x.type==='hour').value + p.find(x=>x.type==='minute').value/60, [a,b]=hours;
  return a<b ? t>=a && t<b : t>=a || t<b;
}
const fmtHour = h => { const hh=Math.floor(h)%24, m=Math.round(h%1*60); return `${hh%12||12}${m?':'+String(m).padStart(2,'0'):''}${hh<12?'am':'pm'}`; };
function cityInfo(name){
  if(CITY_INFO[name]) return CITY_INFO[name];
  const h=[...name].reduce((a,c)=>a+c.charCodeAt(0),0);
  return { country:'', flag:'📍', color:PALETTE[h%PALETTE.length] };
}
const cityItems = c => [...ROUTES.filter(r=>r.city===c).map(def=>({ type:'route', def })),
                        ...PLACES.filter(p=>p.city===c).map(def=>({ type:'place', def }))];
function cityNames(){
  const n=[...new Set([...ROUTES,...PLACES].map(x=>x.city))];
  return n.sort((a,b)=> (a==='Elsewhere')-(b==='Elsewhere') || cityItems(b).length-cityItems(a).length || a.localeCompare(b));
}
// countries come from CITY_INFO too; a city without one (unknown region, "Elsewhere") goes in OTHER, last
const OTHER = 'Other places';
const countryOf = c => cityInfo(c).country || OTHER;
const countryFlag = k => k===OTHER ? '🌐' : Object.values(CITY_INFO).find(c=>c.country===k).flag;
const countryCities = k => cityNames().filter(c=>countryOf(c)===k);
const countryItems = k => countryCities(k).flatMap(cityItems);
function countryNames(){
  const n=[...new Set(cityNames().map(countryOf))];
  return n.sort((a,b)=> (a===OTHER)-(b===OTHER) || countryItems(b).length-countryItems(a).length || a.localeCompare(b));
}
let shutCountries=new Set();   // collapsed country groups in the gallery
const itemPoints = it => it.type==='route' ? it.def.line : [[it.def.lat, it.def.lon]];
function cityCenter(c){
  if(CITY_INFO[c]) return [CITY_INFO[c].lat, CITY_INFO[c].lon];
  const pts=cityItems(c).flatMap(itemPoints);
  return [pts.reduce((s,p)=>s+p[0],0)/pts.length, pts.reduce((s,p)=>s+p[1],0)/pts.length];
}
// 'jfk-to-hotel' → 'JFK → hotel'
const ACRONYMS = new Set(['jfk','mia','cdg','dxb','lax','lhr','nyc','sfo']);
function routeLabel(name){
  const w=name.replace(/-to-/g,' → ').split(/[-_ ]+/).map(t=>ACRONYMS.has(t.toLowerCase()) ? t.toUpperCase() : t);
  const s=w.join(' ');
  return s.charAt(0).toUpperCase()+s.slice(1);
}

/* a static map: tiles framed to fit the items, with their routes drawn on top (w×h px) */
function mercator(lat, lon, z){
  const n=256*2**z, s=Math.sin(lat*Math.PI/180);
  return [(lon+180)/360*n, (.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n];
}
function mapArt(items, w, h, color, pad=26){
  const thin = line => { const st=Math.max(1, Math.floor(line.length/80)); return line.filter((_,i)=>i%st===0 || i===line.length-1); };
  const pts=items.flatMap(itemPoints);
  if(!pts.length) return '<div class="art"></div>';
  let z=15;
  for(; z>2; z--){
    const px=pts.map(p=>mercator(p[0],p[1],z)), xs=px.map(p=>p[0]), ys=px.map(p=>p[1]);
    if(Math.max(...xs)-Math.min(...xs)<=w-pad*2 && Math.max(...ys)-Math.min(...ys)<=h-pad*2) break;
  }
  const px=pts.map(p=>mercator(p[0],p[1],z)), xs=px.map(p=>p[0]), ys=px.map(p=>p[1]);
  const x0=(Math.max(...xs)+Math.min(...xs))/2-w/2, y0=(Math.max(...ys)+Math.min(...ys))/2-h/2;
  let tiles='';
  for(let tx=Math.floor(x0/256); tx<=Math.floor((x0+w)/256); tx++)
    for(let ty=Math.floor(y0/256); ty<=Math.floor((y0+h)/256); ty++)
      tiles+=`<img src="${TILE_URL.replace('{z}',z).replace('{x}',tx).replace('{y}',ty).replace('{r}','@2x')}" style="left:${(tx*256-x0).toFixed(1)}px;top:${(ty*256-y0).toFixed(1)}px" alt="" draggable="false" decoding="async">`;
  const P=(lat,lon)=>{ const [a,b]=mercator(lat,lon,z); return [(a-x0).toFixed(1), (b-y0).toFixed(1)]; };
  let svg='';
  for(const it of items){
    if(it.type==='route' && it.def.line.length>1){
      const line=thin(it.def.line), d='M'+line.map(p=>P(p[0],p[1]).join(' ')).join(' L');
      const a=P(...line[0]), b=P(...line[line.length-1]);
      svg+=`<path class="glow" d="${d}"/><path class="core" d="${d}"/><circle class="start" cx="${a[0]}" cy="${a[1]}" r="2.6"/><circle class="end" cx="${b[0]}" cy="${b[1]}" r="3.6"/>`;
    } else if(it.type==='place'){
      const [a,b]=P(it.def.lat, it.def.lon);
      svg+=`<circle class="pl" cx="${a}" cy="${b}" r="4"/>`;
    }
  }
  return `<div class="art" style="--t:${color}"><div class="stage" style="width:${w}px;height:${h}px;margin:${-h/2}px 0 0 ${-w/2}px">${tiles}<svg width="${w}" height="${h}">${svg}</svg></div></div>`;
}

const plural = (n, word) => `${n} ${n===1 ? word : word.endsWith('y') ? word.slice(0,-1)+'ies' : word+'s'}`;
const liveBadge = '<span class="livebadge"><i></i>Live</span>';
// one city card; `half` is the smaller one used 2-up when a country has several cities
function cityCard(c, w, half){
  const C=cityInfo(c), items=cityItems(c);
  const r=items.filter(i=>i.type==='route').length, p=items.length-r;
  const miles=items.reduce((s,i)=>s+(i.def.meters||0),0)/1609.34;
  const word = (n, s) => half ? n : plural(n, s);
  return `<button class="gcard" data-city="${esc(c)}" style="--t:${C.color}">
    ${mapArt(items, w, half ? 136 : 168, C.color, half ? 22 : 36)}<div class="shade"></div>
    <div class="top">${liveBadge}<span class="go">${icon('arrow-right',15)}</span></div>
    <div class="bot"><div class="cn">${esc(c)}</div><div class="mchips">
      ${r?`<span class="mchip">${icon('route',12)}${word(r,'route')}</span>`:''}
      ${p?`<span class="mchip">${icon('map-pin',12)}${word(p,'place')}</span>`:''}
      ${miles?`<span class="mchip">${miles.toFixed(miles<10?1:0)} mi</span>`:''}</div></div>
  </button>`;
}
function galleryHtml(W){
  const names=cityNames(), countries=countryNames();
  if(!names.length) return `<div class="bempty">no routes in core/routes/ or places in core/places.json yet</div>`;
  return `<div class="bhead"><div><h2>Destinations</h2><div class="sub">${plural(names.length,'city')} in ${plural(countries.length,'country')}</div></div>
      <button id="cmdk" onclick="Palette.open()" title="Search (⌘K)" aria-label="Search">${icon('search',15)}</button>
      <button id="resetview" onclick="resetView()" title="Reset view" aria-label="Reset view">${icon('rotate-ccw',15)}</button></div>`
    + countries.map(k=>{
      const cs=countryCities(k), shut=shutCountries.has(k);
      const r=countryItems(k).filter(i=>i.type==='route').length;
      return `<div class="cgroup"><button class="chead${shut?' shut':''}" data-country="${esc(k)}" aria-expanded="${!shut}" style="--t:${cityInfo(cs[0]).color}">
          <span class="fl">${countryFlag(k)}</span>
          <div><div class="nm">${esc(k)}</div><div class="sb">${plural(cs.length,'city')}${r?' · '+plural(r,'route'):''}</div></div>
          ${liveBadge}<span class="chev">${icon('chevron-down',16)}</span></button>
        ${shut ? '' : cs.length===1 ? cityCard(cs[0], W-28)
          : `<div class="halves">${cs.map(c=>cityCard(c, Math.floor((W-38)/2), true)).join('')}</div>`}</div>`;
    }).join('');
}
function hoursTag(def, tz){
  const open=openNow(def.hours, tz);
  if(open===null) return '';
  return `<span class="oc${open?' on':''}">${open ? 'open now' : 'opens '+fmtHour(def.hours[0])}</span>`;
}
function cityHtml(W){
  const c=openCity, C=cityInfo(c), items=cityItems(c);
  const R=items.filter(i=>i.type==='route'), P=items.filter(i=>i.type==='place');
  const miles=R.reduce((s,i)=>s+i.def.meters,0)/1609.34, secs=R.reduce((s,i)=>s+i.def.seconds,0);
  const cardW=Math.floor((W-38)/2);
  return `<div class="chero" style="--t:${C.color}">${mapArt(items, W, 200, C.color, 40)}<div class="shade"></div>
      <button class="backb" data-back>${icon('chevron-left',16)}Destinations</button>
      <button class="cmdkb" onclick="Palette.open()" title="Search (⌘K)" aria-label="Search">${icon('search',15)}</button>
      <div class="in"><div class="cn"><span class="flag">${C.flag}</span>${esc(c)}</div>${C.country?`<div class="cc">${esc(C.country)}${C.tz?` · ${esc(localTime(C.tz))} there`:''}</div>`:''}</div></div>
    <div class="cstats"><div><b>${R.length}</b><span>${R.length===1?'route':'routes'}</span></div>
      <div><b>${R.length?miles.toFixed(miles<10?1:0)+' mi':'—'}</b><span>of road</span></div>
      <div><b>${R.length?Math.round(secs/60)+' min':'—'}</b><span>of driving</span></div></div>
    ${P.length?`<div class="bsec">Places<span class="n">${P.length}</span></div>
      <div class="pchips" style="--t:${C.color}">${P.map(({def})=>`<button class="pchip" data-id="${esc(def.id)}" data-kind="place"><span class="ic">${icon('map-pin',14)}</span>${esc(def.name)}${hoursTag(def, C.tz)}</button>`).join('')}</div>`:''}
    ${R.length?`<div class="bsec">Routes<span class="n">${R.length}</span></div>
      <div class="mcards" style="--t:${C.color}">${R.map(it=>`<button class="mcard" data-id="${esc(it.def.id)}" data-kind="route">
        <div class="pic">${mapArt([it], cardW, 104, C.color, 16)}${liveBadge}</div>
        <div class="tx"><div class="nm">${esc(it.def.label)}</div><div class="sb">${esc(it.def.cardSub)}</div></div></button>`).join('')}</div>`:''}`;
}
function renderBrowse(animate){
  const el=$('browse'), W=el.clientWidth || 400;
  el.innerHTML = openCity && cityItems(openCity).length ? cityHtml(W) : galleryHtml(W);
  if(animate){ el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); el.scrollTop=0; }
  if(selected) el.querySelectorAll('[data-id]').forEach(b=>b.classList.toggle('sel', b.dataset.id===selected.def.id && b.dataset.kind===selected.type));
  markLive();
  drawBrowseMap();
}
function openCityPage(c){ openCity=c; renderBrowse(true); frameBrowse(); }
$('browse').addEventListener('click', e=>{
  const t=e.target.closest('[data-city],[data-country],[data-back],[data-id]');
  if(!t) return;
  if(t.dataset.city) openCityPage(t.dataset.city);
  else if(t.dataset.country){ const k=t.dataset.country; shutCountries.has(k) ? shutCountries.delete(k) : shutCountries.add(k); renderBrowse(); }
  else if(t.dataset.back!==undefined){ openCity=null; renderBrowse(true); frameBrowse(); }
  else {
    const def=(t.dataset.kind==='route'?ROUTES:PLACES).find(x=>x.id===t.dataset.id);
    if(def) selectItem({ type:t.dataset.kind, def });
  }
});
$('browse').addEventListener('dblclick', e=>{ if(e.target.closest('[data-id]')) runSelected(); });
// like panning: the border light holds still while the list scrolls so the scroll gets the frames
let scrollEnd;
$('browse').addEventListener('scroll', ()=>{
  document.body.classList.add('scrolling');
  clearTimeout(scrollEnd); scrollEnd=setTimeout(()=>document.body.classList.remove('scrolling'), 150);
}, { passive:true });
let browseResize;
window.addEventListener('resize', ()=>{ clearTimeout(browseResize); browseResize=setTimeout(()=>renderBrowse(), 150); });

// the map follows along: city tags on the world view, a city's routes faintly drawn inside it
let browseLayer=null;
// world view: cities whose tags would overlap at this zoom share one tag (the biggest city's,
// "+N"); clicking it zooms in until they split. Redone on every zoom.
function cityClusters(){
  const out=[];
  for(const c of cityNames()){
    const p=map.latLngToLayerPoint(cityCenter(c));
    const hit=out.find(k=>Math.abs(k.p.x-p.x)<130 && Math.abs(k.p.y-p.y)<34);
    if(hit) hit.cities.push(c); else out.push({ p, cities:[c] });
  }
  return out;
}
function drawBrowseMap(){
  if(!map) return;
  if(!browseLayer) browseLayer=L.layerGroup().addTo(map);
  browseLayer.clearLayers();
  if(!openCity){
    for(const k of cityClusters()){
      const c=k.cities[0], C=cityInfo(c), more=k.cities.length-1;
      const n=k.cities.reduce((s,x)=>s+cityItems(x).length, 0);
      L.marker(cityCenter(c), { icon:L.divIcon({ className:'', iconSize:null,
        html:`<div class="bub" style="--t:${C.color}"><span class="fl">${C.flag}</span>${esc(c)}${more?`<span class="more">+${more}</span>`:''}<span class="n">${n}</span></div>` }) })
        .on('click', ()=> more ? map.flyToBounds(L.latLngBounds(k.cities.map(cityCenter)).pad(.4), { duration:.9, maxZoom:9 }) : openCityPage(c))
        .addTo(browseLayer);
    }
    return;
  }
  const color=cityInfo(openCity).color;
  for(const it of cityItems(openCity)){
    if(it.type==='route') L.polyline(it.def.line, { color, weight:2.5, opacity:.35, interactive:false }).addTo(browseLayer);
    else L.circleMarker([it.def.lat, it.def.lon], { radius:4, color, weight:2, fillColor:'#fff', fillOpacity:.9, interactive:false }).addTo(browseLayer);
  }
}
function frameBrowse(force, instant){
  if((live && !force) || !map) return;   // don't yank the map away from something that's playing
  const pts = openCity ? cityItems(openCity).flatMap(itemPoints) : cityNames().map(cityCenter);
  if(!pts.length) return;
  const b = L.latLngBounds(pts).pad(openCity ? .15 : .35), maxZoom = openCity ? 14 : 4;
  instant ? map.fitBounds(b, { animate:false, maxZoom }) : map.flyToBounds(b, { duration:1.1, maxZoom });
}

function availableEngines(){ return ENGINES.length ? ENGINES : [{id:'spoof',label:'Spoof',real_speed:false}]; }
function selEngine(){
  const ids=availableEngines().map(e=>e.id);
  // only a click stores a choice; the default is worked out fresh, so a Spoof-only list from
  // before the first status poll doesn't stick once Drive shows up
  if(ids.includes(engineChoice)) return engineChoice;
  return ids.includes('drive') ? 'drive' : ids[0];
}
function renderEngines(){
  const seg=$('engine-seg'), cur=selEngine();
  seg.innerHTML = availableEngines().map(e=>
    `<button data-engine="${esc(e.id)}" class="${e.id===cur?'on':''}">${esc(e.label.toUpperCase())}${e.real_speed?' · MPH':''}</button>`).join('');
  seg.querySelectorAll('button').forEach(b=>b.onclick=()=>{ engineChoice=b.dataset.engine; renderEngines(); updateRouteNote(); });
  $('mph-wrap').hidden = cur!=='drive';
}
function updateRouteNote(){
  if(!selected || selected.type!=='route') return;
  const note = selEngine()==='drive'
    ? ($('mph').value ? 'real speed, held steady at the mph you typed. no stops.'
                       : 'real speed — Life360 shows mph + the car icon. speeds up, slows for bends, stops. type an mph to hold one steady speed.')
    : 'position only — Life360 shows 0 mph, but follows the route\'s slow-downs and stops.';
  $('hero-note').textContent = note;
}
function selectItem(item){
  selected=item;
  setAccent(item.def.accent);
  document.querySelectorAll('#browse [data-id]').forEach(b=>b.classList.toggle('sel', b.dataset.id===item.def.id && b.dataset.kind===item.type));
  $('hero').hidden=false;
  $('hero-thumb').innerHTML=thumbHtml(item,62);
  $('hero-name').textContent=item.def.label || item.def.name;
  $('hero-sub').textContent=item.def.sub;
  const stats=$('hero-stats');
  $('hero-opts').hidden = item.type!=='route';
  $('hero-note').textContent='';
  if(!live) clearPreview();
  if(item.type==='route'){
    const r=item.def;
    stats.innerHTML=`<div class="stat"><div class="k">CRUISE</div><div class="v" id="st-a"></div></div>
      <div class="stat"><div class="k">DIST</div><div class="v" id="st-b"></div></div>
      <div class="stat"><div class="k">TIME</div><div class="v" id="st-c"></div></div>`;
    countUp($('st-a'), (r.speed_mps||0)*MPS_TO_MPH, 0, '<small>mph</small>');
    countUp($('st-b'), r.meters/1609.34, 1, '<small>mi</small>');
    countUp($('st-c'), r.seconds/60, 0, '<small>min</small>');
    renderEngines(); updateRouteNote();
    if(!live && r.line.length>1){
      preview=L.polyline(r.line,{ color:r.accent, weight:2.5, opacity:.6, dashArray:'4 6' }).addTo(map);
      map.flyToBounds(preview.getBounds().pad(.25), { duration:.9 });
    }
  } else {
    const p=item.def;
    stats.innerHTML=`<div class="stat"><div class="k">LAT</div><div class="v" id="st-a"></div></div>
      <div class="stat"><div class="k">LON</div><div class="v" id="st-b"></div></div>
      <div class="stat"><div class="k">ZOOM</div><div class="v" id="st-c"></div></div>`;
    countUp($('st-a'), p.lat, 4, '°');
    countUp($('st-b'), p.lon, 4, '°');
    countUp($('st-c'), p.zoom||14, 0, 'x');
    if(item.type==='pin'){
      $('hero-note').textContent='click anywhere on the map to move the pin.';
    } else if(!live){
      pinCandidate=L.circleMarker([p.lat,p.lon],{ radius:7, color:p.accent, weight:2, fillOpacity:.25 }).addTo(map);
      map.flyTo([p.lat,p.lon], p.zoom||14, { duration:1.1 });
    }
  }
  refreshHeroButton();
}
function dropPin(lat, lon){
  if(pinCandidate) map.removeLayer(pinCandidate);
  if(preview && !live){ map.removeLayer(preview); preview=null; }
  pinCandidate=L.circleMarker([lat,lon],{ radius:7, color:DEFAULT_ACCENT, weight:2, fillOpacity:.25 }).addTo(map);
  document.querySelectorAll('#browse [data-id]').forEach(b=>b.classList.remove('sel'));
  const def={ id:'pin', name:'Dropped pin', sub:`${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon, zoom:Math.round(map.getZoom()), accent:DEFAULT_ACCENT };
  const keep=pinCandidate; pinCandidate=null;   // selectItem clears selection layers
  selectItem({ type:'pin', def });
  pinCandidate=keep;
}
function refreshHeroButton(){
  const b=$('hero-action');
  if(!selected){ b.disabled=true; return; }
  const noPhone = STATUS && !STATUS.devices.length;
  b.disabled = !!(STATUS && STATUS.busy) || noPhone;
  b.title = noPhone ? 'plug in + unlock the iPhone' : '';
  if(selected.type==='route') b.textContent = noPhone ? 'NO PHONE' : '▸ PLAY ROUTE';
  else b.textContent = noPhone ? 'NO PHONE' : (selected.type==='pin' ? '◉ SET LOCATION HERE' : '◉ SET LOCATION');
}
function runSelected(){
  if(!selected || $('hero-action').disabled) return;
  if(selected.type==='route') playRoute(selected.def);
  else if(selected.type==='pin') setPoint(selected.def.lat, selected.def.lon);
  else setPlace(selected.def);
}
function markLive(){
  const kind = live?.kind==='route' ? 'route' : 'place';
  const def = !live ? null : kind==='route' ? ROUTES.find(r=>r.id===live.label) : PLACES.find(p=>p.name===live.label);
  document.querySelectorAll('#browse [data-id]').forEach(b=>b.classList.toggle('live', !!def && b.dataset.id===def.id && b.dataset.kind===kind));
  document.querySelectorAll('#browse [data-city]').forEach(b=>b.classList.toggle('live', !!def && b.dataset.city===def.city));
  document.querySelectorAll('#browse [data-country]').forEach(b=>b.classList.toggle('live', !!def && b.dataset.country===countryOf(def.city)));
}

/* ============ DATA ============ */
async function loadLibrary(){
  const [places, routes, cities] = await Promise.all([api('/api/places'), api('/api/routes'), api('/api/cities')]);
  Object.assign(CITY_INFO, cities);
  PLACES = places.map(p=>({ ...p, sub:`${p.lat.toFixed(4)}, ${p.lon.toFixed(4)} · ${p.region||''}` }));
  PLACES.forEach(p=>{ p.city = p.region || cityOf(p.lat, p.lon); p.accent = cityInfo(p.city).color; });
  ROUTES = routes.map(r=>{
    const city = r.city || (r.line.length ? cityOf(...r.line[r.line.length-1]) : 'Elsewhere');
    const mi = (r.meters/1609.34).toFixed(1)+' mi', min = Math.round(r.seconds/60)+' min';
    return { ...r, city, accent: cityInfo(city).color, label: r.label || routeLabel(r.name),
      sub: [r.speed_mps ? '~'+Math.round(r.speed_mps*MPS_TO_MPH)+' mph' : r.modes.join('/'), mi, min].join(' · '),
      cardSub: [mi, min, r.modes.includes('drive') ? 'drive' : r.modes.includes('walk') ? 'walk' : ''].filter(Boolean).join(' · ') };
  });
}

/* ============ BOOT SEQUENCE ============ */
const bootlog=$('bootlog');
function bootLine(text, cls=''){
  const d=document.createElement('div'); d.className='ln '+cls; d.textContent=text; bootlog.appendChild(d); return d;
}
function typeInto(el, text, speed=13){
  return new Promise(res=>{
    if(RM){ el.textContent=text; res(); return; }
    let i=0;
    const t=setInterval(()=>{ el.textContent=text.slice(0,++i); if(i>=text.length){ clearInterval(t); res(); } }, speed);
  });
}
const wait = ms => new Promise(r=>setTimeout(r, RM?0:ms));
async function bootStep(label, work){
  const pad = label.padEnd(34,'.').replace(/\.+$/, m=>' '+'.'.repeat(m.length-1)+' ');
  const d=bootLine('');
  await typeInto(d, '  '+pad);
  let res;
  try{ res = await work(); }catch(e){ res = { ok:false, text:'FAIL' }; }
  const tag=document.createElement('span');
  tag.className = res.ok ? 'ok' : 'warn';
  tag.style.color = res.ok ? '' : '#e3b341';
  tag.textContent = res.text || (res.ok ? '[ OK ]' : '[ -- ]');
  d.appendChild(tag);
  return res;
}
async function boot(){
  // ask for the library and the phone right away (the steps below just show them landing), as soon
  // as the access key has checked out: until then the server answers the api with 402
  let library, firstLook;
  const load = ()=>{ library = loadLibrary(); library.catch(()=>{}); firstLook = pollStatus(); };   // the step below reports a failure
  const access = api('/api/license?wait=8').catch(()=>({ required:true, state:'offline' }));
  access.then(a=>{ if(a.state==='ok') load(); });
  // the glass intro, all of it, before the terminal starts typing (no-op under reduced motion / no WebGL2)
  Warp.prep();
  await Warp.in();
  await Warp.finished();
  const lic = await access;
  if(lic.state!=='ok'){
    // the key screen fades in over the finished icon, and the intro is taken down behind it
    const gate = keyGate(lic.state);
    setTimeout(()=>Warp.out(), 700);
    await gate;
    load();
  }
  await Warp.out();
  await wait(250);
  const native = !!window.pywebview || navigator.userAgent.includes('Macintosh') && !navigator.userAgent.includes('Chrome');
  const h=bootLine('','accent'); await typeInto(h,'▸ waypoint — vida-360 location console', 14);
  const c=bootLine('','dim'); await typeInto(c, native ? '  native window · local server 127.0.0.1' : '  browser · local server 127.0.0.1', 8);
  bootLine('');
  if(lic.required) await bootStep('checking access', async()=>({ ok:true, text:'[ UNLOCKED ]' }));
  await bootStep('starting map engine', async()=>{
    for(let i=0;i<20 && !tilesReady;i++) await wait(100);
    renderDevice();
    return tilesReady ? { ok:true } : { ok:false, text:'[ OFFLINE ]' };
  });
  await bootStep('loading route library', async()=>{
    await library; libLoaded=true;
    return { ok:true, text:`[ ${ROUTES.length} ROUTES · ${PLACES.length} PLACES ]` };
  });
  await bootStep('looking for the iphone', async()=>{
    await firstLook;
    const dev = STATUS?.devices?.[0];
    return dev ? { ok:true, text:'[ '+dev.name.toUpperCase()+' ]' } : { ok:false, text:'[ NOT FOUND ]' };
  });
  bootLine('');
  const dev = STATUS?.devices?.[0];
  const r=bootLine('', dev?'ok':'dim');
  await typeInto(r, dev ? '  ready.' : '  no phone yet — plug it in + unlock it, I\'ll keep looking.', 14);
  await wait(450);
  await linkPhone();
  $('boot').classList.add('gone');
  layoutApp(true);   // no-op if the connect screen already did it
  if(!STATUS?.active) setMode('IDLE');
  $('panel').classList.add('reveal');
  $('sweep').classList.add('go');
  await wait(250);
  if(STATUS?.dry_run) typeLine('dry run — commands are printed, the phone is not touched.','warn');
  typeLine('pick a route or place, or click the map to drop a pin.','sys');
  booted=true;
  // no polling while minimised (each status poll also has the server ask the phone); catch up on return
  setInterval(()=>{ if(!document.hidden) pollStatus(); }, 2000);
  setInterval(()=>{ if(!document.hidden) pollLogs(); }, 1000);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden){ pollStatus(); pollLogs(); } });
}

// the heavy part of showing the app: the browse cards and the map's first framing. On a first boot
// with the phone ready it runs under the connect card, with the map jumped straight to its spot.
let libLoaded=false, laidOut=false;
function layoutApp(fly){
  if(laidOut) return;
  laidOut=true;
  map.invalidateSize();
  if(libLoaded){ renderBrowse(fly); frameBrowse(false, !fly); }
}

/* ============ CONNECT SCREEN ============ */
/* Sits between the boot log and the app until the phone is plugged in and unlocked (the server
   checks unlock by mounting the DDI). Already-ready phones get a quick look at the green wire. */
const LINK_COPY = {
  none:     ['Connect your iPhone', 'Plug it into this computer with a USB cable.'],
  checking: ['Checking your iPhone…', 'Getting the developer disk image ready.'],
  locked:   ['Unlock your iPhone', 'Enter your passcode — and keep it unlocked while you spoof.'],
  ready:    ['iPhone ready', ''],
  error:    ['Something\'s off', ''],
};
let linkDone = null, linkHideTimer = null;
function renderLink(){
  const dev = STATUS?.devices?.[0];
  const ph = STATUS?.phone || { state: dev ? 'checking' : 'none' };
  const state = dev ? ph.state : 'none';
  const el = $('link');
  el.dataset.state = state;
  const [title, sub] = LINK_COPY[state] || LINK_COPY.error;
  $('link-title').textContent = title;
  $('link-sub').textContent = state==='ready' ? `${dev.name} · iOS ${dev.ios}` : (ph.message && state!=='locked' ? ph.message : sub);
  const step = (id, cls) => { $(id).className = 'lstep '+(cls||''); };
  step('ls-plug', dev ? 'done' : 'now');
  step('ls-unlock', !dev ? '' : state==='locked' ? 'warn' : state==='error' ? 'bad' : state==='checking' ? 'now' : 'done');
  step('ls-ready', state==='ready' ? 'done' : '');
  return state;
}
async function linkPhone(){
  const el = $('link');
  clearTimeout(linkHideTimer);
  el.classList.remove('in','out');   // a second visit (phone came unplugged) starts from scratch
  el.hidden = false;
  $('frame').classList.add('linking');
  if(RM) $('link-scene').pauseAnimations();
  renderLink();
  await wait(30);
  el.classList.add('in');
  $('boot').classList.add('gone');   // covered by now; gone so it can't show through the fade-out
  // lay the app out under it once the card has faded in, so the skip click doesn't pay for it
  if(!booted) setTimeout(()=>{ if(linkDone) layoutApp(false); }, 700);
  const done = new Promise(res => linkDone = res);
  (async function loop(){
    while(linkDone){
      await pollStatus();
      if(!linkDone) break;
      if(renderLink()==='ready'){
        if(!booted) layoutApp(false);   // under the card, so the skip/leave doesn't pay for it
        await new Promise(r=>setTimeout(r, 1800));   // a moment to see the lit wire
        if(!linkDone) break;   // skipped while the wire was lit
        leaveLink(); break;
      }
      await new Promise(r=>setTimeout(r, 700));   // not wait(): that's 0 under reduced motion
    }
  })();
  return done;
}
// "continue without phone"
function skipLink(){
  if(!linkDone) return;
  layoutApp(false);
  leaveLink();
}
function leaveLink(){
  if(!linkDone) return;
  const finish = linkDone; linkDone = null;
  const el = $('link');
  el.classList.add('out');
  $('frame').classList.remove('linking');
  linkHideTimer = setTimeout(()=>{ el.hidden = true; }, 650);
  finish();
}

/* ============ ACCESS KEY ============ */
/* Its own screen after the intro, before the boot log and the connect screen, when this build needs a
   key (backend/license.py, the key dashboard) and the saved one didn't check out; or later, over the
   app, if the key gets deleted while it's open. The server is what actually locks, with 402 on the
   api; this screen is just the way in. */
const KEY_COPY = {
  none:     ['Enter your access key', 'Paste the key you were sent to unlock Waypoint.'],
  bad:      ['That key didn\'t work', 'Check it against the one you were sent and try again.'],
  revoked:  ['Your key was turned off', 'Ask for a new key to keep using Waypoint.'],
  offline:  ['Can\'t reach Waypoint', 'Check your internet connection, then try again.'],
  checking: ['Checking your key…', 'Asking the key server. One moment.'],
  ok:       ['Unlocked', 'Welcome to Waypoint.'],
};
let keyOpen = null, keyBusy = false;
// WPT-XXXX-XXXX-XXXX-XXXX as you type or paste; the dashboard cleans it up again anyway
function fmtKey(v){
  let r = v.toUpperCase();
  if(r.startsWith('WPT-')) r = r.slice(4);
  r = r.replace(/[^0-9A-Z]/g,'');
  if(r.length>16 && r.startsWith('WPT')) r = r.slice(3);
  r = r.slice(0,16);
  return r ? 'WPT-'+r.match(/.{1,4}/g).join('-') : '';
}
const keyChars = v => v.replace(/^WPT-/,'').replace(/-/g,'');

// the slots: four groups of four, painted from the hidden input (WPT- is implied)
(function buildKeyCells(){
  let h = '';
  for(let g=0; g<4; g++){
    h += `<span class="kc-seg" style="--g:${g}">`;
    for(let j=0; j<4; j++) h += `<span class="kc" style="--i:${g*4+j}"></span>`;
    h += '</span>';
  }
  $('key-cells').innerHTML = h;
})();
let keyShown = 0;
function paintKey(){
  const chars = keyChars($('key-in').value), n = chars.length, was = keyShown;
  document.querySelectorAll('#key-cells .kc').forEach((c, i)=>{
    const ch = chars[i] || '';
    if(c.textContent !== ch) c.textContent = ch;
    c.classList.toggle('cur', i===n);
    if(ch && i>=was){   // new ones pop in; a paste cascades left to right
      c.classList.remove('pop'); void c.offsetWidth;
      c.style.setProperty('--pd', (i-was)*32+'ms');
      c.classList.add('pop');
    }
  });
  document.querySelectorAll('#key-cells .kc-seg').forEach((s, g)=>{
    const full = n >= (g+1)*4;
    s.classList.toggle('full', full);
    s.classList.toggle('now', n>=g*4 && n<(g+1)*4);
  });
  keyShown = n;
}

function setKeyText(id, text){
  const el = $(id);
  if(el.textContent === text) return;
  el.textContent = text;
  if(RM || !$('keygate').classList.contains('settled')) return;   // still rising in
  el.classList.remove('kg-swap'); void el.offsetWidth; el.classList.add('kg-swap');
}
function renderKey(state){
  const el = $('keygate');
  el.dataset.state = state;
  const [title, sub] = KEY_COPY[state] || KEY_COPY.none;
  setKeyText('key-title', title);
  setKeyText('key-sub', sub);
  $('key-go').querySelector('.lbl').textContent = state==='offline' && !$('key-in').value ? 'Try again' : 'Unlock';
}
function keyGate(state){
  const el = $('keygate');
  clearTimeout(keyGate.hide);
  el.classList.remove('out','in','checking','settled');
  clearTimeout(keyGate.settle);
  $('key-in').value = '';
  keyShown = 0;
  paintKey();
  renderKey(state==='checking' ? 'none' : state);
  el.hidden = false;
  $('frame').classList.add('keyed');
  KeyFX.start();
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('in')));
  keyGate.settle = setTimeout(()=>el.classList.add('settled'), RM ? 0 : 1900);   // the last piece is in by then
  setTimeout(()=>$('key-in').focus(), RM ? 0 : 700);
  return new Promise(res => keyOpen = res);
}
function shakeKey(){
  const b = $('key-box'), l = $('kg-icon');
  b.classList.remove('shake'); l.classList.remove('wiggle'); void b.offsetWidth;
  b.classList.add('shake'); l.classList.add('wiggle');
}
async function submitKey(e){
  e.preventDefault();
  if(keyBusy || !keyOpen) return;
  const el = $('keygate'), key = $('key-in').value.trim();
  if(!key && el.dataset.state!=='offline'){ shakeKey(); $('key-in').focus(); return; }
  keyBusy = true;
  $('key-go').disabled = true;
  el.classList.add('checking');
  renderKey('checking');
  el.dataset.state = 'none';   // the checking look is the class; keep the lock neutral meanwhile
  let st;
  try{ st = await api('/api/license', { key }); }catch{ st = { state:'offline' }; }
  await new Promise(r=>setTimeout(r, 1100));   // long enough to see the scan run, even when it's instant
  el.classList.remove('checking');
  keyBusy = false;
  $('key-go').disabled = false;
  if(st.state==='ok'){
    renderKey('ok');
    $('key-in').blur();
    $('key-box').classList.remove('focus');
    await new Promise(r=>setTimeout(r, 1400));   // a beat on the tick
    return closeKey();
  }
  renderKey(st.state);
  shakeKey();
  paintKey();
  $('key-in').focus();
  $('key-in').select();
}
function closeKey(){
  const el = $('keygate'), done = keyOpen;
  keyOpen = null;
  el.classList.add('out');
  el.classList.remove('in');
  $('frame').classList.remove('keyed');
  keyGate.hide = setTimeout(()=>{ el.hidden = true; el.classList.remove('out'); KeyFX.stop(); }, 1200);
  done?.();
}
// a 402 once the app is up: the key got deleted. Whatever's on the phone keeps going (stopping it
// would snap the pin back to real GPS in front of the circle); nothing new starts until a key works.
function keyLost(){
  if(!booted || keyOpen) return;
  typeLine('access key turned off — nothing new will start until a key works.','warn');
  keyGate('revoked').then(()=>{ typeLine('unlocked.','ok'); pollStatus(); });
}
$('key-in').addEventListener('input', e=>{
  const i = e.target, v = fmtKey(i.value);
  if(i.value!==v) i.value = v;
  paintKey();
  if(['bad','revoked'].includes($('keygate').dataset.state)) renderKey('none');
  else if($('keygate').dataset.state==='offline') renderKey('offline');
});
// the caret is painted, so the real one always stays at the end
['keydown','click','select'].forEach(t=>$('key-in').addEventListener(t, e=>{
  const i = e.target;
  if(e.type==='keydown' && !/^Arrow|Home|End/.test(e.key)) return;
  if(e.type==='keydown') e.preventDefault();
  requestAnimationFrame(()=>{ if(i.selectionStart===i.selectionEnd) i.setSelectionRange(i.value.length, i.value.length); });
}));
// typing (or ⌘V) anywhere on the screen lands in the key, even before the field took focus
document.addEventListener('keydown', e=>{
  if(keyOpen && !keyBusy && document.activeElement!==$('key-in') && !e.target.closest?.('button')) $('key-in').focus();
}, true);
$('key-in').addEventListener('focus', ()=>$('key-box').classList.add('focus'));
$('key-in').addEventListener('blur', ()=>$('key-box').classList.remove('focus'));

/* the background: the "Silk" flow shader (21st.dev Shader Builder) on a plain WebGL1 fullscreen
   triangle. Runs only while the screen is up and the window is visible; one still frame under
   reduced motion; no WebGL and the flat #02010a behind it shows instead. */
const KeyFX = (() => {
  const canvas = $('kg-silk');
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}';
  const FRAG = `// "Silk" — made with the 21st.dev Shader Builder
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 u_colors[8];
uniform vec4 u_scene;      // resolution.xy, time, colour count
uniform vec4 u_shape;      // scale, intensity, paramA, warp
uniform vec4 u_surface;    // detail, contrast, brightness, saturation
uniform vec4 u_finish;     // hue, vignette, blur, grain
uniform vec4 u_transform;  // seed, rotation, drift, OKLab toggle
uniform vec4 u_space;      // offset.xy, pointer.xy
uniform vec4 u_cursor;
#define u_resolution u_scene.xy
#define u_time u_scene.z
#define u_colorCount u_scene.w
#define u_scale u_shape.x
#define u_intensity u_shape.y
#define u_paramA u_shape.z
#define u_warp u_shape.w
#define u_detail u_surface.x
#define u_contrast u_surface.y
#define u_brightness u_surface.z
#define u_saturation u_surface.w
#define u_hue u_finish.x
#define u_vignette u_finish.y
#define u_blur u_finish.z
#define u_grain u_finish.w
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define u_seed u_transform.x
#else
#define u_seed mod(u_transform.x, 31.0)
#endif
#define u_rotate u_transform.y
#define u_drift u_transform.z
#define u_oklab u_transform.w
#define u_offset u_space.xy
#define u_mouse u_space.zw
#define u_cursorPresence u_cursor.x
#define u_cursorEffect u_cursor.y
#define u_cursorStrength u_cursor.z
#define u_cursorRadius u_cursor.w
float hash21(vec2 p) {
#ifndef GL_FRAGMENT_PRECISION_HIGH
  p = mod(p, 31.0);
#endif
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
#ifndef GL_FRAGMENT_PRECISION_HIGH
  p = mod(p, 31.0);
#endif
  float n = sin(dot(p, vec2(41.0, 289.0)));
  return fract(vec2(15731.743, 7892.321) * n);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.0, 9.2);
    a *= 0.5;
  }
  return v;
}
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)),
    step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
    step(0.0031308, c));
}
vec3 linToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = pow(max(l, 0.0), 1.0 / 3.0);
  m = pow(max(m, 0.0), 1.0 / 3.0);
  s = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 oklabToLin(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
vec3 mixColour(vec3 a, vec3 b, float t) {
  if (u_oklab > 0.5) {
    vec3 la = linToOklab(srgbToLinear(a));
    vec3 lb = linToOklab(srgbToLinear(b));
    return clamp(linearToSrgb(oklabToLin(mix(la, lb, t))), 0.0, 1.0);
  }
  return mix(a, b, t);
}
vec3 palette(float x) {
  float n = max(u_colorCount - 1.0, 1.0);
  float f = clamp(x, 0.0, 1.0) * n;
  vec3 col = u_colors[0];
  for (int i = 0; i < 7; i++) {
    if (float(i) < n)
      col = mixColour(col, u_colors[i + 1],
        smoothstep(0.0, 1.0, clamp(f - float(i), 0.0, 1.0)));
  }
  return col;
}
vec3 hueRotate(vec3 col, float a) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211,
                          0.587, -0.274, -0.523,
                          0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0,
                          0.956, -0.272, -1.106,
                          0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * col;
  float ca = cos(a), sa = sin(a);
  yiq = vec3(yiq.x, yiq.y * ca - yiq.z * sa, yiq.y * sa + yiq.z * ca);
  return toRGB * yiq;
}
vec3 shade(vec2 uv, vec2 p, float t) {
  vec2 q = p * 1.6;
  float amp = 0.25 + u_intensity * 0.85;
  for (float i = 1.0; i < 5.0; i += 1.0) {
    q.x += amp / i * cos(i * 2.4 * q.y + t * 0.8 + u_seed);
    q.y += amp / i * cos(i * 1.7 * q.x + t * 0.6);
  }
  return palette(0.5 + 0.5 * sin(q.x + q.y));
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 screenUv = uv;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy)
    / min(u_resolution.x, u_resolution.y);
  float cursorMask = 0.0;
  if (u_cursorPresence > 0.001) {
    vec2 cursor = (0.5 * u_mouse * u_resolution.xy)
      / min(u_resolution.x, u_resolution.y);
    vec2 cursorDelta = p - cursor;
    if (u_cursorEffect < 0.5) {
      p += cursor * u_cursorPresence * u_cursorStrength * 0.55;
    } else {
      float cursorDistance = length(cursorDelta);
      vec2 cursorDirection = cursorDelta / max(cursorDistance, 0.0001);
      cursorMask = u_cursorPresence
        * (1.0 - smoothstep(0.0, u_cursorRadius, cursorDistance));
      if (u_cursorEffect < 1.5) {
        p -= cursorDirection * cursorMask * u_cursorStrength * 0.24;
      } else if (u_cursorEffect < 2.5) {
        float cursorAngle = cursorMask * u_cursorStrength * 2.2;
        float cc = cos(cursorAngle), cs = sin(cursorAngle);
        p = cursor + mat2(cc, -cs, cs, cc) * cursorDelta;
      } else if (u_cursorEffect < 3.5) {
        float ripple = sin(
          cursorDistance / max(u_cursorRadius, 0.001) * 18.0 - u_time * 5.0);
        p -= cursorDirection * ripple * cursorMask * u_cursorStrength * 0.07;
      }
    }
  }
  uv = p * min(u_resolution.x, u_resolution.y) / u_resolution.xy + 0.5;
  p *= u_scale;
  if (abs(u_rotate) > 0.0001) {
    float cr = cos(u_rotate), sr = sin(u_rotate);
    p = mat2(cr, -sr, sr, cr) * p;
  }
  p += u_offset;
  if (u_drift > 0.0001)
    p += u_drift * vec2(sin(u_time * 0.31), cos(u_time * 0.23));
  if (u_warp > 0.0) {
    p += u_warp * (vec2(
      fbm(p * u_detail + u_seed),
      fbm(p * u_detail + vec2(5.2, 1.3))) - 0.5);
  }
  vec3 col;
  if (u_blur > 0.0) {
    float e = u_blur;
    float pe = e * u_scale;
    vec2 uvE = vec2(e) * min(u_resolution.x, u_resolution.y) / u_resolution.xy;
    col  = shade(uv, p, u_time) * 0.36;
    col += shade(uv + vec2(uvE.x, 0.0), p + vec2(pe, 0.0), u_time) * 0.16;
    col += shade(uv - vec2(uvE.x, 0.0), p - vec2(pe, 0.0), u_time) * 0.16;
    col += shade(uv + vec2(0.0, uvE.y), p + vec2(0.0, pe), u_time) * 0.16;
    col += shade(uv - vec2(0.0, uvE.y), p - vec2(0.0, pe), u_time) * 0.16;
  } else {
    col = shade(uv, p, u_time);
  }
  if (abs(u_contrast - 1.0) > 0.0001)
    col = (col - 0.5) * u_contrast + 0.5;
  if (abs(u_saturation - 1.0) > 0.0001) {
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, u_saturation);
  }
  if (abs(u_hue) > 0.0001)
    col = hueRotate(col, u_hue);
  if (abs(u_brightness) > 0.0001)
    col += u_brightness;
  if (u_vignette > 0.0001) {
    float vd = length(screenUv - 0.5) * 1.41421356;
    col *= 1.0 - u_vignette * smoothstep(0.35, 1.0, vd);
  }
  if (u_cursorPresence > 0.001 && u_cursorEffect > 3.5)
    col += (vec3(0.18) + col * 0.12) * cursorMask * u_cursorStrength;
  if (u_grain > 0.0001)
    col += (grainHash(
      gl_FragCoord.xy + vec2(u_seed * 17.0, u_seed * 31.0)) - 0.5) * u_grain;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
  // #02010A, #04052E, #3D2C8D, #916BBF, then zeros for the unused four
  const COLORS = new Float32Array([0.008,0.004,0.039, 0.016,0.020,0.180, 0.239,0.173,0.553, 0.569,0.420,0.749, ...Array(12).fill(0)]);
  let prog = null, U = {}, raf = 0, on = false, t0 = 0;

  function setup(){
    if(!gl) return false;
    if(prog) return true;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const v = sh(gl.VERTEX_SHADER, VERT), f = sh(gl.FRAGMENT_SHADER, FRAG);
    if(!v || !f) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){ prog = null; return false; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);   // one triangle covers the screen
    const a = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    for(const n of ['u_colors','u_scene','u_shape','u_surface','u_finish','u_transform','u_space','u_cursor']) U[n] = gl.getUniformLocation(prog, n);
    gl.uniform3fv(U.u_colors, COLORS);
    gl.uniform4f(U.u_shape, 1.26, 0.28, 0.50, 0.00);
    gl.uniform4f(U.u_surface, 2.40, 1.11, 0.00, 1.00);
    gl.uniform4f(U.u_finish, 0.00, 0.00, 0.000, 0.05);
    gl.uniform4f(U.u_transform, 1581.0, 0.00, 0.00, 0.0);
    gl.uniform4f(U.u_space, 0.00, 0.00, 0, 0);
    gl.uniform4f(U.u_cursor, 0, 2.0, 0.65, 0.46);   // cursor off
    return true;
  }
  function draw(now){
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth*dpr), h = Math.round(canvas.clientHeight*dpr);
    if(canvas.width!==w || canvas.height!==h){ canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    gl.uniform4f(U.u_scene, w, h, (now - t0)/1000 * 0.76, 4.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(now){
    raf = 0;
    if(!on || document.hidden) return;   // visibilitychange picks it back up
    draw(now);
    if(!RM) raf = requestAnimationFrame(frame);
  }
  const kick = ()=>{ if(on && !raf && !document.hidden) raf = requestAnimationFrame(frame); };
  document.addEventListener('visibilitychange', kick);
  addEventListener('resize', ()=>{ if(on && RM) kick(); });

  return {
    start(){
      if(on || !setup()) return;
      on = true;
      t0 ||= performance.now() - 20000;   // start mid-flow rather than on the seed's first frame
      kick();
    },
    stop(){ on = false; cancelAnimationFrame(raf); raf = 0; },
  };
})();

/* ============ INIT ============ */
initMap();
renderDevice();
setCoord(25.7617,-80.1918);
window.addEventListener('resize', ()=> map && map.invalidateSize());
document.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT') return;
  if(e.key==='Escape' && devOpen) return toggleDevice(null, false);   // close the dropdown, don't stop the spoof
  if(e.key==='Escape' && live) stopAll();
});
boot();
$('mph').addEventListener('input', updateRouteNote);
