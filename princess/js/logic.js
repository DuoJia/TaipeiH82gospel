/* logic.js — 純邏輯（Node 可測）：出題、計分、解鎖、時間限制 */
(function (root) {
  const D = root.PData || (typeof require !== 'undefined' ? require('./data.js') : null);

  const ROUNDS = 6;

  function weekByNo(n) { return D.WEEKS.find((w) => w.w === n); }

  function weekPool(week) {
    if (week.words && week.words.length) return week.words.slice();
    const out = [];
    (week.review || []).forEach((n) => {
      const w = weekByNo(n);
      if (w && w.words) w.words.forEach((x) => out.push(x));
    });
    return out;
  }

  function dedupe(list, keyFn) {
    const seen = new Set(); const out = [];
    list.forEach((x) => { const k = keyFn(x); if (!seen.has(k)) { seen.add(k); out.push(x); } });
    return out;
  }

  function shuffle(list, rnd) {
    const r = rnd || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function keyOf(x) {
    if (x.kind === 'combo') return x.colorName + '-' + x.shapeName;
    return x.en;
  }

  // 產生一回合：{target, choices, prompt}
  function makeRound(week, idx, rnd) {
    const pool = weekPool(week);
    let choices = []; let target = null; let prompt = '';

    if (week.game === 'combo') {
      const colors = dedupe(pool.filter((w) => w.kind === 'color'), (w) => w.en);
      const shapes = dedupe(pool.filter((w) => w.kind === 'shape'), (w) => w.en);
      const combos = [];
      colors.forEach((c) => shapes.forEach((s) => combos.push({
        kind: 'combo', color: c.color, colorName: c.en, shape: s.shape, shapeName: s.en,
        en: c.en + ' ' + s.en, zh: c.zh + s.zh
      })));
      choices = shuffle(dedupe(combos, keyOf), rnd).slice(0, 3);
      target = choices[Math.floor((rnd || Math.random)() * choices.length)];
      // 保證三個選項顏色或形狀不全部相同（否則無法辨識）
      prompt = 'I see a ' + target.colorName + ' ' + target.shapeName + '!';
      return { target, choices, prompt };
    }

    if (week.game === 'count') {
      const nums = pool.filter((w) => w.kind === 'number');
      target = nums[Math.floor((rnd || Math.random)() * nums.length)];
      const others = shuffle(nums.filter((n) => n.num !== target.num), rnd).slice(0, 2);
      choices = shuffle([target].concat(others), rnd);
      prompt = 'Count with me!';
      return { target, choices, prompt };
    }

    // 一般：聽句子找圖
    target = pool[Math.floor((rnd || Math.random)() * pool.length)];
    const others = shuffle(pool.filter((p) => keyOf(p) !== keyOf(target)), rnd);
    choices = shuffle([target].concat(others.slice(0, 2)), rnd);
    prompt = promptFor(week, target);
    return { target, choices, prompt };
  }

  function promptFor(week, t) {
    switch (week.game) {
      case 'gem': return 'Find the ' + t.en + ' gem!';
      case 'dress': return 'Touch the ' + t.en + ' dress!';
      case 'shape': return 'Where is the ' + t.en + '?';
      case 'listen': return 'Listen! Is it a ' + t.en + '?';
      case 'action': return 'Princess, ' + t.en + '!';
      case 'find': return 'Find the ' + t.en + '!';
      case 'final': return 'Find the ' + t.en + '!';
      default: return 'Find the ' + t.en + '!';
    }
  }

  function makeRounds(week, n, rnd) {
    const out = [];
    for (let i = 0; i < (n || ROUNDS); i++) out.push(makeRound(week, i, rnd));
    return out;
  }

  // 星星：以「第一答就對」的回合數計分
  function starsFor(firstTryCorrect, rounds) {
    const r = rounds || ROUNDS;
    if (firstTryCorrect >= r) return 3;
    if (firstTryCorrect >= Math.ceil(r * 0.6)) return 2;
    if (firstTryCorrect >= 1) return 1;
    return 1; // 完成就有 1 顆，不給 0（低挫折）
  }

  function stonesFor(stars, firstPerfect) {
    let s = 5 + (stars >= 3 ? 3 : 0);
    if (firstPerfect) s += 2;
    return s;
  }

  // 解鎖：第 1 週永久開放；之後需前一週至少 1 顆星；家長可全開
  function unlockedWeeks(state) {
    if (state.settings && state.settings.unlockAll) return D.WEEKS.map((w) => w.w);
    const open = [1];
    D.WEEKS.forEach((w, i) => {
      if (i === 0) return;
      const prev = state.progress['w' + D.WEEKS[i - 1].w];
      if (prev && prev.stars >= 1) open.push(w.w);
    });
    return open;
  }

  function todayKey(d) {
    const t = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

  // 每日時限（分鐘）；回傳 {used, limit, over, left}
  function timeStatus(state, nowMinOverride) {
    const key = todayKey();
    const used = nowMinOverride != null ? nowMinOverride
      : ((state.minutes && state.minutes[key]) || 0) + (state.sessionSeconds || 0) / 60;
    const limit = state.settings.dailyLimitMin || 0;
    const over = limit > 0 && used >= limit;
    return { used: Math.round(used * 10) / 10, limit, over, left: Math.max(0, Math.round((limit - used) * 10) / 10) };
  }

  function addMinutes(state, mins, key) {
    const k = key || todayKey();
    state.minutes = state.minutes || {};
    state.minutes[k] = Math.round(((state.minutes[k] || 0) + mins) * 100) / 100;
    const keys = Object.keys(state.minutes).sort();
    while (keys.length > 60) delete state.minutes[keys.shift()];
    return state.minutes[k];
  }

  // 學習統計：記錄一次作答
  function recordAnswer(state, word, correct, firstTry) {
    const k = word.en;
    state.words = state.words || {};
    const s = state.words[k] || (state.words[k] = { seen: 0, right: 0, wrong: 0, mastered: false });
    s.seen++;
    if (correct) s.right++; else s.wrong++;
    if (s.right >= 3 && s.wrong <= 1) s.mastered = true;
    state.stats = state.stats || { rounds: 0, correct: 0, wrong: 0 };
    state.stats.rounds++;
    if (correct) state.stats.correct++; else state.stats.wrong++;
    if (firstTry && correct) { state.letters = state.letters || {}; }
    return s;
  }

  function masteredCount(state) {
    const w = state.words || {};
    return Object.keys(w).filter((k) => w[k].mastered).length;
  }

  root.PLogic = {
    ROUNDS, weekByNo, weekPool, makeRound, makeRounds, promptFor, keyOf, shuffle, dedupe,
    starsFor, stonesFor, unlockedWeeks, todayKey, timeStatus, addMinutes, recordAnswer, masteredCount
  };
  if (typeof module !== 'undefined') module.exports = root.PLogic;
})(typeof window !== 'undefined' ? window : globalThis);
