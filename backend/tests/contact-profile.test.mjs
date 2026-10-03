import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import {
  manageContact,
  contactHistory,
  contactList,
} from '../lib/contacts.mjs';
let db;
const actor = 'officer@example.edu';
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
    '017_contact_profile_editing.sql',
  ])
    await db.exec(
      await readFile(new URL('../' + file, import.meta.url), 'utf8'),
    );
  await db.exec(
    'CREATE TABLE club_forms.custom_survey_members(email text PRIMARY KEY)',
  );
});
after(() => db.close());
beforeEach(() =>
  db.exec(
    'TRUNCATE club_forms.entries,club_forms.contacts,club_forms.custom_survey_members CASCADE',
  ),
);
const contact = async (email) =>
  (await contactHistory(db, { email })).contact;
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
    (
      await db.query('SELECT email FROM club_forms.entries WHERE id=$1', [
        id,
      ])
    ).rows[0].email,
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
test('unused aliases can be removed while used aliases, primary addresses and survey access are protected', async () => {
  await seed('original@example.edu');
  await edit('original@example.edu', 'unused@example.edu');
  await edit('unused@example.edu', 'chosen@example.edu');
  assert.equal(
    (await remove('chosen@example.edu', 'unused@example.edu'))
      .aliasRemoved,
    true,
  );
  assert.equal((await contact('chosen@example.edu')).emails.length, 2);
  await assert.rejects(contact('unused@example.edu'), { status: 404 });
  assert.ok(
    (
      await contactHistory(db, { email: 'chosen@example.edu' })
    ).history.some((row) => row.label === 'Contact edited'),
  );
  await assert.rejects(
    remove('chosen@example.edu', 'original@example.edu'),
    { status: 409 },
  );
  await assert.rejects(
    remove('chosen@example.edu', 'chosen@example.edu'),
    { status: 400 },
  );
  await edit('chosen@example.edu', 'advisor@example.edu');
  await db.query(
    "INSERT INTO club_forms.custom_survey_members(email) VALUES('chosen@example.edu')",
  );
  await assert.rejects(
    remove('advisor@example.edu', 'chosen@example.edu'),
    { status: 409 },
  );
  assert.equal(
    (await contact('advisor@example.edu')).aliases.find(
      (row) => row.email === 'chosen@example.edu',
    ).membership,
    true,
  );
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
