import { liveEvents } from '../lib/events.mjs';
import { database } from '../lib/db.mjs';
import { cors, jsonBody, limit, send, fail } from '../lib/http.mjs';
import { submit } from '../lib/submissions.mjs';
export const config = { api: { bodyParser: false } };
export const confirmations = {
  subscribe:
    'Your subscription request for The AI Review has been received. You can read the latest articles on the website while email updates are being set up.',
  join: 'Your club signup has been received. Welcome to the Dallas College AI Club!',
  rsvp: 'Your RSVP has been received. We look forward to seeing you!',
  contribution:
    'Your contribution has been received. A club officer will review it.',
  workshop:
    'Your workshop request has been received. A club officer will review it.',
  question:
    'Your question has been received in the club inbox. An officer can reply to the email address you provided.',
};
export function formsHandler({
  getDatabase = database,
  getEvents = liveEvents,
  // Campus networks share one address, so a class can sign up together.
  rateLimit = (db, req) => limit(db, req, 'forms', 60),
} = {}) {
  return async function handler(req, res) {
    try {
      if (!cors(req, res)) return;
      const db = getDatabase();
      await rateLimit(db, req);
      const body = await jsonBody(req);
      if (body.website)
        return send(res, 200, {
          message: 'Thank you. Your request has been received.',
        });
      const events = ['rsvp', 'question'].includes(body.kind)
        ? await getEvents(db)
        : [];
      const entry = await submit(db, body, events);
      // Success is returned only after the database transaction commits.
      // A repeat signup gets the usual reply, so the form never shows whether
      // an address already belongs to a member.
      send(res, 200, {
        message:
          body.kind === 'rsvp'
            ? entry.alreadySubmitted
              ? 'You already have an RSVP for this event. Your original response is saved; contact the club to change it.'
              : entry.data.potential
                ? 'Your interest and responses have been received. This is a potential event; the details and your seat are not confirmed yet.'
                : confirmations.rsvp
            : confirmations[body.kind],
      });
    } catch (error) {
      fail(res, error);
    }
  };
}
export default formsHandler();
