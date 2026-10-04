import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/custom-survey-fixture.mjs';
import { definition, canonicalResponse } from '../lib/survey-contract.mjs';
import {
  rememberDevice,
  submitSurvey,
  linkedSurvey,
  privateSurveyToken,
} from '../lib/custom-surveys.mjs';
import { changeDraft, FORM_VERSION } from '../lib/survey-builder.mjs';
import { customSurveysHandler } from '../api/custom-surveys.mjs';
let f, server, origin, cookie;
const rank = () => ({
  id: 'q-spark',
  kind: 'question',
  questionId: 'spark',
  mode: 'structured',
  text: '1. Build or review an AI prototype together',
  wordingReviewed: true,
  included: true,
  answer: { mode: 'rank', groups: [['build']] },
  customOptions: [],
});
const narrative = () => ({
  id: 'note-spark',
  kind: 'comment',
  pageId: 'spark',
  mode: 'narrative',
  text: 'Only this chosen wording.',
  wordingReviewed: true,
  included: true,
});
const submission = (
  responses = [rank(), narrative()],
  expectedRevision = 0,
) => ({
  format: 'advisor-studio-shared/9',
  contentVersion: definition.content_version,
  advisorId: 'pearlman',
  consent: { reviewed: true, audience: ['club_officers', 'bracewell'] },
  responses,
  requestId: randomUUID(),
  expectedRevision,
});
const request = (action, body, options = {}) =>
  fetch(
    origin +
      '/api/custom-surveys?' +
      new URLSearchParams({ action, ...(options.params || {}) }),
    {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Survey-Link': options.link ?? f.token,
        ...(options.cookie === null
          ? {}
          : { Cookie: options.cookie ?? cookie }),
        ...(body
          ? {
              'Content-Type': 'application/json',
              Origin: options.origin ?? origin,
            }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
before(async () => {
  f = await fixture();
  server = http.createServer(f.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
});
beforeEach(async () => {
  await f.db.exec(
    'TRUNCATE club_forms.custom_survey_responses,club_forms.custom_survey_receipts,club_forms.custom_survey_devices',
  );
  await f.db.query(
    "UPDATE club_forms.custom_surveys SET status='open',expires_at=now()+interval '30 days' WHERE id=$1",
    [f.id],
  );
  await f.db.query(
    'UPDATE club_forms.custom_survey_members SET user_id=NULL,active=true',
  );
  const result = await request(
    'verify-device',
    {},
    { cookie: 'test-neon=pearlman' },
  );
  assert.equal(result.status, 200);
  cookie = result.headers.getSetCookie()[0].split(';')[0];
});
after(async () => {
  await new Promise((r) => server.close(r));
  await f.db.close();
});
test('admin sample requires officer access and never opens the survey database', async () => {
  const handler = customSurveysHandler({
    authorize: f.authorize,
    getDatabase: () => assert.fail('The sample must not access survey data.'),
  });
  for (const [method, cookie, status] of [
    ['GET', '', 401],
    ['GET', 'test-neon=pearlman', 401],
    ['GET', 'test-officer=yes', 200],
    ['POST', 'test-officer=yes', 405],
  ]) {
    let body;
    const res = {
      setHeader() {},
      end(value) {
        body = JSON.parse(value);
      },
    };
    await handler(
      {
        method,
        url: '/api/custom-surveys?action=sample',
        headers: { cookie, origin },
      },
      res,
    );
    assert.equal(res.statusCode, status);
    if (status === 200) {
      assert.deepEqual(body.definition.questions, definition.questions);
      assert.deepEqual(
        body.definition.respondents.map((p) => p.name),
        ['Jordan Morgan', 'Alex Rivera'],
      );
      assert.equal(body.results, undefined);
      assert.ok(!JSON.stringify(body).includes('pearlman'));
    }
  }
});

test('private preview exposes questions only; answers and admin results still require authentication', async () => {
  let response = await request('preview', undefined, { cookie: null });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.definition.questions.length, 20);
  assert.equal(data.readOnly, true);
  assert.equal(data.results, undefined);
  assert.equal(JSON.stringify(data).includes('@example.com'), false);
  assert.equal(
    (await request('bootstrap', undefined, { cookie: null })).status,
    401,
  );
  assert.equal(
    (await request('catalog', undefined, { cookie: null })).status,
    401,
  );
  assert.equal(
    (
      await request('preview', undefined, {
        cookie: null,
        link: 'x'.repeat(43),
      })
    ).status,
    404,
  );
  await f.db.query(
    "UPDATE club_forms.custom_surveys SET expires_at=now()-interval '1 second'",
  );
  assert.equal((await request('preview')).status, 404);
  assert.equal((await request('bootstrap')).status, 404);
});
test('only the verified assigned advisor can establish a remembered device; no officer privileges are granted', async () => {
  assert.equal(
    (await request('verify-device', {}, { cookie: null })).status,
    401,
  );
  assert.equal((await request('catalog')).status, 401);
  await assert.rejects(
    rememberDevice(
      f.db,
      { id: f.id, expires_at: new Date(Date.now() + 10000) },
      { id: 'outsider', email: 'outside@example.com', emailVerified: true },
    ),
    (e) => e.status === 403,
  );
  await assert.rejects(
    rememberDevice(
      f.db,
      { id: f.id, expires_at: new Date(Date.now() + 10000) },
      { id: 'x', email: 'pearlman@example.com', emailVerified: false },
    ),
    (e) => e.status === 401,
  );
  await assert.rejects(
    rememberDevice(
      f.db,
      { id: f.id, expires_at: new Date(Date.now() + 10000) },
      {
        id: 'changed-identity',
        email: 'pearlman@example.com',
        emailVerified: true,
      },
    ),
    (e) => e.status === 403,
  );
  const response = await request(
    'verify-device',
    {},
    { cookie: 'test-neon=bracewell' },
  );
  assert.match(
    response.headers.getSetCookie()[0],
    /HttpOnly; SameSite=Strict; Max-Age=25919\d\d/,
  );
});
test('remembered survey access does not need a fresh Neon session; revocation, sign-out and cookie tampering deny access', async () => {
  assert.equal((await request('bootstrap')).status, 200);
  assert.equal(
    (await request('bootstrap', undefined, { cookie: cookie + 'x' })).status,
    401,
  );
  await f.db.query(
    "UPDATE club_forms.custom_survey_members SET active=false WHERE advisor_id='pearlman'",
  );
  assert.equal((await request('bootstrap')).status, 401);
  await f.db.query('UPDATE club_forms.custom_survey_members SET active=true');
  const response = await request('signout', {});
  assert.equal(response.status, 200);
  assert.match(response.headers.getSetCookie()[0], /Max-Age=0/);
  assert.equal((await request('bootstrap')).status, 401);
});
test('selected answers commit atomically with an idempotent receipt and are visible read-only to officers and the counterpart', async () => {
  const body = submission();
  let response = await request('submit', body);
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.receipt.revision, 1);
  response = await request('submit', body);
  assert.deepEqual(await response.json(), first);
  const results = await request('results', undefined, {
    cookie: 'test-officer=yes',
    params: { id: f.id },
  });
  assert.equal(results.status, 200);
  const data = await results.json();
  assert.equal(data.readOnly, true);
  assert.equal(data.results[0].responses.length, 2);
  const device = await request(
    'verify-device',
    {},
    { cookie: 'test-neon=bracewell' },
  );
  const otherCookie = device.headers.getSetCookie()[0].split(';')[0];
  const other = await request('bootstrap', undefined, { cookie: otherCookie });
  assert.equal(
    (await other.json()).results[0].responses.find((r) => r.id === 'note-spark')
      .text,
    'Only this chosen wording.',
  );
  assert.equal(
    (
      await request(
        'results',
        {},
        { cookie: 'test-officer=yes', params: { id: f.id } },
      )
    ).status,
    405,
  );
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS n FROM club_forms.entries'))
      .rows[0].n,
    0,
  );
  assert.equal(
    (
      await f.db.query(
        'SELECT count(*)::int AS n FROM club_forms.survey_responses',
      )
    ).rows[0].n,
    0,
  );
});
test('concurrent retries save once and competing replacements cannot lose an accepted revision', async () => {
  const first = submission();
  const retries = await Promise.all(
    Array.from({ length: 20 }, () => request('submit', first)),
  );
  for (const response of retries) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).receipt.id, first.requestId);
  }
  const replacements = Array.from({ length: 20 }, (_, i) =>
    submission([{ ...narrative(), text: 'Concurrent selection ' + i }], 1),
  );
  const results = await Promise.all(
    replacements.map((body) => request('submit', body)),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 19);
  const winner = replacements[results.findIndex((r) => r.status === 200)];
  const saved = (
    await f.db.query(
      'SELECT revision,responses FROM club_forms.custom_survey_responses',
    )
  ).rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].revision, 2);
  assert.equal(saved[0].responses[0].text, winner.responses[0].text);
  const receipts = (
    await f.db.query('SELECT id FROM club_forms.custom_survey_receipts')
  ).rows
    .map((r) => r.id)
    .sort();
  assert.deepEqual(receipts, [first.requestId, winner.requestId].sort());
});
test('replacement summaries remove omitted answers; stale revisions and altered retries cannot overwrite current results', async () => {
  const first = submission();
  assert.equal((await request('submit', first)).status, 200);
  assert.equal(
    (await request('submit', submission([narrative()]))).status,
    409,
  );
  assert.equal(
    (await request('submit', { ...first, responses: [narrative()] })).status,
    409,
  );
  assert.equal(
    (await request('submit', submission([narrative()], 1))).status,
    200,
  );
  const saved = (
    await f.db.query('SELECT * FROM club_forms.custom_survey_responses')
  ).rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].responses.length, 1);
  assert.equal(saved[0].revision, 2);
  const receiptRows = (
    await f.db.query('SELECT * FROM club_forms.custom_survey_receipts')
  ).rows;
  assert.equal(receiptRows.length, 2);
  assert.equal(JSON.stringify(receiptRows).includes('Build or review'), false);
  assert.equal((await request('submit', first)).status, 200);
  assert.equal(
    (
      await f.db.query(
        'SELECT revision FROM club_forms.custom_survey_responses',
      )
    ).rows[0].revision,
    2,
  );
});
test('advisor comparison receives only the current shared snapshot and excludes unapproved audiences', async () => {
  assert.equal((await request('submit', submission())).status, 200);
  const device = await request(
    'verify-device',
    {},
    { cookie: 'test-neon=bracewell' },
  );
  const otherCookie = device.headers.getSetCookie()[0].split(';')[0];
  const shared = async () =>
    (
      await (
        await request('bootstrap', undefined, { cookie: otherCookie })
      ).json()
    ).results.find((r) => r.advisor_id === 'pearlman');
  assert.deepEqual((await shared()).responses.map((r) => r.id).sort(), [
    'note-spark',
    'q-spark',
  ]);
  assert.equal(
    (await request('submit', submission([narrative()], 1))).status,
    200,
  );
  assert.deepEqual(
    (await shared()).responses.map((r) => r.id),
    ['note-spark'],
  );
  await f.db.query(
    "UPDATE club_forms.custom_survey_responses SET shared_with='{}' WHERE survey_id=$1 AND advisor_id='pearlman'",
    [f.id],
  );
  assert.equal((await shared()).responses, null);
  const own = await (await request('bootstrap')).json();
  assert.equal(
    own.results.find((r) => r.advisor_id === 'pearlman').responses.length,
    1,
  );
});

