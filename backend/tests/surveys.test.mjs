import { testDatabase } from './helpers/db.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { draftContent, publicContent } from '../lib/event-content.mjs';
import {
  surveyResults,
  surveyQuestions,
  surveyVersion,
  validateSurvey,
} from '../lib/surveys.mjs';
import { saveEvent, liveEvents } from '../lib/events.mjs';
import { upcomingEvents, inboxFilter } from '../lib/inbox.mjs';
import { validate } from '../lib/validation.mjs';
import { submit } from '../lib/submissions.mjs';
import { surveysHandler } from '../api/surveys.mjs';
import { RequestError } from '../lib/errors.mjs';
import {
  reportRows,
  summarizeResponses,
  responsesCSV,
} from '../lib/survey-report.mjs';
const game = JSON.parse(
  await readFile(
    new URL('./fixtures/game-night.json', import.meta.url),
    'utf8',
  ),
);
const event = publicContent('game-night', game);
test('RSVP exclusive None and custom choices reject mixed answers without changing old snapshots', () => {
  for (const [label, explicit] of [
    ['None of these', false],
    ['None of these times', false],
    ['Not sure yet', false],
    ['Any of the above', false],
    ['Not available', true],
  ]) {
    const q = {
      id: randomUUID(),
      label: 'Availability',
      type: 'multiple',
      required: true,
      allowOther: true,
      options: ['Tuesday', 'Thursday', label],
      ...(explicit ? { exclusiveOption: 2 } : {}),
    };
    const questions = surveyQuestions([q]);
    const event = { surveyQuestions: questions };
    const answer = (value) =>
      validateSurvey(
        {
          surveyVersion: surveyVersion(questions),
          answers: [{ questionId: q.id, value, other: '' }],
        },
        event,
      );
    assert.equal(answer([label]).answers[0].value[0], label);
    assert.throws(() => answer(['Tuesday', label]), { status: 400 });
    assert.equal(answer(['Tuesday', 'Thursday']).answers[0].value.length, 2);
    assert.throws(() => surveyQuestions([{ ...q, exclusiveOption: 9 }]), {
      status: 400,
    });
    assert.throws(
      () => surveyQuestions([{ ...q, type: 'single', exclusiveOption: 2 }]),
      { status: 400 },
    );
  }
  // An explicitly marked Any option does not switch off the familiar None and
  // Not sure rules used by the live availability question.
  const availability = {
    ...game.surveyQuestions.find((q) => q.label.startsWith('When could')),
  };
  availability.exclusiveOption = availability.options.indexOf('Any of these');
  const questions = surveyQuestions([availability]);
  for (const label of ['None of these times', 'Not sure yet'])
    assert.throws(
      () =>
        validateSurvey(
          {
            surveyVersion: surveyVersion(questions),
            answers: [
              {
                questionId: availability.id,
                value: [availability.options[0], label],
                other: '',
              },
            ],
          },
          { surveyQuestions: questions },
        ),
      { status: 400 },
    );
});
const body = (extra = {}) => ({
  kind: 'rsvp',
  name: 'Survey test',
  email: 'Member23@Student.DallasCollege.edu',
  consent: true,
  eventId: event.id,
  requestId: randomUUID(),
  surveyVersion: event.surveyVersion,
  answers: event.surveyQuestions.map((q) => ({
    questionId: q.id,
    value:
      q.type === 'text'
        ? 'Test answer'
        : q.type === 'multiple'
          ? [q.options[0], '__other__']
          : q.options[0],
    other: q.type === 'multiple' ? 'Another choice' : '',
  })),
  ...extra,
});
let db;
before(async () => {
  db = await testDatabase();
});
beforeEach(() =>
  db.exec('TRUNCATE club_forms.entries,club_forms.events CASCADE'),
);
after(() => db.close());
test('RSVP basic answer types validate, save, and retain zero and calendar values', async () => {
  const examples = [
    ['short', 'Brief answer', ['x'.repeat(301), []]],
    ['text', 'First line\nSecond line', ['x'.repeat(3001), {}]],
    [
      'date',
      '2028-02-29',
      ['2027-02-29', '2028-13-01', '0000-01-01', 20281023],
    ],
    ['number', 0, ['0', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}]],
    ['time', '18:30', ['24:00', '12:60', '6:30 PM', '18:30:00', 1830]],
    [
      'email',
      'advisor@example.edu',
      ['not-email', 'a@', 'a\nb@example.edu', 'x'.repeat(255) + '@example.edu'],
    ],
  ];
  const questions = surveyQuestions(
    examples.map(([type]) => ({
      id: randomUUID(),
      label: type,
      type,
      required: true,
      options: [],
      allowOther: false,
    })),
  );
  const typedEvent = publicContent('basic-types', {
    ...game,
    surveyQuestions: questions,
  });
  const request = body({
    eventId: typedEvent.id,
    surveyVersion: typedEvent.surveyVersion,
    answers: questions.map((q, i) => ({
      questionId: q.id,
      value: examples[i][1],
      other: '',
    })),
  });
  for (const [index, [, , invalid]] of examples.entries()) {
    for (const value of [...invalid, '']) {
      const answers = structuredClone(request.answers);
      answers[index].value = value;
      assert.throws(() => validateSurvey({ ...request, answers }, typedEvent), {
        status: 400,
      });
    }
    assert.throws(
      () =>
        surveyQuestions([
          { ...questions[index], options: ['Wrong', 'Options'] },
        ]),
      { status: 400 },
    );
    assert.throws(
      () => surveyQuestions([{ ...questions[index], allowOther: true }]),
      { status: 400 },
    );
  }
  const saved = await submit(db, request, [typedEvent]);
  const results = await surveyResults(db, { eventId: typedEvent.id });
  assert.equal(results.responses[0].entry_id, saved.id);
  assert.deepEqual(results.responses[0].answers, request.answers);
  assert.deepEqual(
    summarizeResponses(results.responses).groups[0].questions.map(
      (q) => q.written[0].value,
    ),
    examples.map((e) => e[1]),
  );
  const csv = responsesCSV(results.responses);
  for (const [, value] of examples)
    assert.ok(csv.includes(String(value).replaceAll('\n', ' ')), String(value));
  const optional = {
    ...typedEvent,
    surveyQuestions: questions.map((q) => ({ ...q, required: false })),
  };
  const blank = {
    surveyVersion: surveyVersion(optional.surveyQuestions),
    answers: questions.map((q) => ({ questionId: q.id, value: '', other: '' })),
  };
  assert.equal(
    validateSurvey(blank, optional).answers.length,
    questions.length,
  );
});

