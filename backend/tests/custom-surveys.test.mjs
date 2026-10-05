import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './helpers/custom-survey-fixture.mjs';
import { definition, canonicalResponse } from '../lib/survey-contract.mjs';
import {
  rememberDevice,
  submitSurvey,
  linkedSurvey,
  privateSurveyToken,
  digest,
} from '../lib/custom-surveys.mjs';
import { changeDraft, FORM_VERSION } from '../lib/survey-builder.mjs';
import { customSurveysHandler } from '../api/custom-surveys.mjs';
import {
  changeSurveyShareLink,
  generateSurveyShareLink,
  createShortLink,
} from '../lib/survey-share-link.mjs';
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
    "UPDATE club_forms.custom_surveys SET status='open',expires_at=now()+interval '30 days',short_link=NULL WHERE id=$1",
    [f.id],
  );
  await f.db.query(
    'UPDATE club_forms.custom_survey_members SET user_id=NULL,active=true',
  );
  await f.db.query('DELETE FROM club_forms.audit WHERE action=$1', [
    'custom-survey-share-link:' + f.id,
  ]);
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

const share = (shortLink, expectedShortLink = null, options = {}) =>
  request(
    'share-link',
    { id: f.id, shortLink, expectedShortLink },
    {
      cookie: 'test-officer=yes',
      ...options,
    },
  );
const shareAudit = async () =>
  (
    await f.db.query(
      'SELECT actor,action FROM club_forms.audit WHERE action=$1 ORDER BY id',
      ['custom-survey-share-link:' + f.id],
    )
  ).rows;
const storedShare = async () =>
  (
    await f.db.query(
      'SELECT short_link FROM club_forms.custom_surveys WHERE id=$1',
      [f.id],
    )
  ).rows[0].short_link;

test('survey short link persists, clears and retries without changing the actual survey or invitation', async () => {
  assert.equal((await request('submit', submission())).status, 200);
  const snapshot = async () => {
    const survey = (
      await f.db.query(
        "SELECT to_jsonb(s)-'short_link' AS survey FROM club_forms.custom_surveys s WHERE id=$1",
        [f.id],
      )
    ).rows[0].survey;
    const rows = {};
    for (const table of ['members', 'responses', 'receipts', 'devices'])
      rows[table] = (
        await f.db.query(
          `SELECT to_jsonb(r) AS row FROM club_forms.custom_survey_${table} r WHERE survey_id=$1 ORDER BY to_jsonb(r)::text`,
          [f.id],
        )
      ).rows;
    return {
      survey,
      rows,
      welcome: await (await request('welcome')).json(),
      preview: await (await request('preview')).json(),
    };
  };
  const before = await snapshot(),
    link = 'https://tinyurl.com/advisor-survey';
  assert.equal(await storedShare(), null);
  let response = await share('  ' + link + '  ');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: f.id, short_link: link });
  assert.equal(await storedShare(), link);
  const catalog = await (
    await request('catalog', undefined, { cookie: 'test-officer=yes' })
  ).json();
  assert.equal(
    catalog.surveys.find((survey) => survey.id === f.id).short_link,
    link,
  );
  assert.equal((await share(link)).status, 200);
  assert.deepEqual(await shareAudit(), [
    {
      actor: 'officer@example.com',
      action: 'custom-survey-share-link:' + f.id,
    },
  ]);
  assert.deepEqual(await snapshot(), before);
  response = await share('  ', link);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: f.id, short_link: null });
  assert.equal(await storedShare(), null);
  assert.equal((await share('', link)).status, 200);
  assert.equal((await shareAudit()).length, 2);
  assert.deepEqual(await snapshot(), before);
});

test('survey short link requires an officer, the admin origin and POST before database access', async () => {
  const handler = customSurveysHandler({
    authorize: f.authorize,
    getDatabase: () =>
      assert.fail('Rejected requests must not access survey data.'),
  });
  for (const action of ['share-link', 'generate-share-link'])
    for (const [method, cookie, requestOrigin, status] of [
      ['POST', '', origin, 401],
      ['POST', 'test-neon=pearlman', origin, 401],
      ['POST', 'test-officer=yes', 'https://outside.example.com', 403],
      ['POST', 'test-officer=yes', undefined, 403],
      ['GET', 'test-officer=yes', origin, 405],
      ['PUT', 'test-officer=yes', origin, 405],
    ]) {
      const res = { setHeader() {}, end() {} };
      await handler(
        {
          method,
          url: '/api/custom-surveys?action=' + action,
          headers: { cookie, origin: requestOrigin },
        },
        res,
      );
      assert.equal(
        res.statusCode,
        status,
        [method, cookie, requestOrigin].join(' '),
      );
    }
  assert.equal(await storedShare(), null);
  assert.deepEqual(await shareAudit(), []);
});

