// the "you're in" moment: once the phone passes every check on first boot, the connect screen
// gives way to a burst of rainbow rings before the app shows. plain WebGL on one fullscreen
// triangle, no three.js. Warp.in() resolves once it covers the screen, Warp.out() fades it away.
// reduced motion or no WebGL: both are no-ops and the app just shows as before.
const Warp = (() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FADE = 500;

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

  let el = null, gl = null, raf = 0, onResize = null;

  function start(){
    el = document.createElement('div');
    el.id = 'warp';
    const cv = document.createElement('canvas');
    el.appendChild(cv);
    document.getElementById('frame').appendChild(el);
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
    const t0 = performance.now();
    const draw = now => {
      gl.uniform1f(uTime, 1 + (now - t0) / 1000 * 3);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return true;
  }

  function stop(){
    cancelAnimationFrame(raf);
    if(onResize) removeEventListener('resize', onResize);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    el?.remove();
    el = gl = onResize = null;
  }

  return {
    get active(){ return !!el; },
    in(){
      if(RM || el || !start()) return Promise.resolve();
      return new Promise(res => {
        requestAnimationFrame(() => { el.classList.add('in'); setTimeout(res, FADE); });
      });
    },
    out(){
      if(!el) return Promise.resolve();
      el.classList.remove('in');
      return new Promise(res => setTimeout(() => { stop(); res(); }, FADE + 300));
    },
  };
})();
