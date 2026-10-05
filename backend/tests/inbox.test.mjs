// The Inbox list, record, bulk review, sweep, RSVP/newsletter state and CSV
// (Club Office step 3).
import { testDatabase } from './helpers/db.mjs';
import test, { before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { adminHandler } from '../api/admin.mjs';
import { RequestError } from '../lib/errors.mjs';
import { submit } from '../lib/submissions.mjs';
process.env.FORM_TOKEN_SECRET = 'inbox-step-three-' + 'x'.repeat(40);
let db, server, origin;
const events = [
  { id: 'past', title: 'Past', date: '2020-01-01' },
  { id: 'next', title: 'Next event', date: '2099-01-01' },
];
const officers = ['admin@example.com', 'second-admin@example.com'];
const authorize = (req) => {
  if (req.headers['x-test-admin'] === 'yes') return { email: officers[0] };
  if (req.headers['x-test-admin'] === 'second') return { email: officers[1] };
  throw new RequestError(401, 'Sign in');
};
const request = (route, body, admin = 'yes') =>
  fetch(origin + route, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-test-admin': admin,
      ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const list = async (query = '') => {
  const response = await request('/api/admin' + query);
  assert.equal(response.status, 200, query);
  return response.json();
};
const post = async (body, admin) => {
  const response = await request('/api/admin', body, admin);
  return { status: response.status, body: await response.json() };
};
const insert = async ({
  kind = 'question',
  email = 'member@example.edu',
  name = 'Member',
  data = {},
  created = '2026-01-01T00:00:00Z',
  status = 'new',
  state = 'active',
} = {}) => {
  const id = randomUUID();
  await db.query(
    'INSERT INTO club_forms.entries(id,kind,email,name,data,dedupe_key,created_at,updated_at,review_status,state) VALUES($1::uuid,$2,$3,$4,$5,$1::text,$6,$6,$7,$8)',
    [id, kind, email, name, JSON.stringify(data), created, status, state],
  );
  return id;
};
const audit = async () =>
  (
    await db.query(
      'SELECT actor,entry_id,action FROM club_forms.audit ORDER BY id',
    )
  ).rows;
const row = async (id) =>
  (await db.query('SELECT * FROM club_forms.entries WHERE id=$1', [id]))
    .rows[0];
const ref = (email) =>
  createHmac('sha256', process.env.FORM_TOKEN_SECRET)
    .update(email)
    .digest('hex')
    .slice(0, 16);
before(async () => {
  db = await testDatabase();
  const handler = adminHandler({
    getDatabase: () => db,
    authorize,
    getEvents: async () => events,
    storage: {},
  });
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
});
beforeEach(() =>
  db.exec(
    'TRUNCATE club_forms.entries,club_forms.contacts RESTART IDENTITY CASCADE',
  ),
);
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

test('questions and requests filter combines questions and workshops across list, poll and CSV', async () => {
  const question = await insert({ name: 'Question member' });
  const requestId = await insert({
    kind: 'workshop',
    name: 'Workshop member',
    status: 'reviewed',
  });
  await insert({ kind: 'join', name: 'Signup member' });
  await insert({
    kind: 'workshop',
    name: 'Archived workshop',
    status: 'closed',
  });
  const query = 'kind=questions-requests&status=active';
  const result = await list('?' + query);
  assert.equal(result.total, 2);
  assert.deepEqual(
    new Set(result.entries.map((entry) => entry.id)),
    new Set([question, requestId]),
  );
  assert.equal((await list('?counts=1&' + query)).newInView, 0);
  const csv = await (await request('/api/admin?export=csv&' + query)).text();
  for (const name of ['Question member', 'Workshop member'])
    assert.ok(csv.includes(name));
  for (const name of ['Signup member', 'Archived workshop'])
    assert.ok(!csv.includes(name));
});

test('search matches message text across statuses; total counts the whole filtered set', async () => {
  const parking = await insert({
    data: { subject: 'Venue', message: 'Is there Parking near the venue?' },
    status: 'reviewed',
  });
  const signup = await insert({
    kind: 'join',
    email: 'robot@example.edu',
    data: { campus: 'Richland', interests: 'parking-lot robotics' },
    status: 'closed',
  });
  await insert({ data: { subject: 'Lunch', message: 'Is lunch provided?' } });
  await insert({ name: 'Ava Chen', data: { subject: 'Hi', message: 'Hello' } });
  const ids = (body) => body.entries.map((entry) => entry.id).sort();
  const found = await list('?q=' + encodeURIComponent('  PARKING '));
  assert.deepEqual(ids(found), [parking, signup].sort());
  assert.equal(found.total, 2);
  assert.deepEqual(ids(await list('?status=all&q=parking')), ids(found));
  assert.equal((await list('?status=new&q=parking')).total, 0);
  assert.deepEqual(
    (await list('?status=reviewed&q=parking')).entries.map((e) => e.id),
    [parking],
  );
  assert.equal((await list('?q=ava%20ch')).total, 1);
  assert.equal((await list('?q=robot%40example')).total, 1);
  assert.equal((await list('?q=no%20such%20words')).entries.length, 0);
  // The counts are unchanged by a search.
  assert.equal(found.counts.find((c) => c.kind === 'question').total, 3);
  assert.equal((await request('/api/admin?q=' + 'x'.repeat(201))).status, 400);
  // Control characters are refused, never a server error.
  for (const q of ['a\u0000b', 'a\u0007b', 'a\nb'])
    for (const route of ['/api/admin?q=', '/api/admin?export=csv&q='])
      assert.equal(
        (await request(route + encodeURIComponent(q))).status,
        400,
        JSON.stringify(q),
      );
  // Postgres lowercases the search and the text alike (JavaScript turns İ
  // into i plus a combining dot, and ends a Greek word with ς).
  const trip = await insert({
    data: { subject: 'Trip', message: 'Flight to İSTANBUL, then ΟΔΟΣ tour' },
  });
  for (const q of ['İstanbul', 'istanbul', 'ΟΔΟΣ', 'οδοσ'])
    assert.deepEqual(
      (await list('?q=' + encodeURIComponent(q))).entries.map((e) => e.id),
      [trip],
      q,
    );
  await db.query('DELETE FROM club_forms.entries WHERE id=$1', [trip]);
  // total is the whole filtered set, not the page.
  await db.query(
    "INSERT INTO club_forms.entries(id,kind,email,dedupe_key,data) SELECT gen_random_uuid(),'question','bulk-'||n||'@example.edu','bulk-'||n,'{\"message\":\"parking again\"}' FROM generate_series(1,60) n",
  );
  const many = await list('?q=parking');
  assert.equal(many.entries.length, 50);
  assert.equal(many.hasMore, true);
  assert.equal(many.total, 62);
  assert.equal(many.newInView, 60);
  assert.equal((await list('?q=parking&offset=50')).newInView, 60);
  assert.equal((await list('')).total, 64);
  assert.ok(Number.isFinite(Date.parse(many.asOf)));
});

test('rsvp-all lists past and upcoming RSVPs; status=all is the same as no status', async () => {
  const upcoming = await insert({
    kind: 'rsvp',
    data: { eventId: 'next', eventTitle: 'Next event' },
  });
  const past = await insert({
    kind: 'rsvp',
    email: 'past@example.edu',
    data: { eventId: 'past', eventTitle: 'Past' },
    status: 'closed',
  });
  await insert();
  const ids = async (query) =>
    (await list(query)).entries.map((entry) => entry.id).sort();
  assert.deepEqual(await ids('?kind=rsvp-all'), [upcoming, past].sort());
  assert.deepEqual(await ids('?kind=rsvp'), [upcoming]);
  assert.deepEqual(await ids('?kind=rsvp-past'), [past]);
  assert.deepEqual(await ids('?kind=rsvp-all&eventId=past'), [past]);
  assert.deepEqual(await ids('?status=all'), await ids(''));
  assert.equal((await list('?kind=rsvp-all&status=all')).total, 2);
  // The counts poll accepts the same filters.
  const poll = await list(
    '?counts=1&since=2025-12-31T00:00:00Z&kind=rsvp-all&status=all',
  );
  assert.equal(poll.arrivedInView, 2);
  assert.equal(poll.newInView, 0);
  for (const [query, expected] of [
    ['kind=rsvp-all&status=active', 0],
    ['kind=rsvp-all&eventId=past', 0],
    ['kind=rsvp&eventId=next', 0],
    ['kind=rsvp-past', 0],
    ['status=reviewed', 0],
    ['status=closed', 0],
    ['kind=join', 0],
  ]) {
    assert.equal((await list('?' + query)).newInView, expected, query);
    assert.equal((await list('?counts=1&' + query)).newInView, expected, query);
  }
  for (const query of ['?status=everything', '?kind=rsvp-any'])
    assert.equal((await request('/api/admin' + query)).status, 400);
});

test('Active filters list, event totals, arrivals and CSV to New plus Reviewed', async () => {
  const fresh = await insert({
    kind: 'rsvp',
    name: 'New RSVP',
    data: { eventId: 'next', eventTitle: 'Next event' },
  });
  const reviewed = await insert({
    kind: 'rsvp',
    name: 'Reviewed RSVP',
    status: 'reviewed',
    data: { eventId: 'past', eventTitle: 'Past event' },
  });
  const cancelled = await insert({
    kind: 'rsvp',
    name: 'Cancelled RSVP',
    state: 'cancelled',
    data: { eventId: 'next', eventTitle: 'Next event' },
  });
  const archived = await insert({
    kind: 'rsvp',
    name: 'Archived RSVP',
    status: 'closed',
    data: { eventId: 'next', eventTitle: 'Next event' },
  });
  await insert({ name: 'Other category' });
  const filter = 'kind=rsvp-all&status=active',
    active = await list('?' + filter);
  assert.deepEqual(
    active.entries.map((entry) => entry.id).sort(),
    [fresh, reviewed, cancelled].sort(),
  );
  // Cancelled is an RSVP business state, not an Inbox archive status.
  assert.equal(active.total, 3);
  assert.deepEqual(active.eventCounts, { next: 2, past: 1 });
  assert.equal(active.counts.find((row) => row.kind === 'rsvp').closed, 1);
  assert.equal((await list('?' + filter + '&eventId=past')).total, 1);
  assert.equal((await list('?' + filter + '&q=Reviewed')).total, 1);
  assert.equal(
    (await list('?counts=1&since=2025-12-31T00:00:00Z&' + filter))
      .arrivedInView,
    3,
  );
  const response = await request('/api/admin?export=csv&' + filter);
  assert.equal(response.status, 200);
  const csv = await response.text();
  for (const name of ['New RSVP', 'Reviewed RSVP', 'Cancelled RSVP'])
    assert.ok(csv.includes(name), name);
  for (const name of ['Archived RSVP', 'Other category'])
    assert.ok(!csv.includes(name), name);
  assert.deepEqual(
    (await list('?kind=rsvp-all&status=closed')).entries.map(
      (entry) => entry.id,
    ),
    [archived],
  );
  assert.equal((await list('?kind=rsvp-all&status=all')).total, 4);
});

test('sort=oldest reverses the list, ties broken by id', async () => {
  const times = ['2026-01-03', '2026-01-01', '2026-01-02', '2026-01-02'];
  const ids = [];
  for (const created of times) ids.push(await insert({ created }));
  const tied = [ids[2], ids[3]].sort();
  const oldest = (await list('?sort=oldest')).entries.map((e) => e.id);
  assert.deepEqual(oldest, [ids[1], ...tied, ids[0]]);
  const newest = (await list('?sort=newest')).entries.map((e) => e.id);
  assert.deepEqual(newest, [ids[0], ...tied, ids[1]]);
  assert.deepEqual(
    (await list('')).entries.map((e) => e.id),
    newest,
  );
  assert.equal((await request('/api/admin?sort=random')).status, 400);
});

test('Show more uses a cursor: rows archived or added between pages are never skipped or repeated', async () => {
  // 55 new questions; the last 12 share one time, across the page boundary.
  const all = [];
  for (let n = 0; n < 55; n++)
    all.push(
      await insert({
        created:
          n < 43
            ? new Date(Date.UTC(2026, 0, 2) - n * 60000).toISOString()
            : '2026-01-01T00:00:00Z',
      }),
    );
  const first = await list('?status=new');
  assert.equal(first.entries.length, 50);
  assert.equal(first.total, 55);
  assert.equal(first.hasMore, true);
  const last = first.entries[49];
  assert.match(first.nextBefore, /^\d{4}-\d\d-\d\dT[\d:.]+Z\|[0-9a-f-]{36}$/);
  assert.equal(first.nextBefore.split('|')[1], last.id);
  // Meanwhile: three rows on the first page are archived, one row arrives.
  const archived = first.entries.slice(10, 13).map((entry) => entry.id);
  const bulk = await post({
    action: 'review',
    status: 'closed',
    items: archived.map((id) => ({ id, from: 'new' })),
  });
  assert.deepEqual(bulk.body.saved, archived);
  await insert({ created: '2026-02-01T00:00:00Z' });
  const second = await list(
    '?status=new&before=' + encodeURIComponent(first.nextBefore),
  );
  assert.equal(second.entries.length, 5);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextBefore, null);
  assert.equal(second.total, 53);
  const seen = [...first.entries, ...second.entries].map((entry) => entry.id);
  assert.equal(new Set(seen).size, seen.length);
  assert.deepEqual([...seen].sort(), [...all].sort());
  // A cursor built from the row's JSON time and id gives the same page.
  const built = await list(
    '?status=new&before=' + encodeURIComponent(last.created_at + '|' + last.id),
  );
  assert.deepEqual(built.entries, second.entries);
  // Times one microsecond apart in the same millisecond still page in order,
  // although JSON shows them to the millisecond.
  const micro = [];
  for (const time of ['.123456', '.123400', '.123300'])
    micro.push(
      await insert({
        kind: 'workshop',
        created: '2026-03-01T00:00:00' + time + 'Z',
      }),
    );
  const workshops = await list('?kind=workshop');
  assert.deepEqual(
    workshops.entries.map((entry) => entry.id),
    micro,
  );
  const [top, , bottom] = workshops.entries;
  const after = await list(
    '?kind=workshop&before=' +
      encodeURIComponent(top.created_at + '|' + top.id),
  );
  assert.deepEqual(
    after.entries.map((entry) => entry.id),
    micro.slice(1),
  );
  const oldest = await list(
    '?kind=workshop&sort=oldest&before=' +
      encodeURIComponent(bottom.created_at + '|' + bottom.id),
  );
  assert.deepEqual(
    oldest.entries.map((entry) => entry.id),
    [micro[1], micro[0]],
  );
  for (const cursor of [
    'abc',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z|nope',
    'Oct 3 2026|' + last.id,
    '2026-02-31T00:00:00Z|' + last.id,
    '0000-01-01T00:00:00Z|' + last.id,
    // Postgres refuses offsets of 16 hours or more.
    '2026-01-01T00:00:00+16:00|' + last.id,
    '2026-01-01T00:00+23:59|' + last.id,
    '2026-01-01T00:00:00Z|' + last.id + '|' + last.id,
  ])
    assert.equal(
      (await request('/api/admin?before=' + encodeURIComponent(cursor))).status,
      400,
      cursor,
    );
  assert.equal(
    (
      await request(
        '/api/admin?before=' +
          encodeURIComponent('2026-01-01T00:00:00-15:30|' + last.id),
      )
    ).status,
    200,
  );
  // Past the last row: no entries, and the totals are still there.
  const end = await list(
    '?status=new&kind=question&before=' +
      encodeURIComponent('2000-01-01T00:00:00Z|' + randomUUID()),
  );
  assert.deepEqual(end.entries, []);
  assert.equal(end.hasMore, false);
  assert.equal(end.total, 53);
  assert.ok(Date.parse(end.asOf));
});

test('when the cursor row is deleted, Show more may repeat a row but never skips one', async () => {
  // 53 questions; three share one microsecond time at the page boundary.
  const all = [];
  for (let n = 0; n < 53; n++)
    all.push(
      await insert({
        email: `b${n}@example.edu`,
        created:
          n >= 48 && n <= 50
            ? '2026-01-01T23:59:12.123456Z'
            : n > 50
              ? '2026-01-01T23:00:00Z'
              : new Date(Date.UTC(2026, 0, 2) - n * 1000).toISOString(),
      }),
    );
  const first = await list('');
  const last = first.entries[49];
  await db.query('DELETE FROM club_forms.entries WHERE id=$1', [last.id]);
  const expected = all.filter((id) => id !== last.id).sort();
  const shown = (page) => [...first.entries, ...page.entries].map((e) => e.id);
  // nextBefore carries the exact time: no repeats, no gaps.
  const exact = shown(
    await list('?before=' + encodeURIComponent(first.nextBefore)),
  );
  assert.equal(new Set(exact).size, exact.length);
  assert.deepEqual(
    [...new Set(exact)].filter((id) => id !== last.id).sort(),
    expected,
  );
  // A cursor from the JSON time is widened to its whole millisecond.
  for (const time of [
    last.created_at,
    last.created_at.replace(/\.\d+Z$/, 'Z'),
  ]) {
    const widened = shown(
      await list('?before=' + encodeURIComponent(time + '|' + last.id)),
    );
    assert.deepEqual(
      [...new Set(widened)].filter((id) => id !== last.id).sort(),
      expected,
      time,
    );
  }
});

test('summary=1 cuts long text to 300 characters and marks the entry', async () => {
  const draft = 'Draft '.repeat(500);
  const id = await insert({
    kind: 'contribution',
    data: { title: 'Article title', body: draft },
  });
  const emoji = await insert({
    created: '2025-12-01T00:00:00Z',
    data: {
      subject: 'Emoji',
      message: 'a'.repeat(299) + '😀' + 'b'.repeat(50),
    },
  });
  const short = await insert({
    created: '2025-11-01T00:00:00Z',
    data: { subject: 'Short', message: 'x'.repeat(300) },
  });
  const byId = async (query) =>
    Object.fromEntries(
      (await list(query)).entries.map((entry) => [entry.id, entry.data]),
    );
  const summary = await byId('?summary=1');
  assert.equal(summary[id].body, draft.slice(0, 300));
  assert.equal(summary[id].title, 'Article title');
  assert.equal(summary[id]._truncated, true);
  assert.equal(summary[emoji].message, 'a'.repeat(299));
  assert.equal(summary[emoji]._truncated, true);
  assert.equal(summary[short]._truncated, undefined);
  assert.equal(summary[short].message.length, 300);
  const full = await byId('');
  assert.equal(full[id].body, draft);
  assert.equal(full[id]._truncated, undefined);
  // The record still has everything.
  const record = await list('?edit=' + id);
  assert.equal(record.entry.data.body, draft);
});

test('rows carry note count, last review and a contact summary without the email in the ref', async () => {
  const primary = 'student@school.edu',
    alias = 'personal@example.com';
  const older = await insert({ email: alias, created: '2025-12-01T00:00:00Z' });
  const id = await insert({ email: primary, created: '2026-01-02T00:00:00Z' });
  await insert({
    kind: 'join',
    email: primary,
    created: '2025-11-01T00:00:00Z',
    data: { campus: 'Richland' },
  });
  const loner = await insert({ email: 'new@example.edu' });
  await db.query(
    'UPDATE club_forms.contact_emails SET contact_email=$1 WHERE email=$2',
    [primary, alias],
  );
  await db.query(
    'INSERT INTO club_forms.contact_notes(id,email,author_email,body) VALUES($1,$2,$3,$4)',
    [randomUUID(), alias, officers[1], 'Met at the fair'],
  );
  await post({ action: 'review', id, status: 'closed' }, 'second');
  await post({ action: 'review', id, status: 'reviewed' });
  // Notes added after the review are not reviews.
  for (const commentId of [randomUUID(), randomUUID()])
    await post(
      { action: 'comment', id, commentId, comment: 'Called back' },
      'second',
    );
  const entries = Object.fromEntries(
    (await list('')).entries.map((entry) => [entry.id, entry]),
  );
  const entry = entries[id];
  assert.equal(entry.comment_count, 2);
  assert.equal(entry.last_review.action, 'review:reviewed');
  assert.equal(entry.last_review.actor, officers[0]);
  assert.ok(Date.parse(entry.last_review.at));
  assert.deepEqual(entry.contact, {
    ref: ref(primary),
    other_submissions: 2,
    notes: 1,
    deleted_at: null,
  });
  assert.match(entry.contact.ref, /^[0-9a-f]{16}$/);
  // The alias's own submission belongs to the same person.
  assert.equal(entries[older].contact.ref, ref(primary));
  assert.equal(entries[older].contact.other_submissions, 2);
  assert.equal(entries[loner].comment_count, 0);
  assert.equal(entries[loner].last_review, null);
  assert.deepEqual(entries[loner].contact, {
    ref: ref('new@example.edu'),
    other_submissions: 0,
    notes: 0,
    deleted_at: null,
  });
  await db.query(
    "UPDATE club_forms.contacts SET deleted_at='2026-02-01T00:00:00Z' WHERE email=$1",
    [primary],
  );
  const deleted = (await list('?id=' + id)).entries[0];
  assert.equal(
    Date.parse(deleted.contact.deleted_at),
    Date.parse('2026-02-01T00:00:00Z'),
  );
});

test('the record adds attachments, survey state and the person behind it', async () => {
  const primary = 'student@school.edu',
    alias = 'personal@example.com';
  const rsvp = await insert({
    kind: 'rsvp',
    email: alias,
    created: '2026-01-05T00:00:00Z',
    data: { eventId: 'next', eventTitle: 'Next event', hasSurvey: true },
  });
  const others = [];
  for (const [kind, created, data] of [
    ['question', '2026-01-04', { subject: 'Parking', message: 'Where?' }],
    ['contribution', '2026-01-03', { title: 'My article', body: 'Text' }],
    ['workshop', '2026-01-02', { topic: 'Agents', details: '' }],
    ['subscribe', '2026-01-01', {}],
  ])
    others.push(await insert({ kind, email: primary, created, data }));
  await db.query(
    'UPDATE club_forms.contact_emails SET contact_email=$1 WHERE email=$2',
    [primary, alias],
  );
  await db.query(
    "UPDATE club_forms.contacts SET name='Ava Chen',is_test=true WHERE email=$1",
    [primary],
  );
  await db.query(
    "INSERT INTO club_forms.contact_notes(id,email,author_email,body,created_at) VALUES($1,$2,$3,'Older note','2026-01-01'),($4,$5,$6,$7,'2026-01-06')",
    [
      randomUUID(),
      primary,
      officers[0],
      randomUUID(),
      alias,
      officers[1],
      'N'.repeat(250),
    ],
  );
  await db.query(
    "INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,survey_version,questions,answers) VALUES($1,'next','Next event','v1','[]','[]')",
    [rsvp],
  );
  await db.query(
    "INSERT INTO club_forms.survey_response_state(entry_id,starred,updated_by,updated_at) VALUES($1,true,$2,'2026-01-07')",
    [rsvp, officers[1]],
  );
  const file = randomUUID();
  await db.query(
    "INSERT INTO club_forms.attachments(id,entry_id,name,pathname,content_type,size) VALUES($1,$2,'notes.pdf','x/notes.pdf','application/pdf',2048)",
    [file, rsvp],
  );
  const record = await list('?edit=' + rsvp);
  assert.equal(record.entry.id, rsvp);
  assert.equal(record.entry.survey.event_id, 'next');
  assert.equal(record.entry.attachments, undefined);
  assert.deepEqual(record.attachments, [
    { id: file, name: 'notes.pdf', size: 2048 },
  ]);
  assert.equal(record.survey_state.starred, true);
  assert.equal(record.survey_state.archived_at, null);
  assert.equal(record.survey_state.updated_by, officers[1]);
  assert.ok(Date.parse(record.survey_state.updated_at));
  const { contact } = record;
  assert.equal(contact.ref, ref(primary));
  assert.equal(contact.email, primary);
  assert.equal(contact.name, 'Ava Chen');
  assert.equal(contact.is_test, true);
  assert.equal(contact.deleted_at, null);
  assert.equal(contact.submission_count, 5);
  assert.equal(contact.note_count, 2);
  assert.equal(contact.last_note.author_email, officers[1]);
  assert.equal(contact.last_note.body, 'N'.repeat(200));
  assert.ok(Date.parse(contact.last_note.created_at));
  assert.deepEqual(
    contact.submissions.map((item) => [item.id, item.kind, item.subject]),
    [
      [others[0], 'question', 'Parking'],
      [others[1], 'contribution', 'My article'],
      [others[2], 'workshop', 'Agents'],
    ],
  );
  assert.equal(contact.submissions[0].review_status, 'new');
  assert.ok(Date.parse(contact.submissions[0].created_at));
  // Without attachments or survey state.
  const plain = await list('?edit=' + others[3]);
  assert.deepEqual(plain.attachments, []);
  assert.equal(plain.survey_state, null);
  assert.deepEqual(
    plain.contact.submissions.map((item) => item.id),
    [rsvp, others[0], others[1]],
  );
});

test('bulk review saves what is unchanged and reports items another officer changed first', async () => {
  const [a, b, c] = [
    await insert({ name: 'Ava' }),
    await insert({ name: 'Ben' }),
    await insert({ name: 'Cam' }),
  ];
  const gone = randomUUID();
  await post({ action: 'review', id: c, status: 'closed' }, 'second');
  const result = await post({
    action: 'review',
    status: 'reviewed',
    items: [
      { id: a, from: 'new' },
      { id: c, from: 'new' },
      { id: b.toUpperCase(), from: 'new' },
      { id: gone, from: 'new' },
    ],
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.saved, [a, b]);
  assert.equal(result.body.skipped.length, 2);
  const [stale, missing] = result.body.skipped;
  assert.equal(stale.id, c);
  assert.equal(stale.status, 'closed');
  assert.equal(stale.actor, officers[1]);
  assert.ok(Date.parse(stale.at));
  assert.deepEqual(missing, { id: gone, status: null, actor: null, at: null });
  assert.equal((await row(a)).review_status, 'reviewed');
  assert.equal((await row(b)).review_status, 'reviewed');
  assert.equal((await row(c)).review_status, 'closed');
  assert.deepEqual(await audit(), [
    { actor: officers[1], entry_id: c, action: 'review:closed' },
    { actor: officers[0], entry_id: a, action: 'review:reviewed' },
    { actor: officers[0], entry_id: b, action: 'review:reviewed' },
  ]);
  // Undo: the inverse items, from the new status. An item without `from`
  // is unconditional, like the single-id body.
  const undo = await post({
    action: 'review',
    status: 'new',
    items: [{ id: a, from: 'reviewed' }, { id: c }],
  });
  assert.deepEqual(undo.body, { saved: [a, c], unchanged: [], skipped: [] });
  // Already at the target status: unchanged, with no audit row, so the last
  // review keeps naming the officer who actually made it.
  await post({ action: 'review', id: b, status: 'closed' }, 'second');
  const before = (await audit()).length;
  const repeat = await post({
    action: 'review',
    status: 'closed',
    items: [{ id: b, from: 'closed' }, { id: c }],
  });
  assert.deepEqual(repeat.body, { saved: [c], unchanged: [b], skipped: [] });
  assert.equal((await audit()).length, before + 1);
  const listed = (await list('?id=' + b)).entries[0];
  assert.equal(listed.last_review.actor, officers[1]);
  // Someone else already made the same change from another status: skipped,
  // naming them.
  const raced = await post({
    action: 'review',
    status: 'closed',
    items: [{ id: b, from: 'reviewed' }],
  });
  assert.deepEqual(raced.body.saved, []);
  assert.deepEqual(raced.body.unchanged, []);
  assert.equal(raced.body.skipped[0].actor, officers[1]);
  await post({ action: 'review', id: b, status: 'reviewed' });
  for (const items of [
    [],
    Array.from({ length: 501 }, () => ({ id: randomUUID() })),
    [{ id: a }, { id: a.toUpperCase() }],
    [{ id: 'nope' }],
    [{ id: a, from: 'archived' }],
    [null],
    'all',
  ])
    assert.equal(
      (await post({ action: 'review', status: 'closed', items })).status,
      400,
    );
  for (const extra of [
    { id: a },
    { comment: { id: randomUUID(), body: 'One note for many' } },
    { status: 'done' },
  ])
    assert.equal(
      (
        await post({
          action: 'review',
          status: 'closed',
          items: [{ id: b }],
          ...extra,
        })
      ).status,
      400,
    );
  assert.equal((await row(b)).review_status, 'reviewed');
});

test('bulk review runs in one transaction', async () => {
  const [a, b] = [await insert(), await insert()];
  await post({ action: 'review', id: b, status: 'closed' }, 'second');
  // The skipped-item lookup fails after the update ran: nothing is kept.
  const failing = {
    query: (sql, values) => db.query(sql, values),
    transaction: (run) =>
      db.transaction((tx) =>
        run({
          query: (sql, values) =>
            sql.startsWith('SELECT i.id')
              ? Promise.reject(new Error('lookup failed'))
              : tx.query(sql, values),
        }),
      ),
  };
  const handler = adminHandler({
    getDatabase: () => failing,
    authorize,
    getEvents: async () => events,
    storage: {},
  });
  const res = {
    setHeader() {},
    end(text) {
      this.body = JSON.parse(text);
    },
  };
  const logged = mock.method(console, 'error', () => {});
  try {
    await handler(
      {
        method: 'POST',
        url: '/api/admin',
        headers: {
          'x-test-admin': 'yes',
          'content-type': 'application/json',
          origin,
        },
        body: {
          action: 'review',
          status: 'reviewed',
          items: [
            { id: a, from: 'new' },
            { id: b, from: 'new' },
          ],
        },
      },
      res,
    );
  } finally {
    logged.mock.restore();
  }
  assert.equal(res.statusCode, 503);
  assert.equal((await row(a)).review_status, 'new');
  assert.deepEqual(
    (await audit()).map((item) => item.action),
    ['review:closed'],
  );
});

test('the RSVP and newsletter sweep marks only those kinds, only up to `before`', async () => {
  const asOf = '2026-01-02T00:00:00Z';
  const rsvp = await insert({
    kind: 'rsvp',
    data: { eventId: 'past' },
    created: '2026-01-01T00:00:00Z',
  });
  const subscribe = await insert({
    kind: 'subscribe',
    email: 'reader@example.edu',
    created: '2026-01-02T00:00:00Z',
  });
  const question = await insert({ created: '2026-01-01T00:00:00Z' });
  const join = await insert({ kind: 'join', email: 'joiner@example.edu' });
  const late = await insert({
    kind: 'rsvp',
    email: 'late@example.edu',
    data: { eventId: 'next' },
    created: '2026-01-02T00:00:00.001Z',
  });
  const reviewed = await insert({
    kind: 'rsvp',
    email: 'done@example.edu',
    status: 'reviewed',
  });
  const sweep = await post({
    action: 'review-kinds',
    kinds: ['rsvp', 'subscribe'],
    from: 'new',
    status: 'reviewed',
    before: asOf,
  });
  assert.equal(sweep.status, 200);
  assert.deepEqual(sweep.body, { saved: [rsvp, subscribe], more: false });
  for (const [id, status] of [
    [rsvp, 'reviewed'],
    [subscribe, 'reviewed'],
    [question, 'new'],
    [join, 'new'],
    [late, 'new'],
    [reviewed, 'reviewed'],
  ])
    assert.equal((await row(id)).review_status, status);
  assert.deepEqual(await audit(), [
    { actor: officers[0], entry_id: rsvp, action: 'review:reviewed' },
    { actor: officers[0], entry_id: subscribe, action: 'review:reviewed' },
  ]);
  for (const body of [
    { kinds: ['rsvp', 'question'] },
    { kinds: ['join'] },
    { kinds: [] },
    { kinds: 'rsvp' },
    { before: undefined },
    { before: 'yesterday' },
    { before: '2026-04-31T00:00:00Z' },
    { before: '2026-01-01T00:00:00+16:00' },
    { before: '2026-01-01T00:00+23:59' },
    // Only New to Reviewed: the sweep never archives (archived rows can be
    // deleted permanently) and is undone with items[].
    { from: 'reviewed', status: 'reviewed' },
    { from: 'new', status: 'closed' },
    { from: 'reviewed', status: 'new' },
    { from: undefined },
    { status: undefined },
  ])
    assert.equal(
      (
        await post({
          action: 'review-kinds',
          kinds: ['rsvp'],
          from: 'new',
          status: 'reviewed',
          before: asOf,
          ...body,
        })
      ).status,
      400,
      JSON.stringify(body),
    );
  // A `before` in the future counts as now: a row stamped later stays New.
  const future = await insert({
    kind: 'rsvp',
    email: 'future@example.edu',
    data: { eventId: 'next' },
    created: new Date(Date.now() + 3600000).toISOString(),
  });
  const ahead = await post({
    action: 'review-kinds',
    kinds: ['rsvp'],
    from: 'new',
    status: 'reviewed',
    before: '2999-01-01T00:00:00Z',
  });
  assert.deepEqual(ahead.body, { saved: [late], more: false });
  assert.equal((await row(future)).review_status, 'new');
  await db.query('DELETE FROM club_forms.entries WHERE id=$1', [future]);
  // At most 500 per call; `more` says whether to call again.
  await db.query(
    "INSERT INTO club_forms.entries(id,kind,email,dedupe_key,created_at) SELECT gen_random_uuid(),'subscribe','sweep-'||n||'@example.edu','sweep-'||n,'2025-12-01'::timestamptz+n*interval '1 second' FROM generate_series(1,501) n",
  );
  const body = {
    action: 'review-kinds',
    kinds: ['subscribe'],
    from: 'new',
    status: 'reviewed',
    before: asOf,
  };
  const firstBatch = await post(body);
  assert.equal(firstBatch.body.saved.length, 500);
  assert.equal(firstBatch.body.more, true);
  const secondBatch = await post(body);
  assert.equal(secondBatch.body.saved.length, 1);
  assert.equal(secondBatch.body.more, false);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM club_forms.audit WHERE action='review:reviewed' AND actor=$1",
        [officers[0]],
      )
    ).rows[0].n,
    504,
  );
});

