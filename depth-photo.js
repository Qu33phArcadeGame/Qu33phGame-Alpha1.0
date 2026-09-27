/* ════════════════════════════════════════════════════════════════════════
   depth-photo.js — true per-pixel depth parallax for canvas-drawn photos
   ────────────────────────────────────────────────────────────────────────
   Works alongside qu33ph-tilt.js. Where QTilt gives every element ONE flat
   plane of motion, this splits a single image into several depth bands
   (using a matching grayscale depth map, white = near / black = far) so
   near and far parts of the SAME photo drift at different speeds under
   tilt — real depth, not just a panned rectangle.

   USAGE (canvas-drawn photos only — do not use on an element that is
   already inside a QTilt.layers() CSS selector, or the two motions stack):

     DepthPhoto.render(ctx, 'originalfield.png', 'originalfield-depth.png',
                        colorImgEl, x, y, w, h);

   `colorImgEl` is the already-loading/loaded Image (or <img>) you were
   drawing before — used as the instant fallback so the very first frames,
   and any frame before the depth build finishes, look exactly like a
   plain drawImage (no flash, no jump). Once the depth layers finish
   building (cached after the first call), every following frame uses the
   real multi-layer parallax automatically. When tilt is off (QTilt.pct<=0
   or QTilt missing) it degrades to a plain drawImage — zero cost.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.DepthPhoto) return;

  var LAYER_COUNT = 5;     // depth bands sliced out of the grayscale map
  var MAX_DIM = 640;       // build resolution cap — plenty for a soft parallax wobble
  var cache = {};          // "colorSrc|depthSrc" -> Promise<built>

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = reject;
      im.src = src;
    });
  }

  function build(colorSrc, depthSrc) {
    var key = colorSrc + '|' + depthSrc;
    if (cache[key]) return cache[key];
    var p = Promise.all([loadImage(colorSrc), loadImage(depthSrc)]).then(function (imgs) {
      var color = imgs[0], depth = imgs[1];
      var w = color.naturalWidth, h = color.naturalHeight;
      var scale = Math.min(1, MAX_DIM / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));

      var dc = document.createElement('canvas'); dc.width = w; dc.height = h;
      var dctx = dc.getContext('2d'); dctx.drawImage(depth, 0, 0, w, h);
      var dData = dctx.getImageData(0, 0, w, h).data;

      var cc = document.createElement('canvas'); cc.width = w; cc.height = h;
      var cctx = cc.getContext('2d'); cctx.drawImage(color, 0, 0, w, h);
      var cData = cctx.getImageData(0, 0, w, h).data;

      var n = LAYER_COUNT, len = w * h;
      var buffers = [], counts = [];
      for (var i = 0; i < n; i++) { buffers.push(new Uint8ClampedArray(len * 4)); counts.push(0); }

      for (var p2 = 0; p2 < len; p2++) {
        var di = p2 * 4;
        var li = Math.min(n - 1, (dData[di] * n) >> 8); // bucket by depth-map luma
        var buf = buffers[li];
        buf[di] = cData[di]; buf[di + 1] = cData[di + 1]; buf[di + 2] = cData[di + 2]; buf[di + 3] = cData[di + 3];
        counts[li]++;
      }

      var layers = [];
      for (i = 0; i < n; i++) {
        if (!counts[i]) continue;
        var lc = document.createElement('canvas'); lc.width = w; lc.height = h;
        lc.getContext('2d').putImageData(new ImageData(buffers[i], w, h), 0, 0);
        layers.push({ canvas: lc, depth: (i + 0.5) / n }); // 0 = farthest band, 1 = nearest
      }
      return { layers: layers, aspect: w / h };
    })['catch'](function () { return null; }); // bad/missing depth map -> permanent flat fallback
    cache[key] = p;
    return p;
  }

  function coverRect(aspect, x, y, w, h) {
    var dar = w / h, dw, dh, dx, dy;
    if (aspect > dar) { dh = h; dw = h * aspect; dx = x - (dw - w) / 2; dy = y; }
    else { dw = w; dh = w / aspect; dx = x; dy = y - (dh - h) / 2; }
    return { x: dx, y: dy, w: dw, h: dh };
  }

  function drawFlat(ctx, img, x, y, w, h) {
    var ar = img.naturalWidth / img.naturalHeight;
    var r = coverRect(ar, x, y, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  function tiltState() {
    if (!window.QTilt || QTilt.pct <= 0) return null;
    return { x: QTilt.x, y: QTilt.y, strength: QTilt.depth() * 0.9 * 1 };
  }

  var built = {}; // key -> {status:'loading'|'ready'|'failed', data}

  /**
   * Draw `colorSrc`+`depthSrc` (cover-fit) into ctx at x,y,w,h.
   * `fallbackImg` is drawn plain until the depth layers are ready, and
   * whenever tilt is off, so this is always safe to call every frame.
   */
  function render(ctx, colorSrc, depthSrc, fallbackImg, x, y, w, h) {
    var key = colorSrc + '|' + depthSrc;
    var tilt = tiltState();

    if (!built[key]) {
      built[key] = { status: 'loading' };
      build(colorSrc, depthSrc).then(function (data) {
        built[key] = data ? { status: 'ready', data: data } : { status: 'failed' };
      });
    }

    var b = built[key];
    if (!tilt || b.status !== 'ready') {
      drawFlat(ctx, fallbackImg, x, y, w, h);
      return;
    }

    var data = b.data;
    var m = Math.min(w, h);
    var strengthPx = tilt.strength * m;         // same magnitude convention as withTiltParallax
    var base = coverRect(data.aspect, x, y, w, h);
    var overscan = 1 + (2 * strengthPx) / Math.min(base.w, base.h);
    var dw = base.w * overscan, dh = base.h * overscan;
    var ox = base.x - (dw - base.w) / 2, oy = base.y - (dh - base.h) / 2;

    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    for (var i = 0; i < data.layers.length; i++) {
      var L = data.layers[i];
      var amt = (0.15 + 0.85 * L.depth) * strengthPx; // far bands drift least, near bands most
      ctx.drawImage(L.canvas, ox - tilt.x * amt, oy - tilt.y * amt, dw, dh);
    }
    ctx.restore();
  }

  window.DepthPhoto = { render: render, build: build };
})();
