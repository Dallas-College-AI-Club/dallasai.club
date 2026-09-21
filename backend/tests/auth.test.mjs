import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { betterAuth } from 'better-auth';
import { authOptions, requireAdmin, adminOrigin } from '../lib/auth.mjs';
let db, auth, code;
process.env.AUTH_BASE_URL = 'http://localhost:4175';
process.env.BETTER_AUTH_SECRET = 'test-' + 's'.repeat(40);
process.env.ADMIN_EMAILS = 'officer@example.com';
before(async () => {
  db = new PGlite();
  await db.exec(
    await readFile(new URL('../004_admin_auth.sql', import.meta.url), 'utf8'),
  );
  const client = {
    release() {},
    async query(sql, params) {
      const r = await db.query(sql, params);
      return {
        ...r,
        command: sql.trim().split(/\s/)[0].toUpperCase(),
        rowCount: r.affectedRows || r.rows.length,
      };
    },
  };
  const pool = {
    async connect() {
      return client;
    },
    async end() {},
  };
  auth = betterAuth(
    authOptions(pool, async (message) => {
      code = message.text.match(/\b\d{6}\b/)[0];
    }),
  );
});
after(async () => db.close());
const post = (path, body) =>
  auth.handler(
    new Request(process.env.AUTH_BASE_URL + '/api/auth' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: process.env.AUTH_BASE_URL,
      },
      body: JSON.stringify(body),
    }),
  );
test('unlisted email gets no code and cannot access the admin data', async () => {
  const response = await post('/email-otp/send-verification-otp', {
    email: 'outsider@example.com',
    type: 'sign-in',
  });
  assert.equal(response.status, 200);
  assert.equal(code, undefined);
  await assert.rejects(requireAdmin({ headers: {} }, auth), /authorized/);
});
test('OTP login produces a verified session; tampered cookies and removed officers lose access', async () => {
  let response = await post('/email-otp/send-verification-otp', {
    email: 'officer@example.com',
    type: 'sign-in',
  });
  assert.equal(response.status, 200);
  assert.match(code, /^\d{6}$/);
  const stored = (await db.query('SELECT value FROM club_admin_verification'))
    .rows;
  assert.ok(stored.every((row) => !row.value.includes(code)));
  response = await post('/sign-in/email-otp', {
    email: 'officer@example.com',
    otp: 'not-valid',
  });
  assert.notEqual(response.status, 200);
  response = await post('/sign-in/email-otp', {
    email: 'officer@example.com',
    otp: code,
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.user.emailVerified, true);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  assert.ok(cookie);
  assert.equal(
    (await requireAdmin({ headers: { cookie } }, auth)).email,
    'officer@example.com',
  );
  await assert.rejects(
    requireAdmin(
      { headers: { cookie: cookie.replace('=', '=tampered') } },
      auth,
    ),
    /authorized/,
  );
  process.env.ADMIN_EMAILS = 'another@example.com';
  await assert.rejects(
    requireAdmin({ headers: { cookie } }, auth),
    /authorized/,
  );
  process.env.ADMIN_EMAILS = 'officer@example.com';
  await db.query('DELETE FROM club_admin_session');
  await assert.rejects(
    requireAdmin({ headers: { cookie } }, auth),
    /authorized/,
  );
});
test('admin mutations require the admin page origin', () => {
  assert.throws(
    () => adminOrigin({ headers: { origin: 'https://evil.example' } }),
    /admin page/,
  );
  assert.doesNotThrow(() =>
    adminOrigin({ headers: { origin: process.env.AUTH_BASE_URL } }),
  );
});
