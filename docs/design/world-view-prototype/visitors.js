/* Visitors: every once in a while something that isn't a star goes past the globe. An easter egg, so it
   stays rare, small and in the globe's own quiet colours, never more than one at a time.

   Four kinds: a saucer that cruises in, hovers with its beam on, jinks and zips off; a saucer that does a
   lap of the globe (behind it, then in front); a small alien tumbling through space, waving; and three
   lights in a triangle that drift and then go out one by one. Anything "behind" the globe is clipped by
   its disc, so the globe really is in the way.

   Its own canvas on top of the globe's with pointer-events off; the page passes clicks in through hit(),
   and anything clicked runs for it. Draws only while a visitor is out, nothing between visits. With
   reduced motion they never come on their own (summon still works, that's asked for).
   Single-line strings only: the release build minifies this with rjsmin. */
(function(){
'use strict';
const TAU = Math.PI*2;
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const rnd = (a, b) => a+Math.random()*(b-a);
const pick = a => a[Math.floor(Math.random()*a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const outCubic = p => 1-Math.pow(1-p, 3), inCubic = p => p*p*p, inOut = p => p<.5 ? 4*p*p*p : 1-Math.pow(-2*p+2, 3)/2;
const KINDS = ['flyby', 'orbit', 'alien', 'lights'];

// ---- the drawings, at the origin, about 30 units across at scale 1 ----
function saucer(ctx, t, beam){
  if(beam>0){
    ctx.fillStyle='#cdeaff';
    ctx.globalAlpha=beam*.13; ctx.beginPath(); ctx.moveTo(-4.5,4); ctx.lineTo(4.5,4); ctx.lineTo(14,38); ctx.lineTo(-14,38); ctx.closePath(); ctx.fill();
    ctx.globalAlpha=beam*.09; ctx.beginPath(); ctx.ellipse(0,38,14,3.2,0,0,TAU); ctx.fill();
    ctx.globalAlpha=1;
  }
  // glass dome, with a glint
  ctx.fillStyle='rgba(160,215,255,.55)'; ctx.beginPath(); ctx.ellipse(0,-2,6.6,6.2,0,Math.PI,0); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.6)'; ctx.beginPath(); ctx.ellipse(-2.6,-5.4,1.5,.9,-.5,0,TAU); ctx.fill();
  // hull: dark underside, lighter top
  ctx.fillStyle='#575c68'; ctx.beginPath(); ctx.ellipse(0,.8,15,4.6,0,0,TAU); ctx.fill();
  ctx.fillStyle='#a3a8b5'; ctx.beginPath(); ctx.ellipse(0,-.2,15,3.4,0,Math.PI,0); ctx.fill();
  ctx.fillStyle='#ffd88a'; ctx.globalAlpha=.55+.45*Math.sin(t*3); ctx.beginPath(); ctx.ellipse(0,4.6,3.2,1,0,0,TAU); ctx.fill();
  // lights round the rim, chasing
  for(let i=0;i<6;i++){
    const x=-11.5+i*4.6, a=.25+.75*Math.max(0, Math.cos(t*6-i*1.15));
    ctx.fillStyle=i%2 ? '#86e6ff' : '#ffcf70';
    ctx.globalAlpha=a*.25; ctx.beginPath(); ctx.arc(x,1.2,3,0,TAU); ctx.fill();
    ctx.globalAlpha=a; ctx.beginPath(); ctx.arc(x,1.2,1.05,0,TAU); ctx.fill();
  }
  ctx.globalAlpha=1;
}
function alien(ctx, t){
  const skin='#a9dcae', sw=Math.sin(t*2.2)*.35;
  ctx.strokeStyle=skin; ctx.fillStyle=skin; ctx.lineCap='round'; ctx.lineWidth=1.7;
  ctx.beginPath();
  ctx.moveTo(-1.4,6); ctx.lineTo(-3.4+sw*2,13.5);
  ctx.moveTo(1.4,6); ctx.lineTo(3.4-sw*2,13.5);
  ctx.moveTo(-2,1.2); ctx.lineTo(-6.2,6+sw*2);
  const a=-2.1+Math.sin(t*7)*.55;                  // the waving arm
  ctx.moveTo(2,1.2); ctx.lineTo(2+Math.cos(a)*6.5, 1.2+Math.sin(a)*6.5);
  ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0,3.2,2.7,4.3,0,0,TAU); ctx.fill();
  // the head, an upside-down egg
  ctx.beginPath(); ctx.moveTo(0,-1.2);
  ctx.bezierCurveTo(-4.6,-2.4,-7.4,-6.8,-7,-11); ctx.bezierCurveTo(-6.6,-16.6,6.6,-16.6,7,-11); ctx.bezierCurveTo(7.4,-6.8,4.6,-2.4,0,-1.2);
  ctx.fill();
  ctx.fillStyle='#0b0d12';
  ctx.beginPath(); ctx.ellipse(-3,-8.6,2.7,1.45,.45,0,TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(3,-8.6,2.7,1.45,-.45,0,TAU); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.75)';
  ctx.beginPath(); ctx.arc(-3.7,-9.1,.5,0,TAU); ctx.arc(2.3,-9.1,.5,0,TAU); ctx.fill();
}
function light(ctx, x, y, a){
  ctx.fillStyle='#ffd9a0';
  // a soft glow out of a few faint rings, so it has no hard edge
  for(const [r, k] of [[7,.04],[5,.06],[3.4,.1]]){ ctx.globalAlpha=a*k; ctx.beginPath(); ctx.arc(x,y,r,0,TAU); ctx.fill(); }
  ctx.globalAlpha=a; ctx.beginPath(); ctx.arc(x,y,1.7,0,TAU); ctx.fill();
  ctx.globalAlpha=1;
}

// ---- the visits. Each has step(dt, g) -> still going?, draw(ctx, g), hit(x, y) and flee() ----
// g is the globe's disc right now: { w, h, cx, cy, R, k }
class Flyby {
  constructor(g){
    const left=Math.random()<.5;
    this.p=[left ? -40 : g.w+40, g.h*rnd(.1,.4)];
    this.hover=[g.w*rnd(.2,.8), g.h*rnd(.14,.36)];
    this.jink=[this.hover[0]+pick([-1,1])*rnd(40,90), this.hover[1]+rnd(-30,30)];
    const a=rnd(-2.6,-.5);                          // leaves upward-ish, any side
    this.exit=[this.jink[0]+Math.cos(a)*2*Math.max(g.w,g.h), this.jink[1]+Math.sin(a)*2*Math.max(g.w,g.h)];
    this.legs=[[this.p, this.hover, 2.8, outCubic, 0], [this.hover, this.hover, 1.9, null, 1], [this.hover, this.jink, .22, inOut, 0],
      [this.jink, this.jink, .9, null, .4], [this.jink, this.exit, .75, inCubic, 0]];
    this.leg=0; this.lt=0; this.t=0; this.s=rnd(.9,1.15); this.trail=[]; this.alpha=0;
  }
  flee(){ if(this.leg<4){ const from=this.p.slice(); this.legs[4]=[from, [from[0]+rnd(-200,200), -400], .55, inCubic, 0]; this.leg=4; this.lt=0; } }
  step(dt){
    this.t+=dt; this.lt+=dt; this.alpha=Math.min(1, this.t/.5);
    let L=this.legs[this.leg];
    while(this.lt>=L[2]){ this.lt-=L[2]; if(++this.leg>=this.legs.length) return false; L=this.legs[this.leg]; }
    const [a, b, d, ease, beam]=L, q=ease ? ease(this.lt/d) : 0, prev=this.p;
    this.p=ease ? [a[0]+(b[0]-a[0])*q, a[1]+(b[1]-a[1])*q] : [a[0]+Math.sin(this.t*2.1)*2, a[1]+Math.sin(this.t*3.3)*1.5];
    this.v=[(this.p[0]-prev[0])/dt, (this.p[1]-prev[1])/dt];
    this.beam=beam ? beam*Math.sin(Math.PI*this.lt/d) : 0;
    this.trail.unshift(this.p); this.trail.length=Math.min(this.trail.length, 5);
    return true;
  }
  draw(ctx){
    const fast=Math.hypot(this.v[0], this.v[1])>900;
    // motion blur when it really goes: a few fading copies along the way it came
    if(fast) for(let i=this.trail.length-1;i>0;i--){ ctx.save(); ctx.globalAlpha=.12*(1-i/this.trail.length)*this.alpha; ctx.translate(...this.trail[i]); ctx.scale(this.s,this.s); ctx.fillStyle='#a3a8b5'; ctx.beginPath(); ctx.ellipse(0,0,15,4,0,0,TAU); ctx.fill(); ctx.restore(); }
    ctx.save(); ctx.globalAlpha=this.alpha; ctx.translate(...this.p);
    ctx.rotate(clamp(this.v[0]*.0007, -.3, .3)+Math.sin(this.t*4.5)*.04); ctx.scale(this.s, this.s);
    saucer(ctx, this.t, this.beam); ctx.restore();
  }
  hit(x, y){ return Math.hypot(x-this.p[0], y-this.p[1])<20*this.s; }
}
class Orbit {
  constructor(g){ this.th=rnd(0,TAU); this.dir=pick([-1,1]); this.t=0; this.d=10; this.tilt=rnd(-.35,-.15)*pick([-1,1]); }
  flee(){ this.out=this.out || { t:0, p:this.p.slice(), v:[this.p[0]-this.g.cx, this.p[1]-this.g.cy] }; }
  step(dt, g){
    this.g=g; this.t+=dt;
    if(this.out){ const o=this.out; o.t+=dt; const n=Math.hypot(...o.v) || 1, s=3000*o.t*o.t; this.p=[o.p[0]+o.v[0]/n*s, o.p[1]+o.v[1]/n*s]; this.behind=false; return o.t<.7; }
    const th=this.th+this.dir*TAU*this.t/this.d, r=g.R*1.2, x=r*Math.cos(th), y=r*.3*Math.sin(th);
    const c=Math.cos(this.tilt), s=Math.sin(this.tilt);
    this.p=[g.cx+x*c-y*s, g.cy+x*s+y*c];
    this.behind=Math.sin(th)<0;                     // the far half of the ellipse sits higher on screen
    this.sc=.85+.25*(Math.sin(th)+1)/2;
    this.alpha=Math.min(1, this.t/.8, (this.d-this.t)/.8);
    return this.t<this.d;
  }
  draw(ctx){ ctx.save(); ctx.globalAlpha=this.out ? 1 : this.alpha; ctx.translate(...this.p); ctx.rotate(this.tilt*.6); ctx.scale(this.sc, this.sc); saucer(ctx, this.t, 0); ctx.restore(); }
  hit(x, y){ return !this.behind && Math.hypot(x-this.p[0], y-this.p[1])<20*this.sc; }
}
class Alien {
  constructor(g){
    const left=Math.random()<.5;
    this.a=[left ? -30 : g.w+30, g.h*rnd(.15,.85)]; this.b=[left ? g.w+30 : -30, this.a[1]+rnd(-.25,.25)*g.h];
    this.d=rnd(18,24); this.t=0; this.spin=rnd(.35,.6)*pick([-1,1]); this.rot=rnd(0,TAU); this.s=rnd(.85,1.05);
    this.behind=Math.random()<.6;
  }
  flee(){ this.spin*=12; this.d=this.t+.9; this.b=[this.p[0]+rnd(-300,300), this.p[1]-500]; this.a=this.p.slice(); this.t0=this.t; }
  step(dt){
    this.t+=dt; this.rot+=this.spin*dt;
    const q=this.t0!==undefined ? inCubic((this.t-this.t0)/(this.d-this.t0)) : this.t/this.d;
    this.p=[this.a[0]+(this.b[0]-this.a[0])*q, this.a[1]+(this.b[1]-this.a[1])*q+Math.sin(this.t*.7)*10];
    return this.t<this.d;
  }
  draw(ctx){ ctx.save(); ctx.translate(...this.p); ctx.rotate(this.rot); ctx.scale(this.s, this.s); alien(ctx, this.t); ctx.restore(); }
  hit(x, y){ return !this.behind && Math.hypot(x-this.p[0], y-this.p[1])<18*this.s; }
}
class Lights {
  constructor(g){
    this.a=[g.w*rnd(.1,.35), g.h*rnd(.12,.3)]; this.b=[g.w*rnd(.6,.9), g.h*rnd(.1,.45)];
    if(Math.random()<.5) [this.a, this.b]=[this.b, this.a];
    this.d=rnd(14,18); this.t=0; this.behind=false;    // in front: the globe fills most of the view, behind it they would barely show
    this.order=[0,1,2].sort(() => Math.random()-.5);
    this.h=Math.atan2(this.b[1]-this.a[1], this.b[0]-this.a[0]);
  }
  flee(){ if(this.t<this.d-1.6) this.t=this.d-1.6; }
  step(dt){ this.t+=dt; const q=Math.min(1, this.t/this.d); this.p=[this.a[0]+(this.b[0]-this.a[0])*q, this.a[1]+(this.b[1]-this.a[1])*q]; return this.t<this.d; }
  draw(ctx){
    const c=Math.cos(this.h), s=Math.sin(this.h), pulse=.75+.25*Math.sin(this.t*1.6);
    const pts=[[14,0],[-8,-11],[-8,11]];             // a triangle, nose first
    pts.forEach((q, i) => {
      // they come on together and go out one at a time over the last 1.5s
      const off=this.d-1.5+this.order.indexOf(i)*.5, a=Math.min(1, this.t/1.2)*(this.t>off ? Math.max(0, 1-(this.t-off)/.12) : 1);
      if(a>0) light(ctx, this.p[0]+q[0]*c-q[1]*s, this.p[1]+q[0]*s+q[1]*c, a*pulse);
    });
  }
  hit(){ return false; }
}
const MAKE = { flyby:Flyby, orbit:Orbit, alien:Alien, lights:Lights };

class Visitors {
  constructor(canvas, globe, opts={}){
    this.cv=canvas; this.ctx=canvas.getContext('2d'); this.globe=globe; this.opts=opts;
    this.on=false; this.v=null; this.raf=0; this.timer=0; this.next=0;
    this.first=opts.first || [15, 30]; this.every=opts.every || [45, 120];
    this.loop=this.loop.bind(this);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  resize(){
    const r=this.cv.getBoundingClientRect(), d=devicePixelRatio || 1;
    this.w=r.width; this.h=r.height;
    this.cv.width=Math.round(r.width*d); this.cv.height=Math.round(r.height*d);
    this.ctx.setTransform(d,0,0,d,0,0);
  }
  enable(on){ this.on=on; clearTimeout(this.timer); if(on) this.wait(this.first); else this.end(); }
  wait([a, b]){ clearTimeout(this.timer); this.timer=setTimeout(() => this.auto(), rnd(a, b)*1000); }
  auto(){
    if(!this.on) return;
    if(RM.matches || document.hidden || this.v){ this.wait(this.every); return; }
    // a lap only reads when the whole globe is in view
    const kinds=this.globe.k>1.2 ? ['flyby','alien','lights'] : KINDS;
    this.start(pick(kinds));
  }
  // summon: the next kind in turn, so a few clicks show all of them
  summon(kind){ this.end(); this.start(kind || KINDS[this.next++ % KINDS.length]); }
  start(kind){
    this.v=new MAKE[kind](this.geom()); this.v.kind=kind;
    this.t0=0; if(!this.raf) this.raf=requestAnimationFrame(this.loop);
  }
  end(){ this.v=null; if(this.raf) cancelAnimationFrame(this.raf); this.raf=0; this.ctx.clearRect(0,0,this.w,this.h); }
  geom(){ const g=this.globe; return { w:this.w, h:this.h, cx:this.w/2, cy:this.h/2, R:g.radius(), k:g.k }; }
  loop(t){
    const dt=this.t0 ? Math.min(.05, (t-this.t0)/1000) : 1/60;
    this.t0=t;
    const g=this.geom(), ctx=this.ctx;
    ctx.clearRect(0,0,this.w,this.h);
    if(!this.v.step(dt, g)){ this.end(); if(this.on) this.wait(this.every); return; }
    ctx.save();
    if(this.v.behind){ ctx.beginPath(); ctx.rect(0,0,this.w,this.h); ctx.arc(g.cx, g.cy, g.R, 0, TAU); ctx.clip('evenodd'); }
    this.v.draw(ctx, g);
    ctx.restore();
    this.raf=requestAnimationFrame(this.loop);
  }
  // the page hands clicks in here (the canvas itself lets them through to the globe)
  hit(x, y){ return !!(this.v && this.v.p && this.v.hit(x, y)); }
  poke(x, y){ if(!this.hit(x, y)) return false; this.v.flee(); this.opts.onFlee?.(this.v.kind); return true; }
}
window.Visitors = Visitors;
})();
