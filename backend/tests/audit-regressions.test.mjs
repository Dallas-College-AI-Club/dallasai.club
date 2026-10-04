import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/custom-survey-fixture.mjs';
import { surveyCatalog } from '../lib/survey-catalog.mjs';
import { cleanupSurveyDevices } from '../lib/survey-maintenance.mjs';
import { currentResponses, rememberDevice } from '../lib/custom-surveys.mjs';
import {
  changeDraft,
  getDraft,
  validateFormResponse,
  FORM_VERSION,
} from '../lib/survey-builder.mjs';
import { hasAnswer } from '../surveys/form-values.js';
import http from 'node:http';
import {
  privateSurveyToken,
  linkedSurvey,
  deviceCookie,
} from '../lib/custom-surveys.mjs';

const draft = () => ({
  template: 'blank',
  title: 'Audit feedback',
  intro: '',
  audience: 'public',
  permissions: { preview: 'link', answer: 'verified', results: 'admins' },
  durationDays: 30,
  questions: [
    {
      id: randomUUID(),
      title: 'Your thoughts',
      description: '',
      type: 'text',
      required: false,
      options: [],
    },
  ],
});

test('literal answers, zero-valued choices, and whitespace agree between review and server validation', () => {
  for (const value of ['Not answered', '0', 0, [0], ' Hello '])
    assert.equal(hasAnswer(value), true);
  for (const value of [undefined, null, '', ' \n\t ', []])
    assert.equal(hasAnswer(value), false);
  const definition = draft(),
    q = definition.questions[0],
    member = { advisor_id: 'me' };
  const body = {
    requestId: randomUUID(),
    expectedRevision: 0,
    contentVersion: FORM_VERSION,
    advisorId: 'me',
    consent: 'admins',
    answers: [{ id: q.id, value: 'Not answered' }],
  };
  assert.equal(
    validateFormResponse(body, { definition }, member)[0].text,
    'Not answered',
  );
  body.answers[0].value = ' \n ';
  assert.deepEqual(validateFormResponse(body, { definition }, member), []);
  q.required = true;
  assert.throws(() => validateFormResponse(body, { definition }, member), {
    status: 400,
  });
});

test('catalog separates active, archived and withdrawn answers, minimizes definitions, and hides invalid links', async () => {
  const f = await fixture();
  process.env.AUTH_BASE_URL = 'https://club.example';
  try {
    for (const id of ['pearlman', 'bracewell']) {
      await f.db.query(
        'INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,$2,1,$3)',
        [f.id, id, JSON.stringify([{ text: 'Useful feedback' }])],
      );
    }
    await f.db.query(
      "UPDATE club_forms.custom_survey_members SET active=false WHERE advisor_id='bracewell'",
    );
    let catalog = await surveyCatalog(f.db);
    assert.equal(catalog[0].response_count, 1);
    assert.equal(catalog[0].archived_response_count, 1);
    assert.ok(catalog[0].privateLink);
    assert.equal(catalog[0].link_digest, undefined);
    await f.db.query(
      "UPDATE club_forms.custom_survey_responses SET responses='[]' WHERE advisor_id='pearlman'",
    );
    assert.equal((await surveyCatalog(f.db))[0].response_count, 0);
    await f.db.query(
      "UPDATE club_forms.custom_surveys SET expires_at=now()-interval '1 second'",
    );
    catalog = await surveyCatalog(f.db);
    assert.equal(catalog[0].expired, true);
    assert.equal(catalog[0].privateLink, null);

    const id = randomUUID(),
      definition = draft();
    await changeDraft(
      f.db,
      { email: 'officer@example.com' },
      {
        id,
        definition,
        action: 'save',
        requestId: randomUUID(),
        expectedRevision: 0,
      },
    );
    const item = (await surveyCatalog(f.db)).find((s) => s.id === id);
    assert.deepEqual(item.definition, {
      permissions: definition.permissions,
    });
    assert.ok(item.previewLink);
    assert.equal(item.privateLink, null);
    process.env.FORM_TOKEN_SECRET = 'rotated-test-secret-'.repeat(3);
    assert.equal((await getDraft(f.db, id)).previewLink, null);
    assert.equal(
      (await surveyCatalog(f.db)).find((s) => s.id === id).previewLink,
      null,
    );
  } finally {
    await f.db.close();
  }
});

