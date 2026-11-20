/**
 * Runs inside the theme backdrop WebView. Every few seconds while the scene is
 * drawing, it copies the visible canvases into one small, heavily blurred
 * picture and posts it to the app as a data URL. Feed cards paint that picture
 * behind themselves (components/theme/CardFrost), so they read as frosted
 * glass over the wallpaper without a live blur per card.
 *
 * The copy is taken inside the scene's own animation frame, straight after it
 * draws, because a WebGL canvas without preserveDrawingBuffer is blank once
 * the frame has been shown.
 *
 * How the picture is made, so it stays smooth once stretched over the screen:
 * - The scene is drawn at roughly screen size, then halved step by step down
 *   to FROST_WIDTH. Each halving averages 2x2 pixels, so fine detail (star
 *   dust, rain) melts into its average colour. One big jump straight to a
 *   tiny canvas samples a few pixels instead, which turned single stars into
 *   blocky blobs on the cards.
 * - The blur is done in plain JS (three box passes, close to a Gaussian), not
 *   with the canvas `filter`, which older iOS WebViews ignore: there the cards
 *   showed the tiny copy unblurred.
 * - Colours get the same lift web's card glass gives them (saturate), so the
 *   glass carries the wallpaper's colour instead of a grey smudge.
 * - It is saved as PNG: JPEG's 8x8 blocks became big squares once stretched.
 */

/** Width of the posted picture in pixels; the height follows the screen. */
export const FROST_WIDTH = 96;
/** The blur in screen points, a little stronger than web's 24px card blur. */
export const FROST_BLUR_PT = 30;
/** Colour boost after the blur, like web's `saturate(200%)` on card glass. */
export const FROST_SATURATE = 1.8;

export const FROST_SNAPSHOT_SCRIPT = `(function(){
  if (window.__dehubFrost) return;
  var W = ${FROST_WIDTH}, BLUR = ${FROST_BLUR_PT}, SAT = ${FROST_SATURATE}, want = false, lastSent = '';
  var post = function(data){ try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ frost: data })); } catch (e) {} };
  var pool = [];
  function canvasAt(i, w, h){
    var c = pool[i] || (pool[i] = document.createElement('canvas'));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    try { x.imageSmoothingQuality = 'high'; } catch (e) {}
    return c;
  }
  // One box pass along rows (dx=1) or columns, clamped at the edges.
  function boxPass(src, dst, w, h, r, horizontal){
    var n = horizontal ? w : h, lines = horizontal ? h : w, div = 2 * r + 1;
    for (var line = 0; line < lines; line++) {
      var base = horizontal ? line * w : line, step = horizontal ? 1 : w;
      for (var ch = 0; ch < 3; ch++) {
        var sum = 0, k;
        for (k = -r; k <= r; k++) sum += src[(base + Math.min(n - 1, Math.max(0, k)) * step) * 4 + ch];
        for (var i = 0; i < n; i++) {
          dst[(base + i * step) * 4 + ch] = sum / div;
          var add = Math.min(n - 1, i + r + 1), drop = Math.max(0, i - r);
          sum += src[(base + add * step) * 4 + ch] - src[(base + drop * step) * 4 + ch];
        }
      }
    }
  }
  function blur(img, w, h, sigma){
    // Three box passes of this width match a Gaussian of the given sigma.
    var r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
    var a = img.data, b = new Uint8ClampedArray(a.length);
    for (var p = 0; p < 3; p++) { boxPass(a, b, w, h, r, true); boxPass(b, a, w, h, r, false); }
    // CSS saturate(): push each colour away from its own grey.
    for (var q = 0; q < a.length; q += 4) {
      var R = a[q], G = a[q + 1], B = a[q + 2], L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      a[q] = L + (R - L) * SAT; a[q + 1] = L + (G - L) * SAT; a[q + 2] = L + (B - L) * SAT; a[q + 3] = 255;
    }
  }
  function grab(){
    try {
      var vw = window.innerWidth, vh = window.innerHeight;
      if (!vw || !vh) return;
      // Start at the first power-of-two multiple of W that covers the screen.
      var big = W; while (big < vw) big *= 2;
      var bigH = Math.max(1, Math.round(big * vh / vw));
      var stage = canvasAt(0, big, bigH), ctx = stage.getContext('2d');
      ctx.globalAlpha = 1;
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#000';
      ctx.fillRect(0, 0, big, bigH);
      var list = document.querySelectorAll('canvas, video');
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (pool.indexOf(el) >= 0) continue;
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        var op = parseFloat(cs.opacity);
        ctx.globalAlpha = isNaN(op) ? 1 : Math.max(0, Math.min(1, op));
        ctx.drawImage(el, r.left * big / vw, r.top * bigH / vh, r.width * big / vw, r.height * bigH / vh);
      }
      ctx.globalAlpha = 1;
      // Halve down to W: every step is a clean 2x2 average.
      var src = stage, sw = big, sh = bigH, idx = 1;
      while (sw > W) {
        var nw = Math.max(W, Math.round(sw / 2)), nh = Math.max(1, Math.round(sh * nw / sw));
        var next = canvasAt(idx, nw, nh);
        next.getContext('2d').drawImage(src, 0, 0, sw, sh, 0, 0, nw, nh);
        src = next; sw = nw; sh = nh; idx = idx === 1 ? 2 : 1;
      }
      var sctx = src.getContext('2d');
      var img = sctx.getImageData(0, 0, sw, sh);
      blur(img, sw, sh, BLUR * sw / vw);
      sctx.putImageData(img, 0, 0);
      var data = src.toDataURL('image/png');
      if (data.length > 200 && data !== lastSent) { lastSent = data; post(data); }
    } catch (e) { /* a tainted canvas (cross-origin video) leaves cards on their plain tint */ }
  }
  var raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function(cb){
    return raf(function(t){ cb(t); if (want) { want = false; grab(); } });
  };
  window.__dehubFrost = { grab: function(){ want = true; } };
  // First copy soon after the scene's first frames, then a slow refresh while
  // it runs (a paused scene draws no frames, so nothing is copied then).
  setTimeout(function(){ want = true; }, 900);
  setInterval(function(){ want = true; }, 4000);
})();true;`;
