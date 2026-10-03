import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { eventHandler } from '../api/events.mjs';
import { adminHandler } from '../api/admin.mjs';
import { addSubmissionComment } from '../lib/submission-activity.mjs';
import { RequestError } from '../lib/errors.mjs';
import { submit } from '../lib/submissions.mjs';
import { upcomingEvents } from '../lib/inbox.mjs';
import { uploadEventImage } from '../lib/event-assets.mjs';
import { eventTypes, addEventType } from '../lib/event-assets.mjs';
import { editorEvents, liveEvents } from '../lib/events.mjs';
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
  if (req.headers['x-test-admin'] === 'second')
    return { email: 'second-admin@example.com' };
  throw new RequestError(401, 'Sign in');
};
const request = (route, body, admin = true) =>
  fetch(origin + route, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(admin ? { 'x-test-admin': admin === true ? 'yes' : admin } : {}),
      ...(body
        ? { 'Content-Type': 'application/json', Origin: origin }
        : {}),
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
    '008_event_archive.sql',
    '009_submission_comments.sql',
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
test('unpublished RSVP snapshots stay in history and cannot resurrect upcoming events', async () => {
  for (const eventId of ['next', 'unpublished-potential']) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO club_forms.entries(id,kind,email,dedupe_key,data) VALUES($1::uuid,'rsvp','person@example.edu',$1::text,$2)",
      [
        id,
        JSON.stringify({
          eventId,
          eventTitle: eventId,
          eventDate: '',
          potential: true,
        }),
      ],
    );
  }
  const active = await (await request('/api/admin?kind=rsvp')).json();
  assert.deepEqual(
    active.entries.map((e) => e.data.eventId),
    ['next'],
  );
  assert.equal(active.counts.find((c) => c.kind === 'rsvp').total, 1);
  assert.equal(active.counts.find((c) => c.kind === 'rsvp-past').total, 1);
  const past = await (await request('/api/admin?kind=rsvp-past')).json();
  assert.deepEqual(
    past.entries.map((e) => e.data.eventId),
    ['unpublished-potential'],
  );
});

test('inbox rejects invalid pages and refuses a silently incomplete CSV export', async () => {
  for (const offset of ['1.5', '-1', 'Infinity', 'no', '100001'])
    assert.equal((await request('/api/admin?offset=' + offset)).status, 400);
  await db.query(
    "INSERT INTO club_forms.entries(id,kind,email,dedupe_key) SELECT gen_random_uuid(),'join','export-'||n||'@example.edu','export-'||n FROM generate_series(1,10001) n",
  );
  const response = await request('/api/admin?export=csv');
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /Narrow the filters/);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM club_forms.audit WHERE action='export-csv'",
      )
    ).rows[0].n,
    0,
  );
});

