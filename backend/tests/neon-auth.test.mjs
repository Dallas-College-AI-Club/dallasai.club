import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin, adminOrigin } from '../lib/auth.mjs';
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
test('survey code requests use the scoped advisor allowlist without granting or requesting an admin role', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ success: true });
  });
  const req = {
    url: '/api/auth/email-otp/send-verification-otp',
    method: 'POST',
    headers: {
      origin: process.env.AUTH_BASE_URL,
      'content-type': 'application/json',
    },
    body: { email: 'advisor@example.com', role: 'admin' },
  };
  const res = { setHeader() {}, end() {} };
  await proxyNeonAuth(req, res, {
    approvedEmail: async (email) => email === 'advisor@example.com',
    rateLimit: async () => {},
  });
  assert.deepEqual(requests, [
    { email: 'advisor@example.com', type: 'sign-in' },
  ]);
  requests.length = 0;
  await proxyNeonAuth(req, res, { rateLimit: async () => {} });
  assert.equal(requests.length, 0);
});
test('Neon authorization rechecks the upstream session, provisioned admin role, and current officer allowlist', async (t) => {
  let data = {
    user,
    session: {
      id: 'session-one',
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      expiresAt: '2099-01-01T00:00:00Z',
    },
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
  // A valid session without officer access is told so, with a code the page
  // can use instead of showing the sign-in form again.
  const notOfficer = (e) =>
    e.status === 401 &&
    e.details.code === 'not-officer' &&
    e.message === "This account isn't set up as a club officer.";
  data = { ...data, user: { ...user, role: 'user' } };
  await assert.rejects(requireAdmin(req), notOfficer);
  data = { ...data, user };
  process.env.ADMIN_EMAILS = 'other@example.com';
  await assert.rejects(requireAdmin(req), notOfficer);
  process.env.ADMIN_EMAILS = user.email;
  data = null;
  await assert.rejects(
    requireAdmin(req),
    (e) => e.status === 401 && e.details.code === undefined,
  );
  assert.equal(requests.length, 4);
});
test('Neon proxy rejects public signup, password login, unsupported methods, and cross-origin code requests before forwarding', async (t) => {
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
      req('email-otp/send-verification-otp', 'POST', 'https://evil.example'),
      response,
    ),
    (e) => e.status === 403,
  );
  assert.equal(requests, 0);
  await assert.rejects(
    proxyNeonAuth(
      req('sign-in/email', 'POST', process.env.AUTH_BASE_URL),
      response,
    ),
    (e) => e.status === 404,
  );
});
test('email codes are limited to approved addresses and only the sign-in purpose is forwarded', async (t) => {
  const requests = [],
    quotas = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return Response.json({ success: true });
  });
  const options = {
    rateLimit: async (req, path) => {
      quotas.push(path);
    },
  };
  const response = { setHeader() {}, end() {} };
  const request = (
    email,
    path = 'email-otp/send-verification-otp',
    extra = {},
  ) => ({
    url: '/api/auth/' + path,
    method: 'POST',
    headers: {
      origin: process.env.AUTH_BASE_URL,
      'content-type': 'application/json',
    },
    body: { email, ...extra },
  });
  await proxyNeonAuth(request('outsider@example.com'), response, options);
  assert.equal(response.statusCode, 200);
  assert.equal(requests.length, 0);
  await proxyNeonAuth(
    request('Officer@Example.com', 'email-otp/send-verification-otp', {
      type: 'forget-password',
    }),
    response,
    options,
  );
  assert.deepEqual(requests[0].body, { email: user.email, type: 'sign-in' });
  await assert.rejects(
    proxyNeonAuth(
      request(user.email, 'sign-in/email-otp', { otp: 'bad' }),
      response,
      options,
    ),
    (e) => e.status === 400,
  );
  await proxyNeonAuth(
    request(user.email, 'sign-in/email-otp', {
      otp: '123456',
      role: 'admin',
      name: 'Injected',
    }),
    response,
    options,
  );
  assert.deepEqual(requests[1].body, { email: user.email, otp: '123456' });
  assert.equal(quotas.length, 3);
  await assert.rejects(
    proxyNeonAuth(
      request('outsider@example.com', 'sign-in/email-otp', { otp: '123456' }),
      response,
      options,
    ),
    (e) => e.status === 401,
  );
  await assert.rejects(
    proxyNeonAuth(request(user.email), response, {
      rateLimit: async () => {
        throw Object.assign(new Error('Too many requests'), { status: 429 });
      },
    }),
    (e) => e.status === 429,
  );
  assert.equal(requests.length, 2);
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

