/* Keeps each teacher's exams, answer keys and results the same on all their devices.
   Every record has an owner. A teacher receives their own records, plus the exams (and results)
   that other teachers have marked as shared; those are read-only for everyone but the owner.
   When two devices change the same record the later change wins. */
import { json, prepare, currentUser } from './auth.js';

export async function handleSync(request, env) {
  if (!env.DB) return json({ error: 'The server has no database yet.' }, 503);
  await prepare(env);
  const me = await currentUser(request, env);
  if (!me) return json({ error: 'Please sign in again.' }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const since = Number(body.since) || 0;
  const changes = (Array.isArray(body.changes) ? body.changes.slice(0, 2000) : []).filter((c) =>
    c && typeof c.id === 'string' && c.id.length < 100 && Number.isFinite(c.t) &&
    (/^(exam|res):/.test(c.id) || c.id === 'config:' + me.id) && (c.deleted || (c.data && typeof c.data === 'object')));

  const seq = Date.now();
  if (changes.length) {
    // which exams are shared right now, to spot the ones being shared by this request
    const before = {};
    for (const c of changes) {
      if (!c.id.startsWith('exam:') || c.deleted || !c.data.shared) continue;
      const row = await env.DB.prepare('SELECT shared FROM items WHERE id = ?1').bind(c.id).first();
      before[c.id] = row ? row.shared : 0;
    }
    const up = env.DB.prepare(
      'INSERT INTO items (id, owner, exam, shared, data, t, deleted, seq) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ' +
      'ON CONFLICT(id) DO UPDATE SET exam = COALESCE(excluded.exam, items.exam), shared = excluded.shared, data = excluded.data, t = excluded.t, deleted = excluded.deleted, seq = excluded.seq ' +
      'WHERE items.owner = excluded.owner AND excluded.t > items.t'
    );
    const stmts = changes.map((c) => {
      const isExam = c.id.startsWith('exam:');
      const exam = isExam ? c.id : c.id.startsWith('res:') && !c.deleted && typeof c.data.examId === 'string' ? 'exam:' + c.data.examId : null;
      return up.bind(c.id, me.id, exam, isExam && !c.deleted && c.data.shared ? 1 : 0, c.deleted ? null : JSON.stringify(c.data), c.t, c.deleted ? 1 : 0, seq);
    });
    // a newly shared exam: re-stamp its results so the other teachers' devices fetch them too
    Object.keys(before).filter((id) => !before[id]).forEach((id) =>
      stmts.push(env.DB.prepare('UPDATE items SET seq = ?1 WHERE exam = ?2 AND owner = ?3 AND EXISTS (SELECT 1 FROM items e WHERE e.id = ?2 AND e.owner = ?3 AND e.shared = 1)').bind(seq, id, me.id)));
    await env.DB.batch(stmts);
  }

  const SHARED = 'EXISTS (SELECT 1 FROM items e WHERE e.id = d.exam AND e.shared = 1 AND e.deleted = 0 AND e.owner = d.owner)';
  // ">=" re-sends the newest records each time; the app ignores what it already has
  const rows = await env.DB.prepare(
    `SELECT d.id, d.data, d.t, d.deleted, d.seq, d.owner, u.name AS ownerName FROM items d LEFT JOIN users u ON u.id = d.owner WHERE d.seq >= ?1 AND (d.owner = ?2 OR ${SHARED}) ORDER BY d.seq`
  ).bind(since, me.id).all();
  let cursor = since;
  const docs = rows.results.map((r) => {
    if (r.seq > cursor) cursor = r.seq;
    return { id: r.id, t: r.t, deleted: !!r.deleted, owner: r.owner, ownerName: r.ownerName || '', data: r.deleted ? null : JSON.parse(r.data) };
  });
  // every exam of another teacher this teacher may see; anything else of theirs is dropped from the device
  const others = await env.DB.prepare("SELECT id FROM items WHERE id LIKE 'exam:%' AND shared = 1 AND deleted = 0 AND owner != ?1").bind(me.id).all();
  return json({ docs, cursor, shared: others.results.map((r) => r.id.slice(5)) });
}