test('a sweep of 150 is undone in one request with the ids it returned', async () => {
  await db.query(
    "INSERT INTO club_forms.entries(id,kind,email,dedupe_key,data,created_at) SELECT gen_random_uuid(),'rsvp','s'||n||'@example.edu','s-'||n,'{\"eventId\":\"next\"}','2026-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,150) n",
  );
  const sweep = await post({
    action: 'review-kinds',
    kinds: ['rsvp'],
    from: 'new',
    status: 'reviewed',
    before: '2026-02-01T00:00:00Z',
  });
  assert.equal(sweep.body.saved.length, 150);
  const undo = await post({
    action: 'review',
    status: 'new',
    items: sweep.body.saved.map((id) => ({ id, from: 'reviewed' })),
  });
  assert.equal(undo.status, 200);
  assert.deepEqual(undo.body.saved, sweep.body.saved);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM club_forms.entries WHERE review_status='new'",
      )
    ).rows[0].n,
    150,
  );
});

test('officers record a cancelled RSVP or a withdrawn newsletter request, and can undo it', async () => {
  const rsvp = await insert({
    kind: 'rsvp',
    data: { eventId: 'next', eventTitle: 'Next event' },
  });
  const subscribe = await insert({
    kind: 'subscribe',
    email: 'reader@example.edu',
  });
  const question = await insert({ email: 'asker@example.edu' });
  const cancel = await post({
    action: 'state',
    id: rsvp,
    state: 'cancelled',
    from: 'active',
  });
  assert.deepEqual(cancel, {
    status: 200,
    body: { saved: true, state: 'cancelled' },
  });
  assert.equal((await row(rsvp)).state, 'cancelled');
  assert.equal((await row(rsvp)).review_status, 'new');
  // Another officer, still seeing it active, is told who changed it.
  const stale = await post(
    { action: 'state', id: rsvp, state: 'cancelled', from: 'active' },
    'second',
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'stale-state');
  assert.equal(stale.body.error, `${officers[0]} already cancelled this RSVP.`);
  assert.equal(stale.body.current.state, 'cancelled');
  assert.equal(stale.body.current.actor, officers[0]);
  assert.ok(Date.parse(stale.body.current.at));
  // A repeat without `from` changes nothing and adds no second audit row.
  assert.equal(
    (await post({ action: 'state', id: rsvp, state: 'cancelled' })).status,
    200,
  );
  const undo = await post({
    action: 'state',
    id: rsvp,
    state: 'active',
    from: 'cancelled',
  });
  assert.deepEqual(undo.body, { saved: true, state: 'active' });
  assert.equal((await row(rsvp)).state, 'active');
  const withdraw = await post(
    { action: 'state', id: subscribe, state: 'unsubscribed', from: 'active' },
    'second',
  );
  assert.deepEqual(withdraw.body, { saved: true, state: 'unsubscribed' });
  assert.deepEqual(await audit(), [
    { actor: officers[0], entry_id: rsvp, action: 'state:cancelled' },
    { actor: officers[0], entry_id: rsvp, action: 'state:active' },
    { actor: officers[1], entry_id: subscribe, action: 'state:unsubscribed' },
  ]);
  // Each kind has its own pair of states.
  for (const [id, state, from] of [
    [rsvp, 'unsubscribed'],
    [subscribe, 'cancelled'],
    [subscribe, 'active', 'cancelled'],
    [question, 'cancelled'],
    [question, 'active'],
  ])
    assert.equal(
      (await post({ action: 'state', id, state, from })).status,
      400,
      `${state} from ${from}`,
    );
  for (const body of [
    { id: rsvp, state: 'pending' },
    { id: rsvp, state: 'suppressed' },
    { id: 'nope', state: 'active' },
    { id: rsvp, state: 'active', from: 'gone' },
  ])
    assert.equal((await post({ action: 'state', ...body })).status, 400);
  assert.equal(
    (await post({ action: 'state', id: randomUUID(), state: 'active' })).status,
    404,
  );
  // A legacy state is not one this action manages.
  await db.query("UPDATE club_forms.entries SET state='pending' WHERE id=$1", [
    rsvp,
  ]);
  const legacy = await post({ action: 'state', id: rsvp, state: 'cancelled' });
  assert.equal(legacy.status, 409);
  assert.equal(legacy.body.code, 'unsupported-state');
  assert.equal(legacy.body.error, "This RSVP's state can't be changed here.");
  assert.equal(legacy.body.current.state, 'pending');
  assert.equal((await row(rsvp)).state, 'pending');
  assert.equal((await audit()).length, 3);
  // The newsletter keeps its name: never 'an AI Review subscription'.
  assert.equal(
    (await post({ action: 'state', id: question, state: 'cancelled' })).body
      .error,
    'Only an RSVP can be cancelled, and only The AI Review subscription withdrawn.',
  );
  await db.query("UPDATE club_forms.entries SET state='pending' WHERE id=$1", [
    subscribe,
  ]);
  assert.equal(
    (await post({ action: 'state', id: subscribe, state: 'active' })).body
      .error,
    "The AI Review subscription's state can't be changed here.",
  );
  await db.query(
    "UPDATE club_forms.entries SET state='unsubscribed' WHERE id=$1",
    [subscribe],
  );
  assert.equal(
    (await post({ action: 'state', id: rsvp, state: 'active' }, 'no')).status,
    401,
  );
});

