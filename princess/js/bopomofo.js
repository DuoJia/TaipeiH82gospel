/* bopomofo.js — 注音魔法屋 ㄅㄆㄇ（37 個注音符號 + 聽音找符 + 拼音拼讀）
   設計對象：3–6 歲（注音啟蒙）。語音用 Web Speech 的 zh-TW。
   純邏輯（資料、出題、判定）放在檔頭，Node 可直接 require 測試；
   只有在瀏覽器（有 document）時才會掛上 UI。 */
(function (root) {
  /* ─────────────── 資料 ─────────────── */
  // 21 聲符
  const INITIALS = [
    { s: 'ㄅ', word: '爸爸', py: 'bà ba', emoji: '👨' },
    { s: 'ㄆ', word: '皮球', py: 'pí qiú', emoji: '🏀' },
    { s: 'ㄇ', word: '媽媽', py: 'mā ma', emoji: '👩' },
    { s: 'ㄈ', word: '飛機', py: 'fēi jī', emoji: '✈️' },
    { s: 'ㄉ', word: '大象', py: 'dà xiàng', emoji: '🐘' },
    { s: 'ㄊ', word: '兔子', py: 'tù zi', emoji: '🐰' },
    { s: 'ㄋ', word: '牛奶', py: 'niú nǎi', emoji: '🥛' },
    { s: 'ㄌ', word: '老虎', py: 'lǎo hǔ', emoji: '🐯' },
    { s: 'ㄍ', word: '哥哥', py: 'gē ge', emoji: '🧒' },
    { s: 'ㄎ', word: '恐龍', py: 'kǒng lóng', emoji: '🦕' },
    { s: 'ㄏ', word: '花', py: 'huā', emoji: '🌸' },
    { s: 'ㄐ', word: '姐姐', py: 'jiě jie', emoji: '👧' },
    { s: 'ㄑ', word: '鉛筆', py: 'qiān bǐ', emoji: '✏️' },
    { s: 'ㄒ', word: '西瓜', py: 'xī guā', emoji: '🍉' },
    { s: 'ㄓ', word: '蜘蛛', py: 'zhī zhū', emoji: '🕷️' },
    { s: 'ㄔ', word: '車子', py: 'chē zi', emoji: '🚗' },
    { s: 'ㄕ', word: '獅子', py: 'shī zi', emoji: '🦁' },
    { s: 'ㄖ', word: '生日', py: 'shēng rì', emoji: '🎂' },
    { s: 'ㄗ', word: '足球', py: 'zú qiú', emoji: '⚽' },
    { s: 'ㄘ', word: '廁所', py: 'cè suǒ', emoji: '🚻' },
    { s: 'ㄙ', word: '三', py: 'sān', emoji: '3️⃣' }
  ];
  // 3 介符
  const MEDIALS = [
    { s: 'ㄧ', word: '衣服', py: 'yī fu', emoji: '👕' },
    { s: 'ㄨ', word: '烏龜', py: 'wū guī', emoji: '🐢' },
    { s: 'ㄩ', word: '魚', py: 'yú', emoji: '🐟' }
  ];
  // 13 韻符
  const FINALS = [
    { s: 'ㄚ', word: '沙', py: 'shā', emoji: '🏖️' },
    { s: 'ㄛ', word: '蘿蔔', py: 'luó bo', emoji: '🥕' },
    { s: 'ㄜ', word: '鵝', py: 'é', emoji: '🦢' },
    { s: 'ㄝ', word: '椰子', py: 'yē zi', emoji: '🥥' },
    { s: 'ㄞ', word: '白菜', py: 'bái cài', emoji: '🥬' },
    { s: 'ㄟ', word: '杯子', py: 'bēi zi', emoji: '☕' },
    { s: 'ㄠ', word: '小貓', py: 'xiǎo māo', emoji: '🐱' },
    { s: 'ㄡ', word: '猴子', py: 'hóu zi', emoji: '🐵' },
    { s: 'ㄢ', word: '山', py: 'shān', emoji: '⛰️' },
    { s: 'ㄣ', word: '門', py: 'mén', emoji: '🚪' },
    { s: 'ㄤ', word: '糖', py: 'táng', emoji: '🍬' },
    { s: 'ㄥ', word: '風', py: 'fēng', emoji: '🌬️' },
    { s: 'ㄦ', word: '耳朵', py: 'ěr duo', emoji: '👂' }
  ];

  // 拼音練習：聲符 +（介符／韻符）→ 例詞
  const PAIRS = [
    { parts: ['ㄅ', 'ㄚ'], zh: '爸爸', py: 'bà ba', emoji: '👨' },
    { parts: ['ㄇ', 'ㄚ'], zh: '媽媽', py: 'mā ma', emoji: '👩' },
    { parts: ['ㄉ', 'ㄚ'], zh: '大象', py: 'dà xiàng', emoji: '🐘' },
    { parts: ['ㄊ', 'ㄨ'], zh: '兔子', py: 'tù zi', emoji: '🐰' },
    { parts: ['ㄋ', 'ㄞ'], zh: '奶奶', py: 'nǎi nai', emoji: '👵' },
    { parts: ['ㄌ', 'ㄠ'], zh: '老虎', py: 'lǎo hǔ', emoji: '🐯' },
    { parts: ['ㄍ', 'ㄜ'], zh: '哥哥', py: 'gē ge', emoji: '🧒' },
    { parts: ['ㄎ', 'ㄨ'], zh: '褲子', py: 'kù zi', emoji: '👖' },
    { parts: ['ㄏ', 'ㄨ'], zh: '蝴蝶', py: 'hú dié', emoji: '🦋' },
    { parts: ['ㄐ', 'ㄧ'], zh: '雞', py: 'jī', emoji: '🐔' },
    { parts: ['ㄑ', 'ㄧ'], zh: '七', py: 'qī', emoji: '7️⃣' },
    { parts: ['ㄒ', 'ㄧ'], zh: '西瓜', py: 'xī guā', emoji: '🍉' },
    { parts: ['ㄓ', 'ㄨ'], zh: '豬', py: 'zhū', emoji: '🐷' },
    { parts: ['ㄔ', 'ㄜ'], zh: '車子', py: 'chē zi', emoji: '🚗' },
    { parts: ['ㄕ', 'ㄨ'], zh: '書', py: 'shū', emoji: '📖' },
    { parts: ['ㄖ', 'ㄣ'], zh: '人', py: 'rén', emoji: '🧑' },
    { parts: ['ㄗ', 'ㄨ'], zh: '足球', py: 'zú qiú', emoji: '⚽' },
    { parts: ['ㄘ', 'ㄠ'], zh: '草', py: 'cǎo', emoji: '🌱' },
    { parts: ['ㄙ', 'ㄢ'], zh: '三', py: 'sān', emoji: '3️⃣' },
    { parts: ['ㄅ', 'ㄧ'], zh: '筆', py: 'bǐ', emoji: '✏️' },
    { parts: ['ㄇ', 'ㄧ'], zh: '米', py: 'mǐ', emoji: '🍚' },
    { parts: ['ㄈ', 'ㄤ'], zh: '房子', py: 'fáng zi', emoji: '🏠' }
  ];

  const GROUPS = [
    { key: 'initial', name: '聲符', note: '21 個 · 開頭的聲音', color: '#c2185b', list: INITIALS },
    { key: 'medial', name: '介符', note: '3 個 · ㄧ ㄨ ㄩ', color: '#1565c0', list: MEDIALS },
    { key: 'final', name: '韻符', note: '13 個 · 後面的聲音', color: '#8a6100', list: FINALS }
  ];
  const ALL = [];
  GROUPS.forEach((g) => g.list.forEach((x, i) => ALL.push(Object.assign({ kind: g.key, group: g.name, idx: i }, x))));
  const SYM = {};
  ALL.forEach((x) => { SYM[x.s] = x; });

  const SECOND_POOL = MEDIALS.concat(FINALS);

  /* ─────────────── 純邏輯 ─────────────── */
  function shuffle(list, rnd) {
    const r = rnd || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 從 pool 取 n 個（保證包含 target）
  function choicesWith(pool, target, n, rnd) {
    const rest = shuffle(pool.filter((x) => x.s !== target.s), rnd).slice(0, Math.max(0, (n || 3) - 1));
    return shuffle([target].concat(rest), rnd);
  }

  // 聽音找注音：kind = 'initial' | 'final'
  function listenRound(kind, rnd) {
    const pool = kind === 'final' ? FINALS : INITIALS;
    const target = pool[Math.floor((rnd || Math.random)() * pool.length)];
    return {
      kind, target,
      choices: choicesWith(pool, target, 3, rnd),
      prompt: '這是什麼的聲音？'
    };
  }

  // 拼音：給例詞，選聲符＋韻符
  function blendRound(rnd) {
    const r = rnd || Math.random;
    const target = PAIRS[Math.floor(r() * PAIRS.length)];
    const p1 = SYM[target.parts[0]];
    const p2 = SYM[target.parts[1]];
    return {
      kind: 'blend', target, p1, p2,
      initialChoices: choicesWith(INITIALS, p1, 3, r),
      finalChoices: choicesWith(SECOND_POOL, p2, 3, r),
      prompt: '這是什麼？拼拼看！'
    };
  }

  function checkListen(round, sym) { return !!sym && sym.s === round.target.s; }
  function checkBlend(round, first, second) {
    return !!first && !!second && first.s === round.p1.s && second.s === round.p2.s;
  }

  const B = {
    INITIALS, MEDIALS, FINALS, PAIRS, GROUPS, ALL, SYM,
    shuffle, choicesWith, listenRound, blendRound, checkListen, checkBlend,
    groupColor(kind) { const g = GROUPS.find((x) => x.key === kind); return g ? g.color : '#999'; }
  };
  root.PBopo = B;
  if (typeof module !== 'undefined' && module.exports) module.exports = B;

  /* ─────────────── UI（僅瀏覽器） ─────────────── */
  if (typeof document === 'undefined') return;

  const A = root.PAudio, V = root.PView;
  const ROUNDS = 6;

  const UI = {
    app: null, tab: 'chart', playing: false, round: null, idx: 0,
    right: 0, firstTry: 0, tried: false, lock: false, blendStep: 0, picked1: null, picked2: null,

    open(app) {
      this.app = app;
      this.playing = false;
      this.render();
    },

    state() { return (this.app && this.app.state) || {}; },

    tap() { if (A) A.sfx('tap'); },
    say(text) { if (A) A.sayCN(text); },

    render() {
      const body = document.getElementById('bopoBody');
      if (!body) return;
      document.querySelectorAll('#bopoTabs button').forEach((b) => {
        b.classList.toggle('on', b.dataset.tab === this.tab);
      });
      if (this.tab === 'chart') this.renderChart(body);
      else if (this.tab === 'listen') this.renderListen(body);
      else this.renderBlend(body);
    },

    /* ── 圖鑑 ── */
    renderChart(body) {
      body.innerHTML = GROUPS.map((g) => `
        <div class="bopo-group">
          <div class="bopo-gh"><i style="background:${g.color}"></i>${g.name} <span>${g.note}</span></div>
          <div class="bopo-grid">${g.list.map((x) => `
            <button class="bopo-card" data-s="${x.s}" style="--c:${g.color}">
              <b>${x.s}</b><span>${x.emoji}</span>
            </button>`).join('')}
          </div>
        </div>`).join('') + `<div class="bopo-tip">點一個注音，聽聽看它在哪個詞裡 👂</div>`;

      body.querySelectorAll('.bopo-card').forEach((el) => {
        el.addEventListener('click', () => {
          const x = SYM[el.dataset.s];
          this.tap();
          body.querySelectorAll('.bopo-card').forEach((e) => e.classList.remove('sel'));
          el.classList.add('sel');
          this.showBig(body, x);
          this.say(x.word);
          setTimeout(() => this.say(x.word), 1200);
          if (V && V.burst) V.burst(el, 6);
        });
      });
    },

    showBig(body, x) {
      let box = body.querySelector('.bopo-big');
      if (!box) {
        box = document.createElement('div');
        box.className = 'bopo-big';
        body.insertBefore(box, body.firstChild);
      }
      box.style.setProperty('--c', B.groupColor(x.kind));
      box.innerHTML = `<button class="big-x" aria-label="收起">✕</button><div class="big-sym">${x.s}</div>
        <div class="big-right">
          <div class="big-word">${x.emoji} ${x.word}</div>
          <div class="big-py">${x.py}</div>
          <div class="big-tag">${x.group} · 聽一次 🔊</div>
        </div>`;
      box.classList.remove('pop');
      void box.offsetWidth;
      box.classList.add('pop');
      box.addEventListener('click', (e) => {
        if (e.target && e.target.className === 'big-x') { box.remove(); return; }
        this.say(x.word); this.tap();
      });
    },

    /* ── 聽音找注音 ── */
    renderListen(body) {
      if (!this.playing) {
        body.innerHTML = `<div class="bopo-start">
            <div class="bs-emoji">👂</div>
            <h3>聽一聽，找出開頭的注音</h3>
            <p>公主會念一個詞，你選出它開頭（或結尾）的注音。</p>
            <button class="ghost" id="bopoStart">開始 ▶</button>
          </div>`;
        body.querySelector('#bopoStart').addEventListener('click', () => {
          this.playing = true; this.idx = 0; this.right = 0; this.firstTry = 0; this.paid = false;
          this.tap();
          this.nextListen();
        });
        return;
      }
      if (this.idx >= ROUNDS) return this.renderFinish(body, 'listen');

      const r = this.round;
      const isFinal = r.kind === 'final';
      body.innerHTML = `<div class="bopo-quiz">
          <div class="q-head"><span class="q-n">第 ${this.idx + 1} / ${ROUNDS} 題</span>
            <span class="q-kind">${isFinal ? '韻符（後面的音）' : '聲符（開頭的音）'}</span></div>
          <button class="q-play" id="qPlay">🔊 再聽一次</button>
          <div class="q-hint">${r.prompt}</div>
          <div class="q-choices">${r.choices.map((c) => `
            <button class="q-choice" data-s="${c.s}"><b>${c.s}</b></button>`).join('')}</div>
          <div class="q-fb" id="qFb"></div>
        </div>`;
      body.querySelector('#qPlay').addEventListener('click', () => { this.tap(); this.say(r.target.word); });
      body.querySelectorAll('.q-choice').forEach((el) => {
        el.addEventListener('click', () => this.answerListen(el, r));
      });
      setTimeout(() => this.say(r.target.word), 260);
    },

    answerListen(el, r) {
      if (this.lock) return;
      const sym = SYM[el.dataset.s];
      const good = checkListen(r, sym);
      const fb = document.getElementById('qFb');
      if (good) {
        this.lock = true;
        el.classList.add('ok');
        if (A) A.sfx('correct');
        if (!this.tried) this.firstTry++;
        this.right++;
        this.markSeen(r.target);
        if (fb) fb.innerHTML = `✅ ${r.target.emoji} ${r.target.word} 的 ${r.kind === 'final' ? '韻符' : '聲符'}是 <b>${r.target.s}</b>`;
        this.say(r.target.word);
        setTimeout(() => { this.lock = false; this.idx++; this.tried = false; this.nextListen(); }, 1250);
      } else {
        this.tried = true;
        el.classList.add('bad');
        el.disabled = true;
        if (A) A.sfx('wrong');
        this.markWrong(r.target);
        if (fb) fb.textContent = '再聽一次試試看 👂';
        setTimeout(() => this.say(r.target.word), 200);
      }
    },

    nextListen() {
      if (this.idx >= ROUNDS) { this.render(); return; }   // 問完了 → 結算
      // 一半聲符、一半韻符
      const kind = this.idx % 2 === 0 ? 'initial' : 'final';
      this.round = listenRound(kind);
      this.lock = false; this.tried = false;
      this.render();
    },

    /* ── 拼音拼讀 ── */
    renderBlend(body) {
      if (!this.playing) {
        body.innerHTML = `<div class="bopo-start">
            <div class="bs-emoji">🧩</div>
            <h3>拼一拼，變出一個字</h3>
            <p>先選聲符，再選韻符，看看拼起來是什麼！</p>
            <button class="ghost" id="bopoStart">開始 ▶</button>
          </div>`;
        body.querySelector('#bopoStart').addEventListener('click', () => {
          this.playing = true; this.idx = 0; this.right = 0; this.firstTry = 0; this.paid = false;
          this.tap();
          this.nextBlend();
        });
        return;
      }
      if (this.idx >= ROUNDS) return this.renderFinish(body, 'blend');

      const r = this.round;
      const showSecond = this.blendStep >= 1;
      const both = this.blendStep >= 2;
      const combo = both ? (r.p1.s + r.p2.s) : '';
      body.innerHTML = `<div class="bopo-quiz">
          <div class="q-head"><span class="q-n">第 ${this.idx + 1} / ${ROUNDS} 題</span>
            <span class="q-kind">拼音拼讀</span></div>
          <div class="blend-target">${r.target.emoji}<span>${both ? r.target.zh : '⋯⋯'}</span></div>
          <button class="q-play" id="qPlay">🔊 再聽一次</button>
          <div class="blend-line ${both ? 'done' : ''}">
            <span class="bl-slot ${this.picked1 ? 'filled' : ''}">${this.picked1 ? this.picked1.s : '？'}</span>
            <span class="bl-plus">＋</span>
            <span class="bl-slot ${this.picked2 ? 'filled' : ''}">${this.picked2 ? this.picked2.s : '？'}</span>
            <span class="bl-eq">＝</span>
            <span class="bl-out ${both ? 'filled' : ''}">${combo || '？'}</span>
          </div>
          ${!showSecond ? `<div class="q-hint">① 選開頭的聲音（聲符）</div>
              <div class="q-choices">${r.initialChoices.map((c) => `<button class="q-choice" data-p="1" data-s="${c.s}"><b>${c.s}</b></button>`).join('')}</div>`
          : !both ? `<div class="q-hint">② 選後面的聲音（韻符）</div>
              <div class="q-choices">${r.finalChoices.map((c) => `<button class="q-choice" data-p="2" data-s="${c.s}"><b>${c.s}</b></button>`).join('')}</div>`
          : `<div class="q-hint ok-hint">✅ ${r.p1.s} ＋ ${r.p2.s} ＝ ${combo}（${r.target.zh}）</div>`}
          <div class="q-fb" id="qFb"></div>
        </div>`;
      body.querySelector('#qPlay').addEventListener('click', () => { this.tap(); this.say(r.target.zh); });
      body.querySelectorAll('.q-choice').forEach((el) => {
        el.addEventListener('click', () => this.answerBlend(el, r));
      });
      if (this.blendStep === 0) setTimeout(() => this.say(r.target.zh), 260);
    },

    answerBlend(el, r) {
      if (this.lock) return;
      const step = Number(el.dataset.p);
      const sym = SYM[el.dataset.s];
      const good = step === 1 ? sym.s === r.p1.s : sym.s === r.p2.s;
      const fb = document.getElementById('qFb');
      if (!good) {
        el.classList.add('bad');
        el.disabled = true;
        if (A) A.sfx('wrong');
        this.tried = true;
        if (fb) fb.textContent = '不是這個，再聽一次 👂';
        setTimeout(() => this.say(r.target.zh), 200);
        return;
      }
      if (A) A.sfx('tap');
      if (step === 1) {
        this.picked1 = sym;
        this.blendStep = 1;
        this.render();
      } else {
        this.picked2 = sym;
        this.blendStep = 2;
        this.lock = true;
        if (A) A.sfx('correct');
        if (!this.tried) this.firstTry++;
        this.right++;
        this.markSeen({ s: r.p1.s });
        this.markSeen({ s: r.p2.s });
        this.render();
        setTimeout(() => {
          this.say(r.target.zh);
          if (V && V.burst) {
            const out = document.querySelector('.bl-out');
            if (out) V.burst(out, 8);
          }
        }, 420);
        setTimeout(() => {
          this.lock = false;
          this.idx++;
          this.tried = false;
          this.blendStep = 0;
          this.picked1 = null;
          this.picked2 = null;
          this.nextBlend();
        }, 2100);
      }
    },

    nextBlend() {
      if (this.idx >= ROUNDS) { this.render(); return; }
      this.round = blendRound();
      this.render();
    },

    /* ── 紀錄與結束 ── */
    markSeen(x) {
      const app = this.app; if (!app || !app.state) return;
      const st = app.state.bopo || (app.state.bopo = { seen: {}, right: 0, wrong: 0 });
      const k = x.s;
      st.seen[k] = (st.seen[k] || 0) + 1;
      st.right = (st.right || 0) + 1;
      app.persist();
    },
    markWrong(x) {
      const app = this.app; if (!app || !app.state) return;
      const st = app.state.bopo || (app.state.bopo = { seen: {}, right: 0, wrong: 0 });
      st.wrong = (st.wrong || 0) + 1;
      app.persist();
    },

    renderFinish(body, mode) {
      const stars = this.right >= ROUNDS ? 3 : this.right >= Math.ceil(ROUNDS * 0.6) ? 2 : 1;
      const gain = this.right + (stars >= 3 ? 3 : 1);
      const app = this.app;
      if (!this.paid && app && app.state) {
        this.paid = true;
        app.state.stones = (app.state.stones || 0) + gain;
        app.persist();
        if (app.refreshStones) app.refreshStones();
      }
      if (A && A.sfx) A.sfx('star');
      body.innerHTML = `<div class="bopo-finish">
          <div class="bf-stars">${[0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('')}</div>
          <h3>${stars >= 3 ? '太厲害了！' : '很棒喔！'}</h3>
          <p>答對 ${this.right} / ${ROUNDS} 題　獲得 💎 ${gain}</p>
          <button class="ghost" id="bopoAgain">再玩一次 ▶</button>
          <button class="btn grey" id="bopoBack">回注音屋</button>
        </div>`;
      body.querySelector('#bopoAgain').addEventListener('click', () => {
        this.playing = true; this.idx = 0; this.right = 0; this.firstTry = 0; this.paid = false;
        this.blendStep = 0; this.picked1 = null; this.picked2 = null;
        if (mode === 'blend') this.nextBlend(); else this.nextListen();
      });
      body.querySelector('#bopoBack').addEventListener('click', () => {
        this.playing = false; this.tab = 'chart'; this.render();
      });
      this.say(stars >= 3 ? '太厲害了！' : '很棒喔！');
    }
  };

  // 分頁切換
  document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.getElementById('bopoTabs');
    if (!tabs) return;
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      UI.tab = b.dataset.tab;
      UI.playing = false;
      UI.blendStep = 0; UI.picked1 = null; UI.picked2 = null;
      if (A) A.sfx('tap');
      UI.render();
    });
  });

  B.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
