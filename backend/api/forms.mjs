import { readFile } from 'node:fs/promises';
import { database } from '../lib/db.mjs';
import { cors, jsonBody, limit, send, fail } from '../lib/http.mjs';
import { submit } from '../lib/submissions.mjs';
export const config = { api: { bodyParser: false } };
export const confirmations = {
  subscribe:
    'Your subscription request has been saved. Thank you for your interest in The AI Review.',
  join: 'Your club signup has been saved. Welcome to the Dallas College AI Club!',
  rsvp: 'Your RSVP has been saved. We look forward to seeing you!',
  contribution:
    'Your contribution has been received. A club officer will review it.',
  workshop:
    'Your workshop request has been saved. A club officer will review it.',
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
    const events = JSON.parse(
      await readFile(
        new URL('../generated/events.json', import.meta.url),
        'utf8',
      ),
    );
    await submit(db, body, events);
    // Success is returned only after the database transaction commits.
    send(res, 200, { message: confirmations[body.kind] });
  } catch (error) {
    fail(res, error);
  }
}
