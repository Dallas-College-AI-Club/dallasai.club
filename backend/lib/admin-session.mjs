import {
  NEON_AUTH_SESSION_COOKIE_NAME,
  NEON_AUTH_SESSION_DATA_COOKIE_NAME,
  parseSetCookies,
  serializeSetCookie,
} from '@neondatabase/auth/server';

export const ADMIN_SESSION_SECONDS = 3 * 24 * 60 * 60;

// Only call with a session freshly verified by the authentication server.
// An upstream rolling renewal must not extend the club's three-day window.
export function remainingAdminSession(data, now = Date.now()) {
  const created = Date.parse(data?.session?.createdAt);
  const expires = Date.parse(data?.session?.expiresAt);
  if (
    !data?.user ||
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    created > now + 60000 ||
    expires <= created
  )
    return 0;
  return Math.max(
    0,
    Math.ceil(
      (Math.min(expires, created + ADMIN_SESSION_SECONDS * 1000) - now) / 1000,
    ),
  );
}

export function persistentAdminCookie(
  header,
  remaining = ADMIN_SESSION_SECONDS,
  now = Date.now(),
) {
  const cookie = parseSetCookies(header).find(
    (item) => item.name === NEON_AUTH_SESSION_COOKIE_NAME,
  );
  if (!cookie) return header;
  // Preserve logout/deletion headers exactly; never revive an ended session.
  if (!cookie.value || cookie.maxAge <= 0 || cookie.expires?.getTime() <= now)
    return header;
  const upstreamAge =
    cookie.maxAge === undefined ? Infinity : Number(cookie.maxAge);
  const upstreamExpiry = cookie.expires
    ? (cookie.expires.getTime() - now) / 1000
    : Infinity;
  const maxAge = Math.max(
    0,
    Math.floor(
      Math.min(remaining, ADMIN_SESSION_SECONDS, upstreamAge, upstreamExpiry),
    ),
  );
  return serializeSetCookie({
    ...cookie,
    maxAge,
    expires: new Date(now + maxAge * 1000),
  });
}

export function expiredAdminCookies() {
  return [
    NEON_AUTH_SESSION_COOKIE_NAME,
    NEON_AUTH_SESSION_DATA_COOKIE_NAME,
    '__Secure-neon-auth.session_data',
  ].map((name) =>
    serializeSetCookie({
      name,
      value: '',
      path: '/',
      maxAge: 0,
      expires: new Date(0),
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    }),
  );
}
