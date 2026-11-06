/* store.js — 存檔（localStorage）＋ 匯出匯入 */
(function (root) {
  const KEY = 'princessMagicV1';
  const VERSION = 1;

  function defaults() {
    return {
      v: VERSION,
      createdAt: Date.now(),
      companion: null,          // 'flower' | 'ice' | 'star' | 'sun'
      stones: 0,
      cards: {},                // cardId -> {at, count}
      owned: [],                // 商店 id
      wearing: { crown: false, wings: false, wand: false, dress2: false },
      decor: [],
      progress: {},             // 'w1' -> {stars, plays, best, lastAt}
      words: {},                // en -> {seen,right,wrong,mastered}
      stats: { rounds: 0, correct: 0, wrong: 0 },
      letters: {},
      minutes: {},              // 'YYYY-MM-DD' -> 分鐘
      sessionSeconds: 0,
      settings: { dailyLimitMin: 15, pin: '1234', unlockAll: false, sound: true, speechRate: 0.85 },
      lastPlay: null
    };
  }

  function migrate(s) {
    const d = defaults();
    const out = Object.assign(d, s || {});
    out.settings = Object.assign(d.settings, (s && s.settings) || {});
    out.wearing = Object.assign(d.wearing, (s && s.wearing) || {});
    out.v = VERSION;
    return out;
  }

  function memStorage() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k)
    };
  }

  function storage() {
    try {
      if (typeof localStorage !== 'undefined') {
        const t = '__pt__';
        localStorage.setItem(t, '1'); localStorage.removeItem(t);
        return localStorage;
      }
    } catch (e) { /* 無痕模式等 */ }
    if (!root.__memStore) root.__memStore = memStorage();
    return root.__memStore;
  }

  function load(st) {
    const s = st || storage();
    try {
      const raw = s.getItem(KEY);
      if (!raw) return defaults();
      return migrate(JSON.parse(raw));
    } catch (e) {
      return defaults();
    }
  }

  function save(state, st) {
    const s = st || storage();
    try { s.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  function exportJSON(state) { return JSON.stringify(state, null, 2); }

  function importJSON(text) {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object') throw new Error('bad json');
    return migrate(obj);
  }

  function reset(st) {
    const s = st || storage();
    s.removeItem(KEY);
    return defaults();
  }

  function hasCard(state, id) { return !!(state.cards && state.cards[id]); }

  function grantCard(state, card) {
    state.cards = state.cards || {};
    const first = !state.cards[card.id];
    if (first) state.cards[card.id] = { at: Date.now(), count: 1 };
    else state.cards[card.id].lastAt = Date.now();
    return first;
  }

  function completeLesson(state, week, stars, stones) {
    const k = 'w' + week.w;
    state.progress = state.progress || {};
    const p = state.progress[k] || (state.progress[k] = { stars: 0, plays: 0, best: 0 });
    p.plays++;
    p.stars = Math.max(p.stars || 0, stars);
    p.best = Math.max(p.best || 0, stars);
    p.lastAt = Date.now();
    const first = grantCard(state, week.card);
    state.stones = (state.stones || 0) + (stones || 0);
    state.lastPlay = Date.now();
    return { firstCard: first, progress: p };
  }

  function buy(state, item) {
    if (!item) return { ok: false, reason: 'no-item' };
    if ((state.owned || []).indexOf(item.id) >= 0) return { ok: false, reason: 'owned' };
    if ((state.stones || 0) < item.price) return { ok: false, reason: 'poor' };
    state.stones -= item.price;
    state.owned = (state.owned || []).concat([item.id]);
    if (item.type === 'wear') state.wearing[item.id] = true;
    else state.decor = (state.decor || []).concat([item.id]);
    return { ok: true };
  }

  root.PStore = {
    KEY, VERSION, defaults, migrate, load, save, exportJSON, importJSON, reset,
    hasCard, grantCard, completeLesson, buy, storage, memStorage
  };
  if (typeof module !== 'undefined') module.exports = root.PStore;
})(typeof window !== 'undefined' ? window : globalThis);
