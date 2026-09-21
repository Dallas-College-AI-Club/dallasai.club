import { timingSafeEqual } from 'node:crypto';
import { database } from '../lib/db.mjs';
import { drainOutbox } from '../lib/mail.mjs';
import { send, fail } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
export default async function handler(req, res) {
  try {
    const expected = 'Bearer ' + (process.env.CRON_SECRET || '');
    const supplied = req.headers.authorization || '';
    if (
      !process.env.CRON_SECRET ||
      supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
      throw new RequestError(401, 'Unauthorized.');
    if (!['GET', 'POST'].includes(req.method))
      throw new RequestError(405, 'Method not allowed.');
    const db = database();
    const result = await drainOutbox(db, undefined, 15);
    await db.query('DELETE FROM club_forms.rate_limits WHERE expires_at<now()');
    await db.query(
      "DELETE FROM club_forms.webhook_events WHERE created_at<now()-interval '30 days'",
    );
    send(res, 200, result);
  } catch (error) {
    fail(res, error);
  }
}
