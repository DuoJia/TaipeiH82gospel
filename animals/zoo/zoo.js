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
    ice:    { ground: 0.85, shadow: 'rgba(70,120,160,.18)', name: '冰原' },
    park:   { ground: 0.86, shadow: 'rgba(48,96,40,.22)',  name: '公園' },
    fun:    { ground: 0.90, shadow: 'rgba(50,24,70,.30)',  name: '遊樂園' },
    track:  { ground: 0.88, shadow: 'rgba(110,50,40,.24)', name: '操場' }
  };

  var state = {
    animals: [],
    bg: 'sea',
    mode: 'side',          // 'side' = 側面（玩設施）｜'top' = 半 2D 俯視（可放很多隻）
    playing: true,
    t: 0,
    selId: null,
    nextId: 1,
    recording: false,
    walkOn: true,
    fxOn: true,
    facOn: true,
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

  function isTopo() { return state.mode === 'top'; }

  /* 每一種視角的「可站立範圍」（x / y 都是 0~1 的畫面比例） */
  var TOP_LO = 0.15, TOP_HI = 0.935;
  function yLimits() {
    if (isTopo()) return { lo: TOP_LO, hi: TOP_HI };
    var g = BG[state.bg].ground;
    return { lo: g - 0.30, hi: g + 0.02 };
  }

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
      topoCache.key = '';                 // 尺寸變了→俯視背景要重畫
    }
  }

  /* ---------------- 視角：側面 ↔ 俯視（半 2D） ---------------- */
  function syncViewUI() {
    var vs = $('#views');
    if (vs) Array.prototype.forEach.call(vs.querySelectorAll('.view-chip'), function (c) {
      c.classList.toggle('active', c.getAttribute('data-view') === state.mode);
    });
    var tfa = $('#tgFac');
    if (tfa) {
      tfa.disabled = false;
      var lab = tfa.parentElement;
      if (lab && lab.style) lab.style.opacity = '1';
    }
  }

  function setMode(m, silent) {
    if (m !== 'side' && m !== 'top') return;
    if (state.mode === m) { syncViewUI(); return; }
    var g = BG[state.bg].ground;
    state.animals.forEach(function (a) { if (a.ride) endRide(a); });
    state.mode = m;
    topoCache.key = ''; topoFront.key = '';
    if (m === 'top') {
      // 側面 → 俯視：依「原本的前後順序」把大家舖成一整片（最近的在下方、最遠的在上方）
      var order = state.animals.slice().sort(function (p, q) { return q.y - p.y; });
      var n = order.length;
      order.forEach(function (a, i) {
        var u = n <= 1 ? 0.45 : i / (n - 1);                 // 0 = 最近
        a.y = clamp(TOP_HI - 0.07 - u * (TOP_HI - TOP_LO - 0.14) + rand(-0.012, 0.012), TOP_LO, TOP_HI);
        a.x = clampX(a, a.x + rand(-0.02, 0.02));
        a.pause = rand(0.1, 0.8);
        pickWanderTarget(a);
      });
    } else {
      // 俯視 → 側面：回到地面的寬度裡（上遠下近）
      state.animals.forEach(function (a) {
        var u = clamp((a.y - TOP_LO) / (TOP_HI - TOP_LO), 0, 1);
        a.y = clamp(g - 0.02 - (1 - u) * 0.26, g - 0.30, g + 0.02);
        a.x = clampX(a, a.x);
        a.pause = rand(0.1, 0.8);
        pickWanderTarget(a);
      });
    }
    syncViewUI();
    if (!silent) toast(m === 'top'
      ? '切到俯視 🦅 整片地板都能放，設施也照樣會玩'
      : '切回側面 🙂 設施可以玩了');
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
    if (isTopo()) {                                     // 俯視：整片地板都是候選點
      var tb = null, tbScore = -1;
      for (var q = 0; q < 72; q++) {
        var tx = rand(0.09, 0.91), ty = rand(TOP_LO + 0.02, TOP_HI - 0.01);
        var td = 9;
        for (var m = 0; m < state.animals.length; m++) {
          var oa = state.animals[m];
          var ddx = oa.x - tx, ddy = (oa.y - ty) * 0.72;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd < td) td = dd;
        }
        if (!tb || td > tbScore) { tbScore = td; tb = { x: tx, y: ty }; }
      }
      return tb || { x: 0.5, y: 0.55 };
    }
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

  /* 去掉「淡淡的紙邊方框」：去背後偶爾會在四周留下一圈低透明度的紙邊，
     貼到場景上會變成一個看得見的方框。從四邊往內縮，直到碰到真正的主體。 */
  function trimFaint(cnv) {
    var w = cnv.width, h = cnv.height;
    if (!w || !h) return cnv;
    var cx = cnv.getContext('2d');
    var d;
    try { d = cx.getImageData(0, 0, w, h).data; } catch (e) { return cnv; }
    function rowMax(y) {
      var m = 0;
      for (var x = 0; x < w; x++) { var a = d[(y * w + x) * 4 + 3]; if (a > m) m = a; }
      return m;
    }
    function colMax(x, y0, y1) {
      var m = 0;
      for (var y = y0; y <= y1; y++) { var a = d[(y * w + x) * 4 + 3]; if (a > m) m = a; }
      return m;
    }
    var top = 0, bot = h - 1, left = 0, right = w - 1;
    while (top < h - 2 && rowMax(top) < 170) top++;
    while (bot > top + 1 && rowMax(bot) < 170) bot--;
    while (left < w - 2 && colMax(left, top, bot) < 170) left++;
    while (right > left + 1 && colMax(right, top, bot) < 170) right--;
    if (top === 0 && left === 0 && bot === h - 1 && right === w - 1) return cnv;
    var out = document.createElement('canvas');
    out.width = Math.max(1, right - left + 1);
    out.height = Math.max(1, bot - top + 1);
    out.getContext('2d').drawImage(cnv, left, top, out.width, out.height, 0, 0, out.width, out.height);
    return out;
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
    sp = trimFaint(sp);

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

/* ================= 俯視（半 2D）場景：整片地板，可以放很多隻 ================= */
  var TOPO = {
    sea:    ['#cdf1fd', '#7ecfe8', '#2e9ac2'],
    grass:  ['#dcf4c4', '#9cda75', '#69bb49'],
    forest: ['#bcdda9', '#7fb56d', '#4a8642'],
    ice:    ['#ffffff', '#e8f7ff', '#b4e0f4'],
    park:   ['#e2f6c6', '#aede88', '#75be53'],
    fun:    ['#f0e9ff', '#cbb8f5', '#9f86dc'],
    track:  ['#fce3d7', '#eaa78f', '#c9755f']
  };

  /* 固定種子的隨機：同一個場景每次重畫都長一樣（不然畫面會一直跳） */
  function seedRand(str) {
    var hsh = 2166136261;
    for (var i = 0; i < str.length; i++) { hsh ^= str.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
    var s = (hsh >>> 0) || 1234567;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 深度縮放：y 越小（越遠）越迷你 */
  function dz(y) { return 0.52 + 0.76 * clamp(y, 0, 1); }

  /* 俯視時的陰影色（比側面重一點，才不會看起來浮在空中） */
  var TOPO_SHADOW = {
    sea: 'rgba(0,60,80,.20)', grass: 'rgba(24,62,24,.26)', forest: 'rgba(16,48,20,.30)',
    ice: 'rgba(80,130,160,.22)', park: 'rgba(30,70,26,.26)', fun: 'rgba(50,24,70,.28)',
    track: 'rgba(110,50,40,.24)'
  };

  /* 透視格線：上遠下近（近寬遠窄 + 橫線往上壓縮）→ 一看就知道是躺著的地板 */
  function topoGrid(x, w, h, color) {
    x.save();
    x.strokeStyle = color;
    x.lineWidth = Math.max(1, w * 0.0014);
    var vpx = w * 0.5, vpy = -h * 0.34;
    for (var i = -6; i <= 16; i++) {
      var bx = (i / 10) * w;
      x.beginPath(); x.moveTo(vpx, vpy); x.lineTo(bx, h); x.stroke();
    }
    for (var j = 1; j <= 14; j++) {
      var y = h * Math.pow(j / 14, 1.7);
      x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke();
    }
    x.restore();
  }

  function topoTuft(x, cx, cy, s, dark, light) {
    x.strokeStyle = dark; x.lineWidth = Math.max(1, s * 0.17);
    x.beginPath();
    x.moveTo(cx - s * 0.42, cy); x.lineTo(cx - s * 0.56, cy - s * 0.85);
    x.moveTo(cx, cy); x.lineTo(cx, cy - s * 1.15);
    x.moveTo(cx + s * 0.42, cy); x.lineTo(cx + s * 0.54, cy - s * 0.80);
    x.stroke();
    if (light) {
      x.strokeStyle = light; x.lineWidth = Math.max(1, s * 0.12);
      x.beginPath();
      x.moveTo(cx - s * 0.12, cy); x.lineTo(cx - s * 0.20, cy - s * 1.24);
      x.stroke();
    }
  }

  /* 樹（從上往下看）：一團一團的葉子，不是一個洞 */
  function topoTree(x, cx, cy, r, R) {
    x.save();
    x.fillStyle = 'rgba(28,60,26,.16)';                      // 樹影
    x.beginPath(); x.ellipse(cx + r * 0.12, cy + r * 0.14, r * 1.02, r * 0.86, 0, 0, Math.PI * 2); x.fill();
    var lobes = 6;
    for (var i = 0; i < lobes; i++) {
      var a = (i / lobes) * Math.PI * 2 + R() * 0.5;
      var d = r * (0.30 + R() * 0.28);
      var lr = r * (0.44 + R() * 0.22);
      var lx = cx + Math.cos(a) * d, ly = cy + Math.sin(a) * d;
      var g = x.createRadialGradient(lx - lr * 0.35, ly - lr * 0.4, lr * 0.1, lx, ly, lr);
      g.addColorStop(0, '#9cd47c'); g.addColorStop(0.62, '#5e9e4e'); g.addColorStop(1, '#3d7a3a');
      x.fillStyle = g;
      x.beginPath(); x.arc(lx, ly, lr, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = 'rgba(255,255,255,.22)';                   // 左上受光
    x.beginPath(); x.ellipse(cx - r * 0.26, cy - r * 0.30, r * 0.34, r * 0.24, -0.6, 0, Math.PI * 2); x.fill();
    // 樹幹的影子往右下
    x.fillStyle = 'rgba(60,44,30,.20)';
    x.beginPath(); x.ellipse(cx + r * 0.55, cy + r * 0.55, r * 0.30, r * 0.22, 0.5, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  /* 草地（草原／森林／公園共用底層） */
  function topoMeadow(x, w, h, R, opts) {
    opts = opts || {};
    for (var i = 0; i < 20; i++) {                           // 大塊色斑
      x.beginPath();
      x.fillStyle = (i % 2) ? 'rgba(255,255,255,.07)' : 'rgba(28,88,28,.075)';
      x.ellipse(R() * w, R() * h, w * (0.05 + R() * 0.13), h * (0.03 + R() * 0.08), R() * 3, 0, Math.PI * 2);
      x.fill();
    }
    var n = Math.round(w * 0.20);
    for (var j = 0; j < n; j++) {                            // 草撮（越遠越小）
      var gy = R() * h;
      topoTuft(x, R() * w, gy, Math.max(1.8, w * 0.006 * dz(gy / h) * (0.7 + R() * 0.8)),
        'rgba(44,112,40,.38)', 'rgba(255,255,255,.32)');
    }
    if (opts.flower) {                                       // 小花
      var pals = ['#fff6f8', '#fff3b0', '#ffd7e6', '#d9f2ff'];
      for (var k = 0; k < Math.round(w * 0.024) + 4; k++) {
        var fy = h * (0.16 + R() * 0.84);
        var fr = Math.max(1.8, w * (0.0035 + R() * 0.004) * dz(fy / h));
        var fx = R() * w;
        x.fillStyle = pals[Math.floor(R() * pals.length)];
        for (var p = 0; p < 5; p++) {
          var pa = (p / 5) * Math.PI * 2;
          x.beginPath(); x.arc(fx + Math.cos(pa) * fr, fy + Math.sin(pa) * fr, fr * 0.78, 0, Math.PI * 2); x.fill();
        }
        x.fillStyle = '#ffcf4d';
        x.beginPath(); x.arc(fx, fy, fr * 0.7, 0, Math.PI * 2); x.fill();
      }
    }
  }

  function topoPebbles(x, w, h, R, color, n) {
    for (var i = 0; i < n; i++) {
      var py = h * (0.08 + R() * 0.92);
      var pr = Math.max(1.4, w * (0.003 + R() * 0.005) * dz(py / h));
      x.fillStyle = color;
      x.beginPath(); x.arc(R() * w, py, pr, 0, Math.PI * 2); x.fill();
    }
  }

  /* 彎彎的步道：沿著曲線分段畫，寬度隨深度變化 */
  function topoPath(x, w, h, pts) {
    var steps = 26, prev = null;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var px = (1 - t) * (1 - t) * pts[0][0] + 2 * (1 - t) * t * pts[1][0] + t * t * pts[2][0];
      var py = (1 - t) * (1 - t) * pts[0][1] + 2 * (1 - t) * t * pts[1][1] + t * t * pts[2][1];
      if (prev) {
        x.strokeStyle = '#ecddaf';
        x.lineWidth = w * 0.075 * dz(py / h);
        x.lineCap = 'round';
        x.beginPath(); x.moveTo(prev[0], prev[1]); x.lineTo(px, py); x.stroke();
        x.strokeStyle = 'rgba(255,255,255,.45)';
        x.lineWidth = Math.max(1, w * 0.0035 * dz(py / h));
        x.setLineDash([w * 0.018, w * 0.022]);
        x.beginPath(); x.moveTo(prev[0], prev[1]); x.lineTo(px, py); x.stroke();
        x.setLineDash([]);
      }
      prev = [px, py];
    }
  }

  /* ---------------- 俯視版的設施（從上往下看） ---------------- */
  function topoFac(bg, w, h) {
    var G = {};
    if (bg === 'park') {
      G.slide  = { topX: w * 0.350, topY: h * 0.610, botX: w * 0.105, botY: h * 0.820, wid: w * 0.070 };
      G.swing  = { cx: w * 0.575, cy: h * 0.275, barW: w * 0.160, seatY: h * 0.318,
                 seatA: w * 0.575 - w * 0.072, seatB: w * 0.575 + w * 0.072 };
      G.bar    = { cx: w * 0.805, cy: h * 0.620, halfW: w * 0.064 };
      G.bush   = { cx: w * 0.455, cy: h * 0.890, r: w * 0.080 };
    } else if (bg === 'fun') {
      G.ferris   = { cx: w * 0.200, cy: h * 0.270, rx: w * 0.120, ry: h * 0.100 };
      G.carousel = { cx: w * 0.545, cy: h * 0.180, rx: w * 0.100, ry: h * 0.082 };
      G.tramp    = { cx: w * 0.805, cy: h * 0.440, rx: w * 0.078, ry: h * 0.070 };
    } else if (bg === 'track') {
      var r0 = Math.min(w, h) * 0.40, laneW = Math.min(w, h) * 0.038;
      var R = r0 + laneW * 2.4;
      G.run = { cx: w * 0.5, cy: h * 0.52, Rx: R, Ry: R * 0.64, a0: Math.PI * 0.62, a1: Math.PI * 2.36 };
      G.hurdle = { cx: w * 0.5, cy: h * 0.52, Rx: R, Ry: R * 0.64,
                   a0: Math.PI * 0.16, a1: Math.PI * 0.84,
                   angles: [Math.PI * 0.34, Math.PI * 0.66] };
    }
    return G;
  }

  function drawTopoSlide(x, S, w) {
    var ang = Math.atan2(S.botY - S.topY, S.botX - S.topX);
    var len = Math.sqrt(Math.pow(S.botX - S.topX, 2) + Math.pow(S.botY - S.topY, 2));
    var hw = S.wid * 0.5;
    x.save();
    x.translate(S.topX, S.topY); x.rotate(ang);

    // 影子（整條滑道往右下投影 → 有「架高」的感覺）
    x.fillStyle = 'rgba(24,54,30,.20)';
    x.beginPath();
    x.moveTo(-w * 0.030, -hw + w * 0.020); x.lineTo(len + w * 0.010, -hw * 1.15 + w * 0.020);
    x.lineTo(len + w * 0.010, hw * 1.15 + w * 0.020); x.lineTo(-w * 0.030, hw + w * 0.020);
    x.closePath(); x.fill();

    // 平台（跟坡道同一個座標系 → 不會像貼上去的方塊）
    var s2 = S.wid * 0.92;
    x.fillStyle = '#e8b34a';
    rr(x, -s2 * 0.62, -s2 * 0.58, s2, s2, s2 * 0.16); x.fill();
    x.fillStyle = '#ffd166';
    rr(x, -s2 * 0.62, -s2 * 0.62, s2, s2, s2 * 0.16); x.fill();
    x.strokeStyle = '#dfa72b'; x.lineWidth = Math.max(1.5, w * 0.0030);
    rr(x, -s2 * 0.62, -s2 * 0.62, s2, s2, s2 * 0.16); x.stroke();
    x.fillStyle = 'rgba(255,255,255,.6)';
    rr(x, -s2 * 0.48, -s2 * 0.48, s2 * 0.66, s2 * 0.30, s2 * 0.10); x.fill();

    // 側面厚度
    x.fillStyle = '#5fa9c6';
    x.beginPath();
    x.moveTo(0, hw); x.lineTo(len, hw * 1.15);
    x.lineTo(len, hw * 1.15 + w * 0.016); x.lineTo(0, hw + w * 0.016);
    x.closePath(); x.fill();
    // 滑道面
    var g = x.createLinearGradient(0, -hw, 0, hw);
    g.addColorStop(0, '#cdeefa'); g.addColorStop(0.5, '#a7dbef'); g.addColorStop(1, '#84c6e2');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, -hw * 0.86); x.lineTo(len, -hw * 1.15);
    x.lineTo(len, hw * 1.15); x.lineTo(0, hw * 0.86);
    x.closePath(); x.fill();
    // 橫向止滑紋
    x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = Math.max(1, w * 0.0022);
    for (var st = 1; st <= 7; st++) {
      var tt = st / 8, yy = hw * (0.86 + 0.29 * tt);
      x.beginPath(); x.moveTo(len * tt, -yy); x.lineTo(len * tt, yy); x.stroke();
    }
    // 兩側護欄
    x.lineCap = 'round';
    x.strokeStyle = '#e08f28'; x.lineWidth = Math.max(3, w * 0.0085);
    x.beginPath();
    x.moveTo(0, -hw * 0.86); x.lineTo(len, -hw * 1.15);
    x.moveTo(0, hw * 0.86); x.lineTo(len, hw * 1.15);
    x.stroke();
    x.strokeStyle = '#ffc76b'; x.lineWidth = Math.max(1.5, w * 0.004);
    x.beginPath();
    x.moveTo(0, -hw * 0.90); x.lineTo(len, -hw * 1.19);
    x.moveTo(0, hw * 0.82); x.lineTo(len, hw * 1.11);
    x.stroke();
    x.restore();

    // 梯子（接在平台後側）
    x.save();
    var px = S.topX, py = S.topY;
    var lx0 = px + Math.cos(ang) * -s2 * 0.66, ly0 = py + Math.sin(ang) * -s2 * 0.66;
    var lx1 = lx0 - w * 0.055, ly1 = ly0 - w * 0.050;
    x.strokeStyle = 'rgba(24,54,30,.18)'; x.lineWidth = Math.max(3, w * 0.006); x.lineCap = 'round';
    x.beginPath(); x.moveTo(lx0 + w * 0.005, ly0 + w * 0.008); x.lineTo(lx1 + w * 0.005, ly1 + w * 0.008); x.stroke();
    x.strokeStyle = '#aab9c4'; x.lineWidth = Math.max(3, w * 0.006);
    x.beginPath(); x.moveTo(lx0, ly0); x.lineTo(lx1, ly1); x.stroke();
    x.strokeStyle = '#d7e2ea'; x.lineWidth = Math.max(1.5, w * 0.0032);
    for (var k = 1; k <= 3; k++) {
      var t = k / 4, cx = lx0 + (lx1 - lx0) * t, cy = ly0 + (ly1 - ly0) * t;
      x.beginPath(); x.moveTo(cx - w * 0.014, cy + w * 0.010); x.lineTo(cx + w * 0.014, cy - w * 0.010); x.stroke();
    }
    x.restore();
  }

  function drawTopoSwing(x, S, w) {
    var hw = S.barW / 2;
    x.save();
    // 影子
    x.fillStyle = 'rgba(30,60,40,.14)';
    x.beginPath(); x.ellipse(S.cx, S.cy + w * 0.018, hw * 1.05, w * 0.030, 0, 0, Math.PI * 2); x.fill();
    // 兩根 A 架（俯視是往外斜的兩條）
    x.strokeStyle = '#9fb3bf'; x.lineWidth = Math.max(2, w * 0.0055); x.lineCap = 'round';
    x.beginPath();
    x.moveTo(S.cx - hw, S.cy); x.lineTo(S.cx - hw * 1.22, S.cy + w * 0.052);
    x.moveTo(S.cx + hw, S.cy); x.lineTo(S.cx + hw * 1.22, S.cy + w * 0.052);
    x.stroke();
    // 橫桿
    x.strokeStyle = '#e8564f'; x.lineWidth = Math.max(3, w * 0.008);
    x.beginPath(); x.moveTo(S.cx - hw, S.cy); x.lineTo(S.cx + hw, S.cy); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = Math.max(1, w * 0.0022);
    x.beginPath(); x.moveTo(S.cx - hw * 0.9, S.cy - w * 0.0022); x.lineTo(S.cx + hw * 0.9, S.cy - w * 0.0022); x.stroke();
    x.restore();
  }

  /* 鞦韆座椅是動態的：沒人坐就靜止，有人坐就跟著牠盪 → 才看得出在「晃」 */
  function drawTopoSwingSeats(ctx, w, h) {
    if (state.bg !== 'park') return;
    var G = topoFac('park', w, h).swing;
    var seats = [G.seatA, G.seatB];
    for (var i = 0; i < seats.length; i++) {
      var sx = seats[i];
      for (var k = 0; k < state.animals.length; k++) {
        var a = state.animals[k];
        if (a.ride && a.ride.kind === 'swing' && Math.abs((a.ride.seat || 0) - seats[i]) < 1) sx = a.x * w;
      }
      drawSeat(ctx, seats[i], sx, G.cy, G.seatY, w);
    }
  }

  function drawSeat(ctx, anchorX, sx, barY, seatY, w) {
    // 繩子從橫桿上固定的掛點拉到座椅 → 座椅盪開時繩子會斜，一看就知道在晃
    var tilt = Math.atan2(sx - anchorX, Math.max(1, seatY - barY));
    ctx.save();
    ctx.strokeStyle = 'rgba(80,100,112,.8)'; ctx.lineWidth = Math.max(1, w * 0.0026);
    ctx.beginPath();
    ctx.moveTo(anchorX - w * 0.019, barY); ctx.lineTo(sx - w * 0.019, seatY);
    ctx.moveTo(anchorX + w * 0.019, barY); ctx.lineTo(sx + w * 0.019, seatY);
    ctx.stroke();
    // 座椅跟著傾斜
    ctx.translate(sx, seatY); ctx.rotate(tilt);
    ctx.fillStyle = 'rgba(40,70,40,.18)';
    rr(ctx, -w * 0.032, w * 0.012, w * 0.064, w * 0.018, w * 0.007); ctx.fill();
    ctx.fillStyle = '#8a6b4a';
    rr(ctx, -w * 0.032, -w * 0.015, w * 0.064, w * 0.028, w * 0.008); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    rr(ctx, -w * 0.026, -w * 0.012, w * 0.052, w * 0.009, w * 0.004); ctx.fill();
    ctx.restore();
  }

  function drawTopoBar(x, S, w) {
    x.save();
    // 地面影子（一條長長的橢圓 → 桿子架高的感覺）
    x.fillStyle = 'rgba(24,54,30,.16)';
    x.beginPath(); x.ellipse(S.cx + w * 0.006, S.cy + w * 0.020, S.halfW * 1.22, w * 0.030, 0, 0, Math.PI * 2); x.fill();
    // 橫桿投影（往下偏一點）
    x.lineCap = 'round';
    x.strokeStyle = 'rgba(24,54,30,.20)'; x.lineWidth = Math.max(7, w * 0.017);
    x.beginPath(); x.moveTo(S.cx - S.halfW, S.cy + w * 0.010); x.lineTo(S.cx + S.halfW, S.cy + w * 0.010); x.stroke();
    // 兩根柱子（俯視＝一圈底座 + 一顆柱頭）
    [-1, 1].forEach(function (f) {
      var bx = S.cx + S.halfW * f;
      x.fillStyle = '#6f8794';
      x.beginPath(); x.arc(bx, S.cy + w * 0.004, w * 0.026, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#9fb4c0';
      x.beginPath(); x.arc(bx, S.cy, w * 0.021, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#cfe0ea';
      x.beginPath(); x.arc(bx - w * 0.005, S.cy - w * 0.006, w * 0.013, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(255,255,255,.85)';
      x.beginPath(); x.arc(bx - w * 0.008, S.cy - w * 0.009, w * 0.005, 0, Math.PI * 2); x.fill();
    });
    // 橫桿（深色外框 → 紅桿 → 白高光）
    x.strokeStyle = '#8f2f2b'; x.lineWidth = Math.max(8, w * 0.019);
    x.beginPath(); x.moveTo(S.cx - S.halfW, S.cy); x.lineTo(S.cx + S.halfW, S.cy); x.stroke();
    x.strokeStyle = '#e8564f'; x.lineWidth = Math.max(6, w * 0.014);
    x.beginPath(); x.moveTo(S.cx - S.halfW, S.cy); x.lineTo(S.cx + S.halfW, S.cy); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.6)'; x.lineWidth = Math.max(2, w * 0.0044);
    x.beginPath(); x.moveTo(S.cx - S.halfW * 0.9, S.cy - w * 0.0044); x.lineTo(S.cx + S.halfW * 0.9, S.cy - w * 0.0044); x.stroke();
    // 兩端握把（黃）
    [-1, 1].forEach(function (f) {
      var bx = S.cx + S.halfW * f;
      x.fillStyle = '#ffd166';
      x.beginPath(); x.ellipse(bx, S.cy, w * 0.012, w * 0.009, 0, 0, Math.PI * 2); x.fill();
    });
    x.restore();
  }

  function drawTopoBush(x, S, w, R) {
    x.save();
    x.fillStyle = 'rgba(24,60,24,.18)';
    x.beginPath(); x.ellipse(S.cx + S.r * 0.10, S.cy + S.r * 0.14, S.r * 1.06, S.r * 0.92, 0, 0, Math.PI * 2); x.fill();
    for (var i = 0; i < 7; i++) {
      var a = (i / 7) * Math.PI * 2 + R() * 0.4;
      var d = S.r * (0.26 + R() * 0.34);
      var lr = S.r * (0.42 + R() * 0.22);
      var lx = S.cx + Math.cos(a) * d, ly = S.cy + Math.sin(a) * d * 0.82;
      var g = x.createRadialGradient(lx - lr * 0.35, ly - lr * 0.38, lr * 0.1, lx, ly, lr);
      g.addColorStop(0, '#9cd47c'); g.addColorStop(0.62, '#57a04a'); g.addColorStop(1, '#3a7a37');
      x.fillStyle = g;
      x.beginPath(); x.arc(lx, ly, lr, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = 'rgba(255,255,255,.20)';
    x.beginPath(); x.ellipse(S.cx - S.r * 0.24, S.cy - S.r * 0.30, S.r * 0.36, S.r * 0.24, -0.6, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  function drawTopoFerris(x, G, w) {
    x.save();
    x.translate(G.cx, G.cy);
    x.fillStyle = 'rgba(50,24,70,.16)';
    x.beginPath(); x.ellipse(G.rx * 0.10, G.ry * 0.22, G.rx * 1.04, G.ry * 1.02, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = Math.max(2, w * 0.0045);
    x.beginPath(); x.ellipse(0, 0, G.rx, G.ry, 0, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(120,90,170,.65)'; x.lineWidth = Math.max(1, w * 0.0026);
    for (var i = 0; i < 10; i++) {
      var a = (i / 10) * Math.PI * 2;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * G.rx, Math.sin(a) * G.ry); x.stroke();
    }
    // 車廂
    var cols = ['#ff8fa3', '#ffd166', '#8ad7ff', '#a6f0a0', '#c9a7ff'];
    for (var j = 0; j < 10; j++) {
      var an = (j / 10) * Math.PI * 2 + 0.31;
      var bx = Math.cos(an) * G.rx, by = Math.sin(an) * G.ry;
      x.fillStyle = cols[j % cols.length];
      x.beginPath(); x.arc(bx, by, w * 0.0165, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(255,255,255,.8)'; x.lineWidth = Math.max(1, w * 0.0022);
      x.beginPath(); x.arc(bx, by, w * 0.0165, 0, Math.PI * 2); x.stroke();
    }
    x.fillStyle = '#b28ce8';
    x.beginPath(); x.arc(0, 0, w * 0.014, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,.7)';
    x.beginPath(); x.arc(-w * 0.004, -w * 0.004, w * 0.006, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  function drawTopoCarousel(x, G, w) {
    x.save();
    x.translate(G.cx, G.cy);
    x.scale(1, G.ry / G.rx);
    var r = G.rx;
    x.fillStyle = 'rgba(50,24,70,.16)';
    x.beginPath(); x.arc(r * 0.06, r * 0.16, r * 1.04, 0, Math.PI * 2); x.fill();
    // 底板
    x.fillStyle = '#f6e9bf';
    x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill();
    // 傘蓋條紋
    var cols = ['#ff8fa3', '#ffe9a8', '#8ad7ff', '#c9e8ff', '#ffc2d6', '#fff6d8'];
    for (var i = 0; i < 12; i++) {
      x.fillStyle = cols[i % cols.length];
      x.beginPath(); x.moveTo(0, 0);
      x.arc(0, 0, r * 0.92, (i / 12) * Math.PI * 2, ((i + 1) / 12) * Math.PI * 2);
      x.closePath(); x.fill();
    }
    x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = Math.max(2, w * 0.0045);
    x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.6)'; x.lineWidth = Math.max(1, w * 0.0024);
    x.beginPath(); x.arc(0, 0, r * 0.92, 0, Math.PI * 2); x.stroke();
    // 木馬（一圈小點）
    for (var k = 0; k < 6; k++) {
      var a = (k / 6) * Math.PI * 2 + 0.2;
      var hx = Math.cos(a) * r * 0.94, hy = Math.sin(a) * r * 0.94;
      x.fillStyle = '#8a6b4a';
      x.beginPath(); x.ellipse(hx, hy, r * 0.075, r * 0.048, a, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(255,255,255,.55)';
      x.beginPath(); x.ellipse(hx - r * 0.02, hy - r * 0.015, r * 0.030, r * 0.018, a, 0, Math.PI * 2); x.fill();
    }
    // 中心柱
    x.fillStyle = '#ffd166';
    x.beginPath(); x.arc(0, 0, r * 0.10, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,.75)';
    x.beginPath(); x.arc(-r * 0.025, -r * 0.025, r * 0.04, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  function drawTopoTramp(x, G, w) {
    x.save();
    x.translate(G.cx, G.cy);
    x.scale(1, G.ry / G.rx);
    var r = G.rx;
    x.fillStyle = 'rgba(50,24,70,.16)';
    x.beginPath(); x.arc(r * 0.06, r * 0.14, r * 1.04, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#5b7fd4';                                  // 外圈護墊
    x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#8fb0e8';
    x.beginPath(); x.arc(0, 0, r * 0.90, 0, Math.PI * 2); x.fill();
    var tg = x.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.1, 0, 0, r * 0.8);
    tg.addColorStop(0, '#6f8fd0'); tg.addColorStop(1, '#3f5d9c');
    x.fillStyle = tg;                                         // 彈跳布
    x.beginPath(); x.arc(0, 0, r * 0.78, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = Math.max(1, w * 0.0022);
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2;
      x.beginPath(); x.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
      x.lineTo(Math.cos(a) * r * 0.14, Math.sin(a) * r * 0.14); x.stroke();
    }
    x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = Math.max(1.5, w * 0.0032);
    x.beginPath(); x.arc(0, 0, r * 0.78, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = Math.max(1, w * 0.0022);
    x.beginPath(); x.arc(0, 0, r * 0.44, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#8ad7ff';
    x.beginPath(); x.arc(0, 0, r * 0.14, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,.7)';
    x.beginPath(); x.arc(-r * 0.04, -r * 0.04, r * 0.05, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  function drawTopoHurdles(x, G, w) {
    x.save();
    G.angles.forEach(function (a) {
      var cx = G.cx + Math.cos(a) * G.Rx, cy = G.cy + Math.sin(a) * G.Ry;
      var nx = -Math.sin(a), ny = Math.cos(a);
      var len = Math.min(G.Rx, G.Ry) * 0.32;
      var x0 = cx + nx * len, y0 = cy + ny * len * 0.64;
      var x1 = cx - nx * len, y1 = cy - ny * len * 0.64;
      // 地面影子
      x.strokeStyle = 'rgba(60,20,20,.28)'; x.lineWidth = Math.max(4, w * 0.009); x.lineCap = 'round';
      x.beginPath(); x.moveTo(x0 + w * 0.004, y0 + w * 0.009); x.lineTo(x1 + w * 0.004, y1 + w * 0.009); x.stroke();
      // 兩根腳
      x.strokeStyle = '#c9d6dd'; x.lineWidth = Math.max(2, w * 0.0045);
      x.beginPath();
      x.moveTo(x0, y0); x.lineTo(x0, y0 + w * 0.014);
      x.moveTo(x1, y1); x.lineTo(x1, y1 + w * 0.014);
      x.stroke();
      // 橫板（白 + 紅線）
      x.strokeStyle = '#ffffff'; x.lineWidth = Math.max(5, w * 0.011);
      x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
      x.strokeStyle = 'rgba(220,70,70,.95)'; x.lineWidth = Math.max(2, w * 0.0045);
      x.beginPath(); x.moveTo(x0, y0 + w * 0.0035); x.lineTo(x1, y1 + w * 0.0035); x.stroke();
    });
    x.restore();
  }

  function drawTopoFacilities(x, w, h, bg) {
    var G = topoFac(bg, w, h);
    if (bg === 'park') {
      drawTopoSlide(x, G.slide, w);
      drawTopoSwing(x, G.swing, w);
      drawTopoBar(x, G.bar, w);
      drawTopoBush(x, G.bush, w, seedRand('bush:' + Math.round(w)));
    } else if (bg === 'fun') {
      drawTopoFerris(x, G.ferris, w);
      drawTopoCarousel(x, G.carousel, w);
      drawTopoTramp(x, G.tramp, w);
    } else if (bg === 'track') {
      drawTopoHurdles(x, G.hurdle, w);
    }
  }

  /* 各場景的俯視裝飾 */
  function paintTopoTheme(x, w, h, bg, R) {
    var i, j, cx, cy, r;

    if (bg === 'sea') {
      for (i = 0; i < 10; i++) {                             // 沙地
        x.beginPath(); x.fillStyle = 'rgba(240,226,178,.30)';
        x.ellipse(R() * w, R() * h, w * (0.07 + R() * 0.14), h * (0.04 + R() * 0.08), R() * 3, 0, Math.PI * 2); x.fill();
      }
      for (i = 0; i < 18; i++) {                             // 水光波紋
        cy = h * (0.06 + R() * 0.9);
        x.strokeStyle = 'rgba(255,255,255,' + (0.14 + R() * 0.22).toFixed(2) + ')';
        x.lineWidth = Math.max(1, w * 0.0022 * dz(cy / h));
        cx = R() * w; r = w * (0.05 + R() * 0.12) * dz(cy / h);
        x.beginPath();
        x.moveTo(cx - r, cy);
        x.quadraticCurveTo(cx - r * 0.4, cy - h * 0.018, cx, cy);
        x.quadraticCurveTo(cx + r * 0.4, cy + h * 0.018, cx + r, cy);
        x.stroke();
      }
      for (i = 0; i < 8; i++) {                              // 岩石（越遠越小）
        cy = h * (0.08 + R() * 0.88);
        cx = w * (0.06 + R() * 0.88);
        r = w * (0.020 + R() * 0.026) * dz(cy / h);
        x.fillStyle = R() < 0.5 ? '#a7c0c9' : '#93b0bb';
        x.beginPath(); x.ellipse(cx, cy, r, r * 0.8, R() * 3, 0, Math.PI * 2); x.fill();
        x.fillStyle = 'rgba(255,255,255,.45)';
        x.beginPath(); x.ellipse(cx - r * 0.3, cy - r * 0.3, r * 0.45, r * 0.32, R() * 3, 0, Math.PI * 2); x.fill();
      }
      for (i = 0; i < 9; i++) {                              // 海草
        cy = h * (0.14 + R() * 0.84);
        cx = R() * w; r = w * (0.010 + R() * 0.012) * dz(cy / h);
        x.fillStyle = 'rgba(72,150,110,.55)';
        for (var q2 = 0; q2 < 3; q2++) {
          x.beginPath();
          x.ellipse(cx + (q2 - 1) * r * 0.8, cy + (R() - 0.5) * r, r * 0.55, r * 1.5, (R() - 0.5) * 0.6, 0, Math.PI * 2);
          x.fill();
        }
      }
      for (i = 0; i < 14; i++) {                             // 貝殼／海星
        cy = h * (0.10 + R() * 0.86);
        cx = R() * w; r = w * (0.006 + R() * 0.006) * dz(cy / h);
        x.fillStyle = ['#ffd9c2', '#ffeeb5', '#f7c6d8'][Math.floor(R() * 3)];
        x.beginPath(); x.arc(cx, cy, r, Math.PI, Math.PI * 2); x.fill();
      }
      return;
    }

    if (bg === 'grass') {
      topoMeadow(x, w, h, R, { flower: true });
      topoPebbles(x, w, h, R, 'rgba(255,255,255,.35)', 24);
      return;
    }

    if (bg === 'forest') {
      topoMeadow(x, w, h, R, null);
      topoPebbles(x, w, h, R, 'rgba(60,50,40,.18)', 28);
      for (i = 0; i < 16; i++) {
        if (i < 10) {                                        // 邊緣一圈樹（中間留給動物）
          var edge = i % 3;
          if (edge === 0) { cx = R() * w; cy = h * (0.01 + R() * 0.12); }
          else if (edge === 1) { cx = w * (0.00 + R() * 0.10); cy = R() * h; }
          else { cx = w * (0.90 + R() * 0.10); cy = R() * h; }
        } else { cx = R() * w; cy = h * (0.05 + R() * 0.9); }
        r = w * (0.030 + R() * 0.028) * dz(cy / h);
        topoTree(x, cx, cy, r, R);
      }
      return;
    }

    if (bg === 'ice') {
      for (i = 0; i < 14; i++) {                             // 雪丘
        cx = R() * w; cy = h * (0.04 + R() * 0.94);
        r = w * (0.04 + R() * 0.09) * dz(cy / h);
        var gg = x.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
        gg.addColorStop(0, 'rgba(255,255,255,.95)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = gg;
        x.beginPath(); x.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2); x.fill();
      }
      for (i = 0; i < 10; i++) {                             // 裂痕
        cy = R() * h; cx = R() * w;
        x.strokeStyle = 'rgba(112,176,208,.42)'; x.lineWidth = Math.max(1, w * 0.0018 * dz(cy / h));
        x.beginPath(); x.moveTo(cx, cy);
        for (j = 1; j <= 3; j++) x.lineTo(cx + (R() - 0.5) * w * 0.20 * j, cy + (R() - 0.5) * h * 0.18 * j);
        x.stroke();
      }
      for (i = 0; i < 7; i++) {                              // 冰塊（斜斜的方塊，遠的較小）
        cx = R() * w; cy = h * (0.10 + R() * 0.85);
        var bs = w * (0.035 + R() * 0.035) * dz(cy / h);
        x.save(); x.translate(cx, cy); x.rotate((R() - 0.5) * 0.9);
        x.fillStyle = 'rgba(190,232,248,.75)';
        x.beginPath(); x.moveTo(-bs, -bs * 0.7); x.lineTo(bs * 0.2, -bs); x.lineTo(bs, bs * 0.6); x.lineTo(-bs * 0.3, bs); x.closePath(); x.fill();
        x.fillStyle = 'rgba(255,255,255,.85)';
        x.beginPath(); x.moveTo(-bs, -bs * 0.7); x.lineTo(bs * 0.2, -bs); x.lineTo(bs * 0.05, -bs * 0.1); x.lineTo(-bs * 0.75, bs * 0.05); x.closePath(); x.fill();
        x.strokeStyle = 'rgba(150,205,232,.6)'; x.lineWidth = Math.max(1, w * 0.0016);
        x.beginPath(); x.moveTo(-bs, -bs * 0.7); x.lineTo(bs * 0.2, -bs); x.lineTo(bs, bs * 0.6); x.lineTo(-bs * 0.3, bs); x.closePath(); x.stroke();
        x.restore();
      }
      for (i = 0; i < 16; i++) {                             // 亮晶晶
        cy = h * (0.06 + R() * 0.9); cx = R() * w;
        var sp = w * (0.004 + R() * 0.004) * dz(cy / h);
        x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = Math.max(1, sp * 0.5);
        x.beginPath(); x.moveTo(cx - sp, cy); x.lineTo(cx + sp, cy);
        x.moveTo(cx, cy - sp); x.lineTo(cx, cy + sp); x.stroke();
      }
      topoPebbles(x, w, h, R, 'rgba(120,190,225,.45)', 22);
      return;
    }

    if (bg === 'park') {
      topoMeadow(x, w, h, R, { flower: true });
      topoPath(x, w, h, [[-w * 0.06, h * 0.98], [w * 0.52, h * 0.955], [w * 1.06, h * 0.86]]);
      topoPath(x, w, h, [[w * 0.665, h * 1.06], [w * 0.700, h * 0.62], [w * 0.660, h * 0.16]]);
      // 池塘（柔邊 + 波紋）
      cx = w * 0.74; cy = h * 0.72; r = w * 0.105;
      x.save();
      x.fillStyle = 'rgba(120,190,170,.35)';
      x.beginPath(); x.ellipse(cx, cy, r * 1.14, r * 0.72, -0.2, 0, Math.PI * 2); x.fill();
      var pg = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      pg.addColorStop(0, '#c9f0fb'); pg.addColorStop(0.72, '#8fd6ee'); pg.addColorStop(1, '#63b9d8');
      x.fillStyle = pg;
      x.beginPath(); x.ellipse(cx, cy, r, r * 0.62, -0.2, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(255,255,255,.6)'; x.lineWidth = Math.max(1, w * 0.0026);
      x.beginPath(); x.ellipse(cx, cy - r * 0.10, r * 0.55, r * 0.30, -0.2, 0, Math.PI * 2); x.stroke();
      x.beginPath(); x.ellipse(cx + r * 0.1, cy + r * 0.12, r * 0.32, r * 0.16, -0.2, 0, Math.PI * 2); x.stroke();
      x.restore();
      // 樹籬（上方）+ 幾棵樹
      for (i = 0; i < 9; i++) {
        x.fillStyle = '#4f9a45';
        x.beginPath(); x.arc(w * (0.05 + i * 0.11), h * 0.045, w * 0.018, 0, Math.PI * 2); x.fill();
        x.fillStyle = 'rgba(255,255,255,.18)';
        x.beginPath(); x.arc(w * (0.05 + i * 0.11) - w * 0.005, h * 0.042, w * 0.008, 0, Math.PI * 2); x.fill();
      }
      for (i = 0; i < 5; i++) {
        cx = w * (0.06 + R() * 0.88); cy = h * (0.02 + R() * 0.09);
        topoTree(x, cx, cy, w * (0.020 + R() * 0.012) * dz(cy / h), R);
      }
      return;
    }

    if (bg === 'fun') {
      // 透視磁磚：用同一組透視格線畫交替色塊
      var vpx = w * 0.5, vpy = -h * 0.34, rows = 9;
      for (var ry = 0; ry < rows; ry++) {
        var y0 = h * Math.pow(ry / rows, 1.7);          // 遠
        var y1 = h * Math.pow((ry + 1) / rows, 1.7);    // 近
        var k0 = (y0 - vpy) / (h - vpy), k1 = (y1 - vpy) / (h - vpy);
        var half0 = w * 0.5 * k0, half1 = w * 0.5 * k1;
        var segs = 8;
        for (var sx = 0; sx < segs; sx++) {
          var a0 = vpx - half0 + (2 * half0 / segs) * sx;
          var a1 = vpx - half0 + (2 * half0 / segs) * (sx + 1);
          var b0 = vpx - half1 + (2 * half1 / segs) * sx;
          var b1 = vpx - half1 + (2 * half1 / segs) * (sx + 1);
          x.fillStyle = ((sx + ry) % 2) ? 'rgba(255,255,255,.13)' : 'rgba(90,60,130,.10)';
          x.beginPath();
          x.moveTo(a0, y0); x.lineTo(a1, y0); x.lineTo(b1, y1); x.lineTo(b0, y1);
          x.closePath(); x.fill();
        }
      }
      topoPebbles(x, w, h, R, 'rgba(255,255,255,.45)', 28);
      for (i = 0; i < 14; i++) {                          // 彩帶碎屑
        cy = h * (0.22 + R() * 0.76);
        var ds = w * 0.009 * dz(cy / h);
        x.fillStyle = ['#ffe066', '#ff9ec0', '#8ef0d0', '#a9c8ff'][Math.floor(R() * 4)];
        x.fillRect(R() * w, cy, ds, ds * 0.55);
      }
      return;
    }

    if (bg === 'track') {
      x.save();
      x.translate(w * 0.5, h * 0.52); x.scale(1, 0.64);
      var rr0 = Math.min(w, h) * 0.40;
      x.fillStyle = '#79c357';
      x.beginPath(); x.arc(0, 0, rr0, 0, Math.PI * 2); x.fill();
      var lanes = 6, laneW = Math.min(w, h) * 0.038;
      for (var L = 0; L < lanes; L++) {
        x.strokeStyle = L % 2 ? '#d9584a' : '#e26656';
        x.lineWidth = laneW;
        x.beginPath(); x.arc(0, 0, rr0 + laneW * (L + 0.5), 0, Math.PI * 2); x.stroke();
        x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = Math.max(1, w * 0.0016);
        x.beginPath(); x.arc(0, 0, rr0 + laneW * (L + 1), 0, Math.PI * 2); x.stroke();
      }
      x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = Math.max(2, w * 0.006);
      x.beginPath(); x.moveTo(0, rr0 * 1.02); x.lineTo(0, rr0 + laneW * lanes); x.stroke();
      x.restore();
      topoPebbles(x, w, h, R, 'rgba(255,255,255,.28)', 22);
      return;
    }
  }

  /* 最前面的草叢（畫在動物上面 → 有「走進草裡」的層次感） */
  function paintTopoFront(x, w, h, bg, R) {
    if (bg === 'sea' || bg === 'ice' || bg === 'fun' || bg === 'track') return;
    var spots = [[0.03, 1.02, 1.5], [0.12, 1.00, 1.0], [0.88, 1.03, 1.6], [0.97, 1.00, 1.1], [0.55, 1.06, 1.2]];
    spots.forEach(function (s, i) {
      var cx = w * s[0], cy = h * s[1], r = w * 0.045 * s[2];
      var g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#7fc45f'); g.addColorStop(0.7, '#4d9440'); g.addColorStop(1, '#357034');
      x.fillStyle = g;
      for (var k = 0; k < 5; k++) {
        var a = -Math.PI + (k / 4) * Math.PI;
        x.beginPath();
        x.arc(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.22, r * (0.44 + (i % 2) * 0.08), 0, Math.PI * 2);
        x.fill();
      }
      topoTuft(x, cx, cy - r * 0.25, r * 1.15, 'rgba(28,80,28,.55)', 'rgba(255,255,255,.25)');
    });
  }

  var topoCache = { key: '', cv: null };
  var topoFront = { key: '', cv: null };
  function topoKey() { return state.bg + '|' + Math.round(view.w) + 'x' + Math.round(view.h) + '@' + view.dpr; }

  function buildTopoLayer(front) {
    var w = view.w, h = view.h;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * view.dpr));
    c.height = Math.max(1, Math.round(h * view.dpr));
    var x = c.getContext('2d');
    if (!x) return c;
    x.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    var R = seedRand('topo:' + state.bg + (front ? ':front' : ''));
    if (front) {
      paintTopoFront(x, w, h, state.bg, R);
    } else {
      var pal = TOPO[state.bg] || TOPO.grass;
      var g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, pal[0]); g.addColorStop(0.58, pal[1]); g.addColorStop(1, pal[2]);
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      if (state.bg === 'grass' || state.bg === 'forest' || state.bg === 'ice' || state.bg === 'fun') {
        topoGrid(x, w, h, 'rgba(255,255,255,.13)');
      }
      paintTopoTheme(x, w, h, state.bg, R);
      drawTopoFacilities(x, w, h, state.bg);
      var hz = x.createLinearGradient(0, 0, 0, h * 0.34);      // 遠處的空氣層，讓地板有深度
      hz.addColorStop(0, 'rgba(255,255,255,.42)'); hz.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = hz; x.fillRect(0, 0, w, h * 0.34);
      var vg = x.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.24, w * 0.5, h * 0.5, Math.max(w, h) * 0.82);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.18)');
      x.fillStyle = vg; x.fillRect(0, 0, w, h);
    }
    return c;
  }

  function drawTopoBg(ctx, w, h) {
    var key = topoKey();
    if (topoCache.key !== key || !topoCache.cv) { topoCache.cv = buildTopoLayer(false); topoCache.key = key; }
    ctx.drawImage(topoCache.cv, 0, 0, w, h);
  }

  function drawTopoFront(ctx, w, h) {
    var key = topoKey();
    if (topoFront.key !== key || !topoFront.cv) { topoFront.cv = buildTopoLayer(true); topoFront.key = key; }
    ctx.drawImage(topoFront.cv, 0, 0, w, h);
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
    if (isTopo()) { drawTopoBg(ctx, w, h); return; }
    if (state.bg === 'grass') drawGrass(ctx, w, h, t);
    else if (state.bg === 'forest') drawForest(ctx, w, h, t);
    else if (state.bg === 'ice') drawIce(ctx, w, h, t);
    else if (state.bg === 'park') drawPark(ctx, w, h, t);
    else if (state.bg === 'fun') drawFun(ctx, w, h, t);
    else if (state.bg === 'track') drawTrack(ctx, w, h, t);
    else drawSea(ctx, w, h, t);
  }

  /* ================= 場景：公園／遊樂園／操場（含互動設施） ================= */
  var RIDE_DUR = { slide: 5.4, swing: 6.6, bar: 5.4, hide: 4.8,
                   ferris: 9.0, carousel: 8.0, tramp: 5.2, run: 5.2, hurdle: 5.2 };
  var FAC_NAME = { slide: '溜滑梯', swing: '盪鞦韆', bar: '單槓', hide: '草叢',
                   ferris: '摩天輪', carousel: '旋轉木馬', tramp: '彈跳床',
                   run: '跑道', hurdle: '跨欄' };

  function lerp(a, b, k) { return a + (b - a) * k; }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function cloud(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 0.95, y + r * 0.15, r * 0.78, 0, Math.PI * 2);
    ctx.arc(x - r * 0.95, y + r * 0.20, r * 0.70, 0, Math.PI * 2);
    ctx.arc(x + r * 0.15, y - r * 0.55, r * 0.66, 0, Math.PI * 2);
    ctx.fill();
  }

  function tree(ctx, x, gy, w, hh) {
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(x - w * 0.008, gy - hh, w * 0.016, hh);
    var r = Math.max(5, w * 0.042);
    ctx.fillStyle = '#5fb85f';
    ctx.beginPath();
    ctx.arc(x, gy - hh - r * 0.15, r, 0, Math.PI * 2);
    ctx.arc(x - r * 0.75, gy - hh + r * 0.45, r * 0.72, 0, Math.PI * 2);
    ctx.arc(x + r * 0.75, gy - hh + r * 0.42, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath(); ctx.arc(x - r * 0.30, gy - hh - r * 0.45, r * 0.40, 0, Math.PI * 2); ctx.fill();
  }

  /* ---- 幾何：畫圖與互動共用同一組座標，才不會「看起來在A、實際在B」 ---- */
  function parkGeom(w, h) {
    var gy = h * BG.park.ground;
    return {
      gy: gy,
      slide: {
        ladderX: 0.098 * w, platX: 0.080 * w, platW: 0.118 * w,
        topX: 0.198 * w, bottomX: 0.425 * w, topY: gy - 0.300 * h, climbX: 0.140 * w
      },
      swing: {
        x0: 0.470 * w, x1: 0.650 * w, barY: gy - 0.320 * h,
        seatY: gy - 0.190 * h, seatA: 0.515 * w, seatB: 0.598 * w
      },
      bar: { x0: 0.694 * w, x1: 0.806 * w, barY: gy - 0.330 * h, cx: 0.750 * w },
      bush: { cx: 0.905 * w, cy: gy - 0.050 * h, r: 0.064 * w, gy: gy }
    };
  }

  function funGeom(w, h) {
    var gy = h * BG.fun.ground;
    var R = Math.min(w * 0.215, h * 0.335);
    return {
      gy: gy,
      ferris: { cx: 0.270 * w, cy: gy - 0.405 * h, R: R },
      carousel: { cx: 0.655 * w, cy: gy - 0.050 * h, rx: 0.135 * w, ry: 0.046 * h, topY: gy - 0.360 * h },
      tramp: { cx: 0.895 * w, cy: gy - 0.034 * h, rx: 0.075 * w, ry: 0.026 * h }
    };
  }

  function trackGeom(w, h) {
    var gy = h * BG.track.ground;
    return {
      gy: gy, gyN: BG.track.ground, runY: gy + 0.018 * h,
      hurdles: [0.500 * w, 0.680 * w], hurdleH: 0.095 * h
    };
  }

  /* ---- 公園 ---- */
  function drawSlide(ctx, w, h, P) {
    var S = P.slide, gy = P.gy;
    ctx.strokeStyle = '#c9d6df'; ctx.lineWidth = Math.max(2, w * 0.007); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(S.ladderX, gy); ctx.lineTo(S.ladderX, S.topY + h * 0.01); ctx.stroke();
    ctx.strokeStyle = '#a9bcc9'; ctx.lineWidth = Math.max(1.4, w * 0.0045);
    for (var i = 0; i < 6; i++) {
      var ly = S.topY + (gy - S.topY) * (i + 0.7) / 6.6;
      ctx.beginPath(); ctx.moveTo(S.ladderX - w * 0.017, ly); ctx.lineTo(S.ladderX + w * 0.017, ly); ctx.stroke();
    }
    ctx.fillStyle = '#f0a33c';
    rr(ctx, S.platX, S.topY - h * 0.004, S.platW, h * 0.020, Math.max(2, w * 0.006)); ctx.fill();
    ctx.fillStyle = '#d98a2b';
    ctx.fillRect(S.platX + w * 0.004, S.topY + h * 0.012, w * 0.008, h * 0.020);
    var g2 = ctx.createLinearGradient(S.topX, S.topY, S.bottomX, gy);
    g2.addColorStop(0, '#8fdcff'); g2.addColorStop(1, '#34a7e0');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.moveTo(S.topX, S.topY + h * 0.012);
    ctx.lineTo(S.bottomX, gy - h * 0.008);
    ctx.lineTo(S.bottomX, gy + h * 0.006);
    ctx.lineTo(S.topX - w * 0.014, S.topY + h * 0.032);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.beginPath(); ctx.moveTo(S.topX, S.topY + h * 0.013); ctx.lineTo(S.bottomX, gy - h * 0.007); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,110,160,.55)'; ctx.lineWidth = Math.max(1.2, w * 0.004);
    ctx.beginPath(); ctx.moveTo(S.topX - w * 0.014, S.topY + h * 0.032); ctx.lineTo(S.bottomX, gy + h * 0.006); ctx.stroke();
  }

  function drawSwings(ctx, w, h, P, t) {
    var S = P.swing, gy = P.gy;
    ctx.strokeStyle = '#b9c7d2'; ctx.lineWidth = Math.max(2.4, w * 0.008); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(S.x0, gy); ctx.lineTo(S.x0 + w * 0.020, S.barY);
    ctx.moveTo(S.x1, gy); ctx.lineTo(S.x1 - w * 0.020, S.barY);
    ctx.stroke();
    ctx.strokeStyle = '#93a7b5'; ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.beginPath(); ctx.moveTo(S.x0 + w * 0.008, S.barY); ctx.lineTo(S.x1 - w * 0.008, S.barY); ctx.stroke();
    [S.seatA, S.seatB].forEach(function (sx, i) {
      var sw = Math.sin(t * 1.5 + i * 1.9) * w * 0.010;
      var seatX = sx + sw;
      ctx.strokeStyle = 'rgba(120,135,150,.85)'; ctx.lineWidth = Math.max(1, w * 0.0025);
      ctx.beginPath();
      ctx.moveTo(sx - w * 0.016, S.barY); ctx.lineTo(seatX - w * 0.016, S.seatY);
      ctx.moveTo(sx + w * 0.016, S.barY); ctx.lineTo(seatX + w * 0.016, S.seatY);
      ctx.stroke();
      ctx.fillStyle = '#c98b4b';
      rr(ctx, seatX - w * 0.026, S.seatY - h * 0.008, w * 0.052, h * 0.014, Math.max(1.5, w * 0.004));
      ctx.fill();
    });
  }

  function drawBars(ctx, w, h, P) {
    var B = P.bar, gy = P.gy;
    ctx.fillStyle = '#c3d0da';
    ctx.fillRect(B.x0, B.barY, w * 0.011, gy - B.barY);
    ctx.fillRect(B.x1 - w * 0.011, B.barY, w * 0.011, gy - B.barY);
    ctx.fillStyle = '#b0bfca';
    ctx.fillRect(B.x0 - w * 0.008, gy - h * 0.006, w * 0.027, h * 0.012);
    ctx.fillRect(B.x1 - w * 0.019, gy - h * 0.006, w * 0.027, h * 0.012);
    var g = ctx.createLinearGradient(0, B.barY - h * 0.007, 0, B.barY + h * 0.007);
    g.addColorStop(0, '#f4f9fc'); g.addColorStop(0.5, '#dbe6ee'); g.addColorStop(1, '#9db3c1');
    ctx.fillStyle = g;
    rr(ctx, B.x0 - w * 0.012, B.barY - h * 0.007, (B.x1 - B.x0) + w * 0.024, h * 0.014, h * 0.007);
    ctx.fill();
  }

  function drawBushArt(ctx, w, h, B, t, alpha) {
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    var r = B.r;
    ctx.fillStyle = '#3f9142';
    ctx.beginPath();
    ctx.arc(B.cx - r * 0.95, B.cy + r * 0.12, r * 0.78, 0, Math.PI * 2);
    ctx.arc(B.cx, B.cy - r * 0.10, r, 0, Math.PI * 2);
    ctx.arc(B.cx + r * 0.95, B.cy + r * 0.14, r * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#57ab54';
    ctx.beginPath();
    ctx.arc(B.cx - r * 0.55, B.cy - r * 0.25, r * 0.52, 0, Math.PI * 2);
    ctx.arc(B.cx + r * 0.35, B.cy - r * 0.35, r * 0.46, 0, Math.PI * 2);
    ctx.fill();
    for (var i = 0; i < 4; i++) {
      var fx = B.cx + (i - 1.5) * r * 0.55, fy = B.cy - r * (0.30 + (i % 2) * 0.30);
      ctx.fillStyle = ['#ffd166', '#ff8fb1', '#fff1c9'][i % 3];
      ctx.beginPath(); ctx.arc(fx, fy, Math.max(1.6, w * 0.004), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawPark(ctx, w, h, t) {
    var P = parkGeom(w, h), gy = P.gy;
    skyGrad(ctx, w, h, [[0, '#8fd6ff'], [0.45, '#c9ecff'], [1, '#eafaf1']]);
    var sx = w * 0.85, sy = h * 0.13, sr = Math.max(8, w * 0.042);
    ctx.save();
    ctx.globalAlpha = 0.30; ctx.fillStyle = '#fff2a8';
    ctx.beginPath(); ctx.arc(sx, sy, sr * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#ffe066';
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    for (var c = 0; c < 3; c++) {
      var cx = (((c * 0.37 + 0.10) + (t * 0.010 * (1 + (c % 2)))) % 1.2 - 0.08) * w;
      cloud(ctx, cx, h * (0.10 + (c % 3) * 0.055), w * (0.034 + (c % 3) * 0.007));
    }
    ctx.fillStyle = '#a8d8a0';
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.quadraticCurveTo(w * 0.18, gy - h * 0.13, w * 0.36, gy);
    ctx.quadraticCurveTo(w * 0.54, gy - h * 0.09, w * 0.70, gy);
    ctx.quadraticCurveTo(w * 0.86, gy - h * 0.14, w, gy);
    ctx.lineTo(w, gy + 2); ctx.lineTo(0, gy + 2);
    ctx.closePath(); ctx.fill();
    [[0.035, 0.145], [0.125, 0.105], [0.30, 0.135], [0.64, 0.115], [0.985, 0.150]].forEach(function (p) {
      tree(ctx, p[0] * w, gy, w, h * p[1]);
    });
    var g = ctx.createLinearGradient(0, gy, 0, h);
    g.addColorStop(0, '#93d96f'); g.addColorStop(1, '#55ab4b');
    ctx.fillStyle = g; ctx.fillRect(0, gy, w, h - gy);
    ctx.save(); ctx.globalAlpha = 0.09; ctx.fillStyle = '#ffffff';
    for (var s2 = 0; s2 < 6; s2++) ctx.fillRect(0, gy + (h - gy) * (s2 / 6), w, (h - gy) / 18);
    ctx.restore();
    ctx.fillStyle = 'rgba(232,213,168,.85)';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, gy + (h - gy) * 0.55, w * 0.52, (h - gy) * 0.20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, gy + (h - gy) * 0.50, w * 0.50, (h - gy) * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    drawSlide(ctx, w, h, P);
    drawSwings(ctx, w, h, P, t);
    drawBars(ctx, w, h, P);
    drawBushArt(ctx, w, h, P.bush, t);
    for (var fl = 0; fl < 9; fl++) {
      var fx = ((fl * 0.153 + 0.03) % 1) * w;
      var fy = gy + (h - gy) * (0.16 + (fl % 4) * 0.20);
      ctx.fillStyle = ['#ffffff', '#ffd9e6', '#fff3bf', '#dcd0ff'][fl % 4];
      ctx.beginPath(); ctx.arc(fx, fy, Math.max(1.6, w * 0.0045), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.beginPath(); ctx.arc(fx, fy, Math.max(0.8, w * 0.0018), 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ---- 遊樂園 ---- */
  function drawFerrisArt(ctx, w, h, F, t) {
    var G = F.ferris, R = G.R, cx = G.cx, cy = G.cy;
    ctx.strokeStyle = '#cfd8e8'; ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.62, F.gy); ctx.lineTo(cx, cy);
    ctx.moveTo(cx + R * 0.62, F.gy); ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = Math.max(2, w * 0.005);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = Math.max(1, w * 0.0025);
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.60, 0, Math.PI * 2); ctx.stroke();
    var N = 10;
    for (var i = 0; i < N; i++) {
      var a = -Math.PI / 2 + (i / N) * Math.PI * 2;
      var x2 = cx + Math.cos(a) * R, y2 = cy + Math.sin(a) * R;
      ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.lineWidth = Math.max(1, w * 0.0018);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x2, y2); ctx.stroke();
      var col = ['#ff8fa3', '#ffd166', '#8ad7ff', '#a6f0a0', '#c9a7ff'][i % 5];
      ctx.fillStyle = col;
      rr(ctx, x2 - w * 0.037, y2 + h * 0.002, w * 0.075, h * 0.058, w * 0.010); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      rr(ctx, x2 - w * 0.027, y2 + h * 0.012, w * 0.054, h * 0.018, w * 0.005); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,' + (0.45 + 0.45 * Math.abs(Math.sin(t * 2 + i))) + ')';
      ctx.beginPath(); ctx.arc(x2, y2 + h * 0.001, Math.max(1.2, w * 0.0035), 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, w * 0.011), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = Math.max(1.2, w * 0.003);
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy - R * 1.10); ctx.stroke();
    ctx.fillStyle = '#ff8fa3';
    ctx.beginPath();
    ctx.moveTo(cx, cy - R * 1.10); ctx.lineTo(cx + w * 0.030, cy - R * 1.06); ctx.lineTo(cx, cy - R * 1.02);
    ctx.closePath(); ctx.fill();
  }

  function drawCarouselArt(ctx, w, h, F, t) {
    var C = F.carousel;
    ctx.fillStyle = '#e0b877';
    ctx.beginPath(); ctx.ellipse(C.cx, C.cy + C.ry * 0.55, C.rx * 1.22, C.ry * 1.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f7d9a0';
    ctx.beginPath(); ctx.ellipse(C.cx, C.cy, C.rx * 1.15, C.ry * 1.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath(); ctx.ellipse(C.cx, C.cy - C.ry * 0.15, C.rx * 0.98, C.ry * 0.9, 0, 0, Math.PI * 2); ctx.fill();
    var topY = C.topY + h * 0.055;
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(C.cx - w * 0.009, topY, w * 0.018, C.cy - topY);
    for (var i = 0; i < 10; i++) {
      var a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2;
      ctx.fillStyle = i % 2 ? '#ff8fa3' : '#fff1c9';
      ctx.beginPath();
      ctx.moveTo(C.cx, topY - h * 0.045);
      ctx.ellipse(C.cx, topY, C.rx * 1.18, C.ry * 1.5, 0, a0, a1);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = Math.max(1.4, w * 0.0035);
    ctx.beginPath(); ctx.ellipse(C.cx, topY, C.rx * 1.18, C.ry * 1.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffe066';
    ctx.beginPath(); ctx.arc(C.cx, topY - h * 0.052, Math.max(2, w * 0.007), 0, Math.PI * 2); ctx.fill();
    for (var p = 0; p < 6; p++) {
      var pa = (p / 6) * Math.PI * 2 + t * 0.18;
      var px = C.cx + Math.cos(pa) * C.rx * 0.72, py = C.cy + Math.sin(pa) * C.ry * 0.72;
      ctx.fillStyle = ['#ffd166', '#8ad7ff', '#ff8fa3'][p % 3];
      ctx.fillRect(px - w * 0.004, py - h * 0.075, w * 0.008, h * 0.075);
      ctx.beginPath(); ctx.arc(px, py - h * 0.078, Math.max(1.8, w * 0.005), 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawTrampArt(ctx, w, h, F, t) {
    var T = F.tramp;
    ctx.strokeStyle = '#9aa7c7'; ctx.lineWidth = Math.max(2, w * 0.005);
    ctx.beginPath();
    ctx.moveTo(T.cx - T.rx * 0.55, T.cy); ctx.lineTo(T.cx - T.rx * 0.78, T.cy + h * 0.055);
    ctx.moveTo(T.cx + T.rx * 0.55, T.cy); ctx.lineTo(T.cx + T.rx * 0.78, T.cy + h * 0.055);
    ctx.stroke();
    ctx.fillStyle = '#3a2a58';
    ctx.beginPath(); ctx.ellipse(T.cx, T.cy + h * 0.004, T.rx, T.ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5ad1ff';
    ctx.beginPath(); ctx.ellipse(T.cx, T.cy - T.ry * 0.20, T.rx * 0.90, T.ry * 0.85, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = Math.max(1.6, w * 0.0045);
    ctx.beginPath(); ctx.ellipse(T.cx, T.cy - T.ry * 0.20, T.rx * 0.90, T.ry * 0.85, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1, w * 0.003);
    ctx.beginPath(); ctx.ellipse(T.cx, T.cy - T.ry * 0.25, T.rx * 0.58, T.ry * 0.52, 0, 0, Math.PI * 2); ctx.stroke();
  }

  function drawFun(ctx, w, h, t) {
    var F = funGeom(w, h), gy = F.gy;
    skyGrad(ctx, w, h, [[0, '#2b1055'], [0.42, '#6b2b6b'], [0.76, '#c2557a'], [1, '#ffb27a']]);
    for (var i = 0; i < 36; i++) {
      var sx = ((i * 0.137 + 0.02) % 1) * w;
      var sy = ((i * 0.213 + 0.03) % 1) * h * 0.52;
      ctx.globalAlpha = 0.30 + 0.50 * Math.abs(Math.sin(t * 1.2 + i));
      ctx.fillStyle = '#fff8e1';
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(0.9, w * 0.0017), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    var mx = w * 0.86, my = h * 0.13, mr = Math.max(8, w * 0.038);
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8c9a0';
    ctx.beginPath(); ctx.arc(mx - mr * 0.32, my - mr * 0.22, mr * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + mr * 0.30, my + mr * 0.26, mr * 0.16, 0, Math.PI * 2); ctx.fill();
    var g = ctx.createLinearGradient(0, gy, 0, h);
    g.addColorStop(0, '#4a2f6a'); g.addColorStop(1, '#241536');
    ctx.fillStyle = g; ctx.fillRect(0, gy, w, h - gy);
    ctx.strokeStyle = 'rgba(255,224,150,.35)'; ctx.lineWidth = Math.max(1, w * 0.0022);
    for (var l = 0; l < 3; l++) {
      var y0 = gy + (h - gy) * (0.35 + l * 0.22);
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.quadraticCurveTo(w * 0.5, y0 + h * 0.02, w, y0);
      ctx.stroke();
    }
    for (var b = 0; b < 7; b++) {
      var bx = ((b * 0.163 + 0.05) % 1) * w, by = gy + (h - gy) * (0.30 + (b % 3) * 0.22);
      ctx.fillStyle = 'rgba(255,236,170,' + (0.45 + 0.4 * Math.sin(t * 2 + b)) + ')';
      ctx.beginPath(); ctx.arc(bx, by, Math.max(1.4, w * 0.0038), 0, Math.PI * 2); ctx.fill();
    }
    drawFerrisArt(ctx, w, h, F, t);
    drawCarouselArt(ctx, w, h, F, t);
    drawTrampArt(ctx, w, h, F, t);
    for (var bl = 0; bl < 4; bl++) {
      var gx = w * (0.06 + bl * 0.09), gyy = h * (0.22 + (bl % 3) * 0.07) + Math.sin(t * 1.1 + bl) * h * 0.012;
      ctx.fillStyle = ['#ff8fa3', '#ffd166', '#8ad7ff', '#a6f0a0'][bl];
      ctx.beginPath(); ctx.ellipse(gx, gyy, w * 0.016, w * 0.020, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = Math.max(0.8, w * 0.0018);
      ctx.beginPath(); ctx.moveTo(gx, gyy + w * 0.018); ctx.lineTo(gx + w * 0.004, gyy + w * 0.045); ctx.stroke();
    }
  }

  /* ---- 操場 ---- */
  function drawHurdlesArt(ctx, w, h, T) {
    T.hurdles.forEach(function (hx) {
      var hh = T.hurdleH, hw = 0.090 * w;
      ctx.strokeStyle = '#e2eaf2'; ctx.lineWidth = Math.max(2, w * 0.006); ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx - hw / 2, T.runY + h * 0.004); ctx.lineTo(hx - hw / 2, T.runY - hh);
      ctx.moveTo(hx + hw / 2, T.runY + h * 0.004); ctx.lineTo(hx + hw / 2, T.runY - hh);
      ctx.stroke();
      ctx.fillStyle = '#f4f7fa';
      rr(ctx, hx - hw / 2, T.runY - hh, hw, hh * 0.26, 2); ctx.fill();
      ctx.fillStyle = '#e04b4b';
      rr(ctx, hx - hw / 2, T.runY - hh * 0.70, hw, hh * 0.16, 2); ctx.fill();
      ctx.fillStyle = '#9fb0c0';
      ctx.fillRect(hx - hw / 2 - w * 0.004, T.runY + h * 0.004, hw + w * 0.008, h * 0.008);
    });
  }

  function drawTrack(ctx, w, h, t) {
    var T = trackGeom(w, h), gy = T.gy;
    skyGrad(ctx, w, h, [[0, '#a9dcff'], [0.5, '#d8efff'], [1, '#f2fbff']]);
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    for (var c = 0; c < 3; c++) {
      var cx = (((c * 0.41 + 0.08) + t * 0.012 * (1 + (c % 2))) % 1.2 - 0.08) * w;
      cloud(ctx, cx, h * (0.11 + (c % 3) * 0.05), w * (0.032 + (c % 3) * 0.007));
    }
    // 司令台
    var gx = w * 0.10, gw = w * 0.30, gh = h * 0.155;
    ctx.fillStyle = '#d9dee6';
    rr(ctx, gx, gy - gh, gw, gh, Math.max(2, w * 0.006)); ctx.fill();
    ctx.fillStyle = '#b8c2ce';
    ctx.fillRect(gx, gy - gh * 0.30, gw, gh * 0.30);
    ctx.fillStyle = '#8e99a8';
    for (var s = 0; s < 3; s++) ctx.fillRect(gx + gw * (0.08 + s * 0.30), gy - gh * 0.30, gw * 0.18, gh * 0.30);
    ctx.fillStyle = '#e04b4b';
    rr(ctx, gx - w * 0.006, gy - gh - h * 0.030, gw + w * 0.012, h * 0.034, Math.max(2, w * 0.006)); ctx.fill();
    ctx.strokeStyle = '#8e99a8'; ctx.lineWidth = Math.max(1.5, w * 0.004);
    for (var p = 0; p <= 4; p++) {
      var px2 = gx + gw * (p / 4);
      ctx.beginPath(); ctx.moveTo(px2, gy - gh); ctx.lineTo(px2, gy - gh - h * 0.030); ctx.stroke();
    }
    // 旗子
    [[0.60, '#ffd166'], [0.78, '#8ad7ff'], [0.94, '#ff8fa3']].forEach(function (f, i) {
      var fx = w * f[0], fy = gy - h * 0.16;
      ctx.strokeStyle = '#c9d3dd'; ctx.lineWidth = Math.max(1.4, w * 0.0035);
      ctx.beginPath(); ctx.moveTo(fx, gy); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = f[1];
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + w * 0.026, fy + h * 0.016);
      ctx.lineTo(fx, fy + h * 0.036);
      ctx.closePath(); ctx.fill();
    });
    // 草地
    ctx.fillStyle = '#7ecb6b'; ctx.fillRect(0, gy, w, h - gy);
    // 跑道（貼著畫面底部的紅色跑道，動物站在上面）
    var bandTop = gy + 0.012 * h;
    ctx.fillStyle = '#c9584a';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, bandTop + h * 0.012);
    ctx.quadraticCurveTo(w * 0.5, bandTop - h * 0.018, w, bandTop + h * 0.012);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, bandTop + h * 0.012);
    ctx.quadraticCurveTo(w * 0.5, bandTop - h * 0.018, w, bandTop + h * 0.012);
    ctx.lineTo(w, h); ctx.closePath(); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.70)'; ctx.lineWidth = Math.max(1, w * 0.0022);
    for (var ln = 1; ln <= 3; ln++) {
      var ly = bandTop + (h - bandTop) * (ln / 4);
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w, ly); ctx.stroke();
    }
    ctx.restore();
    // 起跑線
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1.6, w * 0.004);
    ctx.beginPath();
    ctx.moveTo(w * 0.20, bandTop + h * 0.004);
    ctx.lineTo(w * 0.20, h);
    ctx.stroke();
    drawHurdlesArt(ctx, w, h, T);
  }

  /* ---- 設施的互動熱區（畫圖與互動共用同一組幾何） ---- */
  function sceneSpots(bg, w, h) {
    var gy = h * BG[bg].ground;
    var y0 = gy - 0.150 * h, y1 = gy + 0.02 * h;
    if (bg === 'park') {
      var P = parkGeom(w, h);
      return [
        { kind: 'slide', geom: P.slide, trig: { x0: 0.05 * w, x1: 0.445 * w, y0: y0, y1: y1 } },
        { kind: 'swing', geom: P.swing, trig: { x0: 0.450 * w, x1: 0.670 * w, y0: y0, y1: y1 } },
        { kind: 'bar', geom: P.bar, trig: { x0: 0.672 * w, x1: 0.828 * w, y0: y0, y1: y1 } },
        { kind: 'hide', geom: P.bush, trig: { x0: 0.828 * w, x1: 0.995 * w, y0: y0, y1: y1 } }
      ];
    }
    if (bg === 'fun') {
      var F = funGeom(w, h);
      return [
        { kind: 'ferris', geom: F.ferris, trig: { x0: 0.05 * w, x1: 0.44 * w, y0: y0, y1: y1 } },
        { kind: 'carousel', geom: F.carousel, trig: { x0: 0.45 * w, x1: 0.76 * w, y0: y0, y1: y1 } },
        { kind: 'tramp', geom: F.tramp, trig: { x0: 0.76 * w, x1: 0.99 * w, y0: y0, y1: y1 } }
      ];
    }
    if (bg === 'track') {
      var T = trackGeom(w, h);
      return [
        { kind: 'hurdle', geom: T, trig: { x0: 0.44 * w, x1: 0.74 * w, y0: y0, y1: y1 } },
        { kind: 'run', geom: T, trig: { x0: 0.28 * w, x1: 0.99 * w, y0: y0, y1: y1 } }
      ];
    }
    return [];
  }

  /* 俯視版的設施熱區（跟 topoFac 的幾何共用） */
  function sceneSpotsTopo(bg, w, h) {
    var G = topoFac(bg, w, h), out = [];
    if (bg === 'park') {
      out.push({ kind: 'slide', geom: G.slide, trig: { x: G.slide.botX, y: G.slide.botY, r: w * 0.080 } });
      out.push({ kind: 'swing', geom: G.swing, trig: { x: G.swing.cx, y: G.swing.seatY, r: w * 0.090 } });
      out.push({ kind: 'bar', geom: G.bar, trig: { x: G.bar.cx, y: G.bar.cy, r: w * 0.075 } });
      out.push({ kind: 'hide', geom: G.bush, trig: { x: G.bush.cx, y: G.bush.cy, r: G.bush.r * 1.10 } });
    } else if (bg === 'fun') {
      out.push({ kind: 'ferris', geom: G.ferris, trig: { x: G.ferris.cx, y: G.ferris.cy + G.ferris.ry * 1.10, r: w * 0.080 } });
      out.push({ kind: 'carousel', geom: G.carousel, trig: { x: G.carousel.cx, y: G.carousel.cy + G.carousel.ry * 1.10, r: w * 0.080 } });
      out.push({ kind: 'tramp', geom: G.tramp, trig: { x: G.tramp.cx, y: G.tramp.cy, r: G.tramp.rx * 1.05 } });
    } else if (bg === 'track') {
      out.push({ kind: 'hurdle', geom: G.hurdle, ring: true });
      out.push({ kind: 'run', geom: G.run, ring: true });
    }
    return out;
  }

  function countRiders(kind) {
    var n = 0;
    for (var i = 0; i < state.animals.length; i++) {
      var a = state.animals[i];
      if (a.ride && a.ride.kind === kind) n++;
    }
    return n;
  }

  function startRide(a, spot) {
    var r = {
      kind: spot.kind, spot: spot, t: 0, dur: RIDE_DUR[spot.kind] || 5,
      sx: a.x * view.w, sy: a.y * view.h, a0: 0, seat: 0
    };
    if (spot.kind === 'swing') {
      r.seat = (Math.abs(a.x * view.w - spot.geom.seatA) < Math.abs(a.x * view.w - spot.geom.seatB))
        ? spot.geom.seatA : spot.geom.seatB;
    }
    if (spot.kind === 'carousel' || spot.kind === 'ferris') r.a0 = Math.random() * Math.PI * 2;
    a.ride = r;
    a.rideCd = 0;
    a.rideTilt = 0;
    a.rideScale = 1;
    a.rideAnim = null;
    a.hideT = 0;
    a.pause = 0;
    if (state.selId === a.id) toast('牠跑去玩' + (FAC_NAME[spot.kind] || '設施') + '了！');
  }

  function endRide(a) {
    a.ride = null;
    a.rideTilt = 0; a.rideScale = 1; a.hideT = 0; a.noShadow = false;
    a.rideAnim = null; a.rideSpeed = 0;
    a.rideCd = rand(4, 9);
    a.pause = rand(0.4, 1.3);
    if (state.walkOn) pickWanderTarget(a);
  }

  function updateRide(a, dt) {
    if (!a || !a.ride) return;
    if (isTopo()) return updateRideTopo(a, dt);
    var r = a.ride, S = r.spot, w = view.w, h = view.h;
    var gy = h * BG[state.bg].ground;
    r.t += dt;
    var p = clamp(r.t / r.dur, 0, 1);
    a.rideTilt = 0; a.hideT = 0; a.noShadow = false;
    var x = a.x * w, y = a.y * h, k, e, ang;

    if (r.kind === 'slide') {
      var g = S.geom;
      if (p < 0.16) {
        k = p / 0.16;
        x = lerp(r.sx, g.ladderX, k); y = lerp(r.sy, gy, k);
        a.rideAnim = 'walk'; a.flip = false;
      } else if (p < 0.46) {
        k = (p - 0.16) / 0.30;
        x = g.ladderX; y = lerp(gy, g.topY, k);
        a.rideAnim = 'walk'; a.flip = false;
      } else if (p < 0.93) {
        k = (p - 0.46) / 0.47;
        e = k * k * 0.30 + k * 0.70;
        x = lerp(g.topX, g.bottomX, e);
        y = lerp(g.topY + h * 0.012, gy - h * 0.006, e);
        // 往後仰一點就好（轉到跟滑道完全平行會像「側躺」）
        a.rideTilt = -0.30;
        a.rideAnim = 'breathe'; a.flip = false;
      } else {
        x = g.bottomX; y = gy; a.rideAnim = 'breathe'; a.flip = false;
      }
    } else if (r.kind === 'swing') {
      var sw = S.geom;
      var amp = 0.045 * w;
      x = r.seat + Math.sin(r.t * 1.9) * amp;
      y = sw.seatY - Math.abs(Math.sin(r.t * 1.9)) * 0.010 * h;
      a.rideTilt = Math.sin(r.t * 1.9) * 0.10;
      a.rideAnim = 'breathe';
    } else if (r.kind === 'bar') {
      var bg2 = S.geom;
      for (var it = 0; it < 3; it++) {
        var H0 = animalGeom(a, w, h).h;
        y = bg2.barY + H0 * 0.92;
        a.y = y / h;
      }
      x = bg2.cx + Math.sin(r.t * 1.7) * 0.012 * w;
      a.rideTilt = Math.sin(r.t * 1.7) * 0.07;
      a.noShadow = true; a.rideAnim = 'breathe';
    } else if (r.kind === 'hide') {
      var bu = S.geom;
      if (p < 0.22) {
        k = p / 0.22;
        x = lerp(r.sx, bu.cx, k); y = lerp(r.sy, bu.gy, k);
      } else {
        x = bu.cx + Math.sin(r.t * 8) * 0.005 * w;
        y = bu.gy;
        var fadeIn = clamp((p - 0.22) / 0.16, 0, 1);
        var fadeOut = clamp((1 - p) / 0.16, 0, 1);
        a.hideT = Math.min(fadeIn, fadeOut);
        a.rideScale = 0.90;
      }
      a.rideAnim = 'breathe';
    } else if (r.kind === 'ferris') {
      var fe = S.geom;
      ang = r.a0 + p * Math.PI * 2;
      x = fe.cx + Math.cos(ang) * fe.R;
      y = fe.cy + Math.sin(ang) * fe.R + h * 0.032;
      a.rideScale = 0.36; a.noShadow = true; a.rideAnim = 'breathe';
      a.flip = Math.cos(ang) < 0;
    } else if (r.kind === 'carousel') {
      var ca = S.geom;
      ang = r.a0 + r.t * 1.25;
      var sn = Math.sin(ang);
      x = ca.cx + Math.cos(ang) * ca.rx;
      y = ca.cy + sn * ca.ry - Math.abs(sn) * h * 0.010;
      a.rideScale = 0.46 + 0.10 * (0.5 + 0.5 * sn);
      a.noShadow = true; a.rideAnim = 'breathe';
      a.flip = Math.sin(ang) > 0;
    } else if (r.kind === 'tramp') {
      var tr = S.geom;
      var ph = (r.t * 1.45) % 1;
      var lift = Math.sin(ph * Math.PI);
      x = tr.cx; y = tr.cy - lift * 0.115 * h;
      a.rideScale = 0.46 * (1 - 0.05 * Math.cos(ph * Math.PI * 2));
      a.noShadow = lift > 0.04; a.rideAnim = 'breathe';
    } else if (r.kind === 'run') {
      var trip = (r.t / 1.15) % 2;
      k = trip < 1 ? trip : 2 - trip;
      x = lerp(0.10 * w, 0.90 * w, k);
      y = S.geom.runY;
      a.flip = trip < 1;
      a.rideAnim = 'walk'; a.rideSpeed = 2.4;
    } else if (r.kind === 'hurdle') {
      var T2 = S.geom;
      k = clamp(r.t / (r.dur * 0.88), 0, 1);
      x = lerp(0.30 * w, 0.94 * w, k);
      var jl = 0;
      for (var hi = 0; hi < T2.hurdles.length; hi++) {
        var dx = Math.abs(x - T2.hurdles[hi]);
        var ww = 0.055 * w;
        if (dx < ww) jl = Math.max(jl, Math.cos((dx / ww) * Math.PI / 2) * 0.115 * h);
      }
      y = T2.runY - jl;
      a.flip = false; a.rideAnim = 'breathe'; a.noShadow = jl > 0.02;
      a.rideTilt = 0.22 * clamp(jl / (0.085 * h), 0, 1);
      a.rideScale = 1;
    }

    a.x = x / w; a.y = y / h;
    if (r.t >= r.dur) {
      if (r.kind === 'hide') a.hideT = 0;
      endRide(a);
    }
  }

  function tryStartRide(a) {
    if (!state.facOn || a.rideCd > 0 || a.ride) return;
    if (isTopo()) {
      var spotsT = sceneSpotsTopo(state.bg, view.w, view.h);
      if (!spotsT.length) return;
      var axT = a.x * view.w, ayT = a.y * view.h;
      for (var t1 = 0; t1 < spotsT.length; t1++) {
        var sT = spotsT[t1], hitT = false;
        if (sT.ring) {
          var dxn = (axT - sT.geom.cx) / sT.geom.Rx;
          var dyn = (ayT - sT.geom.cy) / sT.geom.Ry;
          var rrT = Math.sqrt(dxn * dxn + dyn * dyn);
          if (Math.abs(rrT - 1) < 0.22) {
            if (sT.kind === 'hurdle') {
              // 只有站在跨欄附近才算（不然整圈跑道都會變成跨欄）
              var angT = Math.atan2(dyn, dxn);
              for (var qT = 0; qT < sT.geom.angles.length; qT++) {
                var dAng = Math.atan2(Math.sin(angT - sT.geom.angles[qT]), Math.cos(angT - sT.geom.angles[qT]));
                if (Math.abs(dAng) < 0.36) { hitT = true; break; }
              }
            } else hitT = true;
          }
        } else {
          var ddxT = axT - sT.trig.x, ddyT = ayT - sT.trig.y;
          hitT = Math.sqrt(ddxT * ddxT + ddyT * ddyT) < sT.trig.r;
        }
        if (!hitT) continue;
        if (countRiders(sT.kind) >= 2) continue;
        startRide(a, sT);
        return;
      }
      return;
    }
    var spots = sceneSpots(state.bg, view.w, view.h);
    if (!spots.length) return;
    var ax = a.x * view.w, ay = a.y * view.h;
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i], tg = s.trig;
      if (ax < tg.x0 || ax > tg.x1 || ay < tg.y0 || ay > tg.y1) continue;
      if (countRiders(s.kind) >= 2) continue;
      startRide(a, s);
      return;
    }
  }

  /* 俯視版的乘坐動畫：一樣寫 a.x / a.y（比例座標），只是改成在地板上移動 */
  function updateRideTopo(a, dt) {
    var r = a.ride, S = r.spot, G = S.geom, w = view.w, h = view.h;
    r.t += dt;
    var p = clamp(r.t / r.dur, 0, 1), k, e, ang;
    a.rideTilt = 0; a.hideT = 0; a.noShadow = false;
    a.rideAnim = 'breathe'; a.rideScale = 1; a.rideSpeed = 1; a.slideSpeed = 0;
    var x = a.x * w, y = a.y * h;

    if (S.kind === 'slide') {
      if (p < 0.16) {
        k = p / 0.16;
        x = lerp(r.sx, G.topX, k); y = lerp(r.sy, G.topY, k);
        a.rideAnim = 'walk'; a.flip = G.topX < r.sx;
      } else if (p < 0.24) {
        x = G.topX; y = G.topY; a.flip = G.botX < G.topX;
        a.rideScale = 1.02;
      } else if (p < 0.62) {
        k = (p - 0.24) / 0.38;
        e = Math.pow(k, 1.55);                       // 越來越快（真的像在滑）
        x = lerp(G.topX, G.botX, e); y = lerp(G.topY, G.botY, e);
        a.rideTilt = 0.30; a.rideScale = 0.94;
        a.flip = G.botX < G.topX;
        a.slideSpeed = Math.sin(k * Math.PI) * (0.35 + 0.65 * k);
      } else {
        x = G.botX; y = G.botY; a.rideTilt = 0.06;
        a.rideScale = 1 - 0.05 * Math.sin(clamp((p - 0.62) / 0.38, 0, 1) * Math.PI);
      }
    } else if (S.kind === 'swing') {
      x = r.seat + Math.sin(r.t * 1.9) * w * 0.062;
      y = G.seatY;
      a.rideTilt = Math.sin(r.t * 1.9) * 0.20;
    } else if (S.kind === 'bar') {
      x = G.cx + Math.sin(r.t * 1.7) * w * 0.014;
      y = G.cy;
      a.rideTilt = Math.sin(r.t * 1.7) * 0.10;
      a.noShadow = true;
    } else if (S.kind === 'hide') {
      if (p < 0.25) { k = p / 0.25; x = lerp(r.sx, G.cx, k); y = lerp(r.sy, G.cy, k); }
      else { x = G.cx + Math.sin(r.t * 7) * w * 0.004; y = G.cy; }
      var fi = clamp((p - 0.25) / 0.15, 0, 1), fo = clamp((1 - p) / 0.15, 0, 1);
      a.hideT = Math.min(fi, fo); a.rideScale = 0.92;
    } else if (S.kind === 'ferris') {
      ang = r.a0 + p * Math.PI * 2;
      x = G.cx + Math.cos(ang) * G.rx * 1.06;
      y = G.cy + Math.sin(ang) * G.ry * 1.06;
      a.rideScale = 0.80; a.flip = Math.cos(ang + Math.PI / 2) < 0;
    } else if (S.kind === 'carousel') {
      ang = r.a0 + p * Math.PI * 2 * 1.15;
      x = G.cx + Math.cos(ang) * G.rx * 0.78;
      y = G.cy + Math.sin(ang) * G.ry * 0.78;
      a.rideScale = 0.86; a.flip = Math.sin(ang) > 0;
    } else if (S.kind === 'tramp') {
      var ph = (r.t * 1.5) % 1;
      x = G.cx; y = G.cy - Math.sin(ph * Math.PI) * h * 0.035;
      a.rideScale = 0.90 * (1 - 0.05 * Math.cos(ph * Math.PI * 2));
    } else if (S.kind === 'run') {
      ang = G.a0 + p * Math.PI * 2 * 1.35;
      x = G.cx + Math.cos(ang) * G.Rx;
      y = G.cy + Math.sin(ang) * G.Ry;
      a.rideAnim = 'walk'; a.rideSpeed = 2.2; a.flip = Math.sin(ang) > 0;
    } else if (S.kind === 'hurdle') {
      ang = G.a0 + p * (G.a1 - G.a0);
      x = G.cx + Math.cos(ang) * G.Rx;
      y = G.cy + Math.sin(ang) * G.Ry;
      var hop = 0;
      for (var hi = 0; hi < G.angles.length; hi++) {
        var dd = Math.abs(ang - G.angles[hi]);
        if (dd < 0.24) hop = Math.max(hop, Math.cos((dd / 0.24) * Math.PI / 2));
      }
      y -= hop * h * 0.032;
      a.rideTilt = 0.16 * hop; a.noShadow = hop > 0.05;
      a.rideAnim = 'walk'; a.rideSpeed = 1.6; a.flip = Math.sin(ang) > 0;
    }

    a.x = clampX(a, x / w);
    a.y = clamp(y / h, TOP_LO, TOP_HI);
    if (r.t >= r.dur) {
      if (S.kind === 'hide') a.hideT = 0;
      endRide(a);
    }
  }

  /* ---------------- 動物 ---------------- */
  function animalGeom(a, w, h) {
    if (isTopo()) {
      // 俯視：越靠下（越近）越大；隻數一多就自動縮小，才裝得下
      var d = clamp((a.y - TOP_LO) / (TOP_HI - TOP_LO), 0, 1);
      var n = state.animals.length;
      var crowd = n <= 10 ? 1 : Math.max(0.72, 1 - (n - 10) * 0.022);
      var th = h * 0.108 * dz(d) * a.size * crowd * (a.rideScale || 1);
      var tw = th * (a.sprite.width / a.sprite.height);
      return { cx: a.x * w, base: a.y * h, w: tw, h: th, ground: h, depth: d };
    }
    var ground = h * BG[state.bg].ground;
    var depth = clamp((a.y - (BG[state.bg].ground - 0.09)) / 0.09, 0, 1);
    var baseH = h * 0.22;
    // 玩設施時不要跟著「遠近」縮放，不然摩天輪轉一圈大小會忽大忽小
    var depthF = a.ride ? 1 : (0.72 + 0.5 * depth);
    var hh = baseH * a.size * depthF * (a.rideScale || 1);
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
      // 影子（在設施上／空中就不畫）
      if (!a.noShadow) {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = isTopo() ? (TOPO_SHADOW[state.bg] || 'rgba(0,0,0,.22)') : BG[state.bg].shadow;
        ctx.beginPath();
        if (isTopo()) ctx.ellipse(G.cx + G.w * 0.04, G.base - G.h * 0.02, G.w * 0.44, G.h * 0.150, 0, 0, Math.PI * 2);
        else ctx.ellipse(G.cx, G.base, G.w * 0.36, G.h * 0.055, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      var animName = a.rideAnim || a.anim;
      var spd = a.rideSpeed || a.speed;
      var m = Motion.motion(animName, t + a.phase, 1, spd);
      ctx.save();
      ctx.translate(G.cx + m.ox * G.w, G.base + m.oy * G.h);
      if (a.flip) ctx.scale(-1, 1);
      var rot = m.rot + (a.rideTilt || 0);
      if (rot) ctx.rotate(rot);
      ctx.scale(m.sx, m.sy);
      var x = -G.w / 2, y = -G.h;
      if (m.warp > 0.01) Motion.drawWarped(ctx, a.sprite, x, y, G.w, G.h, t + a.phase, m.warp, spd, bands);
      else ctx.drawImage(a.sprite, x, y, G.w, G.h);
      ctx.restore();

      // 坐摩天輪：腳下補一條車廂前緣，才不會像浮在空中
      if (a.ride && a.ride.kind === 'ferris') {
        ctx.save();
        var fe2 = funGeom(w, h).ferris;
        var ang2 = a.ride.a0 + (a.ride.t / a.ride.dur) * Math.PI * 2;
        var cx2 = fe2.cx + Math.cos(ang2) * fe2.R;
        var cy2 = fe2.cy + Math.sin(ang2) * fe2.R;
        var cw2 = w * 0.075, chh2 = h * 0.058;
        ctx.fillStyle = ['#ff8fa3', '#ffd166', '#8ad7ff', '#a6f0a0', '#c9a7ff']
          [Math.round(((ang2 + Math.PI / 2) / (Math.PI * 2)) * 10) % 5];
        rr(ctx, cx2 - cw2 / 2, cy2 + chh2 * 0.52, cw2, chh2 * 0.50, w * 0.010);
        ctx.fill();
        ctx.strokeStyle = 'rgba(70,50,30,.35)'; ctx.lineWidth = 1.2;
        rr(ctx, cx2 - cw2 / 2, cy2 + chh2 * 0.52, cw2, chh2 * 0.50, w * 0.010);
        ctx.stroke();
        ctx.restore();
      }

      // 躲在草叢：把葉子畫在動物身上（蓋住下半身）
      if (a.hideT > 0.01) {
        ctx.save();
        ctx.globalAlpha = a.hideT;
        if (isTopo()) {
          // 俯視：動物整個埋進葉子里（從上面看不到牠）
          var tr0 = G.w * 0.55;
          var gg0 = ctx.createRadialGradient(G.cx - tr0 * 0.3, G.base - G.h * 0.35, tr0 * 0.1, G.cx, G.base - G.h * 0.25, tr0 * 1.15);
          gg0.addColorStop(0, '#9cd47c'); gg0.addColorStop(0.65, '#57a04a'); gg0.addColorStop(1, '#3a7a37');
          ctx.fillStyle = gg0;
          for (var hb = 0; hb < 6; hb++) {
            var ha = (hb / 6) * Math.PI * 2 + 0.4;
            ctx.beginPath();
            ctx.arc(G.cx + Math.cos(ha) * tr0 * 0.55, G.base - G.h * 0.28 + Math.sin(ha) * tr0 * 0.34, tr0 * 0.62, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = 'rgba(255,255,255,.22)';
          ctx.beginPath();
          ctx.ellipse(G.cx - tr0 * 0.25, G.base - G.h * 0.52, tr0 * 0.34, tr0 * 0.20, -0.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          var hr = G.w * 0.36;
          ctx.fillStyle = '#3f9142';
          ctx.beginPath();
          ctx.arc(G.cx - hr * 1.00, G.base - G.h * 0.16, hr * 0.82, 0, Math.PI * 2);
          ctx.arc(G.cx + hr * 0.15, G.base - G.h * 0.26, hr * 0.98, 0, Math.PI * 2);
          ctx.arc(G.cx + hr * 1.05, G.base - G.h * 0.14, hr * 0.80, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#57ab54';
          ctx.beginPath();
          ctx.arc(G.cx - hr * 0.55, G.base - G.h * 0.34, hr * 0.52, 0, Math.PI * 2);
          ctx.arc(G.cx + hr * 0.62, G.base - G.h * 0.30, hr * 0.48, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 溜滑梯的速度線（看得出正在滑）
      if (isTopo() && a.slideSpeed > 0.18) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + 0.4 * a.slideSpeed).toFixed(2) + ')';
        ctx.lineWidth = Math.max(2, G.w * 0.060);
        ctx.lineCap = 'round';
        for (var sl = 0; sl < 3; sl++) {
          var ly = G.base - G.h * (0.28 + sl * 0.22);
          var ln = G.w * (0.42 + sl * 0.16) * (0.6 + a.slideSpeed);
          ctx.beginPath();
          ctx.moveTo(G.cx + (a.flip ? -1 : 1) * G.w * 0.34, ly);
          ctx.lineTo(G.cx + (a.flip ? -1 : 1) * (G.w * 0.34 + ln), ly);
          ctx.stroke();
        }
        ctx.restore();
      }

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
    if (isTopo()) {
      // 三成的機會直接朝某個設施走過去（不然設施常常沒人玩）
      var spotsW = sceneSpotsTopo(state.bg, view.w, view.h);
      if (spotsW.length && Math.random() < 0.32) {
        var sw = spotsW[Math.floor(Math.random() * spotsW.length)];
        var txw, tyw;
        if (sw.ring) {
          var aw = sw.geom.a0 + Math.random() * (sw.geom.a1 - sw.geom.a0);
          if (sw.kind === 'hurdle') aw = sw.geom.angles[Math.floor(Math.random() * sw.geom.angles.length)];
          txw = (sw.geom.cx + Math.cos(aw) * sw.geom.Rx) / view.w;
          tyw = (sw.geom.cy + Math.sin(aw) * sw.geom.Ry) / view.h;
        } else {
          txw = sw.trig.x / view.w; tyw = sw.trig.y / view.h;
        }
        a.tx = clamp(txw, 0.05, 0.95);
        a.ty = clamp(tyw, TOP_LO, TOP_HI);
        return;
      }
      var tb = null, tbScore = -1;
      for (var q = 0; q < 14; q++) {
        var tx0 = rand(0.09, 0.91);
        var ty0 = rand(TOP_LO + 0.02, TOP_HI - 0.01);
        var td = 9;
        for (var m = 0; m < state.animals.length; m++) {
          var oa = state.animals[m];
          if (oa === a) continue;
          var ddx = oa.x - tx0, ddy = (oa.y - ty0) * 0.72;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd < td) td = dd;
        }
        var sc = td + (td < 0.10 ? -9 : 0);
        if (!tb || sc > tbScore) { tbScore = sc; tb = { x: tx0, y: ty0 }; }
      }
      a.tx = tb.x; a.ty = tb.y;
      return;
    }
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
      // ⚠️ 2026-11-05：十幾隻擠在一起時，12 個候選可能全部「太近」→ best 一直是 null 就爆掉。
      // 改成第一個候選先當備案，後面只挑更好的。
      var score = minD + (minD < 0.12 ? -9 : 0);
      if (!best || score > bestScore) { bestScore = score; best = { x: tx, y: ty }; }
    }
    a.tx = best.x; a.ty = best.y;
  }

  /* 動物之間的軟排斥：靠太近就慢慢分開，不會疊成一團 */
  function separate() {
    if (isTopo()) return separateTopo();
    var n = state.animals.length;
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var a = state.animals[i], b = state.animals[j];
        if (a.ride || b.ride) continue;      // 正在玩設施的不要被推走
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

  /* 俯視時的排斥：x 跟 y 都要推開（不然會疊成一堆） */
  function separateTopo() {
    var n = state.animals.length, w = view.w, h = view.h;
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var a = state.animals[i], b = state.animals[j];
        if (a.ride || b.ride) continue;
        var Ga = animalGeom(a, w, h), Gb = animalGeom(b, w, h);
        var minx = (Ga.w + Gb.w) * 0.44 / w;
        var miny = (Ga.h + Gb.h) * 0.34 / h;
        var dx = b.x - a.x, dy = b.y - a.y;
        var ox = minx - Math.abs(dx), oy = miny - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        if (ox / minx < oy / miny) {
          var px = ox * 0.55 * (dx >= 0 ? 1 : -1);
          a.x = clampX(a, a.x - px);
          b.x = clampX(b, b.x + px);
        } else {
          var py = oy * 0.55 * (dy >= 0 ? 1 : -1);
          a.y = clamp(a.y - py, TOP_LO, TOP_HI);
          b.y = clamp(b.y + py, TOP_LO, TOP_HI);
        }
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
    if (isTopo()) my = mx * (view.w / Math.max(1, view.h));   // 上下位移換算成畫面速度，斜著走才不會忽快忽慢
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
      if (a.rideCd > 0) a.rideCd -= dt;
      // 正在玩設施：沿著設施的路徑移動，不做自由走動
      if (a.ride) {
        updateRide(a, dt);
        spawnFx(a, dt);
        continue;
      }
      // 正在被手指拖的那隻不要自己走（不然會跟手指打架）
      if (!(drag && drag.id === a.id)) updateWander(a, dt);
      a.x = clampX(a, a.x);
      var yl = yLimits();
      a.y = clamp(a.y, yl.lo, yl.hi);
      tryStartRide(a);
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
    if (isTopo()) drawTopoSwingSeats(ctx, w, h);   // 座椅要跟著動物盪，不能畫死在背景
    drawParticles(ctx);          // 特效在動物後面：不會蓋住小朋友畫的五官
    drawAnimals(ctx, w, h, t);
    if (isTopo()) drawTopoFront(ctx, w, h);   // 最前面的草叢蓋在動物身上 → 有層次
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
    var yl2 = yLimits();
    a.x = clampX(a, nx);
    a.y = clamp(ny, yl2.lo, yl2.hi);
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
    var tfa = $('#tgFac');
    if (tfa) {
      state.facOn = tfa.checked;
      tfa.addEventListener('change', function () {
        state.facOn = tfa.checked;
        if (!tfa.checked) state.animals.forEach(function (a) { if (a.ride) endRide(a); });
        toast(tfa.checked ? '設施互動打開了 🎡' : '設施先休息一下 😴');
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
      // 換場景時把正在玩的設施停掉（不然會停在半空中）
      state.animals.forEach(function (a) {
        if (a.ride) endRide(a);
        a.rideCd = Math.max(a.rideCd || 0, 1.5);
      });
      state.bg = next;
      topoCache.key = ''; topoFront.key = '';
      // 動物跟著新地面走（保持相對深度）；俯視的地板是整片，不用換算
      if (!isTopo()) {
        var newGround = BG[next].ground;
        state.animals.forEach(function (a) {
          var d = oldGround - a.y;
          a.y = clamp(newGround - d, newGround - 0.30, newGround + 0.02);
        });
      }
      toast('換到「' + BG[next].name + '」' +
        (isTopo() ? '（俯視）' : (sceneSpots(next, view.w, view.h).length ? '（把動物拖到設施上試試）' : '')));
    });

    /* 視角切換：側面（玩設施）↔ 俯視（放很多隻） */
    var vs = $('#views');
    if (vs) vs.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.view-chip') : null;
      if (!b) return;
      setMode(b.getAttribute('data-view'));
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
    syncViewUI();
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
    setBg: function (bg) {
      if (!BG[bg]) return;
      state.bg = bg; topoCache.key = ''; topoFront.key = '';
      var chips = document.querySelectorAll('#bgs .bg-chip');
      Array.prototype.forEach.call(chips, function (c) { c.classList.toggle('active', c.getAttribute('data-bg') === bg); });
    },
    setMode: setMode,
    isTopo: isTopo,
    yLimits: yLimits,
    topoKey: topoKey,
    exportPng: exportPng,
    exportVideo: exportVideo,
    geodesic: function (a) { return animalGeom(a, view.w, view.h); },
    step: advance,
    setFx: setFx,
    particles: particles,
    sceneSpots: function (bg) { return sceneSpots(bg || state.bg, view.w, view.h); },
    sceneSpotsTopo: function (bg) { return sceneSpotsTopo(bg || state.bg, view.w, view.h); },
    topoFac: function (bg) { return topoFac(bg || state.bg, view.w, view.h); },
    startRide: function (a, spot) { startRide(a, spot); },
    updateRide: updateRide,
    endRide: endRide,
    tryStartRide: tryStartRide,
    facName: FAC_NAME,
    rideDur: RIDE_DUR,
    parkGeom: function () { return parkGeom(view.w, view.h); },
    funGeom: function () { return funGeom(view.w, view.h); },
    trackGeom: function () { return trackGeom(view.w, view.h); },
    guessFx: guessFx,
    trimFaint: trimFaint,
    isInAppBrowser: isInAppBrowser,
    hasUploadWire: function () {
      return !!(document.getElementById('fileAlbum') &&
                document.getElementById('labAlbum') &&
                document.getElementById('labAlbum').getAttribute('for') === 'fileAlbum');
    }
  };
})();
