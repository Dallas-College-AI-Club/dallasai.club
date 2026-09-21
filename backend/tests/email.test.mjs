import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { applyEmailEvent } from '../lib/email-events.mjs';
import { deliverJob } from '../lib/mail.mjs';
let db;
before(async () => {
  db = new PGlite();
  await db.exec(
    await readFile(new URL('../003_club_forms.sql', import.meta.url), 'utf8'),
  );
});
beforeEach(async () => {
  await db.exec(
    'TRUNCATE club_forms.entries,club_forms.webhook_events CASCADE',
  );
});
after(async () => db.close());
test('provider unsubscribe and bounce events update Neon; repeated events cannot overwrite a later confirmation', async () => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO club_forms.entries(id,kind,email,dedupe_key,state,updated_at) VALUES($1,'subscribe','reader@example.com','reader','active','2026-01-01')",
    [id],
  );
  const event = {
    type: 'contact.updated',
    created_at: '2026-02-01T00:00:00Z',
    data: { email: 'reader@example.com', unsubscribed: true },
  };
  await applyEmailEvent(db, event, 'event-1');
  assert.equal(
    (await db.query('SELECT state FROM club_forms.entries')).rows[0].state,
    'unsubscribed',
  );
  await db.query(
    "UPDATE club_forms.entries SET state='active',updated_at='2026-03-01'",
  );
  await applyEmailEvent(db, event, 'event-1');
  await applyEmailEvent(db, event, 'old-event-2');
  assert.equal(
    (await db.query('SELECT state FROM club_forms.entries')).rows[0].state,
    'active',
  );
  await applyEmailEvent(
    db,
    {
      type: 'email.complained',
      created_at: '2026-04-01T00:00:00Z',
      data: { to: ['reader@example.com'] },
    },
    'event-3',
  );
  assert.equal(
    (await db.query('SELECT state FROM club_forms.entries')).rows[0].state,
    'suppressed',
  );
});
test('officer notification uses configured recipients and a stable idempotency key', async (t) => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.MAIL_FROM = 'Club <club@example.com>';
  process.env.NOTIFICATION_EMAILS = 'officer@example.com';
  process.env.AUTH_BASE_URL = 'https://admin.example.com';
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options };
    return Response.json({ id: 'mail-id' });
  });
  const id = randomUUID();
  await deliverJob(
    { id, kind: 'notify' },
    { id, kind: 'join', name: 'Student', email: 'student@example.com' },
  );
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.to, ['officer@example.com']);
  assert.ok(body.text.includes('https://admin.example.com/admin/#entry=' + id));
  assert.equal(
    new Headers(request.options.headers).get('idempotency-key'),
    'club-' + id,
  );
  assert.ok(request.options.signal);
});
test('newsletter sync creates only the confirmed contact and adds it to the dedicated segment', async (t) => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.MAIL_FROM = 'Club <club@example.com>';
  process.env.RESEND_SEGMENT_ID = 'review-segment';
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === 'GET')
      return Response.json(
        { name: 'not_found', message: 'Not found' },
        { status: 404 },
      );
    return Response.json({ id: 'contact-id' });
  });
  await deliverJob(
    { kind: 'newsletter' },
    { state: 'active', email: 'reader@example.com' },
  );
  const create = calls.find(
    (call) => call.url.endsWith('/contacts') && call.options.method === 'POST',
  );
  assert.equal(JSON.parse(create.options.body).unsubscribed, false);
  assert.ok(calls.some((call) => call.url.includes('review-segment')));
  calls.length = 0;
  await deliverJob(
    { kind: 'newsletter' },
    { state: 'unsubscribed', email: 'reader@example.com' },
  );
  assert.equal(
    JSON.parse(
      calls.find((call) => call.url.endsWith('/contacts')).options.body,
    ).unsubscribed,
    true,
  );
});
