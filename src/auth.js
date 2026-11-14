/* Teacher accounts and sign-in.
   Needs a D1 database bound as DB and a secret named APP_PASSWORD, which is the setup code asked
   for once, when the first (administrator) account is created. Optional: GOOGLE_CLIENT_ID turns on
   the "Sign in with Google" button for teachers whose email has been added by the administrator. */
let ready = false;
const DAY = 86400000;

export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function prepare(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, hash TEXT, salt TEXT, role TEXT NOT NULL, created INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, owner TEXT NOT NULL, exam TEXT, shared INTEGER NOT NULL DEFAULT 0, data TEXT, t INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS items_seq ON items (seq)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS items_exam ON items (exam)'),
  ]);
  ready = true;
}

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const random = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256));
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const cleanEmail = (s) => String(s || '').trim().toLowerCase();
const cleanName = (s) => String(s || '').trim().slice(0, 60);
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

function checkNew(name, email, password) {
  if (!name) return 'Please enter a name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return 'Please enter a valid email address.';
  if (password != null && String(password).length < 8) return 'The password must have at least 8 characters.';
  return '';
}

async function startSession(env, user) {
  const token = random(32);
  await env.DB.prepare('INSERT INTO sessions (token, user, expires) VALUES (?1, ?2, ?3)').bind(await sha(token), user.id, Date.now() + 90 * DAY).run();
  return json({ token, user: publicUser(user) });
}

/* The signed-in teacher for this request, or null. */
export async function currentUser(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!token) return null;
  const row = await env.DB.prepare('SELECT u.*, s.token AS stoken FROM sessions s JOIN users u ON u.id = s.user WHERE s.token = ?1 AND s.expires > ?2').bind(await sha(token), Date.now()).first();
  return row || null;
}

async function addUser(env, name, email, password, role) {
  const salt = random(16);
  const user = { id: random(8), email, name, role };
  await env.DB.prepare('INSERT INTO users (id, email, name, hash, salt, role, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(user.id, email, name, password ? await hashPassword(password, salt) : null, salt, role, Date.now()).run();
  return user;
}

export async function handleAuth(request, env, path) {
  if (!env.DB) return json({ error: 'The server has no database yet.' }, 503);
  await prepare(env);
  const count = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n;

  if (path === 'state' && request.method === 'GET') return json({ setup: (await count()) === 0, google: env.GOOGLE_CLIENT_ID || '' });
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }

  if (path === 'setup') {
    if (await count()) return json({ error: 'The first account has already been created. Please sign in.' }, 400);
    if (!env.APP_PASSWORD) return json({ error: 'Set the APP_PASSWORD secret on the server first; it is the setup code.' }, 503);
    if (!same(String(body.code || ''), env.APP_PASSWORD)) return json({ error: 'Wrong setup code.' }, 401);
    const name = cleanName(body.name), email = cleanEmail(body.email);
    const bad = checkNew(name, email, body.password);
    if (bad) return json({ error: bad }, 400);
    const user = await addUser(env, name, email, body.password, 'admin');
    // exams saved by the earlier, passcode-only version now belong to the administrator
    try {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO items (id, owner, exam, shared, data, t, deleted, seq) " +
        "SELECT CASE WHEN id = 'config:main' THEN 'config:' || ?1 ELSE id END, ?1, " +
        "CASE WHEN id LIKE 'exam:%' THEN id WHEN id LIKE 'res:%' AND data IS NOT NULL THEN 'exam:' || json_extract(data, '$.examId') END, 0, data, t, deleted, seq FROM docs"
      ).bind(user.id).run();
    } catch (e) { /* no earlier data */ }
    return startSession(env, user);
  }

  if (path === 'login') {
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?1').bind(cleanEmail(body.email)).first();
    const hash = await hashPassword(String(body.password || ''), user ? user.salt : 'none');
    if (!user || !user.hash || !same(hash, user.hash)) return json({ error: 'Wrong email or password.' }, 401);
    return startSession(env, user);
  }

  if (path === 'google') {
    if (!env.GOOGLE_CLIENT_ID) return json({ error: 'Google sign-in is not set up.' }, 400);
    const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(body.credential || '')));
    const info = res.ok ? await res.json() : {};
    if (info.aud !== env.GOOGLE_CLIENT_ID || String(info.email_verified) !== 'true') return json({ error: 'Google could not confirm this account.' }, 401);
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?1').bind(cleanEmail(info.email)).first();
    if (!user) return json({ error: `${info.email} has not been added as a teacher. Ask the administrator to add this email.` }, 403);
    return startSession(env, user);
  }

  // everything below needs a signed-in teacher
  const me = await currentUser(request, env);
  if (!me) return json({ error: 'Please sign in again.' }, 401);

  if (path === 'logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(me.stoken).run();
    return json({ ok: true });
  }
  if (path === 'password') {
    if (String(body.password || '').length < 8) return json({ error: 'The password must have at least 8 characters.' }, 400);
    if (me.hash && !same(await hashPassword(String(body.old || ''), me.salt), me.hash)) return json({ error: 'The current password is wrong.' }, 401);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET hash = ?1 WHERE id = ?2').bind(await hashPassword(body.password, me.salt), me.id),
      env.DB.prepare('DELETE FROM sessions WHERE user = ?1 AND token != ?2').bind(me.id, me.stoken),
    ]);
    return json({ ok: true });
  }

  if (path === 'users') {
    if (me.role !== 'admin') return json({ error: 'Only the administrator can manage teachers.' }, 403);
    const target = body.id ? await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(String(body.id)).first() : null;
    if (body.action === 'add') {
      const name = cleanName(body.name), email = cleanEmail(body.email);
      const bad = checkNew(name, email, body.password || null);
      if (bad) return json({ error: bad }, 400);
      if (!body.password && !env.GOOGLE_CLIENT_ID) return json({ error: 'Please set a password for this teacher.' }, 400);
      if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?1').bind(email).first()) return json({ error: 'A teacher with this email already exists.' }, 400);
      await addUser(env, name, email, body.password || null, 'teacher');
    } else if (body.action === 'reset' && target) {
      if (String(body.password || '').length < 8) return json({ error: 'The password must have at least 8 characters.' }, 400);
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET hash = ?1 WHERE id = ?2').bind(await hashPassword(body.password, target.salt), target.id),
        env.DB.prepare('DELETE FROM sessions WHERE user = ?1').bind(target.id),
      ]);
    } else if (body.action === 'remove' && target) {
      if (target.id === me.id) return json({ error: 'You cannot remove your own account.' }, 400);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE user = ?1').bind(target.id),
        env.DB.prepare('DELETE FROM items WHERE owner = ?1').bind(target.id),
        env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(target.id),
      ]);
    } else if (body.action !== 'list') return json({ error: 'Bad request.' }, 400);
    const all = await env.DB.prepare('SELECT id, email, name, role, hash IS NOT NULL AS pw FROM users ORDER BY created').all();
    return json({ users: all.results.map((u) => Object.assign(publicUser(u), { hasPassword: !!u.pw })) });
  }
  return json({ error: 'Not found' }, 404);
}
