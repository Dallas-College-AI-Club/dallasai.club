import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { testDatabase } from './helpers/db.mjs';
import {
  defaultFeedbackQuestions,
  eventFeedbackState,
  readEventFeedback,
  submitEventFeedback,
  eventFeedbackResults,
} from '../lib/event-feedback.mjs';
import { draftContent, publicContent } from '../lib/event-content.mjs';
import { saveEvent } from '../lib/events.mjs';
import { eventFeedbackHandler } from '../api/event-feedback.mjs';
import { surveyVersion, surveyResults } from '../lib/surveys.mjs';
import { changeRsvpSurvey } from '../lib/survey-management.mjs';
import {
  reportRows,
  summarizeResponses,
  responsesCSV,
} from '../lib/survey-report.mjs';
import { RequestError } from '../lib/errors.mjs';

let db;
const actor = 'officer@example.edu';
const id = 'october-meeting';
const draft = {
  title: 'October meeting',
  date: '2026-10-15',
  startTime: '16:00',
  feedbackEnabled: true,
};
const event = publicContent(id, draft);
const start = Date.parse(event.date);
const end = start + 72 * 60 * 60 * 1000;
const now = () => start + 1;

before(async () => {
  db = await testDatabase();
});
after(() => db.close());
beforeEach(() =>
  db.exec(
    'TRUNCATE club_forms.event_feedback_responses,club_forms.events,club_forms.entries,club_forms.custom_surveys CASCADE',
  ),
);

const body = (email = 'anyone@gmail.com') => ({
  eventId: id,
  requestId: randomUUID(),
  surveyVersion: event.feedbackVersion,
  answers: event.feedbackQuestions.map((q, index) => ({
    questionId: q.id,
    value: [email, 'BAT', 'Third +', 'Cedar Valley', '__other__'][index],
    other: index === 4 ? 'Club website' : '',
  })),
});
const publish = (input = draft, revision = 0) =>
  saveEvent(
    db,
    {
      action: 'publish',
      id,
      revision,
      event: input,
    },
    actor,
    [],
  );

test('defaults match the five supplied questions and remain editable per event', async () => {
  const questions = defaultFeedbackQuestions();
  assert.deepEqual(
    questions.map((q) => [q.label, q.required]),
    [
      ['What is your school email address?', true],
      ['What is your major? (Enter N/A if faculty or staff)', true],
      ['What year are you in?', true],
      ['What campus do you primarily attend?', true],
      ['How did you hear about us?', false],
    ],
  );
  assert.deepEqual(questions[2].options, [
    'First Year (Freshman)',
    'Second Year (Sophomore)',
    'Third +',
    'No Degree Plan',
  ]);
  assert.deepEqual(questions[3].options, [
    'Richland',
    'El Centro',
    'Eastfield',
    'Cedar Valley',
    'North Lake',
    'Mountain View',
    'Brookhaven',
    'Online Only',
  ]);
  assert.deepEqual(questions[4].options, [
    'Flyer',
    'Professor',
    'Other student',
    'Social Media',
  ]);
  assert.equal(questions[4].allowOther, true);
  questions[0].label = 'Preferred email';
  questions[3].options.reverse();
  assert.equal(
    defaultFeedbackQuestions()[0].label,
    'What is your school email address?',
  );
  const saved = await publish({ ...draft, feedbackQuestions: questions });
  assert.equal(saved.published.feedbackQuestions[0].label, 'Preferred email');
  assert.notEqual(saved.published.feedbackVersion, event.feedbackVersion);
  assert.equal(
    draftContent({ ...draft, feedbackEnabled: false }).feedbackEnabled,
    false,
  );
  assert.throws(() => draftContent({ ...draft, feedbackEnabled: 'true' }), {
    status: 400,
  });
  assert.throws(() => draftContent({ ...draft, feedbackQuestions: [] }), {
    status: 400,
  });
});

