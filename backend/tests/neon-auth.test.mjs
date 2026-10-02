import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin } from '../lib/auth.mjs';
import { proxyNeonAuth } from '../lib/neon-auth.mjs';
process.env.NEON_AUTH_URL = 'https://auth.example.com/neondb/auth';
process.env.NEON_AUTH_COOKIE_SECRET = 'test-only-' + 'x'.repeat(40);
process.env.AUTH_BASE_URL = 'https://office.example.com';
process.env.ADMIN_EMAILS = 'officer@example.com';
const user = {
  id: 'one',
  email: 'officer@example.com',
  emailVerified: true,
  role: 'admin',
};
test('Neon authorization rechecks the upstream session, provisioned admin role, and current officer allowlist', async (t) => {
  let data = {
    user,
    session: { id: 'session-one', expiresAt: '2099-01-01T00:00:00Z' },
  };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), headers: options.headers });
    return Response.json(data);
  });
  const req = {
    headers: {
      cookie:
        '__Secure-neon-auth.session_token=test-session; unrelated=private',
    },
  };
  assert.equal((await requireAdmin(req)).email, user.email);
  assert.ok(requests[0].url.endsWith('/get-session?disableCookieCache=true'));
  assert.equal(requests[0].headers.Cookie.includes('unrelated'), false);
  data = { ...data, user: { ...user, role: 'user' } };
  await assert.rejects(requireAdmin(req), (e) => e.status === 401);
  data = { ...data, user };
  process.env.ADMIN_EMAILS = 'other@example.com';
  await assert.rejects(requireAdmin(req), (e) => e.status === 401);
  process.env.ADMIN_EMAILS = user.email;
  data = null;
  await assert.rejects(requireAdmin(req), (e) => e.status === 401);
  assert.equal(requests.length, 4);
});
test('Neon proxy rejects public signup, unsupported methods, and cross-origin password operations before forwarding', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json(null);
  });
  const response = { setHeader() {}, end() {} };
  const req = (path, method, origin) => ({
    url: '/api/auth/' + path,
    method,
    headers: { origin, 'content-type': 'application/json' },
    body: {},
  });
  await assert.rejects(
    proxyNeonAuth(
      req('sign-up/email', 'POST', process.env.AUTH_BASE_URL),
      response,
    ),
    (e) => e.status === 404,
  );
  await assert.rejects(
    proxyNeonAuth(req('sign-out', 'GET', process.env.AUTH_BASE_URL), response),
    (e) => e.status === 404,
  );
  await assert.rejects(
    proxyNeonAuth(
      req('change-password', 'POST', 'https://evil.example'),
      response,
    ),
    (e) => e.status === 403,
  );
  assert.equal(requests, 0);
});
test('Neon proxy preserves separate logout cookies and forces upstream session validation', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(String(url));
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.append(
      'Set-Cookie',
      '__Secure-neon-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure',
    );
    headers.append(
      'Set-Cookie',
      '__Secure-neon-auth.session_data=; Max-Age=0; Path=/; HttpOnly; Secure',
    );
    return new Response('null', { headers });
  });
  const response = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end() {},
  };
  await proxyNeonAuth(
    { url: '/api/auth/get-session', method: 'GET', headers: {} },
    response,
  );
  assert.ok(requests[0].includes('disableCookieCache=true'));
  assert.ok(Array.isArray(response.headers['Set-Cookie']));
  assert.ok(response.headers['Set-Cookie'].length >= 2);
});
