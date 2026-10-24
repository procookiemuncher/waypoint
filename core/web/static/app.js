'use strict';
/* Waypoint — the vida-360 front end. Talks to core/backend/server.py; everything that touches
   the phone goes through /api. The map animation follows the server's timeline in real time,
   so when the pin here arrives, the phone arrives. */

/* ============ WINDOW CHROME ============ */
function winMinimize(){ if(window.pywebview?.api) window.pywebview.api.minimize(); }
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
  if(lineDim) lineDim.setStyle({ color:dimOf(hex) });
}

/* ============ MAP ============ */
const TILE_URL='https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png';
let map, tilesReady=false;
let marker=null, lineDim=null, lineGlow=null, lineDone=null;   // live layers
let preview=null, pinCandidate=null;                           // selection layers
function initMap(){
  map = L.map('map', { zoomControl:false, attributionControl:true, zoomSnap:.5 })
    .setView([25.7617,-80.1918], 13);
  L.control.zoom({ position:'bottomright' }).addTo(map);
  // Stadia's dark style is keyless from localhost (CARTO wants an API key now)
  const tiles = L.tileLayer(TILE_URL, {
    attribution:'© Stadia Maps © OpenMapTiles © OpenStreetMap', maxZoom:20,
  }).addTo(map);
  tiles.once('load', ()=>{ tilesReady=true; });
  // the border light + frosted HUDs repaint every frame; pause them while the map moves
  map.on('movestart', ()=> document.body.classList.add('panning'));
  map.on('moveend', ()=> document.body.classList.remove('panning'));
  map.on('zoomend', ()=>{ $('v-zoom').textContent = map.getZoom(); if(!openCity) drawBrowseMap(); });
  map.on('mousemove', e=>{ if(!live) setCoord(e.latlng.lat, e.latlng.lng); });
  map.on('click', e=> dropPin(e.latlng.lat, e.latlng.lng));
}
function setCoord(lat, lon){
  const s = lat.toFixed(4)+', '+lon.toFixed(4);
  $('v-coord').textContent=s;
  $('sb-coord').textContent=s;
}
function makeMarker(latlng){
  return L.marker(latlng, { icon: L.divIcon({ className:'wp-marker', html:'<span class="ring"></span><span class="core"></span>', iconSize:[12,12] }), interactive:false }).addTo(map);
}
function clearPreview(){
  [preview,pinCandidate].forEach(l=>{ if(l) map.removeLayer(l); });
  preview=pinCandidate=null;
}
function clearLiveLayers(){
  [marker,lineDim,lineGlow,lineDone].forEach(l=>{ if(l) map.removeLayer(l); });
  marker=lineDim=lineGlow=lineDone=null;
}

/* ============ LIVE STATE (what the phone is doing) ============ */
// live = { key, kind, label, started, timeline, cum, total, accent, arrived }
let live=null, follow=true, clockOffset=0, rafId=null, lastLogAt=-99;

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
  cancelAnimationFrame(rafId);
  clearLiveLayers();
  live=null;
  $('nowplaying').classList.remove('on');
  $('v-leg').textContent='—'; $('v-hdg').textContent='—'; $('v-speed').textContent='0.0 mph';
  $('sb-elapsed').textContent='--:--'; $('gauge-fill').style.width='0%';
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
    lineGlow=L.polyline(latlngs,{ color:live.accent, weight:9, opacity:.28, className:'glowcase' }).addTo(map);
    lineDim=L.polyline(latlngs,{ color:dimOf(live.accent), weight:2.5, opacity:.55 }).addTo(map);
    lineDone=L.polyline([latlngs[0]],{ color:live.accent, weight:3, opacity:.95 }).addTo(map);
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