test('Game Night date-period choices survive concurrent retries and preserve historical answers', async () => {
  const historical = await submit(db, body(), [event]);
  const dates = [
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
    '2026-10-23',
    '2026-10-24',
    '2026-10-25',
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
  ];
  const revised = {
    ...game,
    surveyQuestions: game.surveyQuestions.flatMap((q) =>
      q.label.startsWith('When could')
        ? dates.map((date) => ({
            ...q,
            id: randomUUID(),
            label: 'Available periods',
            choiceDate: date,
            options: [
              'Morning',
              'Afternoon',
              'Evening',
              'Not available',
              'Not sure yet',
            ],
            allowOther: false,
            exclusiveOption: 3,
          }))
        : [q],
    ),
  };
  const available = revised.surveyQuestions[3];
  for (const choiceDate of [
    '2026-02-29',
    '0000-01-01',
    '10/16/2026',
    '',
    20261016,
  ])
    assert.throws(() => surveyQuestions([{ ...available, choiceDate }]), {
      status: 400,
    });
  assert.throws(
    () =>
      surveyQuestions([
        { ...available, type: 'text', options: [], exclusiveOption: undefined },
      ]),
    { status: 400 },
  );
  await saveEvent(
    db,
    { action: 'publish', id: event.id, revision: 0, event: revised },
    'officer@example.edu',
    [],
  );
  const live = await liveEvents(db, []);
  assert.deepEqual(
    live[0].surveyQuestions
      .filter((q) => q.choiceDate)
      .map((q) => q.choiceDate),
    dates,
  );
  const requests = Array.from({ length: 90 }, (_, i) =>
    body({
      email: `period-${i}@example.edu`,
      surveyVersion: live[0].surveyVersion,
      answers: live[0].surveyQuestions.map((q) => ({
        questionId: q.id,
        other: '',
        value: q.choiceDate
          ? [q.options[i % 5]]
          : q.type === 'multiple'
            ? [q.options[0]]
            : q.type === 'text'
              ? 'Test answer'
              : q.options[0],
      })),
    }),
  );
  const replies = await Promise.all(
    requests.flatMap((request) =>
      Array.from({ length: 3 }, () => submit(db, request, live)),
    ),
  );
  assert.equal(new Set(replies.map((r) => r.id)).size, 90);
  const rows = await reportRows(db, { eventId: event.id });
  assert.equal(rows.length, 91);
  assert.deepEqual(
    rows.find((r) => r.entry_id === historical.id).questions,
    event.surveyQuestions,
  );
  for (const request of requests) {
    const saved = rows.find((r) => r.email === request.email);
    assert.deepEqual(saved.answers, request.answers);
    assert.deepEqual(saved.questions, live[0].surveyQuestions);
  }
  const report = summarizeResponses(rows);
  assert.equal(report.groups.length, 2);
  for (const q of report.groups
    .find((g) => g.version === live[0].surveyVersion)
    .questions.filter((q) => q.choiceDate))
    assert.deepEqual(
      q.choices.map((c) => c.count),
      [18, 18, 18, 18, 18],
    );
  const csv = responsesCSV(rows);
  for (const date of dates)
    assert.ok(csv.includes(date + ' · Available periods — Morning'));
  const invalid = structuredClone(requests[0]);
  invalid.answers[3].value = ['Morning', 'Not available'];
  await assert.rejects(() => submit(db, invalid, live), { status: 400 });
});

