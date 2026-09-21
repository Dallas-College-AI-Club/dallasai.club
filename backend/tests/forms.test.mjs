import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { submit } from '../lib/submissions.mjs';
import { validate, validateFiles } from '../lib/validation.mjs';
import { limit, cors, jsonBody } from '../lib/http.mjs';
import { csvCell } from '../api/admin.mjs';
let db;
process.env.FORM_TOKEN_SECRET = 'test-only-' + 's'.repeat(40);
const entry = (kind = 'join', extra = {}) => ({
  kind,
  email: 'Student@Example.com',
  name: 'Test Student',
  campus: 'Richland',
  consent: true,
  requestId: randomUUID(),
  ...extra,
});
before(async () => {
  db = new PGlite();
  await db.exec(
    await readFile(new URL('../003_club_forms.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    await readFile(
      new URL('../005_screen_confirmations.sql', import.meta.url),
      'utf8',
    ),
  );
});
beforeEach(async () => {
  await db.exec(
    'TRUNCATE club_forms.entries,club_forms.rate_limits RESTART IDENTITY CASCADE',
  );
});
after(async () => {
  await db.close();
});
test('all five forms save immediately without email configuration or email jobs', async (t) => {
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    networkCalls++;
    throw new Error('Email must not be sent');
  });
  const events = [{ id: 'future', date: '2099-09-24', title: 'Workshop' }];
  for (const [kind, extra] of [
    ['join', {}],
    ['subscribe', {}],
    ['rsvp', { eventId: 'future' }],
    ['contribution', { title: 'A draft', body: 'Draft text' }],
    ['workshop', { topic: 'AI and art' }],
  ]) {
    const row = await submit(db, entry(kind, extra), events);
    assert.equal(row.state, 'active');
    assert.equal(row.review_status, 'new');
    assert.equal(row.email_verified, false);
  }
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.entries'))
      .rows[0].n,
    5,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.outbox')).rows[0]
      .n,
    0,
  );
  assert.equal(networkCalls, 0);
});
test('duplicate signup saves one member; trusted database inserts appear as New without email jobs', async () => {
  const first = await submit(db, entry(), []),
    second = await submit(db, entry(), []);
  assert.equal(first.id, second.id);
  assert.equal(first.email, 'student@example.com');
  await db.query(
    "INSERT INTO club_forms.entries(id,kind,email,dedupe_key) VALUES($1,'join','a@example.com','direct')",
    [randomUUID()],
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM club_forms.entries WHERE review_status='new'",
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.outbox')).rows[0]
      .n,
    0,
  );
});
test('transaction failures leave no partial submission', async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO club_forms.entries(id,kind,email,dedupe_key) VALUES($1,'join','a@example.com','rollback')",
        [randomUUID()],
      );
      throw new Error('rollback');
    }),
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.entries'))
      .rows[0].n,
    0,
  );
});
test('RSVP validates the server event registry and deduplicates per event and email', async () => {
  const events = [
    { id: 'future', date: '2099-09-24T17:00:00-05:00', title: 'Workshop' },
  ];
  const body = entry('rsvp', { eventId: 'future' });
  const row = await submit(db, body, events);
  assert.equal(
    row.id,
    (await submit(db, { ...body, requestId: randomUUID() }, events)).id,
  );
  assert.throws(
    () => validate({ ...body, eventId: 'invented' }, events),
    /unavailable/,
  );
  assert.throws(
    () => validate(body, [{ ...events[0], date: '2000-01-01' }]),
    /unavailable/,
  );
});
test('consent, body types, email, attachment limits and file signatures are checked on the server', () => {
  assert.throws(() => validate(entry('join', { consent: false })), /consent/);
  assert.throws(
    () => validate(entry('join', { email: 'bad\r\nemail' })),
    /valid email/,
  );
  assert.throws(
    () => validate(entry('join', { name: { text: 'name' } })),
    /name/,
  );
  assert.throws(
    () =>
      validateFiles([
        {
          name: 'fake.pdf',
          content: Buffer.from('not a PDF').toString('base64'),
        },
      ]),
    /file type/,
  );
  assert.throws(
    () =>
      validateFiles([
        {
          name: 'large.txt',
          content: Buffer.alloc(2097153, 65).toString('base64'),
        },
      ]),
    /2 MB/,
  );
  assert.throws(
    () => validateFiles([{ name: '../test.txt', content: 'YQ==' }]),
    /slashes/,
  );
});
test('upload failure does not create a partial submission and uploaded files are cleaned up', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  let puts = 0,
    deleted = [];
  const storage = {
    put: async (pathname) => {
      if (++puts === 2) throw new Error('upload failed');
      return { pathname };
    },
    del: async (paths) => {
      deleted = paths;
    },
  };
  await assert.rejects(
    submit(
      db,
      entry('contribution', {
        title: 'A draft',
        body: 'Text',
        files: [
          { name: 'a.txt', content: 'YQ==' },
          { name: 'b.txt', content: 'Yg==' },
        ],
      }),
      [],
      storage,
    ),
    /upload failed/,
  );
  assert.equal(deleted.length, 1);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.entries'))
      .rows[0].n,
    0,
  );
  delete process.env.BLOB_READ_WRITE_TOKEN;
});
test('private attachments are linked to a submission and retrying a request does not upload twice', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  let calls = 0;
  const storage = {
    put: async (pathname, bytes, options) => {
      assert.equal(options.access, 'private');
      calls++;
      return { pathname };
    },
    del: async () => {},
  };
  const body = entry('contribution', {
    title: 'A draft',
    files: [{ name: 'a.txt', content: 'YQ==' }],
  });
  await submit(db, body, [], storage);
  await submit(db, body, [], storage);
  assert.equal(calls, 1);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.attachments'))
      .rows[0].n,
    1,
  );
  delete process.env.BLOB_READ_WRITE_TOKEN;
});
test('persistent request quota applies across invocations and CSV cells cannot execute spreadsheet formulas', async () => {
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  await limit(db, req, 'test', 2);
  await limit(db, req, 'test', 2);
  await assert.rejects(limit(db, req, 'test', 2), /Too many/);
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('normal'), '"normal"');
});
test('untrusted origins and oversized parsed bodies are rejected', async () => {
  assert.throws(
    () =>
      cors(
        { headers: { origin: 'https://evil.example' }, method: 'POST' },
        { setHeader() {} },
      ),
    /not allowed/,
  );
  await assert.rejects(
    jsonBody(
      {
        headers: { 'content-type': 'application/json' },
        body: { message: 'x'.repeat(100) },
      },
      20,
    ),
    /too large/,
  );
});
