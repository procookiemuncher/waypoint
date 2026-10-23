'use strict';
/* ============ WINDOW CHROME ============ */
function winMinimize(){ if(window.pywebview?.api) window.pywebview.api.minimize(); }
function winClose(){ if(window.pywebview?.api) window.pywebview.api.close(); }

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);

/* ============ MOCK DATA ============ */
const PLACES = [
  { id:'eiffel-tower', name:'Eiffel Tower', sub:'48.8584, 2.2945 · Paris', lat:48.8584, lon:2.2945, zoom:16, accent:'#ef3f4f' },
  { id:'dubai',        name:'Dubai',        sub:'25.1972, 55.2744 · UAE',  lat:25.1972, lon:55.2744, zoom:12, accent:'#e8c25a' },
  { id:'miami',        name:'Miami',        sub:'25.7617, -80.1918 · USA', lat:25.7617, lon:-80.1918, zoom:13, accent:'#ff5ecd' },
];
const ROUTES = [
  { id:'miami-cruise', name:'Miami Cruise', sub:'~18 mph · downtown loop', cruise:18, legs:7, zoom:14, accent:'#ff5ecd',
    pts:[[25.7745,-80.1865],[25.7702,-80.1880],[25.7659,-80.1893],[25.7616,-80.1907],[25.7573,-80.1921],[25.7570,-80.1958],[25.7599,-80.1966],[25.7641,-80.1959],[25.7663,-80.1988],[25.7706,-80.1977],[25.7744,-80.1966],[25.7752,-80.1918],[25.7757,-80.1884],[25.7745,-80.1865]] },
  { id:'miami-drift',  name:'Miami Drift',  sub:'~80 mph · expressway',    cruise:80, legs:4, zoom:12, accent:'#5ea2ff',
    pts:[[25.7623,-80.1932],[25.7702,-80.1965],[25.7789,-80.1993],[25.7906,-80.2007],[25.8045,-80.2003],[25.8203,-80.2049],[25.8361,-80.2077],[25.8524,-80.2087],[25.8687,-80.2079]] },
  { id:'paris-arrival', name:'Paris Arrival', sub:'~35 mph · final approach', cruise:35, legs:3, zoom:13, accent:'#ef3f4f', arrivalMsg:'PARIS ARRIVAL COMPLETE — WELCOME TO ORLY',
    pts:[[48.7620,2.3410],[48.7511,2.3532],[48.7420,2.3611],[48.7343,2.3656],[48.7286,2.3689],[48.7233,2.3719]] },
];
const TIMESCALE = 20; // simulated seconds per real second

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
const fmtT = s => { s=Math.max(0,Math.floor(s)); return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); };

/* ============ CONSOLE ============ */
const consoleEl = $('console');
function logLine(text, cls='sys', html=false){
  const d=document.createElement('div');
  d.className='ln '+cls;
  if(html) d.innerHTML=text; else d.textContent=text;
  consoleEl.appendChild(d);
  while(consoleEl.children.length>140) consoleEl.removeChild(consoleEl.firstChild);
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
    }, 14);
  }));
  return typeChain;
}
function echoCommand(cmd){
  typeChain = typeChain.then(()=>new Promise(res=>{
    const typed=$('prompt-typed');
    if(RM){
      logLine('','cmd',true).innerHTML='<span class="ps">waypoint ›</span> '+cmd;
      res(); return;
    }
    let i=0;
    const t=setInterval(()=>{
      typed.textContent=cmd.slice(0,++i);
      if(i>=cmd.length){
        clearInterval(t);
        setTimeout(()=>{
          typed.textContent='';
          logLine('','cmd',true).innerHTML='<span class="ps">waypoint ›</span> '+cmd;
          res();
        }, 160);
      }
    }, 26);
  }));
  return typeChain;
}

