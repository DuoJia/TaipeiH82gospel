/* data.js — 課程資料（Level 1：魔法覺醒之旅，12 週）
   3–5 歲設計：只放單字、圖示、語音，不放長句。 */
(function (root) {
  const COLORS = {
    Red: '#ff4d6d', Blue: '#4d9bff', Yellow: '#ffd93d',
    Green: '#3ddc84', Pink: '#ff8fc7', Purple: '#b07dff'
  };

  const ph = (en) => ({ letter: en[0].toUpperCase(), sound: '/' + en[0].toLowerCase() + '/' });

  function color(en, zh) { return { en, zh, kind: 'color', color: COLORS[en], ph: ph(en) }; }
  function shape(en, zh, s) { return { en, zh, kind: 'shape', shape: s, color: COLORS.Yellow, ph: ph(en) }; }
  function thing(kind, en, zh, emoji) { return { en, zh, kind, emoji, ph: ph(en) }; }
  function num(en, zh, n) { return { en, zh, kind: 'number', num: n, color: COLORS.Yellow, ph: ph(en) }; }

  /* ── 四種公主 + 兩隻寶可夢夥伴（初次進入挑選）────────────
     寶可夢夥伴 kind:'pet' → 用像素點陣 spriteSVG 呈現，不吃換裝配件 */
  const COMPANIONS = [
    { id: 'flower', name: '粉紅花語公主', en: 'Flower Princess', emoji: '🌸', dress: '#ffb3d9', hair: '#6b3f2a', gem: '#ff4d6d' },
    { id: 'ice', name: '冰雪藍龍公主', en: 'Ice Dragon Princess', emoji: '❄️', dress: '#a8e0ff', hair: '#2b4b6b', gem: '#4d9bff' },
    { id: 'star', name: '星空魔法公主', en: 'Star Princess', emoji: '⭐', dress: '#d9b3ff', hair: '#3b2a55', gem: '#b07dff' },
    { id: 'sun', name: '金色陽光公主', en: 'Sunshine Princess', emoji: '☀️', dress: '#ffe08a', hair: '#8a5a2b', gem: '#ffb703' },
    { id: 'pika', name: '電光皮卡丘', en: 'Pikachu', emoji: '⚡', kind: 'pet', sprite: 'pika',
      intro: 'Pika pika! I am Pikachu!', greet: 'Pika pika! Let us find magic cards!' },
    { id: 'char', name: '火焰噴火龍', en: 'Charizard', emoji: '🔥', kind: 'pet', sprite: 'char',
      intro: 'Roar! I am Charizard!', greet: 'Roar! Let us find magic cards!' }
  ];

  // ── 12 週課程 ─────────────────────────────────────────
  const WEEKS = [
    {
      w: 1, unit: 1, title: '城堡裡的色彩 I', game: 'gem',
      words: [color('Red', '紅色'), color('Blue', '藍色'), color('Yellow', '黃色')],
      card: { id: 'c1', name: '魔法紅龍卡', emoji: '🐲', rarity: 'common', say: 'Red dragon!' }
    },
    {
      w: 2, unit: 1, title: '城堡裡的色彩 II', game: 'dress',
      words: [color('Green', '綠色'), color('Pink', '粉紅'), color('Purple', '紫色')],
      card: { id: 'c2', name: '粉紅仙子卡', emoji: '🧚', rarity: 'rare', say: 'Pink fairy!' }
    },
    {
      w: 3, unit: 1, title: '星空的形狀', game: 'shape',
      words: [shape('Circle', '圓形', 'circle'), shape('Square', '正方形', 'square'), shape('Star', '星形', 'star')],
      card: { id: 'c3', name: '星星獨角獸卡', emoji: '🦄', rarity: 'rare', say: 'Star unicorn!' }
    },
    {
      w: 4, unit: 1, title: '魔法城堡大派對', game: 'combo', review: [1, 2, 3],
      words: [],
      card: { id: 'c4', name: '彩虹城堡卡', emoji: '🏰', rarity: 'legendary', say: 'Rainbow castle!' }
    },
    {
      w: 5, unit: 2, title: '森林救援小隊', game: 'listen',
      words: [thing('animal', 'Cat', '貓', '🐱'), thing('animal', 'Dog', '狗', '🐶'),
      thing('animal', 'Rabbit', '兔子', '🐰'), thing('animal', 'Bird', '鳥', '🐦')],
      card: { id: 'c5', name: '魔法兔萌卡', emoji: '🐇', rarity: 'rare', say: 'Magic rabbit!' }
    },
    {
      w: 6, unit: 2, title: '大自然探險關', game: 'listen',
      words: [thing('animal', 'Bear', '熊', '🐻'), thing('animal', 'Lion', '獅子', '🦁'),
      thing('animal', 'Monkey', '猴子', '🐵'), thing('animal', 'Snake', '蛇', '🐍')],
      card: { id: 'c6', name: '獅子騎士卡', emoji: '🦁', rarity: 'rare', say: 'Lion knight!' }
    },
    {
      w: 7, unit: 2, title: '公主舞會互動關', game: 'action',
      words: [thing('action', 'Run', '跑', '🏃'), thing('action', 'Jump', '跳', '🤸'),
      thing('action', 'Dance', '跳舞', '💃'), thing('action', 'Sleep', '睡覺', '😴')],
      card: { id: 'c7', name: '跳舞天鵝卡', emoji: '🦢', rarity: 'rare', say: 'Dancing swan!' }
    },
    {
      w: 8, unit: 2, title: '皇家森林音樂會', game: 'listen', review: [5, 6, 7],
      words: [],
      card: { id: 'c8', name: '森林守護龍卡', emoji: '🐉', rarity: 'legendary', say: 'Forest dragon!' }
    },
    {
      w: 9, unit: 3, title: '公主下午茶', game: 'find',
      words: [thing('fruit', 'Apple', '蘋果', '🍎'), thing('fruit', 'Banana', '香蕉', '🍌'),
      thing('fruit', 'Orange', '橘子', '🍊')],
      card: { id: 'c9', name: '香蕉精靈卡', emoji: '🍌', rarity: 'common', say: 'Banana elf!' }
    },
    {
      w: 10, unit: 3, title: '水果採摘魔法園', game: 'find',
      words: [thing('fruit', 'Grape', '葡萄', '🍇'), thing('fruit', 'Strawberry', '草莓', '🍓'),
      thing('fruit', 'Watermelon', '西瓜', '🍉')],
      card: { id: 'c10', name: '草莓小鹿卡', emoji: '🦌', rarity: 'rare', say: 'Strawberry deer!' }
    },
    {
      w: 11, unit: 3, title: '金幣寶箱開鎖關', game: 'count',
      words: [num('One', '一', 1), num('Two', '二', 2), num('Three', '三', 3),
      num('Four', '四', 4), num('Five', '五', 5)],
      card: { id: 'c11', name: '五彩魔法棒卡', emoji: '🪄', rarity: 'rare', say: 'Magic wand!' }
    },
    {
      w: 12, unit: 3, title: '魔法授勳大典', game: 'final', review: [1, 2, 3, 5, 6, 7, 9, 10, 11],
      words: [],
      card: { id: 'c12', name: '皇冠寶石王座卡', emoji: '👑', rarity: 'mythic', say: 'Royal crown!' }
    }
  ];

  const UNITS = [
    { u: 1, name: '城堡裡的色彩與形狀', emoji: '🏰', color: '#ff8fc7' },
    { u: 2, name: '皇家森林的動物夥伴', emoji: '🌳', color: '#7fd8a5' },
    { u: 3, name: '魔法花園的水果與數字', emoji: '🍎', color: '#ffc46b' }
  ];

  // ── 商店：配件與房間裝飾 ────────────────────────────────
  const SHOP = [
    { id: 'crown', name: '閃亮皇冠', emoji: '👑', type: 'wear', price: 30 },
    { id: 'wings', name: '蝴蝶翅膀', emoji: '🦋', type: 'wear', price: 50 },
    { id: 'wand', name: '星星魔杖', emoji: '🪄', type: 'wear', price: 40 },
    { id: 'dress2', name: '彩虹禮服', emoji: '👗', type: 'wear', price: 60 },
    { id: 'pet', name: '小小飛龍', emoji: '🐲', type: 'decor', price: 45 },
    { id: 'rainbow', name: '彩虹窗', emoji: '🌈', type: 'decor', price: 35 },
    { id: 'cake', name: '魔法蛋糕', emoji: '🎂', type: 'decor', price: 25 },
    { id: 'balloon', name: '氣球花束', emoji: '🎈', type: 'decor', price: 20 },
    { id: 'plant', name: '幸運草盆', emoji: '🪴', type: 'decor', price: 15 },
    { id: 'star', name: '閃亮星星', emoji: '🌟', type: 'decor', price: 10 }
  ];

  const RARITY = {
    common: { name: '普通', color: '#9aa7b8', glow: 'rgba(154,167,184,.6)' },
    rare: { name: '稀有', color: '#4d9bff', glow: 'rgba(77,155,255,.7)' },
    legendary: { name: '傳奇', color: '#ffb703', glow: 'rgba(255,183,3,.8)' },
    mythic: { name: '尊爵', color: '#b07dff', glow: 'rgba(176,125,255,.85)' }
  };

  const ALL_CARDS = WEEKS.map((w) => Object.assign({}, w.card, { week: w.w }));

  root.PData = { COLORS, COMPANIONS, WEEKS, UNITS, SHOP, RARITY, ALL_CARDS };
  if (typeof module !== 'undefined') module.exports = root.PData;
})(typeof window !== 'undefined' ? window : globalThis);