test('respondent-only SQL reads preserve consent boundaries without loading the full roster', async () => {
  const f = await fixture();
  try {
    for (const id of ['pearlman', 'bracewell'])
      await f.db.query(
        'INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses,shared_with) VALUES($1,$2,1,$3,$4)',
        [f.id, id, '[{"text":"Chosen response"}]', ['pearlman', 'bracewell']],
      );
    const own = await currentResponses(f.db, f.id, 'pearlman', {
      ownOnly: true,
    });
    assert.equal(own.length, 1);
    assert.equal(own[0].advisor_id, 'pearlman');
    await f.db.query(
      "UPDATE club_forms.custom_survey_members SET active=false WHERE advisor_id='bracewell'",
    );
    assert.equal(
      (await currentResponses(f.db, f.id, null, { activeOnly: true })).length,
      1,
    );
    assert.equal((await currentResponses(f.db, f.id)).length, 2);
  } finally {
    await f.db.close();
  }
});

test('maintenance deletes only obsolete device tokens in bounded batches and preserves survey history', async () => {
  const f = await fixture();
  try {
    await f.db.exec('CREATE ROLE club_forms_api');
    const migration = await readFile(
      new URL('../018_survey_maintenance.sql', import.meta.url),
      'utf8',
    );
    await f.db.exec(migration);
    await f.db.exec(migration);
    const survey = (
      await f.db.query('SELECT * FROM club_forms.custom_surveys WHERE id=$1', [
        f.id,
      ])
    ).rows[0];
    await rememberDevice(f.db, survey, {
      id: 'me',
      email: 'pearlman@example.com',
      emailVerified: true,
    });
    await f.db.query(
      `INSERT INTO club_forms.custom_survey_devices(token_digest,survey_id,advisor_id,user_id,expires_at,revoked_at)
      SELECT 'obsolete-'||n,$1,'pearlman','me',CASE WHEN n%2=0 THEN now()-interval '1 day' ELSE now()+interval '1 day' END,
      CASE WHEN n%2=1 THEN now() END FROM generate_series(1,1005) n`,
      [f.id],
    );
    await f.db.query(
      "INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,'pearlman',1,'[]')",
      [f.id],
    );
    assert.equal(await cleanupSurveyDevices(f.db), 1000);
    assert.equal(await cleanupSurveyDevices(f.db), 5);
    assert.equal(await cleanupSurveyDevices(f.db), 0);
    assert.equal(
      (
        await f.db.query(
          'SELECT count(*)::int n FROM club_forms.custom_survey_devices',
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await f.db.query(
          'SELECT count(*)::int n FROM club_forms.custom_survey_responses',
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT has_table_privilege('club_forms_api','club_forms.custom_survey_devices','DELETE') allowed",
        )
      ).rows[0].allowed,
      true,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT has_table_privilege('club_forms_api','club_forms.custom_survey_responses','DELETE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await f.db.close();
  }
});

test('custom results paginate with own answers always available and enforce access on every page', async () => {
  const f = await fixture(),
    server = http.createServer(f.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
  try {
    const id = randomUUID(),
      definition = draft();
    definition.permissions.results = 'respondents';
    const actor = { email: 'officer@example.com' };
    for (const [action, expectedRevision] of [
      ['save', 0],
      ['publish', 1],
    ])
      await changeDraft(f.db, actor, {
        id,
        definition,
        action,
        expectedRevision,
        requestId: randomUUID(),
      });
    for (let n = 0; n < 23; n++) {
      const who = 'person-' + String(n).padStart(2, '0');
      await f.db.query(
        'INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email,active) VALUES($1,$2,$2,$3,$4)',
        [id, who, who + '@example.com', n !== 22],
      );
      await f.db.query(
        'INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,$2,1,$3)',
        [
          id,
          who,
          JSON.stringify([
            {
              id: definition.questions[0].id,
              text: 'Answer ' + n,
              value: 'Answer ' + n,
            },
          ]),
        ],
      );
    }
    const survey = await linkedSurvey(f.db, privateSurveyToken(id));
    const device = await rememberDevice(f.db, survey, {
      id: 'viewer',
      email: 'person-00@example.com',
      emailVerified: true,
    });
    const headers = {
      'X-Survey-Link': privateSurveyToken(id),
      Cookie: deviceCookie(survey) + '=' + device.token,
    };
    const call = (action, extra = {}) =>
      fetch(
        origin +
          '/api/custom-surveys?' +
          new URLSearchParams({ action, ...extra }),
        { headers },
      );
    const bootstrap = await (await call('bootstrap')).json();
    assert.equal(bootstrap.results.length, 11);
    assert.equal(bootstrap.results[0].advisor_id, 'person-00');
    assert.equal(bootstrap.nextOffset, 10);
    assert.deepEqual(
      bootstrap.definition.respondents.map((p) => p.id),
      ['person-00'],
    );
    const seen = bootstrap.results.map((r) => r.advisor_id);
    let next = bootstrap.nextOffset;
    while (next !== null) {
      const page = await (
        await call('shared-results', { offset: String(next) })
      ).json();
      assert.ok(page.results.length <= 10);
      seen.push(...page.results.map((r) => r.advisor_id));
      next = page.nextOffset;
    }
    assert.equal(seen.length, 22);
    assert.equal(new Set(seen).size, 22);
    assert.equal(seen.includes('person-22'), false);
    assert.equal((await call('shared-results', { offset: '0.5' })).status, 400);
    assert.equal(
      (await fetch(origin + '/api/custom-surveys?action=results&id=' + id))
        .status,
      401,
    );
    const adminPage = await (
      await fetch(origin + '/api/custom-surveys?action=results&id=' + id, {
        headers: { Cookie: 'test-officer=yes' },
      })
    ).json();
    assert.equal(adminPage.results.length, 10);
    assert.equal(
      adminPage.results.every((r) => r.active),
      true,
    );
    for (const malformed of ['-'.repeat(36), 'a'.repeat(36)])
      assert.equal(
        (
          await fetch(
            origin + '/api/custom-surveys?action=results&id=' + malformed,
            { headers: { Cookie: 'test-officer=yes' } },
          )
        ).status,
        400,
      );
    await f.db.query(
      "UPDATE club_forms.custom_surveys SET definition=jsonb_set(definition,'{permissions,results}','\"admins\"') WHERE id=$1",
      [id],
    );
    assert.equal((await call('shared-results')).status, 403);
    const privateData = await (await call('bootstrap')).json();
    assert.deepEqual(
      privateData.results.map((r) => r.advisor_id),
      ['person-00'],
    );
    await f.db.query(
      "UPDATE club_forms.custom_survey_members SET active=false WHERE survey_id=$1 AND advisor_id='person-00'",
      [id],
    );
    assert.equal((await call('shared-results')).status, 401);
    await f.db.query(
      'UPDATE club_forms.custom_survey_members SET active=false WHERE survey_id=$1',
      [id],
    );
    const archived = [];
    for (let offset = 0; ; offset += 10) {
      const response = await fetch(
        origin +
          '/api/custom-surveys?action=archived-responses&offset=' +
          offset,
        {
          headers: { Cookie: 'test-officer=yes' },
        },
      );
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.equal(page.pageSize, 10);
      assert.ok(page.responses.length <= 10);
      archived.push(...page.responses.map((r) => r.advisor_id));
      if (!page.hasMore) break;
    }
    assert.equal(archived.length, 23);
    assert.equal(new Set(archived).size, 23);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await f.db.close();
  }
});
