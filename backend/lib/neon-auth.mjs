import {
  createAuthServer,
  extractNeonAuthCookies,
  handleAuthProxyRequest,
  validateCookieConfig,
} from '@neondatabase/auth/server';
import {
  remainingAdminSession,
  persistentAdminCookie,
  expiredAdminCookies,
} from './admin-session.mjs';
import { RequestError } from './errors.mjs';
import { jsonBody, limit, send } from './http.mjs';
import { database } from './db.mjs';
import { emailList } from './admin-accounts.mjs';

export function neonConfig() {
  const baseUrl = process.env.NEON_AUTH_URL;
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !process.env.AUTH_BASE_URL)
    throw new RequestError(503, 'Admin sign-in is not configured yet.');
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new RequestError(503, 'Admin sign-in is not configured yet.');
  try {
    validateCookieConfig({ secret: cookieSecret });
  } catch {
    throw new RequestError(503, 'Admin sign-in is not configured yet.');
  }
  return { baseUrl, cookieSecret, sameSite: 'lax' };
}

export async function neonSession(req) {
  const client = createAuthServer({
    ...neonConfig(),
    context: () => ({
      getCookies: () => extractNeonAuthCookies(req.headers.cookie || ''),
      getOrigin: () => new URL(process.env.AUTH_BASE_URL).origin,
      getHeader: (name) => req.headers[name.toLowerCase()] || null,
      getFramework: () => 'node',
      // API authorization checks never use the browser's cached session data.
      // Cookie renewal is handled by the browser's /api/auth/get-session call.
      setCookie: () => {},
    }),
  });
  const result = await client.getSession({
    query: { disableCookieCache: 'true' },
  });
  if (result.error)
    throw new RequestError(
      503,
      'Could not verify your sign-in. Please try again.',
    );
  return remainingAdminSession(result.data) > 0 ? result.data : null;
}

export async function proxyNeonAuth(
  req,
  res,
  {
    approvedEmail = (email) => emailList(process.env.ADMIN_EMAILS).includes(email),
    rateLimit = (request, path) =>
      limit(
        database(),
        request,
        'admin-' + path,
        path.startsWith('sign-in') ? 10 : 5,
        300,
      ),
  } = {},
) {
  const config = neonConfig();
  const url = new URL(req.url, process.env.AUTH_BASE_URL);
  const path = url.pathname.replace(/^\/api\/auth\//, '');
  const allowed = {
    'get-session': 'GET',
    'email-otp/send-verification-otp': 'POST',
    'sign-in/email-otp': 'POST',
    'sign-out': 'POST',
  };
  if (allowed[path] !== req.method)
    throw new RequestError(404, 'This sign-in action is not available.');
  const origin = new URL(process.env.AUTH_BASE_URL).origin;
  if (req.method === 'POST' && req.headers.origin !== origin)
    throw new RequestError(403, 'Please use the club admin page.');
  const headers = new Headers({
    cookie: extractNeonAuthCookies(req.headers.cookie || ''),
    origin,
  });
  let body;
  if (req.method === 'POST') {
    headers.set('Content-Type', 'application/json');
    const input = await jsonBody(req, 10000);
    if (path !== 'sign-out') {
      const email =
        typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      if (!(await approvedEmail(email))) {
        if (path.startsWith('email-otp/'))
          return send(res, 200, { success: true });
        throw new RequestError(
          401,
          'Use the latest code sent to your approved club email address.',
        );
      }
      await rateLimit(req, path);
      if (path.startsWith('email-otp/'))
        body = JSON.stringify({ email, type: 'sign-in' });
      else {
        const otp = typeof input.otp === 'string' ? input.otp.trim() : '';
        if (!/^\d{6}$/.test(otp))
          throw new RequestError(400, 'Enter the six-digit sign-in code.');
        body = JSON.stringify({ email, otp });
      }
    } else body = '{}';
  } else {
    url.searchParams.set('disableCookieCache', 'true');
  }
  const response = await handleAuthProxyRequest({
    ...config,
    path,
    request: new Request(url, { method: req.method, headers, body }),
  });
  res.statusCode = response.status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  let payload = await response.text();
  let remaining;
  if (path === 'get-session' && response.ok) {
    const data = JSON.parse(payload);
    remaining = remainingAdminSession(data);
    if (!remaining) {
      res.setHeader('Set-Cookie', expiredAdminCookies());
      res.end('null');
      return;
    }
    // The browser sees the same fixed deadline that protects admin API calls.
    payload = JSON.stringify({
      ...data,
      session: {
        ...data.session,
        expiresAt: new Date(Date.now() + remaining * 1000).toISOString(),
      },
    });
  }
  const cookies = response.headers
    .getSetCookie()
    .map((header) => persistentAdminCookie(header, remaining));
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(payload);
}
