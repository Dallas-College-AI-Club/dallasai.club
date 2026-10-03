import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { formsHandler, confirmations } from '../api/forms.mjs';
import { testDatabase } from './helpers/db.mjs';

// The public forms post to this handler. These checks run it end to end and
// read back what reached the database that Club Office reads from.
let db, server, origin;
const site = 'http://127.0.0.1:4174';
const events = [
  { id: 'meetup', date: '2099-09-24T17:00:00-05:00', title: 'Club meetup' },
];
const form = (kind, extra = {}) => ({
  kind,
  email: 'Student@Example.edu',
  name: 'Test Student',
  campus: 'Richland',
  consent: true,
  requestId: randomUUID(),
  ...extra,
});
const post = (body, from = site) =>
  fetch(origin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: from },
    body: JSON.stringify(body),
  });
const rows = async () =>
  (
    await db.query(
      'SELECT kind,email,name,data,review_status FROM club_forms.entries ORDER BY created_at,id',
    )
  ).rows;
before(async () => {
  delete process.env.VERCEL;
  db = await testDatabase();
  server = http.createServer(
    formsHandler({
      getDatabase: () => db,
      getEvents: async () => events,
      rateLimit: async () => {},
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}/api/forms`;
});
beforeEach(() =>
  db.exec('TRUNCATE club_forms.entries,club_forms.contacts CASCADE'),
);
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

test('a question reaches the inbox as New, linked to its event and its contact', async () => {
  const response = await post(
    form('question', {
      subject: 'Parking',
      message: 'Is parking free at the meetup?',
      eventId: 'meetup',
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).message, confirmations.question);
  const [saved] = await rows();
  assert.equal(saved.kind, 'question');
  assert.equal(saved.email, 'student@example.edu');
  assert.equal(saved.review_status, 'new');
  assert.equal(saved.data.subject, 'Parking');
  assert.equal(saved.data.eventId, 'meetup');
  const contact = await db.query(
    'SELECT contact_email FROM club_forms.contact_emails WHERE email=$1',
    ['student@example.edu'],
  );
  assert.equal(contact.rows.length, 1);
});

test('signups, RSVPs and requests are each saved once and confirmed', async () => {
  for (const [kind, extra] of [
    ['join', {}],
    ['subscribe', {}],
    ['workshop', { topic: 'AI and art' }],
    ['contribution', { title: 'A draft', body: 'Draft text' }],
  ]) {
    const response = await post(form(kind, extra));
    assert.equal(response.status, 200, kind);
    assert.equal((await response.json()).message, confirmations[kind]);
  }
  const rsvp = form('rsvp', { eventId: 'meetup' });
  assert.equal(
    (await (await post(rsvp)).json()).message,
    confirmations.rsvp,
  );
  const again = await post({ ...rsvp, requestId: randomUUID() });
  assert.match((await again.json()).message, /already have an RSVP/);
  assert.deepEqual(
    (await rows()).map((row) => row.kind).sort(),
    ['contribution', 'join', 'rsvp', 'subscribe', 'workshop'],
  );
});

test('rejected submissions save nothing', async () => {
  const unknownEvent = await post(form('rsvp', { eventId: 'invented' }));
  assert.equal(unknownEvent.status, 400);
  const otherSite = await post(form('join'), 'https://elsewhere.example');
  assert.equal(otherSite.status, 403);
  const noConsent = await post(form('join', { consent: false }));
  assert.equal(noConsent.status, 400);
  assert.deepEqual(await rows(), []);
});

test('the spam trap answers politely and saves nothing', async () => {
  const response = await post(form('join', { website: 'https://spam.example' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await rows(), []);
});
