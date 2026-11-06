/*!
 * app.js — 塗鴉動物復活機：舞台、動畫、匯出
 * 影像前處理在 core.js（AnimalCore），這裡只做 DOM / 繪圖。
 */
(function () {
  'use strict';

  var Core = (typeof window !== 'undefined' && window.AnimalCore) ? window.AnimalCore : null;

  var state = {
    raw: null,        // 原始照片 ImageData
    sprite: null,     // 去背後（已裁掉空白）的 canvas
    info: null,       // core 回傳的統計
    anim: 'breathe',
    amp: 1,
    speed: 1,
    scene: true,
    opts: { illum: true, removeBg: true },
    playing: true,
    recording: false,
    t: 0
  };

  var view = { w: 320, h: 240, dpr: 1, ready: false };
  var els = {};
  var rafStarted = false;
  var lastTs = 0;

  /* ---------------- 小工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  var toastTimer = null;
  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 2600);
  }
  function busy(on, text) {
    if (!els.busy) return;
    els.busyText.textContent = text || '處理中…';
    els.busy.classList.toggle('hidden', !on);
  }

  /* ---------------- 尺寸 ---------------- */
  function resize() {
    var cv = els.stage;
    if (!cv) return;
    var rect = cv.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width || 320));
    var h = Math.max(1, Math.round(rect.height || 240));
    var dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    if (view.w !== w || view.h !== h || view.dpr !== dpr) {
      view.w = w; view.h = h; view.dpr = dpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    view.ready = true;
  }

  /* ---------------- 載入照片 ---------------- */
  function loadFile(file) {
    if (!file) return;
    busy(true, '讀取照片…');
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      fromImageElement(img);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      busy(false);
      toast('這張照片讀不進來，換一張試試 🙏');
    };
    img.src = url;
  }

  function fromImageElement(img) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) { busy(false); toast('照片是空的，換一張試試'); return; }
    var MAX = 1200;
    var s = Math.min(1, MAX / Math.max(iw, ih));
    var w = Math.max(1, Math.round(iw * s));
    var h = Math.max(1, Math.round(ih * s));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var cx = c.getContext('2d');
    cx.fillStyle = '#ffffff';       // 透明 PNG 也給白底，模擬畫紙
    cx.fillRect(0, 0, w, h);
    cx.drawImage(img, 0, 0, w, h);
    state.raw = cx.getImageData(0, 0, w, h);
    processNow();
  }

  function fromImageData(imageData) {   // 給測試 / 示範用
    state.raw = imageData;
    processNow();
  }

  /* ---------------- 影像處理 ---------------- */
  function processNow() {
    if (!state.raw) return Promise.resolve(false);
    busy(true, '幫動物去背…');
    return new Promise(function (resolve) {
      setTimeout(function () {
        try {
          var src = state.raw;
          var res = Core.process(new Uint8ClampedArray(src.data), src.width, src.height, state.opts);

          var full = document.createElement('canvas');
          full.width = res.width; full.height = res.height;
          full.getContext('2d').putImageData(
            new ImageData(new Uint8ClampedArray(res.data), res.width, res.height), 0, 0);

          var b = res.bbox;
          var out = document.createElement('canvas');
          out.width = Math.max(1, b.w);
          out.height = Math.max(1, b.h);
          out.getContext('2d').drawImage(full, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);

          state.sprite = out;
          state.info = res;
          busy(false);
          showStage();
          updateHint();
          resize();
          resolve(true);
        } catch (e) {
          busy(false);
          toast('處理失敗：' + (e && e.message ? e.message : e));
          resolve(false);
        }
      }, 30);
    });
  }

  function updateHint() {
    if (!els.hint || !state.info) return;
    var r = state.info.removedRatio;
    var msg = '';
    var warn = false;
    if (state.opts.removeBg) {
      if (r < 0.06) {
        msg = '⚠️ 幾乎沒有去掉背景（只去掉 ' + Math.round(r * 100) + '%）——可能是紙太暗或圖佔滿畫面。試試「修正燈光」重開，或重拍一張、鏡頭只拍畫。';
        warn = true;
      } else {
        msg = '✅ 已去掉 ' + Math.round(r * 100) + '% 的背景（桌面、白紙）。顏色維持小朋友畫的原色。';
      }
    } else {
      msg = 'ℹ️ 已關閉去背，會保留整張紙。';
    }
    els.hint.textContent = msg;
    els.hint.classList.toggle('warn', warn);
  }

  function showStage() {
    if (els.pick) els.pick.classList.add('hidden');
    if (els.play) els.play.classList.remove('hidden');
    startLoop();
  }
  function showPick() {
    if (els.play) els.play.classList.add('hidden');
    if (els.pick) els.pick.classList.remove('hidden');
    busy(false);
  }

  /* ---------------- 動作（共用模組 motion.js） ---------------- */
  var M = (typeof window !== 'undefined' && window.AnimalMotion) ? window.AnimalMotion : null;
  var motion = function (mode, t, amp, speed) {
    return M ? M.motion(mode, t, amp, speed)
             : { rot: 0, sx: 1, sy: 1, ox: 0, oy: 0, warp: 0, lift: 0 };
  };
  var drawWarped = function (ctx, img, x, y, w, h, t, amp, speed, bands) {
    if (M) M.drawWarped(ctx, img, x, y, w, h, t, amp, speed, bands);
  };

  /* ---------------- 場景 ---------------- */
  function drawScene(ctx, w, h, t) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#bfe9ff');
    g.addColorStop(0.55, '#e8f7ff');
    g.addColorStop(1, '#f4ffe9');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 太陽
    var sunX = w * 0.84, sunY = h * 0.16, sunR = Math.min(w, h) * 0.075;
    ctx.save();
    ctx.globalAlpha = 0.9;
    var rg = ctx.createRadialGradient(sunX, sunY, sunR * 0.4, sunX, sunY, sunR * 2.4);
    rg.addColorStop(0, 'rgba(255,229,138,.95)');
    rg.addColorStop(1, 'rgba(255,229,138,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe066';
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 雲（慢慢飄）
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    for (var i = 0; i < 4; i++) {
      var spd = 0.006 + i * 0.003;
      var cx = ((t * spd + i * 0.29) % 1.3) * w - w * 0.15;
      var cy = h * (0.10 + 0.055 * (i % 3)) + Math.sin(t * 0.5 + i) * 2;
      var r = Math.min(w, h) * (0.045 + 0.012 * (i % 2));
      puff(ctx, cx, cy, r);
    }
    ctx.restore();

    // 遠山
    ctx.fillStyle = '#cdeec0';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.78);
    ctx.quadraticCurveTo(w * 0.22, h * 0.62, w * 0.46, h * 0.78);
    ctx.quadraticCurveTo(w * 0.70, h * 0.92, w, h * 0.74);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();

    // 草地
    var gg = ctx.createLinearGradient(0, h * 0.80, 0, h);
    gg.addColorStop(0, '#9fe07f');
    gg.addColorStop(1, '#68c455');
    ctx.fillStyle = gg;
    ctx.fillRect(0, h * 0.855, w, h * 0.145);

    // 小草
    ctx.strokeStyle = '#4fae40';
    ctx.lineWidth = Math.max(1.2, w * 0.0035);
    ctx.lineCap = 'round';
    for (var k = 0; k < 14; k++) {
      var gx = ((k * 0.073 + 0.04) % 1) * w;
      var gy = h * 0.87 + ((k * 37) % 11) / 11 * h * 0.10;
      var sway2 = Math.sin(t * 1.6 + k) * w * 0.006;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + sway2 * 0.5, gy - h * 0.035, gx + sway2, gy - h * 0.06);
      ctx.stroke();
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

  /* ---------------- 主繪製 ---------------- */
  function layout() {
    var sp = state.sprite;
    var padX = 0.08, padTop = 0.10, groundY = view.h * 0.86;
    var maxW = view.w * (1 - padX * 2);
    var maxH = view.h * (1 - padTop) * 0.94;
    var s = Math.min(maxW / sp.width, maxH / sp.height);
    var dw = sp.width * s, dh = sp.height * s;
    return { cx: view.w / 2, groundY: groundY, dw: dw, dh: dh };
  }

  function drawFrame(t) {
    var cv = els.stage;
    if (!cv) return;
    var ctx = cv.getContext('2d');
    if (!ctx) return;
    var w = view.w, h = view.h;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (state.scene) drawScene(ctx, w, h, t);
    else {
      ctx.fillStyle = '#f7fdff';
      ctx.fillRect(0, 0, w, h);
    }

    var sp = state.sprite;
    if (!sp) return;
    var L = layout();
    var m = motion(state.anim, t, state.amp, state.speed);

    // 地面陰影（離地時變小變淡）
    var lift = Math.max(0, m.lift || 0);
    var sScale = 1 - Math.min(0.55, lift * 1.5);
    ctx.save();
    ctx.globalAlpha = 0.20 * sScale;
    ctx.fillStyle = '#2b5e2a';
    ctx.beginPath();
    ctx.ellipse(L.cx + m.ox * L.dw, L.groundY + L.dh * 0.012,
      L.dw * 0.34 * sScale, L.dh * 0.045 * sScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(L.cx + m.ox * L.dw, L.groundY + m.oy * L.dh);
    if (m.rot) ctx.rotate(m.rot);
    ctx.scale(m.sx, m.sy);
    var x = -L.dw / 2, y = -L.dh;
    if (m.warp > 0.01) drawWarped(ctx, sp, x, y, L.dw, L.dh, t, m.warp, state.speed);
    else ctx.drawImage(sp, x, y, L.dw, L.dh);
    ctx.restore();
  }

  function startLoop() {
    if (rafStarted) return;
    rafStarted = true;
    var step = function (ts) {
      var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
      lastTs = ts;
      if (state.playing) state.t += dt;
      if (state.sprite) drawFrame(state.t);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------------- 示範圖（程序畫的貓） ---------------- */
  function makeDemo() {
    var W = 900, H = 760;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');
    // 桌面
    x.fillStyle = '#6d5a4c'; x.fillRect(0, 0, W, H);
    // 紙
    x.fillStyle = '#fdfcf7';
    x.fillRect(60, 50, W - 120, H - 100);

    var ink = '#2b2b2b';
    x.lineJoin = 'round'; x.lineCap = 'round';

    // 尾巴
    x.strokeStyle = ink; x.lineWidth = 18;
    x.beginPath(); x.moveTo(620, 520); x.quadraticCurveTo(740, 470, 730, 360); x.stroke();
    x.strokeStyle = '#f6a83c'; x.lineWidth = 9;
    x.beginPath(); x.moveTo(620, 520); x.quadraticCurveTo(740, 470, 730, 360); x.stroke();

    // 身體
    x.fillStyle = '#f6a83c';
    x.beginPath(); x.ellipse(450, 470, 210, 150, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = ink; x.lineWidth = 12; x.stroke();

    // 肚子（白色色塊）
    x.fillStyle = '#fdfcf7';
    x.beginPath(); x.ellipse(450, 505, 105, 90, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = ink; x.lineWidth = 9; x.stroke();

    // 腳
    x.fillStyle = '#f6a83c'; x.strokeStyle = ink; x.lineWidth = 11;
    [[330, 585], [450, 600], [570, 585]].forEach(function (p) {
      x.beginPath(); x.ellipse(p[0], p[1], 52, 34, 0, 0, Math.PI * 2); x.fill(); x.stroke();
    });

    // 頭
    x.fillStyle = '#f9be5b';
    x.beginPath(); x.ellipse(450, 270, 150, 135, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = ink; x.lineWidth = 12; x.stroke();

    // 耳朵
    x.fillStyle = '#f6a83c';
    [[350, 175], [550, 175]].forEach(function (p, i) {
      x.beginPath();
      x.moveTo(p[0] - 62, p[1] + 30);
      x.lineTo(p[0], p[1] - 60);
      x.lineTo(p[0] + 62, p[1] + 30);
      x.closePath(); x.fill(); x.stroke();
      // 耳朵內粉紅
      x.fillStyle = '#f79ab0';
      x.beginPath();
      x.moveTo(p[0] - 32, p[1] + 22);
      x.lineTo(p[0], p[1] - 26);
      x.lineTo(p[0] + 32, p[1] + 22);
      x.closePath(); x.fill();
      x.fillStyle = '#f6a83c';
    });

    // 眼睛
    x.fillStyle = '#1f2b33';
    [[400, 255], [500, 255]].forEach(function (p) {
      x.beginPath(); x.ellipse(p[0], p[1], 20, 26, 0, 0, Math.PI * 2); x.fill();
    });
    x.fillStyle = '#fff';
    [[394, 246], [494, 246]].forEach(function (p) {
      x.beginPath(); x.arc(p[0], p[1], 7, 0, Math.PI * 2); x.fill();
    });

    // 鼻子（綠！小朋友愛亂配色）
    x.fillStyle = '#5cc46a';
    x.beginPath();
    x.moveTo(450, 300); x.lineTo(432, 322); x.lineTo(468, 322); x.closePath(); x.fill();
    x.strokeStyle = ink; x.lineWidth = 7; x.stroke();

    // 嘴巴
    x.strokeStyle = ink; x.lineWidth = 8;
    x.beginPath(); x.moveTo(450, 322); x.lineTo(450, 340); x.stroke();
    x.beginPath(); x.arc(430, 340, 20, 0.05 * Math.PI, 0.95 * Math.PI); x.stroke();
    x.beginPath(); x.arc(470, 340, 20, 0.05 * Math.PI, 0.95 * Math.PI); x.stroke();

    // 鬍鬚
    x.lineWidth = 6;
    [[-1, 1], [1, -1]].forEach(function (sgn) {
      for (var i = 0; i < 3; i++) {
        x.beginPath();
        x.moveTo(450 + sgn[0] * 60, 315 + i * 16 - 12);
        x.quadraticCurveTo(450 + sgn[0] * 130, 305 + i * 18 - 14, 450 + sgn[0] * 185, 300 + i * 22 - 18);
        x.stroke();
      }
    });

    // 斑點（紫色蠟筆）
    x.fillStyle = '#8e6cd6';
    [[370, 430, 30], [520, 415, 24], [470, 520, 20]].forEach(function (p) {
      x.beginPath(); x.arc(p[0], p[1], p[2], 0, Math.PI * 2); x.fill();
    });

    return x.getImageData(0, 0, W, H);
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
    var sp = state.sprite;
    if (!sp) return;
    var MAXS = 1400;
    var s = Math.min(2, MAXS / Math.max(sp.width, sp.height));
    var c = document.createElement('canvas');
    c.width = Math.round(sp.width * s);
    c.height = Math.round(sp.height * s);
    c.getContext('2d').drawImage(sp, 0, 0, c.width, c.height);
    if (c.toBlob) c.toBlob(function (b) { if (b) download(b, '塗鴉動物.png'); }, 'image/png');
    else toast('這個瀏覽器不支援匯出');
    toast('已存成透明 PNG 🖼️');
  }

  var MIME_CANDIDATES = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];

  function pickMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      if (MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
    }
    return '';
  }

  function exportVideo(seconds) {
    seconds = seconds || 5;
    var cv = els.stage;
    if (!cv || !cv.captureStream) { toast('這個瀏覽器不能錄影，改用電腦 Chrome 試試 🙏'); return Promise.resolve(false); }
    if (typeof MediaRecorder === 'undefined') { toast('這個瀏覽器不能錄影，改用電腦 Chrome 試試 🙏'); return Promise.resolve(false); }
    if (state.recording) return Promise.resolve(false);

    var mime = pickMime();
    var stream;
    try { stream = cv.captureStream(30); } catch (e) { toast('錄影啟動失敗'); return Promise.resolve(false); }

    var rec;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined);
    } catch (e) {
      toast('錄影啟動失敗：' + (e && e.message ? e.message : e));
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
        if (btn) { btn.disabled = false; btn.textContent = '📹 錄成影片'; }
        try { stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) {}
        var type = mime || 'video/webm';
        var blob = new Blob(chunks, { type: type });
        var ext = type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
        download(blob, '塗鴉動物.' + ext);
        toast('影片好了！已下載 🎬');
        resolve(true);
      };
      try { rec.start(); } catch (e) { toast('錄影啟動失敗'); resolve(false); }
      setTimeout(function () {
        if (rec.state !== 'inactive') rec.stop();
      }, seconds * 1000);
      toast('錄 ' + seconds + ' 秒，保持畫面不動一下…');
    });
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    els.pick = $('#pick'); els.play = $('#play');
    els.stage = $('#stage'); els.busy = $('#busy'); els.busyText = $('#busyText');
    els.hint = $('#hint'); els.toast = $('#toast');
    els.btnVideo = $('#btnVideo');

    var cam = $('#fileCamera'), alb = $('#fileAlbum');
    if (cam) cam.addEventListener('change', function (e) { loadFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    if (alb) alb.addEventListener('change', function (e) { loadFile(e.target.files && e.target.files[0]); e.target.value = ''; });

    var demo = $('#btnDemo');
    if (demo) demo.addEventListener('click', function () {
      busy(true, '準備示範…');
      setTimeout(function () {
        try { fromImageData(makeDemo()); }
        catch (e) { busy(false); toast('示範圖產生失敗'); }
      }, 20);
    });

    var chips = $('#animChips');
    if (chips) chips.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.chip') : null;
      if (!b) return;
      Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (c) { c.classList.remove('active'); });
      b.classList.add('active');
      state.anim = b.getAttribute('data-anim') || 'breathe';
    });

    var amp = $('#amp');
    if (amp) amp.addEventListener('input', function () { state.amp = parseFloat(amp.value) || 0; });
    var spd = $('#speed');
    if (spd) spd.addEventListener('input', function () { state.speed = parseFloat(spd.value) || 1; });

    var tgScene = $('#tgScene');
    if (tgScene) tgScene.addEventListener('change', function () { state.scene = tgScene.checked; });

    var tgBg = $('#tgBg');
    if (tgBg) tgBg.addEventListener('change', function () {
      state.opts.removeBg = tgBg.checked;
      if (state.raw) processNow();
    });
    var tgLight = $('#tgLight');
    if (tgLight) tgLight.addEventListener('change', function () {
      state.opts.illum = tgLight.checked;
      if (state.raw) processNow();
    });

    var v = $('#btnVideo');
    if (v) v.addEventListener('click', function () { exportVideo(5); });
    var p = $('#btnPng');
    if (p) p.addEventListener('click', exportPng);
    var f = $('#btnFull');
    if (f) f.addEventListener('click', function () {
      var wrap = $('#stageWrap');
      if (!wrap) return;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (wrap.requestFullscreen) wrap.requestFullscreen().then(function () { setTimeout(resize, 60); }).catch(function () { toast('全螢幕被瀏覽器擋住了'); });
      else toast('這個瀏覽器不支援全螢幕');
    });
    if (document.addEventListener) {
      document.addEventListener('fullscreenchange', function () { setTimeout(resize, 60); });
    }
    var ag = $('#btnAgain');
    if (ag) ag.addEventListener('click', showPick);

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 150); });
  }

  function init() {
    if (!Core) { console.error('core.js 沒載入'); return; }
    if (!document.body) { document.addEventListener('DOMContentLoaded', init); return; }
    bind();
    resize();
    startLoop();
  }

  init();

  // 給自動化測試 / 除錯用
  if (typeof window !== 'undefined') {
    window.__app = {
      state: state,
      fromImageData: fromImageData,
      makeDemo: makeDemo,
      motion: motion,
      drawFrame: drawFrame,
      exportPng: exportPng,
      exportVideo: exportVideo,
      setAnim: function (a) { state.anim = a; },
      get sprite() { return state.sprite; }
    };
  }
})();
