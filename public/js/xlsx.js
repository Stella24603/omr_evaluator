/* Writes the results workbook (.xlsx) with real Excel charts, without any library.
   An .xlsx file is a zip of XML parts; this builds the parts and a plain (uncompressed) zip. */
(function () {
  const OMR = (window.OMR = window.OMR || {});
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const col = (n) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const ref = (c, r) => col(c) + (r + 1);

  // ---------- zip ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const head = (sig, extra, name, data, crc) => {
      const b = new DataView(new ArrayBuffer(extra ? 46 : 30));
      let p = 0;
      const u16 = (v) => { b.setUint16(p, v, true); p += 2; }, u32 = (v) => { b.setUint32(p, v, true); p += 4; };
      u32(sig); if (extra) u16(20);
      u16(20); u16(0x0800); u16(0); u16(0); u16(0x21); u32(crc); u32(data.length); u32(data.length); u16(name.length); u16(0);
      if (extra) { u16(0); u16(0); u16(0); u32(0); u32(offset); }
      return new Uint8Array(b.buffer);
    };
    Object.keys(files).forEach((path) => {
      const name = enc.encode(path), data = enc.encode(files[path]), crc = crc32(data);
      central.push(head(0x02014b50, true, name, data, crc), name);
      const local = head(0x04034b50, false, name, data, crc);
      parts.push(local, name, data);
      offset += local.length + name.length + data.length;
    });
    const size = central.reduce((n, b) => n + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, central.length / 2, true); end.setUint16(10, central.length / 2, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- styles ----------
  const ACCENT = 'FFB3174F', MUTED = 'FF6B6B70', LINE = 'FFDCDAD4';
  const FONTS = ['<sz val="11"/><name val="Calibri"/>', `<b/><sz val="18"/><color rgb="${ACCENT}"/><name val="Calibri"/>`, `<sz val="10"/><color rgb="${MUTED}"/><name val="Calibri"/>`,
    '<b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/>', '<b/><sz val="20"/><name val="Calibri"/>', `<sz val="9"/><color rgb="${MUTED}"/><name val="Calibri"/>`,
    '<b/><sz val="14"/><name val="Calibri"/>', `<b/><sz val="12"/><color rgb="${ACCENT}"/><name val="Calibri"/>`, '<b/><sz val="11"/><name val="Calibri"/>'];
  const FILLS = ['<patternFill patternType="none"/>', '<patternFill patternType="gray125"/>', ...[ACCENT, 'FFFBE6EE', 'FFFFF3D6', 'FFD9F0E1', 'FFFADADA'].map((c) => `<patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill>`)];
  // name: [font, fill, border, numFmt, horizontal alignment]
  const XF = {
    plain: [0, 0, 0, 0, ''], title: [1, 0, 0, 0, ''], sub: [2, 0, 0, 0, ''], head: [3, 2, 1, 0, 'center'], text: [0, 0, 1, 0, ''], num: [0, 0, 1, 0, 'right'],
    dec: [0, 0, 1, 164, 'right'], pct: [0, 0, 1, 165, 'right'], kpi: [4, 3, 0, 0, 'center'], kpiLabel: [5, 3, 0, 0, 'center'], top: [6, 4, 0, 0, 'center'],
    topSub: [0, 4, 0, 0, 'center'], right: [0, 5, 1, 0, 'center'], wrong: [0, 6, 1, 0, 'center'], mid: [0, 0, 1, 0, 'center'], section: [7, 0, 0, 0, ''], bold: [8, 0, 1, 0, 'center'],
  };
  const XF_NAMES = Object.keys(XF);
  const stylesXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0&quot;%&quot;"/></numFmts>
<fonts count="${FONTS.length}">${FONTS.map((f) => `<font>${f}</font>`).join('')}</fonts><fills count="${FILLS.length}">${FILLS.map((f) => `<fill>${f}</fill>`).join('')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${['left', 'right', 'top', 'bottom'].map((s) => `<${s} style="thin"><color rgb="${LINE}"/></${s}>`).join('')}<diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${XF_NAMES.length}">${XF_NAMES.map((n) => { const [f, fl, b, nf, al] = XF[n]; return `<xf numFmtId="${nf}" fontId="${f}" fillId="${fl}" borderId="${b}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"${al ? ` horizontal="${al}"` : ''}/></xf>`; }).join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  // ---------- worksheets ----------
  /* A sheet is { rows: [[cell, ...], ...], widths, merges, freeze, filter, bars, heights, drawing }.
     A cell is null, a value, or [value, styleName]. */
  function sheetXml(sh) {
    const rows = sh.rows.map((row, r) => {
      const cells = row.map((cell, c) => {
        if (cell == null) return '';
        const [v, st] = Array.isArray(cell) ? cell : [cell, 'plain'];
        const s = ` s="${XF_NAMES.indexOf(st)}"`;
        if (v == null || v === '') return `<c r="${ref(c, r)}"${s}/>`;
        return typeof v === 'number' && isFinite(v) ? `<c r="${ref(c, r)}"${s}><v>${v}</v></c>` : `<c r="${ref(c, r)}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('');
      const h = sh.heights && sh.heights[r];
      return cells || h ? `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>` : '';
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheetViews><sheetView workbookViewId="0"${sh.grid === false ? ' showGridLines="0"' : ''}>${sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/>` : ''}</sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"/><cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
      `<sheetData>${rows}</sheetData>` +
      (sh.filter ? `<autoFilter ref="${sh.filter}"/>` : '') +
      (sh.merges && sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
      (sh.bars || []).map((b, i) => `<conditionalFormatting sqref="${b}"><cfRule type="dataBar" priority="${i + 1}"><dataBar><cfvo type="num" val="0"/><cfvo type="num" val="100"/><color rgb="FFE89AB5"/></dataBar></cfRule></conditionalFormatting>`).join('') +
      `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/>` +
      (sh.drawing ? '<drawing r:id="rId1"/>' : '') + '</worksheet>';
  }

  // ---------- charts ----------
  /* A column (or horizontal bar) chart of one series. cats / vals: { ref: "'Sheet'!$A$2:$A$9", data: [...] } */
  function chartXml(o) {
    const cache = (d, num) => `<c:${num ? 'numCache><c:formatCode>General</c:formatCode' : 'strCache'}><c:ptCount val="${d.length}"/>${d.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:${num ? 'numCache' : 'strCache'}>`;
    const txt = (s, size, bold) => `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="en-US" sz="${size}" b="${bold ? 1 : 0}"/><a:t>${esc(s)}</a:t></a:r></a:p></c:rich></c:tx>`;
    const title = (s, size, bold) => `<c:title>${txt(s, size, bold)}<c:overlay val="0"/></c:title>`;
    const line = (c) => `<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></a:ln></c:spPr>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/>` +
      `<c:chart>${title(o.title, 1300, true)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>` +
      `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
      `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(o.series)}</c:v></c:tx>` +
      `<c:spPr><a:solidFill><a:srgbClr val="${o.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>` +
      (o.labels ? `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` : '') +
      `<c:cat><c:strRef><c:f>${esc(o.cats.ref)}</c:f>${cache(o.cats.data, false)}</c:strRef></c:cat>` +
      `<c:val><c:numRef><c:f>${esc(o.vals.ref)}</c:f>${cache(o.vals.data, true)}</c:numRef></c:val></c:ser>` +
      `<c:gapWidth val="${o.gap || 60}"/><c:axId val="111111111"/><c:axId val="222222222"/></c:barChart>` +
      `<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${title(o.x, 1000, false)}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${line('BFBFBF')}<c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
      `<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/>${o.max ? `<c:max val="${o.max}"/>` : ''}<c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines>${line('E5E5E5')}</c:majorGridlines>${title(o.y, 1000, false)}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:crossAx val="111111111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>` +
      `</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
      `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="DCDAD4"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
  }
  // anchors: [fromCol, fromRow, toCol, toRow]
  const drawingXml = (anchors) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    anchors.map(([c1, r1, c2, r2], i) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
      `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join('') + '</xdr:wsDr>';

  /* m: { exam, rows: [{ rank, cls, roll, name, set, correct, wrong, blank, score, max, pct, grade, answers, key }],
          stats: [[label, value], ...], toppers: [text], bins: [{ label, n }], grades: [{ g, n }],
          questions: [{ set, q, key, pct, A, B, C, D, blank, multi }], keys: { A: [...] } } */
  OMR.xlsx = function (m) {
    const e = m.exam, sets = !!e.sets;
    const N = 7; // summary width in columns

    // --- Summary ---
    const S = { rows: [], widths: Array(N).fill(17), merges: [], heights: {}, grid: false, drawing: true };
    const pad = (cells, st) => Array.from({ length: N }, (_, i) => (cells[i] != null ? cells[i] : st ? ['', st] : null));
    S.rows.push(pad([[e.name || 'Exam results', 'title']])); S.merges.push(`A1:${col(N - 1)}1`); S.heights[0] = 30;
    S.rows.push(pad([[[e.subject, e.date, `${e.questions} questions`].filter(Boolean).join('   ·   '), 'sub']])); S.merges.push(`A2:${col(N - 1)}2`);
    S.rows.push(pad([[e.topics ? 'Topics: ' + e.topics : '', 'sub']])); S.merges.push(`A3:${col(N - 1)}3`);
    S.rows.push([]);
    S.rows.push(pad(m.stats.map((s) => [s[1], 'kpi']), 'kpi')); S.heights[4] = 34;
    S.rows.push(pad(m.stats.map((s) => [s[0], 'kpiLabel']), 'kpiLabel')); S.heights[5] = 20;
    S.rows.push([]);
    S.rows.push(pad([[m.toppers.length > 1 ? '★  TOPPERS' : '★  TOPPER', 'top']], 'top')); S.merges.push(`A8:${col(N - 1)}8`); S.heights[7] = 26;
    S.rows.push(pad([[m.toppers.join('     |     ') || 'No sheets marked yet', 'topSub']], 'topSub')); S.merges.push(`A9:${col(N - 1)}9`); S.heights[8] = 22;
    S.rows.push([]);
    const t0 = S.rows.length; // tables for the two charts, side by side
    S.rows.push([['Marks distribution', 'section'], null, null, ['Grades', 'section']]);
    S.rows.push([['Percentage', 'head'], ['Students', 'head'], null, ['Grade', 'head'], ['Students', 'head']]);
    const n = Math.max(m.bins.length, m.grades.length);
    for (let i = 0; i < n; i++) {
      const b = m.bins[i], g = m.grades[i];
      S.rows.push([b ? [b.label, 'mid'] : null, b ? [b.n, 'num'] : null, null, g ? [g.g, 'mid'] : null, g ? [g.n, 'num'] : null]);
    }
    const c0 = S.rows.length + 1; // first row for charts
    const rng = (sheet, c, r1, count) => `'${sheet}'!$${col(c)}$${r1 + 1}:$${col(c)}$${r1 + count}`;

    // --- Results ---
    const head = ['Rank', 'Class', 'Roll', 'Name', ...(sets ? ['Set'] : []), 'Correct', 'Wrong', 'Not answered', 'Marks', 'Out of', 'Percent', 'Grade'];
    const R = { rows: [head.map((h) => [h, 'head'])], widths: [7, 8, 8, 28, ...(sets ? [6] : []), 10, 10, 13, 9, 9, 14, 8], freeze: 1, heights: { 0: 22 } };
    m.rows.forEach((r) => R.rows.push([[r.rank || '', 'mid'], [r.cls || '?', 'mid'], [r.roll, 'mid'], [r.name, 'text'], ...(sets ? [[r.set || '?', 'mid']] : []),
      ...(r.max != null ? [[r.correct, 'num'], [r.wrong, 'num'], [r.blank, 'num'], [r.score, 'bold'], [r.max, 'num'], [Math.round(r.pct * 10) / 10, 'pct'], [r.grade, 'mid']] : [['', 'num'], ['', 'num'], ['', 'num'], ['', 'num'], ['', 'num'], ['', 'num'], ['set not known', 'mid']])]));
    R.filter = `A1:${col(head.length - 1)}${R.rows.length}`;
    if (m.rows.length) R.bars = [`${col(head.length - 2)}2:${col(head.length - 2)}${R.rows.length}`];

    // --- Questions ---
    const Q = { rows: [[...(sets ? ['Set'] : []), 'Question', 'Key', '% correct', 'A', 'B', 'C', 'D', 'Not answered', 'Multiple'].map((h) => [h, 'head'])], widths: [...(sets ? [6] : []), 10, 7, 14, 7, 7, 7, 7, 13, 10], freeze: 1, heights: { 0: 22 } };
    m.questions.forEach((x) => Q.rows.push([...(sets ? [[x.set, 'mid']] : []), ['Q' + x.q, 'mid'], [x.key || '–', 'bold'], [x.pct == null ? '' : Math.round(x.pct), 'pct'], [x.A, 'num'], [x.B, 'num'], [x.C, 'num'], [x.D, 'num'], [x.blank, 'num'], [x.multi, 'num']]));
    const qc = sets ? 1 : 0;
    if (m.questions.length) Q.bars = [`${col(qc + 2)}2:${col(qc + 2)}${Q.rows.length}`];
    const first = m.questions.filter((x) => x.set === (m.questions[0] || {}).set);

    // --- Answers ---
    const A = { rows: [['Class', 'Roll', 'Name', 'Set', ...Array.from({ length: e.questions }, (_, q) => 'Q' + (q + 1))].map((h) => [h, 'head'])], widths: [8, 8, 26, 6, ...Array(e.questions).fill(5)], freeze: 1, heights: { 0: 22 } };
    m.rows.forEach((r) => A.rows.push([[r.cls || '?', 'mid'], [r.roll, 'mid'], [r.name, 'text'], [r.set || '', 'mid'],
      ...Array.from({ length: e.questions }, (_, q) => { const a = r.answers[q] || '', k = (r.key || [])[q]; return [a, !k || !a ? 'mid' : a === k ? 'right' : 'wrong']; })]));
    A.rows.push([]);
    Object.keys(m.keys).forEach((s) => A.rows.push([null, null, ['ANSWER KEY', 'bold'], [sets ? s : '', 'bold'], ...Array.from({ length: e.questions }, (_, q) => [m.keys[s][q] || '', 'bold'])]));

    const charts = [
      chartXml({ title: 'How the marks are spread', series: 'Students', color: 'B3174F', x: 'Percentage scored', y: 'Students', labels: true, gap: 30,
        cats: { ref: rng('Summary', 0, t0 + 2, m.bins.length), data: m.bins.map((b) => b.label) }, vals: { ref: rng('Summary', 1, t0 + 2, m.bins.length), data: m.bins.map((b) => b.n) } }),
      chartXml({ title: 'Students in each grade', series: 'Students', color: '2A6FB0', x: 'Grade', y: 'Students', labels: true, gap: 50,
        cats: { ref: rng('Summary', 3, t0 + 2, m.grades.length), data: m.grades.map((g) => g.g) }, vals: { ref: rng('Summary', 4, t0 + 2, m.grades.length), data: m.grades.map((g) => g.n) } }),
    ];
    const anchors = [[0, c0, 4, c0 + 17], [4, c0, N, c0 + 17]];
    if (first.length) {
      charts.push(chartXml({ title: 'Question-wise: % of students who got it right' + (sets ? ` (Set ${first[0].set})` : ''), series: '% correct', color: '1A7F43', x: 'Question', y: '% correct', max: 100, gap: 40,
        cats: { ref: rng('Questions', qc, 1, first.length), data: first.map((x) => 'Q' + x.q) }, vals: { ref: rng('Questions', qc + 2, 1, first.length), data: first.map((x) => (x.pct == null ? 0 : Math.round(x.pct))) } }));
      anchors.push([0, c0 + 18, N, c0 + 36]);
    }

    const sheets = [['Summary', S], ['Results', R], ['Questions', Q], ['Answers', A]];
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', PKG = 'http://schemas.openxmlformats.org/package/2006/relationships', DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', CT = 'application/vnd.openxmlformats-officedocument.';
    const files = {
      '[Content_Types].xml': `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="${CT}spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${CT}spreadsheetml.styles+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}spreadsheetml.worksheet+xml"/>`).join('') +
        `<Override PartName="/xl/drawings/drawing1.xml" ContentType="${CT}drawing+xml"/>` + charts.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="${CT}drawingml.chart+xml"/>`).join('') + '</Types>',
      '_rels/.rels': `${X}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${DOC}"><sheets>${sheets.map((s, i) => `<sheet name="${s[0]}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `${X}<Relationships xmlns="${PKG}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${DOC}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${DOC}/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml': stylesXml(),
      'xl/worksheets/_rels/sheet1.xml.rels': `${X}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${DOC}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      'xl/drawings/drawing1.xml': drawingXml(anchors),
      'xl/drawings/_rels/drawing1.xml.rels': `${X}<Relationships xmlns="${PKG}">${charts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${DOC}/chart" Target="../charts/chart${i + 1}.xml"/>`).join('')}</Relationships>`,
    };
    sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s[1])));
    charts.forEach((c, i) => (files[`xl/charts/chart${i + 1}.xml`] = c));
    return zip(files);
  };
})();