test('an unverified resubmission preserves withdrawal and asks officers to review it once', async () => {
  const forms = [
    {
      kind: 'rsvp',
      email: 'again@example.edu',
      name: 'Again',
      eventId: 'next',
      consent: true,
    },
    { kind: 'subscribe', email: 'reader@example.edu', consent: true },
  ];
  const audited = async (id) =>
    (
      await db.query(
        'SELECT a.actor,a.action,c.body FROM club_forms.audit a LEFT JOIN club_forms.entry_comments c ON c.id=a.comment_id WHERE a.entry_id=$1 ORDER BY a.id',
        [id],
      )
    ).rows;
  for (const form of forms) {
    const first = await submit(
      db,
      { ...form, requestId: randomUUID() },
      events,
    );
    // A repeat while active changes nothing, as before.
    const active = await submit(
      db,
      { ...form, requestId: randomUUID() },
      events,
    );
    assert.equal(active.alreadySubmitted, true);
    assert.deepEqual(await audited(first.id), []);
    await post({ action: 'review', id: first.id, status: 'closed' });
    const withdrawn = form.kind === 'rsvp' ? 'cancelled' : 'unsubscribed';
    await post({
      action: 'state',
      id: first.id,
      state: withdrawn,
      from: 'active',
    });
    const again = await submit(
      db,
      { ...form, requestId: randomUUID() },
      events,
    );
    // The public reply is the same as for any repeat.
    assert.equal(again.alreadySubmitted, true);
    assert.equal(again.id, first.id);
    const saved = await row(first.id);
    assert.equal(saved.state, withdrawn);
    assert.equal(saved.review_status, 'new');
    const history = await audited(first.id);
    assert.equal(history.length, 3);
    assert.equal(history[2].actor, 'website');
    assert.equal(history[2].action, 'resubmitted');
    assert.match(history[2].body, /Officer review is required/);
    // Repeated requests do not change state or flood the inbox with notes.
    await submit(db, { ...form, requestId: randomUUID() }, events);
    assert.equal((await row(first.id)).state, withdrawn);
    assert.equal((await audited(first.id)).length, 3);
    const stale = await post({
      action: 'state',
      id: first.id,
      state: withdrawn,
      from: 'active',
    });
    assert.equal(stale.status, 409);
    assert.doesNotMatch(stale.body.error, /active again/);
    // Only the officer's explicit decision reactivates it.
    const restored = await post({
      action: 'state',
      id: first.id,
      state: 'active',
      from: withdrawn,
    });
    assert.equal(restored.status, 200);
    assert.equal((await row(first.id)).state, 'active');
    // A further repeat while active adds nothing.
    await submit(db, { ...form, requestId: randomUUID() }, events);
    assert.equal((await audited(first.id)).length, 4);
    // A later cancellation is a new review cycle, not a retry of the old one.
    await post({
      action: 'state',
      id: first.id,
      state: withdrawn,
      from: 'active',
    });
    await post({ action: 'review', id: first.id, status: 'reviewed' });
    await submit(db, { ...form, requestId: randomUUID() }, events);
    assert.equal((await row(first.id)).state, withdrawn);
    assert.equal((await row(first.id)).review_status, 'new');
    assert.equal(
      (await audited(first.id)).filter((a) => a.action === 'resubmitted')
        .length,
      2,
    );
  }
});

