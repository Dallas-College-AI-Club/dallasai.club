import { testDatabase } from './helpers/db.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  draftContent,
  publicContent,
  centralTime,
} from '../lib/event-content.mjs';
import { parseEventSource } from '../lib/event-registry.mjs';
import {
  saveEvent,
  liveEvents,
  editorEvents,
  eventActivity,
} from '../lib/events.mjs';
import { dateTime } from '../admin/format.js';
import { eventHandler } from '../api/events.mjs';
import { RequestError } from '../lib/errors.mjs';
import { validate } from '../lib/validation.mjs';
import { createEventShareLink, eventURL } from '../lib/event-share-link.mjs';
import qrcode from 'qrcode-generator';
const actor = 'officer@example.com';
const draft = {
  title: 'AI workshop',
  date: '2099-10-02',
  startTime: '16:30',
  endTime: '18:00',
  category: 'Workshop',
  location: 'Richland',
  summary: 'Bring your ideas.',
  agenda: ['Try it'],
  preparation: [],
};
const legacy = [publicContent('legacy-event', draft)];
let db;
before(async () => {
  db = await testDatabase();
});
beforeEach(() =>
  db.exec('TRUNCATE club_forms.events, club_forms.audit CASCADE'),
);
after(() => db.close());
test('reply-by dates survive saves and event QR downloads point to a public event without reading private data', async () => {
  for (const rsvpDeadline of [
    '2026-02-30',
    'tomorrow',
    '2026-10-11T00:00',
    '<script>',
  ])
    assert.throws(() => draftContent({ ...draft, rsvpDeadline }), {
      status: 400,
    });
  await save('publish', 0, { ...draft, rsvpDeadline: '2026-10-11' });
  assert.equal(
    (await liveEvents(db, legacy)).find((e) => e.id === 'new-event')
      .rsvpDeadline,
    '2026-10-11',
  );
  assert.equal(
    (await editorEvents(db, legacy)).find((e) => e.id === 'new-event').draft
      .rsvpDeadline,
    '2026-10-11',
  );
  const handler = eventHandler({
    getDatabase: () => ({
      query: (sql, values) => {
        assert.equal(
          sql,
          'SELECT published FROM club_forms.events WHERE id=$1',
        );
        return db.query(sql, values);
      },
    }),
    authorize: () => {
      throw Error('QR is public');
    },
  });
  const call = async (query) => {
    const response = {
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(value) {
        this.body = value;
      },
    };
    await handler({ method: 'GET', url: '/api/events?' + query }, response);
    return response;
  };
  const qr = await call('qr=new-event&download=1');
  assert.equal(qr.statusCode, 200);
  assert.equal(qr.headers['Content-Type'], 'image/svg+xml');
  assert.equal(
    qr.headers['Content-Disposition'],
    'attachment; filename="new-event-qr.svg"',
  );
  assert.match(qr.body, /<svg/);
  assert.doesNotMatch(qr.body, /script|onload|officer|example.com/);
  assert.notEqual(qr.body, (await call('qr=other-event')).body);
  await createEventShareLink(
    db,
    'new-event',
    actor,
    async () => 'https://go.dallasai.club/test-game-night',
  );
  const expectedQR = qrcode(0, 'M');
  expectedQR.addData('https://go.dallasai.club/test-game-night');
  expectedQR.make();
  assert.equal(
    (await call('qr=new-event')).body,
    expectedQR.createSvgTag(6, 24),
  );
  assert.equal(
    (await call('qr=new-event')).headers['Cache-Control'],
    'no-store',
  );
  assert.equal((await call('qr=bad%22id')).statusCode, 400);
  assert.equal((await call('qr=' + 'a'.repeat(101))).statusCode, 400);
});
test('event short links are stable through retries, editing, archive, and restore; duplicates cannot inherit them', async () => {
  await save('publish', 0, {
    ...draft,
    shortLink: 'https://attacker.example/',
    checkSharing: false,
  });
  let creates = 0;
  const create = async (url) => {
    creates++;
    assert.equal(url, 'https://dallasai.club/club.html?mode=events&event=new-event');
    return 'https://go.dallasai.club/test-event';
  };
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      createEventShareLink(db, 'new-event', actor, create),
    ),
  );
  assert.equal(creates, 1);
  assert.equal(results[0].draft.checkSharing, false);
  assert.ok(
    results.every(
      (r) => r.published.shortLink === 'https://go.dallasai.club/test-event',
    ),
  );
  assert.equal(results[0].revision, 1);
  await save('draft', 1, {
    ...draft,
    title: 'New draft',
    shortLink: 'https://attacker.example/',
  });
  assert.equal(
    (await liveEvents(db, [])).find((e) => e.id === 'new-event').shortLink,
    'https://go.dallasai.club/test-event',
  );
  await save('archive', 2);
  await save('draft', 3, { ...draft });
  await save('restore', 4);
  const restored = await save('publish', 5);
  assert.equal(
    restored.published.shortLink,
    'https://go.dallasai.club/test-event',
  );
  await save('draft', 0, restored.draft, 'copied-event');
  assert.equal(
    (await editorEvents(db, [])).find((e) => e.id === 'copied-event').draft
      .shortLink,
    undefined,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM club_forms.audit WHERE action='event-share-link:new-event'",
      )
    ).rows[0].n,
    1,
  );
});
test('event Short link failures leave saved event data intact and allow a clean retry', async () => {
  let creates = 0;
  const create = async () => {
    creates++;
    throw Error('provider unavailable');
  };
  await assert.rejects(createEventShareLink(db, 'bad/id', actor, create), {
    status: 400,
  });
  await assert.rejects(
    createEventShareLink(db, 'missing-event', actor, create),
    { status: 409 },
  );
  await save('draft', 0);
  await assert.rejects(createEventShareLink(db, 'new-event', actor, create), {
    status: 409,
  });
  assert.equal(creates, 0);
  const published = await save('publish', 1);
  await assert.rejects(
    createEventShareLink(db, 'new-event', actor, create),
    /provider unavailable/,
  );
  assert.deepEqual(
    (await editorEvents(db, [])).find((e) => e.id === 'new-event'),
    published,
  );
  assert.equal(
    (
      await createEventShareLink(
        db,
        'new-event',
        actor,
        async () => 'https://go.dallasai.club/retried-event',
      )
    ).published.shortLink,
    'https://go.dallasai.club/retried-event',
  );
  assert.equal(draftContent(draft).checkSharing, true);
  for (const checkSharing of ['false', null, 0])
    assert.throws(() => draftContent({ ...draft, checkSharing }), {
      status: 400,
    });
});
const save = (action, revision, event = draft, id = 'new-event') =>
  saveEvent(db, { action, id, revision, event }, actor, legacy);
