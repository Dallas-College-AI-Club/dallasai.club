import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { formsHandler, confirmations } from '../api/forms.mjs';
import { changeSubmission } from '../lib/submission-management.mjs';
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
  assert.equal(saved.name, 'Test Student');
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
  assert.equal((await (await post(rsvp)).json()).message, confirmations.rsvp);
  const again = await post({ ...rsvp, requestId: randomUUID() });
  assert.equal((await again.json()).message, confirmations.rsvp);
  assert.deepEqual((await rows()).map((row) => row.kind).sort(), [
    'contribution',
    'join',
    'rsvp',
    'subscribe',
    'workshop',
  ]);
  for (const saved of await rows())
    assert.equal(saved.name, 'Test Student', saved.kind);
});

test('every public form rejects missing or invalid names without saving', async () => {
  for (const kind of Object.keys(confirmations)) {
    for (const name of [
      undefined,
      '',
      '   ',
      null,
      123,
      {},
      'x'.repeat(101),
      '\u0001',
    ]) {
      const response = await post(form(kind, { name }));
      assert.equal(response.status, 400, kind);
      assert.match((await response.json()).error, /name/, kind);
    }
  }
  assert.deepEqual(await rows(), []);
});

test('a subscription saves its trimmed name and changed repeat details await officer review', async () => {
  const subscription = form('subscribe', { name: '  Reader Student  ' });
  const response = await post(subscription);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).message, confirmations.subscribe);
  assert.equal((await rows())[0].name, 'Reader Student');
  assert.equal(
    (await db.query('SELECT name FROM club_forms.contacts')).rows[0].name,
    'Reader Student',
  );
  await db.query("UPDATE club_forms.entries SET review_status='closed'");
  await post({ ...subscription, requestId: randomUUID() });
  assert.equal((await rows())[0].review_status, 'closed');
  assert.deepEqual(await resubmissions(), []);
  const changed = {
    ...subscription,
    name: 'Reader Student Jr',
    requestId: randomUUID(),
  };
  assert.equal(
    (await (await post(changed)).json()).message,
    confirmations.subscribe,
  );
  await post({ ...changed, requestId: randomUUID() });
  const saved = await rows();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Reader Student');
  assert.equal(saved[0].review_status, 'new');
  assert.deepEqual(await resubmissions(), [
    {
      action: 'resubmitted',
      actor: 'website',
      body: 'Unverified details submitted through the public website:\nName: Reader Student Jr',
    },
  ]);
});

test('an existing nameless subscription keeps its original record and flags a newly supplied name', async () => {
  await db.query(
    "INSERT INTO club_forms.entries(id,kind,email,dedupe_key,review_status) VALUES($1,'subscribe','student@example.edu','subscribe:student@example.edu','closed')",
    [randomUUID()],
  );
  const response = await post(form('subscribe'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).message, confirmations.subscribe);
  const saved = await rows();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, '');
  assert.equal(saved[0].review_status, 'new');
  assert.equal(
    (await resubmissions())[0].body,
    'Unverified details submitted through the public website:\nName: Test Student',
  );
});

