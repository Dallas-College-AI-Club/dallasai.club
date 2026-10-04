import { testDatabase } from './helpers/db.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  contactList,
  contactHistory,
  addContactNote,
  manageContact,
  cleanupContactFiles,
} from '../lib/contacts.mjs';
import { surveysHandler } from '../api/surveys.mjs';
import { RequestError } from '../lib/errors.mjs';
let db;
const actor = 'officer@example.edu',
  first = 'e12345@student.dcccd.edu',
  second = 'mk23@student.dallascollege.edu';
before(async () => {
  db = await testDatabase();
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
test('stale actions, mismatched test flags and a missing or wrong typed email are rejected', async () => {
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
      {
        email: first,
        revision: stale.revision,
        action: 'contact-purge',
        confirmEmail: first,
      },
      actor,
    ),
    { status: 409 },
  );
  await assert.rejects(change(first, 'contact-purge'), { status: 400 });
  await assert.rejects(
    change(first, 'contact-purge', { confirmEmail: second }),
    { status: 400 },
  );
  // Contacts marked as test before one-step deletion keep their safeguards.
  await change(first, 'contact-test', { value: true });
  await assert.rejects(change(first, 'contact-delete'), { status: 409 });
  await assert.rejects(merge(first, second), { status: 409 });
  await change(first, 'contact-test', { value: false });
  await merge(first, second);
  assert.equal((await contact(first)).submissions, 2);
});
test('Mark as test deletes a contact and its linked answers, comments, notes, audit and files in one step, preserving unrelated people', async () => {
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
  // The confirmation states these counts; the contact was never marked first.
  const shown = await contact(second);
  assert.deepEqual(
    [
      shown.is_test,
      shown.emails.length,
      shown.submissions,
      shown.survey_responses,
      shown.comments,
      shown.notes,
      shown.attachments,
    ],
    [false, 2, 2, 2, 1, 1, 1],
  );
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
    'contact_activity',
    'contact_file_deletions',
  ])
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM club_forms.' + table))
        .rows[0].n,
      0,
      table,
    );
  // Only a receipt is left: who purged, a hash prefix and counts, no address.
  const receipt = (
    await db.query('SELECT actor,entry_id,action FROM club_forms.audit')
  ).rows;
  assert.deepEqual(receipt, [
    {
      actor,
      entry_id: null,
      action: 'contact-purged:entries=2:notes=1:files=1',
    },
  ]);
  for (const text of [first, second, 'student', 'dallascollege', 'Member'])
    assert.ok(!JSON.stringify(receipt).includes(text), text);
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
test('Mark as test deletion needs a signed-in officer on the office origin, and its receipt names that officer only', async () => {
  process.env.AUTH_BASE_URL = 'https://office.example.edu';
  await seed(first);
  const { revision } = await contact(first);
  const post = async (authorize, origin) => {
    const res = { setHeader() {}, end() {} };
    await surveysHandler({
      authorize,
      getDatabase: () => db,
      storage: { del: async () => {} },
    })(
      {
        method: 'POST',
        url: '/api/surveys',
        headers: { origin, 'content-type': 'application/json' },
        body: {
          action: 'contact-purge',
          email: first,
          revision,
          confirmEmail: first,
        },
      },
      res,
    );
    return res.statusCode;
  };
  const officer = () => ({ email: actor });
  assert.equal(
    await post(() => {
      throw new RequestError(401, 'Sign in');
    }, process.env.AUTH_BASE_URL),
    401,
  );
  assert.equal(await post(officer, 'https://wrong.example.edu'), 403);
  assert.equal((await contact(first)).submissions, 1);
  assert.equal(await post(officer, process.env.AUTH_BASE_URL), 200);
  await assert.rejects(contact(first), { status: 404 });
  assert.deepEqual(
    (await db.query('SELECT actor,action FROM club_forms.audit')).rows,
    [{ actor, action: 'contact-purged:entries=1:notes=0:files=0' }],
  );
});
