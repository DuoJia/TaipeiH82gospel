/* sprites.js — 像素夥伴（皮卡丘 / 噴火龍）
   每一隻都是「字元點陣 + 調色盤」→ 執行時轉成 <rect> 像素方塊（不用任何圖片檔） */
(function (root) {
  const DATA = {
    pika: {
      pal: {"K": "#4A3512", "Y": "#FFD93D", "W": "#FFFFFF", "R": "#FF5C6C", "M": "#7A2028", "B": "#A9741B"},
      rows: [
      "..KKK..................KKK..",
      "..KKKK................KKKK..",
      "...KKKK..............KKKK...",
      "...KKKK..............KKKK...",
      "...KYYK..............KYYK...",
      "...KYYYK............KYYYK...",
      "...KYYYYK..........KYYYYK...",
      "....KYYYYK........KYYYYK....",
      "....KYYYYYK......KYYYYYK....",
      ".....KYYYYYK....KYYYYYK.....",
      ".....KYYYYYYK..KYYYYYYK.....",
      "....KYYYWKYYYKKYYYKWYYYK....",
      "....KYYYKKYYYYYYYYKKYYYK....",
      "....KRRRYYYYYYYYYYYYRRRK....",
      "....KRRRYYYYYYYYYYYYRRRK....",
      ".....KYYYYYMMMMMMYYYYYK.....",
      "......KYYYYYYYYYYYYYYK......",
      "......KYYYYYYYYYYYYYYK.YY...",
      ".......KYYYYYYYYYYYYK..YYY..",
      ".......KYYYYYYYYYYYYK...YYY.",
      ".......KYYYYYYYYYYYYK...YYY.",
      ".......KYYYYYYYYYYYYK..YYY..",
      ".......KYYYYYYYYYYYYK.YYY...",
      ".......KYYKYYYYYYKYYKBBY....",
      ".......KKKKKKKKKKKKKK......."
    ]
    },
    char: {
      pal: {"K": "#5A1E00", "C": "#FF8A1F", "B": "#FFE0A8", "W": "#FFFFFF", "G": "#2FA79B", "g": "#1B7A72", "R": "#FF4D2E", "F": "#FFB01F", "H": "#FFF07A", "D": "#E8640C", "M": "#8C2800"},
      rows: [
      "............K................................K............",
      "...........KBK..............................KBK...........",
      "............KBK............................KBK............",
      "...........KKBBK..........KKKKKKK.........KBBKK...........",
      "..........KgggBBKK....KKKKCCCCCCCKKK....KKBBgggK..........",
      "........KKgGGGBBBBK..KBCCCCCCCCCCCCCK..KBBBBGGGgKK........",
      "......KKggGGGGgBBBBKKBCCCCCCCCCCCCCCCKKBBBBgGGGGggKK......",
      ".....KggGGGGGGGBBDDBBCCCCCCCCCCCCCCCCCBBDDBGGGGGGGggK.....",
      "....KgGGGGGGGGGgBBBDDDCCCCCCCCCCCCCCCDDDBBgGGGGGGGGGgK....",
      "....KgGGGGGGGGGgBBBCCWDDDCCCCCCCCCDDDWCCBBgGGGGGGGGGgK....",
      "...KgGGGGGGGGGGGgBCWWWWWWDDCCCCCDDWWWWWWCgGGGGGGGGGGGgK...",
      "...KgGGGGGGGGGGGgKCWWWWWWWCCCCCCCWWWWWWWCgGGGGGGGGGGGgK...",
      "..KgGGGGGGGGGGGGGCWWWWWWKWWCCCCCWWWWKWWWWCGGGGGGGGGGGGgK..",
      "..KgGGGGGGGGGGGGGCWWWWKKKWWCCCCCWWKKKWWWWCGGGGGGGGGGGGgK..",
      "..KgGGGGGGGGGGGGGCWWWWKKKWWCCCCCWWKKKWWWWCGGGGGGGGGGGGgK..",
      ".KgGGGGGGGGGGGGGGCCWWWKKKWCCCCCCCWKKKWWWCCGGGGGGGGGGGGGgK.",
      ".KgGGGGGGGGGGGGGGCCWWWWWWWCBBBBBCWWWWWWWCCGGGGGGGGGGGGGgK.",
      "KgGGGGGGGGGGGGGGGCCCCWWWCBBBBBBBBBCWWWCCCCGGGGGGGGGGGGGGgK",
      "KgGGGGGGGGGGGGGGGCCCCCCBBBBBBBBBBBBBCCCCCCGGGGGGGGGGGGGGgK",
      "KGGGGGGGGGGGGGGGGgCCCCCBBBMBBBBBMBBBCCCCCGGGGGGGGGGGGGGGGK",
      "KGGGGGGGGGGGGGGGGGCCCCBBBBMBBBBBMBBBBCCCCGGGGGGGGGGGGGGGGK",
      ".KGGGGGGGGGGGGGGGGgCCCBBBBBBBBBBBBBBBCCCGGGGGGGGGGGGGGGGRK",
      ".KGGGGGGGGGGGGGGGGgKCCBBBBBBBBBBBBBBBCCgGGGGGGGGGGGGGGGGRK",
      ".KGGGGGGGGGGGGGGGGgKKCCBBBBBBBBBBBBBCCKgGGGGGGGGGGGGGGGGRK",
      ".KGGGGGGGGGGGGGGGGgKCCMMWMMMWWMMMWMMMCCgGGGGGGGGGGGGGGGGRK",
      ".KGGGGGGGGGGGGGGGGgKCCCCWBBBWWBBBWCCCCCgGGGGGGGGGGGGGGGGRK",
      "..KGGGGGGGGGGGGGGGgCCCCCCCBBBBBBBCCCCCCCGGGGGGGGGGGGGGGRRK",
      "..KGGGGGGGGGGGGGGGKCCCCCCBBBBBBBBBCCCCCCGGGGGGGGGGGGGGGRRK",
      "..KGGGGGGGGGGGGGGGKCCCCCBBBBBBBBBBBCCCCCGGGGGGGGGGGGGGGRRK",
      "...KKGGGGGGGGGGGGKKCCCCBBBBBBBBBBBBBCCCCKGGGGGGGGGGGGFRRRK",
      ".....KKKGGGGGGGGGKKCCCCBBBBBBBBBBBBBCCCCKGGGGGGGGGFHFFRRRK",
      "........KKGKKKKKK..KCCCBBBBBBBBBBBBBCCCK.KRRRRFGFFFHFFRRRK",
      "..........K........KCCCBBBBBBBBBBBBBCCCKKKKRRRFFFFFFFFRRRK",
      "...................KKCCCCCBBBBBBBCCCCCCCCCCRRRRRRRRRRRRRRK",
      "..................KCCCCCCCCCBBBCCCCCCCCCCCCCCCCCCKKKKKKKK.",
      ".................KCCBBBBBBBCCBCCBBBBBBBCCCCCCCCCCK........",
      ".................KCCBBBBBBBCCBCCBBBBBBBCCCCCCCCCCK........",
      ".................KCCCCCCCCCCCBCCCCCCCCCCCKKKKKKKK.........",
      "..................KCCCCCCCCCKKKCCCCCCCCCK.................",
      "...................KKCCCCCKK...KKCCCCCKK..................",
      ".....................KKKKK.......KKKKK...................."
    ]
    }
  };

  /* 把點陣轉成 SVG：同色横向合併成一個 rect，減少節點數 */
  function spriteSVG(id, opts) {
    const s = DATA[id];
    if (!s) return '';
    const h = s.rows.length, w = s.rows[0].length;
    let out = '';
    for (let y = 0; y < h; y++) {
      const row = s.rows[y];
      let x = 0;
      while (x < w) {
        const ch = row[x];
        const col = s.pal[ch];
        if (!col) { x++; continue; }
        let x2 = x;
        while (x2 + 1 < w && row[x2 + 1] === ch) x2++;
        out += '<rect x="' + x + '" y="' + y + '" width="' + (x2 - x + 1) + '" height="1" fill="' + col + '"/>';
        x = x2 + 1;
      }
    }
    const o = opts || {};
    const pad = o.pad || 0;
    const vb = (-pad) + ' ' + (-pad) + ' ' + (w + pad * 2) + ' ' + (h + pad * 2);
    return '<svg viewBox="' + vb + '" xmlns="http://www.w3.org/2000/svg" ' +
      'shape-rendering="crispEdges" aria-hidden="true">' + out + '</svg>';
  }

  root.PSprites = { spriteSVG: spriteSVG, DATA: DATA };
})(window);