test('survey short link rejects unsafe URLs and malformed edit requests without persistence', async () => {
  for (const link of [
    null,
    123,
    '/relative',
    '//tinyurl.com/a',
    'https:tinyurl.com/a',
    'http://tinyurl.com/a',
    'javascript:alert(1)',
    'https://user:secret@tinyurl.com/a',
    'https://user@tinyurl.com/a',
    'https://:secret@tinyurl.com/a',
    'https://localhost/a',
    'https://tinyurl/a',
    'https://office.local/a',
    'https://office.internal/a',
    'https://office.test/a',
    'https://127.0.0.1/a',
    'https://10.0.0.1/a',
    'https://2130706433/a',
    'https://[::1]/a',
    'https://bad_host.com/a',
    'https://-bad.com/a',
    'https://bad..com/a',
    'https://' + 'a'.repeat(64) + '.com/a',
    'https://' + ('a'.repeat(60) + '.').repeat(5) + 'com/a',
    'https://tinyurl.com/a\nb',
    'https://tinyurl.com/a b',
    'https://tinyurl.com\\a',
    'https://tinyurl.com/' + 'a'.repeat(2049),
    'https://tinyurl.com/' + 'a/../'.repeat(500),
    'https://tinyurl.com/' + '한'.repeat(300),
  ])
    assert.equal((await share(link)).status, 400, String(link));
  for (const body of [
    { id: f.id, shortLink: '' },
    { id: f.id, shortLink: '', expectedShortLink: 123 },
    {
      id: f.id,
      shortLink: '',
      expectedShortLink: null,
      title: 'Changed title',
    },
    { id: 'invalid', shortLink: '', expectedShortLink: null },
  ])
    assert.equal(
      (await request('share-link', body, { cookie: 'test-officer=yes' }))
        .status,
      400,
    );
  assert.equal(
    (
      await request(
        'share-link',
        { id: randomUUID(), shortLink: '', expectedShortLink: null },
        { cookie: 'test-officer=yes' },
      )
    ).status,
    404,
  );
  assert.equal(await storedShare(), null);
  assert.deepEqual(await shareAudit(), []);
});

test('survey short link accepts the length boundary and a public international hostname', async () => {
  const prefix = 'https://tinyurl.com/',
    link = prefix + 'a'.repeat(2048 - prefix.length);
  assert.equal((await share(link)).status, 200);
  assert.equal(await storedShare(), link);
  assert.equal((await share('https://xn--bcher-kva.de/a', link)).status, 200);
  assert.equal(await storedShare(), 'https://xn--bcher-kva.de/a');
  assert.equal(
    (await share('https://bücher.de/설문?q=한', 'https://xn--bcher-kva.de/a'))
      .status,
    200,
  );
  assert.equal(
    await storedShare(),
    'https://xn--bcher-kva.de/%EC%84%A4%EB%AC%B8?q=%ED%95%9C',
  );
});

test('survey short link stale editors cannot overwrite or clear a newer change', async () => {
  const links = ['https://tinyurl.com/one', 'https://tinyurl.com/two'];
  const responses = await Promise.all(links.map((link) => share(link)));
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  const winner =
    links[responses.findIndex((response) => response.status === 200)];
  assert.equal(await storedShare(), winner);
  assert.equal((await share('', null)).status, 409);
  assert.equal(await storedShare(), winner);
  assert.equal((await shareAudit()).length, 1);
  assert.equal((await share('https://tinyurl.com/three', winner)).status, 200);
  assert.equal(await storedShare(), 'https://tinyurl.com/three');
});

test('survey short link and its audit roll back together when audit persistence fails', async () => {
  const failure = new Error('isolated audit failure');
  const query = (tx, sql, values) => {
    if (sql.startsWith('INSERT INTO club_forms.audit')) throw failure;
    return tx.query(sql, values);
  };
  const db = {
    query: (sql, values) => query(f.db, sql, values),
    transaction: (run) =>
      f.db.transaction((tx) =>
        run({
          query: (sql, values) => query(tx, sql, values),
        }),
      ),
  };
  await assert.rejects(
    changeSurveyShareLink(
      db,
      { email: 'officer@example.com' },
      {
        id: f.id,
        shortLink: 'https://tinyurl.com/rolled-back',
        expectedShortLink: null,
      },
    ),
    (error) => error === failure,
  );
  assert.equal(await storedShare(), null);
  assert.deepEqual(await shareAudit(), []);
  assert.equal((await share('https://tinyurl.com/rolled-back')).status, 200);
  assert.equal((await shareAudit()).length, 1);
});

