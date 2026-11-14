/* Walks through the app like a teacher would: make an exam, enter the key, upload a photo, read the marks.
   Run: node tests/ui.js [screenshot-dir] */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

(async () => {
  const shots = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto('file://' + path.join(__dirname, '..', 'public', 'index.html'));
  const shot = async (n) => shots && page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true });
  await shot('1-sheet');

  // exam with 40 questions, key ABCDABCD..., minus 0.25 for wrong
  await page.click('[data-tab=exam]');
  await page.click('#new');
  await page.fill('[data-k=name]', 'Mock Test 1'); await page.press('[data-k=name]', 'Tab');
  await page.fill('[data-k=negative]', '0.25'); await page.press('[data-k=negative]', 'Tab');
  const key = 'ABCD'.repeat(10);
  await page.fill('#keytext', key); await page.press('#keytext', 'Tab');
  await shot('2-exam');

  // a filled sheet: Q1-30 right, Q31-36 wrong, Q37-38 blank, Q39 two bubbles, Q40 right; class XII roll 047 set C
  const dataUrl = await page.evaluate(async (key) => {
    const cfg = { questions: 40, rollDigits: 3, hasSet: true }, L = OMR.layout(cfg), PX = 8;
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([OMR.renderSheet(cfg, { ink: 'pink' })], { type: 'image/svg+xml' }));
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 1900; c.height = 2600;
    const x = c.getContext('2d');
    x.fillStyle = '#5a4636'; x.fillRect(0, 0, c.width, c.height);
    x.translate(130, 60); x.rotate(0.04);
    x.drawImage(img, 0, 0, 210 * PX, 297 * PX);
    x.fillStyle = '#1a2f8f';
    const dot = (p, r) => { x.beginPath(); x.arc(p.x * PX, p.y * PX, r * PX * 0.9, 0, 7); x.fill(); };
    dot(L.cls[1], 2.3); dot(L.set[2], 2.3);
    '047'.split('').forEach((d, i) => dot(L.roll[i][+d], 2));
    L.answers.forEach((row, q) => {
      const k = 'ABCD'.indexOf(key[q]);
      if (q < 30 || q === 39) dot(row[k], 2.3);
      else if (q < 36) dot(row[(k + 1) % 4], 2.3);
      else if (q === 38) { dot(row[0], 2.3); dot(row[1], 2.3); }
    });
    return c.toDataURL('image/jpeg', 0.9);
  }, key);
  const file = path.join(os.tmpdir(), 'omr-ui-test.jpg');
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

  await page.click('[data-tab=scan]');
  await page.setInputFiles('#files', file);
  await page.waitForSelector('.sheetcard .score', { timeout: 60000 });
  await page.waitForFunction(() => { const i = document.querySelector('img.page'); return i && i.src.startsWith('data:'); });
  const got = await page.evaluate(() => {
    const s = OMR._state, r = s.results[s.active][0];
    return { cls: r.cls, roll: r.roll, set: r.set, score: document.querySelector('.score').textContent.trim(), answers: r.answers.join(',') };
  });
  await shot('3-scan');
  await page.click('[data-tab=results]');
  await shot('4-results');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');

  // without sets the exam uses key A: 31 right, 7 wrong (6 + the double), 2 blank -> 31 - 1.75 = 29.25
  const want = { cls: 'XII', roll: '047', set: 'C', score: '29.25 / 40' };
  const fails = Object.keys(want).filter((k) => got[k] !== want[k]).map((k) => `${k}: got ${got[k]}, want ${want[k]}`);
  if (!csv.includes('XII,047,,A,31,7,2,29.25,40')) fails.push('CSV row wrong: ' + csv.split('\r\n')[1]);
  fails.push(...errors);
  console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'UI walk-through passed: ' + JSON.stringify(got.score));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
