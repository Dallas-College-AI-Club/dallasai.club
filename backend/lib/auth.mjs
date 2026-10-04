import { emailList } from './admin-accounts.mjs';
import { RequestError } from './errors.mjs';
import { neonSession } from './neon-auth.mjs';
const isAdmin = (email) =>
  emailList(process.env.ADMIN_EMAILS).includes(
    String(email || '').toLowerCase(),
  );
// Officers sign in with Neon Auth email codes. Access needs both an approved
// address in ADMIN_EMAILS and the Neon "admin" role.
export async function requireAdmin(req) {
  const session = await neonSession(req);
  if (!session?.user)
    throw new RequestError(
      401,
      'Sign in with an authorized club email address.',
    );
  // A valid sign-in without officer access gets a code, so the page can say so
  // instead of asking for the same sign-in again.
  if (
    !isAdmin(session.user.email) ||
    !String(session.user.role || '')
      .split(',')
      .map((r) => r.trim())
      .includes('admin')
  )
    throw new RequestError(
      401,
      "This account isn't set up as a club officer.",
      {
        code: 'not-officer',
      },
    );
  return session.user;
}
export function adminOrigin(req) {
  if (
    !process.env.AUTH_BASE_URL ||
    req.headers.origin !== new URL(process.env.AUTH_BASE_URL).origin
  )
    throw new RequestError(403, 'Please use the club admin page.');
}
