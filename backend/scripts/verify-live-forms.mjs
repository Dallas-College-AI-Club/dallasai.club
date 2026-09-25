// Explicit live integration check. Uses only the supplied approved test account.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { del } from '@vercel/blob';
const directory = path.join(process.env.LOCALAPPDATA, 'dallasai-club-website');
const text = await fs.readFile(
  path.join(directory, 'secrets.env.forms'),
  'utf8',
);
const settings = Object.fromEntries(
  text
    .split(/\r?\n/)
    .filter((x) => x.includes('='))
    .map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]),
);
const email = (process.argv[2] || '').trim().toLowerCase();
const credentials = JSON.parse(
  await fs.readFile(path.join(directory, 'admin-access.json'), 'utf8'),
).accounts.find((x) => x.email === email);
if (!email || !credentials)
  throw Error(
    'Supply an approved test account with private local credentials.',
  );
const origin = 'http://127.0.0.1:4175';
const pool = new pg.Pool({
  connectionString: settings.FORMS_DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
const run = 'integration-' + randomUUID();
let service,
  cookie = '';
const ids = [],
  blobs = [];
const request = (route, body, session = cookie, source = origin) =>
  fetch(origin + route, {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: {
      ...(body ? { 'Content-Type': 'application/json', Origin: source } : {}),
      ...(session ? { Cookie: session } : {}),
    },
  });
try {
  const existing = await pool.query(
    'SELECT id FROM club_forms.entries WHERE email=$1',
    [email],
  );
  if (existing.rows.length)
    throw Error(
      'Test account already has submissions. Existing records were left untouched.',
    );
  if (
    await fetch(origin + '/api/auth/get-session')
      .then(() => true)
      .catch(() => false)
  )
    throw Error('Local test port is already in use.');
  service = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      ...settings,
      AUTH_BASE_URL: origin,
      ADMIN_EMAILS: email,
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    if (
      await fetch(origin + '/api/auth/get-session')
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal((await request('/api/admin', null, '')).status, 401);
  const login = await request(
    '/api/auth/sign-in/email',
    { email, password: credentials.password },
    '',
  );
  assert.equal(login.status, 200, 'Password login failed');
  cookie = login.headers
    .getSetCookie()
    .map((x) => x.split(';')[0])
    .join('; ');
  assert.ok(cookie, 'Missing login cookie');
  const before = await (await request('/api/admin')).json();
  const events = JSON.parse(
    await fs.readFile(
      new URL('../generated/events.json', import.meta.url),
      'utf8',
    ),
  );
  const event = events.find((x) => new Date(x.end || x.date) > new Date());
  if (!event)
    throw Error('A future event is required for the live RSVP check.');
  const cases = [
    ['join', { campus: 'Richland', interests: run }],
    ['subscribe', {}],
    ['rsvp', { eventId: event.id }],
    [
      'contribution',
      {
        title: run,
        body: 'Temporary integration test',
        files: [
          { name: 'test.txt', content: Buffer.from(run).toString('base64') },
        ],
      },
    ],
    ['workshop', { topic: run, details: 'Temporary integration test' }],
  ];
  for (const [kind, extra] of cases) {
    const body = {
      kind,
      email,
      name: run,
      consent: true,
      requestId: randomUUID(),
      ...extra,
    };
    const response = await request(
      '/api/forms',
      body,
      '',
      'http://127.0.0.1:4174',
    );
    assert.equal(response.status, 200, kind + ' submission failed');
    const result = await response.json();
    assert.ok(
      result.message &&
        !/check your email|confirmation link/i.test(result.message),
    );
    const row = (
      await pool.query(
        'SELECT * FROM club_forms.entries WHERE email=$1 AND kind=$2',
        [email, kind],
      )
    ).rows[0];
    assert.ok(row, kind + ' was not stored');
    ids.push(row.id);
    assert.equal(row.state, 'active');
    assert.equal(row.email_verified, false);
    assert.equal(row.review_status, 'new');
    if (kind === 'contribution') {
      const attachment = (
        await pool.query(
          'SELECT * FROM club_forms.attachments WHERE entry_id=$1',
          [row.id],
        )
      ).rows[0];
      blobs.push(attachment.pathname);
      assert.equal(
        (await request('/api/admin?attachment=' + attachment.id, null, ''))
          .status,
        401,
      );
      const download = await request('/api/admin?attachment=' + attachment.id);
      assert.equal(download.status, 200);
      assert.equal(await download.text(), run);
    }
  }
  const inbox = await (await request('/api/admin')).json();
  for (const [kind] of cases)
    assert.equal(
      inbox.counts.find((x) => x.kind === kind).new,
      (before.counts.find((x) => x.kind === kind)?.new || 0) + 1,
    );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM club_forms.outbox WHERE entry_id=ANY($1::uuid[])',
        [ids],
      )
    ).rows[0].n,
    0,
  );
  const review = await request('/api/admin', {
    action: 'review',
    id: ids[0],
    status: 'reviewed',
  });
  assert.equal(review.status, 200);
  const csv = await request(
    '/api/admin?export=csv&search=' + encodeURIComponent(email),
  );
  assert.equal(csv.status, 200);
  assert.ok((await csv.text()).includes(email));
  await request('/api/auth/sign-out', {});
  assert.equal((await request('/api/admin')).status, 401);
  cookie = '';
  console.log(
    'Live checks passed: designated account login/signout, five Neon saves and screen confirmations, New counts, review/export, private Blob upload/download, blocked anonymous access, and zero email jobs.',
  );
} finally {
  if (cookie) await request('/api/auth/sign-out', {}).catch(() => {});
  if (blobs.length) await del(blobs, { token: settings.BLOB_READ_WRITE_TOKEN });
  if (ids.length) {
    await pool.query(
      'DELETE FROM club_forms.audit WHERE entry_id=ANY($1::uuid[])',
      [ids],
    );
    await pool.query(
      'DELETE FROM club_forms.entries WHERE id=ANY($1::uuid[]) AND email=$2',
      [ids, email],
    );
  }
  await pool.end();
  service?.kill();
  console.log(
    "Removed this run's temporary submissions and uploaded test files.",
  );
}
