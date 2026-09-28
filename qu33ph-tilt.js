/* ════════════════════════════════════════════════════════════════════════
   qu33ph-tilt.js — tilt parallax for every page of the app
   ────────────────────────────────────────────────────────────────────────
   One switch (SETTINGS → GENERAL → 3D → Tilt parallax, stored as
   'qu33phTiltParallax' 0-100) drives every page.

   HOW IT STAYS CHEAP
   • One sensor listener and one requestAnimationFrame per page.
   • Each frame it writes only two CSS variables on <html> (--tpx, --tpy),
     and only when they actually changed, so a still phone costs nothing.
   • Layers move with the CSS `translate` / `scale` properties. Those are
     GPU-composited and are applied ON TOP of any `transform` a game already
     uses for its own camera, so nothing is overwritten.
   • With the switch off, the rules below don't match anything (they all hang
     off html.tp-on) and the loop doesn't run.

   DEPTH
   far  (game scenes, backgrounds) → moves AGAINST the tilt
   mid  (buttons, cards, grids)    → moves a little WITH the tilt
   near (logos, titles, back, HUD) → moves most WITH the tilt
   The opposite motions of far and near are what read as depth.

   Pages call QTilt.layers({far, farZoom, mid, near}) with CSS selectors.
   Canvas games that have a real backdrop behind the action read QTilt.x/y
   and QTilt.shift(size) to pan that backdrop inside the canvas instead.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  if (window.QTilt) return;
  var KEY = 'qu33phTiltParallax';
  var root = document.documentElement;

  function readPct(){ try{ return Math.max(0, Math.min(100, parseInt(localStorage.getItem(KEY)||'0',10)||0)); }catch(e){ return 0; } }
  function needsAsk(){ return typeof DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function'; }

  var T = window.QTilt = {
    pct: readPct(), x: 0, y: 0,           // x, y: eased tilt, -1 … 1
    tx: 0, ty: 0,                          // targets from the sensor
    base: { x: 0, y: 45 },                 // natural holding angle
    raw: null, live: false, granted: !needsAsk(), status: '',
    listening: false, onStatus: null,

    // Strength curve. Square-root shaped so the low end is already obvious:
    // 10% ≈ 49% of full depth, 50% ≈ 78%, 100% = full. Full depth is 11% of the
    // screen's short side (≈46px on a phone), versus 5% before.
    depth: function(){ var p=this.pct/100; return p<=0 ? 0 : 0.11*(0.25+0.75*Math.sqrt(p)); },
    // pixels a layer of the given size should move at full tilt
    shift: function(size){ return this.depth()*(size||Math.min(innerWidth,innerHeight)); }
  };

  // ── sensor → target (same maths as the standalone module) ──────────────
  function wrap(d){ return ((((d+180)%360)+360)%360)-180; }
  function map(d){ d=wrap(d); var m=Math.abs(d); if(m<=0.6) return 0; d=Math.sign(d)*(m-0.6); return Math.max(-30,Math.min(30,d))/30; }
  function angle(){ var a=(screen.orientation&&typeof screen.orientation.angle==='number')?screen.orientation.angle:(window.orientation||0); return ((a%360)+360)%360; }
  function forward(beta,gamma){
    // pass readings down into any frames on this page (the Dozer / Stack
    // screens): a frame only gets its own sensor data once it has been tapped
    var fr=document.getElementsByTagName('iframe');
    for(var i=0;i<fr.length;i++){ try{ fr[i].contentWindow.postMessage({qtilt:1,beta:beta,gamma:gamma},'*'); }catch(err){} }
  }
  function onOrient(e){
    if(e.beta==null || e.gamma==null) return;
    forward(e.beta,e.gamma);
    var a=angle();
    var x = a===90? -e.beta : a===180? -e.gamma : a===270? e.beta : e.gamma;
    var y = a===90?  e.gamma: a===180? -e.beta  : a===270? -e.gamma: e.beta;
    T.live=true; T.raw={x:x,y:y};
    T.tx=map(x-T.base.x); T.ty=map(y-T.base.y);
  }
  // readings forwarded from the page this one sits inside (index.html's frame)
  window.addEventListener('message', function(m){
    var d=m.data; if(!d || d.qtilt!==1 || T.pct<=0) return;
    onOrient({beta:d.beta, gamma:d.gamma});
  });
  function setStatus(s){ T.status=s; if(T.onStatus) try{ T.onStatus(s); }catch(e){} }
  function listen(){
    if(T.listening) return; T.listening=true;
    window.addEventListener('deviceorientation', onOrient, {passive:true});
    // desktop browsers have the API but never send readings
    setTimeout(function(){ if(!T.live && T.pct>0 && T.granted){ setStatus('no tilt sensor on this device'); } }, 1500);
  }
  // iOS: must be called inside a tap. Resolves true/false; never throws.
  T.ask = function(){
    if(!window.isSecureContext){ setStatus('tilt needs the https version of the site'); return Promise.resolve(false); }
    if(!('DeviceOrientationEvent' in window)){ setStatus('this browser has no tilt sensor support'); return Promise.resolve(false); }
    if(!needsAsk() || T.granted){ T.granted=true; listen(); return Promise.resolve(true); }
    return DeviceOrientationEvent.requestPermission().then(function(r){
      T.granted=(r==='granted'); if(T.granted){ setStatus(''); listen(); } else setStatus('motion access denied · reload, then allow it');
      return T.granted;
    }).catch(function(){ setStatus('motion access denied · reload, then allow it'); return false; });
  };
  T.setPct = function(v){
    T.pct=Math.max(0,Math.min(100,parseInt(v,10)||0));
    try{ localStorage.setItem(KEY,String(T.pct)); }catch(e){}
    apply();
  };
  T.recenter = function(){ if(T.raw) T.base={x:T.raw.x, y:T.raw.y}; };

  // ── CSS layers ─────────────────────────────────────────────────────────
  // Layer keys are a depth plus an optional pinned edge:
  //   far · farZoom · mid · near   +   '' | L | R | T | B | TL | TR | BL | BR
  // e.g. 'nearTL' = floats near, pinned top-left. A pinned element may drift
  // only 2px toward its own edge(s), so nothing ever slides off the screen.
  var sheet=null, sel={};
  var DEPTH = { far:-0.9, farZoom:-0.9, mid:0.35, near:0.7 };
  var ORDER = ['far','farZoom','mid','near'];
  // shared defaults: titles float nearest; buttons in between; corner controls pinned
  var COMMON = {
    near:   ['h1'],
    mid:    ['.mk-btn','.s2mk','.pause-mk'],
    nearTL: ['.game-back-tl','.corner-back:not(.flip)','.back-tl','.marker-btn:not(.pos-right)'],
    nearTR: ['.corner-back.flip','.marker-btn.pos-right']
  };
  function parseKey(key){ var m=/^(farZoom|far|mid|near)(T|B)?(L|R)?$|^(farZoom|far|mid|near)(L|R)$/.exec(key);
    if(!m) return null; return { depth:m[1]||m[4], v:m[2]||'', h:m[3]||m[5]||'' }; }
  function rule(list, key, s){
    var p=parseKey(key); if(!p || !list.length) return '';
    var px=(DEPTH[p.depth]*s).toFixed(2)+'px';
    // Menus and text (mid/near) keep their full sideways depth but move only
    // 30% as much vertically: stacked things (a title over its buttons, a
    // title over tabs) then can't slide onto each other and hide text.
    // Scenes behind everything (far) keep full movement both ways.
    var pyv=((p.depth==='far'||p.depth==='farZoom') ? DEPTH[p.depth]*s : DEPTH[p.depth]*s*0.3).toFixed(2)+'px';
    var X='calc(var(--tpx) * var(--tpd) * '+px+')', Y='calc(var(--tpy) * var(--tpd) * '+pyv+')';
    if(p.h==='L') X='max(-2px, '+X+')'; if(p.h==='R') X='min(2px, '+X+')';
    if(p.v==='T') Y='max(-2px, '+Y+')'; if(p.v==='B') Y='min(0px, '+Y+')';
    // :where() has zero specificity, so the order below decides which layer
    // wins when an element matches two lists (pinned beats free, near beats mid)
    return 'html.tp-on :where('+list.join(',')+'){translate:'+X+' '+Y+';'+(p.depth==='farZoom'?'scale:var(--tpz);':'')+'}';
  }
  function build(){
    var s=Math.min(innerWidth,innerHeight)*0.11;          // full-depth pixels at 100%
    var keys={}, k;
    for(k in COMMON) keys[k]=(keys[k]||[]).concat(COMMON[k]);
    for(k in sel)    keys[k]=(keys[k]||[]).concat(sel[k]);
    // free layers first (by depth), then pinned ones, so pinned always wins
    var names=Object.keys(keys).sort(function(a,b){
      var pa=parseKey(a)||{depth:'far',v:'',h:''}, pb=parseKey(b)||{depth:'far',v:'',h:''};
      var ea=(pa.v+pa.h)?1:0, eb=(pb.v+pb.h)?1:0;
      return ea-eb || ORDER.indexOf(pa.depth)-ORDER.indexOf(pb.depth);
    });
    var css=':root{--tpx:0;--tpy:0;--tpz:1;--tpd:0}';
    names.forEach(function(n){ css+=rule(keys[n], n, s); });
    css+=buttonRules();
    if(!sheet){ sheet=document.createElement('style'); sheet.id='qtilt-css'; document.head.appendChild(sheet); }
    sheet.textContent=css;
  }
  // ── 3D buttons ─────────────────────────────────────────────────────────
  // Every button swivels with real perspective as the phone tilts (up to 9°
  // at full strength), like a physical slab turning toward you, and on marker
  // buttons the end cap sits at a slightly different depth from the body, so
  // the two pieces shift against each other. GPU-only, driven by the same two
  // variables as the layers.
  // Zero-specificity :where() so any transform a page gives a button of its
  // own (a press-down effect, a flipped icon) always wins over the tilt.
  var BUTTONS=['button','.mk-btn','.s2mk','.pause-mk','.marker-btn','.corner-back','.game-back-tl','.mode-btn','.cab-card','.lvl','.choice'];
  var CAPS=['.mk-btn','.s2mk','.pause-mk','.marker-btn','.corner-back','.game-back-tl'];
  var TILT='perspective(700px) rotateX(calc(var(--tpy) * var(--tpd) * -9deg)) rotateY(calc(var(--tpx) * var(--tpd) * 9deg))';
  function buttonRules(){
    return ':where(html.tp-on) :where('+BUTTONS.join(',')+'){transform:'+TILT+';}'
      // the arcade's corner BACK buttons force transform:none; they tilt too
      + 'html.tp-on .back-tl{transform:'+TILT+' !important;}'
      // the cap floats a little behind the body
      + ':where(html.tp-on) :where('+CAPS.join(',')+')::before{translate:calc(var(--tpx) * var(--tpd) * -3px) calc(var(--tpy) * var(--tpd) * -1.5px);}';
  }
  T.layers = function(o){ for(var k in o){ if(parseKey(k)) sel[k]=(sel[k]||[]).concat(o[k]); } build(); };
  window.addEventListener('resize', function(){ if(sheet) build(); });

  // ── loop: ease, then publish two numbers ───────────────────────────────
  var raf=0, last=0, px=null, py=null;
  function frame(now){
    raf=requestAnimationFrame(frame);
    var dt=Math.min(0.1,(now-(last||now))/1000); last=now;
    // same frame-rate-independent lerp as the standalone module (0.08 @ 60fps)
    var k=1-Math.pow(1-0.08, dt*60);
    T.x+=(T.tx-T.x)*k; T.y+=(T.ty-T.y)*k;
    if(px===null || Math.abs(T.x-px)>0.002 || Math.abs(T.y-py)>0.002){
      px=T.x; py=T.y;
      root.style.setProperty('--tpx', T.x.toFixed(4));
      root.style.setProperty('--tpy', T.y.toFixed(4));
    }
  }
  function apply(){
    var on=T.pct>0;
    var d=T.depth();
    root.style.setProperty('--tpd', d>0 ? (d/0.11).toFixed(4) : '0');
    // far layers that fill the screen are enlarged just enough to hide their edges
    root.style.setProperty('--tpz', (1+2.2*d*0.9).toFixed(4));
    root.classList.toggle('tp-on', on);
    if(on && !raf){ last=0; raf=requestAnimationFrame(frame); }
    if(!on && raf){ cancelAnimationFrame(raf); raf=0; T.x=T.y=0; px=py=null;
      root.style.setProperty('--tpx','0'); root.style.setProperty('--tpy','0'); }
    if(on){ if(T.granted) listen(); }
  }
  document.addEventListener('visibilitychange', function(){
    if(document.hidden && raf){ cancelAnimationFrame(raf); raf=0; }
    else if(!document.hidden && T.pct>0 && !raf){ last=0; raf=requestAnimationFrame(frame); }
  });
  // the switch lives in game.html; other open pages (the Dozer/Stack frames) follow it live
  window.addEventListener('storage', function(e){ if(e.key===KEY){ T.pct=readPct(); apply(); } });
  // iOS only grants from a tap, once per page: ask on the first tap when tilt is on
  window.addEventListener('pointerdown', function first(){
    if(T.pct>0 && !T.granted) T.ask();
    if(T.granted) window.removeEventListener('pointerdown', first, true);
  }, true);

  build(); apply();
})();
