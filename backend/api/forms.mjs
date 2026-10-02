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
export default async function handler(req, res) {
  try {
    if (!cors(req, res)) return;
    const db = database();
    await limit(db, req, 'forms');
    const body = await jsonBody(req);
    if (body.website)
      return send(res, 200, {
        message: 'Thank you. Your request has been received.',
      });
    const events = ['rsvp', 'question'].includes(body.kind)
      ? await liveEvents(db)
      : [];
    await submit(db, body, events);
    // Success is returned only after the database transaction commits.
    send(res, 200, { message: confirmations[body.kind] });
  } catch (error) {
    fail(res, error);
  }
}