test('survey short link migration grants only its new column and can be reapplied', async () => {
  await f.db.exec('CREATE ROLE club_forms_api');
  try {
    const migration = await readFile(
      new URL('../022_survey_share_link.sql', import.meta.url),
      'utf8',
    );
    await f.db.exec(migration);
    await f.db.exec(migration);
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT has_column_privilege('club_forms_api','club_forms.custom_surveys','short_link','UPDATE') AS link,has_column_privilege('club_forms_api','club_forms.custom_surveys','title','UPDATE') AS title,has_column_privilege('club_forms_api','club_forms.custom_surveys','definition','UPDATE') AS definition",
        )
      ).rows[0],
      { link: true, title: false, definition: false },
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='club_forms' AND table_name='custom_surveys' AND column_name='short_link'",
        )
      ).rows[0],
      { is_nullable: 'YES', column_default: null },
    );
  } finally {
    await f.db.exec('DROP OWNED BY club_forms_api; DROP ROLE club_forms_api');
  }
});

async function shortIO(run) {
  const base = process.env.AUTH_BASE_URL,
    token = process.env.SHORT_IO_API_KEY,
    domain = process.env.SHORT_IO_DOMAIN,
    backup = process.env.TINYURL_API_TOKEN;
  process.env.AUTH_BASE_URL = 'https://office.example.com';
  process.env.SHORT_IO_API_KEY = 'isolated-shortio-key';
  process.env.SHORT_IO_DOMAIN = 'go.dallasai.club';
  delete process.env.TINYURL_API_TOKEN;
  try {
    return await run();
  } finally {
    process.env.AUTH_BASE_URL = base;
    if (token === undefined) delete process.env.SHORT_IO_API_KEY;
    else process.env.SHORT_IO_API_KEY = token;
    if (domain === undefined) delete process.env.SHORT_IO_DOMAIN;
    else process.env.SHORT_IO_DOMAIN = domain;
    if (backup === undefined) delete process.env.TINYURL_API_TOKEN;
    else process.env.TINYURL_API_TOKEN = backup;
  }
}
const generatedPayload = () => {
  const url = new URL(
      '/surveys/#invite=' + privateSurveyToken(f.id),
      process.env.AUTH_BASE_URL,
    ).href,
    alias = 'ai-' + digest(url).slice(0, 24);
  return {
    originalURL: url,
    path: alias,
    secureShortURL: 'https://go.dallasai.club/' + alias,
    archived: false,
    hasPassword: false,
    success: true,
  };
};
const providerResponse = (payload = generatedPayload(), status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const backupPayload = () => {
  const original = generatedPayload();
  return {
    code: 0,
    errors: [],
    data: {
      url: original.originalURL,
      alias: original.path,
      domain: 'tinyurl.com',
      tiny_url: 'https://tinyurl.com/' + original.path,
      deleted: false,
      archived: false,
      expires_at: null,
    },
  };
};
const generate = (fetchImpl, db = f.db) =>
  generateSurveyShareLink(
    db,
    { email: 'officer@example.com' },
    { id: f.id },
    fetchImpl,
  );

test('Short.io generation derives the actual invitation, saves once and preserves survey data', async () => {
  assert.equal((await request('submit', submission())).status, 200);
  const snapshot = async () => {
    const survey = (
      await f.db.query(
        "SELECT to_jsonb(s)-'short_link' AS survey FROM club_forms.custom_surveys s WHERE id=$1",
        [f.id],
      )
    ).rows[0].survey;
    const rows = {};
    for (const table of ['members', 'responses', 'receipts', 'devices'])
      rows[table] = (
        await f.db.query(
          `SELECT to_jsonb(r) AS row FROM club_forms.custom_survey_${table} r WHERE survey_id=$1 ORDER BY to_jsonb(r)::text`,
          [f.id],
        )
      ).rows;
    return {
      survey,
      rows,
      welcome: await (await request('welcome')).json(),
      preview: await (await request('preview')).json(),
    };
  };
  const before = await snapshot();
  await shortIO(async () => {
    const expected = generatedPayload(),
      calls = [];
    process.env.TINYURL_API_TOKEN = 'isolated-tinyurl-token';
    const provider = async (url, options) => {
      calls.push({ url, options });
      return providerResponse();
    };
    const results = await Promise.all([generate(provider), generate(provider)]);
    assert.deepEqual(
      results,
      Array(2).fill({ id: f.id, short_link: expected.secureShortURL }),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.short.io/links');
    const options = calls[0].options;
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'isolated-shortio-key');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), {
      originalURL: expected.originalURL,
      domain: 'go.dallasai.club',
      path: expected.path,
      allowDuplicates: false,
    });
    assert.ok(expected.path.length >= 5 && expected.path.length <= 30);
    assert.equal(await storedShare(), expected.secureShortURL);
    assert.deepEqual(await shareAudit(), [
      {
        actor: 'officer@example.com',
        action: 'custom-survey-share-link:' + f.id,
      },
    ]);
    delete process.env.SHORT_IO_API_KEY;
    assert.deepEqual(
      await generate(() => assert.fail('Retry must reuse the saved URL.')),
      results[0],
    );
  });
  assert.deepEqual(await snapshot(), before);
});