test('potential events publish with TBD while scheduled events require dates; Social defaults to edu with an explicit override', () => {
  assert.equal(event.date, '');
  assert.equal(event.requireEduEmail, true);
  assert.equal(
    publicContent('social', { ...game, requireEduEmail: undefined })
      .requireEduEmail,
    true,
  );
  assert.equal(
    publicContent('open', { ...game, requireEduEmail: false }).requireEduEmail,
    false,
  );
  assert.equal(
    publicContent('workshop', {
      ...game,
      category: 'Workshop',
      requireEduEmail: undefined,
    }).requireEduEmail,
    false,
  );
  assert.throws(() =>
    publicContent('scheduled', { ...game, potential: false }),
  );
  assert.equal(
    publicContent('scheduled', {
      ...game,
      potential: false,
      date: '2099-10-02',
    }).date,
    '2099-10-02',
  );
  for (const key of ['potential', 'requireEduEmail'])
    assert.throws(() => draftContent({ ...game, [key]: 'false' }));
  assert.deepEqual(
    upcomingEvents([
      event,
      { id: 'past', date: '2020-01-01' },
      { id: 'invalid', date: '' },
    ]).map((e) => e.id),
    [event.id],
  );
});
test('per-event edu policy accepts college subdomains and alumni, and rejects lookalikes server-side', () => {
  for (const email of [
    'member@dallascollege.edu',
    'member@dcccd.edu',
    'member@student.dcccd.edu',
    'member@alumni.utexas.edu',
    ' Member23@Student.DallasCollege.edu ',
  ])
    assert.ok(validate(body({ email }), [event]));
  for (const email of [
    'member@gmail.com',
    'member@dallascollege.edu.evil.com',
    'member@notedu',
    'member@edu',
    'member@.edu',
    'member@bad..edu',
    'member@-bad.edu',
    'member@bad-.edu',
    'member@bad_.edu',
    'member@bad/host.edu',
  ])
    assert.throws(() => validate(body({ email }), [event]), {
      status: 400,
    });
  assert.ok(
    validate(body({ email: 'member@gmail.com' }), [
      { ...event, requireEduEmail: false },
    ]),
  );
});
test('Any of these is exclusive, including Other; ordinary multiple selections remain valid', () => {
  const indices = event.surveyQuestions.flatMap((q, index) =>
    q.options.includes('Any of these') ? [index] : [],
  );
  assert.equal(indices.length, 2);
  for (const index of indices) {
    const q = event.surveyQuestions[index];
    const answer = (value, other = '') => {
      const b = body();
      b.answers[index] = { questionId: q.id, value, other };
      return b;
    };
    assert.ok(validate(answer(['Any of these']), [event]));
    assert.ok(validate(answer([q.options[0], q.options[1]]), [event]));
    assert.throws(
      () => validate(answer(['Any of these', q.options[0]]), [event]),
      { status: 400 },
    );
    assert.throws(
      () =>
        validate(answer(['Any of these', '__other__'], 'Another game'), [
          event,
        ]),
      { status: 400 },
    );
  }
});