test('RSVP replies do not reveal registration history when a potential event becomes confirmed', async () => {
  const event = events[0];
  event.potential = true;
  try {
    const request = form('rsvp', { eventId: event.id });
    const first = await (await post(request)).json();
    const repeat = await (
      await post({ ...request, requestId: randomUUID() })
    ).json();
    assert.deepEqual(repeat, first);
    event.potential = false;
    const existing = await (
      await post({ ...request, requestId: randomUUID() })
    ).json();
    const fresh = await (
      await post({
        ...request,
        email: 'new@example.edu',
        requestId: randomUUID(),
      })
    ).json();
    assert.deepEqual(existing, fresh);
    assert.equal(existing.message, confirmations.rsvp);
  } finally {
    delete event.potential;
  }
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
  const response = await post(
    form('join', { website: 'https://spam.example' }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await rows(), []);
});

const resubmissions = async () =>
  (
    await db.query(
      'SELECT a.action,a.actor,c.body FROM club_forms.audit a JOIN club_forms.entry_comments c ON c.id=a.comment_id ORDER BY a.id',
    )
  ).rows;
test('a repeated signup with new details reaches the officers; an identical one changes nothing', async () => {
  const signup = form('join', { interests: 'Robotics' });
  assert.equal((await (await post(signup)).json()).message, confirmations.join);
  await db.query("UPDATE club_forms.entries SET review_status='closed'");
  const same = await post({
    ...signup,
    email: ' STUDENT@example.edu ',
    requestId: randomUUID(),
  });
  assert.equal((await same.json()).message, confirmations.join);
  assert.equal((await rows())[0].review_status, 'closed');
  assert.deepEqual(await resubmissions(), []);
  const changed = {
    ...signup,
    requestId: randomUUID(),
    name: 'Test Student Jr',
    campus: 'Eastfield',
    interests: '',
  };
  const updated = await post(changed);
  assert.equal(updated.status, 200);
  // The usual reply: the form must not reveal that the address was known.
  assert.equal((await updated.json()).message, confirmations.join);
  const [saved, ...others] = await rows();
  assert.equal(others.length, 0);
  assert.equal(saved.review_status, 'new');
  assert.equal(saved.name, 'Test Student');
  assert.deepEqual(saved.data, { campus: 'Richland', interests: 'Robotics' });
  // Anyone can type an address, so the note is the website's, not the member's.
  assert.deepEqual(await resubmissions(), [
    {
      action: 'resubmitted',
      actor: 'website',
      body: 'Unverified details submitted through the public website:\nName: Test Student Jr\nCampus: Eastfield\nInterests: (blank)',
    },
  ]);
  assert.deepEqual(
    (
      await db.query('SELECT author_email FROM club_forms.entry_comments')
    ).rows.map((r) => r.author_email),
    ['website'],
  );
  // Sending the same new details again adds nothing for officers to redo.
  await db.query("UPDATE club_forms.entries SET review_status='reviewed'");
  const again = await post({ ...changed, requestId: randomUUID() });
  assert.equal((await again.json()).message, confirmations.join);
  assert.equal((await rows())[0].review_status, 'reviewed');
  assert.equal((await resubmissions()).length, 1);
  // An identical newsletter signup adds no new details for officers to review.
  const subscribe = form('subscribe');
  for (const requestId of [subscribe.requestId, randomUUID()])
    assert.equal(
      (await (await post({ ...subscribe, requestId })).json()).message,
      confirmations.subscribe,
    );
  assert.equal((await resubmissions()).length, 1);
});

test('after a resubmission and a permanent delete, no audit row names the member', async () => {
  const signup = form('join', { interests: 'Robotics' });
  await post(signup);
  await post({ ...signup, requestId: randomUUID(), interests: 'Art' });
  const entry = (
    await db.query('SELECT id,edit_revision FROM club_forms.entries')
  ).rows[0];
  await db.query("UPDATE club_forms.entries SET review_status='closed'");
  const deleted = await changeSubmission(
    db,
    {
      action: 'delete-submission',
      entryId: entry.id,
      requestId: randomUUID(),
      expectedRevision: entry.edit_revision,
    },
    'officer@example.com',
  );
  assert.equal(deleted.deleted, true);
  const audit = (await db.query('SELECT * FROM club_forms.audit')).rows;
  assert.deepEqual(audit.map((r) => r.action).sort(), [
    'resubmitted',
    'submission-permanently-deleted',
  ]);
  assert.ok(
    !JSON.stringify(audit).toLowerCase().includes('student@example.edu'),
    JSON.stringify(audit),
  );
});

test('one address can send 60 public forms an hour before it is limited', async () => {
  process.env.FORM_TOKEN_SECRET = 'forms-quota-test-' + 'x'.repeat(40);
  const limited = http.createServer(
    formsHandler({ getDatabase: () => db, getEvents: async () => events }),
  );
  await new Promise((resolve) => limited.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${limited.address().port}/api/forms`;
  try {
    const statuses = [];
    // The spam trap answers without saving, so only the quota is exercised.
    for (let i = 0; i < 61; i++)
      statuses.push(
        (
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: site },
            body: JSON.stringify(form('join', { website: 'x' })),
          })
        ).status,
      );
    assert.deepEqual(statuses, [...Array(60).fill(200), 429]);
  } finally {
    await new Promise((resolve) => limited.close(resolve));
  }
});
