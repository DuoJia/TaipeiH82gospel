/*!
 * zoo.js — 塗鴉動物園：多隻動物 + 四種背景
 * 影像前處理：../core.js（AnimalCore）｜動作：../motion.js（AnimalMotion）
 */
(function () {
  'use strict';

  var Core = window.AnimalCore, Motion = window.AnimalMotion;
  var ANIMS = ['breathe', 'walk', 'jump', 'dance', 'wave'];
  var ANIM_NAME = { breathe: '呼吸', walk: '走路', jump: '跳跳', dance: '跳舞', wave: '波浪' };

  var BG = {
    sea:    { ground: 0.84, shadow: 'rgba(0,60,80,.20)',   name: '海底世界' },
    grass:  { ground: 0.86, shadow: 'rgba(43,94,42,.20)',  name: '草原' },
    forest: { ground: 0.87, shadow: 'rgba(18,52,32,.28)',  name: '森林' },
    ice:    { ground: 0.85, shadow: 'rgba(70,120,160,.18)', name: '冰原' }
  };

  var state = {
    animals: [],
    bg: 'sea',
    playing: true,
    t: 0,
    selId: null,
    nextId: 1,
    recording: false,
    walkOn: true,
    fxOn: true,
    opts: { illum: true, removeBg: true }
  };
  var view = { w: 320, h: 240, dpr: 1 };
  var els = {};
  var lastTs = 0, zcounter = 0;
  var drag = null;
  var toastTimer = null;

  function $(s) { return document.querySelector(s); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 2400);
  }
  function busy(on, text) {
    if (!els.busy) return;
    els.busyText.textContent = text || '處理中…';
    els.busy.classList.toggle('hidden', !on);
  }
  function updateCount() {
    if (els.count) els.count.textContent = state.animals.length + ' 隻';
    if (els.empty) els.empty.classList.toggle('hidden', state.animals.length > 0);
  }

  /* ---------------- 尺寸 ---------------- */
  function resize() {
    var cv = els.stage;
    if (!cv) return;
    var r = cv.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width || 320));
    var h = Math.max(1, Math.round(r.height || 240));
    var dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    if (view.w !== w || view.h !== h || view.dpr !== dpr) {
      view.w = w; view.h = h; view.dpr = dpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
  }

  /* ---------------- 加入動物 ---------------- */
  function addFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(Boolean);
    if (!list.length) return Promise.resolve(0);
    var done = 0;
    busy(true, '加入第 1 隻…');
    var chain = Promise.resolve();
    list.forEach(function (file, i) {
      chain = chain.then(function () {
        busy(true, '加入第 ' + (i + 1) + '/' + list.length + ' 隻…');
        return loadOne(file).then(function () { done++; }).catch(function (e) {
          toast('有一張讀不進來：' + (e && e.message ? e.message : e));
        });
      });
    });
    return chain.then(function () {
      busy(false);
      updateCount();
      if (done) toast('加入了 ' + done + ' 隻動物 🐾');
      return done;
    });
  }

  function loadOne(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
          var MAX = 900, s = Math.min(1, MAX / Math.max(iw, ih));
          var w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var cx = c.getContext('2d');
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
          cx.drawImage(img, 0, 0, w, h);
          addImageData(cx.getImageData(0, 0, w, h));
          resolve();
        } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('照片讀不進來')); };
      img.src = url;
    });
  }

  /* 擺位：在候選點中挑「離其他動物最遠」的位置，避免大家疊在一起 */
  function pickSpot() {
    var g = BG[state.bg].ground;
    var cols = 5;
    var best = null, bestScore = -1;
    for (var i = 0; i < 48; i++) {
      var col = Math.floor(Math.random() * cols);
      var front = Math.random() < 0.62;                 // 62% 站前面
      var x = clamp((col + 0.5) / cols + rand(-0.055, 0.055), 0.10, 0.90);
      var y = clamp(front ? g - rand(0.005, 0.035) : g - rand(0.055, 0.115), g - 0.30, g + 0.02);
      var minD = 9;
      for (var k = 0; k < state.animals.length; k++) {
        var a = state.animals[k];
        var dx = (a.x - x), dy = (a.y - y) * 2.4;         // 上下權重較高（深度感）
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < minD) minD = d;
      }
      if (minD > bestScore) { bestScore = minD; best = { x: x, y: y }; }
    }
    return best || { x: 0.5, y: g - 0.02 };
  }

  function addImageData(imageData) {
    var res = Core.process(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height, state.opts);
    var full = document.createElement('canvas');
    full.width = res.width; full.height = res.height;
    full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(res.data), res.width, res.height), 0, 0);

    var b = res.bbox;
    var sp = document.createElement('canvas');
    sp.width = Math.max(1, b.w); sp.height = Math.max(1, b.h);
    sp.getContext('2d').drawImage(full, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);

    var spot = pickSpot();
    var nid = state.nextId++;
    var animal = {
      id: nid,
      name: '動物 ' + nid,
      sprite: sp,
      x: spot.x,
      y: spot.y,
      size: rand(0.80, 1.12),
      anim: ANIMS[Math.floor(Math.random() * ANIMS.length)],
      phase: rand(0, 6),
      speed: rand(0.9, 1.1),
      flip: Math.random() < 0.4,
      fx: guessFx(sp),
      pause: rand(0.2, 1.2)
    };
    pickWanderTarget(animal);
    animal.x = clampX(animal, animal.x);
    state.animals.push(animal);
    updateCount();
    return animal;
  }

  /* ---------------- 背景 ---------------- */
  function skyGrad(ctx, w, h, stops) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawSea(ctx, w, h, t) {
    skyGrad(ctx, w, h, [[0, '#04263f'], [0.35, '#0a5580'], [0.72, '#1490ad'], [1, '#28c2c0']]);
    // 光柱
    ctx.save();
    for (var i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.06 + 0.02 * Math.sin(t * 0.6 + i);
      ctx.fillStyle = '#eaffff';
      ctx.beginPath();
      var x0 = w * (0.08 + i * 0.24) + Math.sin(t * 0.3 + i) * 12;
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 + w * 0.09, 0);
      ctx.lineTo(x0 + w * 0.20, h * 0.85);
      ctx.lineTo(x0 + w * 0.06, h * 0.85);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // 氣泡
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 1.4;
    for (var b = 0; b < 16; b++) {
      var ph = ((t * 0.09 + b * 0.117) % 1);
      var by = h * (1 - ph * 1.05) - h * 0.05;
      var bx = w * (0.05 + ((b * 0.37) % 0.9)) + Math.sin(t * 1.2 + b) * 6;
      var br = 2 + (b % 4) * 1.6;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    // 小魚
    ctx.save();
    for (var f = 0; f < 3; f++) {
      var fx = (((t * 0.035 + f * 0.33) % 1.2) * w) - w * 0.1;
      var fy = h * (0.28 + f * 0.14) + Math.sin(t * 1.6 + f) * 5;
      var fs = 8 + f * 3;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = f === 0 ? '#ffd166' : (f === 1 ? '#8be9fd' : '#ffb4a2');
      ctx.beginPath();
      ctx.ellipse(fx, fy, fs, fs * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(fx - fs, fy);
      ctx.lineTo(fx - fs * 1.7, fy - fs * 0.5);
      ctx.lineTo(fx - fs * 1.7, fy + fs * 0.5);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // 海草
    var gy = h * BG.sea.ground;
    ctx.save();
    ctx.strokeStyle = '#1f8f63';
    ctx.lineWidth = Math.max(3, w * 0.008);
    ctx.lineCap = 'round';
    for (var s2 = 0; s2 < 7; s2++) {
      var sx = w * (0.06 + s2 * 0.135);
      var sh = h * (0.10 + (s2 % 3) * 0.06);
      var sway = Math.sin(t * 1.3 + s2) * w * 0.012;
      ctx.beginPath();
      ctx.moveTo(sx, gy + 4);
      ctx.quadraticCurveTo(sx + sway, gy - sh * 0.6, sx + sway * 2, gy - sh);
      ctx.stroke();
    }
    ctx.restore();
    // 沙地
    var sand = ctx.createLinearGradient(0, gy, 0, h);
    sand.addColorStop(0, '#f0e2b6'); sand.addColorStop(1, '#cbaa74');
    ctx.fillStyle = sand;
    ctx.fillRect(0, gy, w, h - gy);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (var p = 0; p < 22; p++) {
      var px = (p * 0.137 % 1) * w, py = gy + 6 + ((p * 53) % 40) / 40 * (h - gy - 8);
      ctx.beginPath(); ctx.arc(px, py, 1.4 + (p % 3) * 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawGrass(ctx, w, h, t) {
    skyGrad(ctx, w, h, [[0, '#bfe9ff'], [0.55, '#e8f7ff'], [1, '#f6ffe9']]);
    // 太陽
    var sx = w * 0.82, sy = h * 0.15, sr = Math.min(w, h) * 0.07;
    var rg = ctx.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * 2.6);
    rg.addColorStop(0, 'rgba(255,229,138,.95)'); rg.addColorStop(1, 'rgba(255,229,138,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(sx, sy, sr * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    // 雲
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    for (var i = 0; i < 4; i++) {
      var cx = (((t * (0.008 + i * 0.004) + i * 0.28) % 1.3) * w) - w * 0.15;
      var cy = h * (0.10 + 0.06 * (i % 3));
      puff(ctx, cx, cy + Math.sin(t * 0.5 + i) * 2, Math.min(w, h) * (0.045 + 0.012 * (i % 2)));
    }
    var gy = h * BG.grass.ground;
    // 遠山
    ctx.fillStyle = '#cdeec0';
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.quadraticCurveTo(w * 0.22, gy - h * 0.16, w * 0.46, gy);
    ctx.quadraticCurveTo(w * 0.7, gy - h * 0.1, w, gy - h * 0.04);
    ctx.lineTo(w, gy); ctx.closePath(); ctx.fill();
    // 草地
    var g = ctx.createLinearGradient(0, gy, 0, h);
    g.addColorStop(0, '#9fe07f'); g.addColorStop(1, '#63c051');
    ctx.fillStyle = g; ctx.fillRect(0, gy, w, h - gy);
    // 草
    ctx.strokeStyle = '#4fae40';
    ctx.lineWidth = Math.max(1.2, w * 0.0035);
    ctx.lineCap = 'round';
    for (var k = 0; k < 16; k++) {
      var gx = ((k * 0.071 + 0.03) % 1) * w;
      var gyy = gy + 6 + ((k * 37) % 11) / 11 * (h - gy - 8);
      var sw = Math.sin(t * 1.6 + k) * w * 0.006;
      ctx.beginPath();
      ctx.moveTo(gx, gyy);
      ctx.quadraticCurveTo(gx + sw * 0.5, gyy - h * 0.03, gx + sw, gyy - h * 0.055);
      ctx.stroke();
    }
    // 小花
    for (var fl = 0; fl < 6; fl++) {
      var fx = ((fl * 0.19 + 0.08) % 1) * w, fy = gy + (h - gy) * (0.28 + (fl % 3) * 0.22);
      ctx.fillStyle = ['#ff8fb1', '#ffd166', '#c084fc'][fl % 3];
      ctx.beginPath(); ctx.arc(fx, fy, Math.max(2, w * 0.006), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.beginPath(); ctx.arc(fx, fy, Math.max(1, w * 0.0025), 0, Math.PI * 2); ctx.fill();
    }
    // 蝴蝶
    ctx.save();
    for (var bf = 0; bf < 2; bf++) {
      var bx = w * (0.3 + bf * 0.4) + Math.sin(t * 0.9 + bf * 2) * w * 0.06;
      var by = gy - h * (0.12 + 0.05 * Math.sin(t * 1.7 + bf));
      var wing = Math.abs(Math.sin(t * 9 + bf)) * w * 0.008 + w * 0.003;
      ctx.fillStyle = bf ? '#ffb703' : '#ff8fb1';
      ctx.beginPath(); ctx.ellipse(bx - wing, by, wing, wing * 1.6, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(bx + wing, by, wing, wing * 1.6, -0.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawForest(ctx, w, h, t) {
    skyGrad(ctx, w, h, [[0, '#1c5238'], [0.42, '#3d8a58'], [0.8, '#66ab63']]);
    // 陽光光斑
    ctx.save();
    for (var i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.09 + 0.03 * Math.sin(t * 0.5 + i);
      ctx.fillStyle = '#f7ffd9';
      ctx.beginPath();
      var x0 = w * (0.16 + i * 0.3);
      ctx.moveTo(x0, 0); ctx.lineTo(x0 + w * 0.10, 0);
      ctx.lineTo(x0 + w * 0.28, h * 0.9); ctx.lineTo(x0 + w * 0.08, h * 0.9);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // 遠樹
    var gy = h * BG.forest.ground;
    for (var f = 0; f < 8; f++) {
      var tx = w * (0.04 + f * 0.13) + ((f % 2) ? 6 : -4);
      var th = h * (0.40 + (f % 3) * 0.09);
      ctx.fillStyle = f % 2 ? '#2b7a4d' : '#337f52';
      ctx.fillRect(tx - w * 0.012, gy - th, w * 0.024, th);
      var r = h * (0.10 + (f % 3) * 0.025);
      ctx.beginPath();
      ctx.arc(tx, gy - th, r, 0, Math.PI * 2);
      ctx.arc(tx - r * 0.8, gy - th + r * 0.4, r * 0.75, 0, Math.PI * 2);
      ctx.arc(tx + r * 0.8, gy - th + r * 0.35, r * 0.78, 0, Math.PI * 2);
      ctx.fill();
    }
    // 地面
    var g = ctx.createLinearGradient(0, gy, 0, h);
    g.addColorStop(0, '#4e9a5f'); g.addColorStop(1, '#2c6b45');
    ctx.fillStyle = g; ctx.fillRect(0, gy, w, h - gy);
    // 光斑（讓暗綠地面有層次，動物才不會融進去）
    ctx.save();
    for (var lp = 0; lp < 5; lp++) {
      ctx.globalAlpha = 0.10 + 0.04 * Math.sin(t * 0.8 + lp);
      ctx.fillStyle = '#f4ffd0';
      ctx.beginPath();
      ctx.ellipse(w * (0.1 + lp * 0.2), gy + (h - gy) * (0.3 + (lp % 3) * 0.2),
        w * 0.10, h * 0.022, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // 草叢
    ctx.fillStyle = '#57a866';
    for (var b = 0; b < 9; b++) {
      var bx = ((b * 0.117 + 0.05) % 1) * w;
      var by = gy + (h - gy) * (0.2 + (b % 4) * 0.2);
      var br = Math.max(6, w * 0.03);
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.arc(bx + br * 0.8, by + br * 0.2, br * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    // 地面小花
    for (var fl2 = 0; fl2 < 7; fl2++) {
      var fx2 = ((fl2 * 0.163 + 0.06) % 1) * w;
      var fy2 = gy + (h - gy) * (0.22 + (fl2 % 3) * 0.22);
      ctx.fillStyle = ['#ffffff', '#ffd9e6', '#fff3bf'][fl2 % 3];
      ctx.beginPath(); ctx.arc(fx2, fy2, Math.max(1.8, w * 0.0045), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.beginPath(); ctx.arc(fx2, fy2, Math.max(0.8, w * 0.0018), 0, Math.PI * 2); ctx.fill();
    }
    // 小莓果（亮點，避免畫面太暗）
    for (var br2 = 0; br2 < 9; br2++) {
      var bx2 = ((br2 * 0.137 + 0.03) % 1) * w;
      var by2 = gy + (h - gy) * (0.12 + (br2 % 4) * 0.19);
      ctx.fillStyle = br2 % 2 ? '#ff8fa3' : '#ffd166';
      ctx.beginPath(); ctx.arc(bx2, by2, Math.max(1.8, w * 0.005), 0, Math.PI * 2); ctx.fill();
    }
    // 螢火蟲
    for (var ff = 0; ff < 10; ff++) {
      var fx = ((ff * 0.23 + 0.07) % 1) * w + Math.sin(t * 0.7 + ff) * 10;
      var fy = gy - h * (0.06 + ((ff * 0.11) % 0.5)) + Math.cos(t * 0.9 + ff * 1.7) * 6;
      var pulse = 0.35 + 0.35 * Math.sin(t * 2.2 + ff);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#fdfd96';
      ctx.beginPath(); ctx.arc(fx, fy, Math.max(1.6, w * 0.004), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawIce(ctx, w, h, t) {
    skyGrad(ctx, w, h, [[0, '#dff3ff'], [0.45, '#c6e8ff'], [1, '#eaf7ff']]);
    // 極光
    ctx.save();
    for (var a = 0; a < 3; a++) {
      ctx.globalAlpha = 0.16 + 0.06 * Math.sin(t * 0.5 + a);
      var g2 = ctx.createLinearGradient(0, 0, w, h * 0.5);
      g2.addColorStop(0, '#8ef0c9'); g2.addColorStop(1, '#b9b0ff');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(0, h * (0.10 + a * 0.05));
      ctx.quadraticCurveTo(w * 0.5, h * (0.02 + a * 0.06) + Math.sin(t * 0.5 + a) * 8, w, h * (0.14 + a * 0.05));
      ctx.lineTo(w, h * (0.24 + a * 0.05));
      ctx.quadraticCurveTo(w * 0.5, h * (0.10 + a * 0.06), 0, h * (0.20 + a * 0.05));
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    var gy = h * BG.ice.ground;
    // 遠方雪山
    [[0.07, 0.36], [0.28, 0.27], [0.50, 0.33], [0.74, 0.25], [0.93, 0.31]].forEach(function (p) {
      var sx2 = w * p[0], sh2 = h * p[1];
      // 山體
      var mg = ctx.createLinearGradient(sx2, gy - sh2, sx2, gy);
      mg.addColorStop(0, '#b7d8ef'); mg.addColorStop(1, '#d8ecf8');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.moveTo(sx2 - w * 0.16, gy);
      ctx.lineTo(sx2, gy - sh2);
      ctx.lineTo(sx2 + w * 0.16, gy);
      ctx.closePath(); ctx.fill();
      // 山頂積雪
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(sx2 - w * 0.045, gy - sh2 * 0.72);
      ctx.lineTo(sx2, gy - sh2);
      ctx.lineTo(sx2 + w * 0.045, gy - sh2 * 0.72);
      ctx.closePath(); ctx.fill();
    });
    // 冰山
    ctx.fillStyle = '#dff0fb';
    [[0.14, 0.22], [0.36, 0.15], [0.62, 0.26], [0.86, 0.18]].forEach(function (p, i) {
      var bx = w * p[0], bh = h * p[1];
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.10, gy);
      ctx.lineTo(bx - w * 0.02, gy - bh);
      ctx.lineTo(bx + w * 0.06, gy - bh * 0.7);
      ctx.lineTo(bx + w * 0.11, gy);
      ctx.closePath(); ctx.fill();
    });
    // 雪地
    var g = ctx.createLinearGradient(0, gy, 0, h);
    g.addColorStop(0, '#fbfeff'); g.addColorStop(1, '#d3e9f7');
    ctx.fillStyle = g; ctx.fillRect(0, gy, w, h - gy);
    // 雪丘
    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath();
    ctx.moveTo(0, gy + 4);
    ctx.quadraticCurveTo(w * 0.3, gy - h * 0.03, w * 0.55, gy + 4);
    ctx.quadraticCurveTo(w * 0.8, gy + h * 0.02, w, gy);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    // 浮冰（雪地上的小白塊，增加層次）
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.9;
    [[0.16, 0.30], [0.38, 0.55], [0.62, 0.34], [0.82, 0.60], [0.28, 0.74]].forEach(function (p, i) {
      var fx = w * p[0], fy = gy + (h - gy) * p[1];
      var fw = w * (0.075 + (i % 3) * 0.02), fh = fw * 0.30;
      // 影子
      ctx.save();
      ctx.globalAlpha = 0.16; ctx.fillStyle = '#5b93b8';
      ctx.beginPath(); ctx.ellipse(fx + fw * 0.08, fy + fh * 0.55, fw * 0.95, fh * 0.75, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      var fg = ctx.createLinearGradient(fx, fy - fh, fx, fy + fh);
      fg.addColorStop(0, '#ffffff'); fg.addColorStop(1, '#d5ebf8');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.ellipse(fx, fy, fw, fh, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,175,210,.75)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    });
    ctx.restore();

    // 飄雪
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    for (var s = 0; s < 26; s++) {
      var sx = ((s * 0.137 + t * 0.012 * (1 + (s % 3))) % 1) * w;
      var sy = ((s * 0.211 + t * 0.02 * (1 + (s % 2))) % 1) * h;
      var sr = Math.max(1.2, w * (0.0025 + (s % 3) * 0.0015));
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }
    // 亮點
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    for (var k = 0; k < 8; k++) {
      var kx = ((k * 0.17 + 0.05) % 1) * w;
      var ky = gy + (h - gy) * (0.25 + (k % 3) * 0.2);
      ctx.globalAlpha = 0.4 + 0.4 * Math.sin(t * 2 + k);
      ctx.beginPath(); ctx.arc(kx, ky, Math.max(1, w * 0.003), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function puff(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.95, cy + r * 0.18, r * 0.78, 0, Math.PI * 2);
    ctx.arc(cx - r * 0.9, cy + r * 0.22, r * 0.72, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.1, cy - r * 0.55, r * 0.66, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBg(ctx, w, h, t) {
    if (state.bg === 'grass') drawGrass(ctx, w, h, t);
    else if (state.bg === 'forest') drawForest(ctx, w, h, t);
    else if (state.bg === 'ice') drawIce(ctx, w, h, t);
    else drawSea(ctx, w, h, t);
  }

  /* ---------------- 動物 ---------------- */
  function animalGeom(a, w, h) {
    var ground = h * BG[state.bg].ground;
    var depth = clamp((a.y - (BG[state.bg].ground - 0.09)) / 0.09, 0, 1);
    var baseH = h * 0.30;
    var hh = baseH * a.size * (0.72 + 0.5 * depth);
    var ww = hh * (a.sprite.width / a.sprite.height);
    return { cx: a.x * w, base: a.y * h, w: ww, h: hh, ground: ground };
  }

  /* 依動物實際寬度夾住 x：不會有一半跑到畫面外 */
  function clampX(a, x) {
    var G = animalGeom(a, view.w, view.h);
    var half = (G.w / 2) / Math.max(1, view.w);
    var lo = Math.min(0.5, half + 0.03), hi = Math.max(0.5, 1 - half - 0.03);
    return clamp(x, lo, hi);
  }

  function bandsFor(n) {
    return n <= 2 ? 96 : (n <= 5 ? 56 : 32);
  }

  function drawAnimals(ctx, w, h, t) {
    var sorted = state.animals.slice().sort(function (p, q) { return p.y - q.y; });
    var bands = bandsFor(sorted.length);
    sorted.forEach(function (a) {
      var G = animalGeom(a, w, h);
      // 影子
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = BG[state.bg].shadow;
      ctx.beginPath();
      ctx.ellipse(G.cx, G.base, G.w * 0.36, G.h * 0.055, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      var m = Motion.motion(a.anim, t + a.phase, 1, a.speed);
      ctx.save();
      ctx.translate(G.cx + m.ox * G.w, G.base + m.oy * G.h);
      if (a.flip) ctx.scale(-1, 1);
      if (m.rot) ctx.rotate(m.rot);
      ctx.scale(m.sx, m.sy);
      var x = -G.w / 2, y = -G.h;
      if (m.warp > 0.01) Motion.drawWarped(ctx, a.sprite, x, y, G.w, G.h, t + a.phase, m.warp, a.speed, bands);
      else ctx.drawImage(a.sprite, x, y, G.w, G.h);
      ctx.restore();

      // 選取提示
      if (state.selId === a.id) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.lineWidth = 3;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.ellipse(G.cx, G.base, G.w * 0.46, G.h * 0.10, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  /* ---------------- 角色特效（火／電／冰／風） ---------------- */
  var particles = [];
  var MAXP = 420;
  var FX_RATE = { fire: 26, ice: 22, wind: 15 };

  function guessFx(sprite) {
    try {
      var c = document.createElement('canvas');
      c.width = 24; c.height = 24;
      var x = c.getContext('2d');
      x.drawImage(sprite, 0, 0, 24, 24);
      var d = x.getImageData(0, 0, 24, 24).data;
      var r = 0, g = 0, b = 0, n = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        var mx = Math.max(d[i], d[i + 1], d[i + 2]);
        var mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (mx === 0 || (mx - mn) / mx < 0.18) continue;   // 黑白灰不算角色色
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      if (!n) return null;
      r /= n; g /= n; b /= n;
      // 用色相判斷比較穩（橙=火、黃=電、綠=風、藍紫=冰）
      var mx2 = Math.max(r, g, b), mn2 = Math.min(r, g, b);
      var sat2 = mx2 === 0 ? 0 : (mx2 - mn2) / mx2;
      if (sat2 < 0.25) return null;
      var hue;
      if (mx2 === r) hue = 60 * (((g - b) / (mx2 - mn2)) % 6);
      else if (mx2 === g) hue = 60 * ((b - r) / (mx2 - mn2) + 2);
      else hue = 60 * ((r - g) / (mx2 - mn2) + 4);
      if (hue < 0) hue += 360;
      if (hue < 42 || hue >= 300) return 'fire';     // 紅／橙（小火龍）
      if (hue < 70) return 'bolt';                   // 黃（皮卡丘）
      if (hue < 170) return 'wind';                  // 綠（風）
      return 'ice';                                  // 藍／紫（Elsa）
    } catch (e) { return null; }
  }

  function spawnFx(a, dt) {
    if (!state.fxOn || !a.fx) return;
    if (particles.length > MAXP) return;
    var G = animalGeom(a, view.w, view.h);
    var dir = a.flip ? -1 : 1;
    var ox = G.cx + dir * G.w * 0.42;
    // 從「嘴巴」附近噴：約 0.72 身高（四足/鳥類都在上半身）
    var oy = G.base - G.h * 0.72;

    if (a.fx === 'bolt') {
      a.fxBoltT = (a.fxBoltT === undefined) ? rand(0.3, 1.0) : a.fxBoltT - dt;
      if (a.fxBoltT <= 0) {
        a.fxBoltT = rand(0.8, 1.6);
        particles.push({ k: 'bolt', x: ox, y: oy, vx: dir * rand(35, 65), vy: rand(-8, 8),
          life: 0, max: 0.30, size: rand(13, 21), dir: dir });
        for (var s = 0; s < 5; s++) {
          particles.push({ k: 'spark', x: ox, y: oy, vx: dir * rand(50, 150), vy: rand(-80, 80),
            life: 0, max: rand(0.25, 0.5), size: rand(2, 4.5) });
        }
      }
      return;
    }

    var rate = FX_RATE[a.fx] || 0;
    a.fxAcc = (a.fxAcc || 0) + dt * rate;
    while (a.fxAcc >= 1 && particles.length < MAXP) {
      a.fxAcc -= 1;
      if (a.fx === 'fire') {
        particles.push({ k: 'fire', x: ox + rand(-4, 4), y: oy + rand(-5, 5),
          vx: dir * rand(20, 60), vy: rand(-60, -18),
          life: 0, max: rand(0.5, 0.95), size: rand(5, 11) });
      } else if (a.fx === 'ice') {
        particles.push({ k: 'ice', x: ox, y: oy + rand(-7, 7),
          vx: dir * rand(55, 115), vy: rand(-25, 10),
          life: 0, max: rand(0.6, 1.0), size: rand(7, 13), rot: rand(0, 6.28), vr: rand(-6, 6) });
      } else if (a.fx === 'wind') {
        particles.push({ k: 'wind', x: ox, y: oy + rand(-12, 12),
          vx: dir * rand(60, 125), vy: rand(-14, 14),
          life: 0, max: rand(0.6, 1.0), size: rand(9, 20), rot: rand(-0.6, 0.6), vr: rand(-1.6, 1.6) });
      }
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.k === 'fire') { p.vy -= 40 * dt; p.vx *= 0.985; }
      else if (p.k === 'ice') { p.vy += 130 * dt; p.rot += (p.vr || 0) * dt; }
      else if (p.k === 'wind') { p.vy += Math.sin(p.life * 7 + p.size) * 30 * dt; p.rot += (p.vr || 0) * dt; }
      else { p.vy += 90 * dt; }
      if (p.life >= p.max) particles.splice(i, 1);
    }
  }

  function drawParticles(ctx) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var k = 1 - p.life / p.max;
      if (k <= 0) continue;
      ctx.save();
      if (p.k === 'fire') {
        var r = p.size * (0.45 + 0.65 * k);
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, 'rgba(255,252,210,' + (0.95 * k) + ')');
        g.addColorStop(0.45, 'rgba(255,170,40,' + (0.85 * k) + ')');
        g.addColorStop(1, 'rgba(225,55,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      } else if (p.k === 'bolt') {
        // 卡通式閃電：深色外框 + 亮黃 + 白核心 → 在任何背景都看得見
        var bx = p.x, by = p.y;
        var segs = 7, ptsX = [bx], ptsY = [by];
        for (var s2 = 0; s2 < segs; s2++) {
          bx += p.dir * p.size * 0.8;
          by += (s2 % 2 ? -1 : 1) * p.size * 0.62;
          ptsX.push(bx); ptsY.push(by);
        }
        function boltPath() {
          ctx.beginPath();
          ctx.moveTo(ptsX[0], ptsY[0]);
          for (var q = 1; q < ptsX.length; q++) ctx.lineTo(ptsX[q], ptsY[q]);
        }
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(255,224,80,' + (0.9 * k) + ')';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = 'rgba(60,45,0,' + (0.65 * k) + ')';
        ctx.lineWidth = 8;
        boltPath(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,226,60,' + (1 * k) + ')';
        ctx.lineWidth = 5;
        boltPath(); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,235,' + (0.95 * k) + ')';
        ctx.lineWidth = 1.8;
        boltPath(); ctx.stroke();
      } else if (p.k === 'spark') {
        ctx.fillStyle = 'rgba(255,246,170,' + Math.min(1, 1.4 * k) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.6, p.size * k), 0, Math.PI * 2); ctx.fill();
      } else if (p.k === 'ice') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        var sz = p.size * (0.55 + 0.55 * k);
        ctx.fillStyle = 'rgba(214,245,255,' + (0.95 * k) + ')';
        ctx.strokeStyle = 'rgba(60,150,205,' + (0.95 * k) + ')';
        ctx.lineWidth = 1.8;
        ctx.shadowColor = 'rgba(180,235,255,' + (0.9 * k) + ')';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.62, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz * 0.62, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (p.k === 'wind') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.6 * k) + ')';
        ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(0, 0, p.size, -0.85, 0.85); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, p.size * 0.62, -0.6, 0.6); ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ---------------- 自己走來走去（會走遠走近） ---------------- */
  function pickWanderTarget(a) {
    var g = BG[state.bg].ground;
    var best = null, bestScore = -1;
    for (var i = 0; i < 12; i++) {
      var tx = rand(0.12, 0.88);
      var ty = clamp(g - rand(0.02, 0.26), g - 0.28, g + 0.01);
      var minD = 9;
      for (var k = 0; k < state.animals.length; k++) {
        var o = state.animals[k];
        if (o === a) continue;
        var dx = o.x - tx, dy = (o.y - ty) * 2.2;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < minD) minD = d;
      }
      // 已經有動物很近就不要去（避免疊在一起）
      var score = minD + (minD < 0.12 ? -9 : 0);
      if (score > bestScore) { bestScore = score; best = { x: tx, y: ty }; }
    }
    a.tx = best.x; a.ty = best.y;
  }

  /* 動物之間的軟排斥：靠太近就慢慢分開，不會疊成一團 */
  function separate() {
    var n = state.animals.length;
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var a = state.animals[i], b = state.animals[j];
        var dx = b.x - a.x;
        var dy = (b.y - a.y) * 2.2;
        if (Math.abs(dy) > 0.055) continue;            // 前後不同層就不用管
        if (Math.abs(dx) > 0.135) continue;
        var push = (0.135 - Math.abs(dx)) * 0.62 * (dx >= 0 ? 1 : -1);
        a.x = clampX(a, a.x - push);
        b.x = clampX(b, b.x + push);
      }
    }
  }

  function updateWander(a, dt) {
    if (!state.walkOn) return;
    if (a.pause > 0) { a.pause -= dt; return; }
    if (a.tx === undefined) pickWanderTarget(a);
    var dx = a.tx - a.x, dy = a.ty - a.y;
    var mx = 0.075 * (a.speed || 1) * dt;
    var my = 0.035 * dt;
    if (Math.abs(dx) <= mx) a.x = a.tx; else a.x += (dx > 0 ? 1 : -1) * mx;
    if (Math.abs(dy) <= my) a.y = a.ty; else a.y += (dy > 0 ? 1 : -1) * my;
    if (Math.abs(dx) > 0.004) a.flip = dx < 0;
    if (a.x === a.tx && a.y === a.ty) {
      a.pause = rand(0.5, 2.2);
      pickWanderTarget(a);
    }
  }

  /* 每一格推進（走動＋粒子）；測試可直接呼叫
     ⚠️ 不要命名為 step：主迴圈裡的 rAF 回呼也叫 step，會遞迴爆掉 */
  function advance(dt) {
    for (var i = 0; i < state.animals.length; i++) {
      var a = state.animals[i];
      // 正在被手指拖的那隻不要自己走（不然會跟手指打架）
      if (!(drag && drag.id === a.id)) updateWander(a, dt);
      a.x = clampX(a, a.x);
      spawnFx(a, dt);
    }
    if (state.walkOn) separate();
    updateParticles(dt);
  }

  /* ---------------- 主迴圈 ---------------- */
  function drawFrame(t) {
    var cv = els.stage;
    if (!cv) return;
    var ctx = cv.getContext('2d');
    if (!ctx) return;
    var w = view.w, h = view.h;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawBg(ctx, w, h, t);
    drawParticles(ctx);          // 特效在動物後面：不會蓋住小朋友畫的五官
    drawAnimals(ctx, w, h, t);
  }

  function loop() {
    var step = function (ts) {
      var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
      lastTs = ts;
      if (state.playing) { state.t += dt; advance(dt); }
      drawFrame(state.t);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------------- 互動 ---------------- */
  function hitTest(px, py) {
    var sorted = state.animals.slice().sort(function (p, q) { return q.y - p.y; });
    for (var i = 0; i < sorted.length; i++) {
      var a = sorted[i];
      var G = animalGeom(a, view.w, view.h);
      if (px >= G.cx - G.w / 2 && px <= G.cx + G.w / 2 && py >= G.base - G.h && py <= G.base + G.h * 0.08) return a;
    }
    return null;
  }

  function localPoint(ev) {
    var cv = els.stage;
    var r = cv.getBoundingClientRect();
    var p = (ev.touches && ev.touches[0]) || ev;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }

  function onDown(ev) {
    var p = localPoint(ev);
    var a = hitTest(p.x, p.y);
    if (a) {
      state.selId = a.id;
      var G = animalGeom(a, view.w, view.h);
      drag = { id: a.id, dx: (a.x * view.w) - p.x, dy: (a.y * view.h) - p.y, moved: 0, sx: p.x, sy: p.y };
      showTools(a);
    } else {
      state.selId = null;
      drag = null;
      hideTools();
    }
    if (els.stage.setPointerCapture && ev.pointerId !== undefined) {
      try { els.stage.setPointerCapture(ev.pointerId); } catch (e) {}
    }
    if (ev.preventDefault) ev.preventDefault();
  }

  function onMove(ev) {
    if (!drag) return;
    var p = localPoint(ev);
    drag.moved += Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy);
    var a = state.animals.filter(function (x) { return x.id === drag.id; })[0];
    if (!a) return;
    var nx = (p.x + drag.dx) / view.w;
    var ny = (p.y + drag.dy) / view.h;
    var ground = BG[state.bg].ground;
    a.x = clampX(a, nx);
    a.y = clamp(ny, ground - 0.30, ground + 0.02);
    if (ev.preventDefault) ev.preventDefault();
  }

  function onUp() {
    if (drag) {
      var a = state.animals.filter(function (x) { return x.id === drag.id; })[0];
      if (a) { a.pause = 1.2; pickWanderTarget(a); }
    }
    drag = null;
  }

  function showTools(a) {
    if (!els.tools) return;
    els.tools.classList.remove('hidden');
    if (els.toolName) els.toolName.textContent = a.name + '（' + ANIM_NAME[a.anim] + '）';
  }
  function hideTools() {
    if (els.tools) els.tools.classList.add('hidden');
  }
  function refreshTools() {
    var a = selected();
    if (!a) { hideTools(); return; }
    if (els.tools) els.tools.classList.remove('hidden');
    if (els.toolName) {
      els.toolName.textContent = a.name + '（' + ANIM_NAME[a.anim] +
        (a.fx ? '・' + FX_NAME[a.fx] : '') + '）';
    }
    if (els.tools) {
      Array.prototype.forEach.call(els.tools.querySelectorAll('button[data-fx]'), function (b) {
        var v = b.getAttribute('data-fx');
        var on = (v === 'none') ? !a.fx : (a.fx === v);
        b.classList.toggle('active', !!on);
      });
    }
  }
  var FX_NAME = { fire: '火', bolt: '電', ice: '冰', wind: '風' };

  function setFx(v) {
    var a = selected();
    if (!a) return;
    a.fx = (v === 'none' || !v) ? null : v;
    a.fxBoltT = 0.2;
    a.fxAcc = 0;
    refreshTools();
    toast(a.fx ? ('牠會噴' + FX_NAME[a.fx] + '了！') : '已關掉這隻的特效');
  }

  function selected() {
    return state.animals.filter(function (x) { return x.id === state.selId; })[0] || null;
  }

  function toolAction(act) {
    var a = selected();
    if (!a) return;
    if (act === 'anim') {
      var i = ANIMS.indexOf(a.anim);
      a.anim = ANIMS[(i + 1) % ANIMS.length];
    } else if (act === 'big') {
      a.size = clamp(a.size * 1.16, 0.4, 2.4);
    } else if (act === 'small') {
      a.size = clamp(a.size / 1.16, 0.4, 2.4);
    } else if (act === 'flip') {
      a.flip = !a.flip;
    } else if (act === 'del') {
      state.animals = state.animals.filter(function (x) { return x.id !== a.id; });
      state.selId = null;
      hideTools();
      updateCount();
      toast('刪掉一隻了');
      return;
    }
    refreshTools();
  }

  /* ---------------- 匯出 ---------------- */
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function exportPng() {
    var cv = els.stage;
    if (!cv || !cv.toBlob) { toast('這個瀏覽器不支援存圖'); return; }
    cv.toBlob(function (b) { if (b) { download(b, '塗鴉動物園.png'); toast('存好了 🖼️'); } }, 'image/png');
  }

  var MIMES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

  function exportVideo(seconds) {
    seconds = seconds || 6;
    var cv = els.stage;
    if (!cv || !cv.captureStream || typeof MediaRecorder === 'undefined') {
      toast('這個瀏覽器不能錄影，改用電腦 Chrome 試試 🙏');
      return Promise.resolve(false);
    }
    if (state.recording) return Promise.resolve(false);
    var mime = '';
    for (var i = 0; i < MIMES.length; i++) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(MIMES[i])) { mime = MIMES[i]; break; }
    }
    var stream, rec;
    try {
      stream = cv.captureStream(30);
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined);
    } catch (e) {
      toast('錄影啟動失敗');
      return Promise.resolve(false);
    }
    var chunks = [];
    state.recording = true;
    var btn = els.btnVideo;
    if (btn) { btn.disabled = true; btn.textContent = '🔴 錄影中…'; }
    return new Promise(function (resolve) {
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        state.recording = false;
        if (btn) { btn.disabled = false; btn.textContent = '📹 錄影 6 秒'; }
        try { stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) {}
        var type = mime || 'video/webm';
        download(new Blob(chunks, { type: type }), '塗鴉動物園.' + (type.indexOf('mp4') >= 0 ? 'mp4' : 'webm'));
        toast('影片好了 🎬');
        resolve(true);
      };
      try { rec.start(); } catch (e) { toast('錄影啟動失敗'); resolve(false); }
      setTimeout(function () { if (rec.state !== 'inactive') rec.stop(); }, seconds * 1000);
      toast('錄 ' + seconds + ' 秒，畫面不要動太多…');
    });
  }

  function isInAppBrowser() {
    var ua = (navigator && navigator.userAgent) || '';
    return /Telegram|FBAN|FBAV|Instagram|Line\/|MicroMessenger|Twitter|Snapchat/i.test(ua);
  }

  /* 綁定檔案選擇器：
   * ⚠️ 2026-10-28 修正：原本靠 <label for> 開檔案總管，但 id 與 for 曾經打錯（fileAlb / fileAlbum），
   * 造成「從相簿加」完全沒反應。現在一律自己呼叫 input.click()，並在 change 時才清 value。 */
  function wirePicker(input, label) {
    if (!input) return false;
    input.addEventListener('change', function (e) {
      var files = e.target.files, list = [];
      for (var i = 0; i < (files ? files.length : 0); i++) list.push(files[i]);
      if (!list.length) { toast('沒選到照片，再試一次'); input.value = ''; return; }
      addFiles(list).then(function () { input.value = ''; });
    });
    if (label && label.addEventListener) {
      label.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault();   // 避免同時觸發預設行為（會開兩次）
        try { input.click(); } catch (err) { toast('這個瀏覽器不給上傳，換一個瀏覽器試試'); }
      });
    }
    return true;
  }

  /* ---------------- 綁定 ---------------- */
  function bind() {
    els.stage = $('#stage');
    els.empty = $('#empty');
    els.busy = $('#busy');
    els.busyText = $('#busyText');
    els.count = $('#count');
    els.tools = $('#tools');
    els.toolName = $('#toolName');
    els.toast = $('#toast');
    els.btnVideo = $('#btnVideo');

    var cam = $('#fileCam'), alb = $('#fileAlbum');
    wirePicker(cam, $('#labCam'));
    wirePicker(alb, $('#labAlbum'));

    // 內建瀏覽器（Telegram / LINE / IG / FB）常常擋檔案上傳 → 提示改用外部瀏覽器
    var banner = $('#appBanner');
    if (banner && isInAppBrowser()) banner.classList.remove('hidden');

    var tw = $('#tgWalk');
    if (tw) {
      state.walkOn = tw.checked;
      tw.addEventListener('change', function () {
        state.walkOn = tw.checked;
        if (state.walkOn) state.animals.forEach(function (a) { a.pause = rand(0, 0.8); pickWanderTarget(a); });
      });
    }
    var tf = $('#tgFx');
    if (tf) {
      state.fxOn = tf.checked;
      tf.addEventListener('change', function () {
        state.fxOn = tf.checked;
        if (!tf.checked) particles.length = 0;
      });
    }

    var bgs = $('#bgs');
    if (bgs) bgs.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.bg-chip') : null;
      if (!b) return;
      var next = b.getAttribute('data-bg');
      if (!BG[next]) return;
      Array.prototype.forEach.call(bgs.querySelectorAll('.bg-chip'), function (c) { c.classList.remove('active'); });
      b.classList.add('active');
      var oldGround = BG[state.bg].ground;
      state.bg = next;
      // 動物跟著新地面走（保持相對深度）
      var newGround = BG[next].ground;
      state.animals.forEach(function (a) {
        var d = oldGround - a.y;
        a.y = clamp(newGround - d, newGround - 0.30, newGround + 0.02);
      });
      toast('換到「' + BG[next].name + '」');
    });

    var tools = $('#tools');
    if (tools) tools.addEventListener('click', function (e) {
      var fxBtn = e.target.closest ? e.target.closest('button[data-fx]') : null;
      if (fxBtn) { setFx(fxBtn.getAttribute('data-fx')); return; }
      var b = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!b) return;
      toolAction(b.getAttribute('data-act'));
    });

    var pause = $('#btnPause');
    if (pause) pause.addEventListener('click', function () {
      state.playing = !state.playing;
      pause.textContent = state.playing ? '⏸️ 暫停' : '▶️ 繼續';
    });

    var v = $('#btnVideo');
    if (v) v.addEventListener('click', function () { exportVideo(6); });
    var sh = $('#btnShot');
    if (sh) sh.addEventListener('click', exportPng);

    var full = $('#btnFull');
    if (full) full.addEventListener('click', function () {
      var wrap = $('#stageWrap');
      if (!wrap) return;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (wrap.requestFullscreen) {
        wrap.requestFullscreen().then(function () { setTimeout(resize, 60); }).catch(function () { toast('全螢幕被擋住了'); });
      } else toast('這個瀏覽器不支援全螢幕');
    });
    if (document.addEventListener) {
      document.addEventListener('fullscreenchange', function () { setTimeout(resize, 60); });
    }

    var st = els.stage;
    if (st.addEventListener) {
      st.addEventListener('pointerdown', onDown);
      st.addEventListener('pointermove', onMove);
      st.addEventListener('pointerup', onUp);
      st.addEventListener('pointercancel', onUp);
      st.addEventListener('pointerleave', onUp);
    }
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 150); });
  }

  function init() {
    if (!Core || !Motion) { console.error('core.js / motion.js 沒載入'); return; }
    if (!document.body) { document.addEventListener('DOMContentLoaded', init); return; }
    bind();
    resize();
    updateCount();
    loop();
  }

  init();

  // 測試 / 除錯用
  window.__zoo = {
    state: state,
    addImageData: addImageData,
    addFiles: addFiles,
    drawFrame: drawFrame,
    resize: resize,
    hitTest: hitTest,
    toolAction: toolAction,
    select: function (id) { state.selId = id; refreshTools(); },
    setBg: function (bg) { state.bg = bg; },
    exportPng: exportPng,
    exportVideo: exportVideo,
    geodesic: function (a) { return animalGeom(a, view.w, view.h); },
    step: advance,
    setFx: setFx,
    particles: particles,
    guessFx: guessFx,
    isInAppBrowser: isInAppBrowser,
    hasUploadWire: function () {
      return !!(document.getElementById('fileAlbum') &&
                document.getElementById('labAlbum') &&
                document.getElementById('labAlbum').getAttribute('for') === 'fileAlbum');
    }
  };
})();
