import { readFile } from 'node:fs/promises';
import { database } from '../lib/db.mjs';
import { cors, jsonBody, limit, send, fail } from '../lib/http.mjs';
import { submit } from '../lib/submissions.mjs';
import { drainOutbox } from '../lib/mail.mjs';
import { RequestError } from '../lib/errors.mjs';
export const config = { api: { bodyParser: false } };
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
    if (
      !process.env.RESEND_API_KEY ||
      !process.env.MAIL_FROM ||
      !process.env.NOTIFICATION_EMAILS
    )
      throw new RequestError(
        503,
        'Forms are being connected. Please try again later.',
      );
    if (
      body.kind === 'subscribe' &&
      (!process.env.RESEND_SEGMENT_ID || !process.env.RESEND_WEBHOOK_SECRET)
    )
      throw new RequestError(
        503,
        'Newsletter subscriptions are being connected. Please try again later.',
      );
    const events = JSON.parse(
      await readFile(
        new URL('../generated/events.json', import.meta.url),
        'utf8',
      ),
    );
    await submit(db, body, events);
    // The database trigger already queued the alert atomically. Provider failures do not lose records.
    await drainOutbox(db, undefined, 2).catch(() => {});
    send(res, 200, {
      message: ['subscribe', 'join', 'rsvp'].includes(body.kind)
        ? 'Request received. Check your email for a confirmation link. If it does not arrive, check your spam folder or try again later.'
        : 'Thank you. Your submission has been received for review.',
    });
  } catch (error) {
    fail(res, error);
  }
}
