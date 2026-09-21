import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import pg from 'pg';
import { emailList, sendEmail } from './mail.mjs';
import { RequestError } from './errors.mjs';
let auth;
export const isAdmin = (email) =>
  emailList(process.env.ADMIN_EMAILS).includes(
    String(email || '').toLowerCase(),
  );
export function authOptions(pool, send = sendEmail) {
  return {
    database: pool,
    baseURL: process.env.AUTH_BASE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [process.env.AUTH_BASE_URL],
    emailAndPassword: { enabled: false },
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
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
        '/sign-in/email-otp': { window: 300, max: 5 },
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
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }) {
          // Silently decline unlisted addresses so this endpoint cannot send arbitrary email.
          if (type !== 'sign-in' || !isAdmin(email)) return;
          await send({
            to: email,
            subject: 'Your Dallas AI Club admin sign-in code',
            text: `Your sign-in code is ${otp}.\n\nIt expires in 10 minutes. Do not share this code.\n\nIf you did not request it, ignore this message.`,
          });
        },
      }),
    ],
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
  if (!session?.user?.emailVerified || !isAdmin(session.user.email))
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
