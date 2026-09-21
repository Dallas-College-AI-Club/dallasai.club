import { database } from '../lib/db.mjs';
import { cors, jsonBody, limit, send, fail } from '../lib/http.mjs';
import { verifyToken } from '../lib/tokens.mjs';
import { manageEntry } from '../lib/manage.mjs';
import { drainOutbox } from '../lib/mail.mjs';
export default async function handler(req, res) {
  try {
    if (!cors(req, res)) return;
    const db = database();
    await limit(db, req, 'manage', 30);
    const body = await jsonBody(req, 2048);
    const result = await manageEntry(db, verifyToken(body.token));
    await drainOutbox(db, undefined, 2).catch(() => {});
    send(res, 200, result);
  } catch (error) {
    fail(res, error);
  }
}
