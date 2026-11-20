/* The sky behind the globe: the real stars (Yale Bright Star Catalog to mag 6.5, static/stars.json from
   core/tools/build_stars.py), drawn on their own canvas under the globe's so the sphere hides whatever is
   behind it for free.

   The camera sits where the globe's view puts it and looks back past the Earth, so the stars behind the
   globe are the ones really there at this moment (RA turned by Greenwich sidereal time). follow decides
   how much of the globe's turn the sky takes: 1 is the true sky, which sweeps a long way on every turn;
   a small number lets it drift behind the globe, which reads as depth without pulling the eye.

   No twinkle: that's the atmosphere, and from out here there isn't one. Nothing animates on its own, the
   sky only redraws when the globe does (draw(lon, lat, k) from the globe's onView).
   Single-line strings only: the release build minifies this with rjsmin. */
(function(){
'use strict';
const RAD = Math.PI/180;

// kelvin -> rgb, the usual fit to the blackbody curve (Tanner Helland's), then pulled most of the way to
// white: real star colour is faint to the eye, a full-strength fit looks like Christmas lights
function tint(k, keep){
  const t=k/100;
  let r, g, b;
  if(t<=66){ r=255; g=99.47*Math.log(t)-161.12; b=t<=19 ? 0 : 138.52*Math.log(t-10)-305.04; }
  else { r=329.70*Math.pow(t-60,-.1332); g=288.12*Math.pow(t-60,-.0755); b=255; }
  return [r,g,b].map(v => Math.round(255+(Math.max(0,Math.min(255,v))-255)*keep));
}
// Greenwich mean sidereal time in degrees
function gmst(ms){ const d=ms/864e5+2440587.5-2451545; return ((280.46061837+360.98564736629*d)%360+360)%360; }

class Sky {
  constructor(canvas, data, opts={}){
    this.cv=canvas; this.ctx=canvas.getContext('2d');
    this.opts=opts;
    this.follow=opts.follow ?? .12;
    this.on=true;
    const s=data.stars, n=s.length/4;
    this.n=n;
    this.p=new Float32Array(n*3);          // unit vectors, equatorial (RA/Dec) frame
    this.size=new Float32Array(n);         // radius in css px
    this.alpha=new Float32Array(n);
    this.col=new Array(n);
    const gain=opts.gain ?? 1;
    for(let i=0;i<n;i++){
      const ra=s[4*i]*RAD, de=s[4*i+1]*RAD, m=s[4*i+2], c=Math.cos(de);
      this.p[3*i]=c*Math.cos(ra); this.p[3*i+1]=c*Math.sin(ra); this.p[3*i+2]=Math.sin(de);
      // perceived brightness is about linear in magnitude: mag 1 and brighter full, mag 6.5 a whisper
      const f=Math.max(0, Math.min(1, (6.6-m)/5.6));
      this.alpha[i]=Math.min(1, (.3+.7*Math.pow(f,1.3))*gain);
      this.size[i]=m<4.2 ? .6+1.1*Math.pow(Math.max(0,(4.2-m)/5.6),.9) : .45+.15*(6.6-m)/2.4;
      const [r,g,b]=tint(s[4*i+3]*100, opts.colour ?? .32);
      this.col[i]='rgb('+r+','+g+','+b+')';
    }
    // brightest last so they sit on top of the faint ones
    this.order=Array.from({length:n}, (_, i) => i).sort((a, b) => s[4*b+2]-s[4*a+2]);
    this.view=[opts.lon ?? 0, opts.lat ?? 0, 1];
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  setFollow(f){ this.follow=f; this.render(); }
  show(on){ this.on=on; this.render(); }
  resize(){
    const r=this.cv.getBoundingClientRect(), d=devicePixelRatio || 1;
    this.w=r.width; this.h=r.height; this.d=d;
    this.cv.width=Math.round(r.width*d); this.cv.height=Math.round(r.height*d);
    this.ctx.setTransform(d,0,0,d,0,0);
    this.render();
  }
  draw(lon, lat, k){ this.view=[lon, lat, k]; this.render(); }
  render(){
    const ctx=this.ctx, w=this.w, h=this.h;
    if(!w) return;
    ctx.clearRect(0,0,w,h);
    if(!this.on) return;
    const [lon, lat, k]=this.view, f=this.follow;
    // camera direction in the equatorial frame: the view's longitude turned by sidereal time
    const o=(gmst(Date.now())+f*lon+(1-f)*(this.opts.lon ?? 0))*RAD, a=f*lat*RAD;
    const so=Math.sin(o), co=Math.cos(o), sa=Math.sin(a), ca=Math.cos(a);
    const E=[-so,co,0], N=[-sa*co,-sa*so,ca], V=[ca*co,ca*so,sa];
    // gnomonic (a real lens): about 39 degrees either side across the wider edge, a touch tighter as the globe zooms
    const F=Math.max(w,h)*.62*Math.pow(k,.35), cx=w/2, cy=h/2, P=this.p, px=1/this.d;
    for(const i of this.order){
      const x0=P[3*i], y0=P[3*i+1], z0=P[3*i+2];
      const z=-(x0*V[0]+y0*V[1]+z0*V[2]);
      if(z<.2) continue;
      const x=cx+F*(x0*E[0]+y0*E[1]+z0*E[2])/z, y=cy-F*(x0*N[0]+y0*N[1]+z0*N[2])/z;
      const r=this.size[i];
      if(x<-4 || y<-4 || x>w+4 || y>h+4) continue;
      ctx.fillStyle=this.col[i];
      if(r<.6){
        // faint stars: a pinprick about a device pixel across, brightness carried by alpha
        ctx.globalAlpha=this.alpha[i];
        ctx.beginPath(); ctx.arc(x, y, Math.max(r, px*.6), 0, Math.PI*2); ctx.fill();
      } else {
        // the bright few get a soft halo, the way a lens spreads a point of light
        ctx.globalAlpha=this.alpha[i]*.09;
        ctx.beginPath(); ctx.arc(x, y, r*3.2, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha=this.alpha[i];
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.globalAlpha=1;
  }
}
window.Sky = Sky;
})();