test('Short.io generation preserves a manually saved advisor link without a provider call', async () => {
  const link = 'https://tinyurl.com/advisor-survey';
  assert.equal((await share(link)).status, 200);
  await shortIO(async () => {
    delete process.env.SHORT_IO_API_KEY;
    assert.deepEqual(
      await generate(() => assert.fail('Do not replace the advisor link.')),
      { id: f.id, short_link: link },
    );
  });
  assert.equal(await storedShare(), link);
  assert.equal((await shareAudit()).length, 1);
});

test('Short.io generation rejects unavailable surveys, unconfigured service and supplied destinations', async () => {
  await shortIO(async () => {
    const provider = () =>
      assert.fail('Unavailable surveys must not reach Short.io.');
    for (const state of [
      {
        status: 'draft',
        expires: new Date(Date.now() + 100000),
        digest: digest(f.token),
      },
      {
        status: 'closed',
        expires: new Date(Date.now() + 100000),
        digest: digest(f.token),
      },
      {
        status: 'archived',
        expires: new Date(Date.now() + 100000),
        digest: digest(f.token),
      },
      {
        status: 'open',
        expires: new Date(Date.now() - 1000),
        digest: digest(f.token),
      },
      {
        status: 'open',
        expires: new Date(Date.now() + 100000),
        digest: 'mismatched-digest',
      },
    ]) {
      await f.db.query(
        'UPDATE club_forms.custom_surveys SET status=$2,expires_at=$3,link_digest=$4 WHERE id=$1',
        [f.id, state.status, state.expires, state.digest],
      );
      await assert.rejects(generate(provider), (error) => error.status === 409);
    }
    await f.db.query(
      "UPDATE club_forms.custom_surveys SET status='open',expires_at=now()+interval '30 days',link_digest=$2 WHERE id=$1",
      [f.id, digest(f.token)],
    );
    delete process.env.SHORT_IO_API_KEY;
    await assert.rejects(
      generate(provider),
      (error) => error.status === 503 && /not configured/.test(error.message),
    );
    process.env.SHORT_IO_API_KEY = 'isolated-shortio-key';
    for (const body of [
      {},
      { id: 'invalid' },
      { id: f.id, url: 'https://outside.example.com' },
    ])
      await assert.rejects(
        generateSurveyShareLink(f.db, {}, body, provider),
        (error) => error.status === 400,
      );
    await assert.rejects(
      generateSurveyShareLink(f.db, {}, { id: randomUUID() }, provider),
      (error) => error.status === 404,
    );
    process.env.AUTH_BASE_URL = 'http://office.example.com';
    await assert.rejects(generate(provider), (error) => error.status === 409);
  });
  assert.equal(await storedShare(), null);
  assert.deepEqual(await shareAudit(), []);
});

test('Short.io generation recovers a lost provider acknowledgement through the exact deterministic alias', async () => {
  await shortIO(async () => {
    const payload = generatedPayload(),
      calls = [];
    let created = false;
    const provider = async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') {
        if (created) return providerResponse({}, 409);
        created = true;
        throw new Error(
          'Provider lost acknowledgement: isolated-shortio-key ' +
            payload.originalURL,
        );
      }
      return providerResponse(payload);
    };
    await assert.rejects(
      generate(provider),
      (error) =>
        error.status === 503 &&
        !error.message.includes('isolated-shortio-key') &&
        !error.message.includes('#invite='),
    );
    assert.equal(await storedShare(), null);
    assert.deepEqual(await shareAudit(), []);
    assert.deepEqual(await generate(provider), {
      id: f.id,
      short_link: payload.secureShortURL,
    });
    assert.deepEqual(
      calls.map(({ url, options }) => [url, options.method]),
      [
        ['https://api.short.io/links', 'POST'],
        ['https://api.short.io/links', 'POST'],
        [
          'https://api.short.io/links/expand?domain=go.dallasai.club&path=' +
            payload.path,
          'GET',
        ],
      ],
    );
    assert.equal(calls[1].options.body, calls[0].options.body);
    assert.equal(calls[2].options.signal, calls[1].options.signal);
    assert.equal(calls[2].options.redirect, 'error');
    assert.equal(calls[2].options.body, undefined);
    assert.equal((await shareAudit()).length, 1);
  });
});

