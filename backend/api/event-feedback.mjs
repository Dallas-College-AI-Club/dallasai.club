import { database } from '../lib/db.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { cors, jsonBody, limit, send, fail } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import {
  readEventFeedback,
  submitEventFeedback,
  eventFeedbackResults,
} from '../lib/event-feedback.mjs';
export const config = { api: { bodyParser: false } };

export function eventFeedbackHandler({
  getDatabase = database,
  authorize = requireAdmin,
  originals,
  now = () => Date.now(),
  // A campus shares one public address; a whole class can answer together.
  rateLimit = (db, req) => limit(db, req, 'event-feedback', 300),
} = {}) {
  return async (req, res) => {
    try {
      const params = new URL(req.url, 'https://feedback.invalid').searchParams;
      if (req.method === 'GET') {
        if (params.has('admin')) {
          await authorize(req);
          return send(
            res,
            200,
            await eventFeedbackResults(getDatabase(), {
              eventId: params.get('eventId'),
              offset: Number(params.get('offset') || 0),
            }),
          );
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        return send(
          res,
          200,
          await readEventFeedback(
            getDatabase(),
            params.get('eventId'),
            originals,
            now(),
          ),
        );
      }
      if (!['POST', 'OPTIONS'].includes(req.method))
        throw new RequestError(405, 'Method not allowed.');
      if (!cors(req, res)) return;
      const db = getDatabase();
      await rateLimit(db, req);
      const body = await jsonBody(req, 150000);
      if (!body.website) await submitEventFeedback(db, body, originals, now);
      return send(res, 200, {
        message: 'Thank you. Your event feedback has been received.',
      });
    } catch (error) {
      fail(res, error);
    }
  };
}
export default eventFeedbackHandler();
