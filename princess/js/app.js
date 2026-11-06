/* app.js — 主程式：畫面切換、房間、地圖、圖鑑、商店、家長後台、時間管理 */
(function (root) {
  const D = root.PData, L = root.PLogic, A = root.PAudio, S = root.PStore, V = root.PView, LESSON = root.PLesson;

  const PApp = {
    state: null,
    view: 'boot',
    ticker: null,
    lastTick: 0,
    parentUnlocked: false,

    init() {
      this.state = S.load();
      A.init();
      A.enabled = !!this.state.settings.sound;
      this.updateVoiceBtn();
      this.bindNav();
      this.renderBoot();
      this.startTicker();
      setTimeout(() => this.checkVoice(), 1200);
      if (this.state.companion) {
        this.show('room');
      } else {
        this.show('boot');
      }
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { this.flushSeconds(); this.persist(); }
      });
      window.addEventListener('pagehide', () => { this.flushSeconds(); this.persist(); });
    },

    /* ── 存檔 ─────────────────────────────── */
    persist() { S.save(this.state); },

    flushSeconds() {
      const sec = this.state.sessionSeconds || 0;
      if (sec >= 3) {
        L.addMinutes(this.state, sec / 60);
        this.state.sessionSeconds = 0;
      }
    },

    startTicker() {
      this.lastTick = Date.now();
      clearInterval(this.ticker);
      this.ticker = setInterval(() => {
        const now = Date.now();
        const dt = Math.min(15, (now - this.lastTick) / 1000);
        this.lastTick = now;
        if (document.hidden) return;
        this.state.sessionSeconds = (this.state.sessionSeconds || 0) + dt;
        if (this.state.sessionSeconds > 30) { L.addMinutes(this.state, this.state.sessionSeconds / 60); this.state.sessionSeconds = 0; }
        this.checkLimit();
      }, 5000);
      setInterval(() => this.persist(), 20000);
    },

    checkLimit() {
      if (this.state.settings.bypassDate === L.todayKey()) return;
      const t = L.timeStatus(this.state, null);
      if (t.over) this.showLock();
    },

    showLock() {
      const lock = document.getElementById('lock');
      if (!lock.hidden) return;
      lock.hidden = false;
      A.sayCN('今天的魔法用完囉，明天再來一起玩！');
    },

    /* ── 導覽 ─────────────────────────────── */
    show(view) {
      this.view = view;
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
      const el = document.getElementById('scr-' + view);
      if (el) el.classList.add('on');
      if (view === 'room') this.renderRoom();
      if (view === 'map') this.renderMap();
      if (view === 'dex') this.renderDex();
      if (view === 'shop') this.renderShop();
      if (view === 'parent') this.renderParent();
      if (view === 'bopo' && root.PBopo && root.PBopo.UI) root.PBopo.UI.open(this);
      this.refreshStones();
    },

    bindNav() {
      const $ = (id) => document.getElementById(id);
      $('btnPlay').addEventListener('click', () => { A.sfx('tap'); this.show('map'); this.say('Let\'s go on an adventure!'); });
      $('btnDex').addEventListener('click', () => { A.sfx('tap'); this.show('dex'); this.say('My magic cards!'); });
      $('btnShop').addEventListener('click', () => { A.sfx('tap'); this.show('shop'); this.say('Welcome to my shop!'); });
      const bopoBtn = $('btnBopo');
      if (bopoBtn) bopoBtn.addEventListener('click', () => { A.sfx('tap'); this.show('bopo'); });
      $('btnParent').addEventListener('click', () => { this.parentUnlocked = false; A.sfx('tap'); this.show('parent'); });
      $('btnVoice').addEventListener('click', () => {
        this.state.settings.sound = !this.state.settings.sound;
        A.enabled = !!this.state.settings.sound;
        if (!A.enabled) A.stop();
        this.updateVoiceBtn();
        this.persist();
      });
      document.querySelectorAll('[data-back]').forEach((b) => {
        b.addEventListener('click', () => { A.sfx('tap'); this.show(b.dataset.back); });
      });
      $('btnQuit').addEventListener('click', () => this.confirmQuitLesson());
      $('btnReplay').addEventListener('click', () => LESSON.replay());
      $('modalClose').addEventListener('click', () => this.closeModal());
      $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') this.closeModal(); });
      $('lockParent').addEventListener('click', () => this.parentUnlockFromLock());
      $('btnContinue').addEventListener('click', () => this.finishBoot());
    },

    /* 語音可用性檢查 → 必要時顯示提示橫幅（不阻擋遊戲） */
    checkVoice() {
      const p = A.probe();
      const bad = !p.supported || p.voices === 0;
      if (!bad && !p.inAppBrowser) return;
      if (document.getElementById('voiceWarn')) return;
      const msg = !p.supported
        ? '這個瀏覽器不支援語音。請用 <b>Safari</b> 或 <b>Chrome</b> 開啟。'
        : p.inAppBrowser
          ? '目前在 App 內建瀏覽器，語音常被關閉。請點右上「⋯」→ <b>在 Safari 開啟</b>。'
          : '還沒載入語音，請確認手機<b>沒切靜音</b>、音量開大，或用 Safari 開啟。';
      const el = document.createElement('div');
      el.className = 'voicewarn';
      el.id = 'voiceWarn';
      el.innerHTML = `🔇 ${msg} <button aria-label="關閉">✕</button>`;
      el.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation(); el.remove();
      });
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 14000);
    },

    updateVoiceBtn() {
      const b = document.getElementById('btnVoice');
      if (b) b.textContent = this.state.settings.sound ? '🔊' : '🔇';
    },

    say(text) { A.speak(text); },

    refreshStones() {
      const n = this.state.stones || 0;
      const a = document.getElementById('stoneCount'); if (a) a.textContent = n;
      document.querySelectorAll('.stoneCount').forEach((e) => e.textContent = n);
    },

    /* ── 首次設定：選夥伴 ─────────────────── */
    renderBoot() {
      const box = document.getElementById('companionPicks');
      box.innerHTML = D.COMPANIONS.map((c) => `
        <div class="pick" data-id="${c.id}">
          <div class="face">${V.princessSVG(c, {}, { pad: 2 })}</div>
          <div class="nm">${c.emoji} ${c.name}</div>
        </div>`).join('');
      box.querySelectorAll('.pick').forEach((el) => {
        el.addEventListener('click', () => {
          box.querySelectorAll('.pick').forEach((e) => e.classList.remove('sel'));
          el.classList.add('sel');
          this.pendingCompanion = el.dataset.id;
          document.getElementById('btnContinue').hidden = false;
          A.sfx('tap');
          const c = D.COMPANIONS.find((x) => x.id === el.dataset.id);
          A.speak(c.intro || ('Hello! I am the ' + (c.en || 'Princess') + '!'));
        });
      });
    },

    finishBoot() {
      if (!this.pendingCompanion) return;
      this.state.companion = this.pendingCompanion;
      this.persist();
      A.sfx('star');
      this.show('room');
      setTimeout(() => this.greet(), 500);
    },

    companion() {
      return D.COMPANIONS.find((c) => c.id === this.state.companion) || D.COMPANIONS[0];
    },

    /* ── 房間 ─────────────────────────────── */
    renderRoom() {
      const c = this.companion();
      const w = this.state.wearing || {};
      document.getElementById('princess').innerHTML = V.princessSVG(c, w, { pad: c.kind === 'pet' ? 10 : 0 });
      const decor = (this.state.decor || []).map((id) => {
        const it = D.SHOP.find((s) => s.id === id);
        return it ? `<i>${it.emoji}</i>` : '';
      }).join('');
      document.getElementById('decorLayer').innerHTML = decor;
      this.refreshStones();
      this.checkVoice();
    },

    greet() {
      const c = this.companion();
      const total = Object.keys(this.state.cards || {}).length;
      const msg = total === 0 ? '一起去找魔法寶卡吧！' : `我已經有 ${total} 張寶卡了！`;
      const b = document.getElementById('bubble');
      document.getElementById('bubbleText').textContent = msg;
      b.hidden = false;
      A.speak(c.greet || ('Hello! ' + (total === 0 ? 'Let us find magic cards!' : 'Look at all my magic cards!')));
      clearTimeout(this._bubbleT);
      this._bubbleT = setTimeout(() => { b.hidden = true; }, 4200);
    },

    /* ── 地圖 ─────────────────────────────── */
    renderMap() {
      const opened = L.unlockedWeeks(this.state);
      const box = document.getElementById('units');
      box.innerHTML = D.UNITS.map((u) => {
        const weeks = D.WEEKS.filter((w) => w.unit === u.u).map((w) => {
          const p = this.state.progress['w' + w.w];
          const stars = p ? p.stars : 0;
          const locked = opened.indexOf(w.w) < 0;
          const starHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('');
          return `<div class="week ${locked ? 'locked' : ''} ${stars >= 3 ? 'done' : ''}" data-w="${w.w}">
              <span class="n">W${w.w}</span>
              <span class="em">${locked ? '🔒' : w.card.emoji}</span>
              <div class="tt">${w.title}</div>
              <div class="stars">${starHTML}</div>
            </div>`;
        }).join('');
        return `<div class="unit">
            <div class="unit-h"><span class="em">${u.emoji}</span>${u.name}</div>
            <div class="weeks">${weeks}</div>
          </div>`;
      }).join('');
      box.querySelectorAll('.week').forEach((el) => {
        el.addEventListener('click', () => {
          const n = Number(el.dataset.w);
          const w = L.weekByNo(n);
          if (el.classList.contains('locked')) {
            A.sfx('wrong');
            V.toast('先完成上一關喔 🔒');
            return;
          }
          A.sfx('tap');
          this.openLesson(w);
        });
      });
    },

    openLesson(w) {
      this.show('lesson');
      this._lessonWeek = w;
      LESSON.start({
        week: w,
        onDone: (res) => { this.persist(); this.show('room'); setTimeout(() => this.greet(), 300); },
        onExit: () => { this.persist(); this.show('room'); }
      });
    },

    confirmQuitLesson() {
      const hasProgress = LESSON.step === 'play' || LESSON.step === 'reward';
      if (!hasProgress) { this.show('room'); return; }
      A.sayCN('要離開嗎？這關的魔法石不會保存喔。');
      if (window.confirm('離開這一關？（進度不保存）')) {
        A.stop();
        this.show('room');
      }
    },

    /* ── 圖鑑 ─────────────────────────────── */
    renderDex() {
      const grid = document.getElementById('dexGrid');
      const owned = this.state.cards || {};
      const n = Object.keys(owned).length;
      document.getElementById('dexOwned').textContent = n;
      document.getElementById('dexTotal').textContent = D.ALL_CARDS.length;
      grid.innerHTML = D.ALL_CARDS.map((c) => {
        const has = !!owned[c.id];
        return `<div class="dex-card" data-id="${c.id}">${V.cardHTML(c, { locked: !has })}</div>`;
      }).join('');
      grid.querySelectorAll('.dex-card').forEach((el) => {
        el.addEventListener('click', () => this.openCard(el.dataset.id));
      });
    },

    openCard(id) {
      const card = D.ALL_CARDS.find((c) => c.id === id);
      const has = !!(this.state.cards || {})[id];
      const m = document.getElementById('modal');
      m.hidden = false;
      const inner = document.getElementById('modalInner');
      inner.innerHTML = V.cardHTML(card, { locked: !has, cls: 'flip' }) +
        `<div class="cap" style="font-weight:800;background:#fff;border-radius:999px;padding:10px 22px">
          ${has ? '點卡片聽發音 🔊' : '完成第 ' + card.week + ' 週解鎖 🔒'}</div>`;
      if (has) {
        const slot = inner.querySelector('.bigcard');
        const say = () => {
          A.sfx('star');
          V.burst(slot, 10);
          A.speak(card.say || card.name);
          setTimeout(() => A.speak(card.name, { lang: 'zh-TW' }), 1200);
        };
        slot.addEventListener('click', say);
        setTimeout(say, 500);
      } else {
        A.sfx('wrong');
        A.speak('Not yet! Finish week ' + card.week + '.');
      }
    },

    closeModal() {
      document.getElementById('modal').hidden = true;
      A.stop();
    },

    /* ── 商店 ─────────────────────────────── */
    renderShop() {
      const grid = document.getElementById('shopGrid');
      grid.innerHTML = D.SHOP.map((it) => {
        const owned = (this.state.owned || []).indexOf(it.id) >= 0;
        const poor = (this.state.stones || 0) < it.price;
        return `<div class="shop-item" data-id="${it.id}">
            <div class="em">${it.emoji}</div>
            <div class="nm">${it.name}</div>
            <div class="price">💎 ${it.price}</div>
            <button class="buy ${owned ? 'owned' : ''}" ${owned || poor ? 'disabled' : ''}>
              ${owned ? '已擁有 ✓' : '購買'}
            </button>
          </div>`;
      }).join('');
      grid.querySelectorAll('.shop-item').forEach((el) => {
        const id = el.dataset.id;
        const item = D.SHOP.find((s) => s.id === id);
        el.querySelector('.buy').addEventListener('click', () => {
          const r = S.buy(this.state, item);
          if (r.ok) {
            A.sfx('coin');
            V.burst(el, 10);
            A.speak(item.name ? 'Yay!' : 'Yay!');
            this.persist();
            this.renderShop();
            this.refreshStones();
            V.toast('拿到 ' + item.name + '！');
          } else if (r.reason === 'poor') {
            A.sfx('wrong');
            V.toast('魔法石不夠 💎');
          }
        });
      });
    },

    /* ── 家長後台 ─────────────────────────── */
    renderParent() {
      const body = document.getElementById('parentBody');
      if (!this.parentUnlocked) {
        body.innerHTML = `<div class="pcard">
            <h3>請輸入家長密碼</h3>
            <div class="pin-disp" id="pinDisp">····</div>
            <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
              <button data-k="del">⌫</button><button data-k="0">0</button><button data-k="ok">✓</button></div>
            <div class="note" style="margin-top:12px">預設密碼 1234，可在後台修改。</div>
          </div>`;
        let pin = '';
        const disp = body.querySelector('#pinDisp');
        body.querySelectorAll('.pinpad button').forEach((b) => {
          b.addEventListener('click', () => {
            const k = b.dataset.k;
            A.sfx('tap');
            if (k === 'del') pin = pin.slice(0, -1);
            else if (k === 'ok') {
              if (pin === String(this.state.settings.pin)) {
                this.parentUnlocked = true;
                A.sfx('star');
                this.renderParent();
              } else {
                A.sfx('wrong'); pin = ''; V.toast('密碼不對');
              }
            } else if (pin.length < 4) pin += k;
            disp.textContent = pin || '····';
          });
        });
        return;
      }

      const t = L.timeStatus(this.state, null);
      const mastered = L.masteredCount(this.state);
      const st = this.state.stats || { rounds: 0, correct: 0, wrong: 0 };
      const acc = st.rounds ? Math.round(st.correct / st.rounds * 100) : 0;
      const weeksDone = Object.keys(this.state.progress || {}).filter((k) => (this.state.progress[k].stars || 0) > 0).length;
      const cards = Object.keys(this.state.cards || {}).length;
      const limit = this.state.settings.dailyLimitMin;

      const chips = [0, 10, 15, 20, 30].map((m) =>
        `<button class="chip ${limit === m ? 'sel' : ''}" data-limit="${m}">${m === 0 ? '不限' : m + ' 分鐘'}</button>`).join('');

      const wordRows = Object.keys(this.state.words || {}).sort((a, b) => {
        const A1 = this.state.words[a], B1 = this.state.words[b];
        return (B1.right - B1.wrong) - (A1.right - A1.wrong);
      }).slice(0, 12).map((k) => {
        const w = this.state.words[k];
        return `<div class="row"><span class="k">${k}</span><span class="v">${w.mastered ? '✅ 已掌握' : w.right + '✓ / ' + w.wrong + '✗'}</span></div>`;
      }).join('') || '<div class="note">還沒有學習紀錄</div>';

      body.innerHTML = `
        <div class="pcard">
          <h3>⏰ 今日使用</h3>
          <div class="row"><span class="k">已使用 / 上限</span><span class="v">${t.used} / ${limit === 0 ? '∞' : limit} 分鐘</span></div>
          <div class="chips" style="margin-top:6px">${chips}</div>
          <div class="note" style="margin-top:8px">時間到會自動鎖屏，公主會用語音提醒孩子休息。</div>
        </div>

        <div class="pcard">
          <h3>📊 學習歷程</h3>
          <div class="row"><span class="k">已掌握單字</span><span class="v">${mastered} 個</span></div>
          <div class="row"><span class="k">完成週次</span><span class="v">${weeksDone} / 12</span></div>
          <div class="row"><span class="k">收集寶卡</span><span class="v">${cards} / 12</span></div>
          <div class="row"><span class="k">總答題 / 正確率</span><span class="v">${st.rounds} 題 · ${acc}%</span></div>
          <div class="row"><span class="k">魔法石</span><span class="v">💎 ${this.state.stones || 0}</span></div>
          <div class="row"><span class="k">注音答對 / 答錯</span><span class="v">${(this.state.bopo && this.state.bopo.right) || 0} ✓ / ${(this.state.bopo && this.state.bopo.wrong) || 0} ✗</span></div>
        </div>

        <div class="pcard">
          <h3>🔤 單字掌握度</h3>
          ${wordRows}
        </div>

        <div class="pcard">
          <h3>🎛 課程控制</h3>
          <div class="row"><span class="k">目前的夥伴</span><span class="v">${this.companion().emoji} ${this.companion().name}</span></div>
          <div class="row" style="margin-top:6px"><span class="k">換角色（進度不会消失）</span>
            <button class="btn grey" id="changePartner">🔄 重新選夥伴</button></div>
          <div class="row"><span class="k">解鎖全部週次</span>
            <button class="chip ${this.state.settings.unlockAll ? 'sel' : ''}" id="unlockAll">${this.state.settings.unlockAll ? '已全開' : '依進度解鎖'}</button></div>
          <div class="row"><span class="k">家長密碼</span>
            <div class="pin-row"><input id="newPin" inputmode="numeric" maxlength="4" placeholder="4 位數"><button class="btn" id="setPin">儲存</button></div></div>
        </div>

        <div class="pcard">
          <h3>🔊 語音診斷</h3>
          <button class="btn" id="testVoice">▶ 測試語音（Hello! I am your princess!）</button>
          <div class="note" id="voiceInfo" style="margin-top:10px"></div>
        </div>

        <div class="pcard">
          <h3>☁️ 跨裝置同步（手動）</h3>
          <div class="note">本機自動存檔；換平板時可匯出這串文字，在新裝置貼上匯入。</div>
          <div style="display:flex;gap:8px;margin:10px 0;flex-wrap:wrap">
            <button class="btn" id="exportBtn">匯出存檔</button>
            <button class="btn grey" id="importBtn">貼上匯入</button>
          </div>
          <textarea id="ioBox" style="width:100%;height:80px;border-radius:14px;border:2px solid #f0e4ef;padding:10px;font-size:11px"></textarea>
        </div>

        <div class="pcard">
          <h3>⚠️ 危險區</h3>
          <button class="btn danger" id="resetBtn">清除全部進度</button>
        </div>`;

      body.querySelectorAll('[data-limit]').forEach((b) => {
        b.addEventListener('click', () => {
          this.state.settings.dailyLimitMin = Number(b.dataset.limit);
          if (this.state.settings.bypassDate) delete this.state.settings.bypassDate;
          this.persist(); this.renderParent(); A.sfx('tap');
        });
      });
      body.querySelector('#changePartner').addEventListener('click', () => {
        this.state.companion = null;
        this.pendingCompanion = null;
        this.persist();
        document.getElementById('btnContinue').hidden = true;
        document.querySelectorAll('#companionPicks .pick').forEach((e) => e.classList.remove('sel'));
        this.parentUnlocked = false;
        A.sfx('tap');
        this.show('boot');
      });
      body.querySelector('#unlockAll').addEventListener('click', () => {
        this.state.settings.unlockAll = !this.state.settings.unlockAll;
        this.persist(); this.renderParent(); A.sfx('tap');
      });
      const vp = A.probe();
      const info = body.querySelector('#voiceInfo');
      if (info) {
        info.innerHTML = [
          '支援語音：' + (vp.supported ? '✅ 是' : '❌ 否'),
          '語音數量：' + vp.voices + '　（英文：' + (vp.english || '無') + '）',
          '已暖機：' + (vp.primed ? '是' : '否') + '　App 內建瀏覽器：' + (vp.inAppBrowser ? '是 ⚠️' : '否'),
          '最後錯誤：' + (vp.lastError || '無'),
          '',
          '若按了測試沒聲音：① iPhone 側邊靜音鍵要關 ② 音量調大 ③ 用 Safari 開（不要用 Telegram 內建瀏覽器）④ 重新整理一次。'
        ].join('<br>');
      }
      const tv = body.querySelector('#testVoice');
      if (tv) tv.addEventListener('click', () => {
        A.primed = true;
        A.speak('Hello! I am your princess!');
        setTimeout(() => {
          const again = A.probe();
          const box = body.querySelector('#voiceInfo');
          if (box) box.innerHTML = box.innerHTML.split('<br><br>')[0] + '<br>剛剛播放：' + (again.lastSpoken || '—') + '<br>錯誤：' + (again.lastError || '無');
        }, 1800);
      });

      body.querySelector('#setPin').addEventListener('click', () => {
        const v = body.querySelector('#newPin').value.trim();
        if (!/^\d{4}$/.test(v)) return V.toast('請輸入 4 位數字');
        this.state.settings.pin = v; this.persist(); V.toast('密碼已更新'); A.sfx('star');
      });
      body.querySelector('#exportBtn').addEventListener('click', () => {
        const box = body.querySelector('#ioBox');
        box.value = S.exportJSON(this.state);
        box.select();
        try { document.execCommand('copy'); V.toast('已複製，可貼到新裝置'); } catch (e) { V.toast('請手動複製'); }
      });
      body.querySelector('#importBtn').addEventListener('click', () => {
        const box = body.querySelector('#ioBox');
        try {
          const s = S.importJSON(box.value);
          this.state = s; this.persist(); V.toast('匯入成功'); A.sfx('star'); this.renderParent();
        } catch (e) { V.toast('格式錯誤'); A.sfx('wrong'); }
      });
      body.querySelector('#resetBtn').addEventListener('click', () => {
        if (!window.confirm('確定清除全部進度？此動作無法復原。')) return;
        this.state = S.reset();
        this.persist();
        this.parentUnlocked = false;
        this.show('boot');
      });
    },

    parentUnlockFromLock() {
      const pin = window.prompt('家長密碼（預設 1234）');
      if (pin === String(this.state.settings.pin)) {
        this.state.settings.bypassDate = L.todayKey();
        this.persist();
        document.getElementById('lock').hidden = true;
        V.toast('已解除今日限制');
        A.sayCN('沒問題，再玩一下吧。');
      } else if (pin !== null) {
        V.toast('密碼不對');
      }
    }
  };

  root.PApp = PApp;
  document.addEventListener('DOMContentLoaded', () => PApp.init());
})(window);
