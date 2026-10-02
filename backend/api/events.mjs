import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin } from '../lib/auth.mjs';
import { send, fail, jsonBody } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { liveEvents, editorEvents, saveEvent } from '../lib/events.mjs';
import { publicContent, eventIdPattern } from '../lib/event-content.mjs';
export const config = { api: { bodyParser: false } };
export function eventHandler({
  getDatabase = database,
  authorize = requireAdmin,
  originals,
} = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'https://events.invalid');
      if (req.method === 'GET' && !url.searchParams.has('admin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return send(res, 200, {
          events: await liveEvents(getDatabase(), originals),
        });
      }
      if (!['GET', 'POST'].includes(req.method))
        throw new RequestError(405, 'Method not allowed.');
      const user = await authorize(req);
      if (req.method === 'GET')
        return send(res, 200, {
          events: await editorEvents(getDatabase(), originals),
          user: user.email,
        });
      adminOrigin(req);
      const body = await jsonBody(req, 40000);
      if (body.action === 'preview') {
        if (!eventIdPattern.test(body.id || ''))
          throw new RequestError(400, 'Check the event.');
        return send(res, 200, {
          event: publicContent(body.id, body.event, true),
        });
      }
      return send(res, 200, {
        event: await saveEvent(getDatabase(), body, user.email, originals),
      });
    } catch (error) {
      fail(res, error);
    }
  };
}
export default eventHandler();
