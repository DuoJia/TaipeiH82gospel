/*!
 * core.js — 塗鴉動物復活機：影像前處理引擎（純邏輯，不碰 DOM）
 *
 * 做的事：
 *   1) 光線校正（gain-only，保住蠟筆原本的顏色，不會把紅色洗成白色）
 *   2) 找紙張範圍 → 自動裁切（手機拍遠、桌上有雜物也能救）
 *   3) 白底去背（從邊界 flood fill，碰到黑線就停 → 動物內部的白留著）
 *   4) 邊緣羽化
 *
 * 瀏覽器：window.AnimalCore；Node：module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnimalCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.1.0';

  function lumaOf(data, n) {
    var luma = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var p = i << 2;
      luma[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
    return luma;
  }

  function percentile(luma, p) {
    var hist = new Float64Array(256);
    for (var i = 0; i < luma.length; i++) {
      var v = luma[i];
      v = v < 0 ? 0 : v > 255 ? 255 : v | 0;
      hist[v]++;
    }
    var target = luma.length * p, acc = 0;
    for (var k = 0; k < 256; k++) {
      acc += hist[k];
      if (acc >= target) return k;
    }
    return 255;
  }

  /* 盒狀模糊（利用積分圖，O(n)） */
  function boxBlur(src, w, h, r) {
    var W = w + 1;
    var sat = new Float64Array(W * (h + 1));
    for (var y = 0; y < h; y++) {
      // sat 的 stride 是 W=w+1；原始資料的 stride 是 w —— 兩者不能混用
      var rowSum = 0, off = (y + 1) * W, prev = y * W, srcOff = y * w;
      for (var x = 0; x < w; x++) {
        rowSum += src[srcOff + x];
        sat[off + x + 1] = sat[prev + x + 1] + rowSum;
      }
    }
    var out = new Float32Array(w * h);
    for (var yy = 0; yy < h; yy++) {
      var y0 = yy - r < 0 ? 0 : yy - r;
      var y1 = yy + r > h - 1 ? h - 1 : yy + r;
      for (var xx = 0; xx < w; xx++) {
        var x0 = xx - r < 0 ? 0 : xx - r;
        var x1 = xx + r > w - 1 ? w - 1 : xx + r;
        var area = (x1 - x0 + 1) * (y1 - y0 + 1);
        var s = sat[(y1 + 1) * W + (x1 + 1)] - sat[y0 * W + (x1 + 1)] -
                sat[(y1 + 1) * W + x0] + sat[y0 * W + x0];
        out[yy * w + xx] = s / area;
      }
    }
    return out;
  }

  /* 由像素產生「像紙張」的遮罩：夠亮 + 夠不飽和 */
  function paperMask(data, w, h, ref, luma, thrRatio, satMax, paperColor, colorTol) {
    var n = w * h, m = new Uint8Array(n), thr = ref * (thrRatio === undefined ? 0.66 : thrRatio);
    var satLimit = satMax === undefined ? 0.34 : satMax;
    var useColor = !!paperColor;
    var tol = (colorTol === undefined ? 0.11 : colorTol) * 255;
    var pc0 = paperColor ? paperColor[0] : 0, pc1 = paperColor ? paperColor[1] : 0, pc2 = paperColor ? paperColor[2] : 0;
    var pcm = paperColor ? Math.max(pc0, pc1, pc2) : 0;
    var pcn = paperColor ? Math.min(pc0, pc1, pc2) : 0;
    var paperSat = paperColor ? (pcm === 0 ? 0 : (pcm - pcn) / pcm) : 0;
    var satDelta = colorTol === undefined ? 0.06 : 0.06;
    for (var i = 0; i < n; i++) {
      var p = i << 2;
      var r = data[p], g = data[p + 1], b = data[p + 2];
      if (luma[i] <= thr) { m[i] = 0; continue; }
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      var sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (useColor) {
        // 兩個條件同時成立才算「紙」：
        //   ① 顏色接近這張紙的顏色（容忍陰影造成的明度差）
        //   ② 彩度不高於紙張本身太多 → 粉彩/淡黃不會被吃掉
        var dr = r - pc0, dg = g - pc1, db = b - pc2;
        var near = Math.sqrt(dr * dr + dg * dg + db * db) < tol;
        m[i] = (near && (sat - paperSat) < satDelta) ? 1 : 0;
      } else {
        m[i] = sat < satLimit ? 1 : 0;
      }
    }
    return m;
  }

  /* 學「這張紙是什麼顏色」：
   * ① 先看畫面裡最亮的一大片區域（實拍照裡紙幾乎一定是最亮的）
   * ② 不夠的話退回看邊界像素
   * 這樣暖光、米色紙、黃光下的紙都自適應；拍到木桌也不會被桌色帶歪 */
  function estimatePaperColor(data, w, h, luma, ref) {
    var n = w * h, i, p;
    var sr = 0, sg = 0, sb = 0, cnt = 0;
    var thr = ref * 0.85;
    for (i = 0; i < n; i++) {
      if (luma[i] < thr) continue;
      p = i << 2;
      var r = data[p], g = data[p + 1], b = data[p + 2];
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      var sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (sat > 0.40) continue;              // 太鮮豔的是畫，不是紙
      sr += r; sg += g; sb += b; cnt++;
    }
    if (cnt >= Math.max(24, n * 0.004)) return [sr / cnt, sg / cnt, sb / cnt];

    // ② 邊界取樣（紙佔滿畫面、沒有大片亮區時）
    sr = sg = sb = cnt = 0;
    var band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
    function take(x, y) {
      var idx = y * w + x;
      if (luma[idx] < ref * 0.60) return;
      var q = idx << 2;
      sr += data[q]; sg += data[q + 1]; sb += data[q + 2]; cnt++;
    }
    for (var x2 = 0; x2 < w; x2++) {
      for (var d = 0; d < band; d++) { take(x2, d); take(x2, h - 1 - d); }
    }
    for (var y2 = 0; y2 < h; y2++) {
      for (var d2 = 0; d2 < band; d2++) { take(d2, y2); take(w - 1 - d2, y2); }
    }
    if (cnt < 20) return null;
    return [sr / cnt, sg / cnt, sb / cnt];
  }


  /* 局部紙張亮度場：陰影、暗角、黃光都會讓紙的亮度從 250 掉到 100，
   * 只用一個全域門檻必然漏掉暗側。
   * 做法：把畫面切成一格格小塊，每格只統計「色調跟紙一樣、彩度也跟紙一樣」
   * 的像素（= 紙本身，含被陰影壓暗的紙），取亮度第 85 百分位當「這裡的紙有多亮」。
   * 沒樣本的格子（整格都是畫）再由鄰格擴散補值 → 得到平滑的紙張亮度場。 */
  function paperLumaField(data, w, h, luma, paperColor, fallback) {
    var T = Math.max(16, Math.round(Math.min(w, h) / 24));
    var gw = Math.ceil(w / T), gh = Math.ceil(h / T), G = gw * gh;
    var pc0 = paperColor[0], pc1 = paperColor[1], pc2 = paperColor[2];
    var sumP = pc0 + pc1 + pc2; if (sumP < 1) sumP = 1;
    var n0 = pc0 / sumP, n1 = pc1 / sumP, n2 = pc2 / sumP;
    var pcm = pc0 > pc1 ? (pc0 > pc2 ? pc0 : pc2) : (pc1 > pc2 ? pc1 : pc2);
    var pcn = pc0 < pc1 ? (pc0 < pc2 ? pc0 : pc2) : (pc1 < pc2 ? pc1 : pc2);
    var paperSat = pcm === 0 ? 0 : (pcm - pcn) / pcm;
    var hist = new Int32Array(G * 256);
    var cnt = new Int32Array(G), tot = new Int32Array(G);
    var x, y, i, p, gx, gy, gi;
    for (y = 0; y < h; y++) {
      gy = (y / T) | 0;
      for (x = 0; x < w; x++) {
        i = y * w + x;
        gx = (x / T) | 0;
        gi = gy * gw + gx;
        tot[gi]++;
        p = i << 2;
        var r = data[p], g = data[p + 1], b = data[p + 2];
        var sm = r + g + b;
        if (sm < 60) continue;
        var dch = Math.abs(r / sm - n0) + Math.abs(g / sm - n1) + Math.abs(b / sm - n2);
        if (dch > 0.07) continue;
        var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        var sat = mx === 0 ? 0 : (mx - mn) / mx;
        if (sat - paperSat > 0.08) continue;
        var lv = luma[i] | 0;
        if (lv < 0) lv = 0; if (lv > 255) lv = 255;
        hist[gi * 256 + lv]++;
        cnt[gi]++;
      }
    }
    var fld = new Float32Array(G);
    var valid = new Uint8Array(G);
    for (gi = 0; gi < G; gi++) {
      fld[gi] = fallback;
      if (cnt[gi] < Math.max(12, tot[gi] * 0.08)) continue;
      var target = Math.round(cnt[gi] * 0.85), acc = 0, hv = fallback;
      for (var k = 0; k < 256; k++) {
        acc += hist[gi * 256 + k];
        if (acc >= target) { hv = k; break; }
      }
      fld[gi] = Math.max(20, hv);
      valid[gi] = 1;
    }
    // 沒樣本的格子：由已確定的鄰格一層層擴散補值
    for (var round = 0; round < 12; round++) {
      var added = 0;
      for (gy = 0; gy < gh; gy++) {
        for (gx = 0; gx < gw; gx++) {
          gi = gy * gw + gx;
          if (valid[gi]) continue;
          var sum = 0, c2 = 0;
          for (var dy = -1; dy <= 1; dy++) {
            var yy2 = gy + dy; if (yy2 < 0 || yy2 >= gh) continue;
            for (var dx = -1; dx <= 1; dx++) {
              var xx2 = gx + dx; if (xx2 < 0 || xx2 >= gw) continue;
              var j = yy2 * gw + xx2;
              if (!valid[j]) continue;
              sum += fld[j]; c2++;
            }
          }
          if (c2 >= 2) { fld[gi] = sum / c2; valid[gi] = 2; added++; }
        }
      }
      for (gi = 0; gi < G; gi++) if (valid[gi] === 2) valid[gi] = 1;
      if (!added) break;
    }
    // 網格上輕微平滑（避免格子邊界出現亮暗階差）
    var sm2 = new Float32Array(G);
    for (gy = 0; gy < gh; gy++) {
      for (gx = 0; gx < gw; gx++) {
        var ss = 0, cc = 0;
        for (var dy2 = -1; dy2 <= 1; dy2++) {
          var y3 = gy + dy2; if (y3 < 0 || y3 >= gh) continue;
          for (var dx2 = -1; dx2 <= 1; dx2++) {
            var x3 = gx + dx2; if (x3 < 0 || x3 >= gw) continue;
            ss += fld[y3 * gw + x3]; cc++;
          }
        }
        sm2[gy * gw + gx] = ss / cc;
      }
    }
    // 雙線性放大回原尺寸（以格子中心為取樣點）
    var out = new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      var vy = (y + 0.5) / T - 0.5; if (vy < 0) vy = 0;
      var y0 = Math.min(gh - 1, vy | 0), y1 = Math.min(gh - 1, y0 + 1), ty = vy - y0;
      for (x = 0; x < w; x++) {
        var vx = (x + 0.5) / T - 0.5; if (vx < 0) vx = 0;
        var x0 = Math.min(gw - 1, vx | 0), x1 = Math.min(gw - 1, x0 + 1), tx = vx - x0;
        var a0 = sm2[y0 * gw + x0], a1 = sm2[y0 * gw + x1];
        var b0 = sm2[y1 * gw + x0], b1 = sm2[y1 * gw + x1];
        out[y * w + x] = (a0 * (1 - tx) + a1 * tx) * (1 - ty) + (b0 * (1 - tx) + b1 * tx) * ty;
      }
    }
    return out;
  }

  /* 「像紙」的判定（局部版）：
   *   ① 色調（chromaticity）要跟這張紙一致 → 陰影只改亮度，不改色調
   *   ② 亮度要是「這裡的紙」的 minRatio 倍以上 → 深陰影、暗角都救得回來
   *   ③ 彩度不能比紙高太多 → 淡黃/淡粉/蠟筆色都不會被吃掉
   * 三者都要成立才算紙，比舊版「絕對 RGB 距離」耐陰影得多。 */
  function paperMaskLocal(data, w, h, luma, paperColor, localLuma, o) {
    o = o || {};
    var satDelta = o.satDelta === undefined ? 0.06 : o.satDelta;
    var chromaTol = o.chromaTol === undefined ? 0.055 : o.chromaTol;
    var minRatio = o.minRatio === undefined ? 0.75 : o.minRatio;
    var maxRatio = o.maxRatio === undefined ? 1.25 : o.maxRatio;
    var n = w * h, m = new Uint8Array(n), i, p;
    var pc0 = paperColor[0], pc1 = paperColor[1], pc2 = paperColor[2];
    var sumP = pc0 + pc1 + pc2;
    if (sumP < 1) sumP = 1;
    var n0 = pc0 / sumP, n1 = pc1 / sumP, n2 = pc2 / sumP;
    var pcm = pc0 > pc1 ? (pc0 > pc2 ? pc0 : pc2) : (pc1 > pc2 ? pc1 : pc2);
    var pcn = pc0 < pc1 ? (pc0 < pc2 ? pc0 : pc2) : (pc1 < pc2 ? pc1 : pc2);
    var paperSat = pcm === 0 ? 0 : (pcm - pcn) / pcm;
    for (i = 0; i < n; i++) {
      p = i << 2;
      var r = data[p], g = data[p + 1], b = data[p + 2];
      var s = r + g + b;
      if (s < 30) continue;                       // 近黑（線條）一定不是紙
      var dch = Math.abs(r / s - n0) + Math.abs(g / s - n1) + Math.abs(b / s - n2);
      if (dch > chromaTol) continue;              // 色調不像紙（木桌、蠟筆）
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      var sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (sat - paperSat > satDelta) continue;    // 比紙鮮豔太多 → 是畫
      var base = localLuma ? localLuma[i] : (o.paperLuma || 255);
      if (base < 1) base = 1;
      var ratio = luma[i] / base;
      if (ratio < minRatio || ratio > maxRatio) continue;
      m[i] = 1;
    }
    return m;
  }

  /* 紙張區塊的聯集外框：把「夠大的白色連通區」全部框起來
   * （只用最大區塊會在「畫到紙邊、把紙切成兩半」時歪掉） */
  function paperUnionBox(mask, w, h, minAreaRatio) {
    var n = w * h, seen = new Uint8Array(n), stack = new Int32Array(n);
    var minArea = Math.max(24, Math.floor(n * (minAreaRatio === undefined ? 0.01 : minAreaRatio)));
    var ux0 = w, uy0 = h, ux1 = -1, uy1 = -1, uArea = 0, count = 0;
    for (var s = 0; s < n; s++) {
      if (!mask[s] || seen[s]) continue;
      var sp = 0;
      stack[sp++] = s; seen[s] = 1;
      var area = 0, minX = w, maxX = -1, minY = h, maxY = -1;
      while (sp > 0) {
        var i = stack[--sp];
        area++;
        var x = i % w, y = (i - x) / w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
        if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[sp++] = i - w; }
        if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[sp++] = i + w; }
      }
      if (area < minArea) continue;
      count++; uArea += area;
      if (minX < ux0) ux0 = minX;
      if (minY < uy0) uy0 = minY;
      if (maxX > ux1) ux1 = maxX;
      if (maxY > uy1) uy1 = maxY;
    }
    if (ux1 < 0) return null;
    return { x: ux0, y: uy0, w: ux1 - ux0 + 1, h: uy1 - uy0 + 1, area: uArea, count: count };
  }

  /* ---------- 幾何：凸包 + 多邊形填充 ---------- */
  function convexHull(pts) {
    if (pts.length < 3) return pts.slice();
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var cross = function (o, a, b) {
      return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    };
    var lower = [], i;
    for (i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    var upper = [];
    for (i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
      upper.push(pts[i]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function fillPolyMask(poly, w, h) {
    var m = new Uint8Array(w * h);
    if (!poly || poly.length < 3) return m;
    var i, j;
    for (var y = 0; y < h; y++) {
      var xs = [];
      var yc = y + 0.5;
      for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var y1 = poly[j][1], y2 = poly[i][1];
        if ((y1 > yc) !== (y2 > yc)) {
          var x1 = poly[j][0], x2 = poly[i][0];
          xs.push(x1 + (yc - y1) / (y2 - y1) * (x2 - x1));
        }
      }
      if (!xs.length) continue;
      xs.sort(function (a, b) { return a - b; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        var a0 = Math.max(0, Math.ceil(xs[k] - 0.5));
        var b0 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (var x = a0; x <= b0; x++) m[y * w + x] = 1;
      }
    }
    return m;
  }

  /* 紙張的凸包遮罩：歪斜的紙、桌角、手指都會落在包外 → 一律透明 */
  function sheetPolyMask(mask, w, h, step) {
    var stepN = step || 3, pts = [];
    for (var y = 0; y < h; y += stepN) {
      for (var x = 0; x < w; x += stepN) {
        if (mask[y * w + x]) pts.push([x, y]);
      }
    }
    if (pts.length < 12) return null;
    var hull = convexHull(pts);
    if (hull.length < 3) return null;
    var pm = fillPolyMask(hull, w, h);
    var area = 0;
    for (var i = 0; i < pm.length; i++) area += pm[i];
    return { mask: pm, area: area, hull: hull };
  }

  function extract(data, w, h, box) {
    var ww = box.w, hh = box.h;
    var out = new Uint8ClampedArray(ww * hh * 4);
    for (var y = 0; y < hh; y++) {
      var src = ((y + box.y) * w + box.x) << 2;
      out.set(data.subarray(src, src + (ww << 2)), (y * ww) << 2);
    }
    return out;
  }

  function clampBox(box, w, h, pad) {
    var x = Math.max(0, box.x - pad);
    var y = Math.max(0, box.y - pad);
    var x2 = Math.min(w, box.x + box.w + pad);
    var y2 = Math.min(h, box.y + box.h + pad);
    return { x: x, y: y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
  }

  /* ---------- 主流程 ---------- */
  function process(data, w, h, opts) {
    opts = opts || {};
    var o = {
      illum: opts.illum !== false,
      removeBg: opts.removeBg !== false,
      autoCrop: opts.autoCrop !== false,
      feather: opts.feather !== false
    };

    var crop = null;
    // 1) 自動裁切到紙張
    if (o.autoCrop) {
      var l0 = lumaOf(data, w * h);
      var ref0 = percentile(l0, 0.95);
      var pm0 = paperMask(data, w, h, ref0, l0);
      var box = paperUnionBox(pm0, w, h, 0.01);
      if (box && box.area > 0.10 * w * h && box.w * box.h < 0.995 * w * h) {
        var padded = clampBox(box, w, h, Math.round(Math.max(box.w, box.h) * 0.012));
        crop = padded;
        data = extract(data, w, h, padded);
        w = padded.w; h = padded.h;
      }
    }

    var n = w * h;
    var luma = lumaOf(data, n);
    var ref = Math.max(40, percentile(luma, 0.95));

    var out = new Uint8ClampedArray(n * 4);
    out.set(data);

    // 2) 光線校正：只調增益（保色相），暗部（黑線）幾乎不動
    if (o.illum) {
      var r = Math.max(12, Math.round(Math.max(w, h) / 18));
      var blur = boxBlur(luma, w, h, r);
      for (var i = 0; i < n; i++) {
        var g = ref / Math.max(blur[i], 8);
        if (g > 1.9) g = 1.9;
        if (g < 0.85) g = 0.85;
        var p = i << 2;
        // 兩道保護：
        //  ① 暗（黑線）區域少動 → 不會把黑線洗成灰色
        //  ② 有彩度的區域少動 → 蠟筆顏色必須跟小朋友畫的一樣
        var wd = luma[i] / ref;
        if (wd > 1) wd = 1;
        wd = Math.pow(wd, 1.4);
        var mx = data[p] > data[p + 1] ? (data[p] > data[p + 2] ? data[p] : data[p + 2])
                                       : (data[p + 1] > data[p + 2] ? data[p + 1] : data[p + 2]);
        var mn = data[p] < data[p + 1] ? (data[p] < data[p + 2] ? data[p] : data[p + 2])
                                       : (data[p + 1] < data[p + 2] ? data[p + 1] : data[p + 2]);
        var sat = mx === 0 ? 0 : (mx - mn) / mx;
        var satW = 1 - (sat - 0.10) / 0.36;
        if (satW > 1) satW = 1;
        if (satW < 0.35) satW = 0.35;
        wd *= satW;
        var eff = 1 + (g - 1) * wd;
        out[p] = data[p] * eff;
        out[p + 1] = data[p + 1] * eff;
        out[p + 2] = data[p + 2] * eff;
      }
    }

    // 3) 白底去背
    //    3a) 先找紙張外框，框外（桌面、手指、雜物）一律透明
    //    3b) 框內從紙張邊界 flood fill「像紙張」的像素，遇彩色/黑線就停
    var alpha = new Uint8Array(n);
    alpha.fill(255);
    var removed = 0;
    var sheet = null;
    var paperColorUsed = null;
    var sheetPoly = null;
    if (o.removeBg) {
      var luma2 = lumaOf(out, n);
      var ref2 = Math.max(40, percentile(luma2, 0.95));
      // 從邊界學紙色（暖光、米色紙都自適應）
      var paperColor = estimatePaperColor(out, w, h, luma2, ref2);
      // 寬鬆遮罩：找出「紙」的範圍（淡彩也算紙的一部分，框才不會缺角）
      var paperLoose = paperMask(out, w, h, ref2, luma2, 0.68, 0.34);
      sheet = paperUnionBox(paperLoose, w, h, 0.01);
      paperColorUsed = paperColor;

      // 3a) 紙張凸包 → 包外（桌面、手指、桌角）全部透明
      var poly = sheetPolyMask(paperLoose, w, h, 3);
      if (poly && poly.area > 0.30 * n) {
        for (var ip = 0; ip < n; ip++) {
          if (!poly.mask[ip]) { alpha[ip] = 0; removed++; }
        }
        sheetPoly = poly;
      } else {
        poly = null;
        // 沒有可信的紙張範圍 → 退回用紙張外框（較寬鬆）
        if (sheet && sheet.area > 0.10 * n) {
          var bx0 = sheet.x, by0 = sheet.y, bx1 = sheet.x + sheet.w - 1, by1 = sheet.y + sheet.h - 1;
          for (var iyq = 0; iyq < h; iyq++) {
            for (var ixq = 0; ixq < w; ixq++) {
              if (ixq < bx0 || ixq > bx1 || iyq < by0 || iyq > by1) {
                var iq = iyq * w + ixq;
                if (alpha[iq] !== 0) { alpha[iq] = 0; removed++; }
              }
            }
          }
        }
      }

      // 3b) 包內：跟「紙色」接近且夠亮的 → 透明
      //     → 粉彩、淡黃、淡粉都留得住，不會被當成白紙吃掉
      var paper;
      if (paperColor) {
        // 局部紙張亮度場 → 用「比例」而不是絕對亮度判斷，深陰影/暗角都救得回來
        var field = paperLumaField(out, w, h, luma2, paperColor, ref2);
        paper = paperMaskLocal(out, w, h, luma2, paperColor, field, {
          minRatio: 0.72, chromaTol: 0.06, satDelta: 0.06
        });
      } else {
        paper = paperMask(out, w, h, ref2, luma2, 0.78, 0.10);
      }
      if (poly) {
        for (var iz = 0; iz < n; iz++) if (!poly.mask[iz]) paper[iz] = 0;
      }
      var sx0 = 0, sy0 = 0, sx1 = w - 1, sy1 = h - 1;
      if (sheet && sheet.area > 0.10 * n) {
        sx0 = sheet.x; sy0 = sheet.y; sx1 = sheet.x + sheet.w - 1; sy1 = sheet.y + sheet.h - 1;
        var markOut = function (ix, iy) {
          if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
          var ii = iy * w + ix;
          if (alpha[ii] !== 0) { alpha[ii] = 0; removed++; }
        };
        for (var iy2 = 0; iy2 < h; iy2++) {
          if (iy2 < sy0 || iy2 > sy1) { for (var ixA = 0; ixA < w; ixA++) markOut(ixA, iy2); }
          else {
            for (var ixB = 0; ixB < sx0; ixB++) markOut(ixB, iy2);
            for (var ixC = sx1 + 1; ixC < w; ixC++) markOut(ixC, iy2);
          }
        }
      } else { sheet = null; }

      var seen = new Uint8Array(n);
      var stack = new Int32Array(n);
      var sp = 0;
      var push = function (i) {
        if (paper[i] && !seen[i]) { seen[i] = 1; stack[sp++] = i; }
      };
      // 種子 = 影像四邊 + 紙張外框邊界 + 「緊鄰已清空區域」的紙邊緣
      // （只靠外框邊界會漏：紙張邊緣那 1~2 像素常偏暗，導致 flood 從未啟動）
      for (var sx = 0; sx < w; sx++) { push(sx); push((h - 1) * w + sx); }
      for (var sy = 0; sy < h; sy++) { push(sy * w); push(sy * w + w - 1); }
      for (var sx2 = sx0; sx2 <= sx1; sx2++) { push(sy0 * w + sx2); push(sy1 * w + sx2); }
      for (var sy2 = sy0; sy2 <= sy1; sy2++) { push(sy2 * w + sx0); push(sy2 * w + sx1); }
      for (var se = 0; se < n; se++) {
        if (!paper[se]) continue;
        var sex = se % w, sey = (se - sex) / w;
        if ((sex > 0 && alpha[se - 1] === 0) || (sex < w - 1 && alpha[se + 1] === 0) ||
            (sey > 0 && alpha[se - w] === 0) || (sey < h - 1 && alpha[se + w] === 0)) {
          if (!seen[se]) { seen[se] = 1; stack[sp++] = se; }
        }
      }
      while (sp > 0) {
        var idx = stack[--sp];
        if (alpha[idx] !== 0) removed++;
        alpha[idx] = 0;
        var ix = idx % w, iy = (idx - ix) / w;
        if (ix > 0) push(idx - 1);
        if (ix < w - 1) push(idx + 1);
        if (iy > 0) push(idx - w);
        if (iy < h - 1) push(idx + w);
      }
    }

    // 4) 邊緣羽化（靠內的那一圈才會有差）
    var finalAlpha = alpha;
    if (o.feather) {
      var tmp = new Float32Array(n);
      var btn = boxBlur(alpha, w, h, 1);   // 已含 3x3 平均
      for (var k = 0; k < n; k++) tmp[k] = btn[k];
      finalAlpha = new Uint8Array(n);
      for (var j = 0; j < n; j++) {
        // 只柔化邊界：內部本來就是 255
        var a = tmp[j];
        finalAlpha[j] = a >= 250 ? 255 : (a <= 6 ? 0 : (a | 0));
      }
    }

    // 5) 輸出 RGBA + 內容 bbox
    var minX = w, maxX = -1, minY = h, maxY = -1;
    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        var ii = yy * w + xx;
        var pp = ii << 2;
        var a2 = finalAlpha[ii];
        out[pp + 3] = a2;
        if (a2 > 24) {
          if (xx < minX) minX = xx;
          if (xx > maxX) maxX = xx;
          if (yy < minY) minY = yy;
          if (yy > maxY) maxY = yy;
        }
      }
    }
    if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }

    return {
      version: VERSION,
      data: out,
      width: w,
      height: h,
      crop: crop,
      sheet: sheet,
      paperColor: paperColorUsed,
      sheetPoly: !!sheetPoly,
      ref: ref,
      removedRatio: removed / n,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    };
  }

  return {
    VERSION: VERSION,
    process: process,
    boxBlur: boxBlur,
    percentile: percentile,
    lumaOf: lumaOf,
    paperMask: paperMask,
    paperMaskLocal: paperMaskLocal,
    paperLumaField: paperLumaField,
    estimatePaperColor: estimatePaperColor,
    convexHull: convexHull,
    sheetPolyMask: sheetPolyMask,
    paperUnionBox: paperUnionBox,
    largestBox: paperUnionBox
  };
});
