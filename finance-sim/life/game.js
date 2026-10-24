/* =========================================================
   人生財務模擬器 · 遊戲引擎 (v1)
   純邏輯，無 DOM。可在瀏覽器 (window.LifeGame) 或 Node 執行。
   ========================================================= */
(function (global) {
  'use strict';

  const CFG = {
    START_AGE: 18,
    END_AGE: 85,
    START_YEAR: 2026,
    INFLATION: 0.02,
    EVENT_CHANCE: 0.82   // 每年有事件的機率
  };

  /* ---------------- RNG (可重現) ---------------- */
  function rand(s) {
    s.rngState = (s.rngState + 0x6D2B79F5) | 0;
    let t = s.rngState;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rr = (s, a, b) => a + (b - a) * rand(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function pickW(s, arr) {
    let total = 0;
    for (const it of arr) total += (it.w || 1);
    let r = rand(s) * total;
    for (const it of arr) { r -= (it.w || 1); if (r <= 0) return it; }
    return arr[arr.length - 1];
  }

  /* ---------------- 基本運算 ---------------- */
  function netWorth(s) { return s.cash + s.invest + (s.house || 0) - s.debt; }
  function log(s, icon, text) {
    s.log.push({ age: s.age, year: s.year, icon, text });
    if (s.log.length > 200) s.log.shift();
  }

  /* ---------------- 角色設定 ---------------- */
  const PROFILES = {
    office: {
      id: 'office', name: '小資上班族', icon: '🧑‍💼',
      desc: '起薪普通、有學貸，一切靠自己。最貼近大多數人的開局。',
      cash: 50000, invest: 0, debt: 300000, debtPay: 3000,
      income: 0, expense: 15000, health: 85, happy: 70, risk: 0.8,
      tags: ['學貸 30 萬', '存款 5 萬']
    },
    engineer: {
      id: 'engineer', name: '理工新鮮人', icon: '👩‍💻',
      desc: '高薪但高工時，起跑快；健康與快樂是你的隱形負債。',
      cash: 120000, invest: 60000, debt: 450000, debtPay: 4000,
      income: 0, expense: 18000, health: 72, happy: 62, risk: 1.0,
      tags: ['學貸 45 萬', '已有 6 萬投資']
    },
    freelancer: {
      id: 'freelancer', name: '自由工作者', icon: '🎨',
      desc: '沒有學貸、時間自由，但收入不穩定，沒有勞保年金。',
      cash: 200000, invest: 0, debt: 0, debtPay: 0,
      income: 0, expense: 17000, health: 90, happy: 82, risk: 1.1,
      tags: ['零負債', '收入不穩']
    }
  };

  function createState(profileId, seed) {
    const p = PROFILES[profileId] || PROFILES.office;
    const s = {
      seed: (seed >>> 0) || 12345,
      rngState: (seed >>> 0) || 12345,
      profile: p.id,
      age: CFG.START_AGE,
      year: CFG.START_YEAR,
      cash: p.cash, invest: p.invest, debt: p.debt, debtPay: p.debtPay,
      house: 0,
      income: p.income, expense: p.expense,
      health: p.health, happy: p.happy, risk: p.risk,
      edu: 'none', job: '學生',
      flags: {}, done: {}, cooldown: {},
      log: [], history: [], market: null, lastYear: null,
      current: null, lastResult: '',
      ended: false, ending: null, eventCount: 0
    };
    log(s, '🎬', '人生開始。18 歲，帳戶裡有 ' + p.cash.toLocaleString() + ' 元' + (p.debt ? '，以及 ' + p.debt.toLocaleString() + ' 元學貸' : '') + '。');
    s.history.push({ age: s.age, net: netWorth(s), invest: s.invest, cash: s.cash, debt: s.debt, house: 0 });
    return s;
  }

  /* ---------------- 市場 ---------------- */
  const MARKETS = [
    { key: 'bull2', name: '大牛市', icon: '🚀', ret: 0.32, w: 14, tone: 'good' },
    { key: 'bull', name: '牛市', icon: '📈', ret: 0.15, w: 28, tone: 'good' },
    { key: 'flat', name: '盤整', icon: '➖', ret: 0.05, w: 30, tone: 'flat' },
    { key: 'corr', name: '修正', icon: '📉', ret: -0.12, w: 18, tone: 'bad' },
    { key: 'crash', name: '股災', icon: '💥', ret: -0.30, w: 10, tone: 'bad' }
  ];
  function rollMarket(s) {
    const m = pickW(s, MARKETS);
    const jitter = (rand(s) - 0.5) * 0.06;
    return { key: m.key, name: m.name, icon: m.icon, ret: m.ret + jitter, tone: m.tone };
  }

  /* ---------------- 年度結算 ---------------- */
  function settle(s) {
    const m = rollMarket(s);
    s.market = m;
    const ret = m.ret * s.risk;
    const invBefore = s.invest;
    s.invest = Math.max(0, s.invest * (1 + ret));
    const invDelta = s.invest - invBefore;

    if (s.flags.joblessUntil && s.age >= s.flags.joblessUntil) {
      s.income = Math.round((s.flags.prevIncome || 38000) * 0.92);
      s.job = '重新就業';
      delete s.flags.joblessUntil; delete s.flags.prevIncome;
    }
    if (!s.flags.retired && s.income > 0) {
      s.income *= (s.age < 50 ? 1.03 : 1.015);  // 職涯成長 + 通膨調薪
    }
    if (s.flags.pension) s.income *= 1.01;       // 年金隨通膨微調
    s.expense *= (1 + CFG.INFLATION);            // 通膨吃購買力

    const incomeY = s.income * 12;
    const expenseY = s.expense * 12;
    const debtPayY = s.debtPay * 12;
    const net = incomeY - expenseY - debtPayY;
    s.cash += net;

    if (s.debt > 0) {
      s.debt -= Math.min(s.debt, debtPayY * 0.8);
      if (s.debt < 300000) s.debt *= 1.04;   // 小額卡債高利
    }

    if (s.house) s.house *= 1 + rr(s, -0.02, 0.05);

    if (s.cash < 0) {
      s.debt += (-s.cash) * 1.08;
      s.cash = 0;
      s.flags.creditCardDebt = true;
      if (!s.flags.debtStress) { s.happy = clamp(s.happy - 4, 0, 100); s.flags.debtStress = true; }
    } else {
      s.flags.debtStress = false;
    }

    // 緊急預備金 6 個月，多的自動投入
    const buffer = s.expense * 6;
    if (s.cash > buffer) {
      const rate = s.risk >= 1.2 ? 0.9 : s.risk >= 0.85 ? 0.75 : 0.45;
      const put = (s.cash - buffer) * rate;
      s.cash -= put;
      s.invest += put;
    }

    // 現金不足 → 先賣資產，真的不夠才借錢
    if (s.cash < s.expense * 2 && s.invest > 0) {
      const need = Math.min(s.invest, s.expense * 6 - s.cash);
      if (need > 0) { s.invest -= need; s.cash += need; }
    }

    // 自然老化
    // 年輕時的恢復力
    if (s.age < 45 && s.health < 96) s.health = clamp(s.health + 2.0, 0, 100);
    else if (s.age < 55 && s.health < 94) s.health = clamp(s.health + 1.2, 0, 100);
    else if (s.age < 62 && s.health < 90) s.health = clamp(s.health + 0.5, 0, 100);
    let dec = 0;
    if (s.age >= 80) dec = 2.2; else if (s.age >= 70) dec = 1.2;
    else if (s.age >= 60) dec = 0.6; else if (s.age >= 45) dec = 0.3;
    s.health = clamp(s.health - dec, 0, 100);
    if (s.age < 55 && s.happy < 80) s.happy = clamp(s.happy + 1.1, 0, 100);
    else if (s.age < 70 && s.happy < 72) s.happy = clamp(s.happy + 0.55, 0, 100);
    else if (s.age < 82 && s.happy < 68) s.happy = clamp(s.happy + 0.35, 0, 100);
    s.happy = clamp(s.happy - 0.2, 0, 100);

    s.lastYear = {
      age: s.age, year: s.year, market: m,
      income: incomeY, expense: expenseY, debtPay: debtPayY,
      net, invDelta, invRate: ret, netWorth: netWorth(s)
    };
    s.history.push({
      age: s.age, net: netWorth(s), invest: s.invest,
      cash: s.cash, debt: s.debt, house: s.house || 0
    });
  }

  /* ---------------- 卡片工具 ---------------- */
  function toCard(s, kind, def) {
    const text = typeof def.text === 'function' ? def.text(s) : def.text;
    const raw = (typeof def.options === 'function' ? def.options(s) : def.options) || [];
    return {
      kind,
      id: def.id || kind,
      icon: typeof def.icon === 'function' ? def.icon(s) : def.icon,
      title: typeof def.title === 'function' ? def.title(s) : def.title,
      subtitle: def.subtitle || '',
      text,
      options: raw.map(o => ({
        label: o.label, sub: o.sub || '', odds: o.odds || '', tone: o.tone || '',
        _apply: o.apply
      }))
    };
  }

  /* ---------------- 主線里程碑 ---------------- */
  const MILESTONES = [
    {
      id: 'm18', age: 18, icon: '🎓', title: '第 1 章 · 18 歲：第一道岔路',
      text: '高中畢業了。家裡的期待、自己的興趣，還有帳戶裡的數字，全部擺在桌上。這個決定，會決定你未來十年的起跑線。',
      options: [
        {
          label: '讀大學（學貸 +50 萬）', sub: '四年後起薪高，但先背債', tone: 'primary',
          apply: s => {
            s.edu = 'university'; s.debt += 500000; s.debtPay += 1500;
            s.income = 12000; s.expense = 15000; s.job = '學生（打工）'; s.happy += 4;
            log(s, '🎓', '選擇讀大學，背了 50 萬學貸，開始半工半讀。');
            return '你簽下學貸，開始半工半讀。同學在玩，你在便利商店補貨。四年後，你會拿到一張比較貴的入場券。';
          }
        },
        {
          label: '技職／科大（學貸 +20 萬）', sub: '早點學一技之長', tone: '',
          apply: s => {
            s.edu = 'college'; s.debt += 200000; s.debtPay += 800;
            s.income = 15000; s.expense = 14000; s.job = '學生（實習）'; s.happy += 2;
            log(s, '🔧', '選擇技職體系，學貸 20 萬，開始實習。');
            return '你選了技職。實習有薪水，手上很快有技術，但起薪天花板要靠自己打破。';
          }
        },
        {
          label: '直接就業（0 學貸）', sub: '先賺錢，邊做邊學', tone: '',
          apply: s => {
            s.edu = 'highschool'; s.income = 26000; s.expense = 18000;
            s.job = '服務業'; s.happy -= 2;
            log(s, '💼', '不升學，直接投入職場，月薪 26,000。');
            return '你選擇先賺錢。同齡的人在校園，你在排班表。零負債，但技能與人脈要靠自己補。';
          }
        }
      ]
    },
    {
      id: 'm23', age: 23, icon: '💼', title: '第 2 章 · 23 歲：第一份正職',
      text: '畢業（或已工作幾年）。第一份正職不只看薪水，還決定你未來五年的生活節奏。',
      options: s => {
        const common = [
          {
            label: '一般企業 42,000', sub: '穩定、正常上下班', tone: '',
            apply: st => { st.income = 42000; st.job = '一般企業職員'; st.happy += 3; log(st, '💼', '進入一般企業，月薪 42,000。'); return '你進了間中規中矩的公司。薪水不高但穩定，下班還有力氣生活。'; }
          },
          {
            label: '考公職 38,000', sub: '鐵飯碗、年金穩', tone: '',
            apply: st => { st.income = 38000; st.job = '公務員'; st.happy += 6; st.flags.publicSector = true; log(st, '🏛️', '考上公職，月薪 38,000，穩定但不是賺大錢的路。'); return '你考上公職。薪水不會讓你興奮，但也不會讓你半夜驚醒。'; }
          }
        ];
        if (s.edu === 'university') {
          return [{
            label: '科技業工程師 65,000', sub: '薪水高，健康 −8', tone: 'primary',
            apply: st => { st.income = 65000; st.job = '工程師'; st.health -= 8; st.happy -= 2; log(st, '💻', '進入科技業，月薪 65,000，開始賣肝。'); return '你拿到 65,000 的 offer。錢進來了，但你的晚上與週末也一起進去了。'; }
          }].concat(common);
        }
        if (s.edu === 'college') {
          return [
            {
              label: '技術員 48,000', sub: '專業取勝', tone: 'primary',
              apply: st => { st.income = 48000; st.job = '技術員'; log(st, '🔧', '當上技術員，月薪 48,000。'); return '你的技術讓你有底氣，48,000 起薪，之後靠證照再往上。'; }
            },
            {
              label: '業務 36,000 + 獎金', sub: '浮動收入，上限高', tone: '',
              apply: st => { st.income = 36000; st.job = '業務'; st.flags.sales = true; st.happy += 5; log(st, '🤝', '轉做業務，底薪 36,000，靠獎金衝收入。'); return '你選了業務。底薪不高，但每一張單都算你的。'; }
            }
          ].concat(common);
        }
        return [
          {
            label: '技術學徒 40,000', sub: '一技之長，越老越值錢', tone: 'primary',
            apply: st => { st.income = 40000; st.job = '技術人員'; log(st, '🛠️', '成為技術人員，月薪 40,000。'); return '你跟著師傅學，40,000 起，手上功夫是別人搶不走的資產。'; }
          },
          {
            label: '小店／擺攤 45,000', sub: '收入不穩，但自由', tone: '',
            apply: st => { st.income = 45000; st.job = '自營小店'; st.flags.selfEmployed = true; st.happy += 8; st.health -= 5; log(st, '🏪', '開了小店，月收入約 45,000，但沒有勞保。'); return '你自己當老闆。忙起來沒有假日，但每一塊錢都是自己的。'; }
          },
          {
            label: '繼續服務業 32,000', sub: '先求有再求好', tone: '',
            apply: st => { st.income = 32000; st.job = '服務業'; log(st, '🍽️', '繼續服務業，月薪 32,000。'); return '你留在原地。穩定，但天花板看得見。'; }
          }
        ];
      }
    },
    {
      id: 'm28', age: 28, icon: '📈', title: '第 3 章 · 28 歲：理財啟蒙',
      text: '工作幾年了，帳戶終於有點數字。第一個一百萬，通常不是靠省，是靠「有沒有開始」。',
      options: [
        {
          label: '定期定額 ETF', sub: '風險低、睡得著', tone: 'primary',
          apply: s => { s.risk = 0.85; s.happy -= 2; log(s, '📈', '開始定期定額 ETF，選擇穩健路線。'); return '你設定每月自動扣款。市場漲你開心，跌你也不太痛——因為你沒在看盤。'; }
        },
        {
          label: '主動選股／追飆股', sub: '風險高、心跳快', tone: 'danger',
          apply: s => { s.risk = 1.4; s.happy += 6; log(s, '🎯', '開始主動選股，風險偏好拉高。'); return '你開始研究財報、追題材。波動變大，你的心情也開始跟著 K 線跳。'; }
        },
        {
          label: '先不投資，錢放活存', sub: '安全，但會被通膨吃掉', tone: '',
          apply: s => { s.risk = 0.3; s.happy += 2; log(s, '🏦', '選擇把錢放活存，先求安全感。'); return '你把錢放著。很安全，但每年 2% 的通膨正在默默收走它。'; }
        }
      ]
    },
    {
      id: 'm31', age: 31, icon: '🏠', title: '第 4 章 · 31 歲：買房或租屋',
      text: '房價又漲了一輪。頭期款、房貸、租金，三個數字在你腦中打架。',
      options: s => {
        const rent = [
          {
            label: '繼續租屋', sub: '彈性高，但租金會漲', tone: '',
            apply: st => { st.expense += 1500; st.happy -= 3; st.flags.renter = true; log(st, '🔑', '繼續租屋，租金微調。'); return '你繼續租。錢留著投資，但每次續約都覺得自己在幫房東繳房貸。'; }
          },
          {
            label: '搬到蛋白區', sub: '支出降，通勤累', tone: '',
            apply: st => { st.expense -= 5000; st.health -= 4; st.happy -= 2; log(st, '🚇', '搬到蛋白區，月支出降 5,000，通勤時間變長。'); return '你搬到遠一點的地方。房租省了，但每天多花兩小時在車上。'; }
          }
        ];
        const buy = {
          label: '買房（房貸 800 萬）', sub: '月付 3 萬，綁 30 年', tone: 'primary',
          apply: st => {
            const down = 2000000;
            if (st.cash + st.invest >= down) {
              const fromCash = Math.min(st.cash, down);
              st.cash -= fromCash;
              st.invest = Math.max(0, st.invest - (down - fromCash));
            } else {
              st.debt += (down - st.cash - st.invest) * 1.1;
              st.cash = 0; st.invest = 0;
              st.flags.borrowedDownPayment = true;
            }
            st.house = 10000000; st.debt += 8000000; st.debtPay += 30000;
            st.expense += 6000; st.flags.house = true; st.happy += 8;
            log(st, '🏠', '買下 1,000 萬的房子，房貸 800 萬，每月付 3 萬。');
            return '你簽下 30 年房貸。有了自己的家，也有了每個月 3 萬的「不能失業」。';
          }
        };
        if (!s.income) return rent;   // 沒工作，銀行不會貸給你
        return [buy].concat(rent);
      },
    },
    {
      id: 'm35', age: 35, icon: '💍', title: '第 5 章 · 35 歲：家庭',
      text: '感情走到一個階段。要不要結婚？要不要小孩？這不只是浪漫問題，是現金流問題。',
      options: [
        {
          label: '結婚 + 生小孩', sub: '支出大增，人生重心轉移', tone: 'primary',
          apply: s => {
            s.cash = Math.max(0, s.cash - 400000); s.expense += 22000;
            s.flags.married = true; s.flags.child = true; s.happy += 12;
            log(s, '👶', '結婚生子，月支出增加 22,000。');
            return '婚禮、奶粉、學區。你的存款曲線變慢了，但家裡多了兩個人的聲音。';
          }
        },
        {
          label: '結婚，不生小孩', sub: '雙薪，生活品質好', tone: '',
          apply: s => {
            s.cash = Math.max(0, s.cash - 300000); s.expense += 9000;
            s.flags.married = true; s.happy += 8;
            log(s, '💍', '結婚，雙薪無小孩，月支出增加 9,000。');
            return '你們決定當頂客族。錢變好用，但每年過年都要回答同一個問題。';
          }
        },
        {
          label: '不婚，專注自己', sub: '自由，但要自己準備老後', tone: '',
          apply: s => { s.happy += 4; s.health += 2; s.flags.single = true; log(s, '🌱', '選擇不婚，把資源留給自己。'); return '你把時間與錢留給自己。自由，但也意味著老後沒有第二個人的收入。'; }
        }
      ]
    },
    {
      id: 'm40', age: 40, icon: '🚀', title: '第 6 章 · 40 歲：職涯下半場',
      text: '同期的人開始分行。有人升遷、有人創業、有人消失。你還能再賭一次。',
      options: [
        {
          label: '跳槽 / 升遷', sub: '收入 +20%', tone: 'primary',
          apply: s => { s.income *= 1.2; s.happy += 5; s.health -= 4; log(s, '📊', '跳槽成功，收入 +20%。'); return '你帶著十年經驗跳槽，薪水一次補回來。代價是重新證明自己。'; }
        },
        {
          label: '創業', sub: '投入 100 萬，45% 機率翻倍', tone: 'danger', odds: '成功 45%',
          apply: s => {
            const stake = Math.min(1000000, s.cash + s.invest);
            const fromCash = Math.min(s.cash, stake);
            s.cash -= fromCash;
            s.invest -= (stake - fromCash);
            if (rand(s) < 0.45) {
              s.income *= 2.2; s.happy += 15; log(s, '🚀', '創業成功，收入翻倍。');
              return '訂單來了。你的收入翻了一倍多，代價是再也沒有真正的下班。';
            }
            s.income *= 0.75; s.happy -= 12; s.health -= 8; log(s, '💥', '創業失敗，投入的資金幾乎歸零。');
            return '錢燒完了，案子沒續約。你回到職場，薪水比原本更低，還帶著一身疲憊。';
          }
        },
        {
          label: '安穩留任', sub: '不冒險，守住現在', tone: '',
          apply: s => { s.happy += 3; s.health += 3; log(s, '🛋️', '選擇安穩留任，生活品質提升。'); return '你留下來。沒有戲劇性的成長，但每天六點可以回家吃飯。'; }
        }
      ]
    },
    {
      id: 'm47', age: 47, icon: '🩺', title: '第 7 章 · 47 歲：健康與保障',
      text: '健檢報告出現紅字。你第一次認真想到：如果倒下，錢夠不夠？',
      options: [
        {
          label: '買醫療＋長照險', sub: '月支出 +4,000，換取保障', tone: 'primary',
          apply: s => { s.expense += 4000; s.flags.insured = true; s.happy += 4; log(s, '🛡️', '投保醫療與長照險，月支出 +4,000。'); return '保單簽下去，每月多一筆支出，但也多了一層網子。'; }
        },
        {
          label: '不買，錢繼續投資', sub: '省下保費，自己承擔風險', tone: 'danger',
          apply: s => { s.risk = Math.min(1.5, s.risk + 0.1); s.invest += 50000; log(s, '🎲', '不投保，把保費投入市場。'); return '你把保費丟進市場。順風時你會覺得自己很聰明，直到意外發生。'; }
        },
        {
          label: '開始運動、調整作息', sub: '健康 +12', tone: '',
          apply: s => { s.expense += 1500; s.health = clamp(s.health + 12, 0, 100); s.happy += 6; log(s, '🏃', '開始規律運動，健康 +12。'); return '你開始跑步、重訓。體檢數字回來了，人也清醒了。'; }
        }
      ]
    },
    {
      id: 'm54', age: 54, icon: '🧭', title: '第 8 章 · 54 歲：中年轉型',
      text: '公司開始年輕化。你要嘛往上，要嘛往外，要嘛認命。',
      options: [
        {
          label: '考證照、轉管理職', sub: '收入 +18%', tone: 'primary',
          apply: s => { s.income *= 1.18; s.health -= 5; s.happy += 3; log(s, '📜', '考取證照轉管理職，收入 +18%。'); return '你補了證照、換了職稱。薪水上去，責任也上去。'; }
        },
        {
          label: '發展副業', sub: '月入 +15,000，健康 −8', tone: '',
          apply: s => { s.income += 15000; s.health -= 8; s.happy -= 2; log(s, '🌙', '下班後經營副業，月入 +15,000。'); return '你開始接案、開課、寫內容。多了一條現金流，少了一點睡眠。'; }
        },
        {
          label: '準時下班，守住生活', sub: '快樂 +8', tone: '',
          apply: s => { s.happy += 8; s.health += 4; log(s, '🌿', '放下升遷，選擇準時下班。'); return '你不再爭。晚上有時間煮飯、散步，薪水沒漲，日子卻變厚了。'; }
        }
      ]
    },
    {
      id: 'm60', age: 60, icon: '🏖️', title: '第 9 章 · 60 歲：退休倒數',
      text: '距離法定退休還有幾年。你的身體、你的存款、你的年金，開始要對答案了。',
      options: [
        {
          label: '提早退休', sub: '收入歸零，靠資產生活', tone: 'danger',
          apply: s => { s.income = 0; s.flags.retired = true; s.happy += 10; s.flags.earlyRetire = true; log(s, '🏖️', '60 歲提早退休，收入歸零。'); return '你遞出辭呈。第一天睡到自然醒，第三天開始算錢可以撐幾年。'; }
        },
        {
          label: '繼續做到 65', sub: '多存五年，年金也更飽', tone: 'primary',
          apply: s => { s.happy -= 4; s.health -= 3; log(s, '⏳', '決定做到 65 歲。'); return '你留下來。多五年薪水，也少五年自由。'; }
        },
        {
          label: '轉兼職 / 顧問', sub: '收入 40%，時間自由', tone: '',
          apply: s => { s.income *= 0.4; s.flags.partTime = true; s.happy += 8; s.health += 3; log(s, '🧑‍🏫', '轉兼職顧問，收入剩 40%，時間變自由。'); return '你把工時砍半，收入也砍半。換到的是每天早上不用趕打卡。'; }
        }
      ]
    },
    {
      id: 'm65', age: 65, icon: '👵', title: '第 10 章 · 65 歲：正式退休',
      text: '退休申請書放在桌上。勞保年金、資產提領、還是繼續接案？',
      options: s => {
        const opts = [
          {
            label: '申請勞保年金 25,000/月', sub: '穩定現金流', tone: 'primary',
            apply: st => { st.income = 25000; st.flags.retired = true; st.flags.pension = true; st.happy += 5; log(st, '🏛️', '開始領勞保年金，每月 25,000。'); return '每月 25,000 準時進帳。不多，但你不必看市場臉色吃飯。'; }
          },
          {
            label: '完全靠資產生活', sub: '提領 4% 法則', tone: '',
            apply: st => { st.income = 0; st.flags.retired = true; st.happy += 3; log(st, '💼', '不領年金，完全靠資產提領生活。'); return '你決定靠自己的投資。自由，但每年都要跟市場對賭一次。'; }
          },
          {
            label: '繼續接案 20,000/月', sub: '半退休', tone: '',
            apply: st => { st.income = 20000; st.flags.retired = true; st.flags.partTime = true; st.happy += 6; log(st, '💻', '半退休，每月接案 20,000。'); return '你沒完全退。每週工作兩天，既保持腦力，也保持收入。'; }
          }
        ];
        if (s.profile === 'freelancer' || s.flags.selfEmployed) {
          opts[0].label = '申請勞保年金 18,000/月（自營者年資短）';
          opts[0].apply = st => { st.income = 18000; st.flags.retired = true; st.flags.pension = true; st.happy += 3; log(st, '🏛️', '自營者年金較少，每月 18,000。'); return '你的勞保年資斷斷續續，年金只有 18,000。年輕時的自由，帳單現在來了。'; };
        }
        return opts;
      }
    },
    {
      id: 'm75', age: 75, icon: '🕯️', title: '第 11 章 · 75 歲：晚年安排',
      text: '膝蓋開始抗議，朋友一個個離開。最後一段路，你打算怎麼走？',
      options: [
        {
          label: '入住養生村', sub: '月支出 +35,000，生活有品質', tone: 'primary',
          apply: s => { s.expense += 35000; s.happy += 10; s.health += 3; s.flags.careHome = true; log(s, '🏡', '入住養生村，月支出 +35,000。'); return '你搬進有醫療站與同伴的養生村。錢花得多，但每天有人陪你吃飯。'; }
        },
        {
          label: '靠子女照顧', sub: '省錢，但看人臉色', tone: '',
          apply: s => { s.flags.relyOnKids = true; s.happy -= 6; log(s, '👨‍👩‍👧', '選擇依靠子女照顧。'); return '你搬去跟孩子住。省下看護費，卻也開始小心翼翼。'; }
        },
        {
          label: '獨居自理', sub: '自由，風險自負', tone: 'danger',
          apply: s => { s.health -= 10; s.happy += 3; log(s, '🚪', '選擇獨居自理，健康 −10。'); return '你留在自己的房子裡。自由，但每一次跌倒都沒有人知道。'; }
        }
      ]
    }
  ];

  /* ---------------- 隨機事件 ---------------- */
  const EVENTS = [
    {
      id: 'promotion', icon: '📈', title: '升遷的機會', weight: 9,
      cond: s => s.income > 0 && s.age >= 24 && s.age <= 55,
      text: '主管把你叫進會議室：「這個位置，我想給你。但你要有心理準備，接下來一年會很硬。」',
      options: [
        { label: '接下來', sub: '收入 +12%，健康 −6', tone: 'primary', apply: s => { s.income *= 1.12; s.health -= 6; s.happy += 6; log(s, '📈', '升遷成功，收入 +12%。'); return '你接了。名片換了，工時也換了。'; } },
        { label: '婉拒，先顧生活', sub: '健康 +4', tone: '', apply: s => { s.health += 4; s.happy -= 2; log(s, '🙅', '婉拒升遷，保住生活品質。'); return '你說謝謝再聯絡。同事覺得你傻，你覺得自己終於睡得好。'; } }
      ]
    },
    {
      id: 'raise', icon: '💰', title: '調薪', weight: 11,
      cond: s => s.income > 0 && s.age <= 58,
      text: '年度考核結束，人資寄來一封信。',
      options: [
        { label: '打開信', sub: '收入 +6%', apply: s => { s.income *= 1.06; s.happy += 3; log(s, '💰', '調薪 6%。'); return '加薪 6%。不多，但比沒有好。'; } }
      ]
    },
    {
      id: 'layoff', icon: '📉', title: '裁員名單', weight: 4,
      cond: s => s.income > 0 && s.age >= 24 && s.age <= 58,
      text: '景氣轉冷，公司宣布組織調整。你的名字在名單上。',
      options: [
        { label: '拿資遣費，重新找', sub: '收入暫時歸零', tone: 'danger', apply: s => { const sev = s.income * 0.5; s.cash += sev; s.income *= 0.72; s.happy -= 12; s.health -= 3; log(s, '📉', '被裁員，領資遣費後降薪再就業。'); return '你收下資遣費。三個月後找到新工作，薪水少了將近三成。'; } },
        { label: '先休息，考證照', sub: '一年沒收入，但可能翻身', tone: '', apply: s => { s.cash += s.income * 0.5; s.flags.prevIncome = s.income; s.income = 0; s.flags.joblessUntil = s.age + 1; s.job = '待業進修'; s.happy += 4; log(s, '📚', '被裁員後決定先休息、考證照（一年）。'); return '你把這段時間拿去上課。存款在減少，但方向變清楚了。'; } }
      ]
    },
    {
      id: 'headhunt', icon: '🎯', title: '獵頭來電', weight: 5,
      cond: s => s.age >= 27 && s.age <= 50 && s.income > 0,
      text: '獵頭說有一份工作，薪水多 18%，但要常出差。',
      options: [
        { label: '談談看', sub: '收入 +18%，健康 −5', tone: 'primary', apply: s => { s.income *= 1.18; s.health -= 5; s.happy += 4; log(s, '🎯', '接受獵頭機會，收入 +18%。'); return '你跳過去了。薪水變好，行李箱也變重。'; } },
        { label: '謝謝，不用了', sub: '', apply: s => { s.happy += 2; return '你掛掉電話。現在的工作沒那麼刺激，但也不用一直收行李。'; } }
      ]
    },
    {
      id: 'overtime', icon: '🌙', title: '加班文化', weight: 8,
      cond: s => s.income > 0 && s.age <= 50,
      text: '專案又延期。主管希望這週「大家一起撐一下」。',
      options: [
        { label: '配合加班', sub: '收入 +8%，健康 −10', tone: 'danger', apply: s => { s.income *= 1.08; s.health -= 10; s.happy -= 5; log(s, '🌙', '連續加班，收入 +8%，健康 −10。'); return '你連續三週十一點下班。錢多了，眼睛也乾了。'; } },
        { label: '準時走', sub: '快樂 +3', apply: s => { s.happy += 3; s.flags.notTeamPlayer = true; return '你準時打卡。有人不高興，但你的晚餐是熱的。'; } }
      ]
    },
    {
      id: 'sidehustle', icon: '🛠️', title: '副業機會', weight: 6,
      cond: s => s.age >= 25 && s.age <= 52,
      text: '朋友找你一起接案，每月大約多 8,000，但要用晚上的時間。',
      options: [
        { label: '接', sub: '月收入 +8,000，健康 −5', tone: 'primary', apply: s => { s.income += 8000; s.health -= 5; log(s, '🛠️', '開始副業，月收入 +8,000。'); return '你的晚上變成一張工作桌。錢多了，睡眠少了。'; } },
        { label: '不接，陪家人', sub: '快樂 +5', apply: s => { s.happy += 5; return '你說這陣子想留給家裡。少賺一點，多睡一點。'; } }
      ]
    },
    {
      id: 'startup', icon: '🚀', title: '創業邀約', weight: 3,
      cond: s => s.age >= 28 && s.age <= 45,
      text: '前同事要你一起創業，需要投入 30 萬，成功的話收入會翻倍。',
      options: [
        { label: '投入 30 萬', sub: '成功率 40%', tone: 'danger', odds: '成功 40%', apply: s => { s.cash = Math.max(0, s.cash - 300000); if (rand(s) < 0.4) { s.income *= 1.8; s.happy += 12; log(s, '🚀', '創業小成，收入大增。'); return '產品找到市場，收入跳了一階。'; } s.happy -= 10; s.health -= 6; s.flags.startupFail = true; log(s, '💥', '創業失敗，30 萬歸零。'); return '兩年後收攤。30 萬買到一個很貴的經驗。'; } },
        { label: '不參與', sub: '', apply: s => { return '你婉拒了。後來聽說他們做得不錯，你心裡有點酸，但生活照過。'; } }
      ]
    },
    {
      id: 'crashpanic', icon: '💥', title: '市場崩盤', weight: 6,
      cond: s => s.invest > 150000,
      text: '新聞全是壞消息，你的投資組合一個月跌了兩成。群組裡有人喊「這次不一樣」。',
      options: [
        { label: '全部停損', sub: '鎖住虧損，睡得著', tone: '', apply: s => { s.invest *= 0.82; s.happy -= 3; log(s, '✂️', '股災中停損出場，鎖住虧損。'); return '你按下賣出。心痛，但至少不用再每天看盤。'; } },
        { label: '續抱甚至加碼', sub: '50% 反彈 / 50% 續跌', tone: 'danger', odds: '50 / 50', apply: s => { if (rand(s) < 0.5) { s.invest *= 1.18; s.happy += 6; log(s, '📈', '撐過股災，反彈 +18%。'); return '三個月後市場回來。你慶幸自己沒跑。'; } s.invest *= 0.88; s.happy -= 8; log(s, '🩸', '股災續跌，資產再縮水。'); return '跌勢沒完。你才知道「這次不一樣」有時候是真的。'; } }
      ]
    },
    {
      id: 'scam', icon: '🕳️', title: '高報酬投資群組', weight: 4,
      cond: s => s.age >= 25 && s.cash > 100000,
      text: '朋友的朋友拉你進群組：「年化 30%，保證回本，名額有限。」',
      options: [
        { label: '先投 20 萬試水溫', sub: '92% 血本無歸', tone: 'danger', odds: '騙局 92%', apply: s => { s.cash -= 200000; if (rand(s) < 0.08) { s.cash += 300000; s.happy += 8; log(s, '🍀', '意外地拿到高報酬（幸運）。'); return '錢真的回來了，還多了。你很心動，但這次先停手。'; } s.happy -= 12; log(s, '🕳️', '投資詐騙，20 萬蒸發。'); return '群組某天消失了。你報警，警察說這種案子每年幾千件。'; } },
        { label: '直接退出群組', sub: '', apply: s => { return '你退群。半年後新聞報導那家公司被抄。'; } }
      ]
    },
    {
      id: 'leverage', icon: '🎰', title: '槓桿誘惑', weight: 4,
      cond: s => s.age >= 22 && s.age <= 45,
      text: '有人教你用融資開槓桿：「本金 50 萬可以當 200 萬用。」',
      options: [
        { label: '開下去', sub: '大賺或大賠', tone: 'danger', odds: '45% 大賺', apply: s => { if (rand(s) < 0.45) { s.cash += 400000; s.happy += 10; log(s, '🎰', '槓桿交易大賺 40 萬。'); return '你賺了一筆。這種感覺最危險，因為你會想再來一次。'; } s.cash = Math.max(0, s.cash - 350000); s.debt += 150000; s.happy -= 15; log(s, '💀', '槓桿爆倉，倒賠 15 萬。'); return '一根長黑 K，你的保證金歸零，還欠券商錢。'; } },
        { label: '不碰', sub: '', apply: s => { s.happy += 2; return '你沒開。後來聽說那位「老師」人間蒸發。'; } }
      ]
    },
    {
      id: 'car', icon: '🚗', title: '買車', weight: 5,
      cond: s => !s.flags.car && s.age >= 24 && s.age <= 48,
      text: '通勤很累，你開始看車。業務說：「這台貸款很輕鬆。」',
      options: [
        { label: '買新車 80 萬', sub: '貸款 + 保險 + 折舊', tone: 'danger', apply: s => { s.cash = Math.max(0, s.cash - 200000); s.debt += 600000; s.debtPay += 10000; s.expense += 4000; s.flags.car = true; s.happy += 8; log(s, '🚗', '貸款買新車，月付增加。'); return '你開著新車回家，聞著皮椅的味道。三年後它只剩一半的價值。'; } },
        { label: '買二手車 25 萬', sub: '務實', tone: 'primary', apply: s => { s.cash = Math.max(0, s.cash - 250000); s.expense += 2500; s.flags.car = true; s.happy += 5; log(s, '🚙', '買二手車，支出增加 2,500/月。'); return '你買了台狀況不錯的中古車。不帥，但能動。'; } },
        { label: '繼續搭捷運', sub: '', apply: s => { s.health += 2; return '你繼續搭捷運。多走的路，剛好當運動。'; } }
      ]
    },
    {
      id: 'travel', icon: '✈️', title: '出國旅行', weight: 7,
      cond: s => s.age >= 22,
      text: '機票在特價。你已經三年沒出國了。',
      options: [
        { label: '刷下去，8 萬', sub: '快樂 +10', tone: '', apply: s => { s.cash = Math.max(0, s.cash - 80000); s.happy += 10; log(s, '✈️', '出國旅行，花 8 萬，快樂 +10。'); return '你在異地的街上走著，突然覺得人生還有很多可能。'; } },
        { label: '把錢留下來', sub: '', apply: s => { return '你關掉訂房網站。有點可惜，但帳戶數字讓你安心。'; } }
      ]
    },
    {
      id: 'gadget', icon: '📱', title: '手機壞了', weight: 8,
      cond: s => true,
      text: '手機螢幕摔裂，電池也撐不住了。',
      options: [
        { label: '換新旗艦 40,000', sub: '', tone: '', apply: s => { s.cash = Math.max(0, s.cash - 40000); s.happy += 3; log(s, '📱', '換新手機，花 40,000。'); return '新手機很順，但帳單讓你有點痛。'; } },
        { label: '修一修 3,500', sub: '', apply: s => { s.cash = Math.max(0, s.cash - 3500); log(s, '🔧', '修手機，花 3,500。'); return '螢幕換新，再戰兩年。'; } }
      ]
    },
    {
      id: 'luxury', icon: '👜', title: '犒賞自己', weight: 5,
      cond: s => s.age >= 25,
      text: '這個月很累。你滑到一個很想買的東西。',
      options: [
        { label: '買，30,000', sub: '快樂 +6', apply: s => { s.cash = Math.max(0, s.cash - 30000); s.happy += 6; log(s, '👜', '衝動購物 30,000。'); return '你買了。開心三天，之後就習慣了。'; } },
        { label: '放進願望清單', sub: '', apply: s => { s.happy += 1; return '你放進清單。兩週後發現自己其實沒那麼想要。'; } }
      ]
    },
    {
      id: 'gym', icon: '🏋️', title: '健身房', weight: 5,
      cond: s => s.age >= 22 && s.age <= 60,
      text: '樓下開了健身房，教練在發體驗券。',
      options: [
        { label: '簽一年', sub: '月支出 +1,500，健康 +8', tone: 'primary', apply: s => { s.expense += 1500; s.health = clamp(s.health + 8, 0, 100); log(s, '🏋️', '開始健身，健康 +8。'); return '前兩週很痛苦，第三週開始上癮。'; } },
        { label: '算了', sub: '', apply: s => { return '你拿了體驗券，沒去。'; } }
      ]
    },
    {
      id: 'checkup', icon: '🩺', title: '健康檢查', weight: 6,
      cond: s => s.age >= 35,
      text: '公司安排了健檢，報告上有一個紅字。',
      options: [
        { label: '進一步檢查 12,000', sub: '早期發現', tone: 'primary', apply: s => { s.cash = Math.max(0, s.cash - 12000); s.health += 4; log(s, '🩺', '自費進一步檢查，及早處理。'); return '發現得早，處理得早。醫生說再晚兩年就麻煩了。'; } },
        { label: '先放著，之後再說', sub: '健康 −8', tone: 'danger', apply: s => { s.health -= 8; s.flags.ignoredCheckup = true; log(s, '⚠️', '忽略健檢紅字，健康 −8。'); return '你把報告塞進抽屜。它會一直在那裡。'; } }
      ]
    },
    {
      id: 'allnighter', icon: '🌃', title: '熬夜', weight: 6,
      cond: s => s.age <= 45 && s.income > 0,
      text: '晚上十一點，還有一份簡報沒做完。',
      options: [
        { label: '熬到三點', sub: '健康 −7', apply: s => { s.health -= 7; s.happy -= 2; log(s, '🌃', '熬夜趕工，健康 −7。'); return '你交出簡報，也交出半條命。'; } },
        { label: '明天早起再做', sub: '', apply: s => { s.health += 1; return '你關上電腦。世界沒有因此毁灭。'; } }
      ]
    },
    {
      id: 'accident', icon: '🚑', title: '意外', weight: 2,
      cond: s => true,
      text: '下雨天，你被一輛機車擦撞。',
      options: [
        { label: '就醫', sub: '醫療費 + 健康 −10', apply: s => { s.cash = Math.max(0, s.cash - 45000); s.health -= 10; log(s, '🚑', '意外受傷，醫療費 45,000。'); return '還好只是骨裂。醫藥費四萬五，復健三個月。'; } }
      ]
    },
    {
      id: 'illness', icon: '🏥', title: '重大疾病', weight: s => (s.age >= 45 ? 3 : 1),
      cond: s => s.age >= 40,
      text: '身體出現狀況，醫生說需要開刀與長期治療。',
      options: [
        { label: '面對治療', sub: '高額醫療費', tone: 'danger', apply: s => {
          const cost = 800000;
          if (s.flags.insured) { s.cash = Math.max(0, s.cash - 150000); s.health -= 12; log(s, '🛡️', '重大疾病，保險理賠後自付 15 萬。'); return '保險幫你擋下大部分。你第一次覺得保費沒白繳。'; }
          s.cash = Math.max(0, s.cash - cost); s.debt += 300000; s.health -= 20; s.happy -= 10;
          log(s, '🏥', '重大疾病，醫療費 80 萬，還得借錢。');
          return '80 萬的帳單。存款清空，還跟家人借了錢。';
        } }
      ]
    },
    {
      id: 'mental', icon: '🫂', title: '心理低潮', weight: 4,
      cond: s => s.age >= 25,
      text: '你最近什麼都不想做，連最喜歡的事也提不起勁。',
      options: [
        { label: '尋求專業協助', sub: '花 15,000，快樂 +12', tone: 'primary', apply: s => { s.cash = Math.max(0, s.cash - 15000); s.happy += 12; s.health += 3; log(s, '🫂', '接受心理諮商，快樂 +12。'); return '你走進諮商室。說出來之後，肩膀輕了一點。'; } },
        { label: '撐著', sub: '快樂 −8', apply: s => { s.happy -= 8; log(s, '🌧️', '硬撐低潮，快樂 −8。'); return '你什麼都沒說，繼續上班。'; } }
      ]
    },
    {
      id: 'parentcare', icon: '👵', title: '父母需要照顧', weight: 4, once: true,
      cond: s => s.age >= 45,
      text: '媽媽跌倒住院，出院後需要有人照顧。',
      options: [
        { label: '請看護 35,000/月', sub: '月支出大增', tone: '', apply: s => { s.expense += 35000; s.happy += 2; log(s, '👵', '請看護照顧父母，月支出 +35,000。'); return '你請了看護。錢包很痛，但至少安心。'; } },
        { label: '自己扛', sub: '健康 −12，快樂 −8', tone: 'danger', apply: s => { s.health -= 12; s.happy -= 8; log(s, '😮‍💨', '自己照顧父母，健康與快樂下滑。'); return '你白天上班、晚上跑醫院。蠟燭兩頭燒。'; } },
        { label: '安排機構', sub: '月支出 +20,000', apply: s => { s.expense += 20000; s.happy -= 2; log(s, '🏥', '安排父母入住機構，月支出 +20,000。'); return '你找了評價不錯的機構。每次探視，心裡都有點酸。'; } }
      ]
    },
    {
      id: 'inheritance', icon: '📜', title: '長輩的心意', weight: 2, once: true,
      cond: s => s.age >= 55,
      text: '長輩走了。留下一筆錢與一間老房子。',
      options: [
        { label: '收下', sub: '+150 萬', tone: 'primary', apply: s => { s.cash += 1500000; s.happy -= 3; log(s, '📜', '繼承 150 萬，心情複雜。'); return '錢進帳了。你寧願這筆錢不要來。'; } }
      ]
    },
    {
      id: 'friend', icon: '🤝', title: '朋友借錢', weight: 5,
      cond: s => s.cash > 100000,
      text: '好朋友開口借 5 萬，說下個月還。',
      options: [
        { label: '借', sub: '30% 拿得回來', tone: '', odds: '還錢 30%', apply: s => { s.cash -= 50000; if (rand(s) < 0.3) { s.cash += 50000; s.happy += 3; log(s, '🤝', '借朋友的錢拿回來了。'); return '他真的還了，你們的友情還在。'; } s.happy -= 5; log(s, '💸', '借朋友的 5 萬拿不回來。'); return '下個月變成下一年，然後就沒有然後了。'; } },
        { label: '說不方便', sub: '', apply: s => { s.happy -= 2; return '你說最近手頭緊。氣氛有點尷尬。'; } }
      ]
    },
    {
      id: 'lottery', icon: '🍀', title: '小確幸', weight: 3,
      cond: s => true,
      text: '發票中獎／尾牙抽到現金。',
      options: [
        { label: '收下', sub: '+20,000', apply: s => { s.cash += 20000; s.happy += 6; log(s, '🍀', '意外之財 20,000。'); return '兩萬塊。不多，但足夠讓你這週心情很好。'; } }
      ]
    },
    {
      id: 'bonus', icon: '🧧', title: '年終獎金', weight: 10,
      cond: s => s.income > 0,
      text: '公司公布年終。',
      options: [
        { label: '入帳', sub: '約 1.5 個月', apply: s => { const amt = s.income * 1.5; s.cash += amt; s.happy += 4; log(s, '🧧', '年終獎金 ' + Math.round(amt).toLocaleString() + '。'); return '年終 1.5 個月，比預期好一點。'; } }
      ]
    },
    {
      id: 'inflation', icon: '🔥', title: '通膨升溫', weight: 3,
      cond: s => true,
      text: '物價明顯上漲，便當從 90 變 120。',
      options: [
        { label: '縮減開支', sub: '快樂 −5，支出成長趨緩', apply: s => { s.expense *= 0.97; s.happy -= 5; log(s, '🔥', '通膨來襲，開始縮減開支。'); return '你開始記帳、少外食。生活變緊，但還過得去。'; } },
        { label: '照原本過', sub: '支出上升', apply: s => { s.expense *= 1.05; log(s, '🔥', '不調整生活，支出被通膨推高。'); return '你不想為了錢委屈自己。代價是每月多花幾千。'; } }
      ]
    },
    {
      id: 'renthike', icon: '🔑', title: '房東漲租', weight: 6,
      cond: s => !s.flags.house && s.age <= 55,
      text: '房東傳訊息：「附近行情都漲了，明年開始調整。」',
      options: [
        { label: '接受', sub: '月支出 +3,000', apply: s => { s.expense += 3000; log(s, '🔑', '接受漲租，月支出 +3,000。'); return '你摸摸鼻子續約。搬家太麻煩了。'; } },
        { label: '搬家', sub: '一次性 2 萬，之後省一點', apply: s => { s.cash = Math.max(0, s.cash - 20000); s.expense -= 1000; s.happy -= 3; log(s, '📦', '搬家省租金，花 2 萬搬家費。'); return '你搬了。東西比想像中多，回憶也是。'; } }
      ]
    },
    {
      id: 'houseboom', icon: '🏘️', title: '房市大漲', weight: 5,
      cond: s => s.flags.house,
      text: '隔壁成交價創新高。你的房子帳面增值不少。',
      options: [
        { label: '增貸投資', sub: '資產活化，風險提高', tone: 'danger', apply: s => { s.debt += 2000000; s.invest += 2000000; s.debtPay += 8000; s.risk = Math.min(1.5, s.risk + 0.2); log(s, '🏘️', '房屋增貸 200 萬投入市場。'); return '你把房子的漲幅借出來，壓進市場。順風時很爽，逆風時很可怕。'; } },
        { label: '不動，繼續住', sub: '', apply: s => { s.happy += 2; return '你看著實價登錄，心裡舒服，但什麼都沒做。'; } }
      ]
    },
    {
      id: 'childedu', icon: '🎒', title: '子女教育費', weight: 4,
      cond: s => s.flags.child && s.age >= 44 && s.age <= 58,
      text: '孩子要上高中了。私立、公立、還是出國？',
      options: [
        { label: '私立／補習全開', sub: '月支出 +15,000', tone: 'primary', apply: s => { s.expense += 15000; s.happy += 5; log(s, '🎒', '讓孩子讀私立，月支出 +15,000。'); return '你咬牙付了。孩子的成績單變成你的月報表。'; } },
        { label: '公立，順其自然', sub: '', apply: s => { s.happy += 2; return '你選了公立。孩子開心，你也鬆一口氣。'; } },
        { label: '送出國', sub: '一次 300 萬', tone: 'danger', apply: s => { s.cash = Math.max(0, s.cash - 3000000); s.happy += 8; log(s, '🌍', '送孩子出國，花 300 萬。'); return '你送孩子上飛機。存款少一大塊，但他看到的世界變大了。'; } }
      ]
    },
    {
      id: 'divorce', icon: '💔', title: '婚姻裂痕', weight: 2,
      cond: s => s.flags.married && !s.flags.divorced && s.age >= 30,
      text: '你們已經很久沒有好好說話了。',
      options: [
        { label: '努力修補', sub: '快樂 +5，但要花時間', apply: s => { s.happy += 5; s.health -= 3; log(s, '💞', '決定努力修補婚姻。'); return '你們去諮商、去旅行。有些傷口慢慢癒合。'; } },
        { label: '離婚', sub: '資產 −40%', tone: 'danger', apply: s => { s.cash *= 0.6; s.invest *= 0.6; s.house *= 0.6; s.flags.divorced = true; s.happy -= 15; log(s, '💔', '離婚，資產縮水 40%。'); return '簽字那天，你覺得又自由又空。'; } }
      ]
    },
    {
      id: 'burglary', icon: '🕵️', title: '被騙 / 被偷', weight: 2,
      cond: s => true,
      text: '你接到一通電話，說你的帳戶有異常交易。',
      options: [
        { label: '照指示操作', sub: '70% 被騙', tone: 'danger', odds: '被騙 70%', apply: s => { if (rand(s) < 0.7) { const loss = Math.min(s.cash, 80000); s.cash -= loss; s.happy -= 8; log(s, '🕵️', '電話詐騙，損失 ' + Math.round(loss).toLocaleString() + '。'); return '你照著操作，錢被轉走。銀行說這是「你自己授權的」。'; } return '你覺得怪怪的，掛掉電話。'; } },
        { label: '掛掉，打 165', sub: '', apply: s => { s.happy += 1; return '你掛掉並求證。果然是詐騙。'; } }
      ]
    },
    {
      id: 'crypto', icon: '₿', title: '幣圈暴富夢', weight: 4,
      cond: s => s.age >= 22 && s.age <= 50,
      text: '群組裡有人貼對帳單：三個月賺了五倍。',
      options: [
        { label: '投入 15 萬', sub: '25% 暴賺 / 75% 歸零', tone: 'danger', odds: '暴賺 25%', apply: s => { s.cash = Math.max(0, s.cash - 150000); if (rand(s) < 0.25) { s.cash += 600000; s.happy += 12; log(s, '₿', '幣圈獲利 45 萬。'); return '你賣在相對高點。這次是真的，但你知道運氣佔了多少。'; } s.happy -= 10; log(s, '🪙', '幣圈投資歸零 15 萬。'); return '幣價腰斬再腰斬。你的 15 萬變成 1 萬。'; } },
        { label: '只買一點點 2 萬', sub: '小賭怡情', apply: s => { s.cash = Math.max(0, s.cash - 20000); if (rand(s) < 0.35) { s.cash += 60000; } log(s, '🪙', '小額參與幣圈。'); return '你買了一點點。漲跌都不影響生活。'; } }
      ]
    },
    {
      id: 'donate', icon: '❤️', title: '捐款', weight: 3,
      cond: s => s.age >= 30,
      text: '你看到一個偏鄉兒童的課輔計畫，還差一點經費。',
      options: [
        { label: '捐 50,000', sub: '快樂 +10', tone: 'primary', apply: s => { s.cash = Math.max(0, s.cash - 50000); s.happy += 10; s.flags.donated = true; log(s, '❤️', '捐款 50,000 給偏鄉課輔。'); return '錢出去了，心裡卻滿了一塊。'; } },
        { label: '下次吧', sub: '', apply: s => { return '你按下「稍後再說」。'; } }
      ]
    },
    {
      id: 'rentout', icon: '🏠', title: '出租空房', weight: 3,
      cond: s => s.flags.house,
      text: '家裡有一間空房，有人想租。',
      options: [
        { label: '出租', sub: '月收入 +8,000', apply: s => { s.income += 8000; s.happy -= 2; log(s, '🏠', '出租空房，月收入 +8,000。'); return '每月多八千，也多了一個要協調的室友。'; } },
        { label: '留著自己用', sub: '', apply: s => { s.happy += 2; return '你把空房改成書房。'; } }
      ]
    },
    {
      id: 'medbill', icon: '🦷', title: '牙齒／小手術', weight: 6,
      cond: s => true,
      text: '牙齒痛到睡不著，醫生說要植牙。',
      options: [
        { label: '植牙 80,000', sub: '', apply: s => { s.cash = Math.max(0, s.cash - 80000); s.health += 2; log(s, '🦷', '植牙花 80,000。'); return '你付了錢。至少可以好好吃東西了。'; } },
        { label: '先止痛', sub: '健康 −3', apply: s => { s.cash = Math.max(0, s.cash - 3000); s.health -= 3; log(s, '🦷', '只做止痛處理。'); return '你決定再撐一下。痛的還會再來。'; } }
      ]
    }
  ];

  /* ---------------- 平靜的一年 ---------------- */
  const CALM_TEXTS = [
    '這一年沒有大事。上班、下班、放假、再上班。存款緩慢地往上。',
    '日子過得很平。你規律運動、按時繳費，市場沒給你驚喜，也沒給你驚嚇。',
    '沒什麼特別的一年。你開始懷疑「穩定」是不是另一種停滯。',
    '這一年你哪裡都沒去，什麼都沒買。帳戶數字悄悄變好看。',
    '平凡的一年。你看了幾部劇、辭掉一個不想去的聚會。'
  ];

  /* ---------------- 結局 ---------------- */
  function computeEnding(s, reason) {
    const annual = Math.max(1, s.expense * 12);
    const nw = netWorth(s);
    const ratio = nw / annual;
    let key, icon, title, desc, tone;

    if (reason === 'broke' || nw < 0) {
      key = 'broke'; icon = '💀'; title = '債務深淵'; tone = 'bad';
      desc = '你活到了最後，但帳戶是負的。負債跟著你進了老年，利息比你賺得快。';
    } else if (s.health <= 0) {
      key = 'health'; icon = '🕯️'; title = '提早謝幕'; tone = 'bad';
      desc = '錢還在，但你沒有力氣花了。健康是唯一不能貸款的資產。';
    } else if (ratio >= 30 && s.health >= 40 && s.happy >= 45) {
      key = 'fire'; icon = '🏆'; title = '財富自由 · FIRE'; tone = 'good';
      desc = '你的資產足以支撐 25 年以上的生活。時間終於回到你手上。';
    } else if (ratio >= 30) {
      key = 'rich_lonely'; icon = '💰'; title = '富有的孤獨'; tone = 'neutral';
      desc = '你的帳戶很漂亮，但生活裡沒有人陪你一起吃晚餐。';
    } else if (ratio >= 12) {
      key = 'stable'; icon = '🌾'; title = '安穩退休'; tone = 'good';
      desc = '不算富裕，但你不必看誰的臉色。這已經是很多人到不了的終點。';
    } else if (ratio >= 5) {
      key = 'tight'; icon = '🚲'; title = '緊繃的小康'; tone = 'neutral';
      desc = '你撐住了，但每一年都要重新計算。退休不是終點，是另一種節省。';
    } else if (s.flags.pension) {
      key = 'pension'; icon = '🏛️'; title = '靠年金過日子'; tone = 'neutral';
      desc = '沒有資產，但年金讓你活了下來。你的老年，是一張每月入帳的通知單。';
    } else {
      key = 'forever'; icon = '😮‍💨'; title = '活到老，做到老'; tone = 'bad';
      desc = '你沒有存夠。七十幾歲還在接電話、排班、看時薪。';
    }

    const finScore = clamp(ratio / 30 * 100, 0, 100);
    const score = Math.round(finScore * 0.5 + clamp(s.health, 0, 100) * 0.3 + clamp(s.happy, 0, 100) * 0.2);
    const rank = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : 'D';

    return {
      kind: 'ending', id: 'ending',
      icon, title, subtitle: '人 生 結 算',
      text: desc,
      key, tone, score, rank,
      ratio: Math.round(ratio * 10) / 10,
      finalNetWorth: Math.round(nw),
      finScore: Math.round(finScore),
      options: []
    };
  }

  /* ---------------- 流程 ---------------- */
  function pickCard(s) {
    const ms = MILESTONES.find(m => m.age === s.age && !s.done[m.id]);
    if (ms) { s.done[ms.id] = true; return toCard(s, 'milestone', ms); }

    if (rand(s) < CFG.EVENT_CHANCE) {
      const pool = [];
      for (const e of EVENTS) {
        if (e.once && s.flags['ev_' + e.id]) continue;
        if (e.minAge && s.age < e.minAge) continue;
        if (e.maxAge && s.age > e.maxAge) continue;
        if (s.cooldown[e.id] && s.age - s.cooldown[e.id] < 6) continue;
        if (e.cond && !e.cond(s)) continue;
        const w = typeof e.weight === 'function' ? e.weight(s) : (e.weight || 1);
        pool.push({ e, w });
      }
      if (pool.length) {
        const chosen = pickW(s, pool).e;
        s.cooldown[chosen.id] = s.age;
        if (chosen.once) s.flags['ev_' + chosen.id] = true;
        s.eventCount++;
        return toCard(s, 'event', chosen);
      }
    }

    const def = {
      id: 'calm', icon: '🌤️', title: '平靜的一年',
      text: CALM_TEXTS[Math.floor(rand(s) * CALM_TEXTS.length)],
      options: [{ label: '繼續', apply: () => '' }]
    };
    return toCard(s, 'calm', def);
  }

  function startGame(s) {
    s.current = pickCard(s);
    return s.current;
  }

  // 讀檔後回到「這一年」的開頭，不重複結算
  function resume(s) {
    s.current = pickCard(s);
    return s.current;
  }

  function resolve(s, idx) {
    const card = s.current;
    if (!card) return '';
    const opt = card.options[idx];
    let result = '';
    const hpBefore = s.health, joyBefore = s.happy;
    if (opt && typeof opt._apply === 'function') {
      try { result = opt._apply(s) || ''; } catch (e) { result = ''; }
    }
    // 緩衝：單次健康/快樂打擊最多 -14，避免一次事件就致命
    if (s.health < hpBefore) s.health = Math.max(hpBefore - 14, hpBefore + (s.health - hpBefore) * 0.6);
    if (s.happy < joyBefore) s.happy = Math.max(joyBefore - 14, joyBefore + (s.happy - joyBefore) * 0.8);
    s.current = null;
    s.lastResult = result;
    s.health = clamp(s.health, 0, 100);
    s.happy = clamp(s.happy, 0, 100);
    s.debt = Math.max(0, s.debt);
    s.cash = Math.max(0, s.cash);
    return result;
  }

  function advance(s) {
    if (s.ended) return s.current;

    s.age++;
    s.year++;

    if (s.health <= 0) return finish(s, 'health');
    if (s.age > CFG.END_AGE) return finish(s, 'finish');

    settle(s);

    if (netWorth(s) < -2000000 && s.cash < 100000 && s.invest < 300000 && s.income * 12 < s.expense * 12 * 1.2) return finish(s, 'broke');
    if (s.health <= 0) return finish(s, 'health');

    s.current = pickCard(s);
    return s.current;
  }

  function finish(s, reason) {
    s.ended = true;
    s.ending = computeEnding(s, reason);
    s.current = s.ending;
    log(s, s.ending.icon, '人生結算：' + s.ending.title);
    return s.current;
  }

  /* ---------------- 匯出 ---------------- */
  const API = {
    CFG, PROFILES, MILESTONES, EVENTS, MARKETS,
    createState, startGame, resolve, advance, resume, netWorth, computeEnding
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.LifeGame = API;

})(typeof window !== 'undefined' ? window : globalThis);
