import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { adminHandler } from '../api/admin.mjs';
import { eventHandler } from '../api/events.mjs';
import { surveysHandler } from '../api/surveys.mjs';
import { customSurveysHandler } from '../api/custom-surveys.mjs';
import { transaction } from '../lib/db.mjs';
import { fail, jsonBody } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { testDatabase } from './helpers/db.mjs';

test('a failed ROLLBACK keeps the original error and destroys the connection', async () => {
  const released = [];
  const client = {
    query: async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('connection lost');
    },
    release: (error) => released.push(error),
  };
  const original = new RequestError(409, 'This changed.');
  await assert.rejects(
    transaction({ connect: async () => client }, async () => {
      throw original;
    }),
    (error) => error === original,
  );
  assert.equal(released.length, 1);
  assert.equal(released[0]?.message, 'connection lost');
});

test('a successful ROLLBACK returns the connection to the pool', async () => {
  const released = [];
  const client = { query: async () => {}, release: (e) => released.push(e) };
  await assert.rejects(
    transaction({ connect: async () => client }, async () => {
      throw new Error('stop');
    }),
  );
  assert.deepEqual(released, [undefined]);
});

test('a body the platform cannot parse is a 400, not a server error', async () => {
  const req = {
    headers: { 'content-type': 'application/json' },
    get body() {
      throw new SyntaxError('Unexpected token');
    },
  };
  await assert.rejects(
    jsonBody(req),
    (error) => error instanceof RequestError && error.status === 400,
  );
});

test('an error after streaming started closes the response', () => {
  let destroyed = false;
  const res = {
    headersSent: true,
    destroy: () => (destroyed = true),
    setHeader: () => assert.fail('headers were already sent'),
  };
  fail(res, new Error('storage dropped'));
  assert.equal(destroyed, true);
});

const captured = () => ({
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
  },
  end(body) {
    this.body = JSON.parse(body);
  },
});
test('request errors carry their details; unexpected errors get only a logged reference', (t) => {
  const res = captured();
  const current = { status: 'closed', actor: 'officer@example.com', at: null };
  fail(res, new RequestError(409, 'Changed.', { code: 'stale', current }));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'Changed.', code: 'stale', current });
  const logged = t.mock.method(console, 'error', () => {});
  const unexpected = captured();
  const error = new Error('student@example.edu could not be saved');
  error.code = '23505';
  fail(unexpected, error);
  assert.equal(unexpected.statusCode, 503);
  assert.deepEqual(Object.keys(unexpected.body).sort(), ['error', 'reference']);
  assert.match(unexpected.body.reference, /^[0-9a-f]{8}$/);
  assert.equal(logged.mock.callCount(), 1);
  const [, details] = logged.mock.calls[0].arguments;
  assert.deepEqual(details, {
    reference: unexpected.body.reference,
    code: '23505',
  });
  assert.ok(!JSON.stringify(logged.mock.calls).includes('example.edu'));
});

test('a body over the size limit gets a generic message before it is read', async () => {
  const req = {
    headers: { 'content-type': 'application/json', 'content-length': '21' },
    [Symbol.asyncIterator]: () => assert.fail('the body was read'),
  };
  await assert.rejects(
    jsonBody(req, 20),
    (error) =>
      error.status === 413 && error.message === 'This submission is too large.',
  );
});