test('forged identity, consent, hidden original values and unexpected fields are rejected before persistence', async () => {
  const cases = [
    { ...submission(), state: { private: 'Never store' } },
    { ...submission(), advisorId: 'bracewell' },
    {
      ...submission(),
      consent: { reviewed: false, audience: ['club_officers', 'bracewell'] },
    },
    submission([{ ...narrative(), answer: { private: 'hidden' } }]),
    submission([{ ...rank(), text: 'Forged wording' }]),
    submission([{ ...rank(), included: false }]),
    submission([{ ...rank(), wordingReviewed: false }]),
    submission([
      {
        ...rank(),
        customOptions: [{ id: 'custom_hidden', label: 'Private hidden label' }],
      },
    ]),
    submission([null]),
    submission([rank(), rank()]),
  ];
  for (const body of cases)
    assert.equal((await request('submit', body)).status, 400);
  assert.equal(
    (
      await request('submit', submission(), {
        origin: 'https://outside.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.db.query(
        'SELECT count(*)::int AS n FROM club_forms.custom_survey_responses',
      )
    ).rows[0].n,
    0,
  );
});
test('structured validators cover numeric hours, ties, exclusive selections, per-resource conditions and per-concern dials', () => {
  const base = {
    wordingReviewed: true,
    included: true,
    mode: 'structured',
    customOptions: [],
  };
  assert.equal(
    canonicalResponse({
      ...base,
      id: 'q-weekly',
      kind: 'question',
      questionId: 'weekly',
      answer: { mode: 'range', min: 0, max: 0.5 },
      text: '0–0.5 hours per ordinary week, including routine meetings, preparation, messages, and review. Extra event time is discussed separately.',
    }).answer.min,
    0,
  );
  assert.throws(() =>
    canonicalResponse({
      ...base,
      id: 'q-weekly',
      kind: 'question',
      questionId: 'weekly',
      answer: { mode: 'range', min: null, max: 2 },
      text: 'Weekly hours: needs clarification.',
    }),
  );
  const concern = definition.questions.find((q) => q.id === 'concerns')
    .options[0].id;
  const focus = canonicalResponse({
    ...base,
    id: 'focus-' + concern,
    kind: 'concern',
    questionId: 'concern_focus',
    optionId: concern,
    answer: { mode: 'value', value: 50 },
    text: 'One of several focuses',
  });
  assert.equal(focus.answer.value, 50);
  assert.equal(focus.parentRank, undefined);
  const resource = definition.questions.find((q) => q.id === 'resources')
    .options[0].id;
  assert.equal(
    canonicalResponse({
      ...base,
      id: 'resource-' + resource,
      kind: 'resource',
      questionId: 'resources',
      optionId: resource,
      answer: { status: 'custom', text: 'Subject to permission.' },
      text: 'Subject to permission.',
    }).text,
    'Subject to permission.',
  );
  assert.throws(() =>
    canonicalResponse({
      ...base,
      id: 'q-event_role',
      kind: 'question',
      questionId: 'event_role',
      answer: { values: ['none', 'demo'] },
      text: 'Anything',
    }),
  );
  assert.throws(() =>
    canonicalResponse({
      ...rank(),
      answer: { mode: 'rank', groups: [['build'], ['build']] },
    }),
  );
});
test('failure while recording the receipt rolls back the response snapshot', async () => {
  const failing = {
    transaction: (fn) =>
      f.db.transaction((tx) =>
        fn({
          query: (sql, values) => {
            if (sql.startsWith('INSERT INTO club_forms.custom_survey_receipts'))
              throw Error('Synthetic receipt failure');
            return tx.query(sql, values);
          },
        }),
      ),
  };
  await assert.rejects(
    submitSurvey(failing, { headers: { cookie } }, f.token, submission()),
    /Synthetic/,
  );
  assert.equal(
    (
      await f.db.query(
        'SELECT count(*)::int AS n FROM club_forms.custom_survey_responses',
      )
    ).rows[0].n,
    0,
  );
});
test('officers can retrieve the expiring private link without being able to submit as advisors', async () => {
  const response = await request('catalog', undefined, {
    cookie: 'test-officer=yes',
  });
  const data = await response.json();
  assert.equal(
    data.surveys[0].privateLink,
    origin + '/surveys/#invite=' + f.token,
  );
  assert.equal(data.surveys[0].link_digest, undefined);
  assert.equal(
    (await request('submit', submission(), { cookie: 'test-officer=yes' }))
      .status,
    401,
  );
});

// Builder surveys below are created last, so the catalog test above still sees
// the Advisor Studio round first.
const textQuestion = (title) => ({
  id: randomUUID(),
  title,
  description: '',
  type: 'text',
  required: true,
  options: [],
});
async function publicSurvey(results, questions) {
  const id = randomUUID(),
    definition = {
      template: 'blank',
      title: 'Open feedback',
      intro: '',
      audience: 'public',
      permissions: { preview: 'link', answer: 'verified', results },
      durationDays: 30,
      questions,
    };
  for (const [expectedRevision, action] of [
    [0, 'save'],
    [1, 'publish'],
  ])
    await changeDraft(
      f.db,
      { email: 'officer@example.com' },
      { id, requestId: randomUUID(), expectedRevision, action, definition },
    );
  return { id, link: privateSurveyToken(id) };
}
test('catalog shows the actual publication timestamp and end date', async () => {
  const { id } = await publicSurvey('admins', [textQuestion('Feedback')]);
  const {
    rows: [saved],
  } = await f.db.query(
    'SELECT published_at,expires_at FROM club_forms.custom_surveys WHERE id=$1',
    [id],
  );
  const { surveys } = await (
    await request('catalog', undefined, { cookie: 'test-officer=yes' })
  ).json();
  const survey = surveys.find((item) => item.id === id);
  assert.equal(survey.published_at, saved.published_at.toISOString());
  assert.equal(survey.expires_at, saved.expires_at.toISOString());
});
test('officer results and CSV share search and active, archived, all scope across pages', async () => {
  const { id } = await publicSurvey('admins', [textQuestion('Feedback')]);
  for (let index = 0; index < 14; index++) {
    const name = index === 13 ? 'Other' : 'Matching ' + index;
    const advisorId = 'scope' + index;
    await f.db.query(
      'INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email,active) VALUES($1,$2,$3,$4,$5)',
      [id, advisorId, name, advisorId + '@example.com', index < 12],
    );
    await f.db.query(
      'INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,$2,1,$3)',
      [
        id,
        advisorId,
        JSON.stringify([{ id: 'q', title: 'Feedback', text: name }]),
      ],
    );
  }
  for (const [view, expected] of [
    ['active', 12],
    ['archived', 1],
    ['all', 13],
  ]) {
    const params = { id, view, search: '  MATCHING  ' };
    const options = { cookie: 'test-officer=yes', params };
    let page = await (await request('results', undefined, options)).json();
    let rows = [...page.results];
    while (page.nextOffset !== null) {
      page = await (
        await request('results', undefined, {
          ...options,
          params: { ...params, offset: String(page.nextOffset) },
        })
      ).json();
      rows.push(...page.results);
    }
    assert.equal(rows.length, expected, view);
    assert.ok(rows.every((row) => row.display_name.startsWith('Matching')));
    if (view !== 'all')
      assert.ok(rows.every((row) => row.active === (view === 'active')));
    const exported = await fetch(
      origin +
        '/api/custom-surveys?' +
        new URLSearchParams({ action: 'export', ...params }),
      {
        headers: {
          Cookie: 'test-officer=yes',
          'Sec-Fetch-Site': 'same-origin',
        },
      },
    );
    assert.equal(exported.status, 200);
    const csv = await exported.text();
    assert.equal(csv.trim().split('\r\n').length - 1, expected, view + ' CSV');
    assert.ok(!csv.includes('Other'));
  }
  const byEmail = await (
    await request('results', undefined, {
      cookie: 'test-officer=yes',
      params: { id, view: 'all', search: 'SCOPE13@EXAMPLE.COM' },
    })
  ).json();
  assert.equal(byEmail.results[0].display_name, 'Other');
  assert.equal(byEmail.results.length, 1);
  assert.equal(
    (
      await request('results', undefined, {
        cookie: 'test-officer=yes',
        params: { id, view: 'invalid' },
      })
    ).status,
    400,
  );
});
async function respondent(link, name) {
  const device = await request(
    'verify-device',
    {},
    { link, cookie: 'test-neon=' + name },
  );
  assert.equal(device.status, 200);
  return device.headers.getSetCookie()[0].split(';')[0];
}
async function answer(link, cookie, consent, answers, expectedRevision = 0) {
  const { advisorId } = await (
    await request('bootstrap', undefined, { link, cookie })
  ).json();
  return request(
    'submit',
    {
      requestId: randomUUID(),
      expectedRevision,
      contentVersion: FORM_VERSION,
      advisorId,
      consent,
      answers,
    },
    { link, cookie },
  );
}
test('respondents never see another respondent’s email address; officers still do', async () => {
  const question = textQuestion('Comments');
  const { id, link } = await publicSurvey('respondents', [question]);
  // Joined before the fix, when an email address could be stored as the name.
  await f.db.query(
    "INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email) VALUES($1,'legacy','legacy@example.com','legacy@example.com')",
    [id],
  );
  const legacy = await respondent(link, 'legacy'),
    newcomer = await respondent(link, 'newcomer');
  const names = async () =>
    (
      await f.db.query(
        'SELECT email,display_name FROM club_forms.custom_survey_members WHERE survey_id=$1 ORDER BY email',
        [id],
      )
    ).rows.map((r) => [r.email, r.display_name]);
  assert.deepEqual(await names(), [
    ['legacy@example.com', 'legacy@example.com'],
    ['newcomer@example.com', ''],
  ]);
  const survey = await linkedSurvey(f.db, link);
  const named = await rememberDevice(f.db, survey, {
    id: 'neon-named',
    email: 'named@example.com',
    name: '  Ana Lee  ',
    emailVerified: true,
  });
  assert.equal(named.member.display_name, 'Ana Lee');
  for (const [cookie, value] of [
    [legacy, 'Thanks'],
    [newcomer, 'Useful session'],
  ])
    assert.equal(
      (await answer(link, cookie, 'respondents', [{ id: question.id, value }]))
        .status,
      200,
    );
  const read = async (action, cookie) =>
    (await request(action, undefined, { link, cookie })).json();
  const bootstrap = await read('bootstrap', newcomer),
    shared = await read('shared-results', newcomer),
    other = await read('shared-results', legacy);
  for (const payload of [bootstrap, shared, other.results])
    assert.ok(!JSON.stringify(payload).includes('@'), JSON.stringify(payload));
  // Numbered by first submission, the same for every viewer.
  assert.deepEqual(
    shared.results.map((r) => r.display_name),
    ['Respondent 1'],
  );
  assert.ok(bootstrap.results.some((r) => r.display_name === 'Respondent 1'));
  assert.deepEqual(
    other.results.map((r) => r.display_name),
    ['Respondent 2'],
  );
  // An edit (which moves submitted_at) renumbers no one.
  assert.equal(
    (
      await answer(
        link,
        legacy,
        'respondents',
        [{ id: question.id, value: 'Thanks again' }],
        1,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (await read('shared-results', newcomer)).results.map((r) => [
      r.display_name,
      r.responses[0].text,
    ]),
    [['Respondent 1', 'Thanks again']],
  );
  assert.deepEqual(
    (await read('shared-results', legacy)).results.map((r) => r.display_name),
    ['Respondent 2'],
  );
  const officer = await (
    await request('results', undefined, {
      cookie: 'test-officer=yes',
      params: { id },
    })
  ).json();
  assert.deepEqual(
    officer.results.map((r) => [r.email, r.display_name]).sort(),
    [
      ['legacy@example.com', 'legacy@example.com'],
      ['newcomer@example.com', ''],
    ],
  );
});
test('the largest valid custom-form submission is accepted; a larger body gets a plain message', async () => {
  const questions = Array.from({ length: 30 }, (_, i) =>
    textQuestion('Question ' + (i + 1)),
  );
  const { link } = await publicSurvey('admins', questions);
  const cookie = await respondent(link, 'writer');
  // 5,000 characters per answer: quotes are escaped in JSON and each Hangul
  // syllable is 3 bytes, the most a valid character costs.
  const value = '"' + '한'.repeat(4998) + '"';
  const answers = questions.map((q) => ({ id: q.id, value }));
  const response = await answer(link, cookie, 'admins', answers);
  assert.equal(response.status, 200);
  const stored = (
    await f.db.query(
      "SELECT responses FROM club_forms.custom_survey_responses WHERE advisor_id IN (SELECT advisor_id FROM club_forms.custom_survey_members WHERE email='writer@example.com')",
    )
  ).rows[0].responses;
  assert.equal(stored.length, 30);
  assert.equal(stored[29].text, value);
  const tooLarge = await answer(link, cookie, 'admins', [
    ...answers,
    { id: randomUUID(), value: 'x'.repeat(60000) },
  ]);
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error, 'This submission is too large.');
});
