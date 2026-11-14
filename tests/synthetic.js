/* End-to-end check of the reader: prints a sheet, fills it in at random, turns it into a fake
   phone photo (perspective, rotation, paper curl, uneven light, blur, noise) and reads it back.
   Run: node tests/synthetic.js [trials] */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const trials = Number(process.argv[2] || 24);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  for (const f of ['layout.js', 'sheet.js', 'scan.js']) await page.addScriptTag({ path: path.join(__dirname, '..', 'public', 'js', f) });
  page.on('console', (m) => console.log('  [page]', m.text()));

  const out = await page.evaluate(async (trials) => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const failures = [];
    let checked = 0;

    for (let t = 0; t < trials; t++) {
      const cfg = { questions: pick([35, 40]), rollDigits: pick([2, 3, 4]), sets: pick([0, 2, 3, 4]) };
      const ink = pick(Object.keys(OMR.INKS));
      const pen = pick(['#111', '#1a2f8f', '#203a9c', '#222']);
      const L = OMR.layout(cfg);
      const PX = 8;
      // 1. render the blank sheet
      const svg = OMR.renderSheet(cfg, { ink, brand: 'logic', subject: 'PHYSICS', date: '14/11/2026' });
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await img.decode();
      const sheet = document.createElement('canvas');
      sheet.width = 210 * PX; sheet.height = 297 * PX;
      const sc = sheet.getContext('2d');
      sc.drawImage(img, 0, 0, sheet.width, sheet.height);

      // 2. fill it in like a student would
      const fill = (p, r, light) => {
        sc.globalAlpha = light ? 0.3 : 0.8 + rnd() * 0.2;
        sc.fillStyle = pen;
        sc.beginPath();
        sc.arc((p.x + (rnd() - 0.5) * 0.5) * PX, (p.y + (rnd() - 0.5) * 0.5) * PX, r * (0.82 + rnd() * 0.2) * PX, 0, 7);
        sc.fill();
        sc.globalAlpha = 1;
      };
      const truth = { cls: pick(L.cls), set: cfg.sets ? pick(L.set) : null, roll: '', answers: [] };
      fill(truth.cls, L.r.cls);
      if (truth.set) fill(truth.set, L.r.set);
      L.roll.forEach((col) => { const p = pick(col); truth.roll += p.v; fill(p, L.r.roll); });
      L.answers.forEach((row) => {
        const k = rnd();
        if (k < 0.1) { truth.answers.push(''); return; }              // left blank
        if (k < 0.16) {                                                // two bubbles
          const a = Math.floor(rnd() * 3);
          fill(row[a], L.r.ans); fill(row[a + 1], L.r.ans);
          truth.answers.push(row[a].v + row[a + 1].v); return;
        }
        const p = pick(row);
        fill(p, L.r.ans);
        truth.answers.push(p.v);
      });
      // handwriting and a tick in the teacher's box must not confuse the reader
      sc.strokeStyle = pen; sc.lineWidth = 3; sc.font = '60px cursive'; sc.fillStyle = pen;
      sc.fillText('RAHUL SEN', 60 * PX, 56 * PX);
      sc.fillText('32', (L.teacher.x + 10) * PX, (L.teacher.y + 28) * PX);

      // 3. photograph it
      const rot = pick([0, 0, 0, 1, 2, 3]);
      const landscape = rot % 2 === 1;
      const pw = landscape ? 2000 : 1500, ph = landscape ? 1500 : 2000;
      const room = pick([0.05, 0.1, 0.18]), tilt = pick([0.05, 0.1, 0.16]); // how much table shows, how steep the angle
      const mx = pw * (room + tilt / 2), my = ph * (room + tilt / 2), j = () => (rnd() - 0.5) * pw * tilt;
      let quad = [[mx + j(), my + j()], [pw - mx + j(), my + j()], [pw - mx + j(), ph - my + j()], [mx + j(), ph - my + j()]];
      for (let i = 0; i < rot; i++) quad.push(quad.shift());
      const H = OMR._solveH(quad, [[0, 0], [210, 0], [210, 297], [0, 297]]); // photo px -> mm
      const sdat = sc.getImageData(0, 0, sheet.width, sheet.height).data;
      const photo = document.createElement('canvas');
      photo.width = pw; photo.height = ph;
      const pc = photo.getContext('2d');
      const pd = pc.createImageData(pw, ph);
      const bend = pick([0, 1.5, 3]), bendU = (rnd() - 0.5) * 2 * bend, bendV = (rnd() - 0.5) * 2 * bend, shadow = rnd() < 0.4 ? 0.6 : 1, sx = rnd() * pw;
      const clutter = pick(['none', 'keys', 'carpet']), curl = rnd() * 0.9, lx = rnd() - 0.5, ly = rnd() - 0.5, bg = pick([[60, 45, 35], [150, 120, 90], [30, 30, 34], [200, 200, 195]]);
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        let [u, v] = OMR._applyH(H, x, y);
        u += curl * Math.sin(v / 47) + bendU * Math.sin(Math.PI * v / 297); v += curl * Math.sin(u / 33) + bendV * Math.sin(Math.PI * u / 210); // ripples, and a sheet bowed in the hand
        const i = (y * pw + x) * 4;
        const shade = 0.78 + 0.22 * (0.5 + lx * (x / pw - 0.5) + ly * (y / ph - 0.5)) * 2 * 0.5 + 0.11;
        let c;
        if (u < 0 || v < 0 || u >= 209.9 || v >= 296.9) c = clutter === 'keys' ? (x % 97 < 70 && y % 83 < 60 ? [30, 30, 34] : [70, 70, 75]) : clutter === 'carpet' ? ((((x / 23) | 0) + ((y / 19) | 0)) % 3 === 0 && (x * 7 + y * 13) % 11 < 7 ? [70, 20, 25] : (x % 46 < 14 && y % 38 < 14 ? [40, 30, 60] : [215, 200, 180])) : bg;
        else { const k = (Math.floor(v * PX) * sheet.width + Math.floor(u * PX)) * 4; c = [sdat[k], sdat[k + 1], sdat[k + 2]]; }
        const n = (rnd() - 0.5) * 16;
        const sh = shade * (x > sx ? 1 : shadow); // a hard shadow edge across the photo
        pd.data[i] = c[0] * sh * 0.97 + n; if (0) pd.data[i] = c[0] * shade * 0.97 + n; pd.data[i + 1] = c[1] * sh * 0.92 + n; pd.data[i + 2] = c[2] * sh * 0.9 + n; pd.data[i + 3] = 255;
      }
      pc.putImageData(pd, 0, 0);
      const blurred = document.createElement('canvas');
      blurred.width = pw; blurred.height = ph;
      const bc = blurred.getContext('2d');
      bc.filter = `blur(${(rnd() * 1.4).toFixed(2)}px)`;
      bc.drawImage(photo, 0, 0);

      // 4. read it back
      const tA = performance.now(); const r = await OMR.scan(blurred); (window.__ms = window.__ms || []).push([Math.round(performance.now() - tA), clutter]);
      const tag = `trial ${t} q=${cfg.questions} roll=${cfg.rollDigits} sets=${cfg.sets} ink=${ink} pen=${pen} rot=${rot} curl=${curl.toFixed(2)} room=${room} tilt=${tilt} clutter=${clutter} bend=${bendU.toFixed(1)},${bendV.toFixed(1)} shadow=${shadow}`;
      if (!r.ok) { const tm = [[11, 11], [199, 11], [199, 286], [11, 286]].map(([a, b]) => OMR._applyH(OMR._solveH([[0, 0], [210, 0], [210, 297], [0, 297]], quad), a, b).map(Math.round)); failures.push(tag + ' -> NOTFOUND true=' + JSON.stringify(tm) + ' near=' + JSON.stringify(tm.map((m) => OMR._dbg.cands.filter((c) => Math.hypot(c[0] - m[0], c[1] - m[1]) < 12).map((c) => c[2]))) + ' n=' + OMR._dbg.cands.length + ' log=' + OMR._dbg.log.slice(0, 6).join(' | ')); if (!window.__sample) window.__sample = { photo: blurred.toDataURL('image/jpeg', 0.85), flat: blurred.toDataURL('image/jpeg', 0.5) }; continue; }
      const errs = [];
      if (JSON.stringify(r.cfg) !== JSON.stringify(cfg)) errs.push('cfg ' + JSON.stringify(r.cfg));
      if (r.cls !== truth.cls.v) errs.push(`class ${r.cls} != ${truth.cls.v}`);
      if ((r.set || null) !== (truth.set ? truth.set.v : null)) errs.push(`set ${r.set}`);
      if (r.roll !== truth.roll) errs.push(`roll ${r.roll} != ${truth.roll}`);
      truth.answers.forEach((a, q) => { checked++; if (r.answers[q] !== a) errs.push(`Q${q + 1} read "${r.answers[q]}" want "${a}"`); });
      if (errs.length > 5 && !window.__bad) { window.__bad = 1; window.__sample = { photo: blurred.toDataURL('image/jpeg', 0.85), flat: r.image }; }
      if (errs.length) failures.push(tag + ' -> ' + errs.join('; ') + ` (base ${r._debug.base.toFixed(3)})`);
      
    }
    const ms = (k) => { const a = window.__ms.filter((x) => k(x[1])).map((x) => x[0]).sort((x, y) => x - y); return a.length ? `median ${a[a.length >> 1]} ms, slowest ${a[a.length - 1]} ms` : 'none'; }; console.log('time per photo, plain or keyboard background: ' + ms((c) => c !== 'carpet') + '; patterned carpet: ' + ms((c) => c === 'carpet')); return { failures, checked, sample: window.__sample };
  }, trials);

  const fs = require('fs');
  const dir = process.env.OMR_TEST_OUT;
  if (dir && out.sample) {
    for (const k of ['photo', 'flat']) fs.writeFileSync(path.join(dir, k + '.jpg'), Buffer.from(out.sample[k].split(',')[1], 'base64'));
  }
  console.log(`${trials} synthetic photos, ${out.checked} answers checked, ${out.failures.length} sheets with a misread`);
  out.failures.forEach((f) => console.log('  FAIL ' + f));
  await browser.close();
  process.exit(out.failures.length ? 1 : 0);
})();