// Club Office retries a request once after the officer signs in again. That is
// only safe while every admin handler authorizes before it writes anything.
test('an admin POST rejected with 401 writes nothing, in every admin handler', async () => {
  const store = await testDatabase();
  process.env.AUTH_BASE_URL = 'https://office.example.com';
  process.env.FORM_TOKEN_SECRET = 'reauth-retry-test-' + 'x'.repeat(40);
  const entry = randomUUID(),
    rsvp = randomUUID(),
    survey = randomUUID();
  await store.query(
    "INSERT INTO club_forms.entries(id,kind,email,name,data,dedupe_key) VALUES($1,'workshop','member@example.edu','Member','{}',$2)",
    [entry, 'workshop:' + entry],
  );
  await store.query(
    "INSERT INTO club_forms.entries(id,kind,email,name,data,dedupe_key) VALUES($1,'rsvp','member@example.edu','Member','{\"eventId\":\"next\"}',$2)",
    [rsvp, 'rsvp:next:member@example.edu'],
  );
  await store.query(
    "INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at) VALUES($1,'roster-test','Roster test','test','draft',$2,now()+interval '30 days')",
    [survey, 'test-link-' + survey],
  );
  // Row counts and a digest of every club_forms table, so updates show too.
  const snapshot = async () => {
    const tables = (
      await store.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='club_forms' ORDER BY 1",
      )
    ).rows.map((r) => r.tablename);
    const state = {};
    for (const table of tables)
      state[table] = (
        await store.query(
          `SELECT count(*)::int AS n,md5(coalesce(string_agg(t::text,'|' ORDER BY t::text),'')) AS digest FROM club_forms.${table} t`,
        )
      ).rows[0];
    return state;
  };
  const handlers = (authorize) => {
    const shared = { getDatabase: () => store, authorize };
    return {
      admin: adminHandler({ ...shared, getEvents: async () => [] }),
      events: eventHandler({ ...shared, originals: [] }),
      surveys: surveysHandler(shared),
      custom: customSurveysHandler(shared),
    };
  };
  const writes = [
    ['admin', '/api/admin', { action: 'review', id: entry, status: 'closed' }],
    [
      'admin',
      '/api/admin',
      { action: 'review', status: 'reviewed', items: [{ id: entry }] },
    ],
    [
      'admin',
      '/api/admin',
      {
        action: 'review-kinds',
        kinds: ['rsvp'],
        from: 'new',
        status: 'reviewed',
        before: '2999-01-01T00:00:00Z',
      },
    ],
    ['admin', '/api/admin', { action: 'state', id: rsvp, state: 'cancelled' }],
    [
      'admin',
      '/api/admin',
      {
        action: 'comment',
        id: entry,
        commentId: randomUUID(),
        comment: 'Called back',
      },
    ],
    ['events', '/api/events', { action: 'add-type', name: 'Robot lab night' }],
    [
      'surveys',
      '/api/surveys',
      {
        action: 'contact-note',
        email: 'member@example.edu',
        noteId: randomUUID(),
        note: 'Called back',
      },
    ],
    [
      'custom',
      '/api/custom-surveys?action=draft-change',
      {
        id: randomUUID(),
        requestId: randomUUID(),
        expectedRevision: 0,
        action: 'save',
        definition: {
          template: 'blank',
          title: 'Draft',
          intro: '',
          audience: 'students',
          permissions: {
            preview: 'link',
            answer: 'invited',
            results: 'admins',
          },
          durationDays: 30,
          questions: [],
        },
      },
    ],
    [
      'custom',
      '/api/custom-surveys?action=member-change',
      {
        surveyId: survey,
        action: 'add',
        name: 'New Advisor',
        email: 'advisor@example.com',
        expectedRevision: 0,
        requestId: randomUUID(),
      },
    ],
  ];
  const send = async (handler, url, body) => {
    const res = {
      setHeader() {},
      end(text) {
        this.body = text;
      },
    };
    await handler(
      {
        method: 'POST',
        url,
        headers: {
          origin: 'https://office.example.com',
          'content-type': 'application/json',
        },
        body,
      },
      res,
    );
    return res;
  };
  try {
    const signedOut = handlers(async () => {
      throw new RequestError(401, 'Sign in');
    });
    const before = await snapshot();
    for (const [name, url, body] of writes)
      assert.equal((await send(signedOut[name], url, body)).statusCode, 401);
    assert.deepEqual(await snapshot(), before);
    // Control: the same requests do write once the officer is signed in.
    const signedIn = handlers(async () => ({ email: 'officer@example.com' }));
    for (const [name, url, body] of writes) {
      const start = await snapshot();
      const res = await send(signedIn[name], url, body);
      assert.equal(res.statusCode, 200, res.body);
      assert.notDeepEqual(await snapshot(), start, url);
    }
  } finally {
    await store.close();
  }
});

let db, server, origin, settled;
const entryId = randomUUID(),
  fileId = randomUUID(),
  chunks = 40;
const slowFile = () => {
  let sent = 0;
  return new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (sent++ === chunks) controller.close();
      else controller.enqueue(new Uint8Array(1024).fill(65));
    },
  });
};
before(async () => {
  db = await testDatabase();
  await db.query(
    `INSERT INTO club_forms.entries(id,kind,email,name,data,dedupe_key,state)
     VALUES($1,'contribution','writer@example.edu','Writer','{}',$2,'active')`,
    [entryId, 'contribution:' + entryId],
  );
  await db.query(
    `INSERT INTO club_forms.attachments(id,entry_id,name,pathname,content_type,size)
     VALUES($1,$2,'draft notes.pdf','private/draft.pdf','application/pdf',$3)`,
    [fileId, entryId, chunks * 1024],
  );
  const handler = adminHandler({
    getDatabase: () => db,
    authorize: async () => ({ email: 'officer@example.com' }),
    getEvents: async () => [],
    storage: { get: async () => ({ statusCode: 200, stream: slowFile() }) },
  });
  server = http.createServer((req, res) => {
    settled = 'pending';
    handler(req, res).then(
      () => (settled = 'settled'),
      () => (settled = 'settled'),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

test('officers download attachments in full and each download is audited', async () => {
  const response = await fetch(origin + '/api/admin?attachment=' + fileId);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'application/octet-stream',
  );
  assert.match(
    response.headers.get('content-disposition'),
    /filename\*=UTF-8''draft%20notes\.pdf/,
  );
  assert.equal((await response.arrayBuffer()).byteLength, chunks * 1024);
  const audit = await db.query(
    `SELECT actor FROM club_forms.audit WHERE entry_id=$1 AND action='download-attachment'`,
    [entryId],
  );
  assert.deepEqual(audit.rows, [{ actor: 'officer@example.com' }]);
});

test('a download the officer cancels does not leave the function running', async () => {
  await new Promise((resolve, reject) => {
    const request = http.get(
      origin + '/api/admin?attachment=' + fileId,
      (response) => response.once('data', () => request.destroy()),
    );
    request.on('close', resolve);
    request.on('error', (error) =>
      error.code === 'ECONNRESET' ? resolve() : reject(error),
    );
  });
  const deadline = Date.now() + 1000;
  while (settled === 'pending' && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, 'settled');
});
