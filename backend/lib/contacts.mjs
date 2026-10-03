import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';
import { del } from '@vercel/blob';
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
export async function contactList(
  db,
  { search = '', offset = 0, view = 'active' } = {},
) {
  pageOffset(offset);
  if (!['active', 'deleted', 'all'].includes(view))
    throw new RequestError(400, 'Invalid contact filter.');
  if (typeof search !== 'string' || search.length > 200)
    throw new RequestError(
      400,
      'Keep the contact search under 200 characters.',
    );
  const rows = (
    await db.query(
      `SELECT c.*,
    ARRAY(SELECT email FROM club_forms.contact_emails WHERE contact_email=c.email ORDER BY email) AS emails,
    (SELECT count(*)::int FROM club_forms.entries e JOIN club_forms.contact_emails a ON a.email=e.email WHERE a.contact_email=c.email) AS submissions
    FROM club_forms.contacts c JOIN club_forms.contact_emails root ON root.email=c.email AND root.contact_email=c.email
    WHERE ($3='all' OR ($3='active' AND c.deleted_at IS NULL) OR ($3='deleted' AND c.deleted_at IS NOT NULL))
    AND ($1='' OR strpos(lower(c.email || ' ' || c.name),$1)>0 OR EXISTS(
      SELECT 1 FROM club_forms.contact_emails a JOIN club_forms.contacts original ON original.email=a.email
      WHERE a.contact_email=c.email AND (strpos(lower(a.email || ' ' || original.name),$1)>0 OR EXISTS(
        SELECT 1 FROM club_forms.entries e WHERE e.email=a.email AND strpos(lower(e.name),$1)>0))))
    ORDER BY c.last_seen DESC,c.email LIMIT 51 OFFSET $2`,
      [search.trim().toLowerCase(), offset, view],
    )
  ).rows;
  return { contacts: rows.slice(0, 50), hasMore: rows.length > 50 };
}
export async function contactHistory(db, { email, offset = 0 }) {
  email = emailKey(email);
  pageOffset(offset);
  const contact = (
    await db.query(
      `SELECT c.*,
      ARRAY(SELECT email FROM club_forms.contact_emails WHERE contact_email=c.email ORDER BY email) AS emails,
      ARRAY(SELECT DISTINCT name FROM club_forms.entries e JOIN club_forms.contact_emails a ON a.email=e.email WHERE a.contact_email=c.email AND name<>'' ORDER BY name) AS names,
      (SELECT count(*)::int FROM club_forms.entries e JOIN club_forms.contact_emails a ON a.email=e.email WHERE a.contact_email=c.email) AS submissions,
      (SELECT count(*)::int FROM club_forms.contact_notes n JOIN club_forms.contact_emails a ON a.email=n.email WHERE a.contact_email=c.email) AS notes,
      (SELECT count(*)::int FROM club_forms.attachments f JOIN club_forms.entries e ON e.id=f.entry_id JOIN club_forms.contact_emails a ON a.email=e.email WHERE a.contact_email=c.email) AS attachments
      FROM club_forms.contacts c JOIN club_forms.contact_emails lookup ON lookup.contact_email=c.email WHERE lookup.email=$1`,
      [email],
    )
  ).rows[0];
  if (!contact) throw new RequestError(404, 'Contact not found.');
  const rows = (
    await db.query(
      `WITH aliases AS (SELECT email FROM club_forms.contact_emails WHERE contact_email=$1)
      SELECT * FROM (
    SELECT 'entry:'||id::text AS id,created_at,'submission' AS type,kind AS label,name AS actor,data AS details,NULL::text AS body,id::text AS entry_id,email AS source_email FROM club_forms.entries WHERE email IN (SELECT email FROM aliases)
    UNION ALL
    SELECT 'comment:'||c.id::text,c.created_at,'comment',e.kind,c.author_email,'{}'::jsonb,c.body,e.id::text,e.email FROM club_forms.entry_comments c JOIN club_forms.entries e ON e.id=c.entry_id WHERE e.email IN (SELECT email FROM aliases)
    UNION ALL
    SELECT 'note:'||id::text,created_at,'note','Follow-up note',author_email,'{}'::jsonb,body,NULL::text,email FROM club_forms.contact_notes WHERE email IN (SELECT email FROM aliases)
    UNION ALL
    SELECT 'audit:'||a.id::text,a.created_at,'activity',a.action,a.actor,'{}'::jsonb,NULL::text,e.id::text,e.email FROM club_forms.audit a JOIN club_forms.entries e ON e.id=a.entry_id WHERE e.email IN (SELECT email FROM aliases) AND a.comment_id IS NULL
    UNION ALL
    SELECT 'contact:'||id::text,created_at,'activity',action,actor,'{}'::jsonb,details,NULL::text,email FROM club_forms.contact_activity WHERE email IN (SELECT email FROM aliases)
  ) history ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $2`,
      [contact.email, offset],
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
    await tx.query(
      'LOCK TABLE club_forms.contacts IN SHARE ROW EXCLUSIVE MODE',
    );
    const contact = await resolveContact(tx, email);
    if (contact.deleted_at)
      throw new RequestError(409, 'Restore this contact before adding a note.');
    const row = (
      await tx.query(
        'INSERT INTO club_forms.contact_notes(id,email,author_email,body) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING *',
        [body.noteId, email, actor, body.note.trim()],
      )
    ).rows[0];
    if (row) {
      await tx.query(
        'UPDATE club_forms.contacts SET revision=revision+1 WHERE email=$1',
        [contact.email],
      );
      return row;
    }
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

async function resolveContact(db, email) {
  const contact = (
    await db.query(
      `SELECT c.* FROM club_forms.contacts c JOIN club_forms.contact_emails a ON a.contact_email=c.email WHERE a.email=$1`,
      [email],
    )
  ).rows[0];
  if (!contact) throw new RequestError(404, 'Contact not found.');
  return contact;
}
function checkRevision(contact, email, revision) {
  if (
    contact.email !== email ||
    !Number.isSafeInteger(revision) ||
    revision !== contact.revision
  )
    throw new RequestError(
      409,
      'This contact changed. Refresh its history and review the action again.',
    );
}
async function activity(db, email, actor, action, details = '') {
  await db.query(
    'INSERT INTO club_forms.contact_activity(email,actor,action,details) VALUES($1,$2,$3,$4)',
    [email, actor, action, details],
  );
}
export async function cleanupContactFiles(db, storage = { del }, paths) {
  const files =
    paths ||
    (
      await db.query(
        'SELECT pathname FROM club_forms.contact_file_deletions ORDER BY created_at LIMIT 100',
      )
    ).rows.map((r) => r.pathname);
  if (!files.length) return true;
  try {
    await storage.del(files);
    await db.query(
      'DELETE FROM club_forms.contact_file_deletions WHERE pathname=ANY($1::text[])',
      [files],
    );
    return true;
  } catch {
    return false;
  }
}
export async function manageContact(db, body, actor, storage = { del }) {
  const email = emailKey(body.email);
  if (
    ![
      'contact-merge',
      'contact-delete',
      'contact-restore',
      'contact-test',
      'contact-purge',
    ].includes(body.action)
  )
    throw new RequestError(400, 'Unknown contact action.');
  const result = await db.transaction(async (tx) => {
    await tx.query(
      'LOCK TABLE club_forms.contacts IN SHARE ROW EXCLUSIVE MODE',
    );
    const contact = await resolveContact(tx, email);
    checkRevision(contact, email, body.revision);
    if (body.action === 'contact-merge') {
      const targetEmail = emailKey(body.targetEmail);
      const target = await resolveContact(tx, targetEmail);
      checkRevision(target, targetEmail, body.targetRevision);
      if (target.email === email)
        throw new RequestError(
          400,
          'These addresses already belong to the same contact.',
        );
      if (contact.deleted_at || target.deleted_at)
        throw new RequestError(409, 'Restore both contacts before merging.');
      if (contact.is_test !== target.is_test)
        throw new RequestError(
          409,
          'Test contacts and regular contacts cannot be merged. Review their Test contact settings first.',
        );
      await tx.query(
        'UPDATE club_forms.contact_emails SET contact_email=$1 WHERE contact_email=$2',
        [targetEmail, email],
      );
      await tx.query(
        `UPDATE club_forms.contacts SET first_seen=least(first_seen,$2),last_seen=greatest(last_seen,$3),revision=revision+1 WHERE email=$1`,
        [targetEmail, contact.first_seen, contact.last_seen],
      );
      await tx.query(
        'UPDATE club_forms.contacts SET revision=revision+1 WHERE email=$1',
        [email],
      );
      await activity(
        tx,
        targetEmail,
        actor,
        'Merged contact',
        'Linked all email addresses and history from ' + email + '.',
      );
      return { email: targetEmail, merged: true };
    }
    if (body.action === 'contact-test') {
      if (typeof body.value !== 'boolean')
        throw new RequestError(400, 'Choose a valid test setting.');
      if (contact.is_test !== body.value) {
        await tx.query(
          'UPDATE club_forms.contacts SET is_test=$2,revision=revision+1 WHERE email=$1',
          [email, body.value],
        );
        await activity(
          tx,
          email,
          actor,
          body.value ? 'Marked as test' : 'Unmarked as test',
        );
      }
      return { email, is_test: body.value };
    }
    if (body.action === 'contact-purge') {
      if (!contact.is_test || body.confirmEmail !== email)
        throw new RequestError(
          400,
          'Only a marked test contact can be permanently deleted. Confirm its primary email.',
        );
      const aliases = (
        await tx.query(
          'SELECT email FROM club_forms.contact_emails WHERE contact_email=$1',
          [email],
        )
      ).rows.map((r) => r.email);
      const files = (
        await tx.query(
          `SELECT f.pathname FROM club_forms.attachments f JOIN club_forms.entries e ON e.id=f.entry_id WHERE e.email=ANY($1::text[])`,
          [aliases],
        )
      ).rows.map((r) => r.pathname);
      for (const file of files)
        await tx.query(
          'INSERT INTO club_forms.contact_file_deletions(pathname) VALUES($1) ON CONFLICT DO NOTHING',
          [file],
        );
      await tx.query(
        'DELETE FROM club_forms.audit WHERE entry_id IN (SELECT id FROM club_forms.entries WHERE email=ANY($1::text[]))',
        [aliases],
      );
      await tx.query(
        'DELETE FROM club_forms.entries WHERE email=ANY($1::text[])',
        [aliases],
      );
      await tx.query(
        'DELETE FROM club_forms.contact_notes WHERE email=ANY($1::text[])',
        [aliases],
      );
      await tx.query(
        'DELETE FROM club_forms.contact_activity WHERE email=ANY($1::text[])',
        [aliases],
      );
      await tx.query(
        'DELETE FROM club_forms.contact_emails WHERE contact_email=$1',
        [email],
      );
      await tx.query(
        'DELETE FROM club_forms.contacts WHERE email=ANY($1::text[])',
        [aliases],
      );
      return { purged: true, files };
    }
    if (body.action === 'contact-delete' && contact.is_test)
      throw new RequestError(
        409,
        'Test contacts require the permanent-delete confirmation.',
      );
    const deleted = body.action === 'contact-delete';
    if (Boolean(contact.deleted_at) !== deleted) {
      await tx.query(
        `UPDATE club_forms.contacts SET deleted_at=CASE WHEN $2 THEN now() ELSE NULL END,deleted_by=CASE WHEN $2 THEN $3 ELSE NULL END,revision=revision+1 WHERE email=$1`,
        [email, deleted, actor],
      );
      await activity(
        tx,
        email,
        actor,
        deleted ? 'Contact deleted' : 'Contact restored',
      );
    }
    return { email, deleted };
  });
  if (result.purged)
    return {
      purged: true,
      filesDeleted: await cleanupContactFiles(db, storage, result.files),
    };
  return result;
}
