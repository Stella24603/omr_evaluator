/* Keeps exams, answer keys and results the same on every device.
   Needs a D1 database bound as DB (wrangler.jsonc) and a secret named APP_PASSWORD (dashboard).
   Each record is stored whole; when two devices change the same record the later change wins. */
let ready = false;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function samePass(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleSync(request, env) {
  if (!env.DB || !env.APP_PASSWORD) return json({ error: 'Sync is not set up on the server yet (database or password missing).' }, 503);
  const pass = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!samePass(pass, env.APP_PASSWORD)) return json({ error: 'Wrong passcode.' }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const since = Number(body.since) || 0;
  const changes = Array.isArray(body.changes) ? body.changes.slice(0, 2000) : [];

  if (!ready) {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, data TEXT, t INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL)').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS docs_seq ON docs (seq)').run();
    ready = true;
  }

  const seq = Date.now();
  const up = env.DB.prepare(
    'INSERT INTO docs (id, data, t, deleted, seq) VALUES (?1, ?2, ?3, ?4, ?5) ' +
    'ON CONFLICT(id) DO UPDATE SET data = excluded.data, t = excluded.t, deleted = excluded.deleted, seq = excluded.seq WHERE excluded.t > docs.t'
  );
  const valid = changes.filter((c) => c && typeof c.id === 'string' && c.id.length < 100 && Number.isFinite(c.t));
  if (valid.length) await env.DB.batch(valid.map((c) => up.bind(c.id, c.deleted ? null : JSON.stringify(c.data), c.t, c.deleted ? 1 : 0, seq)));

  // ">=" re-sends the newest record each time; the app ignores what it already has
  const rows = await env.DB.prepare('SELECT id, data, t, deleted, seq FROM docs WHERE seq >= ?1 ORDER BY seq').bind(since).all();
  let cursor = since;
  const docs = rows.results.map((r) => {
    if (r.seq > cursor) cursor = r.seq;
    return { id: r.id, t: r.t, deleted: !!r.deleted, data: r.deleted ? null : JSON.parse(r.data) };
  });
  return json({ docs, cursor });
}
