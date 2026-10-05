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
  changeSurveyLifecycle,
} from '../lib/survey-builder.mjs';
import { changeRespondent } from '../lib/survey-respondents.mjs';
import { surveyCatalog } from '../lib/survey-catalog.mjs';
import { surveyResultsCSV, surveyExportRows } from '../lib/survey-results.mjs';
import { responseDocument } from '../admin/response-document.js';
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

test('survey lifecycle archives and restores drafts without changing responses, and rejects stale or reused changes', async () => {
  const f = await fixture();
  process.env.AUTH_BASE_URL = 'https://club.example';
  try {
    const definition = {
      ...draft(),
      audience: 'public',
      permissions: { preview: 'link', answer: 'verified', results: 'admins' },
    };
    definition.questions[0].type = 'multiple';
    definition.questions[0].options = ['Morning', 'Evening'];
    const id = randomUUID();
    await changeDraft(f.db, actor, action(id, definition));
    await changeDraft(f.db, actor, action(id, definition, 1, 'publish'));
    const survey = await linkedSurvey(f.db, privateSurveyToken(id));
    const device = await rememberDevice(f.db, survey, {
      id: 'lifecycle-user',
      email: 'lifecycle@example.edu',
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
        answers: [{ id: definition.questions[0].id, value: [1] }],
      },
    );
    const responses = await currentResponses(f.db, id);
    const archive = {
      id,
      requestId: randomUUID(),
      expectedRevision: 2,
      action: 'archive',
    };
    await changeSurveyLifecycle(f.db, actor, archive);
    assert.equal((await getDraft(f.db, id)).status, 'archived');
    assert.deepEqual(await currentResponses(f.db, id), responses);
    await assert.rejects(linkedSurvey(f.db, privateSurveyToken(id)), {
      status: 404,
    });
    assert.deepEqual(await changeSurveyLifecycle(f.db, actor, archive), {
      id,
      revision: 3,
    });
    await assert.rejects(
      changeSurveyLifecycle(f.db, actor, { ...archive, action: 'restore' }),
      { status: 409 },
    );
    await assert.rejects(
      changeSurveyLifecycle(f.db, actor, {
        ...archive,
        requestId: randomUUID(),
        action: 'restore',
      }),
      { status: 409 },
    );
    await changeSurveyLifecycle(f.db, actor, {
      id,
      requestId: randomUUID(),
      expectedRevision: 3,
      action: 'restore',
    });
    const restored = await getDraft(f.db, id);
    assert.equal(restored.status, 'closed');
    assert.equal(restored.previewLink, null);
    assert.deepEqual(restored.definition, survey.definition);
    assert.deepEqual(await currentResponses(f.db, id), responses);
    await assert.rejects(
      changeSurveyLifecycle(f.db, actor, {
        id,
        requestId: randomUUID(),
        expectedRevision: 4,
        action: 'restore',
      }),
      { status: 409 },
    );
    await assert.rejects(
      changeSurveyLifecycle(f.db, actor, {
        id: f.id,
        requestId: randomUUID(),
        expectedRevision: 0,
        action: 'edit',
      }),
      { status: 409 },
    );
    await assert.rejects(
      changeSurveyLifecycle(f.db, actor, {
        id: randomUUID(),
        requestId: randomUUID(),
        expectedRevision: 0,
        action: 'archive',
      }),
      { status: 404 },
    );
    await f.db.query(
      'UPDATE club_forms.custom_survey_responses SET response_definition=NULL WHERE survey_id=$1',
      [id],
    );
    await changeSurveyLifecycle(f.db, actor, {
      id,
      requestId: randomUUID(),
      expectedRevision: 4,
      action: 'edit',
    });
    await assert.rejects(
      changeDraft(
        f.db,
        actor,
        action(
          id,
          {
            ...definition,
            permissions: { ...definition.permissions, results: 'respondents' },
          },
          5,
        ),
      ),
      { status: 409 },
    );
    assert.equal(
      (await getDraft(f.db, id)).definition.permissions.results,
      'admins',
    );
    const changed = structuredClone(definition);
    changed.questions[0].title = 'Updated rating';
    changed.questions[0].type = 'text';
    changed.questions[0].options = [];
    await changeDraft(f.db, actor, action(id, changed, 5));
    await changeDraft(f.db, actor, action(id, changed, 6, 'publish'));
    const republished = await linkedSurvey(f.db, privateSurveyToken(id));
    assert.equal(republished.content_version, FORM_VERSION + ':7');
    const oldRows = await surveyExportRows(f.db, id);
    assert.equal(
      oldRows[0].response_definition.questions[0].title,
      'Your rating',
    );
    assert.equal(
      new Date(oldRows[0].submitted_at).getTime(),
      new Date(responses[0].submitted_at).getTime(),
    );
    const csv = surveyResultsCSV(oldRows, changed);
    assert.match(csv.split('\r\n')[0], /Updated rating.*Your rating/);
    const pdf = responseDocument(
      { ...oldRows[0], responses: oldRows[0].responses },
      { title: 'Saved response', definition: changed },
    );
    assert.equal(pdf.blocks[0].question, 'Your rating');
    assert.equal(pdf.blocks[0].kind, 'choices');
    assert.deepEqual(pdf.blocks[0].lines, ['Evening']);
    const req = {
      headers: { cookie: deviceCookie(survey) + '=' + device.token },
    };
    const body = {
      requestId: randomUUID(),
      expectedRevision: 1,
      contentVersion: FORM_VERSION,
      advisorId: device.member.advisor_id,
      consent: 'admins',
      answers: [{ id: changed.questions[0].id, value: 'Fresh feedback' }],
    };
    await assert.rejects(
      submitSurvey(f.db, req, privateSurveyToken(id), body),
      { status: 400 },
    );
    assert.deepEqual(
      (await currentResponses(f.db, id))[0].responses,
      responses[0].responses,
    );
    await submitSurvey(f.db, req, privateSurveyToken(id), {
      ...body,
      contentVersion: republished.content_version,
    });
    assert.equal(
      (await currentResponses(f.db, id))[0].responses[0].title,
      'Updated rating',
    );
    const deletion = {
      id,
      requestId: randomUUID(),
      expectedRevision: 7,
      action: 'delete',
    };
    await assert.rejects(changeSurveyLifecycle(f.db, actor, deletion), {
      status: 409,
    });
    await changeSurveyLifecycle(f.db, actor, {
      ...deletion,
      requestId: randomUUID(),
      action: 'archive',
    });
    deletion.expectedRevision = 8;
    const deleted = await changeSurveyLifecycle(f.db, actor, deletion);
    assert.deepEqual(deleted, { id, revision: 9, deleted: true });
    assert.deepEqual(
      await changeSurveyLifecycle(f.db, actor, deletion),
      deleted,
    );
    await assert.rejects(
      changeSurveyLifecycle(f.db, actor, { ...deletion, action: 'archive' }),
      { status: 409 },
    );
    await assert.rejects(getDraft(f.db, id), { status: 404 });
    await assert.rejects(linkedSurvey(f.db, privateSurveyToken(id)), {
      status: 404,
    });
    for (const table of [
      'devices',
      'receipts',
      'responses',
      'activity',
      'members',
    ])
      assert.equal(
        (
          await f.db.query(
            'SELECT count(*)::int n FROM club_forms.custom_survey_' +
              table +
              ' WHERE survey_id=$1',
            [id],
          )
        ).rows[0].n,
        0,
      );
    const deleteReceipt = (
      await f.db.query(
        'SELECT * FROM club_forms.custom_survey_changes WHERE id=$1',
        [deletion.requestId],
      )
    ).rows[0];
    assert.equal(deleteReceipt.survey_id, null);
    assert.equal(deleteReceipt.action, 'deleted');
    assert.doesNotMatch(
      JSON.stringify(deleteReceipt),
      /Fresh feedback|Morning|Evening/,
    );
    assert.equal((await getDraft(f.db, f.id)).status, 'open');
  } finally {
    await f.db.close();
  }
});
test('custom availability preserves optional answers, dates and suggested times through saves', async () => {
  const f = await fixture();
  process.env.AUTH_BASE_URL = 'https://club.example';
  try {
    const definition = {
      ...draft(),
      audience: 'public',
      permissions: { preview: 'link', answer: 'verified', results: 'admins' },
      questions: [
        {
          id: randomUUID(),
          title: 'Availability',
          description: 'All times Central.',
          type: 'availability',
          required: false,
          options: ['Afternoon', 'Evening'],
          dates: ['2026-10-16', '2026-10-17'],
        },
      ],
    };
    const id = randomUUID();
    await changeDraft(f.db, actor, action(id, definition));
    await changeDraft(f.db, actor, action(id, definition, 1, 'publish'));
    const token = privateSurveyToken(id),
      survey = await linkedSurvey(f.db, token);
    const values = [
      '',
      {
        status: 'available',
        selections: [{ date: '2026-10-17', periods: ['Afternoon', 'Evening'] }],
        alternatives: [],
      },
      { status: 'unavailable', selections: [], alternatives: [] },
      { status: 'unsure', selections: [], alternatives: [] },
      {
        status: 'alternative',
        selections: [],
        alternatives: [{ date: '2026-11-05', time: '19:30' }],
      },
    ];
    const memberIds = [];
    for (const [i, value] of values.entries()) {
      const device = await rememberDevice(f.db, survey, {
        id: 'availability-' + i,
        email: 'availability-' + i + '@example.edu',
        emailVerified: true,
      });
      memberIds.push(device.member.advisor_id);
      const req = {
          headers: { cookie: deviceCookie(survey) + '=' + device.token },
        },
        body = {
          requestId: randomUUID(),
          expectedRevision: 0,
          contentVersion: FORM_VERSION,
          advisorId: device.member.advisor_id,
          consent: 'admins',
          answers: [{ id: definition.questions[0].id, value }],
        };
      if (i === 1)
        assert.throws(
          () =>
            validateFormResponse(
              {
                ...body,
                answers: [
                  {
                    id: definition.questions[0].id,
                    value: { ...value, status: 'unsure' },
                  },
                ],
              },
              survey,
              device.member,
            ),
          { status: 400 },
        );
      await Promise.all([
        submitSurvey(f.db, req, token, body),
        submitSurvey(f.db, req, token, body),
      ]);
    }
    const rows = await currentResponses(f.db, id);
    assert.equal(rows.length, 5);
    for (const [i, value] of values.entries())
      assert.deepEqual(
        rows.find((r) => r.advisor_id === memberIds[i]).responses[0]?.value ??
          '',
        value,
      );
    const csv = surveyResultsCSV(rows, definition);
    assert.match(csv, /2026-10-17 · Afternoon/);
    assert.match(csv, /Not sure yet/);
    assert.match(csv, /Suggested: 2026-11-05 · 19:30/);
    assert.doesNotMatch(csv, /\[object Object\]/);
  } finally {
    await f.db.close();
  }
});
test('calendar and numeric answers validate strictly and export under their question headings', () => {
  const d = draft();
  d.questions[0].type = 'date';
  d.questions[0].title = 'Preferred date';
  d.questions[1].type = 'number';
  d.questions[1].title = 'Guests';
  validateDefinition(d, true);
  const answer = (date, number) =>
    validateFormResponse(
      {
        requestId: randomUUID(),
        expectedRevision: 0,
        contentVersion: FORM_VERSION,
        advisorId: 'member',
        consent: 'admins',
        answers: [
          { id: d.questions[0].id, value: date },
          { id: d.questions[1].id, value: number },
        ],
      },
      { definition: d },
      { advisor_id: 'member' },
    );
  const responses = answer('2028-02-29', 0);
  assert.deepEqual(
    responses.map((r) => r.text),
    ['2028-02-29', '0'],
  );
  assert.equal(answer('2026-10-04', -1.5)[1].value, -1.5);
  for (const invalid of [
    '2026-02-29',
    '2026-02-31',
    '2026-13-01',
    '10/04/2026',
    '0000-01-01',
    '',
    20261004,
  ])
    assert.throws(() => answer(invalid, 0), { status: 400 });
  for (const invalid of [NaN, Infinity, '3', {}, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => answer('2026-10-04', invalid), { status: 400 });
  const csv = surveyResultsCSV(
    [
      {
        display_name: 'Example',
        email: 'example@example.com',
        active: true,
        submitted_at: '2026-10-04T12:00:00Z',
        responses,
      },
    ],
    d,
  );
  assert.match(csv.split('\r\n')[0], /Preferred date.*Guests/);
  assert.match(csv, /2028-02-29/);
});

test('short and email answers validate, normalize and export without changing long answers', () => {
  const d = draft();
  d.questions[0].type = 'email';
  d.questions[1].type = 'short';
  validateDefinition(d, true);
  const answer = (email, short) =>
    validateFormResponse(
      {
        requestId: randomUUID(),
        expectedRevision: 0,
        contentVersion: FORM_VERSION,
        advisorId: 'member',
        consent: 'admins',
        answers: [
          { id: d.questions[0].id, value: email },
          { id: d.questions[1].id, value: short },
        ],
      },
      { definition: d },
      { advisor_id: 'member' },
    );
  const responses = answer(' Advisor@Example.edu ', ' A short answer ');
  assert.deepEqual(
    responses.map((r) => r.value),
    ['advisor@example.edu', 'A short answer'],
  );
  for (const value of [
    'bad',
    'a@',
    'a\nb@example.edu',
    'x'.repeat(255) + '@example.edu',
    '',
    {},
  ])
    assert.throws(() => answer(value, 'Short'), { status: 400 });
  for (const value of ['x'.repeat(301), {}])
    assert.throws(() => answer('a@example.edu', value), { status: 400 });
  assert.equal(answer('a@example.edu', '  ').length, 1);
  assert.match(
    surveyResultsCSV(
      [
        {
          display_name: 'Example',
          email: 'member@example.edu',
          active: true,
          submitted_at: '2026-10-04T12:00:00Z',
          responses,
        },
      ],
      d,
    ),
    /advisor@example.edu/,
  );
});

test('linked event surveys persist in the catalog and keep a separate answer link', async () => {
  const f = await fixture();
  process.env.AUTH_BASE_URL = 'https://club.example';
  try {
    const d = draft();
    d.eventId = 'feedback-event';
    assert.throws(() => validateDefinition({ ...d, eventId: '../event' }), {
      status: 400,
    });
    await assert.rejects(
      () => changeDraft(f.db, actor, action(randomUUID(), d)),
      { status: 400 },
    );
    await f.db.query(
      'INSERT INTO club_forms.events(id,draft,updated_by) VALUES($1,$2,$3)',
      [
        d.eventId,
        JSON.stringify({ title: 'Feedback event', category: 'Workshop' }),
        actor.email,
      ],
    );
    const { id } = await create(f, d);
    await add(f, id);
    await changeDraft(f.db, actor, action(id, d, 1, 'publish'));
    const catalog = (await surveyCatalog(f.db)).find((s) => s.id === id);
    assert.equal(catalog.definition.eventId, d.eventId);
    assert.match(catalog.privateLink, /\/surveys\/#invite=/);
    assert.equal((await getDraft(f.db, id)).definition.eventId, d.eventId);
    assert.equal(
      (await f.db.query('SELECT count(*)::int n FROM club_forms.entries'))
        .rows[0].n,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test('time and dated period choices validate, persist and export under concurrent submissions', async () => {
  const f = await fixture();
  try {
    const d = draft();
    d.audience = 'public';
    d.permissions.answer = 'verified';
    d.questions[0] = {
      ...d.questions[0],
      type: 'multiple',
      title: 'Available periods',
      choiceDate: '2026-10-16',
      options: ['Morning', 'Afternoon', 'Evening'],
    };
    d.questions[1] = {
      ...d.questions[1],
      type: 'time',
      title: 'Arrival time',
      required: true,
    };
    for (const choiceDate of ['2026-02-29', '0000-01-01', '', 20261016])
      assert.throws(
        () =>
          validateDefinition({
            ...d,
            questions: [{ ...d.questions[0], choiceDate }],
          }),
        { status: 400 },
      );
    assert.throws(
      () =>
        validateDefinition({
          ...d,
          questions: [{ ...d.questions[1], choiceDate: '2026-10-16' }],
        }),
      { status: 400 },
    );
    const { id } = await create(f, d);
    await changeDraft(f.db, actor, action(id, d, 1, 'publish'));
    const survey = await linkedSurvey(f.db, privateSurveyToken(id));
    const requests = [];
    for (let i = 0; i < 32; i++) {
      const device = await rememberDevice(f.db, survey, {
        id: 'period-' + i,
        email: `period-${i}@example.com`,
        emailVerified: true,
      });
      requests.push({
        req: { headers: { cookie: deviceCookie(survey) + '=' + device.token } },
        body: {
          requestId: randomUUID(),
          expectedRevision: 0,
          contentVersion: FORM_VERSION,
          advisorId: device.member.advisor_id,
          consent: 'admins',
          answers: [
            { id: d.questions[0].id, value: [0, 2] },
            { id: d.questions[1].id, value: '18:30' },
          ],
        },
      });
    }
    const first = requests[0];
    for (const value of ['24:00', '12:60', '6:30 PM', '18:30:00', 1830])
      assert.throws(
        () =>
          validateFormResponse(
            {
              ...first.body,
              answers: [
                first.body.answers[0],
                { id: d.questions[1].id, value },
              ],
            },
            survey,
            { advisor_id: first.body.advisorId },
          ),
        { status: 400 },
      );
    const receipts = await Promise.all(
      requests.flatMap(({ req, body }) =>
        Array.from({ length: 3 }, () =>
          submitSurvey(f.db, req, privateSurveyToken(id), body),
        ),
      ),
    );
    assert.equal(new Set(receipts.map((r) => r.id)).size, 32);
    const rows = await currentResponses(f.db, id);
    assert.equal(rows.length, 32);
    for (const row of rows)
      assert.deepEqual(
        row.responses.map((a) => a.value),
        [[0, 2], '18:30'],
      );
    const saved = (await getDraft(f.db, id)).definition;
    assert.equal(saved.questions[0].choiceDate, '2026-10-16');
    const csv = surveyResultsCSV(rows, saved);
    assert.match(csv, /2026-10-16 · Available periods/);
    assert.match(csv, /Morning; Evening/);
    assert.match(csv, /18:30/);
  } finally {
    await f.db.close();
  }
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
    const lifecycle = {
      id,
      requestId: randomUUID(),
      expectedRevision: 1,
      action: 'archive',
    };
    assert.equal((await call('lifecycle', {}, lifecycle)).status, 401);
    assert.equal(
      (await call('lifecycle', { Cookie: 'test-officer=yes' })).status,
      405,
    );
    assert.equal(
      (
        await call(
          'lifecycle',
          { Cookie: 'test-officer=yes', Origin: 'https://outside.example' },
          lifecycle,
        )
      ).status,
      403,
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
