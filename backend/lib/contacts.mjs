import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';
function emailKey(email) {
  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  )
    throw new RequestError(400, 'Enter a valid contact email.');
  return email.trim().toLowerCase();
}
function pageOffset(offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    throw new RequestError(400, 'Invalid contact page.');
}
export async function contactList(db, { search = '', offset = 0 } = {}) {
  pageOffset(offset);
  if (typeof search !== 'string' || search.length > 200)
    throw new RequestError(
      400,
      'Keep the contact search under 200 characters.',
    );
  const rows = (
    await db.query(
      `SELECT c.*,(SELECT count(*)::int FROM club_forms.entries e WHERE e.email=c.email) AS submissions
    FROM club_forms.contacts c WHERE $1='' OR strpos(lower(c.email || ' ' || c.name),$1)>0 OR EXISTS(SELECT 1 FROM club_forms.entries e WHERE e.email=c.email AND strpos(lower(e.name),$1)>0)
    ORDER BY c.last_seen DESC,c.email LIMIT 51 OFFSET $2`,
      [search.trim().toLowerCase(), offset],
    )
  ).rows;
  return { contacts: rows.slice(0, 50), hasMore: rows.length > 50 };
}
export async function contactHistory(db, { email, offset = 0 }) {
  email = emailKey(email);
  pageOffset(offset);
  const contact = (
    await db.query(
      `SELECT c.*,(SELECT array_agg(DISTINCT name) FROM club_forms.entries e WHERE e.email=c.email AND name<>'') AS names FROM club_forms.contacts c WHERE c.email=$1`,
      [email],
    )
  ).rows[0];
  if (!contact) throw new RequestError(404, 'Contact not found.');
  const rows = (
    await db.query(
      `SELECT * FROM (
    SELECT 'entry:'||id::text AS id,created_at,'submission' AS type,kind AS label,name AS actor,data AS details,NULL::text AS body,id::text AS entry_id FROM club_forms.entries WHERE email=$1
    UNION ALL
    SELECT 'comment:'||c.id::text,c.created_at,'comment',e.kind,c.author_email,'{}'::jsonb,c.body,e.id::text FROM club_forms.entry_comments c JOIN club_forms.entries e ON e.id=c.entry_id WHERE e.email=$1
    UNION ALL
    SELECT 'note:'||id::text,created_at,'note','Follow-up note',author_email,'{}'::jsonb,body,NULL::text FROM club_forms.contact_notes WHERE email=$1
    UNION ALL
    SELECT 'audit:'||a.id::text,a.created_at,'activity',a.action,a.actor,'{}'::jsonb,NULL::text,e.id::text FROM club_forms.audit a JOIN club_forms.entries e ON e.id=a.entry_id WHERE e.email=$1 AND a.comment_id IS NULL
  ) history ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $2`,
      [email, offset],
    )
  ).rows;
  return {
    contact,
    history: rows.slice(0, 50),
    hasMore: rows.length > 50,
  };
}
export async function addContactNote(db, body, actor) {
  const email = emailKey(body.email);
  if (
    !uuid.test(body.noteId || '') ||
    typeof body.note !== 'string' ||
    !body.note.trim() ||
    body.note.trim().length > 5000
  )
    throw new RequestError(400, 'Enter a note between 1 and 5,000 characters.');
  return db.transaction(async (tx) => {
    if (
      !(
        await tx.query('SELECT email FROM club_forms.contacts WHERE email=$1', [
          email,
        ])
      ).rows.length
    )
      throw new RequestError(404, 'Contact not found.');
    const row = (
      await tx.query(
        'INSERT INTO club_forms.contact_notes(id,email,author_email,body) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING *',
        [body.noteId, email, actor, body.note.trim()],
      )
    ).rows[0];
    if (row) return row;
    const old = (
      await tx.query('SELECT * FROM club_forms.contact_notes WHERE id=$1', [
        body.noteId,
      ])
    ).rows[0];
    if (
      !old ||
      old.email !== email ||
      old.author_email !== actor ||
      old.body !== body.note.trim()
    )
      throw new RequestError(
        409,
        'This note request has already been used. Refresh and try again.',
      );
    return old;
  });
}
