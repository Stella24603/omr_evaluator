/* Sheet geometry, in millimetres on an A4 page.
   Shared by the sheet maker (sheet.js) and the reader (scan.js), so the two can never drift apart. */
(function () {
  const OMR = (window.OMR = window.OMR || {});

  OMR.PAGE = { W: 210, H: 297 };
  OMR.MARKER = 7; // side of the black corner squares
  // Corner marker centres: top-left, top-right, bottom-right, bottom-left
  OMR.MARKERS = [[11, 11], [199, 11], [199, 286], [11, 286]];
  // Code strip on the top edge: start, 4 data bits, parity, stop
  OMR.STRIP = { x0: 24, pitch: 6, y: 11, size: 3.6, n: 7, paperRef: [18, 11] };
  OMR.CLASSES = ['XI', 'XII'];
  OMR.SETS = ['A', 'B', 'C', 'D'];
  OMR.OPTIONS = ['A', 'B', 'C', 'D'];

  OMR.stripBits = function (cfg) {
    const rd = cfg.rollDigits - 2;
    const d = [cfg.questions === 40 ? 1 : 0, rd & 1, (rd >> 1) & 1, cfg.hasSet ? 1 : 0];
    const parity = d[0] ^ d[1] ^ d[2] ^ d[3] ^ 1;
    return [1, ...d, parity, 1];
  };

  OMR.cfgFromBits = function (b) {
    if (!b[0] || !b[6]) return null;
    if ((b[1] ^ b[2] ^ b[3] ^ b[4] ^ 1) !== b[5]) return null;
    const rollDigits = 2 + b[2] + 2 * b[3];
    if (rollDigits > 4) return null;
    return { questions: b[1] ? 40 : 35, rollDigits, hasSet: !!b[4] };
  };

  OMR.layout = function (cfg) {
    const L = { cfg, r: { cls: 2.3, set: 2.3, roll: 2.0, ans: 2.3 } };
    L.header = { logo: { x: 12, y: 19, w: 24, h: 24 }, cx: 118 };
    L.name = { x: 12, y: 47, w: 186, h: 11 };
    L.subject = { x: 12, y: 60, w: 110, h: 11 };
    L.date = { x: 124, y: 60, w: 74, h: 11 };

    const y0 = 74, sh = 70;
    L.section = { y: y0, h: sh };
    L.clsBox = { x: 12, y: y0, w: 24, h: sh };
    L.cls = OMR.CLASSES.map((v, i) => ({ v, x: 28, y: y0 + 20 + i * 11 }));

    L.rollBox = { x: 38, y: y0, w: 38, h: sh };
    L.roll = [];
    L.rollWrite = [];
    for (let i = 0; i < cfg.rollDigits; i++) {
      const x = 57 + (i - (cfg.rollDigits - 1) / 2) * 7;
      L.rollWrite.push({ x: x - 3.5, y: y0 + 9, w: 7, h: 7 });
      const col = [];
      for (let d = 0; d < 10; d++) col.push({ v: String(d), x, y: y0 + 21.5 + d * 5 });
      L.roll.push(col);
    }

    let tx = 78;
    L.set = [];
    if (cfg.hasSet) {
      L.setBox = { x: 78, y: y0, w: 24, h: sh };
      L.set = OMR.SETS.map((v, i) => ({ v, x: 90, y: y0 + 20 + i * 11 }));
      tx = 104;
    }
    L.teacher = { x: tx, y: y0, w: 198 - tx, h: sh };

    L.ansTitleY = 150.5;
    L.blocks = [];
    L.answers = [];
    const top = 153, hh = 6.5, pitch = 8.3;
    for (let b = 0; b < 4; b++) {
      const bx = 12 + b * 47;
      const rows = Math.max(0, Math.min(10, cfg.questions - b * 10));
      if (!rows) continue;
      L.blocks.push({ x: bx, y: top, w: 45, hh, pitch, rows, first: b * 10 + 1 });
      for (let i = 0; i < rows; i++) {
        const y = top + hh + pitch / 2 + i * pitch;
        L.answers.push(OMR.OPTIONS.map((v, j) => ({ v, x: bx + 14.5 + j * 8.5, y })));
      }
    }
    L.instructions = { x: 12, y: 246, w: 186, h: 26 };
    L.footerY = 278;

    // Groups of bubbles that are re-aligned together when reading a photo
    L.alignGroups = [];
    L.alignGroups.push({ r: L.r.cls, pts: L.cls });
    if (L.set.length) L.alignGroups.push({ r: L.r.set, pts: L.set });
    L.alignGroups.push({ r: L.r.roll, pts: L.roll.flat() });
    L.blocks.forEach((blk) => {
      const pts = [];
      for (let q = blk.first - 1; q < blk.first - 1 + blk.rows; q++) pts.push(...L.answers[q]);
      L.alignGroups.push({ r: L.r.ans, pts });
    });
    return L;
  };
})();
