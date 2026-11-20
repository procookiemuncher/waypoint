/* The world view's globe. Country outlines come from Natural Earth 1:110m (core/tools/build_countries.py
   writes static/countries.json) and are drawn flat on a canvas in an orthographic projection done here,
   no d3. No texture, glow, grid or dots: a sphere, the land, and the countries that matter.
   It holds still until told to turn; turnTo/focus ease it round on a critically damped spring, so a
   new target mid-turn bends the motion instead of restarting it.

   Styles: 'silhouette' (land one tone), 'lit' (catalog countries a step lighter), 'outline' (borders only).
   Each catalog country can have its own colour (setPalette). tint decides when it shows: 'hover' (only the
   hovered/open country), 'muted' (every country dimly, the hovered one full) or 'full' (all, all the time).
   Countries too small for 1:110m (the file's "dots") are drawn as a dot at each of their places.
   Single-line strings only: the release build minifies this with rjsmin. */
(function(){
'use strict';
const RAD = Math.PI/180;
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const STYLES = {
  silhouette: { sphere:'#17171b', land:'#2b2b32', dot:'#55555f' },
  lit:        { sphere:'#17171b', land:'#26262c', lit:'#45454f', dot:'#6a6a76' },
  outline:    { border:'rgba(255,255,255,.17)', edge:'rgba(255,255,255,.3)', dot:'rgba(255,255,255,.5)' },
};
const unit = (lon, lat) => { const a=lat*RAD, o=lon*RAD, c=Math.cos(a); return [c*Math.cos(o), c*Math.sin(o), Math.sin(a)]; };
const wrap = d => ((d+540)%360)-180;
const rgb = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16));
// a over b by t, both #rrggbb
const mix = (a, b, t) => { const p=rgb(a), q=rgb(b); return 'rgb('+p.map((v,i)=>Math.round(q[i]+(v-q[i])*t)).join(',')+')'; };

