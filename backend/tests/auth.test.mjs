import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { betterAuth } from 'better-auth';
import { authOptions, requireAdmin, adminOrigin } from '../lib/auth.mjs';
import { createAdmin } from '../lib/admin-accounts.mjs';
let db, auth;
const email = 'officer@example.com',
  password = 'Test-initial-password-987!';
process.env.AUTH_BASE_URL = 'http://localhost:4175';
process.env.BETTER_AUTH_SECRET = 'test-' + 's'.repeat(40);
process.env.ADMIN_EMAILS = email;
before(async () => {
  db = new PGlite();
  await db.exec(
    await readFile(new URL('../004_admin_auth.sql', import.meta.url), 'utf8'),
  );
  await db.transaction((tx) => createAdmin(tx, { email, password }, email));
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
  auth = betterAuth(
    authOptions({
      async connect() {
        return client;
      },
      async end() {},
    }),
  );
});
beforeEach(async () => {
  await db.query('DELETE FROM club_admin_rate_limit');
});
after(async () => db.close());
const post = (path, body, cookie = '') =>
  auth.handler(
    new Request(process.env.AUTH_BASE_URL + '/api/auth' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: process.env.AUTH_BASE_URL,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
const cookies = (response) =>
  response.headers
    .getSetCookie()
    .map((x) => x.split(';')[0])
    .join('; ');
test('public account creation and obsolete email-code routes are unavailable; outsiders cannot access admin records', async () => {
  assert.notEqual(
    (
      await post('/sign-up/email', {
        email: 'outsider@example.com',
        password,
        name: 'Outsider',
      })
    ).status,
    200,
  );
  assert.notEqual(
    (await post('/sign-up/email', { email, password, name: 'Officer' })).status,
    200,
  );
  assert.notEqual(
    (await post('/sign-in/email', { email: 'outsider@example.com', password }))
      .status,
    200,
  );
  assert.equal(
    (await post('/email-otp/send-verification-otp', { email, type: 'sign-in' }))
      .status,
    404,
  );
  await assert.rejects(requireAdmin({ headers: {} }, auth), /authorized/);
  await assert.rejects(
    db.transaction((tx) =>
      createAdmin(tx, { email: 'outsider@example.com', password }, email),
    ),
    /approved/,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_admin_user')).rows[0]
      .n,
    1,
  );
});
test('password login checks the hash; tampered cookies and removed officers lose access', async () => {
  const stored = (await db.query('SELECT password FROM club_admin_account'))
    .rows[0].password;
  assert.notEqual(stored, password);
  assert.ok(stored.length > 80);
  assert.notEqual(
    (await post('/sign-in/email', { email, password: 'incorrect-password' }))
      .status,
    200,
  );
  const response = await post('/sign-in/email', { email, password });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = cookies(response);
  assert.equal(
    (await requireAdmin({ headers: { cookie } }, auth)).email,
    email,
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
  process.env.ADMIN_EMAILS = email;
  await db.query('DELETE FROM club_admin_session');
  await assert.rejects(
    requireAdmin({ headers: { cookie } }, auth),
    /authorized/,
  );
});
test('an officer can change a password and revoke other sessions; the old password stops working', async () => {
  const first = await post('/sign-in/email', { email, password });
  const second = await post('/sign-in/email', { email, password });
  const newPassword = 'Changed-password-987654!';
  const response = await post(
    '/change-password',
    { currentPassword: password, newPassword, revokeOtherSessions: true },
    cookies(first),
  );
  assert.equal(response.status, 200, await response.clone().text());
  await assert.rejects(
    requireAdmin({ headers: { cookie: cookies(second) } }, auth),
    /authorized/,
  );
  assert.notEqual(
    (await post('/sign-in/email', { email, password })).status,
    200,
  );
  assert.equal(
    (await post('/sign-in/email', { email, password: newPassword })).status,
    200,
  );
});
test('admin mutations require the admin origin', () => {
  assert.throws(
    () => adminOrigin({ headers: { origin: 'https://evil.example' } }),
    /admin page/,
  );
  assert.doesNotThrow(() =>
    adminOrigin({ headers: { origin: process.env.AUTH_BASE_URL } }),
  );
});
