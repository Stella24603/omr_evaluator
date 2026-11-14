/* Two "devices" (separate browser profiles) against a local Cloudflare Pages emulator.
   Start the server first:
     APP_PASSWORD is read from .dev.vars  ->  echo 'APP_PASSWORD=test123' > .dev.vars
     npx wrangler pages dev . --d1 DB --port 8799
   Run: node tests/sync.js */
const { chromium } = require('playwright');
const URL = process.env.OMR_URL || 'http://localhost:8799/';

(async () => {
  const browser = await chromium.launch();
  const fails = [];
  const device = async () => {
    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', (e) => fails.push(String(e)));
    page.on('dialog', (d) => d.accept());
    await page.goto(URL);
    return page;
  };
  const turnOn = async (page, pass) => {
    await page.click('[data-tab=sync]');
    await page.fill('#sync-pass', pass);
    await page.click('#sync-on');
    await page.waitForFunction(() => document.querySelector('#sync-now') || /Wrong/.test(document.querySelector('#syncstate').textContent));
    return page.textContent('#syncstate');
  };
  const synced = (page) => page.evaluate(() => new Promise((ok) => setTimeout(ok, 2500))).then(() => page.click('[data-tab=sync]')).then(() => page.click('#sync-now')).then(() => page.waitForTimeout(800));
  const exams = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('omr-evaluator-v1')).exams.map((e) => e.name + '|' + (e.keys.A || []).join('')));

  const laptop = await device(), phone = await device();

  const wrong = await turnOn(phone, 'not-the-passcode');
  if (!/Wrong passcode/.test(wrong)) fails.push('wrong passcode was not refused: ' + wrong);

  // laptop makes an exam with a key, then turns sync on
  await laptop.click('[data-tab=exam]'); await laptop.click('#new');
  await laptop.fill('[data-k=name]', 'Physics Mock'); await laptop.press('[data-k=name]', 'Tab');
  await laptop.fill('#keytext', 'ABCD'); await laptop.press('#keytext', 'Tab');
  await turnOn(laptop, 'test123');

  // phone turns on: must receive the exam, and must not wipe the laptop's sheet settings
  await laptop.click('[data-tab=sheet]'); await laptop.selectOption('[data-k=questions]', '35');
  await synced(laptop);
  await turnOn(phone, 'test123');
  let got = await exams(phone);
  if (got.join() !== 'Physics Mock|ABCD') fails.push('phone did not get the exam: ' + got);
  const q = await phone.evaluate(() => JSON.parse(localStorage.getItem('omr-evaluator-v1')).sheet.questions);
  if (String(q) !== '35') fails.push('sheet settings not copied to phone: ' + q);

  // phone edits the key and adds a result; laptop should see both
  await phone.click('[data-tab=exam]');
  await phone.fill('#keytext', 'DCBA'); await phone.press('#keytext', 'Tab');
  await phone.evaluate(() => { const s = OMR._state; s.results[s.active] = [{ id: 'r1', name: 'Asha', cls: 'XI', roll: '012', set: null, answers: ['D'], flags: [], review: {} }]; });
  await phone.fill('[data-k=subject]', 'Physics'); await phone.press('[data-k=subject]', 'Tab'); // triggers a save
  await synced(phone); await synced(laptop);
  got = await exams(laptop);
  if (got.join() !== 'Physics Mock|DCBA') fails.push('laptop did not get the edited key: ' + got);
  const res = await laptop.evaluate(() => Object.values(JSON.parse(localStorage.getItem('omr-evaluator-v1')).results).flat().map((r) => r.name + r.roll).join());
  if (res !== 'Asha012') fails.push('laptop did not get the result: ' + res);

  // laptop deletes the exam; it should disappear from the phone
  await laptop.click('[data-tab=exam]'); await laptop.click('#del');
  await synced(laptop); await synced(phone);
  got = await exams(phone);
  if (got.length) fails.push('deleted exam still on phone: ' + got);

  console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'Sync between two devices passed');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
