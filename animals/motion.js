/*!
 * motion.js — 共用動作引擎（塗鴉動物復活機 / 動物園 共用）
 * 純邏輯：給時間與參數，回傳這個 frame 的變形；不碰 DOM。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnimalMotion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function motion(mode, t, amp, speed) {
    var T = t * speed;
    var m = { rot: 0, sx: 1, sy: 1, ox: 0, oy: 0, warp: 0, lift: 0 };
    if (mode === 'breathe') {
      var s = Math.sin(T * 1.6);
      m.sy = 1 + 0.035 * amp * s;
      m.sx = 1 - 0.022 * amp * s;
      m.oy = 0.004 * amp * Math.sin(T * 1.6 + 0.5);
    } else if (mode === 'walk') {
      var b = Math.sin(T * 3.4);
      m.oy = -Math.abs(b) * 0.045 * amp;
      m.rot = 0.05 * amp * Math.sin(T * 1.7);
      m.ox = 0.012 * amp * Math.sin(T * 1.7 + Math.PI / 2);
      m.sy = 1 + 0.018 * amp * Math.cos(T * 6.8);
      m.lift = -m.oy;
    } else if (mode === 'jump') {
      var p = (T % 2.2) / 2.2;              // 0..1 一輪
      if (p < 0.16) {                       // 蹲
        var q = p / 0.16;
        m.sy = 1 - 0.10 * amp * q;
        m.sx = 1 + 0.07 * amp * q;
      } else if (p < 0.72) {                // 空中
        var a = (p - 0.16) / 0.56;
        var hgt = Math.sin(Math.PI * a);
        m.oy = 0.30 * amp * hgt;
        m.sy = 1 + 0.05 * amp * hgt;
        m.sx = 1 - 0.04 * amp * hgt;
        m.lift = m.oy;
      } else if (p < 0.84) {                // 落地
        var k = (p - 0.72) / 0.12;
        m.sy = 1 - 0.11 * amp * Math.sin(Math.PI * k);
        m.sx = 1 + 0.08 * amp * Math.sin(Math.PI * k);
      }
    } else if (mode === 'dance') {
      m.rot = 0.085 * amp * Math.sin(T * 2.2);
      m.ox = 0.022 * amp * Math.sin(T * 1.1);
      m.sy = 1 + 0.028 * amp * Math.sin(T * 4.4);
      m.warp = 0.85 * amp;
    } else if (mode === 'wave') {
      m.warp = 1.0 * amp;
      m.sy = 1 + 0.012 * amp * Math.sin(T * 1.3);
      m.rot = 0.015 * amp * Math.sin(T * 1.1);
    }
    return m;
  }

  /* 彈性變形：把圖橫切成很多細條，每條水平/垂直錯位 → 手繪的「軟軟感」
   * 條數要夠多（96）＋相鄰條重疊，否則線條會在接縫處被撕開（實測 16 條會裂） */
  function drawWarped(ctx, img, x, y, w, h, t, amp, speed, bands) {
    // bands 可調：一隻動物用 96 條（最滑順）；多隻動物時降條數保效能
    var N = Math.max(12, Math.min(96, Math.round(bands || 96))), t2 = t * speed;
    var bandH = h / N, srcBandH = img.height / N;
    var over = Math.max(1.2, bandH * 0.5);
    for (var i = 0; i < N; i++) {
      var cy = (i + 0.5) / N;
      var sway = Math.sin(t2 * 2.0 + cy * 2.2) * amp * 0.045 * w * (0.25 + cy);
      var vert = Math.cos(t2 * 1.5 + cy * 2.0) * amp * 0.010 * h * (0.25 + cy);
      ctx.drawImage(img, 0, i * srcBandH, img.width, srcBandH + 0.6,
        x + sway, y + i * bandH + vert - over * 0.5, w, bandH + over);
    }
  }

  return { motion: motion, drawWarped: drawWarped };
});