test('opens at the exact event start and closes exactly 72 elapsed hours later, including DST', () => {
  assert.equal(eventFeedbackState(event, start - 1).status, 'upcoming');
  assert.equal(eventFeedbackState(event, start).status, 'open');
  assert.equal(eventFeedbackState(event, end - 1).status, 'open');
  assert.equal(eventFeedbackState(event, end).status, 'expired');
  assert.deepEqual(eventFeedbackState(event, start), {
    status: 'open',
    opensAt: new Date(start).toISOString(),
    closesAt: new Date(end).toISOString(),
  });
  const dst = { ...event, date: '2026-10-31T16:00:00-05:00' };
  assert.equal(eventFeedbackState(dst).closesAt, '2026-11-03T21:00:00.000Z');
  for (const unavailable of [
    { ...event, feedbackEnabled: false },
    { ...event, potential: true },
    { ...event, date: '2026-10-15' },
    { ...event, date: '' },
  ])
    assert.equal(eventFeedbackState(unavailable, start).status, 'unavailable');
  // Officers can prepare the questions before the meeting time is known.
  assert.equal(
    publicContent(id, { ...draft, startTime: '' }).feedbackEnabled,
    true,
  );
});

test('public answering accepts outside email without a login, RSVP, roster or approval', async () => {
  await publish();
  const input = body('OUTSIDE@GMAIL.COM');
  assert.deepEqual(await submitEventFeedback(db, input, [], now), {
    received: true,
  });
  const result = await eventFeedbackResults(db, { eventId: id });
  assert.equal(result.total, 1);
  assert.equal(result.responses[0].email, 'outside@gmail.com');
  assert.equal(result.responses[0].answers[4].other, 'Club website');
  for (const table of ['entries', 'custom_surveys', 'custom_survey_members'])
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM club_forms.' + table))
        .rows[0].n,
      0,
    );
});

test('server enforces start and expiry independently of the browser', async () => {
  await publish();
  await assert.rejects(
    submitEventFeedback(db, body(), [], () => start - 1),
    { status: 409 },
  );
  await submitEventFeedback(db, body(), [], () => start);
  await submitEventFeedback(db, body(), [], () => end - 1);
  await assert.rejects(
    submitEventFeedback(db, body(), [], () => end),
    { status: 409 },
  );
  assert.equal((await eventFeedbackResults(db, { eventId: id })).total, 2);
});

test('a published edit rejects stale questions and preserves old answer snapshots', async () => {
  await publish();
  const first = body();
  await submitEventFeedback(db, first, [], now);
  const questions = defaultFeedbackQuestions();
  questions[1].label = 'Your current major';
  await publish({ ...draft, feedbackQuestions: questions }, 1);
  await assert.rejects(submitEventFeedback(db, body(), [], now), {
    status: 409,
    message: /feedback questions changed/,
  });
  const current = await readEventFeedback(db, id, [], now());
  assert.equal(current.questions[1].label, 'Your current major');
  assert.notEqual(current.version, event.feedbackVersion);
  const second = { ...body(), surveyVersion: current.version };
  await submitEventFeedback(db, second, [], now);
  const results = await eventFeedbackResults(db, { eventId: id });
  assert.equal(
    results.responses.find((r) => r.id === first.requestId).questions[1].label,
    event.feedbackQuestions[1].label,
  );
  assert.equal(
    results.responses.find((r) => r.id === second.requestId).questions[1].label,
    'Your current major',
  );
  assert.equal(
    summarizeResponses(await reportRows(db, { eventId: id, type: 'feedback' }))
      .groups.length,
    2,
  );
});

test('retry is idempotent even after closure; a reused reference with changed answers conflicts', async () => {
  await publish();
  const input = body();
  await submitEventFeedback(db, input, [], now);
  await publish({ ...draft, feedbackEnabled: false }, 1);
  assert.deepEqual(await submitEventFeedback(db, input, [], () => end), {
    received: true,
  });
  await assert.rejects(
    submitEventFeedback(
      db,
      { ...input, answers: body('other@example.com').answers },
      [],
      now,
    ),
    { status: 409 },
  );
  assert.equal((await eventFeedbackResults(db, { eventId: id })).total, 1);
});

