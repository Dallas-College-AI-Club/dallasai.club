import { testDatabase } from './helpers/db.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { manageResponse } from '../lib/survey-management.mjs';
import {
  reportRows,
  summarizeResponses,
  responsesCSV,
} from '../lib/survey-report.mjs';
import {
  contactHistory,
  contactList,
  addContactNote,
} from '../lib/contacts.mjs';
import { surveyResults } from '../lib/surveys.mjs';
import { surveysHandler } from '../api/surveys.mjs';
let db;
const qid = randomUUID(),
  actor = 'officer@example.edu';
const questions = [
  {
    id: qid,
    label: 'Pick a game',
    type: 'multiple',
    options: ['Chess', 'Cards'],
    allowOther: true,
    required: false,
  },
];
test('summary and CSV count Any of these consistently without choosing None, Not sure, or Other', () => {
  const question = {
    ...questions[0],
    options: [
      'Chess',
      'Cards',
      'Any of these',
      'None of these',
      'Not sure yet',
    ],
  };
  const rows = ['Any of these', 'Chess'].map((value, index) => ({
    event_id: 'games',
    event_title: 'Games',
    event_date: '',
    survey_version: 'v1',
    name: 'Person ' + index,
    email: 'person@example.edu',
    created_at: '2026-10-03T00:00:00Z',
    questions: [question],
    answers: [{ questionId: qid, value: [value], other: '' }],
  }));
  const choices = summarizeResponses(rows).groups[0].questions[0].choices;
  assert.deepEqual(
    choices.map((c) => [c.label, c.count]),
    [
      ['Chess', 2],
      ['Cards', 1],
      ['Any of these', 1],
      ['None of these', 0],
      ['Not sure yet', 0],
      ['Other', 0],
    ],
  );
  assert.match(responsesCSV(rows), /Yes \(Any of these\)/);
  rows[0].answers[0].value = ['Chess', 'Any of these'];
  assert.equal(
    summarizeResponses(rows).groups[0].questions[0].choices[0].count,
    2,
  );
});
before(async () => {
  db = await testDatabase();
});
after(() => db.close());
beforeEach(() =>
  db.exec('TRUNCATE club_forms.entries,club_forms.contacts CASCADE'),
);
async function seed(n = 0, extra = {}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO club_forms.entries(id,kind,email,name,dedupe_key,data) VALUES($1::uuid,'rsvp',$2,$3,$1::text,'{"eventTitle":"Game night"}')`,
    [id, extra.email || `person${n}@example.edu`, extra.name || 'Person ' + n],
  );
  await db.query(
    `INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,survey_version,questions,answers) VALUES($1,'game-night','Game night',$2,$3,$4)`,
    [
      id,
      extra.version || 'v1',
      JSON.stringify(extra.questions || questions),
      JSON.stringify(
        extra.answers || [
          { questionId: qid, value: ['Chess', 'Cards'], other: '' },
        ],
      ),
    ],
  );
  return id;
}
test('star/archive/restore persist separately, are retry-safe and audited; filters apply together', async () => {
  const id = await seed(),
    second = await seed(1);
  const original = (await surveyResults(db, { entryId: id })).responses[0];
  await manageResponse(db, { entryId: id, action: 'star', value: true }, actor);
  await manageResponse(db, { entryId: id, action: 'star', value: true }, actor);
  assert.equal((await surveyResults(db, { starred: true })).total, 1);
  assert.equal(
    (await surveyResults(db, { search: 'PERSON0@EXAMPLE' })).responses[0]
      .entry_id,
    id,
  );
  await manageResponse(
    db,
    { entryId: id, action: 'archive', value: true },
    actor,
  );
  assert.equal((await surveyResults(db)).responses[0].entry_id, second);
  assert.equal(
    (
      await surveyResults(db, {
        view: 'archived',
        starred: true,
        search: 'Person 0',
      })
    ).responses[0].entry_id,
    id,
  );
  await manageResponse(
    db,
    { entryId: id, action: 'archive', value: false },
    actor,
  );
  assert.equal((await surveyResults(db)).total, 2);
  const restored = (await surveyResults(db, { entryId: id })).responses[0];
  assert.deepEqual(restored.answers, original.answers);
  assert.deepEqual(restored.questions, original.questions);
  assert.equal(restored.starred, true);
  assert.deepEqual(
    (
      await db.query('SELECT action FROM club_forms.audit ORDER BY id')
    ).rows.map((r) => r.action),
    ['survey-starred', 'survey-archived', 'survey-restored'],
  );
  await assert.rejects(
    manageResponse(
      db,
      { entryId: randomUUID(), action: 'archive', value: true },
      actor,
    ),
    { status: 404 },
  );
  await assert.rejects(surveyResults(db, { view: 'unknown' }), {
    status: 400,
  });
  assert.equal((await surveyResults(db, { search: '%' })).total, 0);
});
test('reports include every page, respect filters, preserve versions and escape spreadsheet formulas', async () => {
  for (let i = 0; i < 52; i++) await seed(i);
  const id = await seed(53, {
    name: '=IMPORTDATA("bad")',
    version: 'v2',
    questions: [
      {
        ...questions[0],
        label: 'Changed question',
        type: 'text',
        options: [],
        allowOther: false,
      },
    ],
    answers: [
      { questionId: qid, value: '@formula\n"quoted",value', other: '' },
    ],
  });
  const rows = await reportRows(db, {}),
    summary = summarizeResponses(rows);
  assert.equal(rows.length, 53);
  assert.equal(summary.total, 53);
  assert.equal(summary.groups.length, 2);
  const old = summary.groups.find((g) => g.version === 'v1');
  assert.equal(old.count, 52);
  assert.equal(old.questions[0].choices[0].count, 52);
  assert.equal(old.questions[0].choices[0].percent, 100);
  assert.equal(old.questions[0].choices[1].percent, 100);
  const csv = responsesCSV(rows);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=IMPORTDATA'));
  assert.ok(csv.includes('"\'@formula ""quoted"",value"'));
  assert.ok(csv.includes('Pick a game — Chess [v1]'));
  assert.equal(csv.split('\r\n').filter(Boolean).length, 54);
  assert.ok(csv.includes('Changed question [v2]'));
  await manageResponse(
    db,
    { entryId: id, action: 'archive', value: true },
    actor,
  );
  assert.equal((await reportRows(db, {})).length, 52);
  assert.equal((await reportRows(db, { view: 'archived' })).length, 1);
  assert.equal((await reportRows(db, { search: 'Person 0' })).length, 1);
});
test('contact consolidation backfills, captures new submissions, links aliases and notes without duplicate retries', async () => {
  const id = await seed(0, {
    email: 'member@example.edu',
    name: 'First name',
  });
  await seed(1, { email: 'member@example.edu', name: 'New name' });
  assert.equal((await contactList(db)).contacts.length, 1);
  const history = await contactHistory(db, {
    email: ' MEMBER@EXAMPLE.EDU ',
  });
  assert.equal(
    history.history.filter((h) => h.type === 'submission').length,
    2,
  );
  assert.deepEqual(history.contact.names, ['First name', 'New name']);
  assert.equal(
    (await contactList(db, { search: 'First name' })).contacts[0].email,
    'member@example.edu',
  );
  const body = {
    email: 'member@example.edu',
    noteId: randomUUID(),
    note: 'Called to confirm attendance.',
  };
  await addContactNote(db, body, actor);
  await addContactNote(db, body, actor);
  assert.equal(
    (await contactHistory(db, { email: body.email })).history.filter(
      (h) => h.type === 'note',
    ).length,
    1,
  );
  await assert.rejects(
    addContactNote(db, { ...body, note: 'Changed' }, actor),
    { status: 409 },
  );
  await db.query(
    `INSERT INTO club_forms.entry_comments(id,entry_id,author_email,body) VALUES($1,$2,$3,'Reply recorded in inbox')`,
    [randomUUID(), id, actor],
  );
  assert.equal(
    (await contactHistory(db, { email: body.email })).history.filter(
      (h) => h.type === 'comment',
    ).length,
    1,
  );
  await db.exec(
    await readFile(
      new URL('../015_contact_identity_management.sql', import.meta.url),
      'utf8',
    ),
  );
  assert.equal((await contactList(db)).contacts.length, 1);
});
test('all result/contact/report endpoints require admin; mutations reject foreign origins before reading the DB', async () => {
  process.env.AUTH_BASE_URL = 'https://office.example.edu';
  let touched = false;
  const response = () => ({
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(value) {
      this.body = value;
    },
  });
  const handler = surveysHandler({
    authorize: () => ({ email: actor }),
    getDatabase: () => {
      touched = true;
      return db;
    },
  });
  const res = response();
  await handler(
    {
      method: 'POST',
      url: '/api/surveys',
      headers: { origin: 'https://wrong.example.edu' },
    },
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(touched, false);
  const id = await seed();
  const saved = response();
  await handler(
    {
      method: 'POST',
      url: '/api/surveys',
      headers: {
        origin: process.env.AUTH_BASE_URL,
        'content-type': 'application/json',
      },
      body: { action: 'star', entryId: id, value: true },
    },
    saved,
  );
  assert.equal(saved.statusCode, 200);
  const csv = response();
  await handler({ method: 'GET', url: '/api/surveys?export=csv' }, csv);
  assert.equal(csv.statusCode, 200);
  assert.equal(csv.headers['Cache-Control'], 'private, no-store');
  assert.ok(csv.body.includes('person0@example.edu'));
  const { RequestError } = await import('../lib/errors.mjs');
  const denied = surveysHandler({
    authorize: () => {
      throw new RequestError(401, 'Sign in');
    },
    getDatabase: () => {
      throw Error('Must not read');
    },
  });
  for (const suffix of [
    '',
    '?summary=1',
    '?export=csv',
    '?contacts=1',
    '?contact=person0@example.edu',
  ]) {
    const r = response();
    await denied({ method: 'GET', url: '/api/surveys' + suffix }, r);
    assert.equal(r.statusCode, 401);
    assert.ok(!r.body.includes('person0'));
  }
});
test('event-survey summaries and CSV exports are audited once they are compiled', async () => {
  await seed();
  const handler = surveysHandler({
    authorize: () => ({ email: actor }),
    getDatabase: () => db,
  });
  const statuses = [];
  for (const url of [
    '/api/surveys?summary=1',
    '/api/surveys?export=csv&eventId=game-night',
    '/api/surveys?summary=1&eventId=Not%20an%20event',
  ]) {
    const res = { setHeader() {}, end() {} };
    await handler({ method: 'GET', url }, res);
    statuses.push(res.statusCode);
  }
  assert.deepEqual(statuses, [200, 200, 400]);
  assert.deepEqual(
    (
      await db.query(
        'SELECT actor,entry_id,action FROM club_forms.audit ORDER BY id',
      )
    ).rows,
    [
      { actor, entry_id: null, action: 'survey-summary:all' },
      { actor, entry_id: null, action: 'survey-export-csv:game-night' },
    ],
  );
});