test('activity pages retain attribution in revision order without exposing content or mixing events', async () => {
  await save('draft', 0);
  await db.query(`INSERT INTO club_forms.event_history(event_id,revision,action,actor,content,created_at)
    SELECT 'new-event',n,CASE WHEN n=54 THEN 'archive' WHEN n=55 THEN 'restore' ELSE 'draft' END,
    'second-officer@example.com','{"private":"draft text"}'::jsonb,'2026-10-02T20:00:00Z'::timestamptz + n * interval '1 second'
    FROM generate_series(2,55) n`);
  await save('draft', 0, draft, 'another-event');
  const first = await eventActivity(db, 'new-event');
  assert.equal(first.activity.length, 50);
  assert.equal(first.nextBefore, 6);
  assert.deepEqual(
    first.activity.slice(0, 2).map((r) => r.action),
    ['restore', 'archive'],
  );
  assert.equal(first.activity[0].actor, 'second-officer@example.com');
  assert.equal(
    new Date(first.activity[0].created_at).toISOString(),
    '2026-10-02T20:00:55.000Z',
  );
  assert.deepEqual(Object.keys(first.activity[0]).sort(), [
    'action',
    'actor',
    'created_at',
    'revision',
  ]);
  const older = await eventActivity(db, 'new-event', String(first.nextBefore));
  assert.deepEqual(
    older.activity.map((r) => r.revision),
    [5, 4, 3, 2, 1],
  );
  assert.equal(older.nextBefore, null);
  assert.equal(older.activity.at(-1).actor, actor);
  assert.deepEqual(await eventActivity(db, 'legacy-event'), {
    activity: [],
    nextBefore: null,
  });
  for (const cursor of ['0', '-1', '1.5', '2147483648', 'abc', ''])
    await assert.rejects(
      eventActivity(db, 'new-event', cursor),
      (e) => e.status === 400,
    );
  await assert.rejects(
    eventActivity(db, 'invalid id'),
    (e) => e.status === 400,
  );
});
test('activity timestamps always use Central across winter and summer time', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  assert.equal(dateTime('2026-01-02T20:00:00Z', now), 'Fri, Jan 2, 2:00 PM CT');
  assert.equal(dateTime('2026-07-02T20:00:00Z', now), 'Thu, Jul 2, 3:00 PM CT');
  assert.equal(dateTime(null), '');
  assert.equal(dateTime('not a date'), '');
});
test('archive preserves drafts and live history; edits remain archived; restore stays private until explicitly published', async () => {
  await save('publish', 0);
  await save('draft', 1, { ...draft, title: 'Unpublished improvement' });
  const archived = await save('archive', 2);
  assert.ok(archived.archived_at);
  assert.equal(archived.published, null);
  assert.equal(archived.draft.title, 'Unpublished improvement');
  assert.equal((await liveEvents(db, legacy)).length, 1);
  await assert.rejects(save('publish', 3), (error) => error.status === 409);
  await assert.rejects(save('restore', 2), (error) => error.status === 409);
  const updated = await save('draft', 3, {
    ...draft,
    title: 'Edit while archived',
  });
  assert.ok(updated.archived_at);
  assert.equal(updated.published, null);
  const restored = await save('restore', 4);
  assert.equal(restored.archived_at, null);
  assert.equal(restored.published, null);
  assert.equal(restored.draft.title, 'Edit while archived');
  assert.equal((await liveEvents(db, legacy)).length, 1);
  await assert.rejects(save('restore', 5), (error) => error.status === 409);
  await save('publish', 5, restored.draft);
  assert.equal((await liveEvents(db, legacy)).length, 2);
  const history = (
    await db.query(
      'SELECT action,content FROM club_forms.event_history ORDER BY revision',
    )
  ).rows;
  assert.deepEqual(
    history.map((r) => r.action),
    ['publish', 'draft', 'archive', 'draft', 'restore', 'publish'],
  );
  assert.equal(history[2].content.previousPublished.title, draft.title);
});
test('archiving an untouched legacy event suppresses the static event and supports restoration; missing events cannot be archived', async () => {
  await save('archive', 0, undefined, 'legacy-event');
  assert.deepEqual(await liveEvents(db, legacy), []);
  assert.ok((await editorEvents(db, legacy))[0].archived_at);
  const restored = await save('restore', 1, undefined, 'legacy-event');
  assert.equal(restored.draft.title, draft.title);
  assert.deepEqual(await liveEvents(db, legacy), []);
  await save('publish', 2, restored.draft, 'legacy-event');
  assert.equal((await liveEvents(db, legacy)).length, 1);
  await assert.rejects(save('archive', 0), (error) => error.status === 404);
  await assert.rejects(save('restore', 0), (error) => error.status === 404);
});
test('drafts stay private; editing a published event leaves live content unchanged until publish', async () => {
  await save('draft', 0);
  assert.deepEqual(
    (await liveEvents(db, legacy)).map((e) => e.id),
    ['legacy-event'],
  );
  await save('publish', 1);
  assert.equal(
    (await liveEvents(db, legacy)).find((e) => e.id === 'new-event').title,
    draft.title,
  );
  await save('draft', 2, { ...draft, title: 'A private revision' });
  assert.equal(
    (await liveEvents(db, legacy)).find((e) => e.id === 'new-event').title,
    draft.title,
  );
  assert.equal(
    (await editorEvents(db, legacy)).find((e) => e.id === 'new-event').draft
      .title,
    'A private revision',
  );
  await save('publish', 3, { ...draft, title: 'A private revision' });
  assert.equal(
    (await liveEvents(db, legacy)).find((e) => e.id === 'new-event').title,
    'A private revision',
  );
  const history = (
    await db.query(
      'SELECT action,actor FROM club_forms.event_history ORDER BY revision',
    )
  ).rows;
  assert.deepEqual(
    history.map((r) => r.action),
    ['draft', 'publish', 'draft', 'publish'],
  );
  assert.ok(history.every((r) => r.actor === actor));
});
test('legacy event drafts retain the existing public version and unpublishing overrides the static registry', async () => {
  await save('draft', 0, { ...draft, title: 'Private' }, 'legacy-event');
  assert.equal((await liveEvents(db, legacy))[0].title, draft.title);
  await save('unpublish', 1, undefined, 'legacy-event');
  assert.deepEqual(await liveEvents(db, legacy), []);
  const row = (await editorEvents(db, legacy))[0];
  assert.equal(row.draft.title, 'Private');
  assert.equal(row.published, null);
});
test('stale edits cannot overwrite another officer and failed transactions leave no history', async () => {
  await save('publish', 0);
  await assert.rejects(
    save('draft', 0, { ...draft, title: 'Stale' }),
    (e) => e.status === 409,
  );
  assert.equal(
    (await liveEvents(db, legacy)).find((e) => e.id === 'new-event').title,
    draft.title,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.event_history'))
      .rows[0].n,
    1,
  );
  const broken = {
    transaction: (run) =>
      db.transaction((tx) =>
        run({
          query(sql, args) {
            if (sql.startsWith('INSERT INTO club_forms.event_history'))
              throw new Error('audit failed');
            return tx.query(sql, args);
          },
        }),
      ),
  };
  await assert.rejects(
    saveEvent(
      broken,
      {
        action: 'publish',
        id: 'new-event',
        revision: 1,
        event: { ...draft, title: 'Rollback' },
      },
      actor,
      legacy,
    ),
  );
  assert.equal(
    (await liveEvents(db, legacy)).find((e) => e.id === 'new-event').title,
    draft.title,
  );
});
test('RSVP eligibility follows published content, closed registration, and unpublishing', async () => {
  const rsvp = {
    kind: 'rsvp',
    name: 'Student',
    email: 'student@example.com',
    consent: true,
    requestId: randomUUID(),
    eventId: 'new-event',
  };
  await save('draft', 0);
  assert.throws(() => validate(rsvp, legacy), /unavailable/);
  await save('publish', 1);
  assert.equal(
    validate(rsvp, await liveEvents(db, legacy)).data.eventTitle,
    draft.title,
  );
  await save('publish', 2, { ...draft, registrationOpen: false });
  const closed = await liveEvents(db, legacy);
  assert.throws(() => validate(rsvp, closed), /unavailable/);
  await save('unpublish', 3);
  assert.equal(
    (await liveEvents(db, legacy)).some((e) => e.id === 'new-event'),
    false,
  );
});
test('dates, Central daylight saving changes, end times, and meeting URLs are validated', () => {
  assert.equal(centralTime('2026-07-10', '16:30'), '2026-07-10T16:30:00-05:00');
  assert.equal(centralTime('2026-12-10', '16:30'), '2026-12-10T16:30:00-06:00');
  assert.throws(() => centralTime('2026-03-08', '02:30'), /clocks change/);
  assert.throws(() => centralTime('2026-11-01', '01:30'), /clocks change/);
  for (const change of [
    { date: '2026-02-30' },
    { endTime: '15:00' },
    { startTime: '25:00' },
    { meetingUrl: 'javascript:alert(1)' },
    { meetingUrl: 'https://name:password@example.com' },
  ])
    assert.throws(() => draftContent({ ...draft, ...change }));
  assert.equal(draftContent({ title: 'Date not decided' }).date, '');
  assert.throws(
    () => publicContent('draft', { title: 'Date not decided' }),
    /date/,
  );
  assert.equal(
    publicContent('safe', { ...draft, title: '<img src=x onerror=alert(1)>' })
      .title,
    '<img src=x onerror=alert(1)>',
  );
});
test('registry reads JSON and YAML frontmatter and keeps scheduled/draft events private', () => {
  const header = { id: 'example', title: 'An event', eventDate: '2099-10-02' };
  const json = JSON.stringify(header, null, 2) + '\n\nDescription.';
  assert.equal(parseEventSource(json).summary, 'Description.');
  assert.equal(
    parseEventSource(
      '---\nid: example\ntitle: An event\neventDate: 2099-10-02\n---\n\nDescription.',
    ).title,
    'An event',
  );
  assert.equal(
    parseEventSource(JSON.stringify({ ...header, draft: true }, null, 2)),
    null,
  );
  assert.equal(
    parseEventSource(
      JSON.stringify({ ...header, publishDate: '2099-01-01' }, null, 2),
    ),
    null,
  );
});
test('public API exposes only live content; admin reads and writes require authorization and matching origin', async () => {
  process.env.AUTH_BASE_URL = 'https://office.example.com';
  await save('draft', 0);
  let allowed = false;
  let providerFails = true;
  const handler = eventHandler({
    getDatabase: () => db,
    originals: legacy,
    createShortLink: async () => {
      if (providerFails)
        throw Error('provider failure must not hide saved event');
      return 'https://go.dallasai.club/api-event';
    },
    authorize: async () => {
      if (!allowed) throw new RequestError(401, 'Sign in');
      return { email: actor };
    },
  });
  const call = async (
    method,
    url,
    body,
    origin = 'https://office.example.com',
  ) => {
    const response = {
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(value) {
        this.body = JSON.parse(value);
      },
    };
    await handler(
      {
        method,
        url,
        headers: { origin, 'content-type': 'application/json' },
        body,
      },
      response,
    );
    return response;
  };
  const publicResult = await call('GET', '/api/events');
  assert.equal(publicResult.statusCode, 200);
  assert.equal(publicResult.headers['Access-Control-Allow-Origin'], '*');
  assert.deepEqual(
    publicResult.body.events.map((e) => e.id),
    ['legacy-event'],
  );
  assert.equal(JSON.stringify(publicResult.body).includes(actor), false);
  assert.equal((await call('GET', '/api/events?admin=1')).statusCode, 401);
  assert.equal(
    (await call('GET', '/api/events?admin=1&history=new-event')).statusCode,
    401,
  );
  assert.equal(
    (await call('GET', '/api/events?history=new-event')).statusCode,
    401,
  );
  const body = {
    action: 'publish',
    id: 'new-event',
    revision: 1,
    event: draft,
  };
  assert.equal((await call('POST', '/api/events', body)).statusCode, 401);
  assert.equal(
    (await call('POST', '/api/events', { action: 'share-link', id: body.id }))
      .statusCode,
    401,
  );
  allowed = true;
  const history = await call('GET', '/api/events?admin=1&history=new-event');
  assert.equal(history.statusCode, 200);
  assert.equal(history.headers['Cache-Control'], 'no-store');
  assert.equal(history.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(history.body.activity[0].actor, actor);
  assert.equal(history.body.activity[0].action, 'draft');
  assert.equal(history.body.activity[0].content, undefined);
  assert.equal(
    (await call('POST', '/api/events', body, 'https://evil.example'))
      .statusCode,
    403,
  );
  assert.equal(
    (await call('POST', '/api/events', { ...body, action: 'preview' }))
      .statusCode,
    200,
  );
  assert.equal((await liveEvents(db, legacy)).length, 1);
  const published = await call('POST', '/api/events', body);
  assert.equal(published.statusCode, 200);
  assert.equal(published.body.event.published.title, draft.title);
  assert.match(published.body.sharingError, /Short link could not/);
  assert.equal(published.body.event.published.shortLink, undefined);
  providerFails = false;
  const retry = { action: 'share-link', id: body.id };
  assert.equal(
    (await call('POST', '/api/events', retry, 'https://evil.example'))
      .statusCode,
    403,
  );
  assert.equal(
    (await call('POST', '/api/events', retry)).body.event.published.shortLink,
    'https://go.dallasai.club/api-event',
  );
  const preview = await call('POST', '/api/events', {
    ...body,
    action: 'preview',
  });
  assert.equal(
    preview.body.event.shortLink,
    'https://go.dallasai.club/api-event',
  );
  assert.equal((await liveEvents(db, legacy)).length, 2);
});
