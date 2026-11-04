import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/custom-survey-fixture.mjs';
import {
  changeDraft,
  changeSurveyLifecycle,
  getDraft,
  previewToken,
} from '../lib/survey-builder.mjs';
import {
  linkedSurvey,
  linkedPreview,
  privateSurveyToken,
  rememberDevice,
} from '../lib/custom-surveys.mjs';
import { surveyCatalog, eventFeedbackLinks } from '../lib/survey-catalog.mjs';
import { inboxCountsQuery } from '../lib/inbox-surveys.mjs';
import { homeSummary } from '../lib/home.mjs';
import { generateSurveyShareLink } from '../lib/survey-share-link.mjs';
import { customSurveysHandler } from '../api/custom-surveys.mjs';

const actor = { email: 'officer@example.com' };
const expiration = (id, expiresAt, expectedRevision = 0) => ({
  id,
  expiresAt,
  expectedRevision,
  action: 'expiration',
  requestId: randomUUID(),
});

test('expiration changes preserve survey and answers, reopen expired links, and guard revisions and receipts', async (t) => {
  const f = await fixture();
  process.env.AUTH_BASE_URL = 'https://club.example.com';
  try {
    await f.db.query(
      'INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,\'pearlman\',1,\'[{"text":"Preserved answer"}]\')',
      [f.id],
    );
    const snapshot = async () => ({
      survey: (
        await f.db.query(
          "SELECT to_jsonb(s)-'expires_at'-'edit_revision' AS value FROM club_forms.custom_surveys s WHERE id=$1",
          [f.id],
        )
      ).rows[0].value,
      responses: (
        await f.db.query('SELECT * FROM club_forms.custom_survey_responses')
      ).rows,
    });
    const before = await snapshot();
    const change = expiration(f.id, null);
    assert.deepEqual(await changeSurveyLifecycle(f.db, actor, change), {
      id: f.id,
      revision: 1,
    });
    assert.equal((await linkedSurvey(f.db, f.token)).expires_at, null);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await changeSurveyLifecycle(f.db, actor, change), {
      id: f.id,
      revision: 1,
    });
    assert.equal((await getDraft(f.db, f.id)).activity.length, 1);
    await assert.rejects(
      changeSurveyLifecycle(f.db, actor, {
        ...change,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
      { status: 409 },
    );
    await assert.rejects(
      changeSurveyLifecycle(f.db, actor, expiration(f.id, null)),
      { status: 409 },
    );
    const until = new Date(Date.now() + 2 * 86400000).toISOString();
    const finiteChange = expiration(f.id, until, 1);
    await changeSurveyLifecycle(f.db, actor, finiteChange);
    assert.equal(
      (await linkedSurvey(f.db, f.token)).expires_at.toISOString(),
      until,
    );
    t.mock.method(Date, 'now', () => Date.parse(until) + 1);
    try {
      assert.deepEqual(await changeSurveyLifecycle(f.db, actor, finiteChange), {
        id: f.id,
        revision: 2,
      });
    } finally {
      t.mock.restoreAll();
    }
    await f.db.query(
      "UPDATE club_forms.custom_surveys SET expires_at=now()-interval '1 day' WHERE id=$1",
      [f.id],
    );
    await assert.rejects(linkedSurvey(f.db, f.token), { status: 404 });
    await changeSurveyLifecycle(f.db, actor, expiration(f.id, null, 2));
    assert.equal((await linkedSurvey(f.db, f.token)).expires_at, null);
    assert.deepEqual(await snapshot(), before);
    for (const status of ['draft', 'closed', 'archived']) {
      await f.db.query(
        'UPDATE club_forms.custom_surveys SET status=$2 WHERE id=$1',
        [f.id, status],
      );
      await assert.rejects(
        changeSurveyLifecycle(f.db, actor, expiration(f.id, null, 3)),
        { status: 409 },
      );
      await assert.rejects(linkedSurvey(f.db, f.token), { status: 404 });
    }
    await f.db.query(
      "UPDATE club_forms.custom_surveys SET status='open' WHERE id=$1",
      [f.id],
    );
    for (const invalid of [
      undefined,
      false,
      1,
      '',
      'invalid',
      '2000-01-01T00:00:00.000Z',
      '2099-02-30T00:00:00.000Z',
      '2099-01-01T00:00:00Z',
    ])
      await assert.rejects(
        changeSurveyLifecycle(f.db, actor, expiration(f.id, invalid, 3)),
        { status: 400 },
      );
    await assert.rejects(
      changeSurveyLifecycle(f.db, actor, {
        ...expiration(f.id, null, 3),
        definition: {},
      }),
      { status: 400 },
    );
    const broken = {
      transaction: (fn) =>
        f.db.transaction((tx) =>
          fn({
            query: (sql, values) =>
              sql.startsWith('INSERT INTO club_forms.custom_survey_changes')
                ? Promise.reject(new Error('audit failed'))
                : tx.query(sql, values),
          }),
        ),
    };
    await assert.rejects(
      changeSurveyLifecycle(broken, actor, expiration(f.id, until, 3)),
      /audit failed/,
    );
    const after = await getDraft(f.db, f.id);
    assert.equal(after.expires_at, null);
    assert.equal(after.edit_revision, 3);
    assert.deepEqual(
      after.activity.map((entry) => entry.action),
      Array(3).fill('expiration_changed'),
    );
  } finally {
    await f.db.close();
  }
});

test('expiration HTTP access and non-expiring Advisor verification, reads and submission preserve authorization', async () => {
  const f = await fixture();
  let changeDuringVerification = false;
  const server = http.createServer(
    customSurveysHandler({
      getDatabase: () => f.db,
      authorize: f.authorize,
      rateLimit: async () => {},
      getSession: async (req) => {
        if (changeDuringVerification)
          await f.db.query(
            'UPDATE club_forms.custom_surveys SET expires_at=NULL WHERE id=$1',
            [f.id],
          );
        return f.getSession(req);
      },
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
  const call = (action, body, cookie = '', originHeader = origin) =>
    fetch(origin + '/api/custom-surveys?action=' + action, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'X-Survey-Link': f.token,
        Cookie: cookie,
        ...(body === undefined
          ? {}
          : { Origin: originHeader, 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const body = expiration(f.id, null);
    assert.equal((await call('lifecycle', body)).status, 401);
    assert.equal(
      (await call('lifecycle', undefined, 'test-officer=yes')).status,
      405,
    );
    assert.equal(
      (
        await call(
          'lifecycle',
          body,
          'test-officer=yes',
          'https://outside.example',
        )
      ).status,
      403,
    );
    assert.equal(
      (await call('lifecycle', body, 'test-officer=yes')).status,
      200,
    );
    for (const action of ['welcome', 'preview']) {
      const result = await call(action);
      assert.equal(result.status, 200);
      assert.equal((await result.json()).expiresAt, null);
    }
    assert.equal((await call('bootstrap')).status, 401);
    let verified = await call('verify-device', {}, 'test-neon=pearlman');
    assert.equal(verified.status, 200);
    const cookie = verified.headers.getSetCookie()[0].split(';')[0];
    assert.match(
      verified.headers.getSetCookie()[0],
      /HttpOnly; SameSite=Strict; Max-Age=(77759\d\d|7776000)(;|$)/,
    );
    const bootstrap = await call('bootstrap', undefined, cookie);
    assert.equal(bootstrap.status, 200);
    const data = await bootstrap.json();
    assert.equal(data.survey.expiresAt, null);
    assert.equal(
      (
        await call(
          'submit',
          {
            format: 'advisor-studio-shared/9',
            contentVersion: data.definition.content_version,
            advisorId: 'pearlman',
            consent: {
              reviewed: true,
              audience: ['club_officers', 'bracewell'],
            },
            expectedRevision: 0,
            requestId: randomUUID(),
            responses: [
              {
                id: 'note-spark',
                kind: 'comment',
                pageId: 'spark',
                mode: 'narrative',
                text: 'A chosen response.',
                wordingReviewed: true,
                included: true,
              },
            ],
          },
          cookie,
        )
      ).status,
      200,
    );
    await f.db.query(
      "UPDATE club_forms.custom_surveys SET expires_at=now()+interval '2 days' WHERE id=$1",
      [f.id],
    );
    verified = await call('verify-device', {}, 'test-neon=pearlman');
    assert.match(
      verified.headers.getSetCookie()[0],
      /Max-Age=(17279\d|172800)(;|$)/,
    );
    changeDuringVerification = true;
    verified = await call('verify-device', {}, 'test-neon=pearlman');
    assert.match(
      verified.headers.getSetCookie()[0],
      /Max-Age=(77759\d\d|7776000)(;|$)/,
    );
    changeDuringVerification = false;
    await f.db.query(
      "UPDATE club_forms.custom_surveys SET expires_at=now()-interval '1 second' WHERE id=$1",
      [f.id],
    );
    assert.equal((await call('bootstrap', undefined, cookie)).status, 404);
    await f.db.query(
      'UPDATE club_forms.custom_surveys SET expires_at=NULL WHERE id=$1',
      [f.id],
    );
    await f.db.query(
      "UPDATE club_forms.custom_survey_members SET active=false WHERE advisor_id='pearlman'",
    );
    assert.equal((await call('bootstrap', undefined, cookie)).status, 401);
    await f.db.query(
      "UPDATE club_forms.custom_surveys SET status='closed' WHERE id=$1",
      [f.id],
    );
    assert.equal((await call('preview')).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await f.db.close();
  }
});

test('expiration null preserves builder previews, catalog, Home, old Inbox answers and event links', async () => {
  const f = await fixture();
  process.env.AUTH_BASE_URL = 'https://club.example.com';
  try {
    await changeSurveyLifecycle(f.db, actor, expiration(f.id, null));
    await f.db.query(
      "INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses,submitted_at) VALUES($1,'pearlman',1,'[{\"text\":\"Old answer\"}]',now()-interval '60 days')",
      [f.id],
    );
    assert.equal((await homeSummary(f.db, [], [])).survey.id, f.id);
    const counts = (await f.db.query(inboxCountsQuery, [[], []])).rows.find(
      (row) => row.kind === 'survey',
    );
    assert.equal(counts.current, 1);
    assert.equal(counts.past, 0);
    const catalog = (await surveyCatalog(f.db)).find((row) => row.id === f.id);
    assert.equal(catalog.expired, false);
    assert.ok(catalog.privateLink);
    const id = randomUUID();
    const definition = {
      template: 'feedback',
      title: 'Feedback',
      intro: '',
      audience: 'public',
      permissions: { preview: 'link', answer: 'verified', results: 'admins' },
      durationDays: 30,
      questions: [
        {
          id: randomUUID(),
          title: 'Comments',
          type: 'text',
          required: false,
          description: '',
          options: [],
        },
      ],
    };
    await changeDraft(f.db, actor, {
      id,
      definition,
      action: 'save',
      expectedRevision: 0,
      requestId: randomUUID(),
    });
    await changeDraft(f.db, actor, {
      id,
      definition,
      action: 'publish',
      expectedRevision: 1,
      requestId: randomUUID(),
    });
    await changeSurveyLifecycle(f.db, actor, expiration(id, null, 2));
    assert.equal(
      (await linkedPreview(f.db, previewToken(id))).expires_at,
      null,
    );
    assert.ok((await getDraft(f.db, id)).previewLink);
    await f.db.query(
      'UPDATE club_forms.custom_surveys SET definition=definition||\'{"eventId":"game-night"}\'::jsonb WHERE id=$1',
      [id],
    );
    assert.ok(
      (await eventFeedbackLinks(f.db, ['game-night']))
        .get('game-night')
        .includes(privateSurveyToken(id)),
    );
    await f.db.query(
      "UPDATE club_forms.custom_surveys SET expires_at=now()+interval '200 days' WHERE id=$1",
      [id],
    );
    const session = await rememberDevice(
      f.db,
      await linkedSurvey(f.db, privateSurveyToken(id)),
      {
        id: 'public-user',
        email: 'public@example.com',
        name: 'Public Person',
        emailVerified: true,
      },
    );
    assert.ok(session.expiresAt.getTime() <= Date.now() + 90 * 86400000);
    assert.ok(session.expiresAt.getTime() > Date.now() + 89 * 86400000);
    assert.equal(
      (
        await f.db.query(
          'SELECT expires_at FROM club_forms.custom_survey_devices WHERE survey_id=$1',
          [id],
        )
      ).rows[0].expires_at.getTime(),
      session.expiresAt.getTime(),
    );
  } finally {
    await f.db.close();
  }
});

test('expiration null allows audited short-link generation without a provider expiry', async () => {
  const f = await fixture();
  process.env.AUTH_BASE_URL = 'https://club.example.com';
  const previous = {
    key: process.env.SHORT_IO_API_KEY,
    domain: process.env.SHORT_IO_DOMAIN,
  };
  process.env.SHORT_IO_API_KEY = 'test-only';
  process.env.SHORT_IO_DOMAIN = 'short.example.com';
  try {
    await changeSurveyLifecycle(f.db, actor, expiration(f.id, null));
    const result = await generateSurveyShareLink(
      f.db,
      actor,
      { id: f.id },
      async (url, options) => {
        assert.equal(url, 'https://api.short.io/links');
        const body = JSON.parse(options.body);
        return Response.json({
          originalURL: body.originalURL,
          path: body.path,
          secureShortURL: 'https://short.example.com/' + body.path,
          hasPassword: false,
          archived: false,
        });
      },
    );
    assert.ok(result.short_link.startsWith('https://short.example.com/'));
    assert.equal(
      (
        await f.db.query('SELECT actor FROM club_forms.audit WHERE action=$1', [
          'custom-survey-share-link:' + f.id,
        ])
      ).rows[0].actor,
      actor.email,
    );
  } finally {
    if (previous.key === undefined) delete process.env.SHORT_IO_API_KEY;
    else process.env.SHORT_IO_API_KEY = previous.key;
    if (previous.domain === undefined) delete process.env.SHORT_IO_DOMAIN;
    else process.env.SHORT_IO_DOMAIN = previous.domain;
    await f.db.close();
  }
});