/* ============ ACCENT THEMING ============ */
const DEFAULT_ACCENT='#b49aff'; // base app accent; destinations override with their own
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
let map, marker=null, lineDim=null, lineGlow=null, lineDone=null;
function initMap(){
  map = L.map('map', { zoomControl:false, attributionControl:true, zoomSnap:.5 })
    .setView([25.7617,-80.1918], 13);
  L.control.zoom({ position:'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution:'© OpenStreetMap © CARTO', subdomains:'abcd', maxZoom:19,
  }).addTo(map);
  map.on('zoomend', ()=> $('v-zoom').textContent = map.getZoom());
  map.on('mousemove', e=>{
    if(!route) setCoord(e.latlng.lat, e.latlng.lng);
  });
}
function setCoord(lat, lon){
  const s = lat.toFixed(4)+', '+lon.toFixed(4);
  $('v-coord').textContent=s;
  $('sb-coord').textContent=s;
}
function makeMarker(latlng){
  return L.marker(latlng, { icon: L.divIcon({ className:'wp-marker', html:'<span class="ring"></span><span class="core"></span>', iconSize:[12,12] }), interactive:false }).addTo(map);
}

/* ============ ROUTE ENGINE ============ */
let route=null, playing=false, rafId=null, lastTs=0;
function buildRoute(def){
  const pts=def.pts;
  const cum=[0], hdg=[];
  for(let i=0;i<pts.length-1;i++){
    cum.push(cum[i]+dist(pts[i],pts[i+1]));
    hdg.push(heading(pts[i],pts[i+1]));
  }
  const turn=pts.map((_,i)=>{
    if(i===0||i===pts.length-1) return 0;
    let d=Math.abs(hdg[i]-hdg[i-1]); if(d>180)d=360-d; return d;
  });
  return { def, pts, cum, hdg, turn, total:cum[cum.length-1], d:0, spd:0, sim:0, lastLog:-99, leg:0 };
}
function posAt(r, d){
  d=Math.min(d, r.total);
  let i=0; while(i<r.cum.length-2 && r.cum[i+1]<d) i++;
  const segLen=r.cum[i+1]-r.cum[i], f=segLen>0?(d-r.cum[i])/segLen:0;
  const a=r.pts[i], b=r.pts[i+1];
  return { lat:a[0]+(b[0]-a[0])*f, lon:a[1]+(b[1]-a[1])*f, seg:i };
}
function targetSpeed(r){
  const cruise=r.def.cruise*0.44704; // m/s
  // ease-in at start, ease-out at end
  if(r.d < 40) return Math.max(cruise*0.35, cruise*(r.d/40));
  if(r.total-r.d < 70) return Math.max(2.2, cruise*((r.total-r.d)/70));
  // slow for upcoming / current corners
  const {seg}=posAt(r, r.d);
  let f=1;
  const toNext=r.cum[seg+1]-r.d, fromPrev=r.d-r.cum[seg];
  const LOOK=55;
  if(toNext<LOOK && r.turn[seg+1]>0){
    const k=Math.min(r.turn[seg+1],110)/110;
    f=Math.min(f, 1-k*0.72*(1-toNext/LOOK*0.4));
  }
  if(fromPrev<35 && r.turn[seg]>0){
    const k=Math.min(r.turn[seg],110)/110;
    f=Math.min(f, 1-k*0.6);
  }
  return cruise*Math.max(f,0.25);
}
function startRoute(def){
  clearRoute();
  const AC=def.accent||DEFAULT_ACCENT;
  setAccent(AC);
  route=buildRoute(def);
  const latlngs=def.pts.map(p=>[p[0],p[1]]);
  lineGlow=L.polyline(latlngs,{ color:AC, weight:9, opacity:.28, className:'glowcase' }).addTo(map);
  lineDim=L.polyline(latlngs,{ color:dimOf(AC), weight:2.5, opacity:.55 }).addTo(map);
  lineDone=L.polyline([latlngs[0]],{ color:AC, weight:3, opacity:.95 }).addTo(map);
  marker=makeMarker(latlngs[0]);
  map.flyToBounds(lineDim.getBounds().pad(.25), { duration:1.1 });
  $('nowplaying').classList.add('on');
  $('np-name').textContent=def.name;
  $('btn-play').textContent='PAUSE';
  $('v-leg').textContent='1/'+def.legs;
  setMode('EN ROUTE');
  markLive();
  playing=true; lastTs=0;
  rafId=requestAnimationFrame(tick);
}
function tick(ts){
  if(!route||!playing) return;
  if(!lastTs) lastTs=ts;
  const dt=Math.min((ts-lastTs)/1000, .05); lastTs=ts;
  const r=route, simDt=dt*TIMESCALE;
  const tgt=targetSpeed(r);
  r.spd += (tgt-r.spd)*(1-Math.exp(-simDt*0.9));
  r.d += r.spd*simDt;
  r.sim += simDt;
  if(r.d>=r.total){ arrive(); return; }
  const p=posAt(r, r.d);
  const mph=r.spd*2.23694;
  marker.setLatLng([p.lat,p.lon]);
  // traveled trail
  const done=r.pts.slice(0, p.seg+1).map(q=>[q[0],q[1]]); done.push([p.lat,p.lon]);
  lineDone.setLatLngs(done);
  if(!map.getBounds().pad(-.2).contains([p.lat,p.lon])) map.panTo([p.lat,p.lon]);
  // readouts
  setCoord(p.lat,p.lon);
  $('v-speed').textContent=mph.toFixed(1)+' mph';
  const h=r.hdg[p.seg];
  $('v-hdg').textContent=Math.round(h)+'° '+compass(h);
  const leg=Math.min(r.def.legs, Math.floor(r.d/r.total*r.def.legs)+1);
  if(leg!==r.leg){ r.leg=leg; $('v-leg').textContent=leg+'/'+r.def.legs; }
  $('np-time').textContent='t+'+fmtT(r.sim);
  $('sb-elapsed').textContent=fmtT(r.sim);
  $('np-fill').style.width=(r.d/r.total*100).toFixed(1)+'%';
  $('gauge-fill').style.width=Math.min(100, mph/90*100)+'%';
  // console ticker every ~20 simulated seconds
  if(r.sim-r.lastLog>=20){
    r.lastLog=r.sim;
    logLine(`[t+${fmtT(r.sim)}] leg ${leg}/${r.def.legs} · ${p.lat.toFixed(4)},${p.lon.toFixed(4)} · ${mph.toFixed(1)}mph`,'dim');
  }
  rafId=requestAnimationFrame(tick);
}
function arrive(){
  const r=route;
  const end=r.pts[r.pts.length-1];
  marker.setLatLng(end); lineDone.setLatLngs(r.pts);
  setCoord(end[0],end[1]);
  $('v-speed').textContent='0.0 mph';
  $('np-fill').style.width='100%';
  $('gauge-fill').style.width='0%';
  $('btn-play').textContent='REPLAY';
  playing=false;
  setMode('ARRIVED');
  logLine(`[t+${fmtT(r.sim)}] ▸ ARRIVED — ${r.def.name.toLowerCase()} · ${(r.total/1609.34).toFixed(1)}mi in ${fmtT(r.sim)}`,'ok');
  const toast=$('toast');
  $('toast-msg').textContent=r.def.arrivalMsg || ('ARRIVED — '+r.def.name.toUpperCase()+' COMPLETE');
  toast.classList.add('show');
  setTimeout(()=>toast.classList.remove('show'), 4200);
}
function togglePlay(){
  if(!route) return;
  if(route.d>=route.total){ // replay
    const def=route.def; startRoute(def);
    typeLine('replaying '+def.id+' …','sys');
    return;
  }
  playing=!playing;
  $('btn-play').textContent=playing?'PAUSE':'RESUME';
  setMode(playing?'EN ROUTE':'PAUSED');
  if(playing){ lastTs=0; rafId=requestAnimationFrame(tick); }
  else { cancelAnimationFrame(rafId); logLine(`[t+${fmtT(route.sim)}] ⏸ paused`,'warn'); }
}
function clearRoute(){
  playing=false; cancelAnimationFrame(rafId);
  [marker,lineDim,lineGlow,lineDone].forEach(l=>{ if(l) map.removeLayer(l); });
  marker=lineDim=lineGlow=lineDone=null; route=null;
  $('nowplaying').classList.remove('on');
  $('v-leg').textContent='—'; $('v-hdg').textContent='—';
  $('v-speed').textContent='0.0 mph';
  $('sb-elapsed').textContent='--:--';
  $('gauge-fill').style.width='0%';
  markLive();
}
function resetRoute(){
  if(!route) return;
  echoCommand('reset');
  clearRoute();
  setMode('IDLE');
  typeLine('route cleared. view is yours.','sys');
}

