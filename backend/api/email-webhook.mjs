import { applyEmailEvent } from '../lib/email-events.mjs';
import { Resend } from 'resend';
import { database } from '../lib/db.mjs';
import { rawBody, send, fail } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST')
      throw new RequestError(405, 'Method not allowed.');
    if (!process.env.RESEND_WEBHOOK_SECRET || !process.env.RESEND_API_KEY)
      throw new RequestError(503, 'Webhook not configured.');
    const payload = await rawBody(req, 100000);
    let event;
    try {
      event = new Resend(process.env.RESEND_API_KEY).webhooks.verify({
        payload,
        headers: {
          id: req.headers['svix-id'],
          timestamp: req.headers['svix-timestamp'],
          signature: req.headers['svix-signature'],
        },
        webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
      });
    } catch {
      throw new RequestError(400, 'Invalid webhook signature.');
    }
    await applyEmailEvent(database(), event, req.headers['svix-id']);
    send(res, 200, { received: true });
  } catch (error) {
    fail(res, error);
  }
}