function tick(){
  if(!live) return;
  const el = serverNow() - live.started;
  $('np-time').textContent='t+'+fmtT(el);
  $('sb-elapsed').textContent=fmtT(el);
  if(live.kind==='route' && live.timeline.length){
    const tl=live.timeline, s=sampleAt(tl, el);
    // drive mode holds one speed; spoof follows the route's own speeds
    const mph = el>=live.total ? 0 : (live.engine==='drive' ? (live.mph||s.spd*MPS_TO_MPH) : s.spd*MPS_TO_MPH);
    marker.setLatLng([s.lat,s.lon]);
    const done=tl.slice(0, s.i+1).map(q=>[q[1],q[2]]); done.push([s.lat,s.lon]);
    lineDone.setLatLngs(done);
    if(follow && !map.getBounds().pad(-.2).contains([s.lat,s.lon])) map.panTo([s.lat,s.lon]);
    setCoord(s.lat,s.lon);
    $('v-speed').textContent=mph.toFixed(1)+' mph';
    if(s.hdg!==null) $('v-hdg').textContent=Math.round(s.hdg)+'° '+compass(s.hdg);
    $('v-leg').textContent = el>=live.total ? 'arrived' : fmtT(live.total-el);
    $('np-fill').style.width=Math.min(100, el/live.total*100).toFixed(1)+'%';
    $('gauge-fill').style.width=Math.min(100, mph/90*100)+'%';
    if(el-lastLogAt>=30 && el<live.total){
      lastLogAt=el;
      logLine(`[t+${fmtT(el)}] ${s.lat.toFixed(4)},${s.lon.toFixed(4)} · ${mph.toFixed(1)}mph`,'dim');
    }
    if(el>=live.total && !live.arrived) arrive();
  }
  rafId=requestAnimationFrame(tick);
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
function sizePrompt(){ promptIn.style.width=(promptIn.value.length+1)+'ch'; }
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
    map.flyTo([25.7617,-80.1918], 13, { duration:1.2 });
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
      tiles+=`<img src="${TILE_URL.replace('{z}',z).replace('{x}',tx).replace('{y}',ty).replace('{r}','@2x')}" style="left:${(tx*256-x0).toFixed(1)}px;top:${(ty*256-y0).toFixed(1)}px" alt="" draggable="false">`;
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
function frameBrowse(){
  if(live || !map) return;   // don't yank the map away from something that's playing
  const pts = openCity ? cityItems(openCity).flatMap(itemPoints) : cityNames().map(cityCenter);
  if(!pts.length) return;
  map.flyToBounds(L.latLngBounds(pts).pad(openCity ? .15 : .35), { duration:1.1, maxZoom: openCity ? 14 : 4 });
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
  await wait(250);
  const native = !!window.pywebview || navigator.userAgent.includes('Macintosh') && !navigator.userAgent.includes('Chrome');
  const h=bootLine('','accent'); await typeInto(h,'▸ waypoint — vida-360 location console', 14);
  const c=bootLine('','dim'); await typeInto(c, native ? '  native window · local server 127.0.0.1' : '  browser · local server 127.0.0.1', 8);
  bootLine('');
  await bootStep('starting map engine', async()=>{
    for(let i=0;i<20 && !tilesReady;i++) await wait(100);
    renderDevice();
    return tilesReady ? { ok:true } : { ok:false, text:'[ OFFLINE ]' };
  });
  let lib;
  await bootStep('loading route library', async()=>{
    await loadLibrary(); lib=true;
    return { ok:true, text:`[ ${ROUTES.length} ROUTES · ${PLACES.length} PLACES ]` };
  });
  await bootStep('looking for the iphone', async()=>{
    await pollStatus();
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
  $('panel').classList.add('reveal');
  map.invalidateSize();
  $('sweep').classList.add('go');
  if(lib){ renderBrowse(true); frameBrowse(); }
  if(!STATUS?.active) setMode('IDLE');
  await wait(250);
  if(STATUS?.dry_run) typeLine('dry run — commands are printed, the phone is not touched.','warn');
  typeLine('pick a route or place, or click the map to drop a pin.','sys');
  booted=true;
  setInterval(pollStatus, 2000);
  setInterval(pollLogs, 1000);
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
  const done = new Promise(res => linkDone = res);
  (async function loop(){
    while(linkDone){
      await pollStatus();
      if(!linkDone) break;
      if(renderLink()==='ready'){
        await new Promise(r=>setTimeout(r, 1800));   // a moment to see the lit wire
        leaveLink(); break;
      }
      await new Promise(r=>setTimeout(r, 700));   // not wait(): that's 0 under reduced motion
    }
  })();
  await done;
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
