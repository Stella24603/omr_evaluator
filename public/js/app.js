/* App screens: sign-in, exams (answer key, scanning, results), performance, print sheets, account.
   Data is kept in this browser and, when the site runs on its server, copied to the teacher's account. */
(function () {
  const OMR = window.OMR;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const KEY = 'omr-evaluator-v1', AKEY = KEY + '-auth';
  const GRADES = ['O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F'];
  const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'Computer Application', 'Statistics', 'Economics', 'Accountancy', 'English', 'Bengali'];

  let AUTH = JSON.parse(localStorage.getItem(AKEY) || 'null'); // { token, user } once signed in
  let LOCAL = false; // opened without the server: no sign-in, data stays in this browser
  let S, SY, dataKey;
  const UI = { scan: false, details: false, open: new Set(), msgs: [] }; // what is unfolded in the open exam
  let drawTimer = null;

  // ---------- sheet photos: kept on this device (IndexedDB), never sent to the server ----------
  const IMG = new Map(), OV = new Map();
  const idb = new Promise((ok) => {
    try {
      const q = indexedDB.open('omr-images', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('img');
      q.onsuccess = () => ok(q.result); q.onerror = () => ok(null);
    } catch (e) { ok(null); }
  });
  const store = (mode) => idb.then((db) => (db ? db.transaction('img', mode).objectStore('img') : null)).catch(() => null);
  const imgPut = (id, v) => store('readwrite').then((s) => s && s.put(v, id));
  const imgDel = (id) => { IMG.delete(id); OV.delete(id); return store('readwrite').then((s) => s && s.delete(id)); };
  const imgGet = (id) => store('readonly').then((s) => (s ? new Promise((ok) => { const q = s.get(id); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }) : null));

  // ---------- state ----------
  function load() {
    dataKey = LOCAL ? KEY : KEY + ':' + AUTH.user.id;
    let raw = localStorage.getItem(dataKey);
    if (!raw && !LOCAL && localStorage.getItem(KEY)) { // exams made on this device before sign-in existed now belong to this teacher
      raw = localStorage.getItem(KEY);
      localStorage.setItem(dataKey, raw);
      localStorage.removeItem(KEY); localStorage.removeItem(KEY + '-sync');
    }
    S = Object.assign({ tab: 'exams', sheet: {}, logos: {}, logoAsp: {}, exams: [], active: null, open: false, results: {}, keySet: 'A', perf: {} }, JSON.parse(raw || '{}'));
    S.sheet = Object.assign({ brand: 'logic', questions: 40, rollDigits: 3, sets: 0, ink: 'pink', exam: '', title: '', topics: '', subject: '', date: '' }, S.sheet);
    if (!['exams', 'perf', 'sheet', 'account'].includes(S.tab)) S.tab = 'exams';
    // data saved by earlier versions
    if ('hasSet' in S.sheet) { S.sheet.sets = S.sheet.hasSet ? 4 : 0; delete S.sheet.hasSet; }
    S.exams.forEach((e) => {
      if ('useSets' in e) { e.sets = e.sets ? 4 : 0; delete e.useSets; }
      if (!LOCAL && !e.owner) { e.owner = AUTH.user.id; e.ownerName = AUTH.user.name; }
    });
    SY = Object.assign({ cursor: 0, known: {}, last: 0, error: '' }, JSON.parse(localStorage.getItem(dataKey + '-sync') || '{}'));
    OMR._state = S;
  }
  function save() {
    try { localStorage.setItem(dataKey, JSON.stringify(S)); }
    catch (e) { alert('Could not save: browser storage is full. Download the results and delete old exams.'); }
    queueSync();
  }
  const exam = () => S.exams.find((e) => e.id === S.active) || null;
  const mine = (e) => LOCAL || !e.owner || e.owner === AUTH.user.id;
  const resultsOf = (e) => (S.results[e.id] = S.results[e.id] || []);
  const setsOf = (e) => (e.sets ? OMR.SETS.slice(0, e.sets) : ['A']);
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const showDate = (s) => (/^\d{4}-\d\d-\d\d$/.test(s || '') ? s.slice(8) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : s || '');
  const subjectsUsed = () => { const seen = {}; S.exams.forEach((e) => { const s = (e.subject || '').trim(); if (s && !seen[s.toLowerCase()]) seen[s.toLowerCase()] = s; }); return seen; };

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

  /* Everything the results screen, the Excel file and the performance tab need about one exam. cls: only this class. */
  function summary(e, cls) {
    const rows = resultsOf(e).filter((r) => !cls || r.cls === cls).map((r) => ({ r, m: mark(e, r) }))
      .sort((a, b) => (a.r.cls || '').localeCompare(b.r.cls || '') || String(a.r.roll).localeCompare(String(b.r.roll), undefined, { numeric: true }));
    const marked = rows.filter((x) => x.m);
    const pcts = marked.map((x) => x.m.pct).sort((a, b) => a - b), scores = marked.map((x) => x.m.score);
    const n = marked.length, mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const avg = mean(scores), avgPct = mean(pcts);
    const best = n ? Math.max(...scores) : null;
    const bins = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}–${i === 9 ? 100 : i * 10 + 9}%`, n: 0 }));
    pcts.forEach((p) => bins[Math.min(9, Math.floor(p / 10))].n++);
    const byScore = scores.slice().sort((a, b) => b - a);
    marked.forEach((x) => (x.rank = byScore.indexOf(x.m.score) + 1));
    return {
      rows, marked, n, avg, avgPct, best, bins,
      low: n ? Math.min(...scores) : null,
      median: n ? (n % 2 ? pcts[(n - 1) / 2] : (pcts[n / 2 - 1] + pcts[n / 2]) / 2) : 0,
      sd: Math.sqrt(mean(scores.map((s) => (s - avg) * (s - avg)))),
      pass: n ? (pcts.filter((p) => p >= 30).length / n) * 100 : 0,
      max: n ? Math.max(...marked.map((x) => x.m.max)) : 0,
      grades: GRADES.map((g) => ({ g, n: marked.filter((x) => x.m.grade === g).length })),
      toppers: marked.filter((x) => x.m.score === best),
      need: rows.filter((x) => toCheck(e, x.r)).length,
    };
  }
  function questionStats(e, marked) {
    const out = [];
    setsOf(e).forEach((set) => {
      const grp = marked.filter((x) => x.m.set === set);
      if (!grp.length) return;
      const key = e.keys[set] || [];
      for (let q = 0; q < e.questions; q++) {
        const c = { set, n: grp.length, q: q + 1, key: key[q] || '', A: 0, B: 0, C: 0, D: 0, blank: 0, multi: 0, right: 0 };
        grp.forEach(({ r }) => {
          const a = r.answers[q] || '';
          if (!a) c.blank++; else if (a.length > 1) c.multi++; else c[a]++;
          if (key[q] && a === key[q]) c.right++;
        });
        c.pct = key[q] ? (c.right / grp.length) * 100 : null;
        out.push(c);
      }
    });
    return out;
  }

  // ---------- charts (plain SVG; one series each, so one colour and no legend) ----------
  const fmt = (v, d) => (Math.round(v * 10 ** (d || 0)) / 10 ** (d || 0)).toString();
  function axis(max) { // a round top value and 4 steps for a count or percentage axis
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => s * 4 >= max) || Math.ceil(max / 4);
    return { top: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * step) };
  }
  function barChart(items, o) {
    const W = 520, H = 250, L = 38, R = 8, T = 16, B = 46, pw = W - L - R, ph = H - T - B;
    const ax = axis(Math.max(1, ...items.map((d) => d.n)));
    const slot = pw / items.length, bw = Math.min(46, slot - 4);
    const y = (v) => T + ph - (v / ax.top) * ph;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">` +
      ax.ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="${t ? 'grid' : 'base'}"/><text x="${L - 6}" y="${y(t) + 4}" class="tick" text-anchor="end">${t}</text>`).join('') +
      items.map((d, i) => {
        const x = L + i * slot + (slot - bw) / 2, h = (d.n / ax.top) * ph, r = Math.min(4, h);
        return `<g class="mark"><title>${esc(d.tip)}</title><rect x="${L + i * slot}" y="${T}" width="${slot}" height="${ph}" fill="transparent"/>` +
          (d.n ? `<path d="M${x} ${T + ph}v${-(h - r)}q0 ${-r} ${r} ${-r}h${bw - 2 * r}q${r} 0 ${r} ${r}v${h - r}z" class="fill"/><text x="${x + bw / 2}" y="${y(d.n) - 5}" class="val" text-anchor="middle">${d.n}</text>` : '') +
          `<text x="${x + bw / 2}" y="${T + ph + 15}" class="tick" text-anchor="middle">${esc(d.short || d.label)}</text></g>`;
      }).join('') +
      `<text x="${L + pw / 2}" y="${H - 6}" class="axt" text-anchor="middle">${esc(o.x)}</text><text x="11" y="${T + ph / 2}" class="axt" text-anchor="middle" transform="rotate(-90 11 ${T + ph / 2})">${esc(o.y)}</text></svg>`;
  }
  function lineChart(points, o) {
    const W = 760, H = 300, L = 44, R = 26, T = 24, B = 54, pw = W - L - R, ph = H - T - B;
    const x = (i) => (points.length === 1 ? L + pw / 2 : L + (i / (points.length - 1)) * pw), y = (v) => T + ph - (v / 100) * ph;
    const every = Math.ceil(points.length / 10), few = points.length <= 12;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">` +
      [0, 25, 50, 75, 100].map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="${t ? 'grid' : 'base'}"/><text x="${L - 6}" y="${y(t) + 4}" class="tick" text-anchor="end">${t}%</text>`).join('') +
      `<polyline class="line" points="${points.map((p, i) => x(i) + ',' + y(p.v)).join(' ')}"/>` +
      points.map((p, i) => `<g class="mark"><title>${esc(p.tip)}</title><rect x="${x(i) - 16}" y="${T}" width="32" height="${ph}" fill="transparent"/><circle cx="${x(i)}" cy="${y(p.v)}" r="5" class="dot"/>` +
        (few || i === points.length - 1 ? `<text x="${x(i)}" y="${y(p.v) - 10}" class="val" text-anchor="middle">${fmt(p.v)}%</text>` : '') +
        (i % every === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${T + ph + 16}" class="tick" text-anchor="middle">${esc(p.label)}</text><text x="${x(i)}" y="${T + ph + 30}" class="tick" text-anchor="middle">${esc(p.sub)}</text>` : '') + '</g>').join('') +
      `<text x="11" y="${T + ph / 2}" class="axt" text-anchor="middle" transform="rotate(-90 11 ${T + ph / 2})">${esc(o.y)}</text></svg>`;
  }

  // ---------- tabs ----------
  function render() {
    const v = $('#view'); v.onclick = v.onchange = null; // each screen sets its own
    clearTimeout(drawTimer);
    $('#top').hidden = false;
    $('#tabs [data-tab=account]').firstChild.textContent = LOCAL ? 'This device ' : 'Account ';
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    ({ exams: viewExams, perf: viewPerf, sheet: viewSheet, account: viewAccount })[S.tab]();
  }
  $('#tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !S) return;
    if (b.dataset.tab === 'exams' && S.tab === 'exams') S.open = false; // tapping Exams again goes back to the list
    S.tab = b.dataset.tab; save(); render(); window.scrollTo(0, 0);
  });
  /* Redraw the current screen in place: keeps the scroll position and the box being typed in. */
  function redraw() {
    clearTimeout(drawTimer);
    const a = document.activeElement, v = $('#view'), top = window.scrollY;
    let sel = '', val;
    if (a && v.contains(a) && /^(INPUT|SELECT)$/.test(a.tagName) && a.type !== 'file') {
      const card = a.closest('[data-id]');
      sel = (card ? `[data-id="${card.dataset.id}"] ` : '') + (a.id ? '#' + a.id : a.dataset.f ? `[data-f="${a.dataset.f}"]` : a.dataset.k ? `[data-k="${a.dataset.k}"]` : '');
      val = a.value;
    }
    render();
    window.scrollTo(0, top);
    const n = sel && sel.trim() && $(sel, v);
    if (n) { n.focus(); n.value = val; }
  }
  // after typing in a box: wait a moment, so a tap on a button right after is not lost to the redraw
  const redrawSoon = () => { clearTimeout(drawTimer); drawTimer = setTimeout(redraw, 250); };

  // ---------- exams: list ----------
  function newExam() {
    const e = { id: uid(), name: 'New exam', subject: '', topics: '', date: today(), questions: 40, marks: 1, negative: 0, sets: 0, keys: { A: [] }, shared: false };
    if (!LOCAL) { e.owner = AUTH.user.id; e.ownerName = AUTH.user.name; }
    S.exams.push(e); openExam(e.id); UI.details = true; save();
  }
  function openExam(id) {
    S.active = id; S.open = true; S.keySet = 'A';
    UI.scan = UI.details = false; UI.open = new Set(); UI.msgs = [];
  }
  const shareTag = (e) => (LOCAL ? '' : !mine(e) ? `<span class="tag other">Shared by ${esc(e.ownerName || 'another teacher')}</span>` : e.shared ? '<span class="tag shared">Shared with teachers</span>' : '<span class="tag">Private</span>');
  function viewExams() {
    const e = exam();
    if (S.open && e) return viewExam(e);
    const list = S.exams.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('#view').innerHTML = `
      <div class="row between"><h2 class="page">Exams</h2><button class="btn primary" id="new">+ New exam</button></div>
      ${list.length ? `<div class="examcards">${list.map((x) => {
        const s = summary(x);
        return `<button class="examcard" data-exam="${x.id}"><b>${esc(x.name)}</b>
          <span>${esc([x.subject, showDate(x.date)].filter(Boolean).join(' · ') || 'No subject yet')}</span>
          <span class="muted">${s.rows.length ? `${s.rows.length} sheet${s.rows.length > 1 ? 's' : ''}${s.n ? ` · average ${fmt(s.avgPct)}%` : ''}${s.need && mine(x) ? ` · ${s.need} to check` : ''}` : 'No sheets scanned yet'}</span>
          ${shareTag(x)}</button>`;
      }).join('')}</div>` : '<div class="card"><p>No exams yet. Create one, enter its answer key, then scan the filled sheets.</p></div>'}`;
    $('#view').onclick = (ev) => {
      const c = ev.target.closest('[data-exam]');
      if (c) { openExam(c.dataset.exam); save(); render(); window.scrollTo(0, 0); }
      else if (ev.target.id === 'new') { newExam(); render(); window.scrollTo(0, 0); }
    };
  }

  // ---------- exams: one exam ----------
  async function overlay(e, r) {
    const im = IMG.get(r.id);
    if (!im) return null;
    const m = mark(e, r);
    const sig = JSON.stringify([r.answers, m && m.key, e.questions]);
    const had = OV.get(r.id);
    if (had && had.sig === sig) return had.url;
    const img = new Image();
    img.src = im.image;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
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
    const url = c.toDataURL('image/jpeg', 0.8);
    OV.set(r.id, { sig, url });
    return url;
  }
  function cardHtml(e, r, ro) {
    const m = mark(e, r);
    const prob = ro ? [] : problems(e, r);
    const rv = ro ? [] : Object.keys(r.review || {}).map(Number).filter((q) => q <= e.questions);
    const dis = ro ? ' disabled' : '';
    const sel = (list, cur, k) => `<select data-f="${k}"${dis}><option value="">?</option>${list.map((v) => `<option${v === cur ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
    const im = IMG.get(r.id), had = OV.get(r.id);
    return `
      <div>${im ? `<img class="page" alt="Scanned sheet with marking"${had ? ` src="${had.url}"` : ''}>` : `<p class="muted">${im === undefined ? 'Loading the photo…' : 'The photo of this sheet is kept only on the device that scanned it. The answers below can still be corrected.'}</p>`}</div>
      <div>
        ${im ? `<img class="name" src="${im.nameCrop}" alt="Name as written on the sheet">` : ''}
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">
          <label>Name<input type="text" data-f="name" value="${esc(r.name)}" placeholder="type the name"${dis}></label>
          <label>Class${sel(OMR.CLASSES, r.cls, 'cls')}</label>
          <label>Roll No.<input type="text" data-f="roll" value="${esc(r.roll)}" inputmode="numeric"${dis}></label>
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
        <p class="muted">${ro ? 'Answers read from this sheet.' : 'All answers read from this sheet. Tap a letter to change an answer; tap it again to make it blank.'}</p>
        <div class="keygrid">${Array.from({ length: e.questions }, (_, q) => {
          const a = r.answers[q] || '', k = m ? m.key[q] : '';
          const cls = (r.review && r.review[q + 1] && !ro ? ' review' : '') + (k && a ? (a === k ? ' right' : ' wrong') : '');
          return `<div class="q${cls}"><b>${q + 1}</b>${OMR.OPTIONS.map((o) => `<button data-q="${q}" data-o="${o}" class="${a.includes(o) ? 'on' : ''}${k === o ? ' key' : ''}"${dis}>${o}</button>`).join('')}</div>`;
        }).join('')}</div>
        ${ro ? '' : '<p><button class="btn small danger" data-del="1">Remove this sheet</button></p>'}
      </div>`;
  }

  function viewExam(e) {
    const ro = !mine(e), v = $('#view');
    if (!setsOf(e).includes(S.keySet)) S.keySet = 'A';
    const key = (e.keys[S.keySet] = e.keys[S.keySet] || []);
    const done = key.filter(Boolean).length;
    const s = summary(e), list = resultsOf(e), qs = questionStats(e, s.marked);
    const used = subjectsUsed();
    const stat = (v2, label) => `<div><b>${v2}</b>${label}</div>`;
    const who = ({ r, m }) => `${esc(r.name || 'Name not typed')} (${esc(r.cls || '?')}, roll ${esc(r.roll)}) — ${m.score} / ${m.max}`;

    const scanCard = !UI.scan || ro ? '' : `<div class="card"><h2>Scan filled sheets</h2>
      <div class="drop"><p>Take photos with the phone camera or choose scanned images (JPG / PNG). One sheet or many at once.</p>
        <label class="btn primary">Choose photos<input type="file" id="files" accept="image/*" multiple hidden></label>
        <p class="muted">Keep all four black corner squares in the photo. A tilted or upside-down photo is fine; a flat sheet in even light reads best.</p>
        <div id="progress">${UI.msgs.map((x) => `<div class="${x.err ? 'err' : 'muted'}">${esc(x.text)}</div>`).join('')}</div></div></div>`;

    const detailCards = !UI.details || ro ? '' : `<div class="card"><h2>Exam details</h2>
      <div class="grid">
        <label>Exam name<input type="text" data-k="name" value="${esc(e.name)}"></label>
        <label>Subject<input type="text" data-k="subject" list="subjects" value="${esc(e.subject)}" placeholder="choose or type"></label>
        <label>Exam date<input type="date" data-k="date" value="${esc(e.date || '')}"></label>
        <label>Questions<select data-k="questions"><option value="40"${e.questions == 40 ? ' selected' : ''}>40</option><option value="35"${e.questions == 35 ? ' selected' : ''}>35</option></select></label>
        <label>Marks for a correct answer<input type="number" data-k="marks" min="0" step="0.25" value="${e.marks}"></label>
        <label>Marks cut for a wrong answer<input type="number" data-k="negative" min="0" step="0.25" value="${e.negative}"></label>
        <label>Question sets<select data-k="sets">${[[0, 'No sets'], [2, '2 sets (A, B)'], [3, '3 sets (A, B, C)'], [4, '4 sets (A, B, C, D)']].map(([v2, t]) => `<option value="${v2}"${(e.sets || 0) == v2 ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label style="grid-column:1/-1">Topics (printed on the answer sheet under the exam name)<input type="text" data-k="topics" value="${esc(e.topics || '')}" placeholder="e.g. Limits, Continuity, Differentiation"></label>
      </div>
      <datalist id="subjects">${SUBJECTS.concat(Object.values(used).filter((x) => !SUBJECTS.includes(x))).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <p class="muted">The board pattern is 1 mark each with nothing cut for wrong answers. More than one darkened bubble counts as wrong.</p>
    </div>
    <div class="card keycard"><h2>Answer key <span class="muted">(${done} of ${e.questions} entered)</span></h2>
      ${e.sets ? `<div class="settabs row" style="gap:0;margin-bottom:10px">${setsOf(e).map((x) => `<button data-set="${x}" class="${x === S.keySet ? 'on' : ''}">Set ${x}</button>`).join('')}</div>` : ''}
      <label>Type or paste the key (A, B, C, D; use - for a question to skip)<input type="text" id="keytext" value="${Array.from({ length: e.questions }, (_, q) => key[q] || '-').join('').replace(/-+$/, '')}" autocapitalize="characters" spellcheck="false"></label>
      <div class="keygrid">${Array.from({ length: e.questions }, (_, q) => `<div class="q"><b>${q + 1}</b>${OMR.OPTIONS.map((o) => `<button data-q="${q}" data-o="${o}" class="${key[q] === o ? 'on' : ''}">${o}</button>`).join('')}</div>`).join('')}</div>
      <p class="row"><label class="btn">Read key from a filled sheet photo<input type="file" id="keyphoto" accept="image/*" hidden></label><span class="muted" id="keymsg">Fill a blank sheet with the right answers and photograph it.</span></p>
      <p style="text-align:right"><button class="btn danger small" id="del">Delete this exam and its results</button></p>
    </div>`;

    const cols = 10 + (e.sets ? 1 : 0);
    const table = !s.rows.length ? '' : `<div class="card"><h2>Results <span class="muted">(${s.rows.length} sheet${s.rows.length > 1 ? 's' : ''})</span></h2>
      <div class="scroll"><table class="results"><tr><th>Class</th><th>Roll</th><th>Name</th>${e.sets ? '<th>Set</th>' : ''}<th class="num">Correct</th><th class="num">Wrong</th><th class="num">Blank</th><th class="num">Marks</th><th class="num">%</th><th>Grade</th><th></th></tr>
      ${s.rows.map(({ r, m }) => {
        const open = UI.open.has(r.id), chk = !ro && toCheck(e, r);
        return `<tr class="${open ? 'opened' : ''}"><td>${esc(r.cls || '?')}</td><td>${esc(r.roll)}</td><td>${esc(r.name)}</td>${e.sets ? `<td>${esc(r.set || '?')}</td>` : ''}
          ${m ? `<td class="num">${m.correct}</td><td class="num">${m.wrong}</td><td class="num">${m.blank}</td><td class="num"><b>${m.score}</b> / ${m.max}</td><td class="num">${m.pct.toFixed(0)}</td><td>${m.grade}</td>` : '<td colspan="6" class="muted">set not known</td>'}
          <td><button class="btn small${chk && !open ? ' warn' : ''}" data-open="${r.id}" aria-expanded="${open}">${open ? 'Hide sheet ▴' : chk ? 'Check ▾' : 'Show sheet ▾'}</button></td></tr>` +
          (open ? `<tr class="detail"><td colspan="${cols}"><div class="sheetcard" data-id="${r.id}">${cardHtml(e, r, ro)}</div></td></tr>` : '');
      }).join('')}</table></div></div>`;

    const analysis = setsOf(e).map((set) => {
      const g = qs.filter((x) => x.set === set);
      if (!g.length) return '';
      const hard = g.filter((x) => x.pct != null).sort((a, b) => a.pct - b.pct).slice(0, 5).filter((x) => x.pct < 60);
      return `<div class="card"><h2>Question-wise analysis${e.sets ? ' — Set ' + set : ''} <span class="muted">(${g[0].n} sheets)</span></h2>
        ${hard.length ? `<p>Most missed: ${hard.map((x) => `<b>Q${x.q}</b> (${x.pct.toFixed(0)}% correct)`).join(', ')}</p>` : ''}
        <div class="scroll"><table><tr><th>Q</th><th>Key</th><th>Correct</th><th></th><th class="num">A</th><th class="num">B</th><th class="num">C</th><th class="num">D</th><th class="num">Blank</th><th class="num">Multiple</th></tr>
        ${g.map((x) => `<tr class="${x.pct != null && x.pct < 40 ? 'hard' : ''}"><td>${x.q}</td><td><b>${x.key || '–'}</b></td><td class="num">${x.pct == null ? '–' : x.pct.toFixed(0) + '%'}</td><td><div class="bar"><i style="width:${x.pct || 0}%"></i></div></td>
          ${OMR.OPTIONS.map((o) => `<td class="num">${x[o]}</td>`).join('')}<td class="num">${x.blank}</td><td class="num">${x.multi}</td></tr>`).join('')}
        </table></div></div>`;
    }).join('');

    v.innerHTML = `
      <div class="row between"><button class="btn small" id="back">← All exams</button>${shareTag(e)}</div>
      <h2 class="page">${esc(e.name)}${e.subject ? ' — ' + esc(e.subject) : ''} <span class="muted">${esc(showDate(e.date))}</span></h2>
      ${e.topics ? `<p class="muted" style="margin-top:-6px">Topics: ${esc(e.topics)}</p>` : ''}
      <div class="row toolbar">
        ${ro ? '' : `<button class="btn small primary" id="scan-btn" aria-expanded="${UI.scan}">Scan sheets</button>
        <button class="btn small" id="det-btn" aria-expanded="${UI.details}">Details &amp; answer key${done < e.questions ? ' <span class="dotwarn"></span>' : ''}</button>
        <button class="btn small" id="print-btn">Print answer sheet</button>`}
        ${ro || LOCAL ? '' : `<button class="btn small" id="share-btn">${e.shared ? 'Make private' : 'Share with other teachers'}</button>`}
        <button class="btn small" id="xlsx"${s.rows.length ? '' : ' disabled'}>Download Excel file</button>
      </div>
      ${ro ? `<p class="muted">This exam belongs to ${esc(e.ownerName || 'another teacher')}; you can look at it but not change it.</p>` : ''}
      ${scanCard}${detailCards}
      ${s.rows.length ? `<div class="card"><h2>Overview</h2>
        <div class="stats">${stat(s.rows.length, 'sheets')}${stat(s.n ? fmt(s.avg, 1) : '–', `average of ${s.max || e.questions * e.marks}`)}${stat(s.n ? s.best : '–', 'highest')}${stat(s.n ? s.low : '–', 'lowest')}${stat(s.n ? fmt(s.median) + '%' : '–', 'median')}${stat(s.n ? fmt(s.sd, 1) : '–', 'spread (std. deviation)')}${stat(s.n ? fmt(s.pass) + '%' : '–', 'passed (30%+)')}${ro ? '' : stat(s.need, 'to check')}</div>
        ${s.toppers.length ? `<div class="topper"><b>★ Topper${s.toppers.length > 1 ? 's' : ''}</b> ${s.toppers.slice(0, 5).map(who).join(' &nbsp;|&nbsp; ')}${s.toppers.length > 5 ? ` and ${s.toppers.length - 5} more` : ''}</div>` : ''}
        ${s.n ? `<div class="charts"><figure><figcaption>How the marks are spread</figcaption>${barChart(s.bins.map((b, i) => ({ n: b.n, label: b.label, short: i === 9 ? '90+' : i * 10 + '', tip: `${b.label}: ${b.n} student${b.n === 1 ? '' : 's'}` })), { label: 'Number of students in each percentage band', x: 'Percentage scored (band starting at)', y: 'Students' })}</figure>
        <figure><figcaption>Students in each grade</figcaption>${barChart(s.grades.map((g) => ({ n: g.n, label: g.g, tip: `Grade ${g.g}: ${g.n} student${g.n === 1 ? '' : 's'}` })), { label: 'Number of students in each grade', x: 'Grade', y: 'Students' })}</figure></div>` : ''}
      </div>` : `<div class="card"><p class="muted">No sheets scanned for this exam yet.${ro ? '' : ' Use “Scan sheets” above.'}</p></div>`}
      ${table}${analysis}`;

    // photos of the unfolded sheets
    v.querySelectorAll('.sheetcard').forEach((el) => {
      const r = list.find((x) => x.id === el.dataset.id);
      if (!r) return;
      if (!IMG.has(r.id)) return imgGet(r.id).then((im) => { IMG.set(r.id, im); if (el.isConnected) redraw(); });
      const pg = $('img.page', el);
      if (pg) overlay(e, r).then((u) => { if (u && pg.isConnected && pg.getAttribute('src') !== u) pg.src = u; });
    });

    const find = (t) => { const el = t.closest('.sheetcard'); return el && list.find((x) => x.id === el.dataset.id); };
    v.onchange = async (ev) => {
      const t = ev.target, r = find(t);
      if (t.id === 'files') return scanFiles(e, t);
      if (t.id === 'keyphoto') return keyPhoto(e, t);
      if (ro) return;
      if (t.id === 'keytext') {
        const chars = t.value.toUpperCase().replace(/[^ABCD\-]/g, '').split('');
        e.keys[S.keySet] = Array.from({ length: e.questions }, (_, q) => (chars[q] && chars[q] !== '-' ? chars[q] : ''));
      } else if (t.dataset.k) {
        const k = t.dataset.k;
        e[k] = t.type === 'number' || k === 'questions' || k === 'sets' ? Math.max(0, +t.value || 0) : t.value.trim();
        if (k === 'subject') e.subject = used[e.subject.toLowerCase()] || SUBJECTS.find((x) => x.toLowerCase() === e.subject.toLowerCase()) || e.subject;
      } else if (r && t.dataset.f) {
        const f = t.dataset.f;
        r[f] = t.value.trim() || (f === 'name' || f === 'roll' ? '' : null);
        if (f !== 'name') r.flags = (r.flags || []).filter((x) => !x.toLowerCase().startsWith(f === 'cls' ? 'class' : f));
      } else return;
      save(); redrawSoon();
    };
    v.onclick = (ev) => {
      const t = ev.target, b = t.closest('button'), r = find(t);
      if (t.classList.contains('page') && t.src) {
        const z = document.createElement('div');
        z.id = 'zoom'; z.innerHTML = `<img src="${t.src}" alt="">`;
        z.onclick = () => z.remove();
        return document.body.append(z);
      }
      if (!b) return;
      const d = b.dataset;
      if (b.id === 'back') { S.open = false; save(); render(); return window.scrollTo(0, 0); }
      if (b.id === 'xlsx') return downloadXlsx(e);
      if (d.open) { UI.open.has(d.open) ? UI.open.delete(d.open) : UI.open.add(d.open); return redraw(); }
      if (ro) return;
      if (b.id === 'scan-btn') { UI.scan = !UI.scan; UI.msgs = []; return redraw(); }
      if (b.id === 'det-btn') { UI.details = !UI.details; return redraw(); }
      if (b.id === 'print-btn') {
        Object.assign(S.sheet, { exam: e.id, title: e.name, topics: e.topics || '', subject: e.subject, date: showDate(e.date), questions: e.questions, sets: e.sets || 0 });
        S.tab = 'sheet'; save(); render(); return window.scrollTo(0, 0);
      }
      if (b.id === 'share-btn') {
        if (!e.shared && !confirm('Share this exam? The other teachers will be able to see it and its results, but not change them.')) return;
        e.shared = !e.shared;
      } else if (b.id === 'del') {
        if (!confirm(`Delete "${e.name}" and all its results?`)) return;
        list.forEach((x) => imgDel(x.id));
        S.exams = S.exams.filter((x) => x !== e); delete S.results[e.id];
        S.active = null; S.open = false; save(); render(); return window.scrollTo(0, 0);
      } else if (d.set) S.keySet = d.set;
      else if (r && d.keep) delete r.review[d.keep];
      else if (r && d.del) {
        if (!confirm('Remove this sheet from the results?')) return;
        S.results[e.id] = list.filter((x) => x !== r); imgDel(r.id); UI.open.delete(r.id);
      } else if ('o' in d && r) {
        const q = +d.q;
        r.answers[q] = r.answers[q] === d.o ? '' : d.o;
        if (r.review) delete r.review[q + 1];
      } else if ('o' in d && b.closest('.keycard')) { const q = +d.q; key[q] = key[q] === d.o ? '' : d.o; }
      else return;
      save(); redraw();
    };
  }
  async function scanFiles(e, input) {
    const list = resultsOf(e);
    for (const f of Array.from(input.files)) {
      const line = { text: `Reading ${f.name}…` };
      UI.msgs.push(line); redraw();
      await new Promise((ok) => setTimeout(ok, 30)); // let the message show
      const res = await OMR.scan(f).catch((x) => ({ ok: false, error: String(x) }));
      if (!res.ok) { line.err = true; line.text = f.name + ': ' + res.error; continue; }
      UI.msgs.splice(UI.msgs.indexOf(line), 1);
      const r = { id: uid(), name: '', cls: res.cls, roll: res.roll, set: res.set, answers: res.answers, flags: res.flags, review: res.review, sheetQ: res.cfg.questions };
      if (!e.sets) r.flags = r.flags.filter((x) => !x.startsWith('Set')); // sets not used in this exam: ignore those bubbles
      else if (!res.cfg.sets) r.flags.push('Set: this sheet has no set bubbles');
      const im = { image: res.image, nameCrop: res.nameCrop, pos: res.pos };
      IMG.set(r.id, im); imgPut(r.id, im);
      list.push(r); UI.open.add(r.id); // a new sheet opens for checking straight away
      save();
    }
    redraw();
  }
  async function keyPhoto(e, input) {
    const f = input.files[0];
    if (!f) return;
    $('#keymsg').textContent = 'Reading…';
    const r = await OMR.scan(f).catch((x) => ({ ok: false, error: String(x) }));
    if (!r.ok) { $('#keymsg').textContent = r.error; return; }
    const bad = r.answers.map((a, q) => (a.length === 1 ? null : q + 1)).filter((q) => q && q <= e.questions);
    e.keys[S.keySet] = Array.from({ length: e.questions }, (_, q) => ((r.answers[q] || '').length === 1 ? r.answers[q] : ''));
    save(); redraw();
    $('#keymsg').textContent = bad.length ? 'Read the sheet, but could not read question ' + bad.join(', ') + '. Please fill these in by hand.' : 'Key read from the sheet. Please check it once.';
  }
  function downloadXlsx(e) {
    const s = summary(e);
    const ranked = s.rows.slice().sort((a, b) => (a.m ? a.rank : 1e9) - (b.m ? b.rank : 1e9));
    const keys = {};
    setsOf(e).forEach((x) => (keys[x] = e.keys[x] || []));
    const blob = OMR.xlsx({
      exam: { name: e.name, subject: e.subject, date: showDate(e.date), topics: e.topics || '', questions: e.questions, sets: e.sets || 0 },
      rows: ranked.map(({ r, m, rank }) => Object.assign({ rank, cls: r.cls, roll: r.roll, name: r.name, set: m ? m.set : r.set, answers: r.answers }, m ? { correct: m.correct, wrong: m.wrong, blank: m.blank, score: m.score, max: m.max, pct: m.pct, grade: m.grade, key: m.key } : {})),
      stats: [['Sheets', s.rows.length], [`Average (of ${s.max})`, +fmt(s.avg, 1)], ['Highest', s.best == null ? '–' : s.best], ['Lowest', s.low == null ? '–' : s.low], ['Median %', +fmt(s.median)], ['Spread (std. dev.)', +fmt(s.sd, 1)], ['Passed (30%+)', fmt(s.pass) + '%']],
      toppers: s.toppers.map(({ r, m }) => `${r.name || 'Name not typed'} (${r.cls || '?'}, roll ${r.roll}) — ${m.score} / ${m.max} (${fmt(m.pct)}%)`),
      bins: s.bins, grades: s.grades, questions: questionStats(e, s.marked), keys,
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (e.name + (e.subject ? ' ' + e.subject : '')).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_results.xlsx';
    a.click();
  }

  // ---------- performance ----------
  function viewPerf() {
    const used = subjectsUsed(), names = Object.values(used).sort();
    const p = S.perf;
    if (!names.includes(p.subject)) p.subject = names[0] || '';
    const opt = (v, t, cur) => `<option value="${esc(v)}"${String(cur || '') === String(v) ? ' selected' : ''}>${esc(t)}</option>`;
    const rows = S.exams.filter((e) => p.subject && (e.subject || '').trim().toLowerCase() === p.subject.toLowerCase())
      .map((e) => ({ e, s: summary(e, p.cls || '') })).filter((x) => x.s.n)
      .sort((a, b) => (a.e.date || '').localeCompare(b.e.date || ''));
    const undated = rows.filter((x) => !x.e.date).length;
    const avgs = rows.map((x) => x.s.avgPct), last = avgs[avgs.length - 1];
    const change = (i) => (i ? avgs[i] - avgs[i - 1] : null);
    const arrow = (d) => (d == null ? '–' : `<span class="${d > 0.5 ? 'up' : d < -0.5 ? 'down' : ''}">${d > 0.5 ? '▲' : d < -0.5 ? '▼' : '●'} ${d > 0 ? '+' : ''}${fmt(d, 1)}</span>`);
    $('#view').innerHTML = `
      <h2 class="page">Performance</h2>
      <div class="card"><div class="row">
        <label style="flex:1;min-width:180px">Subject<select data-p="subject">${names.length ? names.map((n) => opt(n, n, p.subject)).join('') : '<option>No subject yet</option>'}</select></label>
        <label style="min-width:140px">Class<select data-p="cls">${opt('', 'All classes', p.cls)}${OMR.CLASSES.map((c) => opt(c, c, p.cls)).join('')}</select></label>
      </div><p class="muted">The class average of each exam in this subject, in date order. Shown as a percentage so exams with different total marks can be compared.</p></div>
      ${!rows.length ? `<div class="card"><p class="muted">${names.length ? 'No marked sheets for this subject and class yet.' : 'Give your exams a subject (in the exam, under “Details & answer key”) and scan some sheets; the trend will appear here.'}</p></div>` : `
      <div class="card"><h2>${esc(p.subject)}${p.cls ? ' — Class ' + esc(p.cls) : ''}: average marks, exam by exam</h2>
        <div class="stats"><div><b>${rows.length}</b>exam${rows.length > 1 ? 's' : ''}</div><div><b>${fmt(avgs.reduce((a, b) => a + b, 0) / avgs.length)}%</b>average over all exams</div><div><b>${fmt(last)}%</b>latest exam</div><div><b>${rows.length > 1 ? arrow(last - avgs[0]) : '–'}</b>first exam to latest (points)</div></div>
        ${lineChart(rows.map(({ e, s }, i) => ({ v: s.avgPct, label: e.name.length > 14 ? e.name.slice(0, 13) + '…' : e.name, sub: showDate(e.date).slice(0, 5), tip: `${e.name} (${showDate(e.date) || 'no date'}): average ${fmt(s.avgPct, 1)}% of ${s.n} students` })), { label: 'Average percentage in each exam', y: 'Average marks' })}
        ${undated ? `<p class="flag">${undated} exam${undated > 1 ? 's have' : ' has'} no date and ${undated > 1 ? 'are' : 'is'} placed first. Add the date under “Details & answer key”.</p>` : ''}
        <div class="scroll"><table><tr><th>Exam</th><th>Date</th><th class="num">Students</th><th class="num">Average %</th><th class="num">Highest %</th><th class="num">Lowest %</th><th class="num">Change from previous</th></tr>
        ${rows.map(({ e, s }, i) => `<tr><td><button class="link" data-exam="${e.id}">${esc(e.name)}</button></td><td>${esc(showDate(e.date) || '–')}</td><td class="num">${s.n}</td><td class="num"><b>${fmt(s.avgPct, 1)}</b></td><td class="num">${fmt(Math.max(...s.marked.map((x) => x.m.pct)))}</td><td class="num">${fmt(Math.min(...s.marked.map((x) => x.m.pct)))}</td><td class="num">${arrow(change(i))}</td></tr>`).join('')}
        </table></div></div>`}`;
    $('#view').onchange = (ev) => { const k = ev.target.dataset.p; if (k) { p[k] = ev.target.value; save(); redraw(); } };
    $('#view').onclick = (ev) => { const id = ev.target.dataset.exam; if (id) { openExam(id); S.tab = 'exams'; save(); render(); window.scrollTo(0, 0); } };
  }

  // ---------- print sheets ----------
  function sheetSvg() {
    const s = S.sheet;
    return OMR.renderSheet({ questions: +s.questions, rollDigits: +s.rollDigits, sets: +s.sets || 0 },
      { brand: s.brand, logo: S.logos[s.brand], logoAspect: S.logoAsp[s.brand], ink: s.ink, title: s.title, topics: s.topics, subject: s.subject, date: s.date });
  }
  function viewSheet() {
    const s = S.sheet;
    if (s.exam && !S.exams.some((e) => e.id === s.exam)) s.exam = '';
    const opt = (v, t, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${t}</option>`;
    $('#view').innerHTML = `
    <div class="two">
      <div class="card">
        <h2>Answer sheet</h2>
        <p><label>Exam<select id="sheet-exam">${opt('', 'No exam: type the heading below', s.exam)}${S.exams.map((e) => opt(e.id, esc(e.name) + (e.subject ? ' — ' + esc(e.subject) : ''), s.exam)).join('')}</select></label></p>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <label style="grid-column:1/3">Exam name (the heading of the sheet)<input type="text" data-k="title" value="${esc(s.title)}" placeholder="e.g. Semester III Mock Test 2"></label>
          <label style="grid-column:1/3">Topics (under the heading)<input type="text" data-k="topics" value="${esc(s.topics)}" placeholder="e.g. Limits, Continuity"></label>
          <label>Subject<input type="text" data-k="subject" value="${esc(s.subject)}"></label>
          <label>Date<input type="text" data-k="date" value="${esc(s.date)}" placeholder="dd/mm/yyyy"></label>
          <label>Logo<select data-k="brand">${opt('logic', 'The Logic Room', s.brand)}${opt('ganita', 'Ganitasastram', s.brand)}</select></label>
          <label>Questions<select data-k="questions">${opt(40, '40 (theory)', s.questions)}${opt(35, '35 (practical)', s.questions)}</select></label>
          <label>Roll number digits<select data-k="rollDigits">${opt(2, '2', s.rollDigits)}${opt(3, '3', s.rollDigits)}${opt(4, '4', s.rollDigits)}</select></label>
          <label>Print colour<select data-k="ink">${Object.keys(OMR.INKS).map((k) => opt(k, OMR.INKS[k].name, s.ink)).join('')}</select></label>
          <label style="grid-column:1/3">Question sets<select data-k="sets">${opt(0, 'No sets', s.sets)}${opt(2, '2 sets (A, B)', s.sets)}${opt(3, '3 sets (A, B, C)', s.sets)}${opt(4, '4 sets (A, B, C, D)', s.sets)}</select></label>
        </div>
        <p class="row"><label class="btn small">Use a different logo picture<input type="file" id="logo" accept="image/*" hidden></label>
        ${S.logos[s.brand] ? '<button class="btn small danger" id="logo-clear">Back to the built-in logo</button>' : ''}</p>
        <div class="row"><button class="btn primary" id="print">Print / save as PDF</button></div>
        <p class="muted">In the print dialog choose A4, scale 100% (or "Actual size"), margins "None". Print one and photocopy, or print as many copies as you need.</p>
      </div>
      <div class="preview">${sheetSvg()}</div>
    </div>`;
    $('#view').onchange = (ev) => {
      const t = ev.target, k = t.dataset.k;
      if (t.id === 'sheet-exam') {
        const e = S.exams.find((x) => x.id === t.value);
        s.exam = t.value;
        if (e) Object.assign(s, { title: e.name, topics: e.topics || '', subject: e.subject, date: showDate(e.date), questions: e.questions, sets: e.sets || 0 });
      } else if (k) s[k] = t.value;
      else return;
      save(); redrawSoon();
    };
    $('#logo').onchange = async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = bmp.width * k; c.height = bmp.height * k;
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      S.logos[s.brand] = c.toDataURL('image/png'); S.logoAsp[s.brand] = bmp.width / bmp.height;
      save(); redraw();
    };
    const lc = $('#logo-clear');
    if (lc) lc.onclick = () => { delete S.logos[s.brand]; delete S.logoAsp[s.brand]; save(); redraw(); };
    $('#print').onclick = () => { clearTimeout(drawTimer); $('#print-root').innerHTML = sheetSvg(); window.print(); };
  }

  // ---------- server: sign-in ----------
  async function api(path, body) {
    const res = await fetch('api/' + path, {
      method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: Object.assign({ 'content-type': 'application/json' }, AUTH ? { authorization: 'Bearer ' + AUTH.token } : {}),
    });
    const out = /json/.test(res.headers.get('content-type') || '') ? await res.json().catch(() => ({})) : { notServer: true };
    if (!res.ok) { const err = new Error(out.error || 'Server error ' + res.status); err.status = res.status; throw err; }
    return out;
  }
  function signedIn(out) {
    AUTH = { token: out.token, user: out.user };
    localStorage.setItem(AKEY, JSON.stringify(AUTH));
    start();
  }
  function viewSignIn(st, note) {
    S = null;
    $('#top').hidden = true;
    const v = $('#view');
    v.onclick = v.onchange = null;
    v.innerHTML = `<form class="card signin" id="signin">
      <div class="logos"><img src="img/logo-logic.png" alt="The Logic Room"><img src="img/logo-ganita.png" alt="Ganitasastram"></div>
      <h2>OMR Evaluator</h2>
      ${st.setup ? `<p>Welcome. Create the first account; it will be the administrator, who can add the other teachers.</p>
        <label>Setup code<input type="password" name="code" required autocomplete="off"></label>
        <p class="muted">The setup code is the APP_PASSWORD secret set on the server.</p>
        <label>Your name<input type="text" name="name" required autocomplete="name"></label>` : '<p class="muted">Sign in to see your exams.</p>'}
      <label>Email<input type="email" name="email" required autocomplete="username"></label>
      <label>Password<input type="password" name="password" required minlength="${st.setup ? 8 : 1}" autocomplete="${st.setup ? 'new-password' : 'current-password'}"></label>
      <p id="signmsg" class="${note ? 'flag' : ''}" role="alert">${esc(note || '')}</p>
      <button class="btn primary" type="submit">${st.setup ? 'Create account' : 'Sign in'}</button>
      ${st.google && !st.setup ? '<div class="or">or</div><div id="gbtn"></div>' : ''}
      ${st.setup ? '' : '<p class="muted">Forgot your password? Ask the administrator to set a new one.</p>'}
    </form>`;
    const say = (m) => { const el = $('#signmsg'); if (el) { el.className = 'err'; el.textContent = m; } };
    const go = (path, body) => api(path, body).then(signedIn).catch((e) => say(e.status ? e.message : 'Could not reach the server. Signing in needs an internet connection.'));
    $('#signin').onsubmit = (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      go(st.setup ? 'auth/setup' : 'auth/login', f);
    };
    if (st.google && !st.setup) {
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client';
      sc.onload = () => {
        window.google.accounts.id.initialize({ client_id: st.google, callback: (r) => go('auth/google', { credential: r.credential }) });
        if ($('#gbtn')) window.google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'signin_with' });
      };
      document.head.append(sc);
    }
  }
  async function signOut(note) {
    clearTimeout(syncTimer);
    if (AUTH && !note) api('auth/logout', {}).catch(() => {});
    // a chosen sign-out clears this device; a lapsed session keeps the data for when the teacher signs in again
    if (dataKey && !note) { localStorage.removeItem(dataKey); localStorage.removeItem(dataKey + '-sync'); store('readwrite').then((s) => s && s.clear()); }
    localStorage.removeItem(AKEY);
    AUTH = null; IMG.clear(); OV.clear();
    const st = await api('auth/state').catch(() => ({}));
    viewSignIn(st, note);
  }

  // ---------- account, teachers ----------
  function viewAccount() {
    const v = $('#view');
    if (LOCAL) {
      v.innerHTML = `<div class="card"><h2>This device only</h2><p>The app was opened without its server, so there is no sign-in: exams and results are kept in this browser only and are not copied anywhere.</p></div>`;
      return;
    }
    const u = AUTH.user, admin = u.role === 'admin';
    v.innerHTML = `<div class="card"><h2>${esc(u.name)}</h2>
        <p>${esc(u.email)} · ${admin ? 'Administrator' : 'Teacher'}</p>
        <p id="syncstate" class="muted"></p>
        <div class="row"><button class="btn" id="sync-now">Sync now</button><button class="btn danger" id="signout">Sign out</button></div>
        <p class="muted">Your exams, answer keys and results are saved to your account and appear on every device where you sign in. Only you can see an exam unless you share it. Photos of sheets stay on the device that scanned them.</p></div>
      <form class="card" id="pwform"><h2>Change password</h2><div class="grid">
        <label>Current password<input type="password" name="old" autocomplete="current-password"></label>
        <label>New password (8 characters or more)<input type="password" name="password" required minlength="8" autocomplete="new-password"></label></div>
        <p class="row"><button class="btn" type="submit">Change password</button><span id="pwmsg" class="muted"></span></p></form>
      ${admin ? `<div class="card"><h2>Teachers</h2><div id="teachers" class="muted">Loading…</div>
        <form id="addform"><h3>Add a teacher</h3><div class="grid">
          <label>Name<input type="text" name="name" required></label><label>Email<input type="email" name="email" required></label>
          <label>Password to start with<input type="text" name="password" minlength="8" autocomplete="off"></label></div>
          <p class="row"><button class="btn primary" type="submit">Add teacher</button><span id="addmsg" class="muted"></span></p>
          <p class="muted">Tell the teacher their email and password; they can change the password after signing in.</p></form></div>` : ''}`;
    showSync();
    $('#sync-now').onclick = syncNow;
    $('#signout').onclick = async () => {
      await syncNow();
      if (SY.error && !confirm('The latest changes could not be saved to the server (' + SY.error + '). Sign out anyway and lose them?')) return;
      signOut();
    };
    $('#pwform').onsubmit = (ev) => {
      ev.preventDefault();
      api('auth/password', Object.fromEntries(new FormData(ev.target))).then(() => { ev.target.reset(); $('#pwmsg').textContent = 'Password changed.'; }).catch((e) => { $('#pwmsg').textContent = e.message; });
    };
    if (!admin) return;
    const users = (body, msg) => api('auth/users', body).then((out) => {
      const box = $('#teachers');
      if (!box) return;
      box.className = 'scroll';
      box.innerHTML = `<table><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>${out.users.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.email)}</td><td>${t.role === 'admin' ? 'Administrator' : 'Teacher'}</td>
        <td>${t.id === u.id ? '' : `<button class="btn small" data-reset="${t.id}" data-name="${esc(t.name)}">Set new password</button> <button class="btn small danger" data-remove="${t.id}" data-name="${esc(t.name)}">Remove</button>`}</td></tr>`).join('')}</table>`;
      if (msg) $('#addmsg').textContent = msg;
    }).catch((e) => { $('#addmsg').textContent = e.message; });
    users({ action: 'list' });
    $('#addform').onsubmit = (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      users(Object.assign({ action: 'add' }, f), `${f.name} added.`).then(() => { if (/added/.test($('#addmsg').textContent)) ev.target.reset(); });
    };
    $('#teachers').onclick = (ev) => {
      const d = ev.target.dataset;
      if (d.reset) {
        const password = prompt(`New password for ${d.name} (8 characters or more):`);
        if (password) users({ action: 'reset', id: d.reset, password }, `New password set for ${d.name}.`);
      } else if (d.remove && confirm(`Remove ${d.name}? Their exams and results on the server will be deleted.`)) users({ action: 'remove', id: d.remove }, `${d.name} removed.`);
    };
  }

  // ---------- keeping devices in step ----------
  // Every exam, result and the sheet settings is one record. Changed records are sent to the
  // server and newer ones fetched; if two devices edit the same record the later edit wins.
  // Only this teacher's own records are sent; exams shared by others arrive read-only.
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h + ':' + s.length; };
  const saveSync = () => { if (dataKey && AUTH) localStorage.setItem(dataKey + '-sync', JSON.stringify(SY)); };
  let syncTimer = null, syncing = false, again = false;

  function records() {
    const d = {}, others = {};
    S.exams.forEach((e) => { if (mine(e)) d['exam:' + e.id] = e; else others[e.id] = 1; });
    Object.keys(S.results).forEach((eid) => { if (!others[eid]) S.results[eid].forEach((r) => (d['res:' + r.id] = Object.assign({ examId: eid }, r))); });
    d['config:' + AUTH.user.id] = { sheet: S.sheet, logos: S.logos, logoAsp: S.logoAsp };
    return d;
  }
  function noteChanges(now) {
    const t = Date.now();
    Object.keys(now).forEach((k) => {
      const h = hash(JSON.stringify(now[k])), kn = SY.known[k];
      if (!kn || kn.h !== h || kn.deleted) SY.known[k] = { h, t, dirty: true };
    });
    Object.keys(SY.known).forEach((k) => { const kn = SY.known[k]; if (!(k in now) && !kn.deleted && !kn.ro) SY.known[k] = { t, dirty: true, deleted: true }; });
  }
  function applyRemote(doc) {
    const [kind, id] = [doc.id.slice(0, doc.id.indexOf(':')), doc.id.slice(doc.id.indexOf(':') + 1)];
    const ro = doc.owner !== AUTH.user.id;
    if (kind === 'exam') {
      S.exams = S.exams.filter((e) => e.id !== id);
      if (!doc.deleted) { doc.data.owner = doc.owner; doc.data.ownerName = doc.ownerName; S.exams.push(doc.data); }
    } else if (kind === 'res') {
      Object.keys(S.results).forEach((eid) => (S.results[eid] = S.results[eid].filter((r) => r.id !== id)));
      if (!doc.deleted) { const r = Object.assign({}, doc.data); delete r.examId; (S.results[doc.data.examId] = S.results[doc.data.examId] || []).push(r); }
    } else if (kind === 'config' && !doc.deleted && !ro) { S.sheet = Object.assign(S.sheet, doc.data.sheet); S.logos = doc.data.logos || {}; S.logoAsp = doc.data.logoAsp || {}; }
    SY.known[doc.id] = doc.deleted ? { t: doc.t, deleted: true } : { h: hash(JSON.stringify(doc.data)), t: doc.t };
    if (ro) SY.known[doc.id].ro = true;
  }
  // exams of other teachers that are no longer shared (or were deleted) leave this device
  function dropUnshared(shared) {
    let n = 0;
    S.exams.filter((e) => !mine(e) && !shared.includes(e.id)).forEach((e) => {
      (S.results[e.id] || []).forEach((r) => delete SY.known['res:' + r.id]);
      delete S.results[e.id]; delete SY.known['exam:' + e.id];
      S.exams = S.exams.filter((x) => x !== e); n++;
    });
    return n;
  }
  async function syncNow() {
    if (LOCAL || !AUTH || !S) return;
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      let applied = 0;
      const take = (out) => {
        out.docs.forEach((doc) => { const kn = SY.known[doc.id]; if (!kn || doc.t > kn.t) { applyRemote(doc); applied++; } });
        SY.cursor = out.cursor;
        applied += dropUnshared(out.shared || []);
      };
      if (!SY.cursor) take(await api('sync', { since: 0, changes: [] })); // first time on this device: fetch before sending anything
      const now = records();
      noteChanges(now);
      const sent = Object.keys(SY.known).filter((k) => SY.known[k].dirty);
      const stamp = sent.map((k) => SY.known[k].t);
      take(await api('sync', { since: SY.cursor, changes: sent.map((k) => ({ id: k, t: SY.known[k].t, deleted: !!SY.known[k].deleted, data: now[k] })) }));
      sent.forEach((k, i) => { if (SY.known[k] && SY.known[k].t === stamp[i]) delete SY.known[k].dirty; });
      SY.last = Date.now(); SY.error = '';
      if (applied) {
        if (!S.exams.some((e) => e.id === S.active)) { S.active = null; S.open = false; }
        localStorage.setItem(dataKey, JSON.stringify(S));
        const el = document.activeElement;
        if (!(el && /^(INPUT|SELECT)$/.test(el.tagName) && el.type !== 'file')) redraw(); // do not redraw under someone typing
      }
    } catch (e) {
      if (e.status === 401) { syncing = false; return signOut('Please sign in again.'); }
      SY.error = e.status ? e.message : 'No connection to the server; changes are kept on this device and sent later.';
    }
    syncing = false;
    saveSync(); showSync();
    if (again) { again = false; queueSync(); }
  }
  function queueSync() {
    if (LOCAL || !AUTH) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1500);
  }
  function showSync() {
    const dot = $('#syncdot');
    dot.className = LOCAL || !SY ? '' : SY.error ? 'bad' : 'ok';
    dot.title = LOCAL ? '' : SY && SY.error ? 'Not saved to your account yet' : 'Saved to your account';
    const st = $('#syncstate');
    if (st && SY) st.textContent = SY.error ? 'Problem: ' + SY.error : SY.last ? 'Saved to your account. Last synced ' + new Date(SY.last).toLocaleTimeString() + '.' : 'Connecting…';
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);

  // ---------- start ----------
  function start() {
    load();
    render();
    showSync();
    syncNow();
  }
  (async function boot() {
    if (!/^https?:$/.test(location.protocol)) { LOCAL = true; return start(); }
    if (AUTH) return start(); // signed in before: open straight away, also without internet
    try {
      const st = await api('auth/state');
      if (st.notServer) { LOCAL = true; return start(); }
      viewSignIn(st);
    } catch (e) {
      if (e.status === 404) { LOCAL = true; return start(); } // a plain file host without the server part
      viewSignIn({}, e.status ? e.message : 'Could not reach the server. Signing in needs an internet connection.');
    }
  })();
})();
