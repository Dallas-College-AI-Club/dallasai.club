import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import {
  contactList,
  contactHistory,
  addContactNote,
  manageContact,
  cleanupContactFiles,
} from '../lib/contacts.mjs';
let db;
const actor = 'officer@example.edu',
  first = 'e12345@student.dcccd.edu',
  second = 'mk23@student.dallascollege.edu';
before(async () => {
  db = new PGlite();
  for (const file of [
    '003_club_forms.sql',
    '005_screen_confirmations.sql',
    '007_office_tools.sql',
    '009_submission_comments.sql',
    '010_event_surveys.sql',
    '014_event_response_management.sql',
    '015_contact_identity_management.sql',
  ])
    await db.exec(
      await readFile(new URL('../' + file, import.meta.url), 'utf8'),
    );
});
after(() => db.close());
beforeEach(() =>
  db.exec(
    'TRUNCATE club_forms.entries,club_forms.contacts,club_forms.contact_file_deletions CASCADE',
  ),
);
async function seed(email, name = 'Member Name') {
  const id = randomUUID();
  await db.query(
    `INSERT INTO club_forms.entries(id,kind,email,name,dedupe_key,data) VALUES($1::uuid,'rsvp',$2,$3,$1::text,'{"eventTitle":"Test event"}')`,
    [id, email, name],
  );
  await db.query(
    `INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,survey_version,questions,answers) VALUES($1,'test-event','Test event','v1','[]','[]')`,
    [id],
  );
  return id;
}
const contact = async (email) => (await contactHistory(db, { email })).contact;
async function change(email, action, extra = {}, storage) {
  const c = await contact(email);
  return manageContact(
    db,
    { email: c.email, revision: c.revision, action, ...extra },
    actor,
    storage,
  );
}
async function merge(source, target) {
  const c = await contact(target);
  return change(source, 'contact-merge', {
    targetEmail: c.email,
    targetRevision: c.revision,
  });
}
test('explicit school email merge combines history, aliases and future submissions without rewriting originals', async () => {
  const id = await seed(first, 'Original Name');
  await seed(second, 'Full Name');
  await seed('different@example.edu', 'Full Name');
  const note = {
    email: first,
    noteId: randomUUID(),
    note: 'Followed up with the student.',
  };
  await addContactNote(db, note, actor);
  await db.query(
    `INSERT INTO club_forms.entry_comments(id,entry_id,author_email,body) VALUES($1,$2,$3,'Asked about attendance')`,
    [randomUUID(), id, actor],
  );
  assert.equal((await contactList(db)).contacts.length, 3);
  await merge(first, second);
  assert.equal((await contactList(db)).contacts.length, 2);
  let h = await contactHistory(db, { email: first });
  assert.equal(h.contact.email, second);
  assert.deepEqual(h.contact.emails, [first, second]);
  assert.equal(h.contact.name, 'Full Name');
  assert.equal(h.history.filter((x) => x.type === 'submission').length, 2);
  assert.equal(h.history.filter((x) => x.type === 'note').length, 1);
  assert.equal(h.history.filter((x) => x.type === 'comment').length, 1);
  assert.equal(
    (await contactList(db, { search: 'E12345@STUDENT' })).contacts[0].email,
    second,
  );
  assert.equal(
    (await contactList(db, { search: 'Original Name' })).contacts[0].email,
    second,
  );
  await addContactNote(db, note, actor); // retry after merge stays idempotent
  await seed(first, 'Later Name');
  h = await contactHistory(db, { email: second });
  assert.equal(h.contact.submissions, 3);
  assert.equal(h.history.filter((x) => x.type === 'note').length, 1);
  assert.equal(
    (await db.query('SELECT email FROM club_forms.entries WHERE id=$1', [id]))
      .rows[0].email,
    first,
  );
  await assert.rejects(merge(first, second), { status: 400 });
  await db.exec(
    await readFile(
      new URL('../015_contact_identity_management.sql', import.meta.url),
      'utf8',
    ),
  );
  assert.equal((await contact(first)).email, second);
});
test('delete/restore preserves all records and does not recreate a merged contact on new submissions', async () => {
  await seed(first);
  await seed(second);
  await merge(first, second);
  await change(second, 'contact-delete');
  assert.equal((await contactList(db)).contacts.length, 0);
  assert.equal(
    (await contactList(db, { view: 'deleted', search: first })).contacts[0]
      .submissions,
    2,
  );
  await seed(first);
  assert.equal((await contactList(db)).contacts.length, 0);
  assert.equal((await contact(first)).submissions, 3);
  await assert.rejects(
    addContactNote(
      db,
      { email: first, noteId: randomUUID(), note: 'New note' },
      actor,
    ),
    { status: 409 },
  );
  await change(second, 'contact-restore');
  assert.equal((await contactList(db)).contacts[0].submissions, 3);
});
test('stale actions, mismatched test flags, non-test purge and missing confirmation are rejected', async () => {
  await seed(first);
  await seed(second);
  const stale = await contact(first);
  await addContactNote(
    db,
    { email: first, noteId: randomUUID(), note: 'New information' },
    actor,
  );
  await assert.rejects(
    manageContact(
      db,
      { email: first, revision: stale.revision, action: 'contact-delete' },
      actor,
    ),
    { status: 409 },
  );
  await assert.rejects(
    change(first, 'contact-purge', { confirmEmail: first }),
    { status: 400 },
  );
  await change(first, 'contact-test', { value: true });
  await assert.rejects(change(first, 'contact-delete'), { status: 409 });
  await assert.rejects(
    change(first, 'contact-purge', { confirmEmail: second }),
    { status: 400 },
  );
  await assert.rejects(merge(first, second), { status: 409 });
  await change(first, 'contact-test', { value: false });
  await merge(first, second);
});
test('permanent test deletion removes linked answers, comments, notes, audit and files, preserving unrelated people', async () => {
  const id = await seed(first);
  await seed(second);
  const other = await seed('real@example.edu');
  await merge(first, second);
  await addContactNote(
    db,
    { email: first, noteId: randomUUID(), note: 'Test note' },
    actor,
  );
  await db.query(
    `INSERT INTO club_forms.entry_comments(id,entry_id,author_email,body) VALUES($1,$2,$3,'Test comment')`,
    [randomUUID(), id, actor],
  );
  await db.query(
    `INSERT INTO club_forms.audit(actor,entry_id,action) VALUES($1,$2,'test')`,
    [actor, id],
  );
  await db.query(
    `INSERT INTO club_forms.attachments(id,entry_id,name,pathname,content_type,size) VALUES($1,$2,'test.txt','contributions/test-only','text/plain',1)`,
    [randomUUID(), id],
  );
  await change(second, 'contact-test', { value: true });
  const deleted = [];
  assert.deepEqual(
    await change(
      second,
      'contact-purge',
      { confirmEmail: second },
      { del: async (paths) => deleted.push(...paths) },
    ),
    { purged: true, filesDeleted: true },
  );
  assert.deepEqual(deleted, ['contributions/test-only']);
  assert.deepEqual(
    (await contactList(db)).contacts.map((c) => c.email),
    ['real@example.edu'],
  );
  assert.deepEqual(
    (await db.query('SELECT id FROM club_forms.entries')).rows.map((r) => r.id),
    [other],
  );
  assert.deepEqual(
    (
      await db.query('SELECT entry_id FROM club_forms.survey_responses')
    ).rows.map((r) => r.entry_id),
    [other],
  );
  for (const table of [
    'contact_notes',
    'entry_comments',
    'attachments',
    'audit',
    'contact_activity',
    'contact_file_deletions',
  ])
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM club_forms.' + table))
        .rows[0].n,
      0,
      table,
    );
  await assert.rejects(contact(first), { status: 404 });
});
test('failed file cleanup remains queued and can be retried without retaining test contact data', async () => {
  const id = await seed(first);
  await db.query(
    `INSERT INTO club_forms.attachments(id,entry_id,name,pathname,content_type,size) VALUES($1,$2,'test.txt','contributions/retry-test','text/plain',1)`,
    [randomUUID(), id],
  );
  await change(first, 'contact-test', { value: true });
  assert.equal(
    (
      await change(
        first,
        'contact-purge',
        { confirmEmail: first },
        {
          del: async () => {
            throw Error('Storage unavailable');
          },
        },
      )
    ).filesDeleted,
    false,
  );
  assert.equal((await contactList(db)).contacts.length, 0);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM club_forms.contact_file_deletions',
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    await cleanupContactFiles(db, {
      del: async (paths) =>
        assert.deepEqual(paths, ['contributions/retry-test']),
    }),
    true,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM club_forms.contact_file_deletions',
      )
    ).rows[0].n,
    0,
  );
});
