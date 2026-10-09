import { database } from '../lib/db.mjs';
import qrcode from 'qrcode-generator';
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
  createEventShareLink,
  createEventFeedbackShareLink,
  eventURL,
} from '../lib/event-share-link.mjs';
import { createShortLink as shortenLink } from '../lib/survey-share-link.mjs';
import {
  eventFeedbackState,
  eventFeedbackURL,
} from '../lib/event-feedback-definition.mjs';
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
  createShortLink = shortenLink,
  createFeedbackShortLink = (target, alias, domain) =>
    shortenLink(target, alias, fetch, domain),
  rateLimit = (db, req) => limit(db, req, 'event-images', 30, 3600),
} = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'https://events.invalid');
      if (req.method === 'GET' && url.searchParams.has('qr')) {
        const id = url.searchParams.get('qr');
        if (!eventIdPattern.test(id))
          throw new RequestError(400, 'Check the event.');
        const qr = qrcode(0, 'M');
        const saved = (
          await getDatabase().query(
            'SELECT published FROM club_forms.events WHERE id=$1',
            [id],
          )
        ).rows[0];
        const feedback = url.searchParams.get('feedback') === '1';
        qr.addData(
          feedback
            ? saved?.published?.feedbackShortLink || eventFeedbackURL(id)
            : saved?.published?.shortLink || eventURL(id),
        );
        qr.make();
        res.statusCode = 200;
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader(
          'Content-Disposition',
          (url.searchParams.has('download') ? 'attachment' : 'inline') +
            '; filename="' +
            id +
            (feedback ? '-feedback-qr.svg"' : '-qr.svg"'),
        );
        return res.end(qr.createSvgTag(6, 24));
      }
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
        const events = await liveEvents(getDatabase(), originals);
        return send(res, 200, {
          events: events.map((event) => ({
            ...event,
            ...(event.feedbackEnabled
              ? {
                  feedbackUrl:
                    event.feedbackShortLink || eventFeedbackURL(event.id),
                  feedbackState: eventFeedbackState(event),
                }
              : {}),
          })),
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
      if (body.action === 'share-link') {
        let event = await createEventShareLink(
          getDatabase(),
          body.id,
          user.email,
          createShortLink,
          body.replaceLegacy === true,
          body.alias,
        );
        let sharingError;
        if (event.published.feedbackEnabled) {
          try {
            event = await createEventFeedbackShareLink(
              getDatabase(),
              body.id,
              user.email,
              createFeedbackShortLink,
            );
          } catch {
            sharingError =
              'Feedback short link could not be created. Use Create feedback short link to try again.';
          }
        }
        return send(res, 200, {
          event,
          ...(sharingError ? { sharingError } : {}),
        });
      }
      if (body.action === 'feedback-share-link')
        return send(res, 200, {
          event: await createEventFeedbackShareLink(
            getDatabase(),
            body.id,
            user.email,
            createFeedbackShortLink,
          ),
        });
      if (!['unpublish', 'archive', 'restore'].includes(body.action))
        body.event = await validateEventAssets(
          getDatabase(),
          draftContent(body.event, body.action === 'publish'),
          originals,
        );
      if (body.action === 'preview') {
        if (!eventIdPattern.test(body.id || ''))
          throw new RequestError(400, 'Check the event.');
        const preview = publicContent(body.id, body.event, true);
        const saved = (
          await getDatabase().query(
            'SELECT published FROM club_forms.events WHERE id=$1',
            [body.id],
          )
        ).rows[0];
        if (saved?.published?.shortLink)
          preview.shortLink = saved.published.shortLink;
        return send(res, 200, { event: preview });
      }
      let event = await saveEvent(getDatabase(), body, user.email, originals);
      let sharingError;
      if (body.action === 'publish' && !event.published.shortLink) {
        try {
          event = await createEventShareLink(
            getDatabase(),
            body.id,
            user.email,
            createShortLink,
          );
        } catch {
          // Publication succeeded. A provider outage must not suggest the saved
          // event was lost or cause an officer to publish it a second time.
          sharingError =
            'Short link could not be created. Use Create short link to try again.';
        }
      }
      if (
        body.action === 'publish' &&
        event.published.feedbackEnabled &&
        event.published.shortLink
      ) {
        try {
          event = await createEventFeedbackShareLink(
            getDatabase(),
            body.id,
            user.email,
            createFeedbackShortLink,
          );
        } catch {
          sharingError =
            'Feedback short link could not be created. Use Create feedback short link to try again.';
        }
      }
      return send(res, 200, {
        event,
        ...(sharingError ? { sharingError } : {}),
      });
    } catch (error) {
      fail(res, error);
    }
  };
}
export default eventHandler();
