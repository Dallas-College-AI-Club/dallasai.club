// Release B: the Home summary, true RSVP counts per event in the Inbox, and
// officers' own Help topics (migration 019).
import { testDatabase } from './helpers/db.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { adminHandler } from '../api/admin.mjs';
import { RequestError } from '../lib/errors.mjs';
let db, server, origin;
const events = [
  { id: 'past', title: 'Past', date: '2020-01-01' },
  {
    id: 'next',
    title: 'Next event',
    date: '2099-01-02T17:00:00-06:00',
    category: 'Workshop',
  },
  { id: 'later', title: 'Later event', date: '2099-03-01' },
  { id: 'maybe', title: 'Maybe someday', date: '', potential: true },
];
const officer = 'officer@example.com';
const authorize = (req) => {
  if (req.headers['x-test-admin'] === 'yes') return { email: officer };
  throw new RequestError(401, 'Sign in');
};
const request = (route, body) =>
  fetch(origin + route, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-test-admin': 'yes',
      ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const get = async (query) => {
  const response = await request('/api/admin' + query);
  assert.equal(response.status, 200, query);
  return response.json();
};
const post = async (body) => {
  const response = await request('/api/admin', body);
  return { status: response.status, body: await response.json() };
};
let minute = 0;
const insert = async ({
  kind = 'question',
  email = 'member@example.edu',
  name = 'Member Person',
  data = {},
  status = 'new',
  state = 'active',
} = {}) => {
  const id = randomUUID(),
    created = new Date(Date.now() - 60000 + minute++ * 1000).toISOString();
  await db.query(
    'INSERT INTO club_forms.entries(id,kind,email,name,data,dedupe_key,created_at,updated_at,review_status,state) VALUES($1::uuid,$2,$3,$4,$5,$1::text,$6,$6,$7,$8)',
    [id, kind, email, name, JSON.stringify(data), created, status, state],
  );
  return id;
};
const rsvp = (eventId, extra = {}) =>
  insert({
    kind: 'rsvp',
    email: randomUUID() + '@example.edu',
    data: { eventId, eventTitle: 'Saved ' + eventId, eventDate: '2099-01-02' },
    ...extra,
  });
before(async () => {
  db = await testDatabase();
  server = http.createServer(
    adminHandler({
      getDatabase: () => db,
      authorize,
      getEvents: async () => events,
      storage: {},
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
});
beforeEach(() =>
  db.exec(
    `TRUNCATE club_forms.entries,club_forms.contacts,club_forms.audit,club_forms.events,club_forms.custom_surveys,club_forms.help_entries RESTART IDENTITY CASCADE`,
  ),
);
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

test('Home preserves shared status counts and does not report permanent deletion totals', async () => {
  await insert({ status: 'closed' });
  await insert({ status: 'new' });
  await insert({ status: 'reviewed' });
  await db.query(
    "INSERT INTO club_forms.audit(actor,action) VALUES($1,'submission-permanently-deleted'),($1,'contact-purged:entries=3:notes=2:files=0'),($1,'contact-purged:entries=0:notes=1:files=0')",
    [officer],
  );
  const home = await get('?home=1');
  const question = home.counts.find((row) => row.kind === 'question');
  assert.equal(question.total, 3);
  assert.equal(question.new, 2);
  assert.equal(question.reviewed, 0);
  assert.equal(question.closed, 1);
  assert.equal(home.deletedSubmissions, undefined);
});

test('Home current feedback excludes events that have not ended or ended over fourteen days ago', async () => {
  for (const [status, eventId, active, answered] of [
    ['open', 'past', true, true],
    ['closed', 'next', true, true],
    ['open', 'next', false, true],
    ['open', 'next', true, false],
    ['draft', 'next', true, true],
    ['open', null, true, true],
  ]) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at,definition)
       VALUES($1::uuid,$1::text,'Feedback','1',$2,$1::text,now()-interval '1 day',$3)`,
      [id, status, JSON.stringify({ eventId })],
    );
    await db.query(
      `INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email,active)
       VALUES($1,'member','Member','member@example.edu',$2)`,
      [id, active],
    );
    await db.query(
      `INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses)
       VALUES($1,'member',1,$2)`,
      [id, answered ? '[{"id":"q1","text":"Good event"}]' : '[]'],
    );
  }
  assert.equal((await get('?home=1')).eventFeedback, 0);
});

test('Home groups active RSVPs by event, archived and cancelled ones left out', async () => {
  await rsvp('next');
  await rsvp('next');
  await rsvp('next', { status: 'reviewed' });
  await rsvp('next', { status: 'closed' });
  await rsvp('next', { state: 'cancelled' });
  await rsvp('past');
  await rsvp('past', { status: 'closed' });
  await rsvp('later', { status: 'reviewed' });
  await rsvp('archived-only', { status: 'closed' });
  const home = await get('?home=1');
  assert.deepEqual(
    home.rsvpGroups.map(({ id, title, total, new: fresh, past }) => ({
      id,
      title,
      total,
      new: fresh,
      past,
    })),
    [
      // Upcoming first; the published title wins over the saved snapshot.
      { id: 'next', title: 'Next event', total: 3, new: 3, past: false },
      { id: 'later', title: 'Later event', total: 1, new: 1, past: false },
      { id: 'past', title: 'Past', total: 1, new: 1, past: true },
    ],
  );
  // The counts are the poll's: per kind, RSVPs for past events apart.
  assert.equal(home.counts.find((row) => row.kind === 'rsvp').new, 5);
  assert.equal(home.counts.find((row) => row.kind === 'rsvp-past').new, 1);
  assert.equal(home.user, officer);
});

test('Home excludes archived and deleted RSVP parents from new groups and next or potential event totals', async () => {
  for (const [id, status] of [
    ['next', 'archived'],
    ['maybe', 'deleted'],
  ]) {
    await db.query(
      `INSERT INTO club_forms.events(id,draft,published,revision,published_revision,updated_by,rsvp_survey_status)
      VALUES($1,'{"title":"Published event"}','{"title":"Published event"}',1,1,$2,$3)`,
      [id, officer, status],
    );
    await rsvp(id);
  }
  const home = await get('?home=1');
  assert.deepEqual(home.rsvpGroups, []);
  assert.equal(home.nextEvent.rsvps, 0);
  assert.equal(home.potential.find((event) => event.id === 'maybe').rsvps, 0);
  assert.equal(home.counts.find((row) => row.kind === 'rsvp').new, 0);
});

test('Home: newest New submissions, next dated event, potential events, drafts and the open survey', async () => {
  await insert({ data: { subject: 'Is the workshop beginner friendly?' } });
  await insert({
    kind: 'join',
    name: 'Second Person',
    data: { campus: 'Richland' },
  });
  await insert({ status: 'reviewed', data: { subject: 'Old' } });
  await rsvp('next');
  await rsvp('next', { status: 'reviewed' });
  await rsvp('next', { status: 'closed' });
  await rsvp('next', { state: 'cancelled' });
  for (const [id, published, revision, publishedRevision] of [
    ['draft-only', null, 1, 0],
    ['changed', { id: 'changed', title: 'Live' }, 3, 2],
    ['published', { id: 'published', title: 'Live' }, 2, 2],
  ])
    await db.query(
      `INSERT INTO club_forms.events(id,draft,published,revision,published_revision,updated_by) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        id,
        JSON.stringify({ title: 'Draft ' + id, date: '2099-05-01' }),
        published && JSON.stringify(published),
        revision,
        publishedRevision,
        officer,
      ],
    );
  const survey = randomUUID();
  await db.query(
    `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at) VALUES($1,'advisors','Advisor Studio','1','open','digest',now()+interval '30 days')`,
    [survey],
  );
  for (const [advisor, answered] of [
    ['a1', true],
    ['a2', true],
    ['a3', false],
  ]) {
    await db.query(
      `INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email) VALUES($1,$2,$3,$4)`,
      [survey, advisor, 'Advisor ' + advisor, advisor + '@example.edu'],
    );
    await db.query(
      `INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,$2,1,$3)`,
      [survey, advisor, answered ? '[{"id":"q1","value":"yes"}]' : '[]'],
    );
  }
  const home = await get('?home=1');
  // RSVPs are grouped by event instead; only other kinds are listed.
  assert.deepEqual(
    home.newest.map((entry) => [entry.kind, entry.name, entry.preview]).sort(),
    [
      ['join', 'Second Person', 'Richland'],
      ['question', 'Member Person', 'Is the workshop beginner friendly?'],
      ['question', 'Member Person', 'Old'],
      ['survey', 'Advisor a1', 'Advisor Studio'],
      ['survey', 'Advisor a2', 'Advisor Studio'],
    ],
  );
  assert.equal(home.newest[0].data, undefined);
  assert.deepEqual(home.nextEvent, {
    id: 'next',
    title: 'Next event',
    date: '2099-01-02T17:00:00-06:00',
    category: 'Workshop',
    rsvps: 2,
  });
  assert.deepEqual(home.potential, [
    { id: 'maybe', title: 'Maybe someday', rsvps: 0 },
  ]);
  assert.deepEqual(
    home.unpublished.map((event) => [event.id, event.title, event.live]).sort(),
    [
      ['changed', 'Draft changed', true],
      ['draft-only', 'Draft draft-only', false],
    ],
  );
  assert.equal(home.survey.title, 'Advisor Studio');
  assert.equal(home.survey.responses, 2);
});

