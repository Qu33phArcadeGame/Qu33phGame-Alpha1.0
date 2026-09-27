/* ════════════════════════════════════════════════════════════════════════
   qu33ph-depth.js — per-pixel depth parallax from depth maps
   ────────────────────────────────────────────────────────────────────────
   Every art image that has a matching  name-depth.png  (white = near,
   black = far) is redrawn on the GPU so each pixel moves by its OWN depth as
   the phone tilts: hundreds of depth layers from one picture, instead of a
   flat card sliding around.

   Driven by the same switch and tilt as qu33ph-tilt.js (load that first).
   Costs nothing when tilt parallax is off, and nothing while the phone is
   still: an image is only re-rendered when the tilt actually changes.

   TWO WAYS TO USE IT
   • On-page <img> elements:  QDepth.attach(selectors, {strength, focus})
     A canvas is laid exactly over each image (same box, fit, transforms and
     tilt layer) and the image underneath goes invisible but stays in place,
     so layout, taps and game code that reads it are all untouched.
   • Art a game paints into its own canvas:
       QDepth.draw(ctx, img, dx, dy, dw, dh, {strength, focus, crop})
     returns true when it drew the depth version; false means "draw the plain
     image as before" (tilt off, no depth map, no WebGL).

   OPTIONS
   strength  0…1   how far pixels move (1 = full)
   focus     0…1   the depth that stays anchored: 0.5 = pixels float both ways
                   around the middle; 1 = the nearest parts stay put and
                   everything else recedes (backgrounds behind gameplay);
                   set it to the playing surface where a game draws objects
                   on the art, so those objects stay on their spots.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  if (window.QDepth) return;

  var VS='attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
  // For each output pixel, find which surface lands there. Walk depth layers
  // from NEAREST to FARTHEST: at each layer, look up the spot a surface of that
  // depth would have come from; the first layer where the real surface is at
  // least that near is the hit — so near objects always cover far ones (clean
  // occlusion, no tearing). A final linear step between the last miss and the
  // hit pins the edge exactly. High precision where available: phone GPUs'
  // default medium precision can't address big photos finely and stair-steps.
  var FS=[
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 v;',
    'uniform sampler2D uImg,uDep;uniform vec2 uShift;uniform float uZoom,uFocus;uniform vec4 uCrop;',
    'float dep(vec2 uv){ return texture2D(uDep,uCrop.xy+clamp(uv,0.,1.)*uCrop.zw).r; }',
    'void main(){',
    '  vec2 base=(v-.5)/uZoom+.5;',
    '  const int N=24;',
    '  float pL=1.0; float pD=dep(base-uShift*(1.0-uFocus)); vec2 hit=base-uShift*(1.0-uFocus);',
    '  if(pD<1.0){',
    '    for(int i=1;i<=N;i++){',
    '      float L=1.0-float(i)/float(N);',
    '      vec2 uv=base-uShift*(L-uFocus);',
    '      float d=dep(uv);',
    '      if(d>=L){',
    '        float a=pD-pL, b=d-L, t=a/(a-b);',
    '        float Lh=pL+t*(L-pL);',
    '        hit=base-uShift*(Lh-uFocus);',
    '        break;',
    '      }',
    '      pL=L; pD=d;',
    '    }',
    '  }',
    '  gl_FragColor=texture2D(uImg,uCrop.xy+clamp(hit,0.,1.)*uCrop.zw);',
    '}'].join('\n');

  var gl=null, glc=null, prog=null, L={}, okGL=null;
  function initGL(){
    if(okGL!==null) return okGL;
    try{
      glc=document.createElement('canvas');
      gl=glc.getContext('webgl',{premultipliedAlpha:true,preserveDrawingBuffer:true,alpha:true,antialias:false})
       || glc.getContext('experimental-webgl');
      if(!gl){ okGL=false; return okGL; }
      function sh(t,s){ var o=gl.createShader(t); gl.shaderSource(o,s); gl.compileShader(o); if(!gl.getShaderParameter(o,gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(o); return o; }
      prog=gl.createProgram(); gl.attachShader(prog,sh(gl.VERTEX_SHADER,VS)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FS));
      gl.linkProgram(prog); if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw gl.getProgramInfoLog(prog);
      gl.useProgram(prog);
      var b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      var pl=gl.getAttribLocation(prog,'p'); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl,2,gl.FLOAT,false,0,0);
      ['uImg','uDep','uShift','uZoom','uFocus','uCrop'].forEach(function(n){ L[n]=gl.getUniformLocation(prog,n); });
      gl.uniform1i(L.uImg,0); gl.uniform1i(L.uDep,1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      okGL=true;
    }catch(e){ okGL=false; }
    return okGL;
  }
  function tex(src){
    var t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src); return t;
  }

  // ── per-image state: its depth map and GPU textures ─────────────────────
  var entries=new Map();
  function srcOf(img){ return (img.currentSrc||img.src||'').split('#')[0]; }
  function depthURL(src){ var s=src.split('?')[0]; return /\.(png|jpe?g|webp)$/i.test(s) ? s.replace(/\.(png|jpe?g|webp)$/i,'-depth.png') : null; }
  function entry(img){
    var e=entries.get(img), s=srcOf(img);
    if(e && e.src===s) return e;
    if(e){ if(e.ti) gl.deleteTexture(e.ti); if(e.td) gl.deleteTexture(e.td); }
    e={ src:s, dep:null, ready:false, failed:false, ti:null, td:null, key:'' };
    entries.set(img,e);
    var u=depthURL(s); if(!u){ e.failed=true; return e; }
    var d=new Image(); d.decoding='async';
    d.onload=function(){ e.dep=prepDepth(d); e.ready=true; }; d.onerror=function(){ e.failed=true; };   // no map: stays flat
    d.src=u; return e;
  }
  // Prepare a depth map for clean parallax. A single photo has nothing behind
  // its objects, so a hard depth cliff would open a gap that has to be filled by
  // stretching (the streaks/tears). Instead every cliff is turned into a smooth
  // slope at least as wide as pixels ever move, so the picture bends gently
  // around objects and never tears — on any screen, at any strength.
  //  1. shrink (longest side 128px) — cheap to process, and the GPU's smooth
  //     scaling back up keeps it soft
  //  2. grow near (bright) areas by one texel — bending happens in the
  //     background just behind an object, not across the object itself
  //  3. blur (three box passes ≈ gaussian) — the slopes
  function prepDepth(img){
    try{
      var s=Math.min(1, 128/Math.max(img.naturalWidth,img.naturalHeight)), w=Math.max(2,Math.round(img.naturalWidth*s)), h=Math.max(2,Math.round(img.naturalHeight*s));
      var c=document.createElement('canvas'); c.width=w; c.height=h;
      var g=c.getContext('2d'); g.drawImage(img,0,0,w,h);
      var id=g.getImageData(0,0,w,h), px=id.data, n=w*h, a=new Float32Array(n), b=new Float32Array(n), i, x, y, k;
      for(i=0;i<n;i++) a[i]=px[i*4];
      // grow near areas (3x3 max)
      for(y=0;y<h;y++) for(x=0;x<w;x++){
        var m=0;
        for(var dy=-1;dy<=1;dy++){ var yy=y+dy; if(yy<0||yy>=h) continue;
          for(var dx=-1;dx<=1;dx++){ var xx=x+dx; if(xx<0||xx>=w) continue; if(a[yy*w+xx]>m) m=a[yy*w+xx]; } }
        b[y*w+x]=m;
      }
      var t=a; a=b; b=t;
      // blur: 3 passes of a separable box filter, radius 2 texels (edges clamp)
      var R=2;
      for(var pass=0; pass<3; pass++){
        for(y=0;y<h;y++) for(x=0;x<w;x++){ var sum=0; for(k=-R;k<=R;k++){ var xx2=Math.min(w-1,Math.max(0,x+k)); sum+=a[y*w+xx2]; } b[y*w+x]=sum/(2*R+1); }
        for(y=0;y<h;y++) for(x=0;x<w;x++){ var sum2=0; for(k=-R;k<=R;k++){ var yy2=Math.min(h-1,Math.max(0,y+k)); sum2+=b[yy2*w+x]; } a[y*w+x]=sum2/(2*R+1); }
      }
      for(i=0;i<n;i++){ var vv=Math.round(a[i]); px[i*4]=px[i*4+1]=px[i*4+2]=vv; px[i*4+3]=255; }
      g.putImageData(id,0,0);
      return c;
    }catch(err){ return img; }
  }
  function usable(img){
    return window.QTilt && QTilt.pct>0 && initGL() && img && img.complete && img.naturalWidth>0;
  }

  // Render img's depth version at pw×ph into the shared GL canvas.
  // crop: {sx,sy,sw,sh} in image pixels (what part of the image fills the box)
  function render(img, e, pw, ph, o, crop){
    if(!e.ti){ e.ti=tex(img); e.td=tex(e.dep); }
    var iw=img.naturalWidth, ih=img.naturalHeight;
    var c=crop? [crop.sx/iw, crop.sy/ih, crop.sw/iw, crop.sh/ih] : [0,0,1,1];
    var str=(o.strength===undefined?1:o.strength), focus=(o.focus===undefined?0.5:o.focus);
    // Nearest-to-farthest travel at full tilt ≈ 60% of the tilt engine's own
    // depth, in pixels of the shorter side; converted to texture units per axis.
    var m=Math.min(pw,ph), full=2*0.6*QTilt.depth()*str*m;
    var fx=full/pw, fy=full/ph;
    // enlarge just enough that the most-displaced pixels never pull in an edge
    var reach=Math.max(focus,1-focus), zoom=1+2*reach*Math.max(fx,fy);
    if(glc.width!==pw||glc.height!==ph){ glc.width=pw; glc.height=ph; }
    gl.viewport(0,0,pw,ph); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,e.ti);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,e.td);
    // tilt right → near pixels move right, far pixels move left
    gl.uniform2f(L.uShift, QTilt.x*fx, QTilt.y*fy);
    gl.uniform1f(L.uZoom, zoom); gl.uniform1f(L.uFocus, focus);
    gl.uniform4f(L.uCrop, c[0],c[1],c[2],c[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  function tiltKey(){ return Math.round(QTilt.x*300)+','+Math.round(QTilt.y*300)+','+QTilt.pct; }
  function capSize(w,h){ var s=Math.min(1, 1600/Math.max(w,h,1)); return [Math.max(2,Math.round(w*s)), Math.max(2,Math.round(h*s))]; }

  // ── canvas games ────────────────────────────────────────────────────────
  var outs=new Map();   // img -> {cv, key}: the finished picture, reused until the tilt changes
  function draw(ctx, img, dx, dy, dw, dh, o){
    o=o||{};
    if(!usable(img)) return false;
    var e=entry(img); if(!e.ready) return false;
    var sz=capSize(Math.abs(dw),Math.abs(dh)), crop=o.crop||null;
    var key=tiltKey()+'|'+sz[0]+'x'+sz[1]+'|'+(crop?[crop.sx,crop.sy,crop.sw,crop.sh].join(','):'')+'|'+e.src;
    var out=outs.get(img);
    if(!out){ out={cv:document.createElement('canvas'), key:''}; outs.set(img,out); }
    if(out.key!==key){
      try{ render(img,e,sz[0],sz[1],o,crop); }catch(err){ e.ready=false; e.failed=true; return false; }   // blocked image: stay flat
      if(out.cv.width!==sz[0]||out.cv.height!==sz[1]){ out.cv.width=sz[0]; out.cv.height=sz[1]; }
      var g=out.cv.getContext('2d'); g.clearRect(0,0,sz[0],sz[1]); g.drawImage(glc,0,0);
      out.key=key;
    }
    ctx.drawImage(out.cv, dx, dy, dw, dh);
    return true;
  }
  // a short string that changes whenever the depth picture would — for games
  // that cache their art (add it to the cache key so the cache refreshes)
  function key(){ return (window.QTilt && QTilt.pct>0 && okGL!==false) ? tiltKey() : ''; }

  // ── on-page <img> elements ─────────────────────────────────────────────
  var overlays=[];      // {img, cv, o, key, op}
  function contentRect(img, cs){
    // where the picture actually sits inside the element box (object-fit)
    var bw=img.offsetWidth, bh=img.offsetHeight, iw=img.naturalWidth, ih=img.naturalHeight;
    var fit=cs.objectFit||'fill', r={x:0,y:0,w:bw,h:bh,crop:null};
    if(fit==='contain' || fit==='scale-down'){
      var s=Math.min(bw/iw,bh/ih); r.w=iw*s; r.h=ih*s; r.x=(bw-r.w)/2; r.y=(bh-r.h)/2;
    } else if(fit==='cover'){
      var k=Math.max(bw/iw,bh/ih), sw=bw/k, sh=bh/k;
      r.crop={sx:(iw-sw)/2, sy:(ih-sh)/2, sw:sw, sh:sh};
    }
    return r;
  }
  function attach(selectors, o){
    (Array.isArray(selectors)?selectors:[selectors]).forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(img){
        if(img.tagName!=='IMG' || overlays.some(function(x){return x.img===img;})) return;
        var cv=document.createElement('canvas'); cv.className='qdepth-cv';
        cv.style.cssText='position:absolute;pointer-events:none;display:none;margin:0;';
        img.insertAdjacentElement('afterend', cv);
        overlays.push({img:img, cv:cv, o:o||{}, key:'', op:null});
      });
    });
    start();
  }
  function hideOverlay(ov){
    if(ov.cv.style.display!=='none') ov.cv.style.display='none';
    if(ov.op!==null){ ov.img.style.opacity=ov.op; ov.op=null; }
  }
  function syncOverlay(ov){
    var img=ov.img;
    if(!img.isConnected || !img.offsetWidth || !usable(img)){ hideOverlay(ov); return; }
    var e=entry(img); if(!e.ready){ hideOverlay(ov); return; }
    var cs=getComputedStyle(img);
    if(cs.display==='none' || cs.visibility==='hidden'){ hideOverlay(ov); return; }
    var r=contentRect(img,cs), dpr=Math.min(window.devicePixelRatio||1,2);
    var sz=capSize(r.w*dpr, r.h*dpr);
    var fixed=cs.position==='fixed', s=ov.cv.style;
    var left, top;
    if(fixed){ var br=img.getBoundingClientRect(); left=br.left; top=br.top; }   // (fixed images: no tilt transforms to mirror)
    else { left=img.offsetLeft; top=img.offsetTop; }
    s.position=fixed?'fixed':'absolute';
    s.left=(left+r.x)+'px'; s.top=(top+r.y)+'px'; s.width=r.w+'px'; s.height=r.h+'px';
    // mirror everything that moves or styles the image: its own transform, its
    // tilt layer (translate/scale), stacking and rounded corners
    // (a fixed image's on-screen box already includes its movement, so only
    //  absolutely-positioned ones need their transforms copied across)
    s.transform=fixed||cs.transform==='none'?'':cs.transform;
    s.translate=fixed||cs.translate==='none'?'':cs.translate;
    s.scale=fixed||cs.scale==='none'?'':cs.scale;
    s.transformOrigin=(parseFloat(cs.transformOrigin)-r.x)+'px '+(parseFloat(cs.transformOrigin.split(' ')[1])-r.y)+'px';
    s.zIndex=cs.zIndex; s.borderRadius=cs.borderRadius; s.filter=cs.filter==='none'?'':cs.filter;
    if(ov.op===null){ ov.op=img.style.opacity; }
    var baseOp=ov.op===''||ov.op==null?1:parseFloat(ov.op); s.opacity=String(isNaN(baseOp)?1:baseOp);
    img.style.opacity='0';                          // the picture now comes from the canvas
    if(s.display==='none') s.display='block';
    var key=tiltKey()+'|'+sz[0]+'x'+sz[1]+'|'+e.src+'|'+(r.crop?Math.round(r.crop.sx)+','+Math.round(r.crop.sy):'');
    if(ov.key===key) return;
    try{ render(img,e,sz[0],sz[1],ov.o,r.crop); }catch(err){ e.ready=false; e.failed=true; hideOverlay(ov); return; }
    if(ov.cv.width!==sz[0]||ov.cv.height!==sz[1]){ ov.cv.width=sz[0]; ov.cv.height=sz[1]; }
    var g=ov.cv.getContext('2d'); g.clearRect(0,0,sz[0],sz[1]); g.drawImage(glc,0,0);
    ov.key=key;
  }
  var raf=0;
  function loop(){
    raf=0;
    var on=window.QTilt && QTilt.pct>0;
    for(var i=0;i<overlays.length;i++){ if(on) syncOverlay(overlays[i]); else hideOverlay(overlays[i]); }
    if(on && !document.hidden) raf=requestAnimationFrame(loop);
  }
  function start(){ if(!raf && overlays.length) raf=requestAnimationFrame(loop); }
  // wake up when tilt is switched on, the tab comes back, or the page lays out again
  window.addEventListener('storage', function(){ setTimeout(start,50); });
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) start(); });
  window.addEventListener('resize', start);
  setInterval(function(){ if(!raf && window.QTilt && QTilt.pct>0) start(); else if(!raf) loop(); }, 500);

  window.QDepth = { draw:draw, attach:attach, key:key, available:function(){ return initGL(); } };
})();
