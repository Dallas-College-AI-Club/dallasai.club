import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { testDatabase } from './helpers/db.mjs';
import { manageResponse } from '../lib/survey-management.mjs';
import { saveSurveyResponse, surveyResults } from '../lib/surveys.mjs';
import {
  reportRows,
  responsesCSV,
  summarizeResponses,
} from '../lib/survey-report.mjs';
import { changeSubmission } from '../lib/submission-management.mjs';
import { surveysHandler } from '../api/surveys.mjs';
import { RequestError } from '../lib/errors.mjs';

let db;
const actor = 'officer@example.edu',
  qid = randomUUID();
const questions = [
  {
    id: qid,
    title: 'Choose',
    type: 'multiple',
    options: ['First', 'Second'],
    required: false,
  },
];
before(async () => {
  db = await testDatabase();
});
after(() => db.close());
beforeEach(() =>
  db.exec(
    'TRUNCATE club_forms.entries,club_forms.contacts,club_forms.custom_surveys CASCADE',
  ),
);
async function rsvp(
  email = 'member@example.edu',
  eventId = 'workshop',
  save = true,
) {
  const id = randomUUID(),
    data = { eventId, eventTitle: 'Workshop', eventDate: '', potential: false };
  const entry = (
    await db.query(
      `INSERT INTO club_forms.entries(id,kind,email,name,dedupe_key,data) VALUES($1::uuid,'rsvp',$2,'Member',$1::text,$3) RETURNING *`,
      [id, email, JSON.stringify(data)],
    )
  ).rows[0];
  if (save) await saveSurveyResponse(db, entry, null);
  return entry;
}
async function survey(eventId = 'workshop', status = 'open') {
  const id = randomUUID();
  await db.query(
    `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at,definition)
     VALUES($1::uuid,$1::text,'Feedback','custom-form/1',$2,$1::text,now()+interval '1 day',$3)`,
    [id, status, JSON.stringify({ eventId, questions })],
  );
  return id;
}
async function feedback(
  surveyId,
  email = 'member@example.edu',
  { active = true, empty = false } = {},
) {
  const advisor = randomUUID();
  await db.query(
    'INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email,active) VALUES($1,$2,$3,$4,$5)',
    [surveyId, advisor, 'Member', email, active],
  );
  await db.query(
    'INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,$2,1,$3)',
    [
      surveyId,
      advisor,
      JSON.stringify(
        empty
          ? []
          : [
              {
                id: qid,
                title: 'Choose',
                mode: 'form',
                value: [1],
                text: 'Second',
              },
            ],
      ),
    ],
  );
  return advisor;
}
const mark = (entry, value) =>
  manageResponse(db, { action: 'attendance', entryId: entry.id, value }, actor);

test('attendance defaults unknown, persists by event/email, audits transitions only, and rejects invalid mutations', async () => {
  const entry = await rsvp(),
    duplicate = await rsvp(),
    otherEvent = await rsvp('member@example.edu', 'other');
  assert.equal(
    (await surveyResults(db)).responses.every(
      (r) => r.attendance === 'not_recorded',
    ),
    true,
  );
  for (const value of ['present', true, '', null])
    await assert.rejects(mark(entry, value), { status: 400 });
  await assert.rejects(mark({ id: 'invalid' }, 'attended'), { status: 400 });
  await assert.rejects(mark({ id: randomUUID() }, 'attended'), { status: 404 });
  await mark(entry, 'attended');
  await mark(duplicate, 'attended');
  assert.equal((await surveyResults(db, { attendance: 'attended' })).total, 2);
  assert.equal(
    (await surveyResults(db, { entryId: otherEvent.id })).responses[0]
      .attendance,
    'not_recorded',
  );
  await mark(duplicate, 'did_not_attend');
  assert.equal(
    (await surveyResults(db, { entryId: entry.id })).responses[0].attendance,
    'did_not_attend',
  );
  await mark(entry, 'not_recorded');
  assert.deepEqual(
    (await db.query('SELECT actor,action FROM club_forms.audit ORDER BY id'))
      .rows,
    [
      { actor, action: 'attendance:not_recorded:attended' },
      { actor, action: 'attendance:attended:did_not_attend' },
      { actor, action: 'attendance:did_not_attend:not_recorded' },
    ],
  );
  for (const filter of [{ attendance: 'present' }, { feedback: 'complete' }])
    await assert.rejects(surveyResults(db, filter), { status: 400 });
});

