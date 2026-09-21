import { Resend } from 'resend';
import { RequestError } from './errors.mjs';
import { signToken } from './tokens.mjs';
export const labels = {
  subscribe: 'Newsletter subscription',
  join: 'Club signup',
  rsvp: 'Event RSVP',
  contribution: 'Article contribution',
  workshop: 'Workshop request',
};
export const emailList = (value) =>
  (value || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
export function mailClient() {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)
    throw new RequestError(503, 'Email delivery is not configured yet.');
  const client = new Resend(process.env.RESEND_API_KEY);
  const fetchRequest = client.fetchRequest.bind(client);
  client.fetchRequest = (path, options = {}) =>
    fetchRequest(path, { ...options, signal: AbortSignal.timeout(8000) });
  return client;
}
export async function sendEmail(message, key) {
  const result = await mailClient().emails.send(
    { from: process.env.MAIL_FROM, ...message },
    { idempotencyKey: key },
  );
  if (result.error) throw new Error('Email provider rejected request');
  return result.data;
}
const link = (entry, action, seconds, now) =>
  `${process.env.PUBLIC_SITE_URL || 'https://dallasai.club'}/manage.html#token=${encodeURIComponent(signToken(entry.id, action, seconds, now))}`;
export function receipt(entry, now = Date.now()) {
  const type = labels[entry.kind];
  let text = `Hello${entry.name ? ' ' + entry.name : ''},\n\n`;
  if (entry.state === 'suppressed') return null;
  if (['subscribe', 'join', 'rsvp'].includes(entry.kind)) {
    text += `Please confirm your email for your ${type.toLowerCase()}:\n${link(entry, 'confirm', 172800, now)}\n\nThis confirmation link expires in two days. If you did not request this, you can ignore this email.\n`;
    if (entry.kind === 'rsvp')
      text += `\nEvent: ${entry.data.eventTitle}\nWhen: ${entry.data.eventDate}\nWhere: ${entry.data.location}\n\nCancel your RSVP: ${link(entry, 'cancel', 31536000, now)}\n`;
    if (entry.kind === 'subscribe')
      text += `\nUnsubscribe: ${link(entry, 'unsubscribe', 31536000, now)}\n`;
  } else
    text += `We received your ${type.toLowerCase()}. A club officer will review it.\n\n${entry.data.title || entry.data.topic}\n\nReference: ${entry.id}\n`;
  return {
    to: entry.email,
    subject: `Dallas AI Club: ${['subscribe', 'join', 'rsvp'].includes(entry.kind) ? 'confirm your email' : type + ' received'}`,
    text: text + '\nDallas College AI Club',
  };
}
export async function deliverJob(job, entry) {
  if (job.kind === 'notify') {
    const recipients = emailList(process.env.NOTIFICATION_EMAILS);
    if (!recipients.length)
      throw new Error('Notification recipients not configured');
    await sendEmail(
      {
        to: recipients,
        subject: `New ${labels[entry.kind].toLowerCase()} · Dallas AI Club`,
        text: `A new ${labels[entry.kind].toLowerCase()} was saved.\n\nName: ${entry.name || 'Not provided'}\nEmail: ${entry.email}\nReference: ${entry.id}\n\nReview it: ${process.env.AUTH_BASE_URL}/admin/#entry=${entry.id}\n\nThe full submission is available to authorized club officers.`,
      },
      `club-${job.id}`,
    );
  } else if (job.kind === 'receipt') {
    const message = receipt(entry, new Date(job.created_at).getTime());
    if (message) await sendEmail(message, `club-${job.id}`);
  } else if (job.kind === 'newsletter') {
    const client = mailClient();
    if (!process.env.RESEND_SEGMENT_ID)
      throw new Error('Newsletter segment not configured');
    const unsubscribed = entry.state !== 'active';
    const existing = await client.contacts.get({ email: entry.email });
    if (existing.error && existing.error.name !== 'not_found')
      throw new Error('Newsletter contact lookup failed');
    let result;
    if (existing.data)
      result = await client.contacts.update({
        email: entry.email,
        unsubscribed,
      });
    else
      result = await client.contacts.create({
        email: entry.email,
        unsubscribed,
      });
    if (result.error) throw new Error('Newsletter contact sync failed');
    const segment = await client.contacts.segments.add({
      email: entry.email,
      segmentId: process.env.RESEND_SEGMENT_ID,
    });
    if (segment.error) throw new Error('Newsletter segment sync failed');
  }
}
export async function drainOutbox(db, deliver = deliverJob, max = 8) {
  let sent = 0,
    failed = 0;
  const deadline = Date.now() + 25000;
  for (let i = 0; i < max && Date.now() < deadline; i++) {
    const { rows } =
      await db.query(`UPDATE club_forms.outbox SET locked_until=now()+interval '2 minutes',lease=gen_random_uuid(),attempts=attempts+1
      WHERE id=(SELECT id FROM club_forms.outbox WHERE sent_at IS NULL AND available_at<=now() AND (locked_until IS NULL OR locked_until<now())
        AND attempts<8 ORDER BY CASE kind WHEN 'receipt' THEN 0 WHEN 'newsletter' THEN 1 ELSE 2 END, created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
    const job = rows[0];
    if (!job) break;
    try {
      const run = async (tx) => {
        const entry = (
          await tx.query(
            'SELECT * FROM club_forms.entries WHERE id=$1' +
              (job.kind === 'newsletter' ? ' FOR UPDATE' : ''),
            [job.entry_id],
          )
        ).rows[0];
        await deliver(job, entry);
        await tx.query(
          `UPDATE club_forms.outbox SET sent_at=now(),locked_until=NULL,last_error=NULL WHERE id=$1 AND lease=$2`,
          [job.id, job.lease],
        );
      };
      // Serialize newsletter sync with confirmation/unsubscribe changes for this person.
      if (job.kind === 'newsletter') await db.transaction(run);
      else await run(db);
      sent++;
    } catch {
      // Keep delivery errors shown to officers generic.
      await db.query(
        `UPDATE club_forms.outbox SET locked_until=NULL,last_error='Delivery failed; check email settings and retry.',available_at=now()+$2 * interval '1 minute' WHERE id=$1 AND lease=$3`,
        [job.id, Math.min(60, 2 ** job.attempts), job.lease],
      );
      failed++;
    }
  }
  return { sent, failed };
}