test('Home survey tile selects open surveys with published events while keeping draft responses and event work', async () => {
  const legacy = randomUUID();
  await db.query(
    `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at,created_at)
    VALUES($1,'legacy-home','Legacy published survey','1','open','digest',now()+interval '30 days',now()-interval '1 day')`,
    [legacy],
  );
  await db.query(
    `INSERT INTO club_forms.events(id,draft,published,revision,published_revision,updated_by,archived_at)
    VALUES('draft-feedback','{"title":"Draft feedback event"}',NULL,1,0,$1,NULL),
    ('archived-feedback','{"title":"Archived feedback event"}',NULL,1,1,$1,now())`,
    [officer],
  );
  for (const [slug, status, eventId, expired] of [
    ['draft-home', 'draft', null, false],
    ['closed-home', 'closed', null, false],
    ['archived-home', 'archived', null, false],
    ['expired-home', 'open', null, true],
    ['unpublished-feedback-home', 'open', 'draft-feedback', false],
    ['archived-feedback-home', 'open', 'archived-feedback', false],
    ['missing-feedback-home', 'open', 'missing-event', false],
  ]) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at,definition)
      VALUES($1,$2,$2,'1',$3,$1::uuid::text,now()+($4::int*interval '1 day'),$5)`,
      [
        id,
        slug,
        status,
        expired ? -1 : 30,
        JSON.stringify(eventId ? { eventId } : {}),
      ],
    );
    if (status === 'draft') {
      await db.query(
        `INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email) VALUES($1,'saved-draft','Saved draft respondent','draft@example.edu')`,
        [id],
      );
      await db.query(
        `INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,'saved-draft',1,'[{"id":"q1","value":"yes"}]')`,
        [id],
      );
    }
    assert.equal((await get('?home=1')).survey.id, legacy, slug);
  }
  const home = await get('?home=1');
  assert.ok(
    home.newest.some((entry) => entry.name === 'Saved draft respondent'),
  );
  assert.equal(home.counts.find((row) => row.kind === 'survey').new, 1);
  assert.ok(home.unpublished.some((event) => event.id === 'draft-feedback'));
  const linked = randomUUID();
  await db.query(
    `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at,definition)
    VALUES($1,'published-feedback-home','Published feedback','1','open',$1::uuid::text,now()+interval '30 days','{"eventId":"next"}')`,
    [linked],
  );
  assert.equal((await get('?home=1')).survey.id, linked);
});

test('potential event counts include reviewed RSVPs and zero-response events without counting closed or cancelled responses', async () => {
  events.push(
    {
      id: 'dated-potential',
      title: 'Dated potential',
      date: '2098-01-01',
      potential: true,
    },
    {
      id: 'closed-potential',
      title: 'Closed potential',
      date: '',
      potential: true,
      registrationOpen: false,
    },
  );
  try {
    await rsvp('maybe', { status: 'reviewed' });
    await rsvp('maybe', { status: 'closed' });
    await rsvp('maybe', { state: 'cancelled' });
    const home = await get('?home=1');
    assert.equal(home.nextEvent.id, 'next');
    assert.equal(home.potential.find((e) => e.id === 'maybe').rsvps, 1);
    assert.equal(
      home.potential.find((e) => e.id === 'dated-potential').rsvps,
      0,
    );
    assert.equal(
      home.potential.find((e) => e.id === 'closed-potential').rsvps,
      null,
    );
    assert.equal(
      home.rsvpGroups.some((e) => e.id === 'maybe'),
      true,
    );
  } finally {
    events.splice(-2);
  }
});

test('Home activity lists officer actions with labels, never member data', async () => {
  const entry = await insert({
    email: 'private.person@example.edu',
    name: 'Private Person',
    data: { subject: 'Private subject' },
  });
  assert.equal(
    (
      await post({
        action: 'review',
        id: entry,
        status: 'reviewed',
        from: 'new',
      })
    ).status,
    200,
  );
  await db.query(
    "INSERT INTO club_forms.audit(actor,entry_id,action) VALUES('website',$1,'resubmitted')",
    [entry],
  );
  await post({
    action: 'comment',
    entryId: entry,
    id: randomUUID(),
    body: 'Private comment body',
  });
  await db.query(
    `INSERT INTO club_forms.events(id,draft,revision,updated_by) VALUES('fall','{"title":"Fall Welcome"}',1,$1)`,
    [officer],
  );
  await db.query(
    `INSERT INTO club_forms.event_history(event_id,revision,action,actor,content) VALUES('fall',1,'draft',$1,'{"title":"Fall Welcome"}')`,
    [officer],
  );
  const home = await get('?home=1');
  const text = JSON.stringify(home.activity);
  for (const secret of [
    'Private Person',
    'private.person@example.edu',
    'Private subject',
    'Private comment body',
    'website',
  ])
    assert.ok(!text.includes(secret), secret);
  assert.ok(
    home.activity.some(
      (row) => row.action === 'review:reviewed' && row.label === 'question',
    ),
  );
  assert.ok(
    home.activity.some(
      (row) => row.source === 'event' && row.label === 'Fall Welcome',
    ),
  );
  assert.ok(home.activity.every((row) => row.actor === officer));
});

test('the Inbox list gives each event group its true size, beyond the page', async () => {
  for (let n = 0; n < 53; n++) await rsvp('next');
  await rsvp('next', { status: 'reviewed' });
  await rsvp('later');
  await insert();
  const page = await get('?kind=rsvp&status=new');
  assert.equal(page.entries.length, 50);
  assert.deepEqual(page.eventCounts, { next: 53, later: 1 });
  // The same filters as the list: status and event narrow the counts too.
  assert.deepEqual((await get('?kind=rsvp-all&status=reviewed')).eventCounts, {
    next: 1,
  });
  assert.deepEqual((await get('?kind=rsvp&eventId=later')).eventCounts, {
    later: 1,
  });
  assert.deepEqual((await get('?kind=question')).eventCounts, {});
});

test('Help topics: add, retry, edit, archive, restore and delete, each audited without its text', async () => {
  const id = randomUUID();
  const created = await post({
    action: 'help-save',
    id,
    title: '  Room keys  ',
    body: 'Ask facilities.\r\n\r\nReturn by 5 PM.',
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.entry.title, 'Room keys');
  assert.equal(created.body.entry.body, 'Ask facilities.\n\nReturn by 5 PM.');
  assert.equal(created.body.entry.revision, 1);
  // A retried create with the same text returns the same topic.
  const retry = await post({
    action: 'help-save',
    id,
    title: 'Room keys',
    body: 'Ask facilities.\n\nReturn by 5 PM.',
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.entry.revision, 1);
  const edited = await post({
    action: 'help-save',
    id,
    revision: 1,
    title: 'Room keys',
    body: 'Ask the front desk.',
  });
  assert.equal(edited.body.entry.revision, 2);
  // An edit from an older revision is refused, not overwritten.
  const stale = await post({
    action: 'help-save',
    id,
    revision: 1,
    title: 'Room keys',
    body: 'Old text',
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'stale-help');
  const archived = await post({ action: 'help-archive', id, revision: 2 });
  assert.equal(archived.body.entry.archived, true);
  let list = await get('?help=1');
  assert.equal(list.ready, true);
  assert.deepEqual(
    list.entries.map((entry) => [entry.title, entry.archived]),
    [['Room keys', true]],
  );
  const restored = await post({ action: 'help-restore', id, revision: 3 });
  assert.equal(restored.body.entry.archived, false);
  assert.equal(
    (await post({ action: 'help-delete', id, revision: 3 })).status,
    409,
  );
  assert.deepEqual(
    (await post({ action: 'help-delete', id, revision: 4 })).status,
    409,
  );
  await post({ action: 'help-archive', id, revision: 4 });
  assert.deepEqual(
    (await post({ action: 'help-delete', id, revision: 5 })).body,
    {
      deleted: true,
      id,
    },
  );
  list = await get('?help=1');
  assert.deepEqual(list.entries, []);
  assert.equal(
    (await post({ action: 'help-archive', id, revision: 4 })).status,
    404,
  );
  const audit = (
    await db.query(
      'SELECT actor,entry_id,action,help_topic_id FROM club_forms.audit ORDER BY id',
    )
  ).rows;
  assert.deepEqual(
    audit.map((row) => row.action),
    [
      'help-created',
      'help-edited',
      'help-archived',
      'help-restored',
      'help-archived',
      'help-deleted',
    ],
  );
  assert.ok(audit.every((row) => row.actor === officer && !row.entry_id));
  assert.ok(audit.every((row) => row.help_topic_id === id));
  const history = await get('?helpHistory=' + id);
  assert.equal(history.history.length, 6);
  assert.equal(history.history[0].action, 'help-deleted');
  assert.ok(!JSON.stringify(history).includes('Room keys'));
});

test('Help history is scoped, paged and officer-only; categories and archive edits are validated', async () => {
  const id = randomUUID(),
    other = randomUUID();
  const created = await post({
    action: 'help-save',
    id,
    title: 'A topic',
    body: 'Text',
    category: 'essentials',
  });
  assert.equal(created.body.entry.category, 'essentials');
  assert.equal(
    (
      await post({
        action: 'help-save',
        id: other,
        title: 'B',
        body: 'B',
        category: 'invalid',
      })
    ).status,
    400,
  );
  await post({ action: 'help-save', id: other, title: 'Other', body: 'B' });
  await db.query(
    "INSERT INTO club_forms.audit(actor,action,help_topic_id) SELECT 'other@example.com','help-edited',$1 FROM generate_series(1,104)",
    [id],
  );
  const first = await get('?helpHistory=' + id);
  assert.equal(first.history.length, 100);
  assert.ok(first.history.every((row) => row.help_topic_id === id));
  const second = await get('?helpHistory=' + id + '&before=' + first.next);
  assert.equal(second.history.length, 5);
  assert.equal(second.next, null);
  assert.equal(
    new Set([...first.history, ...second.history].map((row) => row.id)).size,
    105,
  );
  assert.equal(
    (await fetch(origin + '/api/admin?helpHistory=' + id)).status,
    401,
  );
  assert.equal((await request('/api/admin?helpHistory=bad')).status, 400);
  assert.equal(
    (await request('/api/admin?helpHistory=all&before=bad')).status,
    400,
  );
  await post({ action: 'help-archive', id, revision: 1 });
  assert.equal(
    (
      await post({
        action: 'help-save',
        id,
        revision: 2,
        title: 'Changed',
        body: 'B',
      })
    ).status,
    409,
  );
});

test('Guidebook migration preserves officer edits and deleted topics on repeat', async () => {
  const migration = await readFile(
    new URL('../020_help_guidebook.sql', import.meta.url),
    'utf8',
  );
  await db.exec(migration);
  const id = '00000000-0000-4000-8000-000000000101';
  await post({
    action: 'help-save',
    id,
    revision: 1,
    title: 'Officer version',
    body: 'Updated instructions',
  });
  await db.exec(migration);
  assert.equal(
    (await get('?help=1')).entries.find((entry) => entry.id === id).title,
    'Officer version',
  );
  await post({ action: 'help-archive', id, revision: 2 });
  await post({ action: 'help-delete', id, revision: 3 });
  await db.exec(migration);
  assert.equal((await get('?help=1')).entries.length, 8);
  assert.ok(!(await get('?help=1')).entries.some((entry) => entry.id === id));
});

test('Help topics are validated as plain text', async () => {
  const save = (fields) =>
    post({ action: 'help-save', id: randomUUID(), ...fields });
  for (const [fields, message] of [
    [{ title: '', body: 'Text' }, 'Add a title and some text.'],
    [{ title: 'Title', body: ' \n ' }, 'Add a title and some text.'],
    [
      { title: 'x'.repeat(121), body: 'Text' },
      'Keep the title under 120 characters.',
    ],
    [
      { title: 'Title', body: 'x'.repeat(8001) },
      'Keep the text under 8,000 characters.',
    ],
  ]) {
    const result = await save(fields);
    assert.equal(result.status, 400);
    assert.equal(result.body.error, message);
  }
  assert.equal(
    (await post({ action: 'help-save', id: 'nope', title: 'T', body: 'B' }))
      .status,
    400,
  );
  // Markup is stored as typed and only ever shown as text; control
  // characters other than line breaks are dropped.
  const markup = await save({
    title: '<img src=x onerror=alert(1)>\u0007',
    body: '<script>alert(1)</script>\n\tIndented',
  });
  assert.equal(markup.body.entry.title, '<img src=x onerror=alert(1)>');
  assert.equal(markup.body.entry.body, '<script>alert(1)</script>\n\tIndented');
  // The database refuses what the API would never send.
  await assert.rejects(
    db.query(
      `INSERT INTO club_forms.help_entries(id,title,body,created_by,updated_by) VALUES($1,$2,'b','a@example.com','a@example.com')`,
      [randomUUID(), 'x'.repeat(121)],
    ),
  );
});

test('before migration 019, Help lists nothing and writes say it is not set up', async () => {
  await db.exec(
    'ALTER TABLE club_forms.help_entries RENAME TO help_entries_later',
  );
  try {
    assert.deepEqual(await get('?help=1'), {
      user: officer,
      entries: [],
      ready: false,
    });
    const result = await post({
      action: 'help-save',
      id: randomUUID(),
      title: 'Title',
      body: 'Text',
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'help-not-set-up');
    assert.match(result.body.error, /migrations 019 and 020/);
    assert.equal(
      (await post({ action: 'help-delete', id: randomUUID(), revision: 1 }))
        .status,
      503,
    );
  } finally {
    await db.exec(
      'ALTER TABLE club_forms.help_entries_later RENAME TO help_entries',
    );
  }
});

test('Help writes need an officer and the office origin', async () => {
  const anonymous = await fetch(origin + '/api/admin?help=1');
  assert.equal(anonymous.status, 401);
  const crossSite = await fetch(origin + '/api/admin', {
    method: 'POST',
    headers: {
      'x-test-admin': 'yes',
      'Content-Type': 'application/json',
      Origin: 'https://evil.example.com',
    },
    body: JSON.stringify({
      action: 'help-save',
      id: randomUUID(),
      title: 'T',
      body: 'B',
    }),
  });
  assert.equal(crossSite.status, 403);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM club_forms.help_entries'))
      .rows[0].n,
    0,
  );
});
