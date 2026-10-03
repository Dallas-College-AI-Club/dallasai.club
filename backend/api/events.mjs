import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin } from '../lib/auth.mjs';
import { send, fail, jsonBody, limit } from '../lib/http.mjs';
import {
  eventTypes,
  addEventType,
  validateEventAssets,
  uploadEventImage,
  serveEventImage,
} from '../lib/event-assets.mjs';
import { RequestError } from '../lib/errors.mjs';
import {
  liveEvents,
  editorEvents,
  saveEvent,
  eventActivity,
} from '../lib/events.mjs';
import {
  publicContent,
  draftContent,
  eventIdPattern,
} from '../lib/event-content.mjs';
export const config = { api: { bodyParser: false } };
export function eventHandler({
  getDatabase = database,
  authorize = requireAdmin,
  originals,
  storage,
  rateLimit = (db, req) => limit(db, req, 'event-images', 30, 3600),
} = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'https://events.invalid');
      if (req.method === 'GET' && url.searchParams.has('image'))
        return await serveEventImage(
          req,
          res,
          getDatabase(),
          url.searchParams.get('image'),
          authorize,
          originals,
          storage,
        );
      if (
        req.method === 'GET' &&
        !url.searchParams.has('admin') &&
        !url.searchParams.has('history')
      ) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return send(res, 200, {
          events: await liveEvents(getDatabase(), originals),
        });
      }
      if (!['GET', 'POST'].includes(req.method))
        throw new RequestError(405, 'Method not allowed.');
      const user = await authorize(req);
      if (req.method === 'GET' && url.searchParams.has('history'))
        return send(
          res,
          200,
          await eventActivity(
            getDatabase(),
            url.searchParams.get('history'),
            url.searchParams.get('before'),
          ),
        );
      if (req.method === 'GET')
        return send(res, 200, {
          events: await editorEvents(getDatabase(), originals),
          user: user.email,
          types: await eventTypes(getDatabase(), originals),
        });
      adminOrigin(req);
      const upload = url.searchParams.has('upload');
      const body = await jsonBody(req, upload ? 2900000 : 200000);
      if (upload) {
        await rateLimit(getDatabase(), req);
        return send(res, 200, {
          image: await uploadEventImage(
            getDatabase(),
            body,
            user.email,
            storage,
          ),
        });
      }
      if (body.action === 'add-type')
        return send(
          res,
          200,
          await addEventType(getDatabase(), body.name, user.email, originals),
        );
      if (!['unpublish', 'archive', 'restore'].includes(body.action))
        body.event = await validateEventAssets(
          getDatabase(),
          draftContent(body.event, body.action === 'publish'),
          originals,
        );
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