test('disabled, archived, unpublished and untimed events reject new submissions', async () => {
  for (const input of [
    { ...draft, feedbackEnabled: false },
    { ...draft, startTime: '' },
    { ...draft, potential: true },
  ]) {
    await db.exec('TRUNCATE club_forms.events CASCADE');
    await publish(input);
    await assert.rejects(submitEventFeedback(db, body(), [], now), {
      status: 409,
    });
  }
  for (const action of ['archive', 'unpublish']) {
    await db.exec('TRUNCATE club_forms.events CASCADE');
    await publish();
    await saveEvent(db, { action, id, revision: 1 }, actor, []);
    await assert.rejects(submitEventFeedback(db, body(), [event], now), {
      status: 404,
    });
    await assert.rejects(readEventFeedback(db, id, [event], now()), {
      status: 404,
    });
  }
});

test('legacy event feedback uses registry defaults and remains server timed', async () => {
  const legacy = { ...event };
  delete legacy.feedbackQuestions;
  const state = await readEventFeedback(db, id, [legacy], start);
  assert.equal(state.questions.length, 5);
  assert.equal(state.version, event.feedbackVersion);
  await submitEventFeedback(db, body(), [legacy], now);
  await assert.rejects(
    submitEventFeedback(db, body(), [legacy], () => end),
    { status: 409 },
  );
});

test('invalid, missing, duplicate and injected answers never save a response', async () => {
  await publish();
  for (const change of [
    (input) => {
      input.requestId = 'invalid';
    },
    (input) => {
      input.eventId = '../admin';
    },
    (input) => {
      input.answers.pop();
    },
    (input) => {
      input.answers[1] = input.answers[0];
    },
    (input) => {
      input.answers[0].value = 'not-an-email';
    },
    (input) => {
      input.answers[1].value = '';
    },
    (input) => {
      input.answers[3].value = 'Imaginary campus';
    },
    (input) => {
      input.answers[4].other = '';
    },
    (input) => {
      input.answers[4].value = 'Flyer';
    },
    (input) => {
      input.answers[1].value = '\u0000invalid';
    },
  ]) {
    const input = body();
    change(input);
    await assert.rejects(submitEventFeedback(db, input, [], now), {
      status: 400,
    });
  }
  assert.equal((await eventFeedbackResults(db, { eventId: id })).total, 0);
});

