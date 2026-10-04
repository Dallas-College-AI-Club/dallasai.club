import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';
// Officers' own Help topics (migration 019), stored only in the database.
// Until 019 is applied, the list is empty and every write says so.
const columns =
  'id,title,body,archived,created_by,updated_by,created_at,updated_at,revision';
const notSetUp = (error) => error?.code === '42P01';
const unavailable = () =>
  new RequestError(
    503,
    'Officer Help topics aren’t set up on this deployment yet. Ask the site operator to apply database migration 019.',
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
const audit = (tx, actor, action) =>
  tx.query('INSERT INTO club_forms.audit(actor,action) VALUES($1,$2)', [
    actor,
    action,
  ]);
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
    revision = revisionOf(body);
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
          `INSERT INTO club_forms.help_entries(id,title,body,created_by,updated_by) VALUES($1,$2,$3,$4,$4) ON CONFLICT (id) DO NOTHING RETURNING ${columns}`,
          [id, title, content, actor],
        )
      ).rows[0];
      if (created) {
        await audit(tx, actor, 'help-created');
        return { entry: created };
      }
      const existing = (
        await tx.query(
          `SELECT ${columns} FROM club_forms.help_entries WHERE id=$1`,
          [id],
        )
      ).rows[0];
      if (existing.title === title && existing.body === content)
        return { entry: existing };
      throw changed();
    }
    const entry = (
      await tx.query(
        `UPDATE club_forms.help_entries SET title=$3,body=$4,updated_by=$5,updated_at=now(),revision=revision+1 WHERE id=$1 AND revision=$2 RETURNING ${columns}`,
        [id, revision, title, content, actor],
      )
    ).rows[0];
    if (!entry) throw await missingOrChanged(tx, id);
    await audit(tx, actor, 'help-edited');
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
          'DELETE FROM club_forms.help_entries WHERE id=$1 AND revision=$2 RETURNING id',
          [id, revision],
        )
      ).rows[0];
      if (!gone) throw await missingOrChanged(tx, id);
      await audit(tx, actor, 'help-deleted');
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
    await audit(tx, actor, archived ? 'help-archived' : 'help-restored');
    return { entry };
  });
}
