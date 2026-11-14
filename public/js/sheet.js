/* Draws the printable answer sheet as an SVG string (1 user unit = 1 mm). */
(function () {
  const OMR = (window.OMR = window.OMR || {});

  // line = boxes and bubble outlines, tint = shaded rows, text = letters inside bubbles (kept light
  // so an empty bubble never looks filled to the reader)
  const INKS = {
    pink: { name: 'Pink', line: '#e0457b', tint: '#fdeaf1', text: '#e0457b' },
    orange: { name: 'Orange', line: '#e8742a', tint: '#fdeee2', text: '#e8742a' },
    red: { name: 'Red', line: '#d93a3a', tint: '#fde9e9', text: '#d93a3a' },
    purple: { name: 'Purple', line: '#9a55c8', tint: '#f3eafa', text: '#b98bd9' },
    blue: { name: 'Blue', line: '#3f7fc8', tint: '#e8f1fb', text: '#8fb5e0' },
    green: { name: 'Green', line: '#2e9e5b', tint: '#e6f5ec', text: '#86c9a0' },
    grey: { name: 'Grey (black printer)', line: '#8c8c8c', tint: '#f2f2f2', text: '#a6a6a6' },
  };
  OMR.INKS = INKS;
  const DARK = '#1a1a1a';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  OMR.BRANDS = {
    logic: { name: 'THE LOGIC ROOM', mono: 'LR' },
    ganita: { name: 'GANITASASTRAM', mono: 'G' },
  };

  /* opts: { brand, brandName, logo (data URL), ink, title, subject, date } */
  OMR.renderSheet = function (cfg, opts) {
    opts = opts || {};
    const L = OMR.layout(cfg);
    const ink = INKS[opts.ink] || INKS.pink;
    const brand = OMR.BRANDS[opts.brand] || OMR.BRANDS.logic;
    const brandName = opts.brandName || brand.name;
    const o = [];
    const rect = (b, extra) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${ink.line}" stroke-width="0.35" ${extra || ''}/>`;
    const text = (x, y, s, size, a) => {
      a = a || {};
      return `<text x="${x}" y="${y}" font-size="${size}" fill="${a.fill || DARK}" text-anchor="${a.anchor || 'start'}" font-weight="${a.bold ? 700 : 400}"${a.ls ? ` letter-spacing="${a.ls}"` : ''}>${esc(s)}</text>`;
    };
    const bubble = (p, r, label) =>
      `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="#fff" stroke="${ink.line}" stroke-width="0.3"/>` +
      (label ? `<text x="${p.x}" y="${p.y + r * 0.42}" font-size="${r * 1.2}" fill="${ink.text}" text-anchor="middle">${label}</text>` : '');
    const titleBar = (b, s) =>
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="7" fill="${ink.tint}" stroke="${ink.line}" stroke-width="0.35"/>` +
      text(b.x + b.w / 2, b.y + 4.9, s, 2.9, { anchor: 'middle', bold: true });

    o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm" font-family="Arial, Helvetica, sans-serif">`);
    o.push(`<rect width="210" height="297" fill="#fff"/>`);

    // Registration marks and code strip (always pure black)
    const m = OMR.MARKER;
    OMR.MARKERS.forEach(([x, y]) => o.push(`<rect x="${x - m / 2}" y="${y - m / 2}" width="${m}" height="${m}" fill="#000"/>`));
    const S = OMR.STRIP;
    OMR.stripBits(cfg).forEach((bit, i) => {
      if (bit) o.push(`<rect x="${S.x0 + i * S.pitch - S.size / 2}" y="${S.y - S.size / 2}" width="${S.size}" height="${S.size}" fill="#000"/>`);
    });

    // Header
    const lg = L.header.logo;
    if (opts.logo) {
      o.push(`<image href="${esc(opts.logo)}" x="${lg.x}" y="${lg.y}" width="${lg.w}" height="${lg.h}" preserveAspectRatio="xMidYMid meet"/>`);
    } else {
      const cx = lg.x + lg.w / 2, cy = lg.y + lg.h / 2;
      o.push(`<circle cx="${cx}" cy="${cy}" r="11" fill="none" stroke="${DARK}" stroke-width="0.6"/><circle cx="${cx}" cy="${cy}" r="9.6" fill="none" stroke="${DARK}" stroke-width="0.25"/>`);
      o.push(text(cx, cy + 3, brand.mono, 8.5, { anchor: 'middle', bold: true }));
    }
    o.push(text(L.header.cx, 28, brandName, 7.2, { anchor: 'middle', bold: true, ls: 0.4 }));
    o.push(text(L.header.cx, 35.5, 'OMR ANSWER SHEET', 5, { anchor: 'middle', bold: true, ls: 0.3 }));
    if (opts.title) o.push(text(L.header.cx, 41.5, opts.title, 3.5, { anchor: 'middle' }));

    // Hand-written fields
    const field = (b, label, value) => {
      o.push(rect(b));
      o.push(text(b.x + 2, b.y + 4, label, 2.7, { bold: true }));
      if (value) o.push(text(b.x + 4, b.y + 9, value, 4));
    };
    field(L.name, '1. NAME OF THE STUDENT (IN BLOCK LETTERS) :');
    field(L.subject, '2. SUBJECT :', opts.subject);
    field(L.date, '3. DATE :', opts.date);

    // Class
    o.push(rect(L.clsBox), titleBar(L.clsBox, '4. CLASS'));
    L.cls.forEach((p) => {
      o.push(text(p.x - 5, p.y + 1.4, p.v, 3.8, { anchor: 'end', bold: true }));
      o.push(bubble(p, L.r.cls));
    });

    // Roll number
    o.push(rect(L.rollBox), titleBar(L.rollBox, '5. ROLL No.'));
    L.rollWrite.forEach((b) => o.push(rect(b)));
    L.roll.forEach((col) => col.forEach((p) => o.push(bubble(p, L.r.roll, p.v))));

    // Question set
    if (cfg.sets) {
      o.push(rect(L.setBox), titleBar(L.setBox, '6. SET'));
      L.set.forEach((p) => {
        o.push(text(p.x - 5, p.y + 1.4, p.v, 3.8, { anchor: 'end', bold: true }));
        o.push(bubble(p, L.r.set));
      });
    }

    // Teacher's box: marks, grade, signature
    const T = L.teacher;
    o.push(rect(T), titleBar(T, "FOR TEACHER'S USE ONLY"));
    const bw = (T.w - 12) / 2;
    const mk = { x: T.x + 4, y: T.y + 11, w: bw, h: 24 };
    const gr = { x: T.x + 8 + bw, y: T.y + 11, w: bw, h: 24 };
    o.push(rect(mk), text(mk.x + 2, mk.y + 4, 'MARKS OBTAINED', 2.6, { bold: true }));
    o.push(text(mk.x + mk.w - 2, mk.y + mk.h - 3, '/ ' + cfg.questions, 4.2, { anchor: 'end' }));
    o.push(rect(gr), text(gr.x + 2, gr.y + 4, 'GRADE', 2.6, { bold: true }));
    const sg = { x: T.x + 4, y: T.y + 39, w: T.w - 8, h: 27 };
    o.push(rect(sg), text(sg.x + 2, sg.y + 4, 'SIGNATURE OF THE TEACHER WITH DATE', 2.6, { bold: true }));

    // Answers
    o.push(text(105, L.ansTitleY, (cfg.sets ? '7' : '6') + '. ANSWERS', 3.4, { anchor: 'middle', bold: true }));
    L.blocks.forEach((b) => {
      const h = b.hh + b.rows * b.pitch;
      for (let i = 0; i < b.rows; i += 2) o.push(`<rect x="${b.x}" y="${b.y + b.hh + i * b.pitch}" width="${b.w}" height="${b.pitch}" fill="${ink.tint}"/>`);
      o.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.hh}" fill="${ink.tint}"/>`);
      o.push(rect({ x: b.x, y: b.y, w: b.w, h }));
      o.push(`<path d="M${b.x + 9} ${b.y}v${h}M${b.x} ${b.y + b.hh}h${b.w}" stroke="${ink.line}" stroke-width="0.35"/>`);
      o.push(text(b.x + 4.5, b.y + 4.6, 'Q.No', 2.5, { anchor: 'middle', bold: true }));
      o.push(text(b.x + 27, b.y + 4.6, 'ANSWERS', 2.8, { anchor: 'middle', bold: true }));
      for (let i = 0; i < b.rows; i++) {
        const q = b.first + i;
        const row = L.answers[q - 1];
        o.push(text(b.x + 4.5, row[0].y + 1.3, q, 3.4, { anchor: 'middle', bold: true }));
        row.forEach((p) => o.push(bubble(p, L.r.ans, p.v)));
      }
    });

    // Instructions
    const I = L.instructions;
    o.push(rect(I));
    o.push(text(I.x + 3, I.y + 4.6, 'INSTRUCTIONS', 2.9, { bold: true }));
    [
      '1. Use only a BLUE or BLACK ball point pen. Do not use pencil or gel pen.',
      '2. Darken ONE bubble completely for each question. More than one darkened bubble is treated as wrong.',
      '3. Darken the bubbles for Class' + (cfg.sets ? ', Roll No. and Question Set' : ' and Roll No.') + ' carefully.',
      '4. An answer once darkened cannot be changed. Do not make stray marks; do not fold or crumple the sheet.',
    ].forEach((s, i) => o.push(text(I.x + 3, I.y + 9.2 + i * 4.3, s, 2.6)));
    // right / wrong examples
    const ex = I.x + I.w - 30, ey = I.y + 6;
    o.push(text(ex, ey + 1, 'Correct', 2.6, { bold: true }), `<circle cx="${ex + 17}" cy="${ey}" r="2" fill="#000"/>`);
    o.push(text(ex, ey + 9, 'Wrong', 2.6, { bold: true }));
    [0, 1, 2].forEach((k) => {
      const cx = ex + 13 + k * 6, cy = ey + 8;
      o.push(`<circle cx="${cx}" cy="${cy}" r="2" fill="none" stroke="#000" stroke-width="0.3"/>`);
      if (k === 0) o.push(`<path d="M${cx - 1.2} ${cy}l0.9 1.1l1.6-2.2" fill="none" stroke="#000" stroke-width="0.4"/>`);
      if (k === 1) o.push(`<path d="M${cx - 1.1} ${cy - 1.1}l2.2 2.2m0-2.2l-2.2 2.2" stroke="#000" stroke-width="0.4"/>`);
      if (k === 2) o.push(`<circle cx="${cx}" cy="${cy}" r="0.8" fill="#000"/>`);
    });

    o.push(text(105, L.footerY, 'Before filling the OMR Answer Sheet read the instructions carefully.', 3, { anchor: 'middle', bold: true }));
    o.push(text(105, 287, 'Do not write or mark near the black squares', 2.2, { anchor: 'middle', fill: '#777' }));
    o.push('</svg>');
    return o.join('');
  };
})();
