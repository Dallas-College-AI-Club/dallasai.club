import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { fixture } from './helpers/custom-survey-fixture.mjs';
import {
  changeDraft,
  getDraft,
  previewToken,
  validateDefinition,
  validateFormResponse,
  FORM_VERSION,
} from '../lib/survey-builder.mjs';
import { changeRespondent } from '../lib/survey-respondents.mjs';
import {
  privateSurveyToken,
  linkedSurvey,
  linkedPreview,
  rememberDevice,
  requireDevice,
  deviceCookie,
  submitSurvey,
  currentResponses,
} from '../lib/custom-surveys.mjs';
const actor = { email: 'officer@example.com' };
const draft = () => ({
  template: 'feedback',
  title: 'Feedback survey',
  intro: 'Tell us what you think.',
  audience: 'advisors',
  permissions: { preview: 'link', answer: 'invited', results: 'admins' },
  durationDays: 30,
  questions: [
    {
      id: randomUUID(),
      title: 'Your rating',
      description: '',
      type: 'scale',
      required: true,
      options: [],
    },
    {
      id: randomUUID(),
      title: 'Your comments',
      description: '',
      type: 'text',
      required: false,
      options: [],
    },
  ],
});
const action = (id, definition, expectedRevision = 0, action = 'save') => ({
  id,
  definition,
  expectedRevision,
  action,
  requestId: randomUUID(),
});
async function create(f, definition = draft()) {
  const id = randomUUID();
  await changeDraft(f.db, actor, action(id, definition));
  return { id, definition };
}
async function add(
  f,
  id,
  email = 'pearlman@example.com',
  expectedRevision = 0,
) {
  await changeRespondent(f.db, actor, {
    surveyId: id,
    action: 'add',
    name: email.split('@')[0],
    email,
    expectedRevision,
    requestId: randomUUID(),
  });
}
test('drafts save idempotently; publishing starts expiry, freezes definitions, and closing retains answers', async () => {
  const f = await fixture();
  process.env.AUTH_BASE_URL = 'https://club.example';
  try {
    const d = draft(),
      id = randomUUID(),
      body = action(id, d);
    assert.deepEqual(
      await changeDraft(f.db, actor, body),
      await changeDraft(f.db, actor, body),
    );
    const saved = await getDraft(f.db, id);
    assert.equal(saved.activity.length, 1);
    assert.equal(saved.privateLink, null);
    assert.ok(saved.previewLink.includes('#preview='));
    assert.equal((await linkedPreview(f.db, previewToken(id))).status, 'draft');
    await assert.rejects(() => linkedSurvey(f.db, privateSurveyToken(id)), {
      status: 404,
    });
    await assert.rejects(
      () => changeDraft(f.db, actor, action(id, d, 1, 'publish')),
      { status: 400 },
    );
    await add(f, id);
    const publish = action(id, d, 1, 'publish');
    assert.deepEqual(
      await changeDraft(f.db, actor, publish),
      await changeDraft(f.db, actor, publish),
    );
    const opened = await getDraft(f.db, id);
    assert.equal(opened.status, 'open');
    assert.ok(opened.privateLink);
    assert.equal(
      new Date(opened.expires_at) - new Date(opened.published_at),
      30 * 86400000,
    );
    await assert.rejects(
      () => changeDraft(f.db, actor, action(id, { ...d, title: 'Changed' }, 2)),
      { status: 409 },
    );
    await changeDraft(f.db, actor, action(id, d, 2, 'close'));
    await assert.rejects(() => linkedSurvey(f.db, privateSurveyToken(id)), {
      status: 404,
    });
    await assert.rejects(() => linkedPreview(f.db, previewToken(id)), {
      status: 404,
    });
    assert.equal((await getDraft(f.db, id)).activity.length, 3);
  } finally {
    await f.db.close();
  }
});
test('invalid policies, questions, stale versions and forged answers cannot publish or save responses', () => {
  const d = draft();
  assert.throws(
    () =>
      validateDefinition({
        ...d,
        audience: 'staff',
        permissions: { ...d.permissions, answer: 'verified' },
      }),
    { status: 400 },
  );
  assert.throws(() => validateDefinition({ ...d, questions: [] }, true), {
    status: 400,
  });
  assert.throws(
    () =>
      validateDefinition(
        {
          ...d,
          questions: [
            { ...d.questions[0], type: 'single', options: ['a', 'A'] },
          ],
        },
        true,
      ),
    { status: 400 },
  );
  assert.throws(() => validateDefinition({ ...d, durationDays: 0 }), {
    status: 400,
  });
  const member = { advisor_id: 'member' },
    survey = { definition: d };
  const body = {
    requestId: randomUUID(),
    expectedRevision: 0,
    contentVersion: FORM_VERSION,
    advisorId: 'member',
    consent: 'admins',
    answers: [{ id: d.questions[0].id, value: 4 }],
  };
  assert.equal(validateFormResponse(body, survey, member)[0].text, '4 / 5');
  for (const patch of [
    { advisorId: 'other' },
    { consent: 'respondents' },
    { answers: [] },
    { answers: [{ id: d.questions[0].id, value: 9 }] },
    { answers: [{ id: randomUUID(), value: 'forged' }] },
    { contentVersion: 'old' },
    { extra: 'hidden' },
  ])
    assert.throws(
      () => validateFormResponse({ ...body, ...patch }, survey, member),
      { status: 400 },
    );
  const choices = {
    ...d,
    questions: [
      { ...d.questions[0], type: 'multiple', options: ['One', 'Two'] },
    ],
  };
  assert.throws(
    () =>
      validateFormResponse(
        { ...body, answers: [{ id: d.questions[0].id, value: [0, 0] }] },
        { definition: choices },
        member,
      ),
    { status: 400 },
  );
});
test('public email verification enrolls once, removed emails cannot rejoin, and device revocation takes effect', async () => {
  const f = await fixture();
  try {
    const d = draft();
    d.audience = 'public';
    d.permissions.answer = 'verified';
    const { id } = await create(f, d);
    await changeDraft(f.db, actor, action(id, d, 1, 'publish'));
    const survey = await linkedSurvey(f.db, privateSurveyToken(id)),
      user = {
        id: 'new-user',
        email: 'new@example.com',
        name: 'New person',
        emailVerified: true,
      };
    const device = await rememberDevice(f.db, survey, user),
      again = await rememberDevice(f.db, survey, user);
    assert.equal(device.member.advisor_id, again.member.advisor_id);
    const req = {
      headers: { cookie: deviceCookie(survey) + '=' + device.token },
    };
    assert.equal((await requireDevice(f.db, req, survey)).email, user.email);
    assert.equal(
      (
        await f.db.query(
          'SELECT count(*)::int n FROM club_forms.custom_survey_activity WHERE survey_id=$1',
          [id],
        )
      ).rows[0].n,
      1,
    );
    await changeRespondent(f.db, actor, {
      surveyId: id,
      action: 'remove',
      advisorId: device.member.advisor_id,
      expectedRevision: 1,
      requestId: randomUUID(),
    });
    await assert.rejects(() => requireDevice(f.db, req, survey), {
      status: 401,
    });
    await assert.rejects(() => rememberDevice(f.db, survey, user), {
      status: 403,
    });
  } finally {
    await f.db.close();
  }
});
test('form answers use canonical text, atomic replacement receipts and separate results permissions', async () => {
  const f = await fixture();
  try {
    const { id, definition: d } = await create(f);
    await add(f, id);
    await add(f, id, 'bracewell@example.com', 1);
    await changeDraft(f.db, actor, action(id, d, 1, 'publish'));
    const survey = await linkedSurvey(f.db, privateSurveyToken(id)),
      device = await rememberDevice(f.db, survey, {
        id: 'pearlman',
        email: 'pearlman@example.com',
        emailVerified: true,
      });
    const req = {
        headers: { cookie: deviceCookie(survey) + '=' + device.token },
      },
      member = device.member;
    const body = {
      requestId: randomUUID(),
      expectedRevision: 0,
      contentVersion: FORM_VERSION,
      advisorId: member.advisor_id,
      consent: 'admins',
      answers: [
        { id: d.questions[0].id, value: 5 },
        { id: d.questions[1].id, value: 'First comment' },
      ],
    };
    const first = await submitSurvey(f.db, req, privateSurveyToken(id), body);
    assert.deepEqual(
      await submitSurvey(f.db, req, privateSurveyToken(id), body),
      first,
    );
    let row = (await currentResponses(f.db, id)).find(
      (r) => r.advisor_id === member.advisor_id,
    );
    assert.equal(row.responses[0].text, '5 / 5');
    const other = (
      await f.db.query(
        'SELECT advisor_id FROM club_forms.custom_survey_members WHERE survey_id=$1 AND email=$2',
        [id, 'bracewell@example.com'],
      )
    ).rows[0].advisor_id;
    assert.equal(
      (await currentResponses(f.db, id, other)).find(
        (r) => r.advisor_id === member.advisor_id,
      ).responses,
      null,
    );
    await submitSurvey(f.db, req, privateSurveyToken(id), {
      ...body,
      requestId: randomUUID(),
      expectedRevision: 1,
      answers: [body.answers[0]],
    });
    row = (await currentResponses(f.db, id)).find(
      (r) => r.advisor_id === member.advisor_id,
    );
    assert.equal(row.responses.length, 1);
    assert.equal(row.revision, 2);
    await assert.rejects(
      () =>
        submitSurvey(f.db, req, privateSurveyToken(id), {
          ...body,
          requestId: randomUUID(),
        }),
      { status: 409 },
    );
  } finally {
    await f.db.close();
  }
});
test('an exclusive choice publishes and must be chosen by itself; surveys without one are unchanged', async () => {
  const d = draft();
  assert.deepEqual(Object.keys(validateDefinition(d).questions[0]), [
    'id',
    'title',
    'description',
    'type',
    'required',
    'options',
  ]);
  const times = {
    id: randomUUID(),
    title: 'Which times work?',
    description: '',
    type: 'multiple',
    required: true,
    options: ['Friday', 'Saturday', 'None of these'],
  };
  for (const question of [
    ...[3, -1, 1.5, '2', null].map((x) => ({ ...times, exclusiveOption: x })),
    { ...times, type: 'single', exclusiveOption: 2 },
  ])
    assert.throws(
      () => validateDefinition({ ...d, questions: [question] }, true),
      { status: 400 },
    );
  d.questions.push({ ...times, exclusiveOption: 2 });
  const f = await fixture();
  try {
    const { id } = await create(f, d);
    await add(f, id);
    // Publishing compares the stored jsonb with the request, so the mark
    // must survive the round trip.
    await changeDraft(f.db, actor, action(id, d, 1, 'publish'));
    const survey = await linkedSurvey(f.db, privateSurveyToken(id)),
      plain = structuredClone(survey);
    delete plain.definition.questions[2].exclusiveOption;
    assert.equal(survey.definition.questions[2].exclusiveOption, 2);
    const answer = (value, s = survey) =>
      validateFormResponse(
        {
          requestId: randomUUID(),
          expectedRevision: 0,
          contentVersion: FORM_VERSION,
          advisorId: 'member',
          consent: 'admins',
          answers: [
            { id: d.questions[0].id, value: 4 },
            { id: times.id, value },
          ],
        },
        s,
        { advisor_id: 'member' },
      )[1].text;
    assert.equal(answer([2]), 'None of these');
    assert.equal(answer([0, 1]), 'Friday\nSaturday');
    for (const value of [
      [0, 2],
      [2, 1],
    ])
      assert.throws(() => answer(value), {
        status: 400,
        message: 'Choose “None of these” by itself for: Which times work?',
      });
    assert.equal(answer([0, 2], plain), 'Friday\nNone of these');
  } finally {
    await f.db.close();
  }
});
test('HTTP preview capability cannot answer or read results; restricted preview and builder endpoints require authorization', async () => {
  const f = await fixture(),
    server = http.createServer(f.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
  try {
    const { id, definition: d } = await create(f);
    const call = async (action, headers = {}, body) =>
      fetch(origin + '/api/custom-surveys?action=' + action, {
        headers: {
          Origin: origin,
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      });
    const preview = {
      'X-Survey-Link': previewToken(id),
      'X-Survey-Preview': '1',
    };
    assert.equal((await call('preview', preview)).status, 200);
    assert.equal((await call('submit', preview, {})).status, 403);
    assert.equal((await call('bootstrap', preview)).status, 403);
    assert.equal((await call('results&id=' + id, preview)).status, 401);
    assert.equal((await call('draft&id=' + id)).status, 401);
    assert.equal(
      (await call('draft-change', {}, action(id, d, 1))).status,
      401,
    );
    d.permissions.preview = 'respondents';
    await changeDraft(f.db, actor, action(id, d, 1));
    assert.equal((await call('preview', preview)).status, 401);
    await add(f, id);
    const survey = await linkedPreview(f.db, previewToken(id)),
      device = await rememberDevice(f.db, survey, {
        id: 'pearlman',
        email: 'pearlman@example.com',
        emailVerified: true,
      });
    const cookie = deviceCookie(survey) + '=' + device.token;
    assert.equal(
      (await call('preview', { ...preview, Cookie: cookie })).status,
      200,
    );
    assert.equal(
      (await call('submit', { ...preview, Cookie: cookie }, {})).status,
      403,
    );
    await changeDraft(f.db, actor, action(id, d, 2, 'publish'));
    const answering = {
      'X-Survey-Link': privateSurveyToken(id),
      Cookie: cookie,
    };
    const bootstrap = await (await call('bootstrap', answering)).json();
    assert.equal(bootstrap.results.length, 1);
    assert.equal(bootstrap.results[0].advisor_id, device.member.advisor_id);
  } finally {
    await new Promise((r) => server.close(r));
    await f.db.close();
  }
});
test('draft changes reject stale editors and audit failure rolls back creation', async () => {
  const f = await fixture();
  try {
    const { id, definition } = await create(f);
    await assert.rejects(
      () => changeDraft(f.db, actor, action(id, definition, 0)),
      { status: 409 },
    );
    const newid = randomUUID(),
      broken = {
        transaction: (fn) =>
          f.db.transaction((tx) =>
            fn({
              query: (sql, args) =>
                sql.startsWith('INSERT INTO club_forms.custom_survey_changes')
                  ? Promise.reject(new Error('audit failed'))
                  : tx.query(sql, args),
            }),
          ),
      };
    await assert.rejects(
      () => changeDraft(broken, actor, action(newid, draft())),
      /audit failed/,
    );
    assert.equal(
      (
        await f.db.query(
          'SELECT id FROM club_forms.custom_surveys WHERE id=$1',
          [newid],
        )
      ).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});

test('Inbox archive shows only removed respondents with submitted answers and requires admin access', async () => {
  const f = await fixture(),
    server = http.createServer(f.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
  try {
    const { id, definition: d } = await create(f);
    await add(f, id);
    await add(f, id, 'bracewell@example.com', 1);
    await changeDraft(f.db, actor, action(id, d, 1, 'publish'));
    const survey = await linkedSurvey(f.db, privateSurveyToken(id));
    const device = await rememberDevice(f.db, survey, {
      id: 'pearlman',
      email: 'pearlman@example.com',
      emailVerified: true,
    });
    await submitSurvey(
      f.db,
      { headers: { cookie: deviceCookie(survey) + '=' + device.token } },
      privateSurveyToken(id),
      {
        requestId: randomUUID(),
        expectedRevision: 0,
        contentVersion: FORM_VERSION,
        advisorId: device.member.advisor_id,
        consent: 'admins',
        answers: [{ id: d.questions[0].id, value: 4 }],
      },
    );
    const archive = (query = '', headers = { Cookie: 'test-officer=yes' }) =>
      fetch(origin + '/api/custom-surveys?action=archived-responses' + query, {
        headers,
      });
    assert.equal((await archive('', {})).status, 401);
    assert.equal(
      (await archive('', { Cookie: deviceCookie(survey) + '=' + device.token }))
        .status,
      401,
    );
    assert.equal((await (await archive()).json()).responses.length, 0);
    await changeRespondent(f.db, actor, {
      surveyId: id,
      action: 'remove',
      advisorId: device.member.advisor_id,
      expectedRevision: 2,
      requestId: randomUUID(),
    });
    const other = (
      await f.db.query(
        'SELECT advisor_id FROM club_forms.custom_survey_members WHERE survey_id=$1 AND email=$2',
        [id, 'bracewell@example.com'],
      )
    ).rows[0];
    await changeRespondent(f.db, actor, {
      surveyId: id,
      action: 'remove',
      advisorId: other.advisor_id,
      expectedRevision: 3,
      requestId: randomUUID(),
    });
    const data = await (await archive()).json();
    assert.equal(data.readOnly, true);
    assert.equal(data.hasMore, false);
    assert.equal(data.responses.length, 1);
    assert.equal(data.responses[0].email, 'pearlman@example.com');
    assert.equal(data.responses[0].responses[0].text, '4 / 5');
    assert.equal(data.responses[0].definition.title, d.title);
    assert.ok(data.responses[0].archived_at);
    assert.equal((await archive('&offset=-1')).status, 400);
    await add(f, id, 'pearlman@example.com', 4);
    assert.equal((await (await archive()).json()).responses.length, 0);
    assert.equal(
      (await currentResponses(f.db, id)).find(
        (r) => r.advisor_id === device.member.advisor_id,
      ).responses[0].text,
      '4 / 5',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await f.db.close();
  }
});