test('completion requires every published same-event survey; archived evidence counts and withdrawn or deleted evidence does not', async () => {
  const entry = await rsvp();
  await survey('workshop', 'draft');
  const read = async () =>
    (await surveyResults(db, { entryId: entry.id })).responses[0];
  assert.equal((await read()).feedback_status, 'no_survey');
  const first = await survey(),
    second = await survey('workshop', 'closed');
  await feedback(await survey('other'));
  assert.equal((await read()).feedback_status, 'missing');
  await feedback(first, ' member@example.edu ', { active: false });
  assert.deepEqual(
    [
      (await read()).feedback_submitted_count,
      (await read()).feedback_survey_count,
      (await read()).feedback_status,
    ],
    [1, 2, 'missing'],
  );
  await feedback(second);
  assert.equal((await read()).feedback_status, 'submitted');
  assert.equal((await read()).attendance, 'not_recorded');
  await db.query(
    "UPDATE club_forms.custom_surveys SET status='archived',expires_at=now()-interval '1 day' WHERE id=$1",
    [first],
  );
  assert.equal((await read()).feedback_status, 'submitted');
  await db.query(
    "UPDATE club_forms.custom_survey_responses SET responses='[]' WHERE survey_id=$1",
    [second],
  );
  assert.equal((await read()).feedback_status, 'missing');
  await db.query(
    'DELETE FROM club_forms.custom_survey_responses WHERE survey_id=$1',
    [first],
  );
  assert.equal((await read()).feedback_submitted_count, 0);
});

