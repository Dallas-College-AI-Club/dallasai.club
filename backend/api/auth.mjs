import { toNodeHandler } from 'better-auth/node';
import { getAuth } from '../lib/auth.mjs';
import { fail } from '../lib/http.mjs';
import { proxyNeonAuth } from '../lib/neon-auth.mjs';
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (process.env.NEON_AUTH_URL) return await proxyNeonAuth(req, res);
    await toNodeHandler(getAuth())(req, res);
  } catch (error) {
    fail(res, error);
  }
}
