import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { draftContent, publicContent } from '../lib/event-content.mjs';
import { surveyResults, surveyQuestions } from '../lib/surveys.mjs';
import { saveEvent, liveEvents } from '../lib/events.mjs';
import { upcomingEvents, inboxFilter } from '../lib/inbox.mjs';
import { validate } from '../lib/validation.mjs';
import { submit } from '../lib/submissions.mjs';
import { surveysHandler } from '../api/surveys.mjs';
import { RequestError } from '../lib/errors.mjs';
const game = JSON.parse(
  await readFile(
    new URL('./fixtures/game-night.json', import.meta.url),
    'utf8',
  ),
);
const event = publicContent('game-night', game);
const body = (extra = {}) => ({
  kind: 'rsvp',
  name: 'Survey test',
  email: 'MKim23@Student.DallasCollege.edu',
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
  db = new PGlite();
  for (const f of [
    '003_club_forms.sql',
    '005_screen_confirmations.sql',
    '006_event_editor.sql',
    '007_office_tools.sql',
    '008_event_archive.sql',
    '009_submission_comments.sql',
    '010_event_surveys.sql',
  ])
    await db.exec(await readFile(new URL('../' + f, import.meta.url), 'utf8'));
});
beforeEach(() =>
  db.exec('TRUNCATE club_forms.entries,club_forms.events CASCADE'),
);
after(() => db.close());
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
    ' MKim23@Student.DallasCollege.edu ',
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
    assert.throws(() => validate(body({ email }), [event]), { status: 400 });
  assert.ok(
    validate(body({ email: 'member@gmail.com' }), [
      { ...event, requireEduEmail: false },
    ]),
  );
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
  assert.equal(stored.email, 'mkim23@student.dallascollege.edu');
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
  await assert.rejects(surveyResults(db, { entryId: 'bad' }), { status: 400 });
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
  await allowed({ method: 'POST', url: '/api/surveys' }, response);
  assert.equal(response.statusCode, 405);
});