class Globe {
  constructor(canvas, shapes, opts={}){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.setStyle(opts.style || 'lit');
    this.countries = shapes.countries.map(c => ({ name:c.name || null, flat:c.rings, rings:c.rings.map(r => {
      const n=r.length/2, v=new Float32Array(n*3), seam=new Uint8Array(n);
      for(let i=0;i<n;i++){ const p=unit(r[2*i], r[2*i+1]); v[3*i]=p[0]; v[3*i+1]=p[1]; v[3*i+2]=p[2]; seam[i]=Math.abs(r[2*i])===180; }
      return { v, seam, n };
    }) }));
    this.named = new Map(this.countries.filter(c=>c.name).map(c=>[c.name, c]));
    this.dotNames = new Set(shapes.dots || []);
    this.places = [];
    this.lit = new Set();
    this.hi = null;
    this.palette = {};
    this.tint = opts.tint || 'hover';
    // view centre (degrees), zoom, their targets and spring velocities
    this.lon = this.tlon = opts.lon ?? -30; this.lat = this.tlat = opts.lat ?? 25; this.k = this.tk = 1;
    this.vlon = this.vlat = this.vk = 0;
    this.raf = 0;
    this.step = this.step.bind(this);
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointermove', e => this.pointer(e, false));
    canvas.addEventListener('pointerleave', () => { if(this.under){ this.under=null; this.cv.style.cursor=''; this.opts.onHover?.(null); } });
    canvas.addEventListener('click', e => this.pointer(e, true));
    this.resize();
  }
  setStyle(s){ this.style=s; this.c=Object.assign({ hi:'#b49aff', pin:'#0d0d10' }, STYLES[s], this.opts.colors); this.draw(); }
  // places: [{ country, lat, lon }], the cities; dots and turn targets come from these
  setPlaces(list){ this.places=list; this.draw(); }
  setLit(names){ this.lit=new Set(names); this.draw(); }
  // name -> #rrggbb. Countries without one fall back to the style's accent
  setPalette(map){ this.palette=map || {}; this.draw(); }
  setTint(t){ this.tint=t; this.draw(); }
  colorOf(name){ return this.palette[name] || this.c.hi; }
  // what a country that isn't hovered looks like under the current tint; null = just land
  restColor(name){
    if(this.tint==='hover' || !this.palette[name]) return null;
    return this.tint==='full' ? this.palette[name] : mix(this.palette[name], this.c.land || '#2b2b32', .38);
  }
  highlight(name){ if(this.hi!==name){ this.hi=name; this.draw(); } }
  focus(name, k){ this.highlight(name); const t=this.target(name); if(t) this.turnTo(t[0], t[1], k); }
  // the middle of a country's places, averaged as vectors so it can't land on the wrong side of 180
  target(name){
    const ps=this.places.filter(p=>p.country===name);
    if(!ps.length) return null;
    const s=ps.map(p=>unit(p.lon,p.lat)).reduce((a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]]);
    return [Math.atan2(s[1],s[0])/RAD, Math.atan2(s[2],Math.hypot(s[0],s[1]))/RAD];
  }
  turnTo(lon, lat, k){
    this.tlon=lon; this.tlat=Math.max(-35, Math.min(50, lat)); if(k) this.tk=k;
    if(RM.matches){ this.lon=this.tlon; this.lat=this.tlat; this.k=this.tk; this.vlon=this.vlat=this.vk=0; this.draw(); return; }
    if(!this.raf){ this.t0=performance.now(); this.raf=requestAnimationFrame(this.step); }
  }
  zoomTo(k){ this.turnTo(this.tlon, this.tlat, k); }
  step(t){
    const dt=Math.min(.034, (t-this.t0)/1000), w=this.opts.stiffness || 9;
    this.t0=t;
    const dl=wrap(this.tlon-this.lon), da=this.tlat-this.lat, dk=this.tk-this.k;
    this.vlon += (w*w*dl - 2*w*this.vlon)*dt; this.lon = wrap(this.lon + this.vlon*dt);
    this.vlat += (w*w*da - 2*w*this.vlat)*dt; this.lat += this.vlat*dt;
    this.vk += (w*w*dk - 2*w*this.vk)*dt; this.k += this.vk*dt;
    if(Math.abs(dl)<.01 && Math.abs(da)<.01 && Math.abs(dk)<.0005 && Math.abs(this.vlon)+Math.abs(this.vlat)<.05){
      this.lon=this.tlon; this.lat=this.tlat; this.k=this.tk; this.vlon=this.vlat=this.vk=0; this.raf=0; this.draw(); return;
    }
    this.draw();
    this.raf=requestAnimationFrame(this.step);
  }
  resize(){
    const r=this.cv.getBoundingClientRect(), d=devicePixelRatio || 1;
    this.w=r.width; this.h=r.height;
    this.cv.width=Math.round(r.width*d); this.cv.height=Math.round(r.height*d);
    this.ctx.setTransform(d,0,0,d,0,0);
    this.draw();
  }
  radius(){ return Math.min(this.w, this.h)/2*(this.opts.fill || .86)*this.k; }
  // screen basis for the current view: east, north, and the direction we look along
  basis(){
    const o=this.lon*RAD, a=this.lat*RAD, so=Math.sin(o), co=Math.cos(o), sa=Math.sin(a), ca=Math.cos(a);
    return { e:[-so, co, 0], n:[-sa*co, -sa*so, ca], v:[ca*co, ca*so, sa] };
  }
  // one ring into the current path. Points behind the globe are pushed out to its edge, which fills
  // correctly as long as a country doesn't wrap round the far pole (none of these do at our tilts)
  trace(ring, B, cx, cy, R){
    const { v:P, n } = ring, e=B.e, N=B.n, V=B.v, ctx=this.ctx;
    let any=false;
    for(let i=0;i<n;i++) if(P[3*i]*V[0]+P[3*i+1]*V[1]+P[3*i+2]*V[2] > 0){ any=true; break; }
    if(!any) return;
    for(let i=0;i<n;i++){
      const x0=P[3*i], y0=P[3*i+1], z0=P[3*i+2];
      let x=x0*e[0]+y0*e[1]+z0*e[2], y=x0*N[0]+y0*N[1]+z0*N[2];
      if(x0*V[0]+y0*V[1]+z0*V[2] < 0){ const l=Math.hypot(x,y) || 1; x/=l; y/=l; }
      i ? ctx.lineTo(cx+R*x, cy-R*y) : ctx.moveTo(cx+R*x, cy-R*y);
    }
    ctx.closePath();
  }
  // borders: only the visible edges, never the stretch pushed onto the rim or the cut along 180
  stroke(ring, B, cx, cy, R){
    const { v:P, n, seam } = ring, e=B.e, N=B.n, V=B.v, ctx=this.ctx;
    let down=false, px=0, py=0, pv=false;
    for(let i=0;i<n;i++){
      const x0=P[3*i], y0=P[3*i+1], z0=P[3*i+2], vis=x0*V[0]+y0*V[1]+z0*V[2] > 0;
      const x=cx+R*(x0*e[0]+y0*e[1]+z0*e[2]), y=cy-R*(x0*N[0]+y0*N[1]+z0*N[2]);
      if(i && vis && pv && !(seam[i] && seam[i-1])){ if(!down){ ctx.moveTo(px,py); down=true; } ctx.lineTo(x,y); } else down=false;
      px=x; py=y; pv=vis;
    }
  }
  fill(list, color, B, cx, cy, R){
    if(!list.length || !color) return;
    const ctx=this.ctx;
    ctx.beginPath();
    for(const c of list) for(const r of c.rings) this.trace(r, B, cx, cy, R);
    ctx.fillStyle=color; ctx.fill('nonzero');
  }
  project(lon, lat, B, cx, cy, R){
    const p=unit(lon,lat);
    if(p[0]*B.v[0]+p[1]*B.v[1]+p[2]*B.v[2] <= .05) return null;
    return [cx+R*(p[0]*B.e[0]+p[1]*B.e[1]+p[2]*B.e[2]), cy-R*(p[0]*B.n[0]+p[1]*B.n[1]+p[2]*B.n[2])];
  }
  draw(){
    if(!this.w || !this.countries) return;
    const ctx=this.ctx, C=this.c, cx=this.w/2, cy=this.h/2, R=this.radius(), B=this.basis(), TAU=Math.PI*2;
    ctx.clearRect(0,0,this.w,this.h);
    if(C.sphere){ ctx.beginPath(); ctx.arc(cx,cy,R,0,TAU); ctx.fillStyle=C.sphere; ctx.fill(); }
    this.fill(this.countries, C.land, B, cx, cy, R);
    if(this.style==='lit') this.fill([...this.lit].filter(n=>n!==this.hi && this.named.has(n)).map(n=>this.named.get(n)), C.lit, B, cx, cy, R);
    if(this.tint!=='hover') for(const n of this.lit) if(n!==this.hi && this.named.has(n)){ const col=this.restColor(n); if(col) this.fill([this.named.get(n)], col, B, cx, cy, R); }
    if(C.border){
      ctx.beginPath();
      for(const c of this.countries) for(const r of c.rings) this.stroke(r, B, cx, cy, R);
      ctx.lineWidth=1; ctx.lineJoin='round'; ctx.strokeStyle=C.border; ctx.stroke();
    }
    if(this.hi && this.named.has(this.hi)) this.fill([this.named.get(this.hi)], this.colorOf(this.hi), B, cx, cy, R);
    if(C.edge){ ctx.beginPath(); ctx.arc(cx,cy,R-.5,0,TAU); ctx.lineWidth=1; ctx.strokeStyle=C.edge; ctx.stroke(); }
    // tiny countries: a dot per place. The hovered country's places: small dots in the ground colour
    for(const p of this.places){
      const dot=this.dotNames.has(p.country), on=p.country===this.hi;
      if(!dot && !on) continue;
      const q=this.project(p.lon, p.lat, B, cx, cy, R);
      if(!q) continue;
      ctx.beginPath();
      if(dot){ ctx.arc(q[0], q[1], on ? 5 : 3.5, 0, TAU); ctx.fillStyle=on ? this.colorOf(p.country) : (this.restColor(p.country) || C.dot); ctx.fill(); }
      else { ctx.arc(q[0], q[1], 2.5, 0, TAU); ctx.fillStyle=C.pin; ctx.fill(); }
    }
  }
  // what's under the pointer: a catalog country (by shape) or a dot country (within 10px of its dot)
  pick(px, py){
    const cx=this.w/2, cy=this.h/2, R=this.radius(), B=this.basis();
    for(const p of this.places){
      if(!this.dotNames.has(p.country)) continue;
      const q=this.project(p.lon, p.lat, B, cx, cy, R);
      if(q && Math.hypot(q[0]-px, q[1]-py) < 10) return p.country;
    }
    const x=(px-cx)/R, y=-(py-cy)/R, s=x*x+y*y;
    if(s>=1) return null;
    const z=Math.sqrt(1-s), e=B.e, n=B.n, v=B.v;
    const X=x*e[0]+y*n[0]+z*v[0], Y=x*e[1]+y*n[1]+z*v[1], Z=x*e[2]+y*n[2]+z*v[2];
    const lon=Math.atan2(Y,X)/RAD, lat=Math.asin(Math.max(-1,Math.min(1,Z)))/RAD;
    for(const [name, c] of this.named){
      let inside=false;
      for(const r of c.flat) for(let i=0, j=r.length-2; i<r.length; j=i, i+=2){
        const xi=r[i], yi=r[i+1], xj=r[j], yj=r[j+1];
        if((yi>lat)!==(yj>lat) && lon < (xj-xi)*(lat-yi)/(yj-yi)+xi) inside=!inside;
      }
      if(inside) return name;
    }
    return null;
  }
  pointer(e, click){
    const r=this.cv.getBoundingClientRect(), name=this.pick(e.clientX-r.left, e.clientY-r.top);
    const hit=name && (this.lit.has(name) || this.dotNames.has(name)) ? name : null;
    this.cv.style.cursor=hit ? 'pointer' : '';
    if(click){ if(hit) this.opts.onClick?.(hit); return; }
    if(hit!==this.under){ this.under=hit; this.opts.onHover?.(hit); }
  }
}
window.Globe = Globe;
})();
