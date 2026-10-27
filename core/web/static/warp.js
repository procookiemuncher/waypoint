// the "you're in" moment: once the phone passes every check on first boot, the connect screen
// gives way to a burst of rainbow rings before the app shows. plain WebGL on one fullscreen
// triangle, no three.js. Warp.prep() compiles it ahead of time (do it while something else is on
// screen, the compile hitches), Warp.in() resolves once it covers the screen, Warp.out() fades it.
// reduced motion or no WebGL: all no-ops and the app just shows as before.
// on top of the rings sits the brand: the app icon's mark, then "Waypoint" letter by letter.
const Warp = (() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FADE = 500;
  const HOLD = 2400;   // how long the brand stays after the rings cover the screen

  // the Dock icon (mac-version/app/icon.svg), minus its grid lines, which turn to mush this small
  const MARK = `<svg viewBox="100 100 824 824" aria-hidden="true">
    <defs>
      <linearGradient id="wp-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#171a24"/><stop offset="1" stop-color="#08090d"/></linearGradient>
      <linearGradient id="wp-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b49aff"/><stop offset=".35" stop-color="#7a8cff"/><stop offset=".6" stop-color="#ff7ab8"/><stop offset="1" stop-color="#ffb37a"/></linearGradient>
      <linearGradient id="wp-mark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d4c4ff"/><stop offset="1" stop-color="#8f74e6"/></linearGradient>
    </defs>
    <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#wp-bg)"/>
    <rect x="112" y="112" width="800" height="800" rx="176" fill="none" stroke="url(#wp-rim)" stroke-width="20" opacity=".9"/>
    <circle cx="512" cy="512" r="250" fill="none" stroke="#b49aff" stroke-width="6" opacity=".25"/>
    <path class="arrow" d="M512 262 L692 742 L512 628 L332 742 Z" fill="url(#wp-mark)"/>
  </svg>`;

  function brand(){
    const b = document.createElement('div');
    b.className = 'brand';
    const word = [...'Waypoint'].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('');
    b.innerHTML = `<div class="mark">${MARK}</div><div class="word" aria-label="Waypoint">${word}</div>`;
    return b;
  }

  const VERT = `
    attribute vec2 p;
    void main(){ gl_Position = vec4(p, 0.0, 1.0); }
  `;
  // concentric rings with a diagonal sawtooth through them, each colour channel a hair behind the last
  const FRAG = `
    precision highp float;
    uniform vec2 resolution;
    uniform float time;
    void main(void){
      vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
      float t = time * 0.05;
      float lineWidth = 0.002;
      vec3 color = vec3(0.0);
      for(int j = 0; j < 3; j++){
        for(int i = 0; i < 5; i++){
          color[j] += lineWidth * float(i*i) / abs(fract(t - 0.01*float(j) + float(i)*0.01)*5.0 - length(uv) + mod(uv.x + uv.y, 0.2));
        }
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  let el = null, gl = null, raf = 0, onResize = null, draw = null;

  function start(){
    el = document.createElement('div');
    el.id = 'warp';
    const cv = document.createElement('canvas');
    el.appendChild(cv);
    el.appendChild(brand());
    document.getElementById('frame').appendChild(el);
    document.fonts?.load('600 46px Inter');   // so the word doesn't swap fonts mid-reveal
    gl = cv.getContext('webgl', { antialias: false, alpha: false });
    if(!gl){ el.remove(); el = null; return false; }

    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){ stop(); return false; }
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'resolution'), uTime = gl.getUniformLocation(prog, 'time');

    onResize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.round(el.clientWidth * dpr); cv.height = Math.round(el.clientHeight * dpr);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(uRes, cv.width, cv.height);
    };
    onResize();
    addEventListener('resize', onResize);

    // the original stepped time by 0.05 a frame, so 3/s at 60 fps, kept frame-rate independent here
    let t0 = 0;
    draw = now => {
      if(!t0) t0 = now;
      gl.uniform1f(uTime, 1 + (now - t0) / 1000 * 3);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(draw);
    };
    gl.uniform1f(uTime, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);   // one hidden draw so the driver finishes the pipeline now
    return true;
  }

  function stop(){
    cancelAnimationFrame(raf); raf = 0;
    if(onResize) removeEventListener('resize', onResize);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    el?.remove();
    el = gl = onResize = draw = null;
  }

  return {
    hold: RM ? 0 : HOLD,
    get active(){ return !!el; },
    prep(){ if(!RM && !el) start(); },
    in(){
      if(RM || raf || (!el && !start())) return Promise.resolve();
      raf = requestAnimationFrame(draw);
      return new Promise(res => {
        requestAnimationFrame(() => { el.classList.add('in'); setTimeout(res, FADE); });
      });
    },
    out(){
      if(!el) return Promise.resolve();
      el.classList.remove('in');
      el.classList.add('out');
      return new Promise(res => setTimeout(() => { stop(); res(); }, FADE + 300));
    },
  };
})();
