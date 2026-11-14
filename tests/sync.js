/* Sign-in, syncing and sharing, with separate browser profiles as "devices", against a local server.
   Start the server first, with an empty database:
     echo 'APP_PASSWORD=test123' > .dev.vars
     rm -rf .wrangler && npx wrangler dev --port 8799
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
    await page.waitForSelector('#signin');
    return page;
  };
  const signIn = async (page, email, password) => {
    await page.fill('[name=email]', email); await page.fill('[name=password]', password);
    await page.click('#signin button[type=submit]');
    await page.waitForFunction(() => !document.querySelector('#top').hidden || document.querySelector('#signmsg.err'));
    return page.evaluate(() => (document.querySelector('#signmsg') || {}).textContent || '');
  };
  const synced = async (page) => { await page.waitForTimeout(2200); await page.click('[data-tab=account]'); await page.click('#sync-now'); await page.waitForTimeout(900); };
  const exams = (page) => page.evaluate(() => OMR._state.exams.map((e) => e.name + '|' + (e.keys.A || []).join('') + '|' + (OMR._state.results[e.id] || []).map((r) => r.name).join()));

  // first visit: the administrator account is created with the setup code
  const laptop = await device();
  await page_setup(laptop, 'wrong-code');
  if (!/Wrong setup code/.test(await laptop.textContent('#signmsg'))) fails.push('wrong setup code was not refused');
  await page_setup(laptop, 'test123');
  await laptop.waitForFunction(() => !document.querySelector('#top').hidden);
  async function page_setup(page, code) {
    await page.fill('[name=code]', code); await page.fill('[name=name]', 'Head Teacher');
    await page.fill('[name=email]', 'head@example.com'); await page.fill('[name=password]', 'head-pass-1');
    await page.click('#signin button[type=submit]');
    await page.waitForTimeout(1500);
  }

  // the administrator adds a teacher
  await laptop.click('[data-tab=account]');
  await laptop.fill('#addform [name=name]', 'Second Teacher'); await laptop.fill('#addform [name=email]', 'second@example.com'); await laptop.fill('#addform [name=password]', 'second-pass-1');
  await laptop.click('#addform button[type=submit]');
  await laptop.waitForFunction(() => /added/.test(document.querySelector('#addmsg').textContent));

  // the administrator makes an exam with a key and one result
  await laptop.click('[data-tab=exams]'); await laptop.click('#new');
  await laptop.fill('[data-k=name]', 'Physics Mock'); await laptop.press('[data-k=name]', 'Tab');
  await laptop.fill('#keytext', 'ABCD'); await laptop.press('#keytext', 'Tab');
  await laptop.evaluate(() => { const s = OMR._state; s.results[s.active] = [{ id: 'r1', name: 'Asha', cls: 'XI', roll: '012', set: null, answers: ['A'], flags: [], review: {} }]; });
  await laptop.fill('[data-k=subject]', 'Physics'); await laptop.press('[data-k=subject]', 'Tab'); // triggers a save
  await synced(laptop);

  // the same teacher on a phone gets everything
  const phone = await device();
  const bad = await signIn(phone, 'head@example.com', 'not-the-password');
  if (!/Wrong email or password/.test(bad)) fails.push('wrong password was not refused: ' + bad);
  await signIn(phone, 'head@example.com', 'head-pass-1');
  await synced(phone);
  let got = await exams(phone);
  if (got.join() !== 'Physics Mock|ABCD|Asha') fails.push('phone did not get the exam: ' + got);

  // the other teacher sees nothing while the exam is private
  const other = await device();
  await signIn(other, 'second@example.com', 'second-pass-1');
  await synced(other);
  got = await exams(other);
  if (got.length) fails.push('a private exam is visible to another teacher: ' + got);
  if (await other.locator('#addform').count()) fails.push('a teacher can see the administrator tools');

  // shared from the phone: the other teacher sees it with its results, read-only
  await phone.click('[data-tab=exams]'); await phone.click('[data-exam]'); await phone.click('#share-btn');
  await synced(phone); await synced(other);
  got = await exams(other);
  if (got.join() !== 'Physics Mock|ABCD|Asha') fails.push('shared exam did not reach the other teacher: ' + got);
  await other.click('[data-tab=exams]'); await other.click('[data-exam]');
  if (await other.locator('#scan-btn, #det-btn, #share-btn').count()) fails.push('a shared exam can be edited by another teacher');
  if (!/Shared by Head Teacher/.test(await other.textContent('#view'))) fails.push('shared exam does not say whose it is');
  // even a forged change from the other teacher is ignored by the server
  await other.evaluate(async () => {
    const a = JSON.parse(localStorage.getItem('omr-evaluator-v1-auth')), e = OMR._state.exams[0];
    await fetch('api/sync', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: JSON.stringify({ since: 0, changes: [{ id: 'exam:' + e.id, t: Date.now() + 5000, data: Object.assign({}, e, { name: 'Hacked' }) }] }) });
  });
  await synced(laptop);
  got = await exams(laptop);
  if (got.join() !== 'Physics Mock|ABCD|Asha') fails.push('another teacher could change the exam: ' + got);

  // made private again: it disappears from the other teacher
  await phone.click('[data-tab=exams]'); await phone.click('#share-btn');
  await synced(phone); await synced(other);
  got = await exams(other);
  if (got.length) fails.push('exam still visible after being made private: ' + got);
  // and shared once more: it comes back complete
  await phone.click('[data-tab=exams]'); await phone.click('#share-btn');
  await synced(phone); await synced(other);
  got = await exams(other);
  if (got.join() !== 'Physics Mock|ABCD|Asha') fails.push('re-shared exam did not come back: ' + got);

  // the owner deletes the exam: gone everywhere
  await laptop.click('[data-tab=exams]'); if (await laptop.locator('[data-exam]').count()) await laptop.click('[data-exam]');
  if (!(await laptop.locator('#del').count())) await laptop.click('#det-btn');
  await laptop.click('#del');
  await synced(laptop); await synced(phone); await synced(other);
  got = (await exams(phone)).concat(await exams(other));
  if (got.length) fails.push('deleted exam still on a device: ' + got);

  // signing out clears the device and asks for sign-in again
  await other.click('#signout');
  await other.waitForSelector('#signin');
  if (await other.evaluate(() => Object.keys(localStorage).length)) fails.push('data left on the device after sign-out');
  const noAuth = await other.evaluate(() => fetch('api/sync', { method: 'POST', body: '{}' }).then((r) => r.status));
  if (noAuth !== 401) fails.push('sync without sign-in answered ' + noAuth);

  console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'Sign-in, sync and sharing passed');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