test('100 simultaneous attendees and 25 retry requests produce 100 saved snapshots', async () => {
  await publish();
  const inputs = Array.from({ length: 100 }, (_, index) =>
    body(`attendee${index}@example.com`),
  );
  const results = await Promise.all(
    [...inputs, ...inputs.slice(0, 25)].map((input) =>
      submitEventFeedback(db, input, [], now),
    ),
  );
  assert.equal(results.length, 125);
  const first = await eventFeedbackResults(db, { eventId: id });
  const second = await eventFeedbackResults(db, { eventId: id, offset: 50 });
  assert.equal(first.total, 100);
  assert.equal(first.responses.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(second.responses.length, 50);
  assert.equal(second.hasMore, false);
  assert.equal(
    new Set([...first.responses, ...second.responses].map((r) => r.id)).size,
    100,
  );
  assert.equal(
    (await reportRows(db, { eventId: id, type: 'feedback' })).length,
    100,
  );
});

test('feedback is attached to event reports, marks RSVP participation and survives RSVP deletion', async () => {
  await publish();
  const entryId = randomUUID();
  await db.query(
    `INSERT INTO club_forms.entries(id,kind,email,name,data,dedupe_key)
    VALUES($1::uuid,'rsvp','anyone@gmail.com','RSVP person',$2,$1::text)`,
    [entryId, JSON.stringify({ eventId: id, eventTitle: draft.title })],
  );
  await db.query(
    `INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,survey_version,questions,answers)
    VALUES($1,$2,$3,'','[]','[]')`,
    [entryId, id, draft.title],
  );
  assert.equal(
    (await surveyResults(db, { eventId: id })).responses[0].feedback_status,
    'missing',
  );
  await submitEventFeedback(db, body(), [], now);
  const registered = (await surveyResults(db, { eventId: id })).responses[0];
  assert.equal(registered.feedback_status, 'submitted');
  assert.equal(registered.feedback_survey_count, 1);
  assert.equal(registered.feedback_submitted_count, 1);
  assert.equal((await reportRows(db, { eventId: id, type: 'all' })).length, 2);
  const rows = await reportRows(db, {
    eventId: id,
    type: 'feedback',
    search: 'GMAIL',
    feedback: 'submitted',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].response_type, 'feedback');
  assert.equal(
    summarizeResponses(rows).groups[0].questions[3].choices.find(
      (c) => c.value === 'Cedar Valley',
    ).count,
    1,
  );
  assert.match(responsesCSV(rows), /Club website/);
  assert.equal(
    (await reportRows(db, { eventId: id, type: 'feedback', view: 'archived' }))
      .length,
    0,
  );
  await changeRsvpSurvey(
    db,
    {
      action: 'rsvp-survey-archive',
      eventId: id,
      expectedRevision: 1,
      requestId: randomUUID(),
    },
    actor,
    [],
  );
  await changeRsvpSurvey(
    db,
    {
      action: 'rsvp-survey-delete',
      eventId: id,
      expectedRevision: 2,
      requestId: randomUUID(),
    },
    actor,
    [],
  );
  assert.equal((await eventFeedbackResults(db, { eventId: id })).total, 1);
  assert.equal(
    (await reportRows(db, { eventId: id, type: 'feedback' })).length,
    1,
  );
});

test('public endpoint exposes no responses or authentication; administrative results require authorization', async () => {
  await publish();
  let authorizationCalls = 0;
  const handler = eventFeedbackHandler({
    getDatabase: () => db,
    originals: [],
    now,
    rateLimit: async () => {},
    authorize: async () => {
      authorizationCalls++;
      throw new RequestError(401, 'Sign in.');
    },
  });
  const call = async (method, query = '', input) => {
    const res = {
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(value) {
        this.body = value && JSON.parse(value);
      },
    };
    await handler(
      {
        method,
        url: '/api/event-feedback?eventId=' + id + query,
        headers: {
          origin: 'https://dallasai.club',
          'content-type': 'application/json',
        },
        body: input,
      },
      res,
    );
    return res;
  };
  const publicRead = await call('GET');
  assert.equal(publicRead.statusCode, 200);
  assert.equal(publicRead.body.status, 'open');
  assert.equal(publicRead.body.questions.length, 5);
  assert.equal(publicRead.body.responses, undefined);
  assert.equal(publicRead.headers['Access-Control-Allow-Origin'], '*');
  assert.equal((await call('POST', '', body())).statusCode, 200);
  assert.equal(authorizationCalls, 0);
  assert.equal((await call('GET', '&admin=1')).statusCode, 401);
  assert.equal(authorizationCalls, 1);
  assert.equal((await call('POST', '', { website: 'spam' })).statusCode, 200);
  assert.equal((await eventFeedbackResults(db, { eventId: id })).total, 1);
});

test('public endpoint rejects foreign origins and enforces its submission quota', async () => {
  await publish();
  const handler = eventFeedbackHandler({
    getDatabase: () => db,
    originals: [],
    now,
    rateLimit: async () => {
      throw new RequestError(429, 'Too many requests.');
    },
  });
  for (const [origin, status] of [
    ['https://foreign.example', 403],
    ['https://dallasai.club', 429],
  ]) {
    const res = { setHeader() {}, end() {} };
    await handler(
      {
        method: 'POST',
        url: '/api/event-feedback',
        headers: { origin, 'content-type': 'application/json' },
        body: body(),
      },
      res,
    );
    assert.equal(res.statusCode, status);
  }
  assert.equal((await eventFeedbackResults(db, { eventId: id })).total, 0);
});

test('officers can read retained event snapshots and invalid page or event filters are rejected', async () => {
  await publish();
  await submitEventFeedback(db, body(), [], now);
  await saveEvent(db, { action: 'archive', id, revision: 1 }, actor, []);
  const handler = eventFeedbackHandler({
    getDatabase: () => db,
    authorize: async () => ({ email: actor }),
    originals: [],
    now,
  });
  const res = {
    setHeader() {},
    end(value) {
      this.body = JSON.parse(value);
    },
  };
  await handler(
    {
      method: 'GET',
      url: '/api/event-feedback?admin=1&eventId=' + id,
      headers: {},
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.responses[0].questions.length, 5);
  assert.equal(
    (await reportRows(db, { eventId: id, type: 'feedback' })).length,
    0,
  );
  assert.equal(
    (await reportRows(db, { eventId: id, type: 'feedback', view: 'archived' }))
      .length,
    1,
  );
  for (const filter of [
    { eventId: '../admin' },
    { eventId: [id] },
    { eventId: id, offset: -1 },
    { eventId: id, offset: 0.5 },
    { eventId: id, offset: 100001 },
  ])
    await assert.rejects(eventFeedbackResults(db, filter), { status: 400 });
});

test('native feedback and existing authenticated survey responses coexist in event reports', async () => {
  await publish();
  await submitEventFeedback(db, body(), [], now);
  const surveyId = randomUUID(),
    questionId = randomUUID();
  const definition = {
    eventId: id,
    questions: [
      {
        id: questionId,
        title: 'Your thoughts',
        type: 'text',
        options: [],
        required: false,
      },
    ],
  };
  await db.query(
    `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at,definition)
    VALUES($1::uuid,$1::text,'Legacy feedback','custom-form/1','open',$1::text,now()+interval '1 day',$2)`,
    [surveyId, JSON.stringify(definition)],
  );
  await db.query(
    "INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email) VALUES($1,'member','Legacy member','legacy@example.edu')",
    [surveyId],
  );
  await db.query(
    `INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses)
    VALUES($1,'member',1,$2)`,
    [
      surveyId,
      JSON.stringify([
        {
          id: questionId,
          title: 'Your thoughts',
          text: 'A useful session',
          mode: 'form',
        },
      ]),
    ],
  );
  const all = await reportRows(db, { eventId: id, type: 'feedback' });
  assert.equal(all.length, 2);
  assert.equal(
    all.find((row) => row.survey_id === surveyId).answers[0].value,
    'A useful session',
  );
  assert.equal(all.find((row) => !row.survey_id).answers[1].value, 'BAT');
  assert.equal(
    (await reportRows(db, { eventId: id, type: 'feedback', surveyId })).length,
    1,
  );
});

test('migration is repeatable and the runtime can insert/read but cannot rewrite feedback evidence', async () => {
  await publish();
  await db.exec('CREATE ROLE club_forms_api');
  await db.exec('GRANT USAGE ON SCHEMA club_forms TO club_forms_api');
  await db.exec('GRANT SELECT,UPDATE ON club_forms.events TO club_forms_api');
  const sql = await readFile(
    new URL('../026_event_feedback.sql', import.meta.url),
    'utf8',
  );
  await db.exec(sql);
  await db.exec(sql);
  await db.exec('SET ROLE club_forms_api');
  try {
    await submitEventFeedback(db, body(), [], now);
    assert.equal((await eventFeedbackResults(db, { eventId: id })).total, 1);
    await assert.rejects(
      db.query(
        "UPDATE club_forms.event_feedback_responses SET email='changed@example.com'",
      ),
      { code: '42501' },
    );
    await assert.rejects(
      db.query('DELETE FROM club_forms.event_feedback_responses'),
      { code: '42501' },
    );
  } finally {
    await db.exec('RESET ROLE');
  }
  await db.exec(sql);
  assert.equal((await eventFeedbackResults(db, { eventId: id })).total, 1);
});
