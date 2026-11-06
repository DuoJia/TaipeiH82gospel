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
    INFLATION: 0.02,         // 生活費通膨
    RENT_INFLATION: 0.02,    // 租金長期年漲 2%
    FIRE_RATIO: 28,          // 約 3.6% 提領率（比 4% 法則保守）
    EVENT_CHANCE: 0.82,      // 每年有事件的機率
    EVENT_COOLDOWN: 10,      // 同一事件最短間隔（年）
    EVENT_MAX: 1             // 同一事件一生最多幾次（可用 max 覆寫）
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
  // 花錢：現金不足就轉卡債（有成本，不讓大筆支出變免費）
  function spend(s, amt) {
    s.cash -= amt;
    // 真的撐不住 → 賣房還債（現實中很多人這樣做）
    if (s.cash < 0 && s.house && s.debt > 3000000) {
      const sale = s.house * 0.96;
      s.cash += sale;
      s.house = 0; s.flags.house = false; s.flags.soldHouse = true;
      s.debt = Math.max(0, s.debt - s.cash);
      s.cash = Math.max(0, s.cash - s.debt);
      if (s.debt > 0) s.debt = 0;
      s.rent = Math.max(s.rent, Math.round(s.income * 0.3));
      s.happy = clamp(s.happy - 15, 0, 100);
      log(s, '🏚️', '現金見底，只能賣掉房子還債，重新租屋。');
    }

    if (s.cash < 0) {
      s.debt += (-s.cash) * 1.08;
      s.cash = 0;
      s.flags.creditCardDebt = true;
    }
  }

  // 本息平均攤還：月付金
  function pmt(principal, annualRate, years) {
    const r = annualRate / 12, n = years * 12;
    if (r === 0) return principal / n;
    return principal * r / (1 - Math.pow(1 + r, -n));
  }

  function netWorth(s) { return s.cash + s.invest + (s.house || 0) - s.debt; }
  function log(s, icon, text) {
    s.log.push({ age: s.age, year: s.year, icon, text });
    if (s.log.length > 200) s.log.shift();
  }

  /* ---------------- 狀態判讀 ---------------- */
  // 有「工作收入」才算在職：學生打工、退休年金、待業都不算
  function isEmployed(s) {
    if (s.flags.retired) return false;
    if (s.flags.joblessUntil) return false;
    if (s.income <= 0) return false;
    if (/學生/.test(s.job || '')) return false;
    return true;
  }
  function annualExpense(s) { return (s.expense + s.debtPay) * 12; }
  function rentBurden(s) {
    if (!s.income) return 0;
    return (s.rent || 0) / s.income;
  }
  function savingsRate(s) {
    if (!s.income) return -1;
    return (s.income - s.expense - s.debtPay) / s.income;
  }
  // 健康上限隨年齡下修 → 不可能靠「回血」一直滿血
  function healthCeiling(s) { return clamp(99 - s.age * 0.28, 58, 99); }
  // 快樂基準線：錢、健康、關係、居住壓力
  function happyBaseline(s) {
    let base = 58;
    const sr = savingsRate(s);
    if (sr > 0.2) base += 6; else if (sr > 0.05) base += 2; else if (sr < -0.05) base -= 6;
    if (rentBurden(s) > 0.45) base -= 4;
    if (s.debt > s.income * 24) base -= 4;
    if (s.flags.married && !s.flags.divorced) base += 5;
    if (s.flags.child) base += 3;
    if (s.flags.house) base += 3;
    if (s.flags.pension) base += 4;      // 年金帶來的安全感
    if (s.health < 40) base -= 10; else if (s.health < 60) base -= 4;
    return clamp(base, 12, 88);
  }

  /* ---------------- 角色設定 ---------------- */
  const PROFILES = {
    office: {
      id: 'office', name: '小資上班族', icon: '🧑‍💼',
      desc: '起薪普通、有學貸，一切靠自己。最貼近大多數人的開局。',
      cash: 50000, invest: 0, debt: 300000, debtPay: 3000,
      living: 7000, rent: 0,
      income: 0, health: 85, happy: 70, risk: 0.8,
      tags: ['學貸 30 萬', '存款 5 萬']
    },
    engineer: {
      id: 'engineer', name: '理工新鮮人', icon: '👩‍💻',
      desc: '高薪但高工時，起跑快；健康與快樂是你的隱形負債。',
      cash: 120000, invest: 60000, debt: 450000, debtPay: 4000,
      living: 8000, rent: 0,
      income: 0, health: 72, happy: 62, risk: 1.0,
      tags: ['學貸 45 萬', '已有 6 萬投資']
    },
    freelancer: {
      id: 'freelancer', name: '自由工作者', icon: '🎨',
      desc: '沒有學貸、時間自由，但收入不穩定，沒有勞保年金。',
      cash: 200000, invest: 0, debt: 0, debtPay: 0,
      living: 8500, rent: 0,
      income: 0, health: 90, happy: 82, risk: 1.1,
      tags: ['零負債', '收入不穩']
    }
  };

  function setSalaryBase(s, factor) {
    s.baseIncome = s.income;
    s.incomeCeil = Math.round(s.income * (factor || 2.2));
  }

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
      income: p.income, living: p.living, rent: p.rent,
      expense: p.living + p.rent, pension: 0,
      health: p.health, happy: p.happy, risk: p.risk,
      edu: 'none', job: '學生',
      flags: {}, done: {}, cooldown: {}, evCount: {},
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
    { key: 'bull2', name: '大牛市', icon: '🚀', ret: 0.24, w: 14, tone: 'good' },
    { key: 'bull', name: '牛市', icon: '📈', ret: 0.12, w: 28, tone: 'good' },
    { key: 'flat', name: '盤整', icon: '➖', ret: 0.04, w: 30, tone: 'flat' },
    { key: 'corr', name: '修正', icon: '📉', ret: -0.10, w: 18, tone: 'bad' },
    { key: 'crash', name: '股災', icon: '💥', ret: -0.26, w: 10, tone: 'bad' }
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
    const ret = m.ret * s.risk - 0.004;   // 內扣費用／交易成本
    const invBefore = s.invest;
    s.invest = Math.max(0, s.invest * (1 + ret));
    const invDelta = s.invest - invBefore;

    // 待業結束 → 重返職場
    if (s.flags.joblessUntil && s.age >= s.flags.joblessUntil) {
      s.income = Math.round((s.flags.prevIncome || 38000) * 0.9);
      s.job = '重新就業';
      delete s.flags.joblessUntil; delete s.flags.prevIncome;
    }

    // 薪資成長：有天花板、會停滯、也會被景氣拖累
    if (isEmployed(s)) {
      let g;
      if (s.age < 28) g = 0.028;
      else if (s.age < 38) g = 0.020;
      else if (s.age < 48) g = 0.012;
      else if (s.age < 56) g = 0.006;
      else g = 0.002;
      if (s.flags.careerStall) g -= 0.010;        // 長期不爭取／婉拒加班 → 升遷落後
      if (s.flags.highPerformer) g += 0.004;
      g += (rand(s) - 0.5) * 0.03;                // 景氣＋考績波動（可能負成長）
      s.income = Math.max(26400, s.income * (1 + g));  // 最低工資地板
      if (s.incomeCeil && s.income > s.incomeCeil) s.income = s.incomeCeil;  // 職涯天花板
    }

    // 退休：薪水歸零，年金另外算（年金調幅落後物價）
    if (s.flags.retired) {
      if (!s.flags.partTimeWork) s.income = 0;
      if (s.flags.pension) s.pension *= 1 + CFG.INFLATION * 0.9;   // 年金依 CPI 調整
    }

    // 支出：生活費與租金分開漲，50 歲後醫療通膨更凶
    s.living *= 1 + CFG.INFLATION + (s.age >= 50 ? 0.006 : 0);
    s.rent *= 1 + CFG.RENT_INFLATION;
    s.expense = s.living + s.rent;

    const incomeY = (s.income + s.pension) * 12;
    const expenseY = s.expense * 12;
    const debtPayY = s.debtPay * 12;
    const net = incomeY - expenseY - debtPayY;
    s.cash += net;

    if (s.debt > 0) {
      s.debt -= Math.min(s.debt, debtPayY * 0.8);
      if (s.flags.creditCardDebt && s.debt < 300000) s.debt *= 1.05;   // 卡債循環利息
    }

    // 退休時換小房／搬到便宜一點的地方（台灣常見）
    if (s.flags.retired && !s.flags.retireDownsized) {
      s.rent *= 0.8; s.living *= 0.85; s.expense = s.living + s.rent;
      s.flags.retireDownsized = true;
      if (s.rent > 0) log(s, '🏘️', '退休後換了間小一點的房子，租金降 15%。');
    }

    // 連續入不敷出 → 被迫降級生活（搬家、縮減外食）
    if (net < 0 && !s.flags.retired) {
      s.flags.deficitYears = (s.flags.deficitYears || 0) + 1;
      if (s.flags.deficitYears >= 2) {
        s.rent *= 0.85; s.living *= 0.9; s.expense = s.living + s.rent;
        s.happy = clamp(s.happy - 4, 0, 100);
        log(s, '📉', '連續兩年入不敷出，只能縮減生活：搬家、少外食。');
        s.flags.deficitYears = 0;
      }
    } else if (net >= 0) {
      s.flags.deficitYears = 0;
    }

    if (s.house) s.house *= 1 + rr(s, -0.02, 0.03);

    if (s.cash < 0) {
      s.debt += (-s.cash) * 1.08;
      s.cash = 0;
      s.flags.creditCardDebt = true;
      if (!s.flags.debtStress) { s.happy = clamp(s.happy - 5, 0, 100); s.flags.debtStress = true; }
    } else {
      s.flags.debtStress = false;
    }

    // 緊急預備金 6 個月，多的才投入市場
    const buffer = Math.max(s.expense * 6, 60000);
    if (s.cash > buffer) {
      const rate = s.risk >= 1.2 ? 0.9 : s.risk >= 0.85 ? 0.7 : 0.4;
      const put = (s.cash - buffer) * rate;
      s.cash -= put;
      s.invest += put;
    }

    // 現金不足 → 先賣資產
    if (s.cash < s.expense * 2 && s.invest > 0) {
      const need = Math.min(s.invest, s.expense * 6 - s.cash);
      if (need > 0) { s.invest -= need; s.cash += need; }
    }

    // 退休後：資產提領（先現金、後投資）
    if (s.flags.retired && s.cash < s.expense * 3 && s.invest > 0) {
      const need = Math.min(s.invest, s.expense * 24 - s.cash);
      if (need > 0) { s.invest -= need; s.cash += need; }
    }

    // 健康：年齡衰減為主，生活型態只能減緩
    let decay;
    if (s.age < 30) decay = 0.05;
    else if (s.age < 40) decay = 0.10;
    else if (s.age < 50) decay = 0.20;
    else if (s.age < 60) decay = 0.40;
    else if (s.age < 70) decay = 0.70;
    else if (s.age < 80) decay = 1.10;
    else decay = 1.80;
    if (s.flags.stressed) decay += 0.9;        // 長期加班／高壓（一次性，隔年清除）
    if (s.flags.exercises) decay -= 0.5;
    s.health -= decay;
    if (s.flags.exercises) s.health += 0.6;
    s.health = Math.min(s.health, healthCeiling(s));
    s.health = clamp(s.health, 0, 100);
    delete s.flags.stressed;

    // 快樂：向基準線回歸（不再有免費回血）
    const hb = happyBaseline(s);
    s.happy = clamp(s.happy + (hb - s.happy) * 0.35 + (rand(s) - 0.5) * 5, 0, 100);

    s.lastYear = {
      age: s.age, year: s.year, market: m,
      income: s.income * 12, pension: s.pension * 12, rent: s.rent * 12,
      expense: expenseY, debtPay: debtPayY,
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
            s.income = 12000; s.living = 7500; s.rent = 0; s.expense = s.living; s.job = '學生（打工）'; s.happy += 4;
            log(s, '🎓', '選擇讀大學，背了 50 萬學貸，開始半工半讀。');
            return '你簽下學貸，開始半工半讀。同學在玩，你在便利商店補貨。四年後，你會拿到一張比較貴的入場券。';
          }
        },
        {
          label: '技職／科大（學貸 +20 萬）', sub: '早點學一技之長', tone: '',
          apply: s => {
            s.edu = 'college'; s.debt += 200000; s.debtPay += 800;
            s.income = 15000; s.living = 7000; s.rent = 0; s.expense = s.living; s.job = '學生（實習）'; s.happy += 2;
            log(s, '🔧', '選擇技職體系，學貸 20 萬，開始實習。');
            return '你選了技職。實習有薪水，手上很快有技術，但起薪天花板要靠自己打破。';
          }
        },
        {
          label: '直接就業（0 學貸）', sub: '先賺錢，邊做邊學', tone: '',
          apply: s => {
            s.edu = 'highschool'; s.income = 26000; s.living = 8000; s.rent = 0; s.expense = s.living; setSalaryBase(s, 1.9);
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
            apply: st => { st.income = 42000; st.job = '一般企業職員'; st.living = 14000; st.expense = st.living + st.rent; setSalaryBase(st, 2.4); st.happy += 3; log(st, '💼', '進入一般企業，月薪 42,000。'); return '你進了間中規中矩的公司。薪水不高但穩定，下班還有力氣生活。'; }
          },
          {
            label: '考公職 38,000', sub: '鐵飯碗、年金穩', tone: '',
            apply: st => { st.income = 38000; st.job = '公務員'; st.living = 13500; st.expense = st.living + st.rent; setSalaryBase(st, 2.0); st.happy += 6; st.flags.publicSector = true; log(st, '🏛️', '考上公職，月薪 38,000，穩定但不是賺大錢的路。'); return '你考上公職。薪水不會讓你興奮，但也不會讓你半夜驚醒。'; }
          }
        ];
        if (s.edu === 'university') {
          return [{
            label: '科技業工程師 65,000', sub: '薪水高，健康 −8', tone: 'primary',
            apply: st => { st.income = 65000; st.job = '工程師'; st.living = 15500; st.expense = st.living + st.rent; setSalaryBase(st, 2.2); st.health -= 8; st.happy -= 2; log(st, '💻', '進入科技業，月薪 65,000，開始賣肝。'); return '你拿到 65,000 的 offer。錢進來了，但你的晚上與週末也一起進去了。'; }
          }].concat(common);
        }
        if (s.edu === 'college') {
          return [
            {
              label: '技術員 48,000', sub: '專業取勝', tone: 'primary',
              apply: st => { st.income = 48000; st.job = '技術員'; st.living = 14000; st.expense = st.living + st.rent; setSalaryBase(st, 2.1); log(st, '🔧', '當上技術員，月薪 48,000。'); return '你的技術讓你有底氣，48,000 起薪，之後靠證照再往上。'; }
            },
            {
              label: '業務 36,000 + 獎金', sub: '浮動收入，上限高', tone: '',
              apply: st => { st.income = 36000; st.job = '業務'; st.living = 14000; st.expense = st.living + st.rent; setSalaryBase(st, 2.6); st.flags.sales = true; st.happy += 5; log(st, '🤝', '轉做業務，底薪 36,000，靠獎金衝收入。'); return '你選了業務。底薪不高，但每一張單都算你的。'; }
            }
          ].concat(common);
        }
        return [
          {
            label: '技術學徒 40,000', sub: '一技之長，越老越值錢', tone: 'primary',
            apply: st => { st.income = 40000; st.job = '技術人員'; st.living = 13000; st.expense = st.living + st.rent; setSalaryBase(st, 2.0); log(st, '🛠️', '成為技術人員，月薪 40,000。'); return '你跟著師傅學，40,000 起，手上功夫是別人搶不走的資產。'; }
          },
          {
            label: '小店／擺攤 45,000', sub: '收入不穩，但自由', tone: '',
            apply: st => { st.income = 45000; st.job = '自營小店'; st.living = 13500; st.expense = st.living + st.rent; setSalaryBase(st, 1.8); st.flags.selfEmployed = true; st.happy += 8; st.health -= 5; log(st, '🏪', '開了小店，月收入約 45,000，但沒有勞保。'); return '你自己當老闆。忙起來沒有假日，但每一塊錢都是自己的。'; }
          },
          {
            label: '繼續服務業 32,000', sub: '先求有再求好', tone: '',
            apply: st => { st.income = 32000; st.job = '服務業'; st.living = 13000; st.expense = st.living + st.rent; setSalaryBase(st, 1.7); log(st, '🍽️', '繼續服務業，月薪 32,000。'); return '你留在原地。穩定，但天花板看得見。'; }
          }
        ];
      }
    },
    {
      id: 'm24', age: 24, icon: '🔑', title: '第 2.5 章 · 24 歲：住哪裡',
      text: '工作穩定了，接下來是每個台北上班族最痛的一筆：房租。住在哪裡，會直接決定你每月能存下多少。',
      options: s => {
        const base = Math.max(26000, s.income || 0);
        const pct = v => Math.round(v / base * 100);
        return [
          {
            label: '台北市套房 18,000/月', sub: '通勤 10 分鐘，租金 = 薪水 ' + pct(18000) + '%', tone: 'primary',
            apply: st => {
              st.rent = 18000; st.expense = st.living + st.rent; st.happy += 4; st.flags.cityRent = true;
              log(st, '🔑', '租下台北市套房，月租 18,000（約薪水 ' + pct(18000) + '%）。');
              return '你簽了租約。房間不大，但捷運站在樓下。每月一號，房東的轉帳提醒永遠比薪水早到。';
            }
          },
          {
            label: '新北分租 11,000/月', sub: '每天通勤 2 小時，健康 −3', tone: '',
            apply: st => {
              st.rent = 11000; st.living += 1500; st.expense = st.living + st.rent;
              st.health -= 3; st.happy -= 2; st.flags.commuter = true;
              log(st, '🚇', '搬到新北分租，月租 11,000，通勤時間變長。');
              return '房租省了五千五，代價是每天在捷運上站兩小時。你開始懷念有座位的日子。';
            }
          },
          {
            label: '住家裡 0 元', sub: '省最多，但自由 −8', tone: '',
            apply: st => {
              st.rent = 0; st.expense = st.living; st.happy -= 8; st.flags.liveWithParents = true;
              log(st, '🏠', '繼續住家裡，省下房租，但生活被管。');
              return '你不用付房租。但每次晚回家、每次交往對象，都會變成家裡的話題。';
            }
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
      text: '房價又漲了一輪。台北市 1,500 萬、蛋白區 1,000 萬，頭期款、房貸、租金三個數字在你腦中打架。',
      options: s => {
        const rentOpts = [
          {
            label: '繼續租屋', sub: '房東明年再漲 8%', tone: '',
            apply: st => {
              st.rent *= 1.08; st.expense = st.living + st.rent; st.happy -= 3; st.flags.rentedForever = true;
              log(st, '🔑', '繼續租屋，租金調漲 8% 至 ' + Math.round(st.rent).toLocaleString() + '/月。');
              return '你續約了。租金又上去一格，但你告訴自己：錢留著投資更划算。';
            }
          },
          {
            label: '搬到更遠的蛋白區', sub: '租金降 30%，健康 −4', tone: '',
            apply: st => {
              st.rent *= 0.7; st.living += 2000; st.expense = st.living + st.rent;
              st.health -= 4; st.happy -= 4; st.flags.commuter = true;
              log(st, '🚇', '搬到更遠的蛋白區，租金降 30%，通勤時間再拉長。');
              return '你搬得更遠了。租金鬆了一口氣，人生每天少兩小時。';
            }
          }
        ];
        const mkBuy = (price, downPct, label, sub, extra) => ({
          label, sub, tone: 'primary',
          apply: st => {
            const down = Math.round(price * downPct);
            const loan = price - down;
            if (st.cash + st.invest >= down) {
              const fromCash = Math.min(st.cash, down);
              st.cash -= fromCash;
              st.invest = Math.max(0, st.invest - (down - fromCash));
            } else {
              st.debt += (down - st.cash - st.invest) * 1.1;
              st.cash = 0; st.invest = 0; st.flags.borrowedDownPayment = true;
            }
            const pay = Math.round(pmt(loan, 0.022, 30));
            st.house = price; st.debt += loan; st.debtPay += pay;
            st.rent = 0; st.living += 3000; st.expense = st.living + st.rent;
            st.flags.house = true; st.happy += 6;
            if (extra) extra(st);
            log(st, '🏠', '買下 ' + (price / 10000) + ' 萬的房子，自備 ' + (down / 10000) + ' 萬，房貸月付 ' + pay.toLocaleString() + '。');
            return '你簽下 30 年房貸，每月 ' + pay.toLocaleString() + ' 元。有了自己的家，也有了不能失業的理由。';
          }
        });
        if (!isEmployed(s) && !(s.cash + s.invest > 3000000)) return rentOpts;
        return [
          mkBuy(15000000, 0.2, '買台北市 1,500 萬', '自備 300 萬，月付約 4.6 萬'),
          mkBuy(10000000, 0.2, '買蛋白區 1,000 萬', '自備 200 萬，月付約 3 萬；通勤更久', st => { st.health -= 3; }),
        ].concat(rentOpts);
      }
    },
    {
      id: 'm35', age: 35, icon: '💍', title: '第 5 章 · 35 歲：家庭',
      text: '感情走到一個階段。要不要結婚？要不要小孩？這不只是浪漫問題，是現金流問題。',
      options: [
        {
          label: '結婚 + 生小孩', sub: '支出大增，人生重心轉移', tone: 'primary',
          apply: s => {
            spend(s, 400000); s.expense += 22000;
            s.flags.married = true; s.flags.child = true; s.happy += 12;
            log(s, '👶', '結婚生子，月支出增加 22,000。');
            return '婚禮、奶粉、學區。你的存款曲線變慢了，但家裡多了兩個人的聲音。';
          }
        },
        {
          label: '結婚，不生小孩', sub: '雙薪，生活品質好', tone: '',
          apply: s => {
            spend(s, 300000); s.expense += 9000;
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
          apply: s => { s.expense += 1500; s.flags.exercises = true; s.health = Math.min(healthCeiling(s), s.health + 12); s.happy += 6; log(s, '🏃', '開始規律運動，健康 +12，之後老化較慢。'); return '你開始跑步、重訓。體檢數字回來了，人也清醒了。'; }
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
      options: s => {
        const early = {
          label: '提早退休', sub: '收入歸零，靠資產生活', tone: 'danger',
          apply: st => { st.income = 0; st.flags.retired = true; st.happy += 10; st.flags.earlyRetire = true; log(st, '🏖️', '60 歲提早退休，收入歸零。'); return '你遞出辭呈。第一天睡到自然醒，第三天開始算錢可以撐幾年。'; }
        };
        const keep = {
          label: '繼續做到 65', sub: '多存五年，年金也更飽', tone: 'primary',
          apply: st => { st.happy -= 4; st.health -= 3; st.flags.stressed = true; log(st, '⏳', '決定做到 65 歲。'); return '你留下來。多五年薪水，也少五年自由。'; }
        };
        const part = {
          label: '轉兼職 / 顧問', sub: '收入 40%，時間自由', tone: '',
          apply: st => { st.income *= 0.4; st.flags.partTime = true; st.flags.partTimeWork = true; st.happy += 8; st.health += 3; log(st, '🧑‍🏫', '轉兼職顧問，收入剩 40%，時間變自由。'); return '你把工時砍半，收入也砍半。換到的是每天早上不用趕打卡。'; }
        };
        if (!isEmployed(s)) {
          return [{
            label: '已經沒工作了，先想辦法活下去', sub: '體力活／補助', tone: 'danger',
            apply: st => { st.income = Math.max(st.income, 15000); st.job = '臨時工'; st.health -= 6; st.happy -= 6; log(st, '🧰', '60 歲還得接臨時工，月入 15,000。'); return '你沒能退休。六十歲，還在找工作。'; }
          }];
        }
        return [early, keep, part];
      }
    },
    {
      id: 'm65', age: 65, icon: '👵', title: '第 10 章 · 65 歲：正式退休',
      text: '退休申請書放在桌上。勞保年金、資產提領、還是繼續接案？',
      options: s => {
        const opts = [
          {
            label: '申請勞保年金 24,000/月（勞保＋勞退）', sub: '穩定現金流', tone: 'primary',
            apply: st => { st.income = 0; st.pension = 24000; st.flags.retired = true; st.flags.pension = true; st.happy += 5; log(st, '🏛️', '開始領勞保年金，每月 25,000。'); return '每月 24,000 準時進帳。不多，但你不必看市場臉色吃飯。'; }
          },
          {
            label: '完全靠資產生活', sub: '提領 4% 法則', tone: '',
            apply: st => { st.income = 0; st.flags.retired = true; st.happy += 3; log(st, '💼', '不領年金，完全靠資產提領生活。'); return '你決定靠自己的投資。自由，但每年都要跟市場對賭一次。'; }
          },
          {
            label: '繼續接案 20,000/月', sub: '半退休', tone: '',
            apply: st => { st.income = 20000; st.flags.retired = true; st.flags.partTimeWork = true; st.flags.partTime = true; st.happy += 6; log(st, '💻', '半退休，每月接案 20,000。'); return '你沒完全退。每週工作兩天，既保持腦力，也保持收入。'; }
          }
        ];
        if (s.profile === 'freelancer' || s.flags.selfEmployed) {
          opts[0].label = '申請勞保年金 15,000/月（自營者年資短）';
          opts[0].apply = st => { st.income = 0; st.pension = 15000; st.flags.retired = true; st.flags.pension = true; st.happy += 3; log(st, '🏛️', '自營者年金較少，每月 15,000。'); return '你的勞保年資斷斷續續，年金只有 15,000。年輕時的自由，帳單現在來了。'; };
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
      cond: s => isEmployed(s) && s.age >= 24 && s.age <= 52,
      text: '主管把你叫進會議室：「這個位置，我想給你。但你要有心理準備，接下來一年會很硬。」',
      options: [
        { label: '接下來', sub: '收入 +10%，健康 −6，長期高壓', tone: 'primary', apply: s => { s.income *= 1.10; s.health -= 6; s.happy += 4; s.flags.stressed = true; s.flags.highPerformer = true; log(s, '📈', '升遷成功，收入 +10%，但壓力變大。'); return '你接了。名片換了，工時也換了。'; } },
        { label: '婉拒，先顧生活', sub: '健康 +4；升遷速度從此落後', tone: '', apply: s => { s.health = Math.min(healthCeiling(s), s.health + 4); s.happy += 2; s.flags.careerStall = true; log(s, '🙅', '婉拒升遷，保住生活品質，但職涯放慢。'); return '你說謝謝再聯絡。同事覺得你傻，你覺得自己終於睡得好。'; } }
      ]
    },
    {
      id: 'raise', icon: '💰', title: '調薪', max: 3, weight: 11,
      cond: s => isEmployed(s) && s.age <= 56,
      text: '年度考核結束，人資寄來一封信。',
      options: [
        { label: '打開信', sub: '收入 +8%', apply: s => { s.income *= 1.08; s.happy += 3; s.flags.highPerformer = true; log(s, '💰', '調薪 8%。'); return '加薪 8%。不多，但比沒有好。'; } }
      ]
    },
    {
      id: 'layoff', icon: '📉', title: '裁員名單', weight: 4,
      cond: s => isEmployed(s) && s.age >= 23 && s.age <= 58,
      text: '景氣轉冷，公司宣布組織調整。你的名字在名單上。',
      options: [
        { label: '拿資遣費，重新找', sub: '收入暫時歸零', tone: 'danger', apply: s => { const sev = s.income * 0.5; s.cash += sev; s.income *= 0.72; s.happy -= 12; s.health -= 3; log(s, '📉', '被裁員，領資遣費後降薪再就業。'); return '你收下資遣費。三個月後找到新工作，薪水少了將近三成。'; } },
        { label: '先休息，考證照', sub: '一年沒收入，但可能翻身', tone: '', apply: s => { s.cash += s.income * 0.5; s.flags.prevIncome = s.income; s.income = 0; s.flags.joblessUntil = s.age + 1; s.job = '待業進修'; s.happy += 4; log(s, '📚', '被裁員後決定先休息、考證照（一年）。'); return '你把這段時間拿去上課。存款在減少，但方向變清楚了。'; } }
      ]
    },
    {
      id: 'headhunt', icon: '🎯', title: '獵頭來電', weight: 5,
      cond: s => isEmployed(s) && s.age >= 26 && s.age <= 50,
      text: '獵頭說有一份工作，薪水多 18%，但要常出差。',
      options: [
        { label: '談談看', sub: '收入 +15%，健康 −5，長期出差', tone: 'primary', apply: s => { s.income *= 1.15; s.health -= 5; s.happy += 3; s.flags.stressed = true; log(s, '🎯', '接受獵頭機會，收入 +15%。'); return '你跳過去了。薪水變好，行李箱也變重。'; } },
        { label: '謝謝，不用了', sub: '', apply: s => { s.happy += 2; return '你掛掉電話。現在的工作沒那麼刺激，但也不用一直收行李。'; } }
      ]
    },
    {
      id: 'overtime', icon: '🌙', title: '加班文化', max: 6, weight: 8,
      cond: s => isEmployed(s) && s.age <= 50,
      text: '專案又延期。主管希望這週「大家一起撐一下」。',
      options: [
        { label: '配合加班', sub: '收入 +6%，健康 −10，隔年持續耗損', tone: 'danger', apply: s => { s.income *= 1.06; s.health -= 10; s.happy -= 5; s.flags.stressed = true; log(s, '🌙', '連續加班，收入 +6%，健康 −10。'); return '你連續三週十一點下班。錢多了，眼睛也乾了。'; } },
        { label: '準時走', sub: '快樂 +3；考績與升遷受影響', apply: s => { s.happy += 3; s.flags.careerStall = true; return '你準時打卡。有人不高興，你的晚餐是熱的，但明年調薪只有 2%。'; } }
      ]
    },
    {
      id: 'sidehustle', icon: '🛠️', title: '副業機會', weight: 6,
      cond: s => s.age >= 25 && s.age <= 52 && !s.flags.retired,
      text: '朋友找你一起接案，每月大約多 8,000，但要用晚上的時間。',
      options: [
        { label: '接', sub: '月收入 +8,000，健康 −5', tone: 'primary', apply: s => { s.income += 8000; s.health -= 5; log(s, '🛠️', '開始副業，月收入 +8,000。'); return '你的晚上變成一張工作桌。錢多了，睡眠少了。'; } },
        { label: '不接，陪家人', sub: '快樂 +5', apply: s => { s.happy += 5; return '你說這陣子想留給家裡。少賺一點，多睡一點。'; } }
      ]
    },
    {
      id: 'startup', icon: '🚀', title: '創業邀約', weight: 3,
      cond: s => s.age >= 28 && s.age <= 45 && (s.cash + s.invest) >= 300000,
      text: '前同事要你一起創業，需要投入 30 萬，成功的話收入會翻倍。',
      options: [
        { label: '投入 30 萬', sub: '成功率 40%', tone: 'danger', odds: '成功 40%', apply: s => { spend(s, 300000); if (rand(s) < 0.4) { s.income *= 1.8; s.happy += 12; log(s, '🚀', '創業小成，收入大增。'); return '產品找到市場，收入跳了一階。'; } s.happy -= 10; s.health -= 6; s.flags.startupFail = true; log(s, '💥', '創業失敗，30 萬歸零。'); return '兩年後收攤。30 萬買到一個很貴的經驗。'; } },
        { label: '不參與', sub: '', apply: s => { return '你婉拒了。後來聽說他們做得不錯，你心裡有點酸，但生活照過。'; } }
      ]
    },
    {
      id: 'crashpanic', icon: '💥', title: '市場崩盤', max: 2, weight: 6,
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
        { label: '先投 20 萬試水溫', sub: '92% 血本無歸', tone: 'danger', odds: '騙局 92%', apply: s => { spend(s, 200000); if (rand(s) < 0.08) { s.cash += 300000; s.happy += 8; log(s, '🍀', '意外地拿到高報酬（幸運）。'); return '錢真的回來了，還多了。你很心動，但這次先停手。'; } s.happy -= 12; log(s, '🕳️', '投資詐騙，20 萬蒸發。'); return '群組某天消失了。你報警，警察說這種案子每年幾千件。'; } },
        { label: '直接退出群組', sub: '', apply: s => { return '你退群。半年後新聞報導那家公司被抄。'; } }
      ]
    },
    {
      id: 'leverage', icon: '🎰', title: '槓桿誘惑', weight: 4,
      cond: s => s.age >= 22 && s.age <= 45,
      text: '有人教你用融資開槓桿：「本金 50 萬可以當 200 萬用。」',
      options: [
        { label: '開下去', sub: '大賺或大賠', tone: 'danger', odds: '45% 大賺', apply: s => { if (rand(s) < 0.45) { s.cash += 400000; s.happy += 10; log(s, '🎰', '槓桿交易大賺 40 萬。'); return '你賺了一筆。這種感覺最危險，因為你會想再來一次。'; } spend(s, 350000); s.debt += 150000; s.happy -= 15; log(s, '💀', '槓桿爆倉，倒賠 15 萬。'); return '一根長黑 K，你的保證金歸零，還欠券商錢。'; } },
        { label: '不碰', sub: '', apply: s => { s.happy += 2; return '你沒開。後來聽說那位「老師」人間蒸發。'; } }
      ]
    },
    {
      id: 'car', icon: '🚗', title: '買車', weight: 5,
      cond: s => !s.flags.car && s.age >= 24 && isEmployed(s),
      text: '通勤很累，你開始看車。業務說：「這台貸款很輕鬆。」',
      options: [
        { label: '買新車 80 萬', sub: '貸款 + 保險 + 折舊', tone: 'danger', apply: s => { spend(s, 200000); s.debt += 600000; s.debtPay += 10000; s.expense += 4000; s.flags.car = true; s.happy += 8; log(s, '🚗', '貸款買新車，月付增加。'); return '你開著新車回家，聞著皮椅的味道。三年後它只剩一半的價值。'; } },
        { label: '買二手車 25 萬', sub: '務實', tone: 'primary', apply: s => { spend(s, 250000); s.expense += 2500; s.flags.car = true; s.happy += 5; log(s, '🚙', '買二手車，支出增加 2,500/月。'); return '你買了台狀況不錯的中古車。不帥，但能動。'; } },
        { label: '繼續搭捷運', sub: '', apply: s => { s.health += 2; return '你繼續搭捷運。多走的路，剛好當運動。'; } }
      ]
    },
    {
      id: 'travel', icon: '✈️', title: '出國旅行', max: 2, weight: 7,
      cond: s => s.age >= 22,
      text: '機票在特價。你已經三年沒出國了。',
      options: [
        { label: '刷下去，8 萬', sub: '快樂 +10', tone: '', apply: s => { spend(s, 80000); s.happy += 10; log(s, '✈️', '出國旅行，花 8 萬，快樂 +10。'); return '你在異地的街上走著，突然覺得人生還有很多可能。'; } },
        { label: '把錢留下來', sub: '', apply: s => { return '你關掉訂房網站。有點可惜，但帳戶數字讓你安心。'; } }
      ]
    },
    {
      id: 'gadget', icon: '📱', title: '手機壞了', max: 1, weight: 8,
      cond: s => true,
      text: '手機螢幕摔裂，電池也撐不住了。',
      options: [
        { label: '換新旗艦 40,000', sub: '', tone: '', apply: s => { spend(s, 40000); s.happy += 3; log(s, '📱', '換新手機，花 40,000。'); return '新手機很順，但帳單讓你有點痛。'; } },
        { label: '修一修 3,500', sub: '', apply: s => { spend(s, 3500); log(s, '🔧', '修手機，花 3,500。'); return '螢幕換新，再戰兩年。'; } }
      ]
    },
    {
      id: 'luxury', icon: '👜', title: '犒賞自己', weight: 5,
      cond: s => s.age >= 25,
      text: '這個月很累。你滑到一個很想買的東西。',
      options: [
        { label: '買，30,000', sub: '快樂 +6', apply: s => { spend(s, 30000); s.happy += 6; log(s, '👜', '衝動購物 30,000。'); return '你買了。開心三天，之後就習慣了。'; } },
        { label: '放進願望清單', sub: '', apply: s => { s.happy += 1; return '你放進清單。兩週後發現自己其實沒那麼想要。'; } }
      ]
    },
    {
      id: 'gym', icon: '🏋️', title: '健身房', weight: 5,
      cond: s => s.age >= 22 && s.age <= 62 && !s.flags.exercises,
      text: '樓下開了健身房，教練在發體驗券。',
      options: [
        { label: '簽一年', sub: '月支出 +1,500，健康 +8', tone: 'primary', apply: s => { s.expense += 1500; s.flags.exercises = true; s.health = Math.min(healthCeiling(s), s.health + 8); log(s, '🏋️', '開始健身，健康 +8，之後每年老化較慢。'); return '前兩週很痛苦，第三週開始上癮。'; } },
        { label: '算了', sub: '', apply: s => { return '你拿了體驗券，沒去。'; } }
      ]
    },
    {
      id: 'checkup', icon: '🩺', title: '健康檢查', weight: 6,
      cond: s => s.age >= 35,
      text: '公司安排了健檢，報告上有一個紅字。',
      options: [
        { label: '進一步檢查 12,000', sub: '早期發現', tone: 'primary', apply: s => { spend(s, 12000); s.health = Math.min(healthCeiling(s), s.health + 4); log(s, '🩺', '自費進一步檢查，及早處理。'); return '發現得早，處理得早。醫生說再晚兩年就麻煩了。'; } },
        { label: '先放著，之後再說', sub: '健康 −8', tone: 'danger', apply: s => { s.health -= 8; s.flags.ignoredCheckup = true; log(s, '⚠️', '忽略健檢紅字，健康 −8。'); return '你把報告塞進抽屜。它會一直在那裡。'; } }
      ]
    },
    {
      id: 'allnighter', icon: '🌃', title: '熬夜', weight: 6,
      cond: s => isEmployed(s) && s.age <= 45,
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
        { label: '就醫', sub: '醫療費 + 健康 −10', apply: s => { spend(s, 45000); s.health -= 10; log(s, '🚑', '意外受傷，醫療費 45,000。'); return '還好只是骨裂。醫藥費四萬五，復健三個月。'; } }
      ]
    },
    {
      id: 'illness', icon: '🏥', title: '重大疾病', weight: s => (s.age >= 45 ? 3 : 1),
      cond: s => s.age >= 40,
      text: '身體出現狀況，醫生說需要開刀與長期治療。',
      options: [
        { label: '面對治療', sub: '高額醫療費', tone: 'danger', apply: s => {
          const cost = 800000;
          if (s.flags.insured) { spend(s, 150000); s.health -= 12; log(s, '🛡️', '重大疾病，保險理賠後自付 15 萬。'); return '保險幫你擋下大部分。你第一次覺得保費沒白繳。'; }
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
        { label: '尋求專業協助', sub: '花 15,000，快樂 +12', tone: 'primary', apply: s => { spend(s, 15000); s.happy += 12; s.health += 3; log(s, '🫂', '接受心理諮商，快樂 +12。'); return '你走進諮商室。說出來之後，肩膀輕了一點。'; } },
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
        { label: '借', sub: '30% 拿得回來', tone: '', odds: '還錢 30%', apply: s => { spend(s, 50000); if (rand(s) < 0.3) { s.cash += 50000; s.happy += 3; log(s, '🤝', '借朋友的錢拿回來了。'); return '他真的還了，你們的友情還在。'; } s.happy -= 5; log(s, '💸', '借朋友的 5 萬拿不回來。'); return '下個月變成下一年，然後就沒有然後了。'; } },
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
      id: 'bonus', icon: '🧧', title: '年終獎金', max: 3, weight: 10,
      cond: s => isEmployed(s),
      text: '公司公布年終。',
      options: [
        { label: '入帳', sub: '約 1.5 個月', apply: s => { const amt = s.income * 1.5; s.cash += amt; s.happy += 4; log(s, '🧧', '年終獎金 ' + Math.round(amt).toLocaleString() + '。'); return '年終 1.5 個月，比預期好一點。'; } }
      ]
    },
    {
      id: 'inflation', icon: '🔥', title: '通膨升溫', max: 3, weight: 3,
      cond: s => true,
      text: '物價明顯上漲，便當從 90 變 120。',
      options: [
        { label: '縮減開支', sub: '快樂 −5，支出成長趨緩', apply: s => { s.expense *= 0.97; s.happy -= 5; log(s, '🔥', '通膨來襲，開始縮減開支。'); return '你開始記帳、少外食。生活變緊，但還過得去。'; } },
        { label: '照原本過', sub: '支出上升', apply: s => { s.expense *= 1.05; log(s, '🔥', '不調整生活，支出被通膨推高。'); return '你不想為了錢委屈自己。代價是每月多花幾千。'; } }
      ]
    },
    {
      id: 'renthike', icon: '🔑', title: '房東漲租', max: 3, weight: 6,
      cond: s => !s.flags.house && s.age <= 60 && (s.rent || 0) > 0,
      text: '房東傳訊息：「附近行情都漲了，明年開始調整。」',
      options: [
        { label: '接受', sub: '月支出 +3,000', apply: s => { s.expense += 3000; log(s, '🔑', '接受漲租，月支出 +3,000。'); return '你摸摸鼻子續約。搬家太麻煩了。'; } },
        { label: '搬家', sub: '一次性 2 萬，之後省一點', apply: s => { spend(s, 20000); s.expense -= 1000; s.happy -= 3; log(s, '📦', '搬家省租金，花 2 萬搬家費。'); return '你搬了。東西比想像中多，回憶也是。'; } }
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
        { label: '送出國', sub: '一次 300 萬', tone: 'danger', apply: s => { spend(s, 3000000); s.happy += 8; log(s, '🌍', '送孩子出國，花 300 萬。'); return '你送孩子上飛機。存款少一大塊，但他看到的世界變大了。'; } }
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
        { label: '投入 15 萬', sub: '25% 暴賺 / 75% 歸零', tone: 'danger', odds: '暴賺 25%', apply: s => { spend(s, 150000); if (rand(s) < 0.25) { s.cash += 600000; s.happy += 12; log(s, '₿', '幣圈獲利 45 萬。'); return '你賣在相對高點。這次是真的，但你知道運氣佔了多少。'; } s.happy -= 10; log(s, '🪙', '幣圈投資歸零 15 萬。'); return '幣價腰斬再腰斬。你的 15 萬變成 1 萬。'; } },
        { label: '只買一點點 2 萬', sub: '小賭怡情', apply: s => { spend(s, 20000); if (rand(s) < 0.35) { s.cash += 60000; } log(s, '🪙', '小額參與幣圈。'); return '你買了一點點。漲跌都不影響生活。'; } }
      ]
    },
    {
      id: 'donate', icon: '❤️', title: '捐款', weight: 3,
      cond: s => s.age >= 30,
      text: '你看到一個偏鄉兒童的課輔計畫，還差一點經費。',
      options: [
        { label: '捐 50,000', sub: '快樂 +10', tone: 'primary', apply: s => { spend(s, 50000); s.happy += 10; s.flags.donated = true; log(s, '❤️', '捐款 50,000 給偏鄉課輔。'); return '錢出去了，心裡卻滿了一塊。'; } },
        { label: '下次吧', sub: '', apply: s => { return '你按下「稍後再說」。'; } }
      ]
    },
    {
      id: 'rentout', icon: '🏠', title: '出租空房', weight: 3,
      cond: s => s.flags.house && !s.flags.tenants,
      text: '家裡有一間空房，有人想租。',
      options: [
        { label: '出租', sub: '月收入 +8,000', apply: s => { s.income += 8000; s.happy -= 2; log(s, '🏠', '出租空房，月收入 +8,000。'); return '每月多八千，也多了一個要協調的室友。'; } },
        { label: '留著自己用', sub: '', apply: s => { s.happy += 2; return '你把空房改成書房。'; } }
      ]
    },
    {
      id: 'moveout', icon: '📦', title: '搬出去住', weight: 7, once: true,
      cond: s => s.flags.liveWithParents && s.age >= 27 && s.age <= 35,
      text: '住家裡省了很多錢，但你也三十歲了。朋友都搬出去了，家裡的話題越來越難接。',
      options: [
        { label: '搬出去，租 15,000/月', sub: '自由 +8，每月少存 1.5 萬', tone: 'primary', apply: s => { s.rent = 18000; s.expense = s.living + s.rent; s.happy += 8; delete s.flags.liveWithParents; log(s, '📦', '搬出去租屋，月租 15,000。'); return '你搬進了自己的小套房。房租很痛，但晚上十一點回家不用解釋。'; } },
        { label: '繼續住家裡，多存一點', sub: '快樂 −5，存款增加', apply: s => { s.happy -= 5; log(s, '🏠', '決定繼續住家裡，把錢存下來。'); return '你留下了。存款曲線漂亮，但你開始覺得自己像個房客。'; } }
      ]
    },
    {
      id: 'filial', icon: '🧧', title: '孝親費', weight: 8, once: true,
      cond: s => s.age >= 32 && !s.flags.filial,
      text: '爸媽退休了，生活費開始吃緊。他們沒有明說，但你懂。',
      options: [
        { label: '每月給 5,000', sub: '月支出 +5,000', tone: 'primary', apply: s => { s.expense += 5000; s.living += 5000; s.flags.filial = true; s.happy += 3; log(s, '🧧', '開始每月給孝親費 5,000。'); return '你固定轉帳。錢不多，但那是你能給的一份安心。'; } },
        { label: '每月給 12,000', sub: '月支出 +12,000，快樂 +8', tone: '', apply: s => { s.expense += 12000; s.living += 12000; s.flags.filial = true; s.happy += 8; log(s, '🧧', '每月給孝親費 12,000。'); return '你多給了一些。自己的旅遊計畫延後，但家裡的氣氛鬆了。'; } },
        { label: '說自己也很緊', sub: '快樂 −10，關係緊張', tone: 'danger', apply: s => { s.flags.filial = true; s.happy -= 10; log(s, '😶', '沒給孝親費，家裡的氣氛變僵。'); return '你說房貸很重。電話那頭沉默了三秒，之後每年過年都有人提起。'; } }
      ]
    },
    {
      id: 'childcare', icon: '🍼', title: '托育費', weight: 7,
      cond: s => s.flags.child && s.age >= 30 && s.age <= 44,
      text: '小孩要上幼兒園了。公立抽不到，私立每月兩萬起。',
      options: [
        { label: '私立幼兒園 20,000/月', sub: '月支出 +20,000', tone: 'primary', apply: s => { s.expense += 20000; s.living += 20000; s.happy += 4; log(s, '🍼', '私立幼兒園，月支出 +20,000。'); return '你選了私立。接送方便、有英文課，代價是每月兩萬。'; } },
        { label: '公立＋長輩後援', sub: '便宜，但要欠人情', apply: s => { s.expense += 5000; s.living += 5000; s.happy -= 2; log(s, '🏫', '抽到公立，靠長輩幫忙接送。'); return '公立省很多，但你開始在家族群組裡格外客氣。'; } },
        { label: '自己帶，一方辭職', sub: '少一份薪水', tone: 'danger', apply: s => { s.income *= 0.55; s.happy += 6; s.health -= 4; s.flags.stressed = true; log(s, '👶', '一方辭職自己帶小孩，家庭收入剩 55%。'); return '你們算過，托育費差不多等於一份薪水。於是一個人留在家裡。'; } }
      ]
    },
    {
      id: 'salaryfreeze', icon: '🧊', title: '公司凍漲', weight: 7,
      cond: s => isEmployed(s) && s.age >= 32 && s.age <= 55,
      text: '公司宣布今年不調薪，獎金也砍半。主管說：「景氣不好，大家共體時艱。」',
      options: [
        { label: '忍下來', sub: '收入不變，快樂 −6', apply: s => { s.happy -= 6; s.flags.careerStall = true; log(s, '🧊', '接受凍漲，心裡很不舒服。'); return '你留下來。工作量沒少，薪水沒動。'; } },
        { label: '開始面試，準備跳槽', sub: '60% 成功 +14%，失敗健康 −5', tone: 'primary', odds: '成功 60%', apply: s => { if (rand(s) < 0.6) { s.income *= 1.14; s.happy += 6; s.flags.stressed = true; log(s, '🎯', '跳槽成功，收入 +14%。'); return '三個月後你換了公司，薪水補回來，也重新當一次新人。'; } s.health -= 5; s.happy -= 5; log(s, '📄', '面試三個月沒成，繼續留在原公司。'); return '你面試了一圈，沒有更好的條件。回到位子上，心裡更悶。'; } },
        { label: '跟主管談加薪', sub: '40% 成功 +8%', tone: '', odds: '成功 40%', apply: s => { if (rand(s) < 0.4) { s.income *= 1.08; s.happy += 4; log(s, '🗣️', '談判成功，加薪 8%。'); return '你帶著成果報告進會議室，爭取到 8%。'; } s.happy -= 3; log(s, '😐', '談加薪被婉拒。'); return '主管說「明年一定」。你知道那句話的意思。'; } }
      ]
    },
    {
      id: 'insurance', icon: '🛡️', title: '保險規劃', weight: 5, once: true,
      cond: s => s.age >= 27 && s.age <= 45 && !s.flags.insured,
      text: '業務員提醒你：這個年紀保費還便宜，再晚就貴了。',
      options: [
        { label: '保醫療＋失能 3,000/月', sub: '月支出 +3,000，往後醫療有網子', tone: 'primary', apply: s => { s.expense += 3000; s.living += 3000; s.flags.insured = true; log(s, '🛡️', '投保醫療與失能險，月付 3,000。'); return '你簽了。每月固定一筆支出，但你睡得比較安穩。'; } },
        { label: '先不保，錢拿去投資', sub: '多 3,000 可投資，風險自負', apply: s => { s.invest += 36000; s.risk = Math.min(1.5, s.risk + 0.05); log(s, '📈', '不投保，把保費投入市場。'); return '你把錢放進市場。沒出事的時候，這個決定看起來很聰明。'; } }
      ]
    },
    {
      id: 'medbill', icon: '🦷', title: '牙齒／小手術', weight: 6,
      cond: s => true,
      text: '牙齒痛到睡不著，醫生說要植牙。',
      options: [
        { label: '植牙 80,000', sub: '', apply: s => { spend(s, 80000); s.health += 2; log(s, '🦷', '植牙花 80,000。'); return '你付了錢。至少可以好好吃東西了。'; } },
        { label: '先止痛', sub: '健康 −3', apply: s => { spend(s, 3000); s.health -= 3; log(s, '🦷', '只做止痛處理。'); return '你決定再撐一下。痛的還會再來。'; } }
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
    const annual = Math.max(1, (s.expense + s.debtPay) * 12);
    const nw = netWorth(s);
    const ratio = nw / annual;
    let key, icon, title, desc, tone;

    if (reason === 'broke' || nw < 0) {
      key = 'broke'; icon = '💀'; title = '債務深淵'; tone = 'bad';
      desc = '你活到了最後，但帳戶是負的。負債跟著你進了老年，利息比你賺得快。';
    } else if (s.health <= 0) {
      key = 'health'; icon = '🕯️'; title = '提早謝幕'; tone = 'bad';
      desc = '錢還在，但你沒有力氣花了。健康是唯一不能貸款的資產。';
    } else if (ratio >= CFG.FIRE_RATIO && s.health >= 40 && s.happy >= 42) {
      key = 'fire'; icon = '🏆'; title = '財富自由 · FIRE'; tone = 'good';
      desc = '你的資產足以支撐 25 年以上的生活。時間終於回到你手上。';
    } else if (ratio >= CFG.FIRE_RATIO) {
      key = 'rich_lonely'; icon = '💰'; title = '富有的孤獨'; tone = 'neutral';
      desc = '你的帳戶很漂亮，但生活裡沒有人陪你一起吃晚餐。';
    } else if (ratio >= 10) {
      key = 'stable'; icon = '🌾'; title = '安穩退休'; tone = 'good';
      desc = '不算富裕，但你不必看誰的臉色。這已經是很多人到不了的終點。';
    } else if (ratio >= 4) {
      key = 'tight'; icon = '🚲'; title = '緊繃的小康'; tone = 'neutral';
      desc = '你撐住了，但每一年都要重新計算。退休不是終點，是另一種節省。';
    } else if (s.flags.pension) {
      key = 'pension'; icon = '🏛️'; title = '靠年金過日子'; tone = 'neutral';
      desc = '沒有資產，但年金讓你活了下來。你的老年，是一張每月入帳的通知單。';
    } else {
      key = 'forever'; icon = '😮‍💨'; title = '活到老，做到老'; tone = 'bad';
      desc = '你沒有存夠。七十幾歲還在接電話、排班、看時薪。';
    }

    const finScore = clamp(ratio / CFG.FIRE_RATIO * 100, 0, 100);
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
        const times = s.evCount[e.id] || 0;
        if (times >= (e.once ? 1 : (e.max || CFG.EVENT_MAX))) continue;
        if (s.cooldown[e.id] && s.age - s.cooldown[e.id] < CFG.EVENT_COOLDOWN) continue;
        if (e.cond && !e.cond(s)) continue;
        const w = typeof e.weight === 'function' ? e.weight(s) : (e.weight || 1);
        pool.push({ e, w });
      }
      if (pool.length) {
        const chosen = pickW(s, pool).e;
        s.cooldown[chosen.id] = s.age;
        s.evCount[chosen.id] = (s.evCount[chosen.id] || 0) + 1;
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

    if (s.health <= 10) return finish(s, 'health');
    if (s.age > CFG.END_AGE) return finish(s, 'finish');

    settle(s);

    // 只有「完全撐不下去」才提前結束；一般負債留到最後結算
    if (netWorth(s) < -8000000 && s.cash < 50000 && s.invest < 100000) return finish(s, 'broke');
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
