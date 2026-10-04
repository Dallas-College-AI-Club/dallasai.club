import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';
// Officers' own Help topics (migration 019), stored only in the database.
// Until 019 is applied, the list is empty and every write says so.
const columns =
  'id,title,body,category,archived,created_by,updated_by,created_at,updated_at,revision';
const notSetUp = (error) => ['42P01', '42703'].includes(error?.code);
const unavailable = () =>
  new RequestError(
    503,
    'Help is not set up on this deployment yet. Ask the site operator to apply database migrations 019 and 020.',
    { code: 'help-not-set-up' },
  );
const changed = () =>
  new RequestError(
    409,
    'Another officer changed this topic. Reload Help to see their version; your text is still here.',
    { code: 'stale-help' },
  );
export async function helpEntries(db) {
  try {
    const { rows } = await db.query(
      `SELECT ${columns} FROM club_forms.help_entries ORDER BY archived,lower(title),id`,
    );
    return { entries: rows, ready: true };
  } catch (error) {
    if (notSetUp(error)) return { entries: [], ready: false };
    throw error;
  }
}
export async function helpHistory(db, topic, before) {
  if (
    (topic !== 'all' && !uuid.test(topic || '')) ||
    (before && !/^[1-9][0-9]{0,17}$/.test(before))
  )
    throw new RequestError(400, 'Invalid history link.');
  const { rows } = await db.query(
    `SELECT id,actor,action,created_at,help_topic_id FROM club_forms.audit
     WHERE action IN ('help-created','help-edited','help-archived','help-restored','help-deleted')
       AND ($1::uuid IS NULL OR help_topic_id=$1::uuid)
       AND ($2::bigint IS NULL OR id<$2::bigint)
     ORDER BY id DESC LIMIT 101`,
    [topic === 'all' ? null : topic, before || null],
  );
  return {
    history: rows.slice(0, 100),
    next: rows.length > 100 ? String(rows[99].id) : null,
  };
}
// Plain text only: line breaks are kept, other control characters are not.
function text(value, max, multiline) {
  if (typeof value !== 'string') return '';
  const clean = value
    .replace(/\r\n?/g, '\n')
    .replace(
      multiline
        ? /[\u0000-\u0008\u000b-\u001f\u007f]/g
        : /[\u0000-\u001f\u007f]/g,
      '',
    )
    .trim();
  return clean.length <= max ? clean : null;
}
const revisionOf = (body) =>
  Number.isSafeInteger(body.revision) && body.revision > 0
    ? body.revision
    : null;
// One audit row per change; it names the action, never the topic text.
const audit = (tx, actor, action, id) =>
  tx.query(
    'INSERT INTO club_forms.audit(actor,action,help_topic_id) VALUES($1,$2,$3)',
    [actor, action, id],
  );
async function write(db, run) {
  try {
    return await db.transaction(run);
  } catch (error) {
    if (notSetUp(error)) throw unavailable();
    throw error;
  }
}
// help-save creates (no revision) or edits (the revision the officer opened).
// A retried create with the same id and text returns the saved topic.
export async function saveHelpEntry(db, body, actor) {
  const title = text(body.title, 120, false),
    content = text(body.body, 8000, true),
    category = body.category ?? 'everyday',
    revision = revisionOf(body);
  if (!['everyday', 'essentials'].includes(category))
    throw new RequestError(400, 'Choose a topic category.');
  if (!uuid.test(body.id || '') || (body.revision != null && !revision))
    throw new RequestError(400, 'Invalid update.');
  if (!title || !content)
    throw new RequestError(
      400,
      title === null
        ? 'Keep the title under 120 characters.'
        : content === null
          ? 'Keep the text under 8,000 characters.'
          : 'Add a title and some text.',
    );
  const id = body.id.toLowerCase();
  return write(db, async (tx) => {
    if (!revision) {
      const created = (
        await tx.query(
          `INSERT INTO club_forms.help_entries(id,title,body,created_by,updated_by,category) VALUES($1,$2,$3,$4,$4,$5) ON CONFLICT (id) DO NOTHING RETURNING ${columns}`,
          [id, title, content, actor, category],
        )
      ).rows[0];
      if (created) {
        await audit(tx, actor, 'help-created', id);
        return { entry: created };
      }
      const existing = (
        await tx.query(
          `SELECT ${columns} FROM club_forms.help_entries WHERE id=$1`,
          [id],
        )
      ).rows[0];
      if (
        existing.title === title &&
        existing.body === content &&
        existing.category === category
      )
        return { entry: existing };
      throw changed();
    }
    const entry = (
      await tx.query(
        `UPDATE club_forms.help_entries SET title=$3,body=$4,updated_by=$5,category=$6,updated_at=now(),revision=revision+1 WHERE id=$1 AND revision=$2 AND NOT archived RETURNING ${columns}`,
        [id, revision, title, content, actor, category],
      )
    ).rows[0];
    if (!entry) throw await missingOrChanged(tx, id);
    await audit(tx, actor, 'help-edited', id);
    return { entry };
  });
}
async function missingOrChanged(tx, id) {
  const exists = (
    await tx.query('SELECT 1 FROM club_forms.help_entries WHERE id=$1', [id])
  ).rows.length;
  return exists
    ? changed()
    : new RequestError(404, 'This topic was deleted. Reload Help.');
}
// help-archive, help-restore and help-delete act on the revision shown.
export async function changeHelpEntry(db, body, actor) {
  const revision = revisionOf(body);
  if (!uuid.test(body.id || '') || !revision)
    throw new RequestError(400, 'Invalid update.');
  const id = body.id.toLowerCase();
  return write(db, async (tx) => {
    if (body.action === 'help-delete') {
      const gone = (
        await tx.query(
          'DELETE FROM club_forms.help_entries WHERE id=$1 AND revision=$2 AND archived RETURNING id',
          [id, revision],
        )
      ).rows[0];
      if (!gone) throw await missingOrChanged(tx, id);
      await audit(tx, actor, 'help-deleted', id);
      return { deleted: true, id };
    }
    const archived = body.action === 'help-archive';
    const entry = (
      await tx.query(
        `UPDATE club_forms.help_entries SET archived=$3,updated_by=$4,updated_at=now(),revision=revision+1 WHERE id=$1 AND revision=$2 RETURNING ${columns}`,
        [id, revision, archived, actor],
      )
    ).rows[0];
    if (!entry) throw await missingOrChanged(tx, id);
    await audit(tx, actor, archived ? 'help-archived' : 'help-restored', id);
    return { entry };
  });
}
