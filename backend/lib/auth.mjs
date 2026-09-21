import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import pg from 'pg';
import { emailList } from './admin-accounts.mjs';
import { RequestError } from './errors.mjs';
let auth;
export const isAdmin = (email) =>
  emailList(process.env.ADMIN_EMAILS).includes(
    String(email || '').toLowerCase(),
  );
export function authOptions(pool) {
  return {
    database: pool,
    baseURL: process.env.AUTH_BASE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [process.env.AUTH_BASE_URL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    user: { modelName: 'club_admin_user', changeEmail: { enabled: false } },
    session: {
      modelName: 'club_admin_session',
      expiresIn: 28800,
      updateAge: 3600,
      cookieCache: { enabled: false },
    },
    account: { modelName: 'club_admin_account' },
    verification: { modelName: 'club_admin_verification' },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'club_admin_rate_limit',
      window: 60,
      max: 20,
      customRules: {
        '/sign-in/email': { window: 300, max: 5 },
        '/change-password': { window: 300, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: 'club-admin',
      useSecureCookies: process.env.AUTH_BASE_URL?.startsWith('https:'),
      ipAddress: {
        ipAddressHeaders: process.env.VERCEL
          ? ['x-vercel-forwarded-for']
          : ['x-forwarded-for'],
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!isAdmin(user.email))
              throw new APIError('FORBIDDEN', {
                message:
                  'This email is not authorized for club administration.',
              });
            return { data: user };
          },
        },
      },
    },
  };
}
export function getAuth() {
  if (
    !process.env.AUTH_DATABASE_URL ||
    !process.env.AUTH_BASE_URL ||
    !process.env.BETTER_AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET.length < 32 ||
    !emailList(process.env.ADMIN_EMAILS).length
  )
    throw new RequestError(503, 'Admin access has not been configured yet.');
  if (!auth)
    auth = betterAuth(
      authOptions(
        new pg.Pool({
          connectionString: process.env.AUTH_DATABASE_URL,
          max: 3,
          connectionTimeoutMillis: 10000,
          query_timeout: 10000,
          statement_timeout: 10000,
        }),
      ),
    );
  return auth;
}
export async function requireAdmin(req, authInstance = getAuth()) {
  const session = await authInstance.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session?.user || !isAdmin(session.user.email))
    throw new RequestError(
      401,
      'Sign in with an authorized club email address.',
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