test('survey validation rejects stale schemas, missing and forged answers without accepting unknown options', () => {
  assert.throws(() => validate(body({ surveyVersion: 'outdated' }), [event]), {
    status: 409,
  });
  const mutations = [
    (b) => b.answers.pop(),
    (b) => (b.answers[0].questionId = randomUUID()),
    (b) => (b.answers[1].questionId = b.answers[0].questionId),
    (b) => (b.answers[1].value = 'Forged option'),
    (b) => (b.answers[1].value = ''),
    (b) => (b.answers[3].value = []),
    (b) => (b.answers[3].other = ''),
    (b) => (b.answers[0].value = 'x'.repeat(3001)),
  ];
  for (const mutation of mutations) {
    const b = body();
    mutation(b);
    assert.throws(() => validate(b, [event]), { status: 400 });
  }
  assert.throws(() => validate(body(), [{ ...event, surveyQuestions: [] }]), {
    status: 409,
  });
  assert.throws(
    () => surveyQuestions([game.surveyQuestions[0], game.surveyQuestions[0]]),
    { status: 400 },
  );
  assert.throws(
    () =>
      surveyQuestions([
        { ...game.surveyQuestions[1], options: ['__other__', 'A'] },
      ]),
    { status: 400 },
  );
});

test('None and Not sure cannot accompany dates, each other, or Other', () => {
  const index = event.surveyQuestions.findIndex((q) =>
    q.options.includes('None of these times'),
  );
  const q = event.surveyQuestions[index];
  for (const exclusive of ['None of these times', 'Not sure yet']) {
    const request = body();
    request.answers[index] = {
      questionId: q.id,
      value: [exclusive],
      other: '',
    };
    assert.ok(validate(request, [event]));
    for (const other of [
      q.options[0],
      'None of these times',
      'Not sure yet',
      '__other__',
    ]) {
      if (other === exclusive) continue;
      request.answers[index] = {
        questionId: q.id,
        value: [exclusive, other],
        other: other === '__other__' ? 'Another time' : '',
      };
      assert.throws(() => validate(request, [event]), { status: 400 });
    }
  }
});
test('RSVP and all answers commit together, retries preserve the original and snapshots survive event edits and archiving', async () => {
  await saveEvent(
    db,
    { action: 'publish', id: event.id, revision: 0, event: game },
    'officer@example.edu',
    [],
  );
  const first = await submit(db, body(), await liveEvents(db, []));
  const retry = body();
  retry.answers[0].value = 'Must not overwrite original';
  const again = await submit(db, retry, await liveEvents(db, []));
  assert.equal(again.id, first.id);
  assert.equal(again.alreadySubmitted, true);
  const results = await surveyResults(db);
  assert.equal(results.responses.length, 1);
  const stored = results.responses[0];
  assert.equal(stored.email, 'member23@student.dallascollege.edu');
  assert.equal(stored.name, 'Survey test');
  assert.equal(stored.event_date, '');
  assert.deepEqual(stored.questions, event.surveyQuestions);
  assert.deepEqual(stored.answers, body().answers);
  assert.equal(first.data.hasSurvey, true);
  assert.equal(first.data.answers, undefined);
  const filter = inboxFilter(
    new URLSearchParams('kind=rsvp'),
    upcomingEvents(await liveEvents(db, [])),
  );
  assert.equal(
    (
      await db.query(
        'SELECT * FROM club_forms.entries e ' + filter.where,
        filter.values,
      )
    ).rows.length,
    1,
  );
  const changed = structuredClone(game);
  changed.surveyQuestions[0].label = 'Revised question';
  changed.date = '2099-10-02';
  changed.potential = false;
  await saveEvent(
    db,
    { action: 'publish', id: event.id, revision: 1, event: changed },
    'officer@example.edu',
    [],
  );
  assert.deepEqual(
    (await surveyResults(db)).responses[0].questions,
    event.surveyQuestions,
  );
  await saveEvent(
    db,
    { action: 'archive', id: event.id, revision: 2 },
    'officer@example.edu',
    [],
  );
  assert.equal((await liveEvents(db, [])).length, 0);
  assert.equal((await surveyResults(db)).responses.length, 1);
  await assert.rejects(submit(db, body(), await liveEvents(db, [])), {
    status: 400,
  });
});
test('a survey write failure rolls back the basic RSVP and leaves no orphaned answers', async () => {
  const broken = {
    query: db.query.bind(db),
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: (sql, values) =>
            sql.includes('INSERT INTO club_forms.survey_responses')
              ? Promise.reject(Error('test write failure'))
              : tx.query(sql, values),
        }),
      ),
  };
  await assert.rejects(submit(broken, body(), [event]), /test write failure/);
  assert.equal(
    (await db.query('SELECT * FROM club_forms.entries')).rows.length,
    0,
  );
  assert.equal((await surveyResults(db)).responses.length, 0);
});
test('survey pagination, event and entry filters are independent, and unauthorized requests never read data', async () => {
  for (let n = 0; n < 52; n++)
    await submit(db, body({ email: 'test' + n + '@example.edu' }), [event]);
  const first = await surveyResults(db);
  assert.equal(first.responses.length, 50);
  assert.equal(first.hasMore, true);
  const last = await surveyResults(db, { offset: 50 });
  assert.equal(last.responses.length, 2);
  assert.equal(last.hasMore, false);
  assert.equal(
    new Set([...first.responses, ...last.responses].map((x) => x.entry_id))
      .size,
    52,
  );
  assert.equal(
    (await surveyResults(db, { eventId: 'other' })).responses.length,
    0,
  );
  assert.equal(
    (await surveyResults(db, { entryId: first.responses[0].entry_id }))
      .responses.length,
    1,
  );
  await assert.rejects(surveyResults(db, { entryId: 'bad' }), {
    status: 400,
  });
  for (const offset of [-1, 0.5, 100001, NaN])
    await assert.rejects(surveyResults(db, { offset }), { status: 400 });
  let queried = false;
  const handler = surveysHandler({
    authorize: () => {
      throw new RequestError(401, 'Sign in');
    },
    getDatabase: () => {
      queried = true;
      return db;
    },
  });
  const response = {
    setHeader() {},
    end(value) {
      this.body = JSON.parse(value);
    },
  };
  await handler({ method: 'GET', url: '/api/surveys' }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(queried, false);
  const allowed = surveysHandler({
    authorize: () => ({ email: 'officer@example.edu' }),
    getDatabase: () => db,
  });
  await allowed(
    { method: 'GET', url: '/api/surveys?eventId=game-night' },
    response,
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.responses.length, 50);
  await allowed({ method: 'DELETE', url: '/api/surveys' }, response);
  assert.equal(response.statusCode, 405);
});