test('Short.io generation validates provider destination, alias, availability and result before saving', async () => {
  await shortIO(async () => {
    const changes = [
      { originalURL: 'https://outside.example.com' },
      { path: 'different' },
      { secureShortURL: 'https://outside.example.com/different' },
      { secureShortURL: 'http://go.dallasai.club/different' },
      { hasPassword: true },
      { archived: true },
      { success: false },
      { cloaking: true },
      { androidURL: 'https://outside.example.com' },
      { iphoneURL: 'https://outside.example.com' },
      { splitURL: 'https://outside.example.com' },
      { expiresAt: '2000-01-01T00:00:00Z' },
      { expiresAt: 'invalid-date' },
    ];
    for (const recovery of [false, true])
      for (const change of changes) {
        const payload = generatedPayload();
        Object.assign(payload, change);
        let calls = 0;
        const provider = async () => {
          calls++;
          return recovery && calls === 1
            ? providerResponse({}, 409)
            : providerResponse(payload);
        };
        await assert.rejects(
          generate(provider),
          (error) =>
            error.status === (recovery && change.originalURL ? 409 : 503),
          JSON.stringify(change),
        );
        assert.equal(await storedShare(), null);
        assert.deepEqual(await shareAudit(), []);
      }
    for (const payload of [{ error: 'private failure' }, {}])
      await assert.rejects(
        generate(async () => providerResponse(payload)),
        (error) => error.status === 503,
      );
    for (const status of [401, 405, 429, 503, 302])
      await assert.rejects(
        generate(async () =>
          providerResponse(
            { ...generatedPayload(), extra: 'isolated-shortio-key' },
            status,
          ),
        ),
        (error) =>
          error.status === 503 &&
          !error.message.includes('isolated-shortio-key'),
      );
    await assert.rejects(
      generate(async () => new Response('invalid json')),
      (error) => error.status === 503,
    );
    const payload = generatedPayload();
    payload.expiresAt = new Date(Date.now() + 60000).toISOString();
    assert.equal(
      (await generate(async () => providerResponse(payload))).short_link,
      payload.secureShortURL,
    );
  });
});

test('Short.io provider helper validates shared HTTPS targets and aliases without a database', async () => {
  await shortIO(async () => {
    const target = 'https://dallasai.club/events/game-night/#rsvp';
    for (const alias of [
      null,
      '',
      'four',
      'a'.repeat(31),
      'path/alias',
      'query?alias',
      'space alias',
    ])
      await assert.rejects(
        createShortLink(target, alias, () =>
          assert.fail('Invalid alias must not reach the provider.'),
        ),
        (error) => error.status === 400,
      );
    for (const url of [
      '',
      'http://dallasai.club/events/',
      'https://localhost/a',
      'https://user:password@dallasai.club/',
    ])
      await assert.rejects(
        createShortLink(url, 'dai-event-example', () =>
          assert.fail('Invalid target must not reach the provider.'),
        ),
        (error) => error.status === 400,
      );
    for (const domain of [
      '',
      'localhost',
      'office.local',
      'go.dallasai.club/path',
      'user@go.dallasai.club',
      'go.dallasai.club?query=yes',
    ]) {
      process.env.SHORT_IO_DOMAIN = domain;
      let calls = 0;
      await assert.rejects(
        createShortLink(target, 'dai-event-example', async () => {
          calls++;
          return providerResponse();
        }),
        (error) => error.status === 503,
      );
      assert.equal(calls, 0, domain);
    }
    process.env.SHORT_IO_DOMAIN = 'go.dallasai.club';
    for (const alias of ['abcde', 'dai-event-' + 'a'.repeat(20)]) {
      let calls = 0;
      const link = await createShortLink(
        target,
        alias,
        async (url, options) => {
          calls++;
          assert.equal(url, 'https://api.short.io/links');
          assert.deepEqual(JSON.parse(options.body), {
            originalURL: target,
            domain: 'go.dallasai.club',
            path: alias,
            allowDuplicates: false,
          });
          return providerResponse({
            originalURL: target,
            path: alias,
            secureShortURL: 'https://go.dallasai.club/' + alias,
            hasPassword: false,
            archived: false,
            expiresAt: null,
          });
        },
      );
      assert.equal(link, 'https://go.dallasai.club/' + alias);
      assert.equal(calls, 1);
    }
  });
});