test('returning officers keep access before 72 hours; renewed upstream sessions cannot extend club access', async (t) => {
  const now = Date.now();
  let age = 71 * 3600000;
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      user,
      session: {
        id: 'three-day-session',
        updatedAt: new Date().toISOString(),
        createdAt: new Date(now - age).toISOString(),
        expiresAt: new Date(now + 7 * 86400000).toISOString(),
      },
    }),
  );
  const req = {
    headers: { cookie: '__Secure-neon-auth.session_token=test-session' },
  };
  assert.equal((await requireAdmin(req)).email, user.email);
  age = 72 * 3600000;
  // An expired session asks for sign-in again; it is not a "not an officer" case.
  await assert.rejects(
    requireAdmin(req),
    (e) => e.status === 401 && e.details.code === undefined,
  );
  const response = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(value) {
      this.body = value;
    },
  };
  await proxyNeonAuth(
    { ...req, url: '/api/auth/get-session', method: 'GET' },
    response,
  );
  assert.equal(response.body, 'null');
  assert.ok(
    response.headers['Set-Cookie'].every((value) =>
      value.includes('Max-Age=0'),
    ),
  );
});

test('code sign-in persists the session cookie for three days and does not extend the cache cookie', async (t) => {
  const now = Date.now();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/get-session'))
      return Response.json({
        user,
        session: {
          id: 'new-session',
          updatedAt: new Date().toISOString(),
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 7 * 86400000).toISOString(),
        },
      });
    return Response.json(
      { user, token: 'test-token' },
      {
        headers: {
          'Set-Cookie':
            '__Secure-neon-auth.session_token=test-token; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax',
        },
      },
    );
  });
  const response = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(value) {
      this.body = value;
    },
  };
  await proxyNeonAuth(
    {
      url: '/api/auth/sign-in/email-otp',
      method: 'POST',
      headers: {
        origin: process.env.AUTH_BASE_URL,
        'content-type': 'application/json',
      },
      body: { email: user.email, otp: '123456' },
    },
    response,
    { rateLimit: async () => {} },
  );
  const token = response.headers['Set-Cookie'].find((value) =>
    value.startsWith('__Secure-neon-auth.session_token='),
  );
  assert.match(token, /Max-Age=259200/);
  assert.match(token, /Expires=/);
  assert.match(token, /HttpOnly; Secure/);
  const cache = response.headers['Set-Cookie'].find((value) =>
    value.startsWith('__Secure-neon-auth.local.session_data='),
  );
  assert.ok(Number(cache.match(/Max-Age=(\d+)/)[1]) <= 300);
});

test('session refresh returns the original deadline and caps renewed cookies to the remaining time', async (t) => {
  const now = Date.now();
  const createdAt = new Date(now - 2 * 86400000).toISOString();
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {
        user,
        session: {
          id: 'renewed-session',
          updatedAt: new Date().toISOString(),
          createdAt,
          expiresAt: new Date(now + 7 * 86400000).toISOString(),
        },
      },
      {
        headers: {
          'Set-Cookie':
            '__Secure-neon-auth.session_token=test-token; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax',
        },
      },
    ),
  );
  const response = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(value) {
      this.body = value;
    },
  };
  await proxyNeonAuth(
    {
      url: '/api/auth/get-session',
      method: 'GET',
      headers: { cookie: '__Secure-neon-auth.session_token=test-token' },
    },
    response,
  );
  const remaining = Number(
    response.headers['Set-Cookie']
      .find((value) => value.startsWith('__Secure-neon-auth.session_token='))
      .match(/Max-Age=(\d+)/)[1],
  );
  assert.ok(remaining >= 86395 && remaining <= 86400);
  assert.ok(
    Math.abs(
      Date.parse(JSON.parse(response.body).session.expiresAt) -
        (now + 86400000),
    ) < 1000,
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
