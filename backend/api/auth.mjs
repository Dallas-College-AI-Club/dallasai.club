import { fail } from '../lib/http.mjs';
import { proxyNeonAuth } from '../lib/neon-auth.mjs';
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await proxyNeonAuth(req, res);
  } catch (error) {
    fail(res, error);
  }
}