test('Short.io generation refuses persistence if the survey expires during the provider request', async () => {
  await shortIO(async () => {
    await f.db.query(
      "UPDATE club_forms.custom_surveys SET expires_at=now()+interval '1 second' WHERE id=$1",
      [f.id],
    );
    await assert.rejects(
      generate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return providerResponse();
      }),
      (error) => error.status === 409,
    );
    assert.equal(await storedShare(), null);
    assert.deepEqual(await shareAudit(), []);
  });
});

test('Short.io generation times out, rolls back audit failures and recovers provider-created links', async () => {
  await shortIO(async () => {
    const started = Date.now();
    await assert.rejects(
      generate(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
            // AbortSignal.timeout uses an unref'd timer; keep this isolated test alive.
            const timer = setTimeout(
              () => reject(new Error('Timeout guard missing')),
              6500,
            );
            signal.addEventListener('abort', () => clearTimeout(timer), {
              once: true,
            });
          }),
      ),
      (error) => error.status === 503,
    );
    assert.ok(Date.now() - started < 6000);
    assert.equal(await storedShare(), null);
    const failure = new Error('isolated audit failure'),
      payload = generatedPayload();
    let created = false;
    const provider = async (_url, options) => {
      if (options.method === 'GET') return providerResponse(payload);
      if (created) return providerResponse({}, 409);
      created = true;
      return providerResponse(payload);
    };
    const query = (tx, sql, values) => {
      if (sql.startsWith('INSERT INTO club_forms.audit')) throw failure;
      return tx.query(sql, values);
    };
    const db = {
      query: (sql, values) => query(f.db, sql, values),
      transaction: (run) =>
        f.db.transaction((tx) =>
          run({ query: (sql, values) => query(tx, sql, values) }),
        ),
    };
    await assert.rejects(generate(provider, db), (error) => error === failure);
    assert.equal(await storedShare(), null);
    assert.deepEqual(await shareAudit(), []);
    assert.equal((await generate(provider)).short_link, payload.secureShortURL);
    assert.equal((await shareAudit()).length, 1);
  });
});

test('Short.io generation endpoint sends only the saved link and sanitizes provider errors without logging secrets', async () => {
  await shortIO(async () => {
    let failProvider = false,
      result;
    const handler = customSurveysHandler({
      authorize: f.authorize,
      getDatabase: () => f.db,
      generateShareLink: (db, actor, body) =>
        generateSurveyShareLink(db, actor, body, async () => {
          if (failProvider)
            throw new Error(
              'isolated-shortio-key ' + generatedPayload().originalURL,
            );
          return providerResponse();
        }),
    });
    const req = {
        method: 'POST',
        url: '/api/custom-surveys?action=generate-share-link',
        headers: {
          cookie: 'test-officer=yes',
          origin: process.env.AUTH_BASE_URL,
          'content-type': 'application/json',
        },
        body: { id: f.id },
      },
      res = {
        setHeader() {},
        end(value) {
          result = JSON.parse(value);
        },
      };
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(result, {
      id: f.id,
      short_link: generatedPayload().secureShortURL,
    });
    await f.db.query(
      'UPDATE club_forms.custom_surveys SET short_link=NULL WHERE id=$1',
      [f.id],
    );
    failProvider = true;
    const original = console.error,
      logged = [];
    console.error = (...args) => logged.push(args);
    try {
      await handler(req, res);
    } finally {
      console.error = original;
    }
    assert.equal(res.statusCode, 503);
    assert.deepEqual(logged, []);
    assert.ok(!JSON.stringify(result).includes('isolated-shortio-key'));
    assert.ok(!JSON.stringify(result).includes('#invite='));
  });
});