function parseCSV(text) {
  const records = [],
    record = [];
  for (const match of text
    .replace(/^﻿/, '')
    .matchAll(/"((?:[^"]|"")*)"(,|\r\n|$)/g)) {
    record.push(match[1].replaceAll('""', '"'));
    if (match[2] !== ',') records.push(record.splice(0));
  }
  const [headers, ...rows] = records;
  return rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]])),
  );
}
test('CSV export covers all statuses on request, follows search and sort, and names what it holds', async () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  for (const [status, created] of [
    ['new', '2026-01-03'],
    ['reviewed', '2026-01-01'],
    ['closed', '2026-01-02'],
  ])
    await insert({
      kind: 'join',
      email: status + '@example.edu',
      name: status,
      created,
      status,
      data: {
        campus: 'Richland',
        interests: status === 'closed' ? 'Parking' : 'AI',
      },
    });
  await insert({
    kind: 'rsvp',
    email: 'rsvp@example.edu',
    status: 'closed',
    state: 'cancelled',
    data: {
      eventId: 'past',
      eventTitle: 'Past',
      eventDate: '',
      potential: true,
      hasSurvey: true,
      dietaryNeeds: 'None',
    },
  });
  const exported = async (query) => {
    const response = await request('/api/admin?export=csv' + query);
    assert.equal(response.status, 200, query);
    return {
      filename: /filename="([^"]+)"/.exec(
        response.headers.get('content-disposition'),
      )[1],
      rows: parseCSV(await response.text()),
    };
  };
  const members = await exported('&kind=join&status=all');
  assert.equal(members.filename, `club-submissions-all-join-${today}.csv`);
  assert.deepEqual(
    members.rows.map((r) => r.Name),
    ['new', 'closed', 'reviewed'],
  );
  const oldest = await exported('&kind=join&status=all&sort=oldest');
  assert.deepEqual(
    oldest.rows.map((r) => r.Name),
    ['reviewed', 'closed', 'new'],
  );
  assert.equal(
    (await exported('&kind=join&status=new')).filename,
    `club-submissions-new-join-${today}.csv`,
  );
  assert.equal(
    (await exported('&status=closed')).filename,
    `club-submissions-archived-all-${today}.csv`,
  );
  const everything = await exported('');
  assert.equal(everything.filename, `club-submissions-all-all-${today}.csv`);
  assert.equal(everything.rows.length, 4);
  const search = await exported('&q=parking');
  assert.equal(search.filename, `club-submissions-all-all-search-${today}.csv`);
  assert.deepEqual(
    search.rows.map((r) => r.Name),
    ['closed'],
  );
  const rsvps = await exported('&kind=rsvp-all&eventId=past');
  assert.equal(
    rsvps.filename,
    `club-submissions-all-rsvp-all-past-${today}.csv`,
  );
  assert.equal(rsvps.rows.length, 1);
  // Internal flags are not details; the officer-recorded state reads as words.
  assert.equal(rsvps.rows[0]['Other details'], 'dietary Needs: None');
  assert.equal(rsvps.rows[0]['Submission state'], 'RSVP cancelled');
  assert.equal(rsvps.rows[0]['Event date'], 'TBD');
  assert.equal((await exported('&kind=rsvp')).rows.length, 0);
  // The audit row is unchanged.
  assert.deepEqual(
    [...new Set((await audit()).map((item) => item.action))],
    ['export-csv'],
  );
  assert.ok((await audit()).every((item) => item.actor === officers[0]));
});

test('every audit row written by these actions names an officer, never a member', async () => {
  const ids = [];
  for (const kind of ['rsvp', 'subscribe', 'question'])
    ids.push(
      await insert({
        kind,
        email: kind + '@member.example.edu',
        data: kind === 'rsvp' ? { eventId: 'next' } : {},
      }),
    );
  await post({
    action: 'review-kinds',
    kinds: ['rsvp', 'subscribe'],
    from: 'new',
    status: 'reviewed',
    before: new Date(Date.now() + 60000).toISOString(),
  });
  await post({
    action: 'review',
    status: 'closed',
    items: ids.map((id, n) => ({ id, from: n < 2 ? 'reviewed' : 'new' })),
  });
  await post({ action: 'state', id: ids[0], state: 'cancelled' }, 'second');
  await request('/api/admin?export=csv&q=member');
  const rows = await audit();
  assert.equal(rows.length, 7);
  assert.ok(rows.every((item) => officers.includes(item.actor)));
});
