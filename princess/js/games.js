/* games.js — 畫面元件（SVG/卡片）＋ 課程流程（故事 → 遊戲 → 寶卡） */
(function (root) {
  const D = root.PData, L = root.PLogic, A = root.PAudio, S = root.PStore;

  /* ── SVG 元件 ─────────────────────────────────────── */
  function princessSVG(c, wearing, opts) {
    // 寶可夢夥伴 → 像素點陣（sprites.js）
    if (c && c.kind === 'pet') {
      return root.PSprites ? root.PSprites.spriteSVG(c.sprite, opts) : '';
    }
    const w = wearing || {};
    const dress = c.dress, hair = c.hair, gem = c.gem;
    const darker = shade(dress, -18);
    const wings = w.wings
      ? `<g opacity=".9"><ellipse cx="58" cy="132" rx="30" ry="44" fill="#dff3ff" stroke="#bfe6ff" stroke-width="3" transform="rotate(-18 58 132)"/>
         <ellipse cx="142" cy="132" rx="30" ry="44" fill="#dff3ff" stroke="#bfe6ff" stroke-width="3" transform="rotate(18 142 132)"/></g>` : '';
    const crown = w.crown
      ? `<path d="M74 46 l9 -20 l10 13 l7 -16 l7 16 l10 -13 l9 20 z" fill="#ffd93d" stroke="#f2b705" stroke-width="2" stroke-linejoin="round"/>
         <circle cx="100" cy="34" r="4" fill="${gem}"/>` : '';
    const wand = w.wand
      ? `<g transform="rotate(-16 156 176)"><rect x="152" y="150" width="5" height="52" rx="2.5" fill="#fff0a8" stroke="#e8c94a" stroke-width="1.5"/>
         <path d="M154.5 138 l4.5 10 l11 1.5 l-8 8 l2 11 l-9.5 -5.5 l-9.5 5.5 l2 -11 l-8 -8 l11 -1.5 z" fill="#ffe066" stroke="#f2c200" stroke-width="1.6" stroke-linejoin="round"/></g>` : '';
    const dress2 = w.dress2
      ? `<path d="M100 120 C 58 152 42 216 42 242 L158 242 C158 216 142 152 100 120 Z" fill="url(#rainbow)"/>` : '';

    return `<svg viewBox="0 0 200 265" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="rainbow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ff9fd0"/><stop offset="35%" stop-color="#ffd93d"/>
          <stop offset="70%" stop-color="#7fd8a5"/><stop offset="100%" stop-color="#7fb8ff"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="35%" r="60%">
          <stop offset="0%" stop-color="#fff" stop-opacity=".9"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="252" rx="62" ry="9" fill="#5b2a6b" opacity=".12"/>
      ${wings}
      ${dress2 || `<path d="M100 118 C 62 150 46 214 46 240 L154 240 C154 214 138 150 100 118 Z" fill="${dress}"/>`}
      <path d="M78 110 h44 v28 a22 22 0 0 1 -44 0 z" fill="${darker}"/>
      <circle cx="64" cy="146" r="9.5" fill="#ffe0cf"/>
      <circle cx="136" cy="146" r="9.5" fill="#ffe0cf"/>
      <circle cx="100" cy="80" r="35" fill="#ffe6d6"/>
      <path d="M100 42 c-27 0 -41 19 -41 40 c0 7 2 12 4 16 c0 -30 15 -36 37 -36 s37 6 37 36 c2 -4 4 -9 4 -16 c0 -21 -14 -40 -41 -40 z" fill="${hair}"/>
      <ellipse cx="88" cy="82" rx="4.6" ry="6.2" fill="#3b2a35"/>
      <ellipse cx="112" cy="82" rx="4.6" ry="6.2" fill="#3b2a35"/>
      <circle cx="89.6" cy="80" r="1.6" fill="#fff"/><circle cx="113.6" cy="80" r="1.6" fill="#fff"/>
      <circle cx="76" cy="92" r="6" fill="#ffb3c8" opacity=".55"/>
      <circle cx="124" cy="92" r="6" fill="#ffb3c8" opacity=".55"/>
      <path d="M93 93 q7 8 14 0" stroke="#c9647f" stroke-width="3" fill="none" stroke-linecap="round"/>
      ${crown}
      ${wand}
      <circle cx="100" cy="80" r="52" fill="url(#glow)" opacity=".35"/>
    </svg>`;
  }

  function shade(hex, pct) {
    const n = parseInt(hex.replace('#', ''), 16);
    let r = (n >> 16) + pct, g = ((n >> 8) & 0xff) + pct, b = (n & 0xff) + pct;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  const SHAPE_PATH = {
    circle: (c) => `<circle cx="50" cy="50" r="41" fill="${c}" stroke="#fff" stroke-width="4"/>`,
    square: (c) => `<rect x="11" y="11" width="78" height="78" rx="10" fill="${c}" stroke="#fff" stroke-width="4"/>`,
    star: (c) => `<path d="M50 6 l13.5 27.5 l30.3 4.4 l-21.9 21.4 l5.2 30.2 l-27.1 -14.2 l-27.1 14.2 l5.2 -30.2 l-21.9 -21.4 l30.3 -4.4 z" fill="${c}" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>`,
    triangle: (c) => `<path d="M50 10 L92 86 L8 86 Z" fill="${c}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>`,
    heart: (c) => `<path d="M50 88 C-6 52 12 12 50 32 C88 12 106 52 50 88 Z" fill="${c}" stroke="#fff" stroke-width="4"/>`
  };

  function shapeSVG(shape, color) {
    const f = SHAPE_PATH[shape] || SHAPE_PATH.circle;
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${f(color)}</svg>`;
  }

  function gemSVG(color) {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M50 8 L86 34 L72 88 L28 88 L14 34 Z" fill="${color}" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M50 8 L28 88 L50 66 Z" fill="#fff" opacity=".22"/>
      <path d="M50 8 L72 88 L50 66 Z" fill="#000" opacity=".10"/>
      <path d="M50 22 L64 40 L58 70 L42 70 L36 40 Z" fill="#fff" opacity=".3"/>
    </svg>`;
  }

  function numberTile(word) {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="8" width="84" height="84" rx="18" fill="${word.color}" stroke="#fff" stroke-width="4"/>
      <text x="50" y="62" font-size="46" font-weight="800" text-anchor="middle" fill="#7a4c00" font-family="system-ui,sans-serif">${word.num}</text>
      <text x="50" y="84" font-size="15" text-anchor="middle" fill="#7a4c00">${'●'.repeat(word.num)}</text>
    </svg>`;
  }

  function artHTML(word) {
    if (!word) return '';
    if (word.kind === 'color') return gemSVG(word.color);
    if (word.kind === 'shape') return shapeSVG(word.shape || word.en.toLowerCase(), word.color);
    if (word.kind === 'combo') return shapeSVG(word.shape, word.color);
    if (word.kind === 'number') return numberTile(word);
    return `<span class="emo">${word.emoji || '✨'}</span>`;
  }

  function cardHTML(card, opts) {
    const o = opts || {};
    const r = D.RARITY[card.rarity] || D.RARITY.common;
    const locked = !!o.locked;
    return `<div class="bigcard ${locked ? 'locked' : ''} ${o.cls || ''}" style="box-shadow:none">
      <div class="cardface" style="${locked ? '' : 'box-shadow:0 16px 34px ' + r.glow}">
        <div class="em">${locked ? '❓' : card.emoji}</div>
        <div class="nm">${locked ? '？？？' : card.name}</div>
        <div class="rr" style="background:${locked ? '#cfc0ce' : r.color}">${r.name}</div>
      </div>
    </div>`;
  }

  function spark(x, y, emoji) {
    const layer = document.getElementById('fx');
    if (!layer) return;
    const s = document.createElement('div');
    s.className = 'spark';
    s.textContent = emoji || ['✨', '⭐', '💫', '🌟'][Math.floor(Math.random() * 4)];
    s.style.left = (x - 13) + 'px';
    s.style.top = (y - 13) + 'px';
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }

  function burst(el, n) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    for (let i = 0; i < (n || 8); i++) {
      setTimeout(() => spark(r.left + Math.random() * r.width, r.top + Math.random() * r.height * 0.7), i * 55);
    }
  }

  function toast(text, ms) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 1600);
  }

  /* ── 課程流程 ────────────────────────────────────── */
  const Lesson = {
    host: null, onDone: null, onExit: null,

    start(opts) {
      this.host = document.getElementById('lessonBody');
      this.week = opts.week;
      this.onDone = opts.onDone;
      this.onExit = opts.onExit || function () { };
      this.rounds = L.makeRounds(this.week, L.ROUNDS);
      this.idx = 0;
      this.firstTry = 0;
      this.attempts = 0;
      this.dotsEl = document.getElementById('dots');
      this.renderDots();
      this.stepStory();
    },

    renderDots(mark) {
      if (!this.dotsEl) return;
      this.dotsEl.innerHTML = '';
      for (let i = 0; i < this.rounds.length; i++) {
        const d = document.createElement('i');
        if (i < this.idx) d.className = 'ok';
        if (i === this.idx && this.step === 'play') d.className = 'on';
        this.dotsEl.appendChild(d);
      }
    },

    setPrompt(text, cn) {
      return `<div class="prompt">${text}${cn ? `<small>${cn}</small>` : ''}</div>`;
    },

    /* 步驟一：故事＋單字卡 */
    stepStory() {
      this.step = 'story';
      this.renderDots();
      const w = this.week;
      const pool = L.weekPool(w).slice(0, 4);
      const cards = pool.map((x) => `<div class="wordcard" data-say="${x.en}">
          <div class="art">${artHTML(x)}</div>
          <div class="en">${x.en}</div>
          <div class="ph">${x.ph ? x.ph.sound : ''} ${x.zh}</div>
        </div>`).join('');
      this.host.innerHTML = `<div class="story">
          ${this.setPrompt('Listen and tap!', '聽一聽，點點看')}
          <div class="words">${cards}</div>
          <button class="startbtn" id="startPlay">開始魔法遊戲 ▶</button>
        </div>`;
      this.host.querySelectorAll('.wordcard').forEach((c) => {
        c.addEventListener('click', () => {
          A.sfx('tap');
          burst(c, 3);
          A.sayWord({ en: c.dataset.say });
        });
      });
      const btn = this.host.querySelector('#startPlay');
      btn.addEventListener('click', () => {
        A.sfx('star');
        this.stepPlay();
      });
      // 在「點擊週關卡」的手勢中同步念出第一個單字（iOS 才不會被擋）
      A.sayWord(pool[0]);
    },

    /* 步驟二：6 回合 */
    stepPlay() {
      this.step = 'play';
      this.idx = 0;
      this.nextRound();
    },

    nextRound() {
      if (this.idx >= this.rounds.length) return this.stepReward();
      this.renderDots();
      const r = this.rounds[this.idx];
      this.attempts = 0;
      const isCount = this.week.game === 'count';
      const extra = isCount ? `<div style="font-size:clamp(26px,6vw,44px);letter-spacing:6px">${'🍎'.repeat(r.target.num)}</div>` : '';
      const choices = r.choices.map((c, i) =>
        `<div class="choice" data-i="${i}"><div class="art">${artHTML(c)}</div></div>`).join('');
      this.host.innerHTML = `<div class="story">
          ${extra}
          ${this.setPrompt(isCount ? 'Count with me!' : r.prompt, isCount ? '數一數，有幾個蘋果？' : '')}
          <div class="choices">${choices}</div>
        </div>`;

      const speakNow = () => {
        if (isCount) {
          A.speak('Count with me!');
          for (let n = 1; n <= r.target.num; n++) {
            setTimeout(() => A.speak(String(n), { rate: 0.7 }), 900 + n * 700);
          }
        } else {
          A.speak(r.prompt);
        }
      };
      this.speakNow = speakNow;
      // 提示句本身也可以點 → 再聽一次（大手勢目標）
      const pEl = this.host.querySelector('.prompt');
      if (pEl) {
        pEl.style.cursor = 'pointer';
        pEl.addEventListener('click', () => { A.sfx('tap'); speakNow(); });
      }
      // 同步播放：nextRound 由「點選項」的手勢呼叫，iOS 允許發聲
      speakNow();

      this.host.querySelectorAll('.choice').forEach((el) => {
        el.addEventListener('click', () => this.answer(el, r, speakNow));
      });
    },

    answer(el, r, speakNow) {
      const i = Number(el.dataset.i);
      const picked = r.choices[i];
      const key = L.keyOf(picked), tkey = L.keyOf(r.target);
      const ok = key === tkey;
      this.attempts++;

      if (ok) {
        const first = this.attempts === 1;
        if (first) this.firstTry++;
        L.recordAnswer(PApp.state, r.target, true, first);
        A.sfx('correct');
        el.classList.add('correct');
        burst(el, 12);
        const word = r.target.kind === 'combo' ? { en: r.target.en } : r.target;
        A.speak('Yes! ' + word.en);
        this.host.querySelectorAll('.choice').forEach((c) => c.style.pointerEvents = 'none');
        setTimeout(() => { this.idx++; this.nextRound(); }, 1150);
      } else {
        L.recordAnswer(PApp.state, r.target, false, false);
        A.sfx('wrong');
        el.classList.add('wrong');
        setTimeout(() => el.classList.remove('wrong'), 420);
        A.speak('Try again!');
        if (this.attempts >= 2) {
          // 低挫折：第二次錯就給提示（脈動正確答案）
          const right = Array.from(this.host.querySelectorAll('.choice'))
            .find((c) => L.keyOf(r.choices[Number(c.dataset.i)]) === tkey);
          if (right) {
            right.classList.add('hint');
            setTimeout(() => right.classList.remove('hint'), 2600);
          }
        }
        setTimeout(() => speakNow && speakNow(), 700);
      }
    },

    /* 步驟三：寶卡＋魔法石 */
    stepReward() {
      this.step = 'reward';
      this.renderDots();
      const stars = L.starsFor(this.firstTry, this.rounds.length);
      const perfect = this.firstTry === this.rounds.length;
      const stones = L.stonesFor(stars, perfect);
      const res = S.completeLesson(PApp.state, this.week, stars, stones);
      PApp.persist();
      PApp.refreshStones();

      let n = 0;
      const iv = setInterval(() => {
        if (n++ >= stones) return clearInterval(iv);
        A.sfx('coin');
        burst(document.querySelector('.bigcard') || this.host, 2);
      }, 220);

      A.sfx('card');
      this.host.innerHTML = `<div class="reward">
          <div class="cap">${res.firstCard ? '獲得新寶卡！' : '又見面了！'}</div>
          <div id="cardSlot">${cardHTML(this.week.card, { cls: 'flip' })}</div>
          <div class="cap" style="font-size:15px;color:#a98aa4">💎 +${stones}　${'⭐'.repeat(stars)}</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">
            <button class="btn" id="againBtn">🔊 再聽一次</button>
            <button class="btn" id="homeBtn" style="background:linear-gradient(120deg,#ff9fd0,#c48bff)">回房間 🏠</button>
          </div>
        </div>`;

      const sayCard = () => A.sayWord({ en: this.week.card.say || this.week.card.name });
      setTimeout(sayCard, 700);
      this.host.querySelector('#againBtn').addEventListener('click', () => {
        A.sfx('tap'); burst(this.host.querySelector('.bigcard'), 6); sayCard();
      });
      this.host.querySelector('#cardSlot').addEventListener('click', () => {
        A.sfx('tap'); burst(this.host.querySelector('.bigcard'), 8); sayCard();
      });
      this.host.querySelector('#homeBtn').addEventListener('click', () => this.onDone(res));
    },

    replay() {
      if (this.speakNow) this.speakNow();
    },

    quit() { this.onExit(); }
  };

  root.PView = { princessSVG, shapeSVG, gemSVG, numberTile, artHTML, cardHTML, spark, burst, toast, shade };
  root.PLesson = Lesson;
})(window);
