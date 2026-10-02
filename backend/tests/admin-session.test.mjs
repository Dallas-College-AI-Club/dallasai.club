import test from 'node:test';
import assert from 'node:assert/strict';
import {
  remainingAdminSession,
  persistentAdminCookie,
  expiredAdminCookies,
} from '../lib/admin-session.mjs';
const now = Date.parse('2026-10-02T20:00:00Z');
const hour = 60 * 60 * 1000;
const session = (ageHours, expiryHours = 168) => ({
  user: { id: 'officer' },
  session: {
    createdAt: new Date(now - ageHours * hour).toISOString(),
    expiresAt: new Date(now + expiryHours * hour).toISOString(),
  },
});

test('verified sessions last 72 hours from sign-in even after upstream rolling renewal', () => {
  assert.equal(remainingAdminSession(session(0), now), 259200);
  assert.equal(remainingAdminSession(session(48), now), 86400);
  assert.equal(remainingAdminSession(session(71.5), now), 1800);
  assert.equal(remainingAdminSession(session(72), now), 0);
  assert.equal(remainingAdminSession(session(73), now), 0);
  assert.equal(remainingAdminSession(session(1, 0.5), now), 1800);
  assert.equal(remainingAdminSession(session(1, -0.5), now), 0);
  assert.equal(remainingAdminSession(null, now), 0);
  assert.equal(remainingAdminSession({ user: {}, session: {} }, now), 0);
  assert.equal(remainingAdminSession(session(-1), now), 0);
});

test('session tokens persist across browser restarts but renewal cannot exceed the original deadline', () => {
  const header =
    '__Secure-neon-auth.session_token=opaque%2Bsignature; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800';
  const first = persistentAdminCookie(header, undefined, now);
  assert.match(first, /Max-Age=259200;/);
  assert.match(first, /Expires=Mon, 05 Oct 2026 20:00:00 GMT;/);
  assert.match(first, /opaque%2Bsignature;/);
  assert.match(first, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(persistentAdminCookie(header, 3600, now), /Max-Age=3600;/);
  assert.match(
    persistentAdminCookie(header.replace('604800', '600'), undefined, now),
    /Max-Age=600;/,
  );
  assert.match(
    persistentAdminCookie(
      header.replace('; Max-Age=604800', ''),
      undefined,
      now,
    ),
    /Max-Age=259200;/,
  );
  assert.match(
    persistentAdminCookie(
      header + '; Expires=Fri, 02 Oct 2026 20:30:00 GMT',
      undefined,
      now,
    ),
    /Max-Age=1800;/,
  );
});

test('logout and short-lived cache cookies keep their own expiry', () => {
  const logout =
    '__Secure-neon-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure';
  const cache =
    '__Secure-neon-auth.local.session_data=cache; Max-Age=300; HttpOnly; Secure';
  assert.equal(persistentAdminCookie(logout, undefined, now), logout);
  assert.equal(persistentAdminCookie(cache, undefined, now), cache);
  assert.ok(
    expiredAdminCookies().every(
      (header) =>
        header.includes('Max-Age=0;') && header.includes('HttpOnly; Secure;'),
    ),
  );
});
