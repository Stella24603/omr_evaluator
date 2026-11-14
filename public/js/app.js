/* App screens: print sheets, exam + answer key, scan + check, results. Data lives in this browser only. */
(function () {
  const OMR = window.OMR;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const KEY = 'omr-evaluator-v1';

  // ---------- state ----------
  const S = Object.assign(
    { tab: 'sheet', sheet: { brand: 'logic', questions: 40, rollDigits: 3, sets: 0, ink: 'pink', title: '', subject: '', date: '' }, logos: {}, exams: [], active: null, results: {}, keySet: 'A' },
    JSON.parse(localStorage.getItem(KEY) || '{}')
  );
  // data saved by the first version: sets were all-or-nothing
  if ('hasSet' in S.sheet) { S.sheet.sets = S.sheet.hasSet ? 4 : 0; delete S.sheet.hasSet; }
  S.exams.forEach((e) => { if ('useSets' in e) { e.sets = e.sets ? 4 : 0; delete e.sets; } });
  let focusId = null; // sheet to scroll to when the scan tab opens
  const IMG = new Map(); // scanned page images, kept for this session only
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { alert('Could not save: browser storage is full. Export results and clear old exams.'); }
    queueSync();
  }
  const exam = () => S.exams.find((e) => e.id === S.active) || null;
  const resultsOf = (e) => (S.results[e.id] = S.results[e.id] || []);
  const setsOf = (e) => (e.sets ? OMR.SETS.slice(0, e.sets) : ['A']);

  // ---------- marking ----------
  function mark(e, r) {
    const set = e.sets ? r.set : 'A';
    if (!set || !setsOf(e).includes(set)) return null;
    const key = e.keys[set] || [];
    let correct = 0, wrong = 0, blank = 0, keyed = 0;
    for (let q = 0; q < e.questions; q++) {
      if (!key[q]) continue;
      keyed++;
      const a = r.answers[q] || '';
      if (!a) blank++; else if (a === key[q]) correct++; else wrong++;
    }
    const max = keyed * e.marks;
    const score = Math.round((correct * e.marks - wrong * e.negative) * 100) / 100;
    const pct = max ? Math.max(0, (score / max) * 100) : 0;
    return { set, key, correct, wrong, blank, keyed, max, score, pct, grade: grade(pct) };
  }
  // WBCHSE grade bands
  function grade(p) {
    return p >= 90 ? 'O' : p >= 80 ? 'A+' : p >= 70 ? 'A' : p >= 60 ? 'B+' : p >= 50 ? 'B' : p >= 40 ? 'C' : p >= 30 ? 'P' : 'F';
  }
  function problems(e, r) {
    const out = (r.flags || []).slice();
    if (r.sheetQ && r.sheetQ !== e.questions) out.push(`This is a ${r.sheetQ}-question sheet but the exam has ${e.questions} questions`);
    if (e.sets && r.set && !setsOf(e).includes(r.set)) out.push(`Set ${r.set} is marked, but this exam only has sets ${setsOf(e).join(', ')}`);
    const dup = resultsOf(e).filter((o) => o !== r && o.roll === r.roll && o.cls === r.cls).length;
    if (dup && !/\?/.test(r.roll)) out.push('Another sheet has the same class and roll number');
    const m = mark(e, r);
    if (m && m.keyed < e.questions) out.push(`Answer key for set ${m.set} has only ${m.keyed} of ${e.questions} answers`);
    return out;
  }
  const toCheck = (e, r) => problems(e, r).length + Object.keys(r.review || {}).filter((q) => q <= e.questions).length;

  // ---------- tabs ----------
  function render() {
    const v = $('#view'); v.onclick = v.onchange = null; // each screen sets its own
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    ({ sheet: viewSheet, exam: viewExam, scan: viewScan, results: viewResults, sync: viewSync })[S.tab]();
  }
  $('#tabs').addEventListener('click', (ev) => {
    const t = ev.target.dataset.tab;
    if (t) { S.tab = t; save(); render(); }
  });

  // ---------- 1. print sheets ----------
  function sheetSvg() {
    const s = S.sheet;
    return OMR.renderSheet({ questions: +s.questions, rollDigits: +s.rollDigits, sets: +s.sets || 0 },
      { brand: s.brand, logo: S.logos[s.brand], ink: s.ink, title: s.title, subject: s.subject, date: s.date });
  }
  function viewSheet() {
    const s = S.sheet;
    const opt = (v, t, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${t}</option>`;
    $('#view').innerHTML = `
    <div class="two">
      <div class="card">
        <h2>Answer sheet</h2>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <label>Institute<select data-k="brand">${opt('logic', 'The Logic Room', s.brand)}${opt('ganita', 'Ganitasastram', s.brand)}</select></label>
          <label>Questions<select data-k="questions">${opt(40, '40 (theory)', s.questions)}${opt(35, '35 (practical)', s.questions)}</select></label>
          <label>Roll number digits<select data-k="rollDigits">${opt(2, '2', s.rollDigits)}${opt(3, '3', s.rollDigits)}${opt(4, '4', s.rollDigits)}</select></label>
          <label>Print colour<select data-k="ink">${Object.keys(OMR.INKS).map((k) => opt(k, OMR.INKS[k].name, s.ink)).join('')}</select></label>
        </div>
        <p><label>Question sets<select data-k="sets">${opt(0, 'No sets', s.sets)}${opt(2, '2 sets (A, B)', s.sets)}${opt(3, '3 sets (A, B, C)', s.sets)}${opt(4, '4 sets (A, B, C, D)', s.sets)}</select></label></p>
        <p class="muted">Optional: print these on the sheet so students need not write them.</p>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <label style="grid-column:1/3">Exam title<input type="text" data-k="title" value="${esc(s.title)}" placeholder="e.g. Semester III Mock Test 2"></label>
          <label>Subject<input type="text" data-k="subject" value="${esc(s.subject)}"></label>
          <label>Date<input type="text" data-k="date" value="${esc(s.date)}" placeholder="dd/mm/yyyy"></label>
        </div>
        <p class="row"><label class="btn">${S.logos[s.brand] ? 'Change' : 'Upload'} logo for ${esc(OMR.BRANDS[s.brand].name)}<input type="file" id="logo" accept="image/*" hidden></label>
        ${S.logos[s.brand] ? '<button class="btn small danger" id="logo-clear">Remove logo</button>' : '<span class="muted">PNG or JPG. A placeholder is shown until then.</span>'}</p>
        <div class="row"><button class="btn primary" id="print">Print / save as PDF</button></div>
        <p class="muted">In the print dialog choose A4, scale 100% (or "Actual size"), margins "None". Print one and photocopy, or print as many copies as you need.</p>
      </div>
      <div class="preview">${sheetSvg()}</div>
    </div>`;
    $('#view').onchange = (ev) => {
      const k = ev.target.dataset.k;
      if (k) { s[k] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value; save(); viewSheet(); }
    };
    $('#logo').onchange = async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 500 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = bmp.width * k; c.height = bmp.height * k;
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      S.logos[s.brand] = c.toDataURL('image/png');
      save(); viewSheet();
    };
    const lc = $('#logo-clear');
    if (lc) lc.onclick = () => { delete S.logos[s.brand]; save(); viewSheet(); };
    $('#print').onclick = () => { $('#print-root').innerHTML = sheetSvg(); window.print(); };
  }

  // ---------- 2. exam & answer key ----------
  function newExam() {
    const e = { id: uid(), name: 'New exam', subject: '', questions: 40, marks: 1, negative: 0, sets: 0, keys: { A: [] } };
    S.exams.push(e); S.active = e.id; S.keySet = 'A'; save();
  }
  function examPicker() {
    return `<div class="row"><label style="flex:1;min-width:200px">Exam<select id="pick">${S.exams.map((x) => `<option value="${x.id}"${x.id === S.active ? ' selected' : ''}>${esc(x.name)}${x.subject ? ' — ' + esc(x.subject) : ''}</option>`).join('')}</select></label>
      <button class="btn" id="new">+ New exam</button></div>`;
  }
  function bindPicker(after) {
    const p = $('#pick');
    if (p) p.onchange = () => { S.active = p.value; S.keySet = 'A'; save(); after(); };
    $('#new').onclick = () => { newExam(); S.tab = 'exam'; save(); render(); };
  }
  function viewExam() {
    const e = exam();
    if (!e) {
      $('#view').innerHTML = `<div class="card"><h2>No exam yet</h2><p>Create an exam, then enter its answer key.</p><button class="btn primary" id="new">+ New exam</button></div>`;
      $('#new').onclick = () => { newExam(); render(); };
      return;
    }
    if (!setsOf(e).includes(S.keySet)) S.keySet = 'A';
    const key = (e.keys[S.keySet] = e.keys[S.keySet] || []);
    const done = key.filter(Boolean).length;
    $('#view').innerHTML = `
    <div class="card">${examPicker()}</div>
    <div class="card"><h2>Exam details</h2>
      <div class="grid">
        <label>Exam name<input type="text" data-k="name" value="${esc(e.name)}"></label>
        <label>Subject<input type="text" data-k="subject" value="${esc(e.subject)}"></label>
        <label>Questions<select data-k="questions"><option value="40"${e.questions == 40 ? ' selected' : ''}>40</option><option value="35"${e.questions == 35 ? ' selected' : ''}>35</option></select></label>
        <label>Marks for a correct answer<input type="number" data-k="marks" min="0" step="0.25" value="${e.marks}"></label>
        <label>Marks cut for a wrong answer<input type="number" data-k="negative" min="0" step="0.25" value="${e.negative}"></label>
        <label>Question sets<select data-k="sets">${[[0, 'No sets'], [2, '2 sets (A, B)'], [3, '3 sets (A, B, C)'], [4, '4 sets (A, B, C, D)']].map(([v, t]) => `<option value="${v}"${(e.sets || 0) == v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <p class="muted">The board pattern is 1 mark each with nothing cut for wrong answers. More than one darkened bubble counts as wrong.</p>
    </div>
    <div class="card"><h2>Answer key <span class="muted">(${done} of ${e.questions} entered)</span></h2>
      ${e.sets ? `<div class="settabs row" style="gap:0;margin-bottom:10px">${setsOf(e).map((s) => `<button data-set="${s}" class="${s === S.keySet ? 'on' : ''}">Set ${s}</button>`).join('')}</div>` : ''}
      <label>Type or paste the key (A, B, C, D; use - for a question to skip)<input type="text" id="keytext" value="${Array.from({ length: e.questions }, (_, q) => key[q] || '-').join('').replace(/-+$/, '')}" autocapitalize="characters" spellcheck="false"></label>
      <div class="keygrid">${Array.from({ length: e.questions }, (_, q) => `<div class="q"><b>${q + 1}</b>${OMR.OPTIONS.map((o) => `<button data-q="${q}" data-o="${o}" class="${key[q] === o ? 'on' : ''}">${o}</button>`).join('')}</div>`).join('')}</div>
      <p class="row"><label class="btn">Read key from a filled sheet photo<input type="file" id="keyphoto" accept="image/*" hidden></label><span class="muted" id="keymsg">Fill a blank sheet with the right answers and photograph it.</span></p>
    </div>
    <p style="text-align:right"><button class="btn danger small" id="del">Delete this exam and its results</button></p>`;
    bindPicker(viewExam);
    $('#view').onchange = (ev) => {
      const k = ev.target.dataset.k;
      if (!k) return;
      const t = ev.target;
      e[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' || k === 'questions' || k === 'sets' ? Math.max(0, +t.value || 0) : t.value;
      save(); viewExam();
    };
    $('#view').onclick = (ev) => {
      const b = ev.target;
      if (b.dataset.set) { S.keySet = b.dataset.set; save(); viewExam(); }
      if (b.dataset.o) { const q = +b.dataset.q; key[q] = key[q] === b.dataset.o ? '' : b.dataset.o; save(); viewExam(); }
    };
    $('#keytext').onchange = (ev) => {
      const chars = ev.target.value.toUpperCase().replace(/[^ABCD\-]/g, '').split('');
      e.keys[S.keySet] = Array.from({ length: e.questions }, (_, q) => (chars[q] && chars[q] !== '-' ? chars[q] : ''));
      save(); viewExam();
    };
    $('#del').onclick = () => {
      if (!confirm(`Delete "${e.name}" and all its results?`)) return;
      S.exams = S.exams.filter((x) => x !== e); delete S.results[e.id];
      S.active = S.exams.length ? S.exams[0].id : null; save(); render();
    };
    $('#keyphoto').onchange = async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      $('#keymsg').textContent = 'Reading…';
      const r = await OMR.scan(f).catch((x) => ({ ok: false, error: String(x) }));
      if (!r.ok) { $('#keymsg').textContent = r.error; return; }
      const bad = r.answers.map((a, q) => (a.length === 1 ? null : q + 1)).filter((q) => q && q <= e.questions);
      e.keys[S.keySet] = Array.from({ length: e.questions }, (_, q) => ((r.answers[q] || '').length === 1 ? r.answers[q] : ''));
      save(); viewExam();
      $('#keymsg').textContent = bad.length ? 'Read the sheet, but could not read question ' + bad.join(', ') + '. Please fill these in by hand.' : 'Key read from the sheet. Please check it once.';
    };
  }

  // ---------- 3. scan & check ----------
  async function overlay(e, r) {
    const im = IMG.get(r.id);
    if (!im) return null;
    const img = new Image();
    img.src = im.image;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const m = mark(e, r);
    ctx.lineWidth = 4;
    im.pos.forEach((row, q) => {
      if (q >= e.questions) return;
      const k = m ? m.key[q] : '';
      const a = r.answers[q] || '';
      row.forEach(([x, y, rad], j) => {
        const o = OMR.OPTIONS[j];
        const picked = a.includes(o);
        if (picked) { ctx.strokeStyle = !k ? '#555' : a === k ? '#1a7f43' : '#c62828'; ctx.setLineDash([]); }
        else if (k === o) { ctx.strokeStyle = '#1a7f43'; ctx.setLineDash([6, 5]); }
        else return;
        ctx.beginPath(); ctx.arc(x, y, rad + 5, 0, 7); ctx.stroke();
      });
    });
    return c.toDataURL('image/jpeg', 0.8);
  }

  function cardHtml(e, r) {
    const m = mark(e, r);
    const prob = problems(e, r);
    const rv = Object.keys(r.review || {}).map(Number).filter((q) => q <= e.questions);
    const sel = (list, cur, k) => `<select data-f="${k}"><option value="">?</option>${list.map((v) => `<option${v === cur ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
    const im = IMG.get(r.id);
    return `
      <div>${im ? `<img class="page" alt="Scanned sheet with marking">` : '<p class="muted">The photo of this sheet is only kept until the page is closed.</p>'}</div>
      <div>
        ${im ? `<img class="name" src="${im.nameCrop}" alt="Name as written on the sheet">` : ''}
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">
          <label>Name<input type="text" data-f="name" value="${esc(r.name)}" placeholder="type the name"></label>
          <label>Class${sel(OMR.CLASSES, r.cls, 'cls')}</label>
          <label>Roll No.<input type="text" data-f="roll" value="${esc(r.roll)}" inputmode="numeric"></label>
          ${e.sets ? `<label>Set${sel(setsOf(e), r.set, 'set')}</label>` : ''}
        </div>
        <p>${m ? `<span class="score">${m.score} / ${m.max}</span> &nbsp; ${m.pct.toFixed(0)}% &nbsp; Grade <b>${m.grade}</b><br><span class="muted">${m.correct} correct, ${m.wrong} wrong, ${m.blank} not answered</span>` : '<span class="flag">Choose the question set to mark this sheet.</span>'}</p>
        ${prob.map((p) => `<div class="flag">${esc(p)}</div>`).join('')}
        ${rv.length ? `<div class="decide"><h3>Your decision needed</h3>${rv.map((q) => {
          const a = r.answers[q - 1] || '';
          return `<div class="q review"><b>${q}</b>${OMR.OPTIONS.map((o) => `<button data-q="${q - 1}" data-o="${o}" class="${a.includes(o) ? 'on' : ''}">${o}</button>`).join('')}
            <button class="word" data-q="${q - 1}" data-o="">Blank</button><button class="word" data-keep="${q}">${a.length > 1 ? 'Count as wrong' : 'Keep as read'}</button>
            <span class="muted">${esc(r.review[q])}${a.length > 1 ? ': ' + a.split('').join(' and ') + ' darkened' : ''}</span></div>`;
        }).join('')}</div>` : ''}
        <details open><summary>All answers read from this sheet. Tap a letter to change an answer; tap it again to make it blank.</summary>
          <div class="keygrid">${Array.from({ length: e.questions }, (_, q) => {
            const a = r.answers[q] || '', k = m ? m.key[q] : '';
            const cls = (r.review && r.review[q + 1] ? ' review' : '') + (k && a ? (a === k ? ' right' : ' wrong') : '');
            return `<div class="q${cls}"><b>${q + 1}</b>${OMR.OPTIONS.map((o) => `<button data-q="${q}" data-o="${o}" class="${a.includes(o) ? 'on' : ''}${k === o ? ' key' : ''}">${o}</button>`).join('')}</div>`;
          }).join('')}</div>
        </details>
        <p><button class="btn small danger" data-del="1">Remove this sheet</button></p>
      </div>`;
  }
  function drawCard(e, r, el) {
    el.innerHTML = cardHtml(e, r);
    const pg = $('img.page', el);
    if (pg) overlay(e, r).then((u) => { if (u) pg.src = u; });
  }
  function viewScan() {
    const e = exam();
    if (!e) { S.tab = 'exam'; return render(); }
    const list = resultsOf(e);
    $('#view').innerHTML = `
      <div class="card">${examPicker()}</div>
      <div class="card"><h2>Add filled sheets</h2>
        <div class="drop"><p>Take photos with the phone camera or choose scanned images (JPG / PNG). Several at once is fine.</p>
          <label class="btn primary">Choose photos<input type="file" id="files" accept="image/*" multiple hidden></label>
          <p class="muted">Keep all four black corner squares in the photo. A tilted or upside-down photo is fine; a flat sheet in even light reads best.</p>
          <div id="progress"></div></div>
      </div>
      <div id="cards"></div>`;
    bindPicker(viewScan);
    const cards = $('#cards');
    const add = (r, first) => {
      const el = document.createElement('div');
      el.className = 'card sheetcard';
      el.dataset.id = r.id;
      first ? cards.prepend(el) : cards.append(el);
      drawCard(e, r, el);
    };
    list.slice().reverse().forEach((r) => add(r));
    if (focusId) { const el = cards.querySelector(`[data-id="${focusId}"]`); focusId = null; if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('focus'); } }
    const find = (t) => { const el = t.closest('.sheetcard'); return el && { el, r: list.find((x) => x.id === el.dataset.id) }; };
    cards.onchange = (ev) => {
      const c = find(ev.target), f = ev.target.dataset.f;
      if (!c || !f) return;
      c.r[f] = ev.target.value.trim() || (f === 'name' || f === 'roll' ? '' : null);
      if (f !== 'name') c.r.flags = (c.r.flags || []).filter((x) => !x.toLowerCase().startsWith(f === 'cls' ? 'class' : f));
      save(); drawCard(e, c.r, c.el);
    };
    cards.onclick = (ev) => {
      const c = find(ev.target), t = ev.target;
      if (!c) return;
      if (t.dataset.keep) {
        delete c.r.review[t.dataset.keep];
        save(); drawCard(e, c.r, c.el);
      } else if ('o' in t.dataset) {
        const q = +t.dataset.q;
        c.r.answers[q] = c.r.answers[q] === t.dataset.o ? '' : t.dataset.o;
        if (c.r.review) delete c.r.review[q + 1];
        save(); drawCard(e, c.r, c.el);
      } else if (t.dataset.del) {
        if (!confirm('Remove this sheet from the results?')) return;
        S.results[e.id] = list.filter((x) => x !== c.r); IMG.delete(c.r.id); save(); viewScan();
      } else if (t.classList.contains('page')) {
        const z = document.createElement('div');
        z.id = 'zoom'; z.innerHTML = `<img src="${t.src}" alt="">`;
        z.onclick = () => z.remove();
        document.body.append(z);
      }
    };
    $('#files').onchange = async (ev) => {
      const files = Array.from(ev.target.files);
      const prog = $('#progress');
      let n = 0;
      for (const f of files) {
        prog.insertAdjacentHTML('beforeend', `<div class="muted" id="p${++n}">Reading ${esc(f.name)}…</div>`);
        await new Promise((ok) => setTimeout(ok, 30)); // let the message show
        const res = await OMR.scan(f).catch((x) => ({ ok: false, error: String(x) }));
        const line = $('#p' + n);
        if (!res.ok) { line.className = 'err'; line.textContent = f.name + ': ' + res.error; continue; }
        line.remove();
        const r = { id: uid(), name: '', cls: res.cls, roll: res.roll, set: res.set, answers: res.answers, flags: res.flags, review: res.review, sheetQ: res.cfg.questions };
        if (!e.sets) r.flags = r.flags.filter((x) => !x.startsWith('Set')); // sets not used in this exam: ignore those bubbles
        else if (!res.cfg.sets) r.flags.push('Set: this sheet has no set bubbles');
        IMG.set(r.id, { image: res.image, nameCrop: res.nameCrop, pos: res.pos });
        list.push(r); save(); add(r, true);
      }
      ev.target.value = '';
    };
  }

  // ---------- 4. results ----------
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function viewResults() {
    const e = exam();
    if (!e) { S.tab = 'exam'; return render(); }
    const rows = resultsOf(e).map((r) => ({ r, m: mark(e, r) }))
      .sort((a, b) => (a.r.cls || '').localeCompare(b.r.cls || '') || a.r.roll.localeCompare(b.r.roll, undefined, { numeric: true }));
    const marked = rows.filter((x) => x.m);
    const scores = marked.map((x) => x.m.score);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const need = rows.filter((x) => toCheck(e, x.r)).length;

    // question-wise analysis, one table per set in use
    const analysis = setsOf(e).map((set) => {
      const grp = marked.filter((x) => x.m.set === set);
      if (!grp.length) return '';
      const key = e.keys[set] || [];
      const qs = Array.from({ length: e.questions }, (_, q) => {
        const c = { A: 0, B: 0, C: 0, D: 0, blank: 0, multi: 0, right: 0 };
        grp.forEach(({ r }) => {
          const a = r.answers[q] || '';
          if (!a) c.blank++; else if (a.length > 1) c.multi++; else c[a]++;
          if (key[q] && a === key[q]) c.right++;
        });
        return { q: q + 1, key: key[q] || '', c, pct: key[q] ? (c.right / grp.length) * 100 : null };
      });
      const hard = qs.filter((x) => x.pct != null).sort((a, b) => a.pct - b.pct).slice(0, 5).filter((x) => x.pct < 60);
      return `<div class="card"><h2>Question-wise analysis${e.sets ? ' — Set ' + set : ''} <span class="muted">(${grp.length} sheets)</span></h2>
        ${hard.length ? `<p>Most missed: ${hard.map((x) => `<b>Q${x.q}</b> (${x.pct.toFixed(0)}% correct)`).join(', ')}</p>` : ''}
        <div class="scroll"><table><tr><th>Q</th><th>Key</th><th>Correct</th><th></th><th class="num">A</th><th class="num">B</th><th class="num">C</th><th class="num">D</th><th class="num">Blank</th><th class="num">Multiple</th></tr>
        ${qs.map((x) => `<tr class="${x.pct != null && x.pct < 40 ? 'hard' : ''}"><td>${x.q}</td><td><b>${x.key || '–'}</b></td><td class="num">${x.pct == null ? '–' : x.pct.toFixed(0) + '%'}</td><td><div class="bar"><i style="width:${x.pct || 0}%"></i></div></td>
          ${OMR.OPTIONS.map((o) => `<td class="num">${x.c[o]}</td>`).join('')}<td class="num">${x.c.blank}</td><td class="num">${x.c.multi}</td></tr>`).join('')}
        </table></div></div>`;
    }).join('');

    $('#view').innerHTML = `
      <div class="card">${examPicker()}</div>
      <div class="card"><h2>${esc(e.name)}${e.subject ? ' — ' + esc(e.subject) : ''}</h2>
        ${rows.length ? '' : '<p class="muted">No sheets scanned for this exam yet. Add them in “3. Scan”.</p>'}
        <div class="stats"${rows.length ? '' : ' hidden'}><div><b>${rows.length}</b>sheets</div><div><b>${avg.toFixed(1)}</b>average</div><div><b>${scores.length ? Math.max(...scores) : '–'}</b>highest</div><div><b>${scores.length ? Math.min(...scores) : '–'}</b>lowest</div><div><b>${need}</b>to check</div></div>
        <div class="row"${rows.length ? '' : ' hidden'}><button class="btn primary" id="csv">Download Excel file (CSV)</button><button class="btn danger" id="clear">Clear all results</button></div>
        ${rows.length ? `<div class="scroll" style="margin-top:12px"><table><tr><th>Class</th><th>Roll</th><th>Name</th>${e.sets ? '<th>Set</th>' : ''}<th class="num">Correct</th><th class="num">Wrong</th><th class="num">Blank</th><th class="num">Marks</th><th class="num">%</th><th>Grade</th><th></th></tr>
        ${rows.map(({ r, m }) => `<tr><td>${esc(r.cls || '?')}</td><td>${esc(r.roll)}</td><td>${esc(r.name)}</td>${e.sets ? `<td>${esc(r.set || '?')}</td>` : ''}
          ${m ? `<td class="num">${m.correct}</td><td class="num">${m.wrong}</td><td class="num">${m.blank}</td><td class="num"><b>${m.score}</b> / ${m.max}</td><td class="num">${m.pct.toFixed(0)}</td><td>${m.grade}</td>` : '<td colspan="6" class="muted">set not known</td>'}
          <td><button class="btn small" data-open="${r.id}">${toCheck(e, r) ? 'Check' : 'Edit'}</button></td></tr>`).join('')}</table></div>` : ''}
      </div>${analysis}`;
    bindPicker(viewResults);
    $('#view').onclick = (ev) => { const id = ev.target.dataset.open; if (id) { S.tab = 'scan'; focusId = id; save(); render(); } };
    $('#clear').onclick = () => { if (confirm('Delete all scanned results for this exam?')) { S.results[e.id] = []; save(); viewResults(); } };
    $('#csv').onclick = () => {
      const head = ['Class', 'Roll', 'Name', 'Set', 'Correct', 'Wrong', 'Not answered', 'Marks', 'Out of', 'Percent', 'Grade', ...Array.from({ length: e.questions }, (_, q) => 'Q' + (q + 1))];
      const body = rows.map(({ r, m }) => [r.cls, r.roll, r.name, m ? m.set : r.set, ...(m ? [m.correct, m.wrong, m.blank, m.score, m.max, m.pct.toFixed(1), m.grade] : ['', '', '', '', '', '', '']), ...Array.from({ length: e.questions }, (_, q) => r.answers[q] || '')]);
      const keys = setsOf(e).map((s) => ['', '', 'ANSWER KEY', s, '', '', '', '', '', '', '', ...Array.from({ length: e.questions }, (_, q) => (e.keys[s] || [])[q] || '')]);
      const csv = '﻿' + [head, ...body, [], ...keys].map((row) => row.map(csvCell).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = (e.name + (e.subject ? ' ' + e.subject : '')).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_results.csv';
      a.click();
    };
  }

  // ---------- keeping devices in step ----------
  // Every exam, result and the sheet settings is one record. Changed records are sent to the
  // server and newer ones fetched; if two devices edit the same record the later edit wins.
  const SKEY = KEY + '-sync';
  const SY = Object.assign({ pass: '', cursor: 0, known: {}, last: 0, error: '' }, JSON.parse(localStorage.getItem(SKEY) || '{}'));
  const saveSync = () => localStorage.setItem(SKEY, JSON.stringify(SY));
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h + ':' + s.length; };
  let syncTimer = null, syncing = false, again = false;

  function records() {
    const d = {};
    S.exams.forEach((e) => (d['exam:' + e.id] = e));
    Object.keys(S.results).forEach((eid) => S.results[eid].forEach((r) => (d['res:' + r.id] = Object.assign({ examId: eid }, r))));
    d['config:main'] = { sheet: S.sheet, logos: S.logos };
    return d;
  }
  function noteChanges(now) {
    const t = Date.now();
    Object.keys(now).forEach((k) => {
      const h = hash(JSON.stringify(now[k])), kn = SY.known[k];
      if (!kn || kn.h !== h || kn.deleted) SY.known[k] = { h, t, dirty: true };
    });
    Object.keys(SY.known).forEach((k) => { if (!(k in now) && !SY.known[k].deleted) SY.known[k] = { t, dirty: true, deleted: true }; });
  }
  function applyRemote(doc) {
    const [kind, id] = [doc.id.slice(0, doc.id.indexOf(':')), doc.id.slice(doc.id.indexOf(':') + 1)];
    if (kind === 'exam') {
      S.exams = S.exams.filter((e) => e.id !== id);
      if (!doc.deleted) S.exams.push(doc.data);
    } else if (kind === 'res') {
      Object.keys(S.results).forEach((eid) => (S.results[eid] = S.results[eid].filter((r) => r.id !== id)));
      if (!doc.deleted) { const r = Object.assign({}, doc.data); delete r.examId; (S.results[doc.data.examId] = S.results[doc.data.examId] || []).push(r); }
    } else if (kind === 'config' && !doc.deleted) { S.sheet = doc.data.sheet; S.logos = doc.data.logos || {}; }
    SY.known[doc.id] = doc.deleted ? { t: doc.t, deleted: true } : { h: hash(JSON.stringify(kind === 'res' ? Object.assign({ examId: doc.data.examId }, doc.data) : doc.data)), t: doc.t };
  }
  async function call(changes, since) {
    const res = await fetch('api/sync', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SY.pass }, body: JSON.stringify({ since, changes }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Server error ' + res.status);
    return body;
  }
  async function syncNow() {
    if (!SY.pass) return;
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      let applied = 0;
      const take = (out) => {
        out.docs.forEach((doc) => { const kn = SY.known[doc.id]; if (!kn || doc.t > kn.t) { applyRemote(doc); applied++; } });
        SY.cursor = out.cursor;
      };
      if (!SY.cursor) take(await call([], 0)); // first time on this device: fetch before sending anything
      const now = records();
      noteChanges(now);
      const sent = Object.keys(SY.known).filter((k) => SY.known[k].dirty);
      const stamp = sent.map((k) => SY.known[k].t);
      take(await call(sent.map((k) => ({ id: k, t: SY.known[k].t, deleted: !!SY.known[k].deleted, data: now[k] })), SY.cursor));
      sent.forEach((k, i) => { if (SY.known[k].t === stamp[i]) delete SY.known[k].dirty; });
      SY.last = Date.now(); SY.error = '';
      if (applied) {
        if (!S.exams.some((e) => e.id === S.active)) S.active = S.exams.length ? S.exams[0].id : null;
        localStorage.setItem(KEY, JSON.stringify(S));
        const el = document.activeElement;
        if (!(el && /^(INPUT|SELECT)$/.test(el.tagName) && el.type !== 'file')) render(); // do not redraw under someone typing
      }
    } catch (e) { SY.error = e.message || String(e); }
    syncing = false;
    saveSync(); showSync();
    if (again) { again = false; queueSync(); }
  }
  function queueSync() {
    if (!SY.pass) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1500);
  }
  function showSync() {
    const dot = $('#syncdot');
    dot.className = !SY.pass ? '' : SY.error ? 'bad' : 'ok';
    const st = $('#syncstate');
    if (st) st.textContent = !SY.pass ? 'Off: data stays on this device only.' : SY.error ? 'Problem: ' + SY.error : SY.last ? 'On. Last synced ' + new Date(SY.last).toLocaleTimeString() + '.' : 'Connecting…';
  }
  function viewSync() {
    $('#view').innerHTML = `<div class="card"><h2>Use on several devices</h2>
      <p>Turn this on with the same passcode on your phone and laptop, and exams, answer keys, results and sheet settings stay the same on both. Photos of sheets are not copied; they stay on the device that scanned them.</p>
      <p id="syncstate" class="muted"></p>
      ${SY.pass
        ? '<div class="row"><button class="btn primary" id="sync-now">Sync now</button><button class="btn danger" id="sync-off">Turn off on this device</button></div>'
        : '<div class="row"><label style="flex:1;min-width:200px">Passcode<input type="password" id="sync-pass" autocomplete="current-password"></label><button class="btn primary" id="sync-on">Turn on</button></div>'}
      <p class="muted">The passcode is the one set on the server as APP_PASSWORD. Anyone with the site address and this passcode can see student names and marks, so keep it private.</p></div>`;
    showSync();
    const on = $('#sync-on');
    if (on) on.onclick = async () => {
      SY.pass = $('#sync-pass').value.trim(); SY.cursor = 0; SY.known = {}; SY.error = '';
      if (!SY.pass) return;
      await syncNow();
      if (/passcode/i.test(SY.error)) { const msg = SY.error; SY.pass = ''; saveSync(); viewSync(); $('#syncstate').textContent = msg; } else viewSync();
    };
    const off = $('#sync-off');
    if (off) off.onclick = () => { SY.pass = ''; SY.cursor = 0; SY.known = {}; SY.error = ''; saveSync(); viewSync(); };
    const nowBtn = $('#sync-now');
    if (nowBtn) nowBtn.onclick = syncNow;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);

  OMR._state = S;
  render();
  showSync();
  syncNow();
})();
