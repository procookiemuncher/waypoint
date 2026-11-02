/* ⌘K command palette. Loads after app.js and uses its globals (ROUTES, PLACES, STATUS, send, stopAll,
   selectItem, openCityPage...). Search anything, or build a command out of chips:
   action → route/place/city → engine → confirm. Nothing reaches the phone before the confirm step, since a
   real run moves the owner's pin in front of their circle. `go` looks up an address and only moves the map:
   the pin it leaves is set from the hero's button, like any dropped pin. Single-line strings only: the release build's
   rjsmin chokes on multiline template literals. */
const Palette = (() => {
  const VERBS = { play:'play', pin:'pin', set:'pin', open:'open', go:'go', address:'go' };
  const CHIP = { play:'Play', pin:'Pin', open:'Open', go:'Go to' };
  const WANT = { play:'Which route?', pin:'Which place?', open:'Which city?', go:'Type an address' };
  const MAX_RESULTS = 30;
  const ADDRESS_MIN = 3, ADDRESS_WAIT_MS = 300;
  const CONFIRM_GUARD_MS = 250;   // a double tap on the step before shouldn't count as the confirm

  let shown=false, action=null, target=null, engine=null, rows=[], at=0, backTo=null, stepAt=0, sig='', timer=null;
  let addr={ q:'', rows:[], state:'idle' }, addrSeq=0, addrTimer=null;

  const root=document.createElement('div');
  root.id='palette'; root.hidden=true;
  root.innerHTML='<div id="pal-box" role="dialog" aria-modal="true" aria-label="Command palette">'
    +'<div id="pal-top"><span class="ic">'+icon('search',16)+'</span><div id="pal-chips"></div>'
    +'<input id="pal-in" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-label="Search or type a command"></div>'
    +'<div id="pal-list" role="listbox"></div>'
    +'<div id="pal-foot"><span id="pal-note"></span><span id="pal-keys"></span></div></div>';
  document.body.appendChild(root);
  const input=root.querySelector('#pal-in'), list=root.querySelector('#pal-list'), chips=root.querySelector('#pal-chips');
  const note=root.querySelector('#pal-note'), keys=root.querySelector('#pal-keys');

  /* ---- matching ---- */
  const norm = s => String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  // every word typed has to appear somewhere; the name counts for more than the city or id
  function score(tokens, name, extra){
    const n=norm(name), hay=n+' '+norm(extra), words=n.split(' ');
    if(!tokens.every(t=>hay.includes(t))) return 0;
    let s = n===tokens.join(' ') ? 100 : 0;
    for(const t of tokens){
      if(n.startsWith(t)) s+=30;
      else if(words.some(w=>w.startsWith(t))) s+=20;
      else if(n.includes(t)) s+=10;
      else s+=3;
    }
    return s;
  }
  const running = () => !!(STATUS && (STATUS.active || STATUS.busy)) || !!live;

  /* ---- rows ---- */
  const placeNote = p => { const tz=cityInfo(p.city).tz, o=openNow(p.hours, tz); return o===null ? '' : o ? ' · open now' : ' · opens '+fmtHour(p.hours[0]); };
  const routeRow = r => ({ kind:'route', def:r, title:r.label, sub:r.city+' · '+r.cardSub, name:r.label, extra:r.id+' '+r.city+' '+cityInfo(r.city).country, color:r.accent });
  const placeRow = p => ({ kind:'place', def:p, title:p.name, sub:p.city+placeNote(p), name:p.name, extra:p.id+' '+p.city+' '+cityInfo(p.city).country, color:p.accent });
  const cityRow = c => { const C=cityInfo(c); return { kind:'city', city:c, title:c, sub:[C.country, plural(cityItems(c).length,'item')].filter(Boolean).join(' · '), name:c, extra:C.country, flag:C.flag, color:C.color }; };
  const verbRow = (v,title,sub,extra='') => ({ kind:'verb', verb:v, title, sub, name:v+' '+title, extra });
  const addressRow = a => ({ kind:'address', def:a, title:a.name, sub:a.sub });
  const stopRow = () => running()
    ? { kind:'stop', title:'Stop', sub:'Stop what’s running and put the phone back on real GPS', name:'stop', extra:'clear' }
    : { kind:'stop', off:true, title:'Stop', sub:'Nothing is running', name:'stop', extra:'clear' };
  const verbRows = () => [verbRow('go','Go to an address','Zoom in on it, then choose exactly where the waypoint goes','address waypoint street find'), verbRow('play','Play a route','Pick a route, then how to play it'), verbRow('pin','Pin a place','Hold the phone at a saved place'), verbRow('open','Open a city','Show a city and its routes')];

  function search(pool, q){
    const tokens=norm(q).split(' ').filter(Boolean);
    if(!tokens.length) return pool;
    return pool.map((r,i)=>({ r, i, s:score(tokens, r.name, r.extra) })).filter(x=>x.s>0).sort((a,b)=>b.s-a.s || a.i-b.i).map(x=>x.r);
  }
  // inside a city, its own routes and places come first
  const here = (a, c) => openCity ? [...a.filter(x=>c(x)===openCity), ...a.filter(x=>c(x)!==openCity)] : a;
  const engineList = () => availableEngines();
  const needEngine = () => action==='play' && target && !engine && engineList().length>1;
  function step(){
    if(!action) return 'search';
    if(!target) return 'target';
    return needEngine() ? 'engine' : 'confirm';
  }
  function chosenEngine(){
    const ids=engineList().map(e=>e.id);
    return ids.includes(engine) ? engine : ids[0];
  }
  function engineRow(e){
    return { kind:'engine', id:e.id, title:e.label, sub:e.real_speed ? 'Real speed, Life360 shows mph and the car icon' : 'Position only, Life360 shows 0 mph', name:e.label, extra:e.id };
  }
  function confirmRow(){
    const d=target.def;
    if(action==='play'){
      const e=engineList().find(x=>x.id===chosenEngine());
      return { kind:'confirm', title:'Play '+d.label, sub:[d.city, d.cardSub.replace(/ · (drive|walk)$/,''), e?'via '+e.label:''].filter(Boolean).join(' · '), color:d.accent };
    }
    return { kind:'confirm', title:'Hold at '+d.name, sub:'Stays there until you stop it · '+d.city, color:d.accent };
  }
  function buildRows(){
    const q=input.value, s=step();
    if(s==='confirm') return [confirmRow()];
    if(s==='engine') return search(engineList().map(engineRow), q);
    if(s==='target'){
      if(action==='go') return addr.rows;
      if(action==='play') return search(here(ROUTES,r=>r.city).map(routeRow), q);
      if(action==='pin') return search(here(PLACES,p=>p.city).map(placeRow), q);
      return search(cityNames().map(cityRow), q);
    }
    if(!norm(q)) return running() ? [stopRow(), ...verbRows()] : verbRows();
    const all=[stopRow(), ...verbRows(), ...cityNames().map(cityRow), ...PLACES.map(placeRow), ...ROUTES.map(routeRow)];
    // whatever's typed might be an address, so a search is never a dead end
    return [...search(all, q).slice(0,MAX_RESULTS), { kind:'find', title:'Find “'+q.trim()+'” as an address', sub:'Look it up and zoom in on the map' }];
  }

  /* ---- drawing ---- */
  function chip(label, level){
    return '<span class="pal-chip">'+esc(label)+'<button data-drop="'+level+'" aria-label="Remove '+esc(label)+'" tabindex="-1">'+icon('x',12)+'</button></span>';
  }
  function drawChips(){
    let h='';
    if(action) h+=chip(CHIP[action],'action');
    if(target) h+=chip(target.def ? (target.def.label||target.def.name) : target.city,'target');
    if(engine && engineList().length>1){ const e=engineList().find(x=>x.id===engine); if(e) h+=chip(e.label,'engine'); }
    chips.innerHTML=h;
  }
  function rowIcon(r){
    if(r.kind==='city') return '<span class="fl">'+r.flag+'</span>';
    const name={ route:'route', place:'map-pin', address:'map-pin', find:'search', stop:'square', engine:'gauge', verb:r.verb==='go'?'navigation':r.verb==='play'?'play':r.verb==='pin'?'map-pin':'map', confirm:action==='play'?'play':'map-pin' }[r.kind];
    return icon(name,15);
  }
  function emptyText(){
    const q=input.value.trim();
    if(action!=='go') return 'Nothing matches “'+q+'”';
    if(addr.state==='busy') return 'Searching…';
    if(addr.state==='error') return 'Address search isn’t reachable right now';
    return q.length<ADDRESS_MIN ? 'Street, city, or the name of a place' : 'No address found for “'+q+'”';
  }
  function drawList(){
    if(!rows.length){
      list.innerHTML='<div class="pal-empty">'+esc(emptyText())+'</div>';
      return;
    }
    list.innerHTML=rows.map((r,i)=>'<button class="pal-row'+(i===at?' on':'')+(r.off?' off':'')+'" role="option" id="pal-r'+i+'" aria-selected="'+(i===at)+'" data-i="'+i+'" tabindex="-1"'+(r.color?' style="--t:'+esc(r.color)+'"':'')+'>'
      +'<span class="pi">'+rowIcon(r)+'</span><span class="tx"><span class="nm">'+esc(r.title)+'</span><span class="sb">'+esc(r.sub)+'</span></span>'
      +(r.kind==='route'||r.kind==='place'||r.kind==='city'?'<span class="kd">'+r.kind+'</span>':'')+'</button>').join('');
    input.setAttribute('aria-activedescendant','pal-r'+at);
    list.querySelector('.on')?.scrollIntoView({ block:'nearest' });
  }
  function blocker(){
    if(!STATUS || !STATUS.devices.length) return 'No phone connected';
    if(STATUS.busy) return 'Waiting for the phone: '+STATUS.busy;
    return '';
  }
  function drawFoot(){
    const s=step();
    input.readOnly = s==='confirm';
    input.placeholder = s==='search' ? 'Search places, routes and cities' : s==='target' ? WANT[action] : s==='engine' ? 'How should it play?' : '';
    note.classList.remove('warn');
    if(s==='confirm'){
      const b=blocker();
      note.textContent = b || (running() ? 'Replaces what’s running now' : 'This moves your phone’s location');
      note.classList.toggle('warn', !!b || running());
      keys.innerHTML = b ? '<span class="dim">Can’t run yet</span>' : '<kbd>↵</kbd> '+(action==='play'?'Play route':'Set location');
    } else {
      const n=rows.filter(r=>r.kind!=='find').length;
      note.textContent = s==='search' && !norm(input.value) ? 'Or type go, play, pin, open or stop' : action==='go' && addr.state==='busy' ? 'Searching…' : n ? (s==='search' && n===MAX_RESULTS ? 'Top '+MAX_RESULTS+' results' : plural(n,'result')) : '';
      keys.innerHTML = '<kbd>↑↓</kbd> Move <kbd>↵</kbd> Select <kbd>esc</kbd> Close';
    }
  }
  function draw(keepAt){
    rows=buildRows();
    if(!keepAt) at=0;
    if(step()==='engine' && !input.value){ const i=rows.findIndex(r=>r.id===selEngine()); if(i>=0) at=i; }
    if(at>=rows.length) at=Math.max(0, rows.length-1);
    drawChips(); drawList(); drawFoot();
    sig=stateSig();
  }
  const stateSig = () => [running(), STATUS?.busy, STATUS?.devices?.length, engineList().length].join('|');

  /* ---- actions ---- */
  function moved(){ input.value=''; forgetAddress(); stepAt=performance.now(); draw(); input.focus(); }
  function forgetAddress(){ clearTimeout(addrTimer); addrSeq++; addr={ q:'', rows:[], state:'idle' }; }
  function lookup(){
    const q=input.value.trim().replace(/^to\s+/i,'');   // "go to ..." is typed one key at a time, past the chip
    if(q===addr.q && addr.state!=='error') return;
    const shownRows=addr.rows;
    forgetAddress();
    addr.q=q;
    if(q.length<ADDRESS_MIN) return;
    addr.rows=shownRows;   // keep the old list up while looking, so it doesn't blink on every key
    addr.state='busy';
    const id=addrSeq;
    addrTimer=setTimeout(async()=>{
      let found=[], state='error';
      try{ found=await api('/api/geocode?q='+encodeURIComponent(q)); state='done'; }catch(e){}
      if(id!==addrSeq) return;   // they kept typing, this answer is for an old query
      addr={ q, rows:found.map(addressRow), state };
      if(shown) draw();
    }, ADDRESS_WAIT_MS);
  }
  function pick(r){
    if(!r || r.off) return;
    if(r.kind==='stop'){ close(); stopAll(); return; }
    if(r.kind==='city'){ close(); openCityPage(r.city); return; }
    if(r.kind==='verb'){ action=r.verb; moved(); return; }
    if(r.kind==='find'){ const q=input.value; action='go'; moved(); input.value=q; lookup(); draw(); return; }
    if(r.kind==='address'){ close(); flyToAddress(r.def); return; }
    if(r.kind==='route'){ action='play'; target={ def:r.def }; moved(); return; }
    if(r.kind==='place'){ action='pin'; target={ def:r.def }; moved(); return; }
    if(r.kind==='engine'){ engine=r.id; moved(); return; }
    if(r.kind==='confirm') run();
  }
  function run(){
    if(blocker() || performance.now()-stepAt<CONFIRM_GUARD_MS) return;
    const def=target.def, act=action, eng=chosenEngine();
    close();
    if(openCity!==def.city) openCityPage(def.city);
    if(act==='play'){
      // the panel's speed box isn't part of this command, so it can't quietly change it
      engineChoice=eng; $('mph').value='';
      selectItem({ type:'route', def });
      send('play '+def.id+' --'+eng, '/api/play', { route:def.id, engine:eng, mph:null });
    } else {
      selectItem({ type:'place', def });
      setPlace(def);
    }
  }
  function drop(level){
    if(level==='action'){ action=null; target=null; engine=null; }
    else if(level==='target'){ target=null; engine=null; }
    else engine=null;
    moved();
  }
  function back(){
    if(engine && engineList().length>1) drop('engine');
    else if(target) drop('target');
    else if(action) drop('action');
  }

  /* ---- open / close ---- */
  function canOpen(){
    return !keyOpen && $('boot').classList.contains('gone') && $('link').hidden && (ROUTES.length>0 || PLACES.length>0);
  }
  function open(){
    if(shown || !canOpen()) return;
    shown=true; action=null; target=null; engine=null; input.value='';
    backTo=document.activeElement;
    root.hidden=false;
    draw(); input.focus();
    // the phone can come and go while this is up; a key or connect screen taking over closes it
    timer=setInterval(()=>{ if(!canOpen()) close(); else if(stateSig()!==sig) draw(true); }, 500);
  }
  function close(){
    if(!shown) return;
    shown=false; clearInterval(timer); forgetAddress();
    root.hidden=true;
    if(backTo && backTo!==document.body && backTo.isConnected) backTo.focus();
    backTo=null;
  }

  /* ---- input ---- */
  input.addEventListener('input', ()=>{
    if(!action){
      const m=input.value.match(/^\s*(\S+)\s+(.*)$/);
      const v=m && VERBS[m[1].toLowerCase()];
      if(v){ action=v; input.value=m[2]; stepAt=performance.now(); }
    }
    if(action==='go') lookup();
    draw();
  });
  input.addEventListener('keydown', e=>{
    if(e.key==='ArrowDown' || e.key==='ArrowUp'){
      e.preventDefault();
      if(rows.length){ at=(at+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length; drawList(); }
    } else if(e.key==='Enter'){
      e.preventDefault();
      // the list is still for what was typed before; Enter shouldn't fly off to that
      if(!e.repeat && !e.isComposing && !(action==='go' && addr.state==='busy')) pick(rows[at]);
    } else if(e.key==='Tab'){
      e.preventDefault();   // moves to the next chip, never out of the palette, and can't run anything
      if(rows[at]?.kind!=='confirm' && rows[at]?.kind!=='address') pick(rows[at]);
    } else if(e.key==='Backspace' && !input.value){
      e.preventDefault(); back();
    }
  });
  list.addEventListener('mousedown', e=>e.preventDefault());   // keep the caret in the input
  list.addEventListener('mousemove', e=>{
    const b=e.target.closest('.pal-row');
    if(!b || +b.dataset.i===at) return;
    at=+b.dataset.i;
    list.querySelectorAll('.pal-row').forEach((x,i)=>{ x.classList.toggle('on', i===at); x.setAttribute('aria-selected', i===at); });
    input.setAttribute('aria-activedescendant','pal-r'+at);
  });
  list.addEventListener('click', e=>{ const b=e.target.closest('.pal-row'); if(b) pick(rows[+b.dataset.i]); });
  chips.addEventListener('mousedown', e=>e.preventDefault());
  chips.addEventListener('click', e=>{ const b=e.target.closest('[data-drop]'); if(b) drop(b.dataset.drop); });
  // on click, not mousedown: closing early would let the mouseup land on the map underneath
  root.addEventListener('click', e=>{ if(e.target===root) close(); });
  // capture: esc here closes the palette and must never reach the app's "esc stops the spoof" handler
  document.addEventListener('keydown', e=>{
    if((e.metaKey||e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase()==='k'){
      e.preventDefault(); e.stopPropagation();
      shown ? close() : open();
      return;
    }
    if(!shown) return;
    if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if(document.activeElement!==input) input.focus();
  }, true);

  return { open, close };
})();
