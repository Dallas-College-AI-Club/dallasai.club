import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import {
  draftContent,
  publicContent,
  centralTime,
} from '../lib/event-content.mjs';
import { parseEventSource } from '../lib/event-registry.mjs';
import { saveEvent, liveEvents, editorEvents } from '../lib/events.mjs';
import { eventHandler } from '../api/events.mjs';
import { RequestError } from '../lib/errors.mjs';
import { validate } from '../lib/validation.mjs';
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
  db = new PGlite();
  await db.exec('CREATE SCHEMA club_forms');
  await db.exec(
    await readFile(new URL('../006_event_editor.sql', import.meta.url), 'utf8'),
  );
});
beforeEach(() => db.exec('TRUNCATE club_forms.events CASCADE'));
after(() => db.close());
const save = (action, revision, event = draft, id = 'new-event') =>
  saveEvent(db, { action, id, revision, event }, actor, legacy);
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
  const handler = eventHandler({
    getDatabase: () => db,
    originals: legacy,
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
  const body = {
    action: 'publish',
    id: 'new-event',
    revision: 1,
    event: draft,
  };
  assert.equal((await call('POST', '/api/events', body)).statusCode, 401);
  allowed = true;
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
  assert.equal((await call('POST', '/api/events', body)).statusCode, 200);
  assert.equal((await liveEvents(db, legacy)).length, 2);
});
