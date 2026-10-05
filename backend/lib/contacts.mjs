import { createHmac } from 'node:crypto';
import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';
import { del } from '@vercel/blob';
import { editContact, contactAliases } from './contact-profile.mjs';
// A person's id in links, so an email address never goes in a URL: the first
// 16 hex characters of HMAC-SHA256(FORM_TOKEN_SECRET, primary contact email).
// Rotating the secret changes every ref. Null when the secret is not set.
export function contactRef(email) {
  const secret = process.env.FORM_TOKEN_SECRET;
  if (!email || !secret || secret.length < 32) return null;
  return createHmac('sha256', secret).update(email).digest('hex').slice(0, 16);
}
// The person behind one submission, for its Inbox record: up to 3 of their
// other submissions, their counts and the latest officer note.
export async function submissionContact(db, entry) {
  const contact = (
    await db.query(
      `SELECT c.email,c.name,c.deleted_at,c.deleted_by,c.is_test,
      (SELECT count(*)::int FROM club_forms.contact_emails a JOIN club_forms.entries o ON o.email=a.email WHERE a.contact_email=c.email) AS submission_count,
      (SELECT count(*)::int FROM club_forms.contact_emails a JOIN club_forms.contact_notes n ON n.email=a.email WHERE a.contact_email=c.email) AS note_count,
      (SELECT json_build_object('author_email',n.author_email,'body',left(n.body,200),'created_at',n.created_at) FROM club_forms.contact_emails a JOIN club_forms.contact_notes n ON n.email=a.email WHERE a.contact_email=c.email ORDER BY n.created_at DESC,n.id DESC LIMIT 1) AS last_note,
      (SELECT coalesce(json_agg(s ORDER BY s.created_at DESC,s.id DESC),'[]') FROM (
        SELECT o.id,o.kind,o.review_status,o.created_at,coalesce(nullif(o.data->>'subject',''),nullif(o.data->>'title',''),nullif(o.data->>'topic',''),nullif(o.data->>'eventTitle',''),nullif(o.data->>'campus',''),'') AS subject
        FROM club_forms.contact_emails a JOIN club_forms.entries o ON o.email=a.email WHERE a.contact_email=c.email AND o.id<>$2 ORDER BY o.created_at DESC,o.id DESC LIMIT 3) s) AS submissions
      FROM club_forms.contact_emails link JOIN club_forms.contacts c ON c.email=link.contact_email WHERE link.email=$1`,
      [entry.email, entry.id],
    )
  ).rows[0];
  return contact ? { ref: contactRef(contact.email), ...contact } : null;
}
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
    ARRAY(SELECT email FROM club_forms.contact_emails WHERE contact_email=c.email AND is_active ORDER BY email) AS emails,
    (SELECT count(*)::int FROM club_forms.entries e JOIN club_forms.contact_emails a ON a.email=e.email WHERE a.contact_email=c.email) AS submissions
    FROM club_forms.contacts c JOIN club_forms.contact_emails root ON root.email=c.email AND root.contact_email=c.email
    WHERE ($3='all' OR ($3='active' AND c.deleted_at IS NULL) OR ($3='deleted' AND c.deleted_at IS NOT NULL))
    AND ($1='' OR strpos(lower(c.email || ' ' || c.name),$1)>0 OR EXISTS(
      SELECT 1 FROM club_forms.contact_emails a JOIN club_forms.contacts original ON original.email=a.email
      WHERE a.contact_email=c.email AND a.is_active AND (strpos(lower(a.email || ' ' || original.name),$1)>0 OR EXISTS(
        SELECT 1 FROM club_forms.entries e WHERE e.email=a.email AND strpos(lower(e.name),$1)>0))))
    ORDER BY c.last_seen DESC,c.email LIMIT 51 OFFSET $2`,
      [search.trim().toLowerCase(), offset, view],
    )
  ).rows;
  return { contacts: rows.slice(0, 50), hasMore: rows.length > 50 };
}
// Everything deleting a contact removes, as the Mark as test warning lists
// it. Notes the website added to a resubmitted entry are counted apart from
// officer comments.
async function contactCounts(db, email) {
  return (
    await db.query(
      `WITH aliases AS (SELECT email FROM club_forms.contact_emails WHERE contact_email=$1),
      linked AS (SELECT id FROM club_forms.entries WHERE email IN (SELECT email FROM aliases))
      SELECT (SELECT count(*)::int FROM aliases) AS addresses,
      (SELECT count(*)::int FROM linked) AS submissions,
      (SELECT count(*)::int FROM club_forms.survey_responses WHERE entry_id IN (SELECT id FROM linked)) AS survey_responses,
      (SELECT count(*)::int FROM club_forms.entry_comments WHERE entry_id IN (SELECT id FROM linked) AND author_email<>'website') AS comments,
      (SELECT count(*)::int FROM club_forms.entry_comments WHERE entry_id IN (SELECT id FROM linked) AND author_email='website') AS website_notes,
      (SELECT count(*)::int FROM club_forms.contact_notes WHERE email IN (SELECT email FROM aliases)) AS notes,
      (SELECT count(*)::int FROM club_forms.attachments WHERE entry_id IN (SELECT id FROM linked)) AS attachments`,
      [email],
    )
  ).rows[0];
}
export async function contactHistory(db, { email, offset = 0 }) {
  email = emailKey(email);
  pageOffset(offset);
  const contact = (
    await db.query(
      `SELECT c.*,
      ARRAY(SELECT email FROM club_forms.contact_emails WHERE contact_email=c.email AND is_active ORDER BY email) AS emails,
      ARRAY(SELECT DISTINCT name FROM club_forms.entries e JOIN club_forms.contact_emails a ON a.email=e.email WHERE a.contact_email=c.email AND name<>'' ORDER BY name) AS names
      FROM club_forms.contacts c JOIN club_forms.contact_emails lookup ON lookup.contact_email=c.email WHERE lookup.email=$1`,
      [email],
    )
  ).rows[0];
  if (!contact) throw new RequestError(404, 'Contact not found.');
  contact.counts = await contactCounts(db, contact.email);
  contact.submissions = contact.counts.submissions;
  contact.aliases = await contactAliases(db, contact.email);
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
  if (['contact-edit', 'contact-remove-alias'].includes(body.action))
    return editContact(db, body, actor);
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
    // Mark as test: the contact and everything linked to it are deleted in
    // this one step, once the officer types the primary email.
    if (body.action === 'contact-purge') {
      if (
        typeof body.confirmEmail !== 'string' ||
        body.confirmEmail.trim().toLowerCase() !== email
      )
        throw new RequestError(
          400,
          'Type the primary email to confirm deleting this test contact.',
        );
      // Lock the entries so no comment can join them unseen, then refuse if
      // anything differs from the counts the warning showed.
      await tx.query(
        'SELECT id FROM club_forms.entries WHERE email IN (SELECT email FROM club_forms.contact_emails WHERE contact_email=$1) FOR UPDATE',
        [email],
      );
      const counts = await contactCounts(tx, email);
      if (Object.keys(counts).some((key) => body.counts?.[key] !== counts[key]))
        throw new RequestError(
          409,
          'This contact changed. Refresh its history and review the action again.',
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
      const removed = async (table) =>
        (
          await tx.query(
            `WITH gone AS (DELETE FROM club_forms.${table} WHERE email=ANY($1::text[]) RETURNING 1) SELECT count(*)::int AS n FROM gone`,
            [aliases],
          )
        ).rows[0].n;
      const entries = await removed('entries'),
        notes = await removed('contact_notes');
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
      // A receipt with no trace of the address: who purged, when, and how much
      // was removed.
      await tx.query(
        'INSERT INTO club_forms.audit(actor,action) VALUES($1,$2)',
        [
          actor,
          `contact-purged:entries=${entries}:notes=${notes}:files=${files.length}`,
        ],
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