/* ============ COMMANDS ============ */
function setMode(m){ $('sb-mode-v').textContent=m; }
function focusPlace(p){
  echoCommand('focus '+p.id);
  if(route) clearRoute();
  setMode('FOCUSED');
  map.flyTo([p.lat,p.lon], p.zoom, { duration:1.4 });
  typeLine(`locked on ${p.name.toLowerCase()} · ${p.lat.toFixed(4)},${p.lon.toFixed(4)}`,'accent');
  setCoord(p.lat,p.lon);
}
function playRoute(def){
  echoCommand('play '+def.id);
  typeLine(`route loaded: ${def.name.toLowerCase()} · ${def.legs} legs · cruise ${def.cruise}mph`,'sys');
  startRoute(def);
}
function resetView(){
  echoCommand('reset view');
  if(route) clearRoute();
  setMode('IDLE');
  map.flyTo([25.7617,-80.1918], 13, { duration:1.4 });
  typeLine('view reset to home.','sys');
}

/* ============ COMMAND PANEL (tabs + hero + thumbs) ============ */
let curTab='routes', selected=null;

function tileUrl(lat, lon, z){
  const n=2**z;
  const x=Math.floor((lon+180)/360*n);
  const rad=lat*Math.PI/180;
  const y=Math.floor((1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*n);
  return `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
}
function routeGlyph(pts, s){
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
    <polyline class="draw" points="${d}" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="2" fill="var(--accent)"/>
    <circle cx="${b[0].toFixed(1)}" cy="${b[1].toFixed(1)}" r="2.2" stroke="var(--accent)" stroke-width="1.2" fill="none"/>
  </svg>`;
}
function thumbHtml(item, s){
  if(item.type==='route') return routeGlyph(item.def.pts, s);
  const p=item.def;
  return `<img src="${tileUrl(p.lat,p.lon,Math.max(3,p.zoom-2))}" alt="" draggable="false"><span class="pin"></span>`;
}
function routeStats(def){
  let tot=0; for(let i=0;i<def.pts.length-1;i++) tot+=dist(def.pts[i],def.pts[i+1]);
  return { mi: tot/1609.34, eta: (tot/(def.cruise*0.44704))/60 };
}
function countUp(el, target, decimals, suffix){
  if(RM){ el.innerHTML=target.toFixed(decimals)+suffix; return; }
  const t0=performance.now(), dur=650;
  (function step(t){
    const k=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-k,3);
    el.innerHTML=(target*e).toFixed(decimals)+suffix;
    if(k<1) requestAnimationFrame(step);
  })(t0);
}
function setTab(tab, keepSel){
  curTab=tab;
  $('tab-routes').classList.toggle('on', tab==='routes');
  $('tab-places').classList.toggle('on', tab==='places');
  $('tabglider').classList.toggle('right', tab==='places');
  renderList();
  if(!keepSel){
    const first=(tab==='routes'?ROUTES:PLACES)[0];
    selectItem({ type:tab==='routes'?'route':'place', def:first });
  }
}
function renderList(){
  const list=$('cmdlist');
  list.innerHTML='';
  const items=(curTab==='routes'?ROUTES:PLACES).map(def=>({ type:curTab==='routes'?'route':'place', def }));
  items.forEach((item,i)=>{
    const d=document.createElement('div');
    d.className='row listfade'; d.tabIndex=0;
    d.dataset.id=item.def.id;
    d.style.animationDelay=(i*0.06)+'s';
    d.style.setProperty('--d', (0.18+i*0.07)+'s');
    d.innerHTML=`<div class="thumb">${thumbHtml(item,40)}</div>
      <div class="meta"><div class="name">${item.def.name}</div><div class="sub">${item.def.sub}</div></div>
      <span class="eq"><i></i><i></i><i></i></span><span class="sel-dot"></span>`;
    const go=()=>selectItem(item);
    d.addEventListener('click', go);
    d.addEventListener('dblclick', ()=>{ selectItem(item); runSelected(); });
    d.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); go(); }});
    list.appendChild(d);
  });
  markLive();
}
function selectItem(item){
  selected=item;
  setAccent(item.def.accent);
  document.querySelectorAll('#cmdlist .row').forEach(r=>r.classList.toggle('sel', r.dataset.id===item.def.id));
  $('hero-thumb').innerHTML=thumbHtml(item,62);
  $('hero-name').textContent=item.def.name;
  $('hero-sub').textContent=item.def.sub;
  const stats=$('hero-stats');
  if(item.type==='route'){
    const s=routeStats(item.def);
    stats.innerHTML=`<div class="stat"><div class="k">CRUISE</div><div class="v" id="st-a"></div></div>
      <div class="stat"><div class="k">DIST</div><div class="v" id="st-b"></div></div>
      <div class="stat"><div class="k">LEGS</div><div class="v" id="st-c"></div></div>`;
    countUp($('st-a'), item.def.cruise, 0, '<small>mph</small>');
    countUp($('st-b'), s.mi, 1, '<small>mi</small>');
    countUp($('st-c'), item.def.legs, 0, '');
    $('hero-action').textContent='▸ PLAY ROUTE';
  } else {
    stats.innerHTML=`<div class="stat"><div class="k">LAT</div><div class="v" id="st-a"></div></div>
      <div class="stat"><div class="k">LON</div><div class="v" id="st-b"></div></div>
      <div class="stat"><div class="k">ZOOM</div><div class="v" id="st-c"></div></div>`;
    countUp($('st-a'), item.def.lat, 2, '°');
    countUp($('st-b'), item.def.lon, 2, '°');
    countUp($('st-c'), item.def.zoom, 0, 'x');
    $('hero-action').textContent='◉ FOCUS';
  }
}
function runSelected(){
  if(!selected) return;
  if(selected.type==='route') playRoute(selected.def);
  else focusPlace(selected.def);
}
function markLive(){
  const id=route?route.def.id:null;
  document.querySelectorAll('#cmdlist .row').forEach(r=>r.classList.toggle('live', r.dataset.id===id));
}
function buildList(){ setTab('routes'); }
/* ============ BOOT SEQUENCE ============ */
const bootlog=$('bootlog');
function bootLine(text, cls=''){
  const d=document.createElement('div'); d.className='ln '+cls; bootlog.appendChild(d); return d;
}
function typeInto(el, text, speed=13){
  return new Promise(res=>{
    if(RM){ el.textContent=text; res(); return; }
    let i=0;
    const t=setInterval(()=>{ el.textContent=text.slice(0,++i); if(i>=text.length){ clearInterval(t); res(); } }, speed);
  });
}
const wait = ms => new Promise(r=>setTimeout(r, RM?0:ms));
async function bootStep(label, pillId, ms){
  const pad = label.padEnd(34,'.').replace(/\.+$/, m=>' '+'.'.repeat(m.length-1)+' ');
  const d=bootLine('');
  await typeInto(d, '  '+pad);
  await wait(ms);
  const ok=document.createElement('span'); ok.className='ok'; ok.textContent='[ OK ]';
  d.appendChild(ok);
  if(pillId) $(pillId).classList.add('ok');
}
async function boot(){
  await wait(350);
  const h=bootLine('','accent'); await typeInto(h,'▸ waypoint v2.4.1 — route & map visualizer', 16);
  const c=bootLine('','dim'); await typeInto(c,'  © frameless build · webview2', 10);
  bootLine('');
  await bootStep('starting map engine', 'pill-map', 420);
  await bootStep('loading dark_matter tiles', null, 520);
  await bootStep('connecting location service', 'pill-gps', 460);
  await bootStep('syncing route library (3 routes)', 'pill-sync', 480);
  bootLine('');
  const r=bootLine('','ok'); await typeInto(r,'  ready. welcome back.', 18);
  await wait(500);
  $('boot').classList.add('gone');
  $('panel').classList.add('reveal');
  map.invalidateSize();
  $('sweep').classList.add('go');
  setMode('IDLE');
  await wait(300);
  typeLine('systems nominal. select a destination or play a route.','sys');
  typeLine('tip: routes stream live telemetry to this console.','dim');
}

/* ============ INIT ============ */
initMap();
buildList();
setCoord(25.7617,-80.1918);
window.addEventListener('resize', ()=> map && map.invalidateSize());
boot();