test('legacy event types include Social and collapse legacy aliases without rewriting event details or duplicating aliases', async () => {
  const originals = [
    'Club event',
    'Club meeting',
    'Conversation',
    'Hackathon',
    'Presentation',
    'Project meeting',
    'Project workshop',
    'Skills session',
    'User testing',
    'Workshop',
  ].map((category, n) => ({
    id: 'old-' + n,
    category,
    title: 'Original ' + n,
    date: '2020-01-01',
  }));
  assert.deepEqual(await eventTypes(db, originals), [
    'Workshop',
    'Meeting',
    'Talk',
    'Hackathon',
    'Social',
  ]);
  const types = await addEventType(
    db,
    ' PROJECT   WORKSHOP ',
    'admin',
    originals,
  );
  assert.equal(types.selected, 'Workshop');
  assert.equal(
    (await db.query('SELECT * FROM club_forms.event_types')).rows.length,
    0,
  );
  const edited = await editorEvents(db, originals);
  assert.equal(
    edited.find((r) => r.id === 'old-4').draft.category,
    'Talk',
  );
  assert.equal(
    (await liveEvents(db, originals)).find((r) => r.id === 'old-5')
      .category,
    'Meeting',
  );
  assert.equal(originals[4].category, 'Presentation');
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
  assert.equal(
    (await response.json()).event.draft.category,
    'Study Group',
  );
  assert.equal(
    (
      await request('/api/events', {
        action: 'add-type',
        name: '<b>bad</b>',
      })
    ).status,
    400,
  );
});
test('uploaded images are decoded, resized, private in drafts, public only while referenced by a published event', async () => {
  const source = await sharp({
    create: {
      width: 2200,
      height: 200,
      channels: 3,
      background: '#567890',
    },
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
    200,
  );
  const publicImage = await request(
    '/api/events?image=' + image.id,
    null,
    false,
  );
  assert.equal(publicImage.status, 200);
  assert.equal(
    publicImage.headers.get('cache-control'),
    'private, no-store',
  );
  assert.ok((await publicImage.arrayBuffer()).byteLength > 0);
  assert.equal(
    (
      await request('/api/events', {
        action: 'archive',
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
  assert.equal(
    (await request('/api/events?image=' + image.id)).status,
    200,
  );
  assert.equal(
    (
      await request('/api/events', {
        action: 'restore',
        id: 'illustrated',
        revision: 3,
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
        revision: 4,
        event,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request('/api/events?image=' + image.id, null, false)).status,
    200,
  );
});
test('image uploads reject unauthenticated clients and non-images; failed storage metadata removes the orphan', async () => {
  assert.equal(
    (await request('/api/events?upload=1', { content: 'abc' }, false))
      .status,
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
test('inbox, counts and CSV separate past and upcoming RSVPs while all submissions and direct links include both', async () => {
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
  assert.equal(all.entries.length, 4);
  assert.equal(all.counts.find((row) => row.kind === 'rsvp').total, 2);
  assert.equal(
    all.counts.find((row) => row.kind === 'rsvp-past').total,
    1,
  );
  assert.equal(all.events.length, 3);
  assert.equal(all.events.find((row) => row.id === 'past').past, true);
  const past = await (await request('/api/admin?kind=rsvp-past')).json();
  assert.equal(past.entries.length, 1);
  assert.equal(past.entries[0].data.eventId, 'past');
  assert.equal(
    (await (await request('/api/admin?id=' + past.entries[0].id)).json())
      .entries.length,
    1,
  );
  const pastCSV = await (
    await request('/api/admin?kind=rsvp-past&export=csv')
  ).text();
  assert.ok(pastCSV.includes('Past'));
  assert.ok(!pastCSV.includes('Next event'));
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

function parseCSV(text) {
  // All exported cells are quoted. Decode records independently of the exporter.
  const records = [],
    record = [];
  for (const match of text
    .replace(/^\uFEFF/, '')
    .matchAll(/"((?:[^"]|"")*)"(,|\r\n|$)/g)) {
    record.push(match[1].replaceAll('""', '"'));
    if (match[2] !== ',') records.push(record.splice(0));
  }
  const [headers, ...rows] = records;
  return rows.map((row) =>
    Object.fromEntries(
      headers.map((header, index) => [header, row[index]]),
    ),
  );
}
test('CSV gives all six submission types readable columns, preserves multiline text and Unicode, and neutralizes formulas', async () => {
  const message = 'First line, "quoted"\nSecond line: 안녕하세요 — café';
  await submit(
    db,
    entry('question', {
      subject: 'Question title',
      message,
      eventId: 'next',
    }),
    events,
  );
  await submit(
    db,
    entry('contribution', { title: 'Article title', body: message }),
    events,
  );
  await submit(
    db,
    entry('workshop', { topic: 'Workshop topic', details: message }),
    events,
  );
  await submit(
    db,
    entry('join', { interests: 'Learning, building' }),
    events,
  );
  await submit(db, entry('subscribe'), events);
  await submit(db, entry('rsvp', { eventId: 'next' }), events);
  const response = await request('/api/admin?export=csv');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  const rows = parseCSV(text);
  assert.equal(rows.length, 6);
  const byType = Object.fromEntries(rows.map((row) => [row.Type, row]));
  for (const [kind, title] of [
    ['Questions', 'Question title'],
    ['AI Review submissions', 'Article title'],
    ['Workshop requests', 'Workshop topic'],
  ]) {
    assert.equal(byType[kind]['Subject / title'], title);
    assert.equal(byType[kind]['Message / body'], message);
    assert.ok(!Object.hasOwn(byType[kind], 'Details'));
    assert.equal(
      byType[kind]['Submission state'],
      'Received in club inbox',
    );
    assert.ok(byType[kind].Reference);
  }
  assert.equal(byType['Club signups'].Campus, 'Richland');
  assert.equal(byType['Club signups'].Interests, 'Learning, building');
  assert.equal(byType['Event RSVPs']['Event title'], 'Next event');
  assert.equal(byType['Questions']['Event title'], 'Next event');
  assert.equal(byType['The AI Review subscription']['Message / body'], '');
  assert.match(byType.Questions['Received (Central)'], /C[DS]T/);
  assert.equal(
    (await request('/api/admin?export=csv', null, false)).status,
    401,
  );
  await db.query(
    "UPDATE club_forms.entries SET data=$1,name=$2 WHERE kind='question'",
    [
      {
        subject: '=1+1',
        message: '  @unsafe',
        customNote: { reason: 'Keep older fields' },
      },
      '+NAME',
    ],
  );
  const question = parseCSV(
    await (await request('/api/admin?kind=question&export=csv')).text(),
  )[0];
  assert.equal(question['Subject / title'], "'=1+1");
  assert.equal(question['Message / body'], "'  @unsafe");
  assert.equal(question.Name, "'+NAME");
  assert.equal(
    question['Other details'],
    'custom Note: reason: Keep older fields',
  );
});
test('reviewing, closing and reopening keep the submission and only change its review status', async () => {
  const row = await submit(
    db,
    entry('question', { subject: 'Follow-up', message: 'Please reply' }),
    events,
  );
  for (const status of ['reviewed', 'closed', 'new']) {
    assert.equal(
      (
        await request('/api/admin', {
          action: 'review',
          id: row.id,
          status,
        })
      ).status,
      200,
    );
    const saved = (
      await db.query('SELECT * FROM club_forms.entries WHERE id=$1', [
        row.id,
      ])
    ).rows[0];
    assert.equal(saved.review_status, status);
    assert.deepEqual(saved.data, row.data);
    assert.equal(saved.state, row.state);
  }
  assert.equal(
    (await db.query('SELECT * FROM club_forms.outbox')).rows.length,
    0,
  );
  const actions = (
    await db.query(
      "SELECT action FROM club_forms.audit WHERE entry_id=$1 AND action LIKE 'review:%' ORDER BY created_at",
      [row.id],
    )
  ).rows.map((r) => r.action);
  assert.deepEqual(actions, [
    'review:reviewed',
    'review:closed',
    'review:new',
  ]);
});

test('admin comments persist author, time and text separately; retries do not duplicate comments or history', async () => {
  const row = await submit(
    db,
    entry('question', { subject: 'Question', message: 'Hello' }),
    events,
  );
  const body = {
    action: 'comment',
    id: row.id,
    commentId: randomUUID(),
    comment:
      '  I will follow up.\n안녕하세요 <img src=x onerror=alert(1)>  ',
    author_email: 'spoof@example.com',
    created_at: '1999-01-01',
  };
  assert.equal((await request('/api/admin', body, false)).status, 401);
  const start = Date.now();
  const response = await request('/api/admin', body);
  assert.equal(response.status, 200);
  const comment = (await response.json()).comment;
  assert.equal(comment.author_email, 'admin@example.com');
  assert.equal(comment.body, body.comment.trim());
  assert.ok(Date.parse(comment.created_at) >= start - 1000);
  assert.equal((await request('/api/admin', body)).status, 200);
  assert.equal(
    (await db.query('SELECT * FROM club_forms.entry_comments')).rows
      .length,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT * FROM club_forms.audit WHERE action='comment-added' AND entry_id=$1",
        [row.id],
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (await request('/api/admin', { ...body, comment: 'Different text' }))
      .status,
    409,
  );
  assert.equal(
    (
      await request('/api/admin', {
        ...body,
        commentId: randomUUID(),
        comment: ' ',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/api/admin', {
        ...body,
        commentId: randomUUID(),
        comment: 'x'.repeat(5001),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/api/admin', {
        ...body,
        id: randomUUID(),
        commentId: randomUUID(),
      })
    ).status,
    404,
  );
  assert.equal(
    (await request('/api/admin?history=' + row.id, null, false)).status,
    401,
  );
  for (const status of ['closed', 'new'])
    await request('/api/admin', { action: 'review', id: row.id, status });
  const history = await (
    await request('/api/admin?history=' + row.id)
  ).json();
  assert.deepEqual(
    history.activity.map((r) => r.action),
    ['review:new', 'review:closed', 'comment-added'],
  );
  assert.equal(history.activity[2].comment, comment.body);
  assert.equal(history.activity[2].actor, 'admin@example.com');
  const stored = (
    await db.query(
      'SELECT entry_id,author_email,created_at,body FROM club_forms.entry_comments',
    )
  ).rows[0];
  assert.equal(stored.entry_id, row.id);
  assert.equal(stored.author_email, 'admin@example.com');
  assert.equal(stored.body, comment.body);
  assert.equal(
    (await db.query('SELECT * FROM club_forms.outbox')).rows.length,
    0,
  );
  const blocked = await fetch(origin + '/api/admin', {
    method: 'POST',
    headers: {
      'x-test-admin': 'yes',
      Origin: 'https://untrusted.invalid',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...body, commentId: randomUUID() }),
  });
  assert.equal(blocked.status, 403);
});
test('submission activity includes historical actions and paginates without mixing entries', async () => {
  const row = await submit(
    db,
    entry('question', { subject: 'First', message: 'First' }),
    events,
  );
  const other = await submit(
    db,
    entry('question', { subject: 'Other', message: 'Other' }),
    events,
  );
  for (let i = 0; i < 55; i++)
    await db.query(
      "INSERT INTO club_forms.audit(actor,entry_id,action) VALUES($1,$2,'review:reviewed')",
      ['officer-' + i + '@example.com', row.id],
    );
  await db.query(
    "INSERT INTO club_forms.audit(actor,entry_id,action) VALUES('other@example.com',$1,'download-attachment')",
    [other.id],
  );
  const first = await (
    await request('/api/admin?history=' + row.id)
  ).json();
  assert.equal(first.activity.length, 50);
  const second = await (
    await request(
      '/api/admin?history=' + row.id + '&before=' + first.nextBefore,
    )
  ).json();
  assert.equal(second.activity.length, 5);
  assert.equal(second.nextBefore, null);
  assert.equal(
    new Set([...first.activity, ...second.activity].map((r) => r.id)).size,
    55,
  );
  assert.ok(first.activity.every((r) => r.actor !== 'other@example.com'));
  assert.equal(
    (await request('/api/admin?history=' + row.id + '&before=oops'))
      .status,
    400,
  );
  assert.equal(
    (await request('/api/admin?history=' + randomUUID())).status,
    404,
  );
});
test('comment and audit writes roll back together if activity recording fails', async () => {
  const row = await submit(
    db,
    entry('question', { subject: 'Atomic', message: 'Hello' }),
    events,
  );
  const failing = {
    transaction: (run) =>
      db.transaction((tx) =>
        run({
          query: (sql, values) => {
            if (sql.startsWith('INSERT INTO club_forms.audit'))
              throw Error('audit unavailable');
            return tx.query(sql, values);
          },
        }),
      ),
  };
  await assert.rejects(
    addSubmissionComment(
      failing,
      {
        id: row.id,
        commentId: randomUUID(),
        comment: 'Do not partially save',
      },
      'admin@example.com',
    ),
    /audit unavailable/,
  );
  assert.equal(
    (await db.query('SELECT * FROM club_forms.entry_comments')).rows
      .length,
    0,
  );
});

test('comments are shared between authorized admins with each author preserved', async () => {
  const row = await submit(
    db,
    entry('question', { subject: 'Shared follow-up', message: 'Hello' }),
    events,
  );
  await request('/api/admin', {
    action: 'comment',
    id: row.id,
    commentId: randomUUID(),
    comment: 'First admin note',
  });
  const secondView = await (
    await request('/api/admin?history=' + row.id, null, 'second')
  ).json();
  assert.equal(secondView.activity[0].comment, 'First admin note');
  assert.equal(secondView.activity[0].actor, 'admin@example.com');
  await request(
    '/api/admin',
    {
      action: 'comment',
      id: row.id,
      commentId: randomUUID(),
      comment: 'Second admin reply',
    },
    'second',
  );
  const firstView = await (
    await request('/api/admin?history=' + row.id)
  ).json();
  assert.deepEqual(
    firstView.activity.map((item) => [item.actor, item.comment]),
    [
      ['second-admin@example.com', 'Second admin reply'],
      ['admin@example.com', 'First admin note'],
    ],
  );
  assert.equal(
    (await request('/api/admin?history=' + row.id, null, false)).status,
    401,
  );
});

test('status sections and their exports isolate archived submissions and allow restoration', async () => {
  const records = {};
  for (const state of ['new', 'reviewed', 'closed']) {
    const record = await submit(
      db,
      entry('question', {
        subject: state + ' question',
        message: state + ' body',
      }),
      events,
    );
    await request('/api/admin', {
      action: 'review',
      id: record.id,
      status: state,
    });
    records[state] = record;
  }
  for (const state of ['new', 'reviewed', 'closed']) {
    const view = await (
      await request('/api/admin?status=' + state)
    ).json();
    assert.deepEqual(
      view.entries.map((item) => item.id),
      [records[state].id],
    );
    const exported = parseCSV(
      await (
        await request('/api/admin?status=' + state + '&export=csv')
      ).text(),
    );
    assert.equal(exported.length, 1);
    assert.equal(exported[0]['Subject / title'], state + ' question');
    assert.equal(
      exported[0]['Review status'],
      state === 'closed'
        ? 'Archived'
        : state === 'new'
          ? 'New'
          : 'Reviewed',
    );
  }
  await request('/api/admin', {
    action: 'comment',
    id: records.closed.id,
    commentId: randomUUID(),
    comment: 'Keep this with the archived entry',
  });
  await request('/api/admin', {
    action: 'review',
    id: records.closed.id,
    status: 'new',
  });
  assert.equal(
    (await (await request('/api/admin?status=closed')).json()).entries
      .length,
    0,
  );
  const restored = await (await request('/api/admin?status=new')).json();
  assert.equal(restored.entries.length, 2);
  const history = await (
    await request('/api/admin?history=' + records.closed.id)
  ).json();
  assert.ok(
    history.activity.some(
      (item) => item.comment === 'Keep this with the archived entry',
    ),
  );
});