test('list, count, summary and CSV combine participation filters across pages with archive, search and bookmarks', async () => {
  const surveyId = await survey();
  for (let n = 0; n < 53; n++) {
    const entry = await rsvp(`member${n}@example.edu`);
    await mark(entry, 'attended');
    await manageResponse(
      db,
      { entryId: entry.id, action: 'star', value: true },
      actor,
    );
  }
  const complete = await rsvp('complete@example.edu');
  await feedback(surveyId, 'complete@example.edu');
  await mark(complete, 'attended');
  const archived = await rsvp('archived@example.edu');
  await mark(archived, 'attended');
  await manageResponse(
    db,
    { entryId: archived.id, action: 'archive', value: true },
    actor,
  );
  const filter = {
    eventId: 'workshop',
    attendance: 'attended',
    feedback: 'missing',
    starred: true,
    search: 'MEMBER',
  };
  const first = await surveyResults(db, filter),
    last = await surveyResults(db, { ...filter, offset: 50 });
  assert.equal(first.total, 53);
  assert.equal(first.responses.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(last.total, 53);
  assert.equal(last.responses.length, 3);
  assert.equal(last.hasMore, false);
  const rows = await reportRows(db, filter);
  assert.equal(summarizeResponses(rows).total, 53);
  const csv = responsesCSV(rows);
  assert.equal(csv.split('\r\n').filter(Boolean).length, 54);
  assert.match(
    csv,
    /"Attendance","Feedback status","Feedback surveys submitted","Linked feedback surveys"/,
  );
  assert.doesNotMatch(csv, /complete@example|archived@example/);
  assert.equal((await surveyResults(db, { feedback: 'submitted' })).total, 1);
  assert.equal(
    (
      await surveyResults(db, {
        attendance: 'attended',
        feedback: 'missing',
        view: 'archived',
      })
    ).total,
    1,
  );
  assert.equal(
    (await surveyResults(db, { attendance: '', feedback: '' })).total,
    54,
  );
});

test('no-question RSVPs backfill idempotently, remain editable, and contact deletion removes attendance', async () => {
  const old = await rsvp('old@example.edu', 'workshop', false);
  const migration = await readFile(
    new URL('../021_event_participation.sql', import.meta.url),
    'utf8',
  );
  await db.exec(migration);
  await db.exec(migration);
  let row = (await surveyResults(db, { entryId: old.id })).responses[0];
  assert.deepEqual(row.questions, []);
  assert.deepEqual(row.answers, []);
  assert.equal(row.survey_version, '');
  await changeSubmission(
    db,
    {
      action: 'edit-submission',
      entryId: old.id,
      requestId: randomUUID(),
      expectedRevision: 0,
      name: 'Edited',
      email: old.email,
      data: {},
      answers: [],
    },
    actor,
    { surface: 'survey' },
  );
  assert.equal(
    (await surveyResults(db, { entryId: old.id })).responses[0].name,
    'Edited',
  );
  await mark(old, 'attended');
  await db.query('DELETE FROM club_forms.entries WHERE id=$1', [old.id]);
  await db.query('DELETE FROM club_forms.contact_emails WHERE email=$1', [
    old.email,
  ]);
  assert.equal(
    (await db.query('SELECT * FROM club_forms.event_attendance')).rows.length,
    0,
  );
  await db.exec('CREATE ROLE club_forms_api');
  await db.exec(migration);
  const privileges = (
    await db.query(`SELECT
    has_table_privilege('club_forms_api','club_forms.event_attendance','SELECT') AND
    has_table_privilege('club_forms_api','club_forms.event_attendance','INSERT') AND
    has_table_privilege('club_forms_api','club_forms.event_attendance','UPDATE') AS writes,
    has_table_privilege('club_forms_api','club_forms.event_attendance','DELETE') AS deletes`)
  ).rows[0];
  assert.deepEqual(privileges, { writes: true, deletes: false });
});

test('combined reports include linked feedback from every round, keep sources separate, and preserve choice values', async () => {
  const entry = await rsvp();
  await mark(entry, 'attended');
  await feedback(await survey());
  await feedback(await survey());
  await feedback(await survey('other'));
  const rows = await reportRows(db, {
    eventId: 'workshop',
    type: 'all',
    attendance: 'attended',
    feedback: 'submitted',
  });
  assert.equal(rows.length, 3);
  const groups = summarizeResponses(rows).groups;
  assert.equal(groups.length, 3);
  assert.ok(groups.every((g) => g.title === 'Workshop'));
  const selectedSurvey = rows.find((r) => r.survey_id).survey_id;
  const selectedRows = await reportRows(db, {
    eventId: 'workshop',
    type: 'all',
    surveyId: selectedSurvey,
  });
  assert.equal(selectedRows.length, 2);
  assert.equal(
    selectedRows.filter((r) => r.response_type === 'feedback').length,
    1,
  );
  assert.equal(
    selectedRows.find((r) => r.response_type === 'feedback').survey_id,
    selectedSurvey,
  );
  await assert.rejects(reportRows(db, { type: 'all', surveyId: 'bad' }), {
    status: 400,
  });
  const scopedHandler = surveysHandler({
    authorize: () => ({ email: actor }),
    getDatabase: () => db,
  });
  const scopedResponse = {
    setHeader() {},
    end(body) {
      this.body = JSON.parse(body);
    },
  };
  await scopedHandler(
    {
      method: 'GET',
      url:
        '/api/surveys?summary=1&type=all&eventId=workshop&surveyId=' +
        selectedSurvey,
    },
    scopedResponse,
  );
  assert.equal(scopedResponse.body.total, 2);
  assert.equal(groups.filter((g) => g.responseType === 'feedback').length, 2);
  assert.equal(
    groups.find((g) => g.responseType === 'feedback').questions[0].choices[1]
      .count,
    1,
  );
  assert.equal(
    (await reportRows(db, { eventId: 'workshop', type: 'feedback' })).length,
    2,
  );
  assert.equal(
    (
      await reportRows(db, {
        eventId: 'workshop',
        type: 'feedback',
        starred: true,
      })
    ).length,
    0,
  );
  assert.equal(
    (
      await reportRows(db, {
        eventId: 'workshop',
        type: 'all',
        feedback: 'missing',
      })
    ).length,
    0,
  );
  assert.equal(responsesCSV(rows).split('\r\n').filter(Boolean).length, 4);
  await assert.rejects(reportRows(db, { type: 'wrong' }), { status: 400 });
  await db.query(
    'UPDATE club_forms.custom_survey_members SET active=false WHERE survey_id=$1',
    [rows.find((r) => r.survey_id).survey_id],
  );
  assert.equal(
    (
      await reportRows(db, {
        eventId: 'workshop',
        type: 'feedback',
        view: 'archived',
      })
    ).length,
    1,
  );
  assert.equal(
    (
      await reportRows(db, {
        eventId: 'workshop',
        type: 'feedback',
        view: 'all',
      })
    ).length,
    2,
  );
  await assert.rejects(
    reportRows({ query: async () => ({ rows: Array(10001).fill(rows[0]) }) }),
    { status: 413 },
  );
});

test('feedback reports preserve exact custom choices and saved text, zero, rating and calendar values', async () => {
  const id = await survey(),
    member = await feedback(id);
  const cases = [
    ['multiple', ['First', 'Second', 'Any of these'], [2], 'Any of these'],
    ['single', ['First', 'Second'], 0, 'First'],
    ['number', [], 0, '0'],
    ['scale', [], 4, '4 / 5'],
    ['date', [], '2026-10-04', '2026-10-04'],
    ['text', [], '=SUM(1,2)', '=SUM(1,2)'],
  ].map(([type, options, value, text]) => ({
    id: randomUUID(),
    type,
    options,
    value,
    text,
  }));
  await db.query(
    'UPDATE club_forms.custom_surveys SET definition=$2 WHERE id=$1',
    [
      id,
      JSON.stringify({
        eventId: 'workshop',
        questions: cases.map(({ id, type, options }) => ({
          id,
          title: type,
          type,
          options,
        })),
      }),
    ],
  );
  await db.query(
    'UPDATE club_forms.custom_survey_responses SET responses=$3 WHERE survey_id=$1 AND advisor_id=$2',
    [
      id,
      member,
      JSON.stringify(
        cases.map(({ id, type, value, text }) => ({
          id,
          title: type,
          mode: 'form',
          value,
          text,
        })),
      ),
    ],
  );
  const rows = await reportRows(db, { type: 'feedback' }),
    summary = summarizeResponses(rows);
  assert.deepEqual(
    summary.groups[0].questions[0].choices.map((c) => c.count),
    [0, 0, 1],
  );
  assert.deepEqual(
    rows[0].answers.map((a) => a.value),
    [['Any of these'], 'First', '0', '4 / 5', '2026-10-04', '=SUM(1,2)'],
  );
  assert.match(responsesCSV(rows), /"'\=SUM\(1,2\)"/);
});

test('attendance change rolls back when its audit cannot be recorded', async () => {
  const entry = await rsvp();
  await mark(entry, 'attended');
  const failing = {
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: (sql, values) =>
            sql.startsWith('INSERT INTO club_forms.audit')
              ? Promise.reject(Error('audit unavailable'))
              : tx.query(sql, values),
        }),
      ),
  };
  await assert.rejects(
    manageResponse(
      failing,
      { action: 'attendance', entryId: entry.id, value: 'did_not_attend' },
      actor,
    ),
    /audit unavailable/,
  );
  assert.equal(
    (await surveyResults(db, { entryId: entry.id })).responses[0].attendance,
    'attended',
  );
});

