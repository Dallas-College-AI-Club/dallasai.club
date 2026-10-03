import { database } from '../lib/db.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { send, fail } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { surveyResults } from '../lib/surveys.mjs';
export function surveysHandler({
  authorize = requireAdmin,
  getDatabase = database,
} = {}) {
  return async function handler(req, res) {
    try {
      await authorize(req);
      if (req.method !== 'GET')
        throw new RequestError(405, 'Method not allowed.');
      const params = new URL(req.url, 'https://admin.invalid').searchParams;
      const offset = Number(params.get('offset') || 0);
      send(
        res,
        200,
        await surveyResults(getDatabase(), {
          eventId: params.get('eventId') || '',
          entryId: params.get('entryId') || '',
          offset,
        }),
      );
    } catch (error) {
      fail(res, error);
    }
  };
}
export default surveysHandler();
