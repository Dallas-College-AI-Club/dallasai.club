import { testDatabase } from './helpers/db.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { changeSubmission } from '../lib/submission-management.mjs';
import { adminHandler } from '../api/admin.mjs';
import { surveysHandler } from '../api/surveys.mjs';
import { RequestError } from '../lib/errors.mjs';
import { manageResponse } from '../lib/survey-management.mjs';
import { responsesCSV } from '../lib/survey-report.mjs';
import { manageContact, cleanupContactFiles } from '../lib/contacts.mjs';
let db, server, origin;
const actor = 'admin@example.edu',
  qid = randomUUID(),
  removedFiles = [];
const questions = [
  {
    id: qid,
    label: 'When can you come?',
    type: 'multiple',
    required: true,
    allowOther: true,
    options: [
      'October 16 — afternoon',
      'October 17 — evening',
      'Any of these',
      'None of these times',
      'Not sure yet',
    ],
  },
];
before(async () => {
  db = await testDatabase();
  const config = {
    getDatabase: () => db,
    getEvents: async () => [],
    authorize: (req) => {
      if (req.headers['x-test-admin'] !== 'yes')
        throw new RequestError(401, 'Sign in');
      return { email: actor };
    },
    storage: { del: async (paths) => removedFiles.push(...paths) },
  };
  const admin = adminHandler(config),
    survey = surveysHandler(config);
  server = http.createServer((req, res) =>
    (req.url.startsWith('/api/surveys') ? survey : admin)(req, res),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});
beforeEach(async () => {
  removedFiles.length = 0;
  await db.exec(
    'TRUNCATE club_forms.entries,club_forms.contacts,club_forms.entry_changes,club_forms.contact_file_deletions,club_forms.audit CASCADE',
  );
});
async function seed({
  kind = 'rsvp',
  email = 'person@example.edu',
  survey = true,
  data,
  archived = false,
} = {}) {
  const id = randomUUID();
  data ??=
    kind === 'rsvp'
      ? {
          eventId: 'game-night',
          eventTitle: 'Game night',
          eventDate: '2020-01-01',
          hasSurvey: survey,
        }
      : {
          subject: 'Access',
          message: 'Original question',
          eventId: 'game-night',
          eventTitle: 'Game night',
        };
  await db.query(
    `INSERT INTO club_forms.entries(id,kind,email,name,email_verified,dedupe_key,data,review_status) VALUES($1,$2,$3,'Person',true,$4,$5,$6)`,
    [
      id,
      kind,
      email,
      kind === 'rsvp' ? `rsvp:game-night:${email}` : id,
      JSON.stringify(data),
      archived ? 'closed' : 'new',
    ],
  );
  if (survey)
    await db.query(
      `INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,survey_version,questions,answers) VALUES($1,'game-night','Game night','original-snapshot',$2,$3)`,
      [
        id,
        JSON.stringify(questions),
        JSON.stringify([
          { questionId: qid, value: [questions[0].options[0]], other: '' },
        ]),
      ],
    );
  return id;
}
const edit = (id, extra = {}) => ({
  action: 'edit-submission',
  entryId: id,
  requestId: randomUUID(),
  expectedRevision: 0,
  name: 'Edited Person',
  email: 'changed@example.edu',
  data: {},
  answers: [{ questionId: qid, value: [questions[0].options[1]], other: '' }],
  ...extra,
});
const remove = (id, extra = {}) => ({
  action: 'delete-submission',
  entryId: id,
  requestId: randomUUID(),
  expectedRevision: 0,
  ...extra,
});
const request = (path, body, headers = {}) =>
  fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-test-admin': 'yes',
      ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
test('edits use saved questions, preserve snapshots and context, audit once and reject stale/duplicate/invalid changes', async () => {
  const id = await seed(),
    body = edit(id);
  assert.equal((await changeSubmission(db, body, actor)).revision, 1);
  assert.equal((await changeSubmission(db, body, actor)).revision, 1);
  const entry = (
    await db.query('SELECT * FROM club_forms.entries WHERE id=$1', [id])
  ).rows[0];
  assert.equal(entry.name, 'Edited Person');
  assert.equal(entry.email, body.email);
  assert.equal(entry.email_verified, false);
  assert.equal(entry.data.eventTitle, 'Game night');
  assert.equal(
    (await db.query('SELECT * FROM club_forms.contacts')).rows.length,
    1,
  );
  const response = (
    await db.query(
      'SELECT * FROM club_forms.survey_responses WHERE entry_id=$1',
      [id],
    )
  ).rows[0];
  assert.deepEqual(response.questions, questions);
  assert.equal(response.survey_version, 'original-snapshot');
  assert.deepEqual(response.answers, body.answers);
  assert.equal(
    (
      await db.query(
        "SELECT * FROM club_forms.audit WHERE action='submission-edited'",
      )
    ).rows.length,
    1,
  );
  await assert.rejects(changeSubmission(db, edit(id), actor), {
    status: 409,
  });
  await assert.rejects(
    changeSubmission(db, { ...body, name: 'Changed retry' }, actor),
    { status: 409 },
  );
  await assert.rejects(
    changeSubmission(
      db,
      edit(id, {
        expectedRevision: 1,
        answers: [
          {
            questionId: qid,
            value: ['Any of these', questions[0].options[0]],
            other: '',
          },
        ],
      }),
      actor,
    ),
    { status: 400 },
  );
  await assert.rejects(
    changeSubmission(
      db,
      edit(id, { expectedRevision: 1, data: { eventTitle: 'Forged' } }),
      actor,
    ),
    { status: 400 },
  );
  await seed({ email: 'taken@example.edu' });
  await assert.rejects(
    changeSubmission(
      db,
      edit(id, { expectedRevision: 1, email: 'taken@example.edu' }),
      actor,
    ),
    { status: 409 },
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT answers FROM club_forms.survey_responses WHERE entry_id=$1',
        [id],
      )
    ).rows[0].answers,
    body.answers,
  );
});
test('Inbox edits regular questions without changing event metadata and enforces authorization/origin', async () => {
  const id = await seed({ kind: 'question', survey: false });
  assert.equal(
    (
      await request('/api/admin?edit=' + id, null, {
        'x-test-admin': 'no',
      })
    ).status,
    401,
  );
  assert.equal((await request('/api/admin?edit=' + id)).status, 200);
  const body = edit(id, {
    answers: undefined,
    data: { subject: 'Corrected title', message: 'New wording' },
  });
  assert.equal(
    (await request('/api/admin', body, { Origin: 'https://evil.example' }))
      .status,
    403,
  );
  assert.equal(
    (await request('/api/admin', body, { 'x-test-admin': 'no' })).status,
    401,
  );
  assert.equal((await request('/api/admin', body)).status, 200);
  const entry = (await (await request('/api/admin?edit=' + id)).json()).entry;
  assert.equal(entry.data.message, 'New wording');
  assert.equal(entry.data.eventTitle, 'Game night');
  assert.equal((await request('/api/surveys', remove(id))).status, 409);
});
test('archive-only deletion cascades response details, retries safely, removes orphan identity and queues attachment cleanup', async () => {
  const id = await seed();
  const body = remove(id);
  await assert.rejects(changeSubmission(db, body, actor), { status: 409 });
  await db.query(
    "UPDATE club_forms.entries SET review_status='closed' WHERE id=$1",
    [id],
  );
  await db.query(
    "INSERT INTO club_forms.attachments(id,entry_id,name,content_type,size,pathname) VALUES($1,$2,'file.txt','text/plain',10,'test/path')",
    [randomUUID(), id],
  );
  await db.query(
    "INSERT INTO club_forms.entry_comments(id,entry_id,author_email,body) VALUES($1,$2,$3,'A note')",
    [randomUUID(), id, actor],
  );
  const result = await changeSubmission(db, body, actor);
  assert.equal(result.deleted, true);
  assert.equal(result.contactRemoved, true);
  assert.equal((await changeSubmission(db, body, actor)).deleted, true);
  for (const table of [
    'entries',
    'survey_responses',
    'entry_comments',
    'attachments',
    'contacts',
    'contact_emails',
  ])
    assert.equal(
      (await db.query(`SELECT count(*)::int AS n FROM club_forms.${table}`))
        .rows[0].n,
      0,
      table,
    );
  assert.equal(
    (await db.query('SELECT * FROM club_forms.contact_file_deletions')).rows
      .length,
    1,
  );
  assert.equal(
    await cleanupContactFiles(db, {
      del: async () => {
        throw Error('offline');
      },
    }),
    false,
  );
  assert.equal(
    await cleanupContactFiles(db, {
      del: async (paths) => removedFiles.push(...paths),
    }),
    true,
  );
  assert.deepEqual(removedFiles, ['test/path']);
  const receipts = JSON.stringify(
    (await db.query('SELECT * FROM club_forms.entry_changes')).rows,
  );
  assert.ok(!receipts.includes('person@example.edu'));
  assert.ok(!receipts.includes('Person'));
  assert.equal(
    (
      await db.query(
        "SELECT * FROM club_forms.audit WHERE action='submission-permanently-deleted'",
      )
    ).rows.length,
    1,
  );
});
test('permanent deletion needs the Inbox archive on both surfaces; a survey archive alone is not enough', async () => {
  const id = await seed();
  await manageResponse(
    db,
    { action: 'archive', entryId: id, value: true },
    actor,
  );
  for (const path of ['/api/surveys', '/api/admin']) {
    const refused = await request(path, remove(id));
    assert.equal(refused.status, 409, path);
    assert.equal(
      (await refused.json()).error,
      'Archive this RSVP in Inbox before deleting it permanently.',
    );
  }
  assert.equal((await request('/api/admin?edit=' + id)).status, 200);
  await request('/api/admin', { action: 'review', id, status: 'closed' });
  const body = remove(id);
  assert.equal((await request('/api/surveys', body)).status, 200);
  assert.equal((await request('/api/surveys', body)).status, 200);
  assert.equal((await request('/api/admin?edit=' + id)).status, 404);
  const question = await seed({ kind: 'question', survey: false });
  const refused = await request('/api/admin', remove(question));
  assert.equal(refused.status, 409);
  assert.equal(
    (await refused.json()).error,
    'Archive this submission in Inbox before deleting it permanently.',
  );
  await request('/api/admin', {
    action: 'review',
    id: question,
    status: 'closed',
  });
  assert.equal((await request('/api/admin', remove(question))).status, 200);
});
test('deletion retains identities with another alias submission or independent contact notes', async () => {
  const id = await seed({ archived: true, email: 'old@example.edu' });
  await seed({ email: 'new@example.edu' });
  const contact = (
    await db.query(
      "SELECT revision FROM club_forms.contacts WHERE email='old@example.edu'",
    )
  ).rows[0];
  const target = (
    await db.query(
      "SELECT revision FROM club_forms.contacts WHERE email='new@example.edu'",
    )
  ).rows[0];
  await manageContact(
    db,
    {
      action: 'contact-merge',
      email: 'old@example.edu',
      targetEmail: 'new@example.edu',
      revision: contact.revision,
      targetRevision: target.revision,
    },
    actor,
  );
  await changeSubmission(db, remove(id), actor);
  assert.equal(
    (await db.query('SELECT * FROM club_forms.contact_emails')).rows.length,
    2,
  );
  const noteId = await seed({ archived: true, email: 'note@example.edu' });
  await db.query(
    "INSERT INTO club_forms.contact_notes(id,email,author_email,body) VALUES($1,'note@example.edu',$2,'Keep in touch')",
    [randomUUID(), actor],
  );
  assert.equal(
    (await changeSubmission(db, remove(noteId), actor)).contactRemoved,
    false,
  );
  assert.equal(
    (
      await db.query(
        "SELECT * FROM club_forms.contacts WHERE email='note@example.edu'",
      )
    ).rows.length,
    1,
  );
  // A custom survey respondent keeps their contact record too.
  const memberId = await seed({ archived: true, email: 'member@example.edu' });
  const surveyId = randomUUID();
  await db.query(
    `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,link_digest,expires_at)
     VALUES($1,'retention-check','Retention check','v1','retention-digest',now()+interval '1 day')`,
    [surveyId],
  );
  await db.query(
    `INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email)
     VALUES($1,'member','Member','member@example.edu')`,
    [surveyId],
  );
  assert.equal(
    (await changeSubmission(db, remove(memberId), actor)).contactRemoved,
    false,
  );
  assert.equal(
    (
      await db.query(
        "SELECT * FROM club_forms.contacts WHERE email='member@example.edu'",
      )
    ).rows.length,
    1,
  );
});
test('CSV has one line per response and explicit columns for chosen dates, including Any without implying None', () => {
  const base = {
    questions,
    answers: [{ questionId: qid, value: ['Any of these'], other: '' }],
    survey_version: 'v1',
    name: 'Name',
    email: 'a@example.edu',
    created_at: '2026-10-03T00:00:00Z',
  };
  const csv = responsesCSV([
    base,
    {
      ...base,
      answers: [
        { questionId: qid, value: ['October 17 — evening'], other: '' },
      ],
    },
  ]);
  const rows = csv.trim().split('\r\n');
  assert.equal(rows.length, 3);
  assert.match(rows[0], /When can you come\? — October 16 — afternoon/);
  assert.match(
    rows[1],
    /"Any of these","Yes \(Any of these\)","Yes \(Any of these\)","Yes","No","No"/,
  );
  assert.match(rows[2], /"October 17 — evening","No","Yes","No","No","No"/);
});
