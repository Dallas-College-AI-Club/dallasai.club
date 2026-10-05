import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.mjs';
import {
  manageContact,
  contactHistory,
  contactList,
  addContactNote,
  submissionContact,
} from '../lib/contacts.mjs';
let db;
const actor = 'officer@example.edu';
const surveyId = randomUUID();
before(async () => {
  db = await testDatabase();
  await db.query(
    `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,link_digest,expires_at)
     VALUES($1,'contact-profile-test','Contact profile test','v1','contact-profile-digest',now()+interval '1 day')`,
    [surveyId],
  );
});
after(() => db.close());
beforeEach(() =>
  db.exec(
    'TRUNCATE club_forms.entries,club_forms.contacts,club_forms.custom_survey_members CASCADE',
  ),
);
const contact = async (email) => (await contactHistory(db, { email })).contact;
async function seed(email, name = 'Member') {
  const id = randomUUID();
  await db.query(
    'INSERT INTO club_forms.entries(id,kind,email,name,data,dedupe_key) VALUES($1::uuid,\'question\',$2,$3,\'{"subject":"Help","message":"Question"}\',$1::text)',
    [id, email, name],
  );
  return id;
}
async function edit(source, target, name = 'Correct Name') {
  const c = await contact(source);
  return manageContact(
    db,
    {
      action: 'contact-edit',
      email: c.email,
      revision: c.revision,
      name,
      primaryEmail: target,
    },
    actor,
  );
}
async function remove(source, alias) {
  const c = await contact(source);
  return manageContact(
    db,
    {
      action: 'contact-remove-alias',
      email: c.email,
      revision: c.revision,
      alias,
    },
    actor,
  );
}
test('contact editing consolidates an existing alias under one chosen primary and preserves history and the edited name', async () => {
  const old = 'old@example.edu',
    preferred = 'preferred@example.edu';
  const id = await seed(old, 'Original');
  await seed(preferred, 'Other name');
  await manageContact(
    db,
    {
      action: 'contact-merge',
      email: old,
      revision: (await contact(old)).revision,
      targetEmail: preferred,
      targetRevision: (await contact(preferred)).revision,
    },
    actor,
  );
  await edit(preferred, old);
  assert.equal((await contactList(db)).contacts.length, 1);
  assert.equal((await contact(preferred)).email, old);
  assert.equal((await contact(old)).name, 'Correct Name');
  assert.equal((await contact(old)).submissions, 2);
  assert.equal(
    (await db.query('SELECT email FROM club_forms.entries WHERE id=$1', [id]))
      .rows[0].email,
    old,
  );
  await seed(preferred, 'Stale submitted name');
  assert.equal((await contact(old)).name, 'Correct Name');
  assert.equal((await contactList(db)).contacts.length, 1);
  assert.equal((await contact(old)).submissions, 3);
});
test('new primary email is searchable, retains flags, and prevents stale edits or claiming another contact', async () => {
  await seed('a@example.edu');
  await seed('b@example.edu');
  const old = await contact('a@example.edu');
  await edit(old.email, 'new@example.edu');
  assert.equal((await contact(old.email)).email, 'new@example.edu');
  assert.equal(
    (await contactList(db, { search: 'a@example.edu' })).contacts[0].email,
    'new@example.edu',
  );
  await assert.rejects(
    manageContact(
      db,
      {
        action: 'contact-edit',
        email: old.email,
        revision: old.revision,
        name: 'Overwrite',
        primaryEmail: 'bad@example.edu',
      },
      actor,
    ),
    { status: 409 },
  );
  await assert.rejects(edit('new@example.edu', 'b@example.edu'), {
    status: 409,
  });
  await assert.rejects(edit('new@example.edu', '<bad>@example.edu'), {
    status: 400,
  });
  assert.equal((await contactList(db)).contacts.length, 2);
});
test('removing an address hides it while preserving linked submissions, RSVP answers, notes and survey membership', async () => {
  const id = await seed('original@example.edu');
  await db.query(
    `INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,survey_version,questions,answers)
     VALUES($1,'retained-event','Retained RSVP','v1','[]','[]')`,
    [id],
  );
  await addContactNote(
    db,
    {
      email: 'original@example.edu',
      noteId: randomUUID(),
      note: 'Keep this note',
    },
    actor,
  );
  await db.query(
    `INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email)
     VALUES($1,'original','Original Advisor','original@example.edu')`,
    [surveyId],
  );
  await edit('original@example.edu', 'unused@example.edu');
  await edit('unused@example.edu', 'chosen@example.edu');
  assert.equal(
    (await remove('chosen@example.edu', 'unused@example.edu')).aliasRemoved,
    true,
  );
  assert.equal((await contact('chosen@example.edu')).emails.length, 2);
  assert.equal(
    (await contact('unused@example.edu')).email,
    'chosen@example.edu',
  );
  assert.ok(
    (await contactHistory(db, { email: 'chosen@example.edu' })).history.some(
      (row) => row.label === 'Contact edited',
    ),
  );
  await remove('chosen@example.edu', 'original@example.edu');
  const current = await contact('chosen@example.edu');
  assert.deepEqual(current.emails, ['chosen@example.edu']);
  assert.deepEqual(
    current.aliases.map((row) => row.email),
    ['chosen@example.edu'],
  );
  assert.equal(current.submissions, 1);
  assert.equal(current.counts.survey_responses, 1);
  assert.equal(current.counts.notes, 1);
  assert.equal(current.counts.addresses, 3);
  assert.equal(
    (await contactList(db, { search: 'original@example.edu' })).contacts.length,
    0,
  );
  assert.equal(
    (await db.query('SELECT email FROM club_forms.entries WHERE id=$1', [id]))
      .rows[0].email,
    'original@example.edu',
  );
  assert.equal(
    (
      await db.query(
        'SELECT email FROM club_forms.custom_survey_members WHERE survey_id=$1',
        [surveyId],
      )
    ).rows[0].email,
    'original@example.edu',
  );
  assert.equal(
    (await submissionContact(db, { id, email: 'original@example.edu' })).email,
    'chosen@example.edu',
  );
  assert.equal(
    (await contactHistory(db, { email: current.email })).history.filter(
      (row) => row.type === 'submission' || row.type === 'note',
    ).length,
    2,
  );
  await assert.rejects(remove('chosen@example.edu', 'chosen@example.edu'), {
    status: 400,
  });
  await assert.rejects(edit(current.email, 'original@example.edu'), {
    status: 409,
  });
  await seed('original@example.edu', 'Submitted later');
  assert.equal((await contact(current.email)).submissions, 2);
  assert.deepEqual((await contact(current.email)).emails, [
    'chosen@example.edu',
  ]);
  assert.equal((await contactList(db)).contacts.length, 1);
  const latest = await contact(current.email);
  await manageContact(
    db,
    {
      action: 'contact-purge',
      email: latest.email,
      revision: latest.revision,
      counts: latest.counts,
      confirmEmail: latest.email,
    },
    actor,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM club_forms.entries')).rows[0]
      .n,
    0,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM club_forms.survey_responses'))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM club_forms.contact_notes'))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM club_forms.contact_emails'))
      .rows[0].n,
    0,
  );
});
test('address removal rejects stale revisions and rolls back when its audit cannot be saved', async () => {
  await seed('history@example.edu');
  await edit('history@example.edu', 'primary@example.edu');
  const stale = await contact('primary@example.edu');
  await edit(stale.email, stale.email, 'Updated name');
  await assert.rejects(
    manageContact(
      db,
      {
        action: 'contact-remove-alias',
        email: stale.email,
        revision: stale.revision,
        alias: 'history@example.edu',
      },
      actor,
    ),
    { status: 409 },
  );
  const fresh = await contact(stale.email);
  await assert.rejects(
    manageContact(
      db,
      {
        action: 'contact-remove-alias',
        email: fresh.email,
        revision: fresh.revision,
        alias: 'history@example.edu',
      },
      null,
    ),
  );
  assert.deepEqual((await contact(fresh.email)).emails, fresh.emails);
  assert.equal((await contact(fresh.email)).revision, fresh.revision);
  await remove(fresh.email, 'history@example.edu');
  await assert.rejects(remove(fresh.email, 'history@example.edu'), {
    status: 404,
  });
});
test('invalid names, deleted contacts and failed audit writes leave identity unchanged', async () => {
  await seed('person@example.edu');
  await assert.rejects(
    edit('person@example.edu', 'new@example.edu', 'a'.repeat(101)),
    { status: 400 },
  );
  const c = await contact('person@example.edu');
  await assert.rejects(
    manageContact(
      db,
      {
        action: 'contact-edit',
        email: c.email,
        revision: c.revision,
        name: 'New',
        primaryEmail: 'new@example.edu',
      },
      null,
    ),
  );
  assert.equal(
    (await contact('person@example.edu')).email,
    'person@example.edu',
  );
  await assert.rejects(contact('new@example.edu'), { status: 404 });
  await manageContact(
    db,
    { action: 'contact-delete', email: c.email, revision: c.revision },
    actor,
  );
  await assert.rejects(edit(c.email, 'new@example.edu'), { status: 409 });
});
