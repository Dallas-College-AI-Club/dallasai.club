import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { submit } from '../lib/submissions.mjs';
import { validate, validateFiles } from '../lib/validation.mjs';
import { signToken, verifyToken } from '../lib/tokens.mjs';
import { manageEntry } from '../lib/manage.mjs';
import { drainOutbox, receipt } from '../lib/mail.mjs';
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
});
beforeEach(async () => {
  await db.exec(
    'TRUNCATE club_forms.entries,club_forms.rate_limits RESTART IDENTITY CASCADE',
  );
});
after(async () => {
  await db.close();
});
test('new signup and its alert are committed together; duplicate signup creates one member and alert', async () => {
  const first = await submit(db, entry(), []),
    second = await submit(db, entry(), []);
  assert.equal(first.id, second.id);
  assert.equal(first.email, 'student@example.com');
  const jobs = (
    await db.query('SELECT kind FROM club_forms.outbox ORDER BY kind')
  ).rows;
  assert.deepEqual(
    jobs.map((x) => x.kind),
    ['notify', 'receipt'],
  );
});
test('database inserts also create an officer notification, and rollbacks leave neither record nor alert', async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO club_forms.entries(id,kind,email,dedupe_key) VALUES($1,'join','a@example.com','direct')",
        [randomUUID()],
      );
      throw new Error('rollback');
    }),
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.outbox')).rows[0]
      .n,
    0,
  );
  await db.query(
    "INSERT INTO club_forms.entries(id,kind,email,dedupe_key) VALUES($1,'join','a@example.com','direct')",
    [randomUUID()],
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.outbox')).rows[0]
      .n,
    1,
  );
});
test('newsletter stays pending until confirmation; unsubscribe prevents an old confirmation from resubscribing', async () => {
  const row = await submit(db, entry('subscribe'), []);
  assert.equal(row.state, 'pending');
  const signed = verifyToken(signToken(row.id, 'confirm'));
  await manageEntry(db, signed);
  assert.equal(
    (await db.query('SELECT state FROM club_forms.entries')).rows[0].state,
    'active',
  );
  await manageEntry(db, { id: row.id, action: 'unsubscribe' });
  await assert.rejects(manageEntry(db, { ...signed, iat: 1 }), /cancelled/);
  assert.equal(
    (await db.query('SELECT state FROM club_forms.entries')).rows[0].state,
    'unsubscribed',
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
  await manageEntry(db, { id: row.id, action: 'cancel' });
  assert.equal(
    (await db.query('SELECT state FROM club_forms.entries')).rows[0].state,
    'cancelled',
  );
});
test('an email outage leaves saved data and retryable alerts; retry does not resend completed jobs', async () => {
  await submit(db, entry(), []);
  const failed = await drainOutbox(db, async () => {
    throw new Error('provider down');
  });
  assert.equal(failed.failed, 2);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.entries'))
      .rows[0].n,
    1,
  );
  await db.query('UPDATE club_forms.outbox SET available_at=now()');
  let calls = 0;
  assert.equal(
    (
      await drainOutbox(db, async () => {
        calls++;
      })
    ).sent,
    2,
  );
  await drainOutbox(db, async () => {
    calls++;
  });
  assert.equal(calls, 2);
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
test('tokens reject alteration, wrong actions and expiry; retrying an email generates identical content', () => {
  const id = randomUUID(),
    now = Date.now(),
    token = signToken(id, 'confirm', 60, now);
  assert.equal(verifyToken(token, now).id, id);
  assert.throws(() => verifyToken(token + 'x', now), /invalid/);
  assert.throws(() => verifyToken(token, now + 61000), /expired/);
  const row = {
    id,
    kind: 'join',
    name: 'A',
    email: 'a@example.com',
    state: 'pending',
  };
  assert.deepEqual(receipt(row, now), receipt(row, now));
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
