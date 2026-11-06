/* audio.js — 語音（Web Speech，已針對 iOS/Android 修正）＋ 音效（WebAudio，零素材）
   iOS 重點：
   1) 第一次發聲必須在使用者手勢（點擊）的同一輪事件裡 → 呼叫 prime()
   2) 不要在沒在講話時呼叫 cancel()（iOS 會整個靜音）
   3) 靜音鍵（側邊撥桿）會讓 speechSynthesis 完全沒聲音
   4) Telegram/LINE 的內建瀏覽器常常不支援語音 → 要用 Safari/Chrome 開
*/
(function (root) {
  const A = {
    voices: [], enVoice: null, zhVoice: null, ctx: null,
    enabled: true, rate: 0.85, primed: false, lastError: null, lastSpoken: '',
    _queue: [], _waiting: false, _utter: null,

    init() {
      if (typeof speechSynthesis === 'undefined') { this.lastError = 'no-speechSynthesis'; return; }
      this.pick();
      try { speechSynthesis.onvoiceschanged = () => this.pick(); } catch (e) { }
      // 任何第一次觸碰都用來「解鎖」語音（iOS 必須）
      const unlock = () => this.prime();
      ['pointerdown', 'touchstart', 'click', 'keydown'].forEach((ev) =>
        document.addEventListener(ev, unlock, { capture: true }));
    },

    pick() {
      try { this.voices = speechSynthesis.getVoices() || []; } catch (e) { this.voices = []; }
      const v = this.voices;
      this.enVoice =
        v.find((x) => /en[-_]US/i.test(x.lang) && /samantha|zira|aria|jenny|google us/i.test(x.name)) ||
        v.find((x) => /en[-_]US/i.test(x.lang)) ||
        v.find((x) => /^en/i.test(x.lang)) || null;
      this.zhVoice =
        v.find((x) => /zh[-_]TW/i.test(x.lang)) || v.find((x) => /^zh/i.test(x.lang)) || null;
      // 有聲音了就清空等待佇列
      if (this.voices.length && this._queue.length) {
        const q = this._queue.splice(0);
        q.forEach(([t, o]) => this.speak(t, o));
      }
    },

    /* 第一個手勢：解鎖音效（WebAudio）並標記已暖機。
       注意：這裡刻意不另外發聲——iOS 只允許「手勢中的第一次發聲」，
       所以我們把那次機會留給真正的句子（例如打招呼、第一個單字）。 */
    prime() {
      if (!this.primed) this.primed = true;
      this.ensureCtx();
      if (!this.voices.length) this.pick();
    },

    speak(text, opts) {
      if (!text || !this.enabled) return null;
      if (typeof speechSynthesis === 'undefined') { this.lastError = 'no-speechSynthesis'; return null; }
      const o = opts || {};
      if (!this.voices.length) this.pick();
      if (!this.voices.length) {
        // 某些瀏覽器語音清單是非同步載入 → 先排隊，載到再播
        if (!this._waiting) {
          this._waiting = true;
          setTimeout(() => { this._waiting = false; this.pick(); }, 400);
        }
        if (this._queue.length < 4) this._queue.push([text, o]);
        return null;
      }

      const speakOnce = () => {
        const u = new SpeechSynthesisUtterance(String(text));
        u.lang = o.lang || 'en-US';
        if (u.lang.indexOf('en') === 0 && this.enVoice) u.voice = this.enVoice;
        if (u.lang.indexOf('zh') === 0 && this.zhVoice) u.voice = this.zhVoice;
        u.rate = o.rate || this.rate;
        u.pitch = o.pitch || 1.15;
        u.volume = o.volume == null ? 1 : o.volume;
        u.onerror = (e) => { this.lastError = (e && e.error) || 'utterance-error'; };
        this._utter = u;
        this.lastSpoken = String(text);
        try { speechSynthesis.speak(u); } catch (e) { this.lastError = 'speak:' + e.message; }
        return u;
      };

      // 只有「正在講話」才 cancel；否則直接播（iOS 上 cancel+speak 同回合會靜音）
      const busy = (() => { try { return speechSynthesis.speaking || speechSynthesis.pending; } catch (e) { return false; } })();
      if (busy) {
        try { speechSynthesis.cancel(); } catch (e) { }
        setTimeout(speakOnce, 80);
        return null;
      }
      return speakOnce();
    },

    sayWord(word, opts) {
      const o = opts || {};
      const w = (word && word.en) || word;
      this.speak(w, o);
      if (o.double !== false) setTimeout(() => this.speak(w, o), 1150);
    },

    sayPhonics(word) {
      if (!word || !word.ph) return this.sayWord(word);
      this.speak(word.ph.sound + ', ' + word.ph.sound + ', ' + word.en, { rate: 0.7 });
    },

    say(text, opts) { return this.speak(text, opts); },

    sayCN(text) { this.speak(text, { lang: 'zh-TW', rate: 0.95, pitch: 1.1 }); },

    stop() { try { speechSynthesis.cancel(); } catch (e) { } },

    /* 給家長後台用的診斷 */
    probe() {
      const supported = typeof speechSynthesis !== 'undefined';
      let speaking = false, pending = false;
      try { speaking = !!speechSynthesis.speaking; pending = !!speechSynthesis.pending; } catch (e) { }
      return {
        supported,
        voices: this.voices.length,
        english: this.enVoice ? this.enVoice.name + ' / ' + this.enVoice.lang : null,
        chinese: this.zhVoice ? this.zhVoice.name + ' / ' + this.zhVoice.lang : null,
        primed: this.primed,
        enabled: this.enabled,
        speaking, pending,
        lastError: this.lastError,
        lastSpoken: this.lastSpoken,
        inAppBrowser: /Telegram|Line\/|FBAN|FBAV|Instagram|MicroMessenger|WeChat/i.test(navigator.userAgent || ''),
        ios: /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      };
    },

    ensureCtx() {
      if (this.ctx) return this.ctx;
      const C = root.AudioContext || root.webkitAudioContext;
      if (!C) return null;
      try { this.ctx = new C(); } catch (e) { this.ctx = null; }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },

    tone(freq, start, dur, type, gain) {
      const c = this.ensureCtx(); if (!c) return;
      const o = c.createOscillator(); const g = c.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, c.currentTime + start);
      g.gain.linearRampToValueAtTime(gain == null ? 0.16 : gain, c.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
      o.connect(g); g.connect(c.destination);
      o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.02);
    },

    sfx(kind) {
      if (!this.enabled) return;
      switch (kind) {
        case 'correct': [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, i * 0.07, 0.22, 'triangle', 0.14)); break;
        case 'wrong': this.tone(220, 0, 0.18, 'sine', 0.10); this.tone(165, 0.12, 0.2, 'sine', 0.09); break;
        case 'tap': this.tone(880, 0, 0.08, 'sine', 0.07); break;
        case 'star': [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, i * 0.05, 0.28, 'sine', 0.09)); break;
        case 'card': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, i * 0.09, 0.4, 'triangle', 0.12)); break;
        case 'coin': this.tone(1318, 0, 0.1, 'square', 0.07); this.tone(1760, 0.09, 0.14, 'square', 0.06); break;
        default: this.tone(660, 0, 0.1, 'sine', 0.08);
      }
    }
  };

  root.PAudio = A;
  if (typeof module !== 'undefined') module.exports = A;
})(typeof window !== 'undefined' ? window : globalThis);
