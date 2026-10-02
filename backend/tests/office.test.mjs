import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { eventHandler } from '../api/events.mjs';
import { adminHandler } from '../api/admin.mjs';
import { RequestError } from '../lib/errors.mjs';
import { submit } from '../lib/submissions.mjs';
import { upcomingEvents } from '../lib/inbox.mjs';
import { uploadEventImage } from '../lib/event-assets.mjs';
let db, server, origin;
const blobs = new Map();
const storage = {
  put: async (path, bytes) => {
    blobs.set(path, bytes);
    return { pathname: path };
  },
  del: async (path) => blobs.delete(path),
  get: async (path) => ({
    statusCode: 200,
    stream: new Blob([blobs.get(path)]).stream(),
  }),
};
const events = [
  { id: 'past', title: 'Past', date: '2020-01-01' },
  { id: 'next', title: 'Next event', date: '2099-01-01' },
  { id: 'other', title: 'Other event', date: '2099-02-01' },
];
const authorize = (req) => {
  if (req.headers['x-test-admin'] === 'yes')
    return { email: 'admin@example.com' };
  throw new RequestError(401, 'Sign in');
};
const request = (route, body, admin = true) =>
  fetch(origin + route, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(admin ? { 'x-test-admin': 'yes' } : {}),
      ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
before(async () => {
  db = new PGlite();
  for (const file of [
    '003_club_forms.sql',
    '005_screen_confirmations.sql',
    '006_event_editor.sql',
    '007_office_tools.sql',
  ])
    await db.exec(
      await readFile(new URL('../' + file, import.meta.url), 'utf8'),
    );
  const handle = eventHandler({
    getDatabase: () => db,
    authorize,
    originals: [],
    storage,
    rateLimit: async () => {},
  });
  const inbox = adminHandler({
    getDatabase: () => db,
    authorize,
    getEvents: async () => events,
    storage,
  });
  server = http.createServer((req, res) =>
    (req.url.startsWith('/api/admin') ? inbox : handle)(req, res),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
  process.env.BLOB_READ_WRITE_TOKEN = 'test-only';
});
beforeEach(async () => {
  blobs.clear();
  await db.exec(
    'TRUNCATE club_forms.entries,club_forms.events,club_forms.event_types,club_forms.event_images RESTART IDENTITY CASCADE',
  );
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});
test('event groups reject free text on save and reuse one canonical name across case and whitespace', async () => {
  let response = await request('/api/events', {
    action: 'add-type',
    name: '  Study   Group ',
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).selected, 'Study Group');
  response = await request('/api/events', {
    action: 'add-type',
    name: 'study group',
  });
  assert.equal((await response.json()).selected, 'Study Group');
  assert.equal(
    (await db.query('SELECT * FROM club_forms.event_types')).rows.length,
    1,
  );
  response = await request('/api/events', {
    action: 'draft',
    id: 'one',
    revision: 0,
    event: { title: 'One', category: 'unmanaged' },
  });
  assert.equal(response.status, 400);
  response = await request('/api/events', {
    action: 'draft',
    id: 'one',
    revision: 0,
    event: { title: 'One', category: 'study group' },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).event.draft.category, 'Study Group');
  assert.equal(
    (await request('/api/events', { action: 'add-type', name: '<b>bad</b>' }))
      .status,
    400,
  );
});
test('uploaded images are decoded, resized, private in drafts, public only while referenced by a published event', async () => {
  const source = await sharp({
    create: { width: 2200, height: 200, channels: 3, background: '#567890' },
  })
    .png()
    .toBuffer();
  const upload = await request('/api/events?upload=1', {
    content: source.toString('base64'),
  });
  assert.equal(upload.status, 200);
  const image = (await upload.json()).image;
  assert.equal(image.width, 1800);
  assert.equal(
    (await request('/api/events?image=' + image.id, null, false)).status,
    401,
  );
  assert.equal(
    (await request('/api/events?image=' + image.id)).headers.get(
      'content-type',
    ),
    'image/webp',
  );
  const event = {
    title: 'Illustrated event',
    category: 'Workshop',
    date: '2099-01-01',
    images: [{ id: image.id, alt: 'Students learning' }],
  };
  assert.equal(
    (
      await request('/api/events', {
        action: 'draft',
        id: 'illustrated',
        revision: 0,
        event,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request('/api/events?image=' + image.id, null, false)).status,
    401,
  );
  assert.equal(
    (
      await request('/api/events', {
        action: 'publish',
        id: 'illustrated',
        revision: 1,
        event: { ...event, images: [{ id: image.id, alt: '' }] },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/api/events', {
        action: 'publish',
        id: 'illustrated',
        revision: 1,
        event,
      })
    ).status,
    200,
  );
  const publicImage = await request(
    '/api/events?image=' + image.id,
    null,
    false,
  );
  assert.equal(publicImage.status, 200);
  assert.equal(publicImage.headers.get('cache-control'), 'private, no-store');
  assert.ok((await publicImage.arrayBuffer()).byteLength > 0);
  assert.equal(
    (
      await request('/api/events', {
        action: 'unpublish',
        id: 'illustrated',
        revision: 2,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request('/api/events?image=' + image.id, null, false)).status,
    401,
  );
});
test('image uploads reject unauthenticated clients and non-images; failed storage metadata removes the orphan', async () => {
  assert.equal(
    (await request('/api/events?upload=1', { content: 'abc' }, false)).status,
    401,
  );
  assert.equal(
    (
      await request('/api/events?upload=1', {
        content: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"/>',
        ).toString('base64'),
      })
    ).status,
    400,
  );
  const bytes = await sharp({
    create: { width: 5, height: 5, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  let removed = false;
  await assert.rejects(
    uploadEventImage(
      {
        query: async () => {
          throw Error('db failure');
        },
      },
      { content: bytes.toString('base64') },
      'admin',
      {
        put: async () => ({ pathname: 'orphan' }),
        del: async () => {
          removed = true;
        },
      },
    ),
    /db failure/,
  );
  assert.ok(removed);
});
const entry = (kind, extra = {}) => ({
  kind,
  email: 'student@example.com',
  name: 'Student',
  campus: 'Richland',
  consent: true,
  requestId: randomUUID(),
  ...extra,
});
test('question submissions are persisted once and preserve event context without queueing emails', async () => {
  const body = entry('question', {
    subject: 'Meeting access',
    message: 'Is there an online link?',
    eventId: 'next',
  });
  const row = await submit(db, body, events);
  assert.equal(row.data.eventTitle, 'Next event');
  assert.equal(row.review_status, 'new');
  assert.equal((await submit(db, body, events)).id, row.id);
  assert.equal(
    (await db.query('SELECT * FROM club_forms.outbox')).rows.length,
    0,
  );
  await assert.rejects(
    submit(db, { ...body, eventId: 'unknown' }, events),
    /no longer available/,
  );
});
test('inbox, counts and CSV exclude past RSVPs and support an exact upcoming event filter', async () => {
  for (const event of events)
    await db.query(
      'INSERT INTO club_forms.entries(id,kind,email,data,dedupe_key) VALUES($1,$2,$3,$4,$5)',
      [
        randomUUID(),
        'rsvp',
        'student@example.com',
        JSON.stringify({ eventId: event.id, eventTitle: event.title }),
        event.id,
      ],
    );
  await submit(
    db,
    entry('question', { subject: 'Help', message: 'How can I join?' }),
    events,
  );
  const all = await (await request('/api/admin')).json();
  assert.equal(all.entries.length, 3);
  assert.equal(all.counts.find((row) => row.kind === 'rsvp').total, 2);
  assert.equal(all.events.length, 2);
  const filtered = await (
    await request('/api/admin?kind=rsvp&eventId=next')
  ).json();
  assert.equal(filtered.entries.length, 1);
  assert.equal(filtered.entries[0].data.eventId, 'next');
  const csv = await (
    await request('/api/admin?kind=rsvp&eventId=next&export=csv')
  ).text();
  assert.ok(csv.includes('Next event'));
  assert.ok(!csv.includes('Other event'));
  assert.ok(!csv.includes('Past'));
  assert.equal((await request('/api/admin', null, false)).status, 401);
});
test('upcoming boundaries use Central dates and retain an event until its end', () => {
  const now = new Date('2026-10-03T01:00:00Z');
  const list = upcomingEvents(
    [
      { id: 'today', date: '2026-10-02' },
      { id: 'ended', date: '2026-10-02T17:00:00-05:00' },
      {
        id: 'ongoing',
        date: '2026-10-02T17:00:00-05:00',
        end: '2026-10-02T21:00:00-05:00',
      },
      { id: 'draft', date: '' },
    ],
    now,
  );
  assert.deepEqual(
    list.map((e) => e.id),
    ['today', 'ongoing'],
  );
});