test('short-link generation falls back to TinyURL for unavailable Short.io without changing a conflicting destination', async () => {
  await shortIO(async () => {
    process.env.TINYURL_API_TOKEN = 'isolated-tinyurl-token';
    for (const failure of ['configuration', 'http', 'collision', 'transport']) {
      process.env.SHORT_IO_API_KEY = 'isolated-shortio-key';
      if (failure === 'configuration') delete process.env.SHORT_IO_API_KEY;
      const calls = [],
        expected = backupPayload();
      const provider = async (url, options) => {
        calls.push({ url, options });
        if (url.startsWith('https://api.short.io/')) {
          if (failure === 'transport') throw new Error('isolated-shortio-key');
          if (failure === 'collision')
            return options.method === 'POST'
              ? providerResponse({}, 409)
              : providerResponse({
                  ...generatedPayload(),
                  originalURL: 'https://outside.example.com',
                });
          return providerResponse({}, 503);
        }
        assert.equal(url, 'https://api.tinyurl.com/create');
        assert.equal(
          options.headers.Authorization,
          'Bearer isolated-tinyurl-token',
        );
        assert.equal(options.redirect, 'error');
        assert.deepEqual(JSON.parse(options.body), {
          url: expected.data.url,
          domain: 'tinyurl.com',
          alias: expected.data.alias,
        });
        return providerResponse(expected);
      };
      assert.equal(
        (await generate(provider)).short_link,
        expected.data.tiny_url,
        failure,
      );
      assert.equal(
        calls.filter(({ url }) => url.startsWith('https://api.tinyurl.com/'))
          .length,
        1,
      );
      assert.ok(
        calls.every(({ options }) => ['GET', 'POST'].includes(options.method)),
      );
      assert.equal((await shareAudit()).length, 1);
      assert.deepEqual(
        await generate(() =>
          assert.fail('Saved fallback must bypass both providers.'),
        ),
        { id: f.id, short_link: expected.data.tiny_url },
      );
      await f.db.query(
        'UPDATE club_forms.custom_surveys SET short_link=NULL WHERE id=$1',
        [f.id],
      );
      await f.db.query('DELETE FROM club_forms.audit WHERE action=$1', [
        'custom-survey-share-link:' + f.id,
      ]);
    }
  });
});

test('short-link generation retries lost Short.io acknowledgements with native path idempotency', async () => {
  await shortIO(async () => {
    process.env.TINYURL_API_TOKEN = 'isolated-tinyurl-token';
    let created = false;
    const bodies = [],
      payload = generatedPayload();
    const provider = async (url, options) => {
      if (url.startsWith('https://api.tinyurl.com/'))
        return providerResponse({}, 503);
      assert.equal(url, 'https://api.short.io/links');
      bodies.push(options.body);
      if (!created) {
        created = true;
        throw new Error('lost Short.io acknowledgement');
      }
      return providerResponse({ ...payload, duplicate: true });
    };
    await assert.rejects(generate(provider), (error) => error.status === 503);
    assert.equal(await storedShare(), null);
    assert.deepEqual(await shareAudit(), []);
    assert.equal((await generate(provider)).short_link, payload.secureShortURL);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.equal((await shareAudit()).length, 1);
  });
});

test('short-link generation retries lost TinyURL acknowledgements using the same verified backup alias', async () => {
  await shortIO(async () => {
    delete process.env.SHORT_IO_API_KEY;
    process.env.TINYURL_API_TOKEN = 'isolated-tinyurl-token';
    const payload = backupPayload(),
      calls = [];
    let created = false;
    const provider = async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'GET') return providerResponse(payload);
      if (created) return providerResponse({}, 422);
      created = true;
      throw new Error('lost TinyURL acknowledgement');
    };
    await assert.rejects(generate(provider), (error) => error.status === 503);
    assert.equal(await storedShare(), null);
    assert.equal((await generate(provider)).short_link, payload.data.tiny_url);
    assert.deepEqual(
      calls.map(({ url, options }) => [url, options.method]),
      [
        ['https://api.tinyurl.com/create', 'POST'],
        ['https://api.tinyurl.com/create', 'POST'],
        [
          'https://api.tinyurl.com/alias/tinyurl.com/' + payload.data.alias,
          'GET',
        ],
      ],
    );
    assert.equal(calls[0].options.body, calls[1].options.body);
    assert.equal(calls[1].options.signal, calls[2].options.signal);
    assert.equal((await shareAudit()).length, 1);
  });
});

test('short-link generation leaves data intact when both providers fail or TinyURL returns the wrong destination', async () => {
  await shortIO(async () => {
    process.env.TINYURL_API_TOKEN = 'isolated-tinyurl-token';
    for (const invalid of [false, true]) {
      const payload = backupPayload();
      payload.data.url = 'https://outside.example.com';
      const provider = async (url) =>
        url.startsWith('https://api.short.io/')
          ? providerResponse({}, 503)
          : providerResponse(payload, invalid ? 200 : 503);
      await assert.rejects(
        generate(provider),
        (error) =>
          error.status === 503 &&
          !error.message.includes('isolated-tinyurl-token') &&
          !error.message.includes('#invite='),
      );
      assert.equal(await storedShare(), null);
      assert.deepEqual(await shareAudit(), []);
    }
  });
});

