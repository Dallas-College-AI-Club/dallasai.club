import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.mjs';
import { adminHandler } from '../api/admin.mjs';
import { upcomingEvents, recentEndedEvents, eventEnd } from '../lib/inbox.mjs';
import { uuid } from '../lib/validation.mjs';
let db, server, origin, events;
before(async () => {
  db = await testDatabase();
  server = http.createServer(
    adminHandler({
      authorize: () => ({ email: 'officer@example.com' }),
      getDatabase: () => db,
      getEvents: async () => events,
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    'TRUNCATE club_forms.entries,club_forms.custom_surveys,club_forms.events CASCADE',
  );
  events = [
    { id: 'future', title: 'Future', date: '2099-01-01' },
    { id: 'potential', title: 'Potential', potential: true, date: '' },
    {
      id: 'recent',
      title: 'Recently ended',
      date: new Date(Date.now() - 2 * 86400000).toISOString(),
      end: new Date(Date.now() - 86400000).toISOString(),
    },
    { id: 'old', title: 'Long ago', date: '2020-01-01' },
  ];
});
async function entry(kind, days, data = {}, status = 'new') {
  const id = randomUUID();
  await db.query(
    `INSERT INTO club_forms.entries(id,kind,email,name,data,dedupe_key,created_at,review_status)
    VALUES($1::uuid,$2,'student@example.edu','Student',$3,$1::text,now()-$4::int*interval '1 day',$5)`,
    [id, kind, JSON.stringify(data), days, status],
  );
  return id;
}
async function response({
  eventId,
  days = 0,
  expires = -1,
  active = true,
  status = 'open',
  name = 'Respondent',
  answered = true,
} = {}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at,definition)
    VALUES($1::uuid,$1::text,'Survey','1',$2,$1::text,now()+$3::int*interval '1 day',$4)`,
    [id, status, expires, JSON.stringify({ eventId })],
  );
  await db.query(
    `INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email,active)
    VALUES($1,'member',$2,'survey@example.edu',$3)`,
    [id, name, active],
  );
  await db.query(
    `INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses,submitted_at)
    VALUES($1,'member',1,$3,now()-$2::int*interval '1 day')`,
    [id, days, answered ? '[{"id":"q","value":"yes"}]' : '[]'],
  );
  return id;
}
async function get(query) {
  const res = await fetch(origin + '/api/admin?' + query);
  assert.equal(res.status, 200, await res.clone().text());
  return res.json();
}
test('upcoming includes undated potentials and moves timestamp events at their end, with Central date-only boundaries', () => {
  const event = {
    id: 'event',
    date: '2026-11-01',
    end: '2026-11-01T02:00:00-06:00',
  };
  assert.equal(
    upcomingEvents([event], new Date('2026-11-01T07:59:59Z')).length,
    1,
  );
  assert.equal(
    upcomingEvents([event], new Date('2026-11-01T08:00:00Z')).length,
    0,
  );
  assert.equal(
    eventEnd({ date: '2026-11-01' }).toISOString(),
    '2026-11-02T06:00:00.000Z',
  );
  assert.equal(
    upcomingEvents(
      [{ id: 'day', date: '2026-03-08' }],
      new Date('2026-03-09T04:59:59Z'),
    ).length,
    1,
  );
  assert.equal(
    upcomingEvents(
      [{ id: 'day', date: '2026-03-08' }],
      new Date('2026-03-09T05:00:00Z'),
    ).length,
    0,
  );
  assert.equal(
    recentEndedEvents(
      [{ id: 'day', date: '2026-03-08' }],
      new Date('2026-03-23T05:00:00Z'),
    ).length,
    1,
  );
  assert.equal(
    recentEndedEvents(
      [{ id: 'day', date: '2026-03-08' }],
      new Date('2026-03-23T05:00:01Z'),
    ).length,
    0,
  );
  assert.equal(
    upcomingEvents([
      { id: 'archived', date: '2099-01-01', archived_at: '2026-01-01' },
    ]).length,
    0,
  );
  assert.equal(
    upcomingEvents([{ id: 'draft', date: '2099-01-01', live: false }]).length,
    0,
  );
  assert.equal(
    recentEndedEvents([
      { id: 'archived', date: '2099-01-01', archived_at: '2026-01-01' },
    ]).length,
    0,
  );
});
test('Inbox buckets use dates, not old review states; archived records never appear in current/past/recent', async () => {
  const future = await entry('rsvp', 60, { eventId: 'future' });
  const potential = await entry('rsvp', 60, { eventId: 'potential' });
  const ended = await entry('rsvp', 0, { eventId: 'recent' });
  const recent = await entry('question', 13, {}, 'reviewed');
  const old = await entry('question', 15);
  await entry('question', 0, {}, 'closed');
  assert.deepEqual(
    new Set((await get('status=current')).entries.map((e) => e.id)),
    new Set([future, potential, recent]),
  );
  assert.deepEqual(
    new Set((await get('status=past')).entries.map((e) => e.id)),
    new Set([ended, old]),
  );
  assert.deepEqual(
    new Set((await get('status=recent')).entries.map((e) => e.id)),
    new Set([ended, recent]),
  );
  assert.equal((await get('status=closed')).total, 1);
  assert.equal(
    (await get('home=1')).counts.reduce((n, row) => n + row.new, 0),
    2,
  );
});
test('custom and feedback responses share counts, Home recency, search, archive and pagination without duplication', async () => {
  await response({ eventId: 'recent', days: 40 });
  await response({ eventId: 'old' });
  await response({ days: 40, expires: 20 });
  await response({ days: 13, status: 'draft' });
  await response({ days: 15 });
  await response({ active: false });
  await response({ status: 'archived' });
  await response({ answered: false });
  const current = await get('status=current');
  assert.equal(current.total, 3);
  assert.equal((await get('status=past')).total, 2);
  assert.equal((await get('status=closed')).total, 2);
  assert.equal((await get('status=recent')).total, 2);
  assert.ok(current.entries.every((e) => uuid.test(e.id)));
  assert.equal(new Set(current.entries.map((e) => e.id)).size, 3);
  assert.equal((await get('status=current&q=Respondent')).total, 3);
  const csv = await (
    await fetch(origin + '/api/admin?status=current&export=csv')
  ).text();
  assert.match(csv, /Custom survey responses/);
  assert.match(csv, /Event feedback/);
  for (const internal of [
    'surveyId',
    'advisorId',
    'expiresAt',
    'memberActive',
    'surveyArchived',
  ])
    assert.ok(!csv.includes(internal));
  const home = await get('home=1');
  assert.equal(
    home.counts.reduce((n, row) => n + row.new, 0),
    2,
  );
  assert.equal(
    home.counts.reduce((n, row) => n + row.current, 0),
    3,
  );
  assert.equal(home.eventFeedback, 1);
  assert.equal(home.newest.length, 2);
  const poll = await get('counts=1&status=current');
  assert.equal(poll.newInView, 1);
  for (let n = 0; n < 51; n++) await response({ name: 'Paged ' + n });
  const first = await get('status=current&q=Paged');
  assert.equal(first.total, 51);
  assert.equal(first.entries.length, 50);
  const second = await get(
    'status=current&q=Paged&before=' + encodeURIComponent(first.nextBefore),
  );
  assert.equal(second.entries.length, 1);
  assert.ok(!first.entries.some((e) => e.id === second.entries[0].id));
});
