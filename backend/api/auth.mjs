import { toNodeHandler } from 'better-auth/node';
import { getAuth } from '../lib/auth.mjs';
import { fail } from '../lib/http.mjs';
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await toNodeHandler(getAuth())(req, res);
  } catch (error) {
    fail(res, error);
  }
}
