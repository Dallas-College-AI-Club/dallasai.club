import {
  createAuthServer,
  extractNeonAuthCookies,
  handleAuthProxyRequest,
  validateCookieConfig,
} from '@neondatabase/auth/server';
import { RequestError } from './errors.mjs';
import { jsonBody } from './http.mjs';

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
  return result.data;
}

export async function proxyNeonAuth(req, res) {
  const config = neonConfig();
  const url = new URL(req.url, process.env.AUTH_BASE_URL);
  const path = url.pathname.replace(/^\/api\/auth\//, '');
  const allowed = {
    'get-session': 'GET',
    'sign-in/email': 'POST',
    'sign-out': 'POST',
    'change-password': 'POST',
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
    body = JSON.stringify(await jsonBody(req, 10000));
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
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(await response.text());
}