test('API wires participation filters and combined reports; admin and origin checks protect attendance before database access', async () => {
  process.env.AUTH_BASE_URL = 'https://office.example.edu';
  const entry = await rsvp();
  await survey();
  const response = () => ({
    setHeader() {},
    end(body) {
      this.body = body;
    },
  });
  const handler = surveysHandler({
    authorize: () => ({ email: actor }),
    getDatabase: () => db,
  });
  const res = response();
  await handler(
    {
      method: 'POST',
      url: '/api/surveys',
      headers: {
        origin: process.env.AUTH_BASE_URL,
        'content-type': 'application/json',
      },
      body: { action: 'attendance', entryId: entry.id, value: 'attended' },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  for (const suffix of ['', '&summary=1', '&export=csv']) {
    const r = response();
    await handler(
      { method: 'GET', url: '/api/surveys?feedback=submitted' + suffix },
      r,
    );
    assert.equal(r.statusCode, 200);
    if (suffix.includes('csv'))
      assert.equal(r.body.split('\r\n').filter(Boolean).length, 1);
    else assert.equal(JSON.parse(r.body).total, 0);
  }
  const feedbackSummary = response();
  await handler(
    { method: 'GET', url: '/api/surveys?summary=1&type=feedback' },
    feedbackSummary,
  );
  assert.equal(JSON.parse(feedbackSummary.body).total, 0);
  for (const suffix of ['', '&summary=1', '&export=csv']) {
    const r = response();
    await handler(
      {
        method: 'GET',
        url:
          '/api/surveys?attendance=did_not_attend&feedback=missing&type=all' +
          suffix,
        headers: { 'sec-fetch-site': 'same-origin' },
      },
      r,
    );
    assert.equal(r.statusCode, 200);
    if (suffix.includes('csv'))
      assert.equal(r.body.split('\r\n').filter(Boolean).length, 1);
    else assert.equal(JSON.parse(r.body).total, 0);
  }
  for (const [authorize, origin, expectedStatus] of [
    [() => ({ email: actor }), 'https://wrong.example.edu', 403],
    [
      () => {
        throw new RequestError(401, 'Sign in');
      },
      process.env.AUTH_BASE_URL,
      401,
    ],
  ]) {
    const guarded = surveysHandler({
      authorize,
      getDatabase: () => {
        throw Error('must not read database');
      },
    });
    const r = response();
    await guarded(
      {
        method: 'POST',
        url: '/api/surveys',
        headers: { origin },
        body: { action: 'attendance', entryId: entry.id, value: 'attended' },
      },
      r,
    );
    assert.equal(r.statusCode, expectedStatus);
  }
});

test('combined exports preserve same-origin and size protections before audit or CSV delivery', async () => {
  const handler = surveysHandler({
    authorize: () => ({ email: actor }),
    getDatabase: () => db,
  });
  for (const site of ['cross-site', 'same-site', '']) {
    const response = {
      setHeader() {},
      end(body) {
        this.body = body;
      },
    };
    await handler(
      {
        method: 'GET',
        url: '/api/surveys?export=csv&type=all',
        headers: { 'sec-fetch-site': site },
      },
      response,
    );
    assert.equal(response.statusCode, 403);
  }
  assert.equal(
    (await db.query('SELECT * FROM club_forms.audit')).rows.length,
    0,
  );
  const id = await survey(),
    member = await feedback(id);
  const manyQuestions = Array.from({ length: 30 }, () => ({
    id: randomUUID(),
    title: 'Written answer',
    type: 'text',
    options: [],
  }));
  await db.query(
    'UPDATE club_forms.custom_surveys SET definition=$2 WHERE id=$1',
    [id, JSON.stringify({ eventId: 'workshop', questions: manyQuestions })],
  );
  const responses = JSON.stringify(
    manyQuestions.map((q) => ({
      id: q.id,
      title: q.title,
      mode: 'form',
      text: 'x'.repeat(5000),
      value: 'x'.repeat(5000),
    })),
  );
  await db.query(
    'UPDATE club_forms.custom_survey_responses SET responses=$3 WHERE survey_id=$1 AND advisor_id=$2',
    [id, member, responses],
  );
  await db.query(
    `INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email)
    SELECT $1,n::text,'Member','person' || n || '@example.edu' FROM generate_series(1,29) n`,
    [id],
  );
  await db.query(
    `INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses)
    SELECT survey_id,advisor_id,1,$2::jsonb FROM club_forms.custom_survey_members WHERE survey_id=$1 AND advisor_id<>$3`,
    [id, responses, member],
  );
  const response = {
    setHeader() {},
    end(body) {
      this.body = body;
    },
  };
  await handler(
    {
      method: 'GET',
      url: '/api/surveys?export=csv&type=feedback',
      headers: { 'sec-fetch-site': 'same-origin' },
    },
    response,
  );
  assert.equal(response.statusCode, 413);
  assert.match(response.body, /4 MB/);
  assert.equal(
    (await db.query('SELECT * FROM club_forms.audit')).rows.length,
    0,
  );
});
