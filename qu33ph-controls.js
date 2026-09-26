/* ════════════════════════════════════════════════════════════════════════
   qu33ph-controls.js — one control layer shared by every game in the arcade
   ────────────────────────────────────────────────────────────────────────
   • KEYBOARD  every input in every game has a key, remappable in
               SETTINGS → KEYS (saved per game in localStorage 'qu33phKeys').
               ESC is BACK everywhere. Mapped keys never scroll the page.
   • AIM MARKER for throw games on a computer: the exact marker button
               (same measurements as the RESUME/FORFEIT buttons) points the
               throw. Aim keys turn it, hold THROW to charge (the marker fills
               up), let go to throw. Mouse click-drag-release still works too.
   • MOTION    on phones (SETTINGS → ARCADE → Motion controls): tilt to aim
               or steer, flick the phone to throw / drop, a quick twist for
               the pinball flippers.
   A game calls QC.bind(gameId, {...}) with hooks into its own code; the
   throw itself always goes through the game's own throw function.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  var A = function(label, key){ return [label, key]; };
  var AIM_L=A('Aim left','ArrowLeft'), AIM_R=A('Aim right','ArrowRight'), THROW=A('Throw (hold = power)','Space'),
      MOVE_L=A('Move left','KeyA'), MOVE_R=A('Move right','KeyD'), BACK=A('Back','Escape');
  var DEFS = {
    jump:   { title:'QU33PH',        actions:{ aimLeft:AIM_L, aimRight:AIM_R, throw:THROW, back:BACK } },
    pinball:{ title:'PINBALL',       actions:{ left:A('Left flipper','ArrowLeft'), right:A('Right flipper','ArrowRight'), launch:A('Launch','Space'), back:BACK } },
    bowling:{ title:'BOWLING',       actions:{ aimLeft:AIM_L, aimRight:AIM_R, moveLeft:A('Walk spot left','KeyA'), moveRight:A('Walk spot right','KeyD'), throw:THROW, orient:A('Marker orientation','KeyO'), back:BACK } },
    skee:   { title:'QU33PH-BALL',   actions:{ aimLeft:AIM_L, aimRight:AIM_R, throw:THROW, lane:A('Change lane','KeyL'), back:BACK } },
    mini:   { title:'MINI QU33PH',   actions:{ aimLeft:AIM_L, aimRight:AIM_R, moveLeft:MOVE_L, moveRight:MOVE_R, throw:THROW, back:BACK } },
    flip:   { title:'QU33PH FLIP',   actions:{ aimLeft:AIM_L, aimRight:AIM_R, throw:THROW, back:BACK } },
    dozer:  { title:'QU33PH DOZER',  actions:{ moveLeft:A('Move left','ArrowLeft'), moveRight:A('Move right','ArrowRight'), drop:A('Drop marker','Space'), buy:A('Buy +3 markers','KeyB'), back:BACK } },
    stack:  { title:'QU33PH STACK',  actions:{ moveLeft:A('Move left','ArrowLeft'), moveRight:A('Move right','ArrowRight'), drop:A('Drop marker','Space'), back:BACK } },
    fidget: { title:'FIDGET QU33PH', actions:{ up:A('Up','ArrowUp'), down:A('Down','ArrowDown'), left:A('Left','ArrowLeft'), right:A('Right','ArrowRight'),
                                               p2up:A('Player 2 up','KeyW'), p2down:A('Player 2 down','KeyS'), p2left:A('Player 2 left','KeyA'), p2right:A('Player 2 right','KeyD'), back:BACK } },
    slot:   { title:'SLOT MACHINE',  actions:{ spin1:A('Spin 1','Space'), spin3:A('3× spin','Digit3'), back:BACK } },
    plinko: { title:'PLINQU33PH',    actions:{ moveLeft:A('Move left','ArrowLeft'), moveRight:A('Move right','ArrowRight'), drop:A('Drop','Space'), back:BACK } }
  };
  var ORDER=['jump','pinball','bowling','skee','mini','flip','dozer','stack','fidget','slot','plinko'];
  var STORE='qu33phKeys', MOTION_KEY='qu33phArcadeMotion';

  function load(){ try{ return JSON.parse(localStorage.getItem(STORE)||'{}')||{}; }catch(e){ return {}; } }
  function save(o){ try{ localStorage.setItem(STORE, JSON.stringify(o)); }catch(e){} }
  function keysFor(g){ var d=DEFS[g], o=(load()[g])||{}, out={}; if(!d) return out;
    for(var a in d.actions) out[a]= (o[a]!==undefined? o[a] : d.actions[a][1]); return out; }
  function setKey(g,a,code){ var all=load(); all[g]=all[g]||{};
    // one key does one thing per game: take it off any other action that had it
    var cur=keysFor(g); for(var k in cur){ if(k!==a && cur[k]===code) all[g][k]=''; }
    all[g][a]=code; save(all); }
  function resetKeys(g){ var all=load(); delete all[g]; save(all); }
  function label(code){
    if(!code) return '—';
    var m={Space:'SPACE',Escape:'ESC',ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓',Enter:'ENTER',ShiftLeft:'L-SHIFT',ShiftRight:'R-SHIFT',
           ControlLeft:'L-CTRL',ControlRight:'R-CTRL',AltLeft:'L-ALT',AltRight:'R-ALT',Tab:'TAB',Backspace:'BKSP'};
    if(m[code]) return m[code];
    if(/^Key[A-Z]$/.test(code)) return code.slice(3);
    if(/^Digit\d$/.test(code)) return code.slice(5);
    if(/^Numpad/.test(code)) return 'NUM '+code.slice(6);
    return code.toUpperCase();
  }
  function motionPct(){ try{ return parseInt(localStorage.getItem(MOTION_KEY)||'0',10)||0; }catch(e){ return 0; } }

  // ── the aim marker: the pause-menu marker button at 64% scale ─────────────
  var css = ''
   +'.qc-aim{position:fixed;left:0;top:0;width:0;height:0;z-index:9000;pointer-events:none;display:none;}'
   +'.qc-aim .qc-b{position:absolute;left:-39px;top:-16px;width:96px;height:32px;box-sizing:border-box;background:#000;'
   +'  border:1.92px solid #fff;border-radius:2.56px 6.4px 6.4px 2.56px;overflow:hidden;}'
   +'.qc-aim .qc-f{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(255,255,255,.85);}'
   +'.qc-aim .qc-c{position:absolute;left:-56.28px;top:-12.8px;width:23.04px;height:25.6px;box-sizing:border-box;background:#000;'
   +'  border:1.92px solid #fff;border-radius:5.12px 1.28px 1.28px 5.12px;}';
  var aimEl=null, fillEl=null;
  function ensureAim(){
    if(aimEl) return;
    var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
    aimEl=document.createElement('div'); aimEl.className='qc-aim';
    aimEl.innerHTML='<div class="qc-b"><div class="qc-f"></div></div><div class="qc-c"></div>';
    document.body.appendChild(aimEl); fillEl=aimEl.querySelector('.qc-f');
  }

  // ── runtime ───────────────────────────────────────────────────────────────
  var binds=[];                 // [{game, o}]
  var held={};                  // action -> true while its key is down (for the active binding)
  var aim={ off:0, charging:false, t0:0, power:0, used:false };
  var lastT=0;
  function active(){ for(var i=0;i<binds.length;i++){ var b=binds[i]; if(!b.o.active || b.o.active()) return b; } return null; }
  function actionFor(b, code){ var k=keysFor(b.game); for(var a in k){ if(k[a]===code) return a; } return null; }
  function clampOff(b){ var r=(b.o.aim && b.o.aim.range) || Math.PI/3; aim.off=Math.max(-r,Math.min(r,aim.off)); }

  function throwNow(b){
    if(!b.o.aim) return;
    var p=Math.max(0.08, aim.power);
    aim.charging=false; aim.power=0;
    if(!b.o.aim.can || b.o.aim.can()) b.o.aim.onThrow(aim.off, p);
  }

  document.addEventListener('keydown', function(e){
    if(QC.capturing){ e.preventDefault(); var cb=QC.capturing; QC.capturing=null; cb(e.code); return; }
    var b=active(); if(!b) return;
    var a=actionFor(b, e.code); if(!a) return;
    e.preventDefault();
    if(e.repeat) return;
    held[a]=true;
    if(a==='back'){ if(b.o.onBack) b.o.onBack(); else { var bb=document.getElementById('gameBackBtn'); if(bb) bb.click(); } return; }
    if(b.o.aim && (a==='aimLeft'||a==='aimRight')){ aim.used=true; return; }
    if(b.o.aim && a==='throw'){ aim.used=true; if(!b.o.aim.can || b.o.aim.can()){ aim.charging=true; aim.t0=performance.now(); } return; }
    if(b.o.onAction) b.o.onAction(a, true);
  }, true);
  document.addEventListener('keyup', function(e){
    var b=active(); if(!b) return;
    var a=actionFor(b, e.code); if(!a) return;
    e.preventDefault(); held[a]=false;
    if(b.o.aim && a==='throw'){ if(aim.charging) throwNow(b); return; }
    if(b.o.aim && (a==='aimLeft'||a==='aimRight')) return;
    if(a!=='back' && b.o.onAction) b.o.onAction(a, false);
  }, true);
  window.addEventListener('blur', function(){ held={}; aim.charging=false; });

  function frame(t){
    var dt=Math.min(0.05, (t-(lastT||t))/1000); lastT=t;
    var b=active();
    if(b){
      if(b.o.aim){
        var sp=1.5;                                              // radians per second while an aim key is held
        if(held.aimLeft)  aim.off-=sp*dt;
        if(held.aimRight) aim.off+=sp*dt;
        if(mTilt!==null && motionPct()>0 && !b.o.aim.noMotion){ var r=(b.o.aim.range||Math.PI/3); aim.off += ((mTilt*r) - aim.off)*Math.min(1,dt*8); }
        clampOff(b);
        if(aim.charging){ var ph=((t-aim.t0)/850)%2; aim.power = ph<1? ph : 2-ph; }   // fills, empties, fills… let go when it's right
        if(b.o.aim.sync) b.o.aim.sync(aim.off, aim.charging? aim.power : 0, aim.used || motionPct()>0);
        drawAim(b);
      } else if(aimEl) aimEl.style.display='none';
      if(b.o.frame) b.o.frame(dt, held);
    } else if(aimEl) aimEl.style.display='none';
    requestAnimationFrame(frame);
  }
  function drawAim(b){
    var ao=b.o.aim;
    if(ao.drawOwn){ if(aimEl) aimEl.style.display='none'; return; }   // game draws its own (main game canvas)
    var show=(aim.used || motionPct()>0) && (!ao.can || ao.can());
    ensureAim();
    if(!show){ aimEl.style.display='none'; return; }
    var p=ao.anchor(); if(!p){ aimEl.style.display='none'; return; }
    var dir=(ao.base===undefined? -Math.PI/2 : ao.base) + aim.off, lead=ao.lead||70;
    aimEl.style.display='block';
    aimEl.style.transform='translate('+(p.x+Math.cos(dir)*lead)+'px,'+(p.y+Math.sin(dir)*lead)+'px) rotate('+(dir-Math.PI)+'rad)';
    fillEl.style.width=(aim.charging? Math.round(aim.power*100) : 0)+'%';
  }
  requestAnimationFrame(frame);

  // ── motion (phones) ──────────────────────────────────────────────────────
  var mTilt=null, mTiltY=null, armed=false, peak=0, lastFlick=0, lastTwist=0, motionOn=false;
  function screenAngle(){ try{ return (screen.orientation && screen.orientation.angle) || window.orientation || 0; }catch(e){ return 0; } }
  function onOrient(e){
    if(motionPct()<=0) { mTilt=null; return; }
    var g=e.gamma||0, be=e.beta||0, ang=((screenAngle()%360)+360)%360, x, y;
    // tilt left/right as the player sees the screen, whichever way the phone is turned
    if(ang===90){ x=be; y=-g; } else if(ang===270){ x=-be; y=g; } else { x=g; y=be-35; }
    mTilt=Math.max(-1,Math.min(1,x/28)); mTiltY=Math.max(-1,Math.min(1,y/28));
    var b=active(); if(b && b.o.motion && b.o.motion.tilt) b.o.motion.tilt(mTilt, mTiltY);
  }
  function onMotion(e){
    var pct=motionPct(); if(pct<=0) return;
    var b=active(); if(!b) return;
    var rr=e.rotationRate;
    if(rr && b.o.motion && b.o.motion.twist){                   // quick wrist twist → pinball flippers
      var tw=(Math.abs(screenAngle())===90? (rr.beta||0) : (rr.gamma||0));
      var th=260-(pct/100)*140;
      if(Math.abs(tw)>th && performance.now()-lastTwist>160){ lastTwist=performance.now(); b.o.motion.twist(tw>0?1:-1); }
    }
    var a=e.acceleration || e.accelerationIncludingGravity; if(!a) return;
    var mag=Math.hypot(a.x||0,a.y||0,a.z||0); if(!e.acceleration) mag=Math.abs(mag-9.81);
    var thr=26-(pct/100)*17, now=Date.now();                     // same feel as the main game's motion throw
    if(mag>thr){ if(!armed){ armed=true; peak=0; } if(mag>peak) peak=mag; return; }
    if(armed){
      armed=false; if(now-lastFlick<550){ peak=0; return; } lastFlick=now;
      var pw=Math.max(0.25, Math.min(1, 0.35+(peak-thr)/22)); peak=0;
      if(b.o.aim && !b.o.aim.noMotion && (!b.o.aim.can || b.o.aim.can())) b.o.aim.onThrow(aim.off, pw);
      else if(b.o.motion && b.o.motion.flick) b.o.motion.flick(pw);
    }
  }
  function startMotion(){
    if(motionOn) return;
    function go(){ motionOn=true; window.addEventListener('deviceorientation', onOrient, {passive:true}); window.addEventListener('devicemotion', onMotion, {passive:true}); }
    try{
      var need=[];
      if(typeof DeviceMotionEvent!=='undefined' && typeof DeviceMotionEvent.requestPermission==='function') need.push(DeviceMotionEvent.requestPermission());
      if(typeof DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function') need.push(DeviceOrientationEvent.requestPermission());
      if(need.length) Promise.all(need).then(function(r){ if(r.every(function(x){return x==='granted';})) go(); }).catch(function(){});
      else go();
    }catch(e){}
  }
  // iOS only grants motion from a tap, so the first tap in any game asks (when motion is on)
  window.addEventListener('pointerdown', function(){ if(motionPct()>0) startMotion(); }, true);
  if(motionPct()>0 && !(typeof DeviceMotionEvent!=='undefined' && typeof DeviceMotionEvent.requestPermission==='function')) startMotion();

  var QC = window.QC = {
    DEFS:DEFS, ORDER:ORDER, keysFor:keysFor, setKey:setKey, resetKeys:resetKeys, label:label,
    motionPct:motionPct, startMotion:startMotion, capturing:null,
    held:function(a){ return !!held[a]; },
    aimState:function(){ return { off:aim.off, power:aim.power, charging:aim.charging, used:aim.used }; },
    bind:function(game, o){ binds.push({game:game, o:o||{}}); }
  };
})();