test('alias conflicts remain ambiguous when another configured provider loses its acknowledgement', async () => {
  await shortIO(async () => {
    process.env.TINYURL_API_TOKEN = 'isolated-tinyurl-token';
    for (const uncertain of ['shortio', 'tinyurl', 'neither']) {
      await assert.rejects(
        generate(async (url, options) => {
          const shortio = url.startsWith('https://api.short.io/');
          if (uncertain === (shortio ? 'shortio' : 'tinyurl'))
            throw Error('Lost acknowledgement');
          if (options.method === 'POST')
            return providerResponse({}, shortio ? 409 : 422);
          const payload = shortio ? generatedPayload() : backupPayload();
          if (shortio) payload.originalURL = 'https://outside.example.com';
          else payload.data.url = 'https://outside.example.com';
          return providerResponse(payload);
        }),
        { status: uncertain === 'neither' ? 409 : 503 },
      );
      assert.equal(await storedShare(), null);
      assert.deepEqual(await shareAudit(), []);
    }
  });
});

test('TinyURL reports an occupied path only after verifying the exact alias destination', async () => {
  await shortIO(async () => {
    delete process.env.SHORT_IO_API_KEY;
    process.env.TINYURL_API_TOKEN = 'isolated-tinyurl-token';
    const payload = backupPayload();
    payload.data.url = 'https://outside.example.com';
    const calls = [];
    await assert.rejects(
      generate(async (url, options) => {
        calls.push([url, options.method]);
        return options.method === 'POST'
          ? providerResponse({}, 422)
          : providerResponse(payload);
      }),
      { status: 409 },
    );
    assert.deepEqual(calls, [
      ['https://api.tinyurl.com/create', 'POST'],
      [
        'https://api.tinyurl.com/alias/tinyurl.com/' + payload.data.alias,
        'GET',
      ],
    ]);
    assert.equal(await storedShare(), null);
    assert.deepEqual(await shareAudit(), []);
  });
});

test('short-link generation bounds both provider attempts to one eight-second deadline', async () => {
  await shortIO(async () => {
    process.env.TINYURL_API_TOKEN = 'isolated-tinyurl-token';
    const started = Date.now(),
      calls = [];
    await assert.rejects(
      generate(
        (url, { signal }) =>
          new Promise((_resolve, reject) => {
            calls.push(url);
            const timer = setTimeout(
              () => reject(new Error('Deadline missing')),
              9500,
            );
            const abort = () => {
              clearTimeout(timer);
              reject(signal.reason);
            };
            if (signal.aborted) abort();
            else signal.addEventListener('abort', abort, { once: true });
          }),
      ),
      (error) => error.status === 503,
    );
    assert.deepEqual(calls, [
      'https://api.short.io/links',
      'https://api.tinyurl.com/create',
    ]);
    assert.ok(Date.now() - started < 9000);
    assert.equal(await storedShare(), null);
    assert.deepEqual(await shareAudit(), []);
  });
});

test('TinyURL backup validates its exact destination, alias, availability and result before saving', async () => {
  await shortIO(async () => {
    delete process.env.SHORT_IO_API_KEY;
    process.env.TINYURL_API_TOKEN = 'isolated-tinyurl-token';
    for (const change of [
      { url: 'https://outside.example.com' },
      { domain: 'outside.example.com' },
      { alias: 'different' },
      { tiny_url: 'https://tinyurl.com/different' },
      { deleted: true },
      { archived: true },
      { expires_at: '2000-01-01T00:00:00Z' },
      { expires_at: 'invalid-date' },
      { expires_at: undefined },
    ]) {
      const payload = backupPayload();
      Object.assign(payload.data, change);
      await assert.rejects(
        generate(async () => providerResponse(payload)),
        (error) => error.status === 503,
        JSON.stringify(change),
      );
      assert.equal(await storedShare(), null);
    }
    for (const payload of [
      { ...backupPayload(), code: 7 },
      { ...backupPayload(), errors: ['private failure'] },
      { ...backupPayload(), errors: '' },
    ])
      await assert.rejects(
        generate(async () => providerResponse(payload)),
        (error) => error.status === 503,
      );
    for (const status of [401, 405, 429, 503, 302])
      await assert.rejects(
        generate(async () => providerResponse(backupPayload(), status)),
        (error) => error.status === 503,
      );
    assert.deepEqual(await shareAudit(), []);
  });
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
