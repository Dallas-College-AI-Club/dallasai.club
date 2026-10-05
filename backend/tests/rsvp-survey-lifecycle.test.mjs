import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { testDatabase } from './helpers/db.mjs';
import { publicContent } from '../lib/event-content.mjs';
import { liveEvents, editorEvents, saveEvent } from '../lib/events.mjs';
import { submit } from '../lib/submissions.mjs';
import {
  changeRsvpSurvey,
  rsvpSurveyCatalog,
  manageResponse,
} from '../lib/survey-management.mjs';
import { surveyResults } from '../lib/surveys.mjs';
import { reportRows, responsesCSV } from '../lib/survey-report.mjs';
import { inboxSource, inboxCountsQuery } from '../lib/inbox-surveys.mjs';
import { inboxFilter, reviewMany, reviewKinds } from '../lib/inbox.mjs';
import { adminHandler } from '../api/admin.mjs';
import { surveysHandler } from '../api/surveys.mjs';
let db;
const actor = 'officer@example.edu';
const question = {
  id: 'ba1e1dc7-631b-4e2c-bbe0-3e0b5256cd16',
  label: 'Original question',
  type: 'single',
  required: true,
  allowOther: false,
  options: ['Blue', 'Green'],
};
const original = publicContent('rsvp-lifecycle', {
  title: 'Keep this event',
  date: '2099-12-01',
  category: 'Workshop',
  surveyQuestions: [question],
});
const originals = [original];
before(async () => {
  process.env.AUTH_BASE_URL = 'https://dallasai-leaderboard.vercel.app';
  db = await testDatabase();
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    'TRUNCATE club_forms.events,club_forms.entries,club_forms.contacts,club_forms.custom_surveys CASCADE',
  );
});
const body = (email = 'member@example.edu', event = original) => ({
  kind: 'rsvp',
  requestId: randomUUID(),
  consent: true,
  email,
  name: 'Member',
  eventId: event.id,
  surveyVersion: event.surveyVersion,
  answers: [{ questionId: question.id, value: 'Blue', other: '' }],
});
const action = (
  operation,
  revision,
  eventId = original.id,
  requestId = randomUUID(),
) => ({
  action: 'rsvp-survey-' + operation,
  eventId,
  expectedRevision: revision,
  requestId,
});
const lifecycle = (operation, revision, eventId = original.id) =>
  changeRsvpSurvey(db, action(operation, revision, eventId), actor, originals);
const raw = async () => ({
  entries: (await db.query('SELECT * FROM club_forms.entries ORDER BY id'))
    .rows,
  responses: (
    await db.query(
      'SELECT * FROM club_forms.survey_responses ORDER BY entry_id',
    )
  ).rows,
  state: (
    await db.query(
      'SELECT * FROM club_forms.survey_response_state ORDER BY entry_id',
    )
  ).rows,
});
function http(handler, request) {
  const headers = {
    origin: 'https://dallasai-leaderboard.vercel.app',
    host: 'dallasai-leaderboard.vercel.app',
    'content-type': 'application/json',
  };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      end(value) {
        resolve({ status: this.statusCode, body: JSON.parse(value) });
      },
    };
    handler({ headers, ...request }, res).catch(reject);
  });
}

test('RSVP parent archive/restore preserves snapshots and individual states across results, Inbox, counts and CSV', async () => {
  const a = await submit(db, body(), originals),
    b = await submit(db, body('second@example.edu'), originals);
  await db.query(
    "UPDATE club_forms.entries SET state='cancelled',review_status='closed' WHERE id=$1",
    [a.id],
  );
  await manageResponse(
    db,
    { entryId: a.id, action: 'archive', value: true },
    actor,
  );
  await manageResponse(
    db,
    { entryId: b.id, action: 'star', value: true },
    actor,
  );
  const before = await raw();
  const catalog = await rsvpSurveyCatalog(db, originals);
  assert.equal(catalog[0].registrationOpen, true);
  assert.equal(catalog[0].responseCount, 1);
  assert.equal(catalog[0].archivedResponseCount, 1);
  const archive = action('archive', 0);
  assert.equal(
    (await changeRsvpSurvey(db, archive, actor, originals)).status,
    'archived',
  );
  assert.deepEqual(await raw(), before);
  assert.equal((await surveyResults(db, { eventId: original.id })).total, 0);
  const archived = await surveyResults(db, {
    eventId: original.id,
    view: 'archived',
  });
  assert.equal(archived.total, 2);
  assert.ok(
    archived.responses.every(
      (row) => row.rsvp_survey_archived && row.archived_at,
    ),
  );
  const events = await liveEvents(db, originals);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, original.title);
  assert.equal(events[0].registrationOpen, false);
  assert.equal(
    (await editorEvents(db, originals))[0].draft.registrationOpen,
    false,
  );
  for (const status of ['current', 'recent', 'active', 'closed']) {
    const { where, values } = inboxFilter(
      new URLSearchParams({ status }),
      events,
    );
    const rows = (
      await db.query(
        `${inboxSource} SELECT e.* FROM inbox_rows e ${where}`,
        values,
      )
    ).rows;
    assert.equal(rows.length, status === 'closed' ? 2 : 0);
    if (status === 'closed')
      assert.ok(
        rows.every(
          (row) =>
            row.data.rsvpSurveyArchived && row.review_status === 'closed',
        ),
      );
  }
  const count = (await db.query(inboxCountsQuery, [[original.id], []])).rows[0];
  assert.equal(count.new, 0);
  assert.equal(count.current, 0);
  assert.equal(count.closed, 2);
  const csv = responsesCSV(
    await reportRows(db, { eventId: original.id, view: 'archived' }),
  );
  assert.match(csv, /Original question/);
  assert.match(csv, /Blue/);
  assert.equal((await reportRows(db, { eventId: original.id })).length, 0);
  assert.equal(
    (await changeRsvpSurvey(db, archive, actor, originals)).revision,
    1,
  );
  await assert.rejects(lifecycle('restore', 0), { status: 409 });
  await assert.rejects(
    manageResponse(
      db,
      { entryId: a.id, action: 'archive', value: false },
      actor,
    ),
    { status: 409 },
  );
  await assert.rejects(
    saveEvent(
      db,
      {
        id: original.id,
        action: 'publish',
        revision: 1,
        event: { ...original, date: '2099-12-01', registrationOpen: true },
      },
      actor,
      originals,
    ),
    { status: 409 },
  );
  await lifecycle('restore', 1);
  assert.deepEqual(await raw(), before);
  assert.equal((await surveyResults(db, { eventId: original.id })).total, 1);
  assert.equal(
    (await surveyResults(db, { eventId: original.id, view: 'archived' })).total,
    1,
  );
  assert.equal((await liveEvents(db, originals))[0].registrationOpen, false);
  await assert.rejects(submit(db, body('third@example.edu'), originals), {
    status: 400,
  });
  const restored = (await editorEvents(db, originals))[0];
  await saveEvent(
    db,
    {
      id: original.id,
      action: 'publish',
      revision: restored.revision,
      event: { ...restored.draft, registrationOpen: true },
    },
    actor,
    originals,
  );
  await submit(db, body('third@example.edu'), await liveEvents(db, originals));
  assert.equal((await surveyResults(db, { eventId: original.id })).total, 2);
});

test('RSVP deletion rolls back failed receipts, scopes cascades, retains contacts/feedback/event and never resurrects', async () => {
  const a = await submit(db, body(), originals);
  const other = { ...original, id: 'unrelated-event', title: 'Other event' };
  const otherEntry = await submit(db, body('other@example.edu', other), [
    other,
  ]);
  await db.query(
    "UPDATE club_forms.entries SET data=jsonb_set(data,'{eventId}',to_jsonb($2::text)) WHERE id=$1",
    [otherEntry.id, original.id],
  );
  const otherBefore = (
    await db.query(
      'SELECT * FROM club_forms.survey_responses WHERE entry_id=$1',
      [otherEntry.id],
    )
  ).rows;
  await db.query(
    "INSERT INTO club_forms.contact_notes(id,email,author_email,body) VALUES($1,$2,$3,'Keep independent note')",
    [randomUUID(), a.email, actor],
  );
  await db.query(
    "INSERT INTO club_forms.event_attendance(event_id,email,attendance,updated_by) VALUES($1,$2,'attended',$3)",
    [original.id, a.email, actor],
  );
  const feedbackId = randomUUID();
  await db.query(
    `INSERT INTO club_forms.custom_surveys(id,slug,link_digest,title,status,expires_at,content_version,definition) VALUES($1,'keep-feedback','feedback-digest','Keep feedback','open',now()+interval '1 day','custom-form/1',$2)`,
    [feedbackId, JSON.stringify({ eventId: original.id, questions: [] })],
  );
  await db.query(
    "INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email) VALUES($1,'kept','Keep feedback respondent',$2)",
    [feedbackId, a.email],
  );
  await db.query(
    'INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,\'kept\',1,\'[{"id":"kept","text":"Keep independent answer"}]\')',
    [feedbackId],
  );
  const feedbackBefore = (
    await db.query(
      'SELECT * FROM club_forms.custom_survey_responses WHERE survey_id=$1',
      [feedbackId],
    )
  ).rows;
  await db.query(
    "INSERT INTO club_forms.entry_comments(id,entry_id,author_email,body) VALUES($1,$2,$3,'Delete scoped comment')",
    [randomUUID(), a.id, actor],
  );
  await manageResponse(
    db,
    { entryId: a.id, action: 'star', value: true },
    actor,
  );
  await db.query(
    "UPDATE club_forms.entries SET data=data-'eventId' WHERE id=$1",
    [a.id],
  );
  await db.query(
    "INSERT INTO club_forms.outbox(entry_id,kind,dedupe_key) VALUES($1,'notify',$2)",
    [a.id, 'scoped-test:' + a.id],
  );
  await assert.rejects(lifecycle('delete', 0), { status: 409 });
  await lifecycle('archive', 0);
  assert.equal(
    (
      await reportRows(db, {
        eventId: original.id,
        type: 'feedback',
        view: 'active',
      })
    ).length,
    1,
  );
  const snapshot = await raw();
  const failing = {
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: (sql, values) => {
            if (sql.startsWith('INSERT INTO club_forms.event_history'))
              throw new Error('receipt unavailable');
            return tx.query(sql, values);
          },
        }),
      ),
  };
  await assert.rejects(
    changeRsvpSurvey(failing, action('delete', 1), actor, originals),
    /receipt unavailable/,
  );
  assert.deepEqual(await raw(), snapshot);
  assert.equal((await rsvpSurveyCatalog(db, originals))[0].status, 'archived');
  const deletion = action('delete', 1);
  const result = await changeRsvpSurvey(db, deletion, actor, originals);
  assert.equal(result.deleted, true);
  assert.equal(result.revision, 2);
  assert.equal(
    (await db.query('SELECT * FROM club_forms.entries WHERE id=$1', [a.id]))
      .rows.length,
    0,
  );
  for (const table of [
    'survey_responses',
    'survey_response_state',
    'entry_comments',
    'outbox',
  ])
    assert.equal(
      (
        await db.query(`SELECT * FROM club_forms.${table} WHERE entry_id=$1`, [
          a.id,
        ])
      ).rows.length,
      0,
    );
  assert.equal(
    (await db.query('SELECT * FROM club_forms.entries')).rows.length,
    1,
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT * FROM club_forms.survey_responses WHERE entry_id=$1',
        [otherEntry.id],
      )
    ).rows,
    otherBefore,
  );
  assert.equal(
    (await db.query('SELECT * FROM club_forms.contact_notes')).rows.length,
    1,
  );
  assert.equal(
    (await db.query('SELECT * FROM club_forms.event_attendance')).rows.length,
    1,
  );
  assert.equal(
    (
      await db.query('SELECT * FROM club_forms.custom_surveys WHERE id=$1', [
        feedbackId,
      ])
    ).rows.length,
    1,
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT * FROM club_forms.custom_survey_responses WHERE survey_id=$1',
        [feedbackId],
      )
    ).rows,
    feedbackBefore,
  );
  assert.equal(
    (
      await reportRows(db, {
        eventId: original.id,
        type: 'feedback',
        view: 'active',
      })
    ).length,
    1,
  );
  await db.query(
    "UPDATE club_forms.custom_surveys SET status='archived' WHERE id=$1",
    [feedbackId],
  );
  assert.equal(
    (
      await reportRows(db, {
        eventId: original.id,
        type: 'feedback',
        view: 'active',
      })
    ).length,
    0,
  );
  assert.equal(
    (
      await reportRows(db, {
        eventId: original.id,
        type: 'feedback',
        view: 'archived',
      })
    ).length,
    1,
  );
  assert.equal(
    (
      await db.query('SELECT * FROM club_forms.contacts WHERE email=$1', [
        a.email,
      ])
    ).rows.length,
    1,
  );
  assert.equal((await liveEvents(db, originals))[0].title, original.title);
  assert.equal((await liveEvents(db, originals))[0].registrationOpen, false);
  assert.equal(
    (await rsvpSurveyCatalog(db, originals)).some(
      (s) => s.eventId === original.id,
    ),
    false,
  );
  assert.deepEqual(
    await changeRsvpSurvey(db, deletion, actor, originals),
    result,
  );
  await assert.rejects(
    changeRsvpSurvey(
      db,
      { ...deletion, action: 'rsvp-survey-restore' },
      actor,
      originals,
    ),
    { status: 409 },
  );
  await assert.rejects(lifecycle('restore', 2), { status: 409 });
  await assert.rejects(
    saveEvent(
      db,
      {
        id: original.id,
        action: 'publish',
        revision: 2,
        event: { ...original, registrationOpen: true },
      },
      actor,
      originals,
    ),
    { status: 409 },
  );
  const row = (await editorEvents(db, originals))[0];
  await saveEvent(
    db,
    {
      id: row.id,
      action: 'publish',
      revision: row.revision,
      event: {
        ...row.draft,
        title: 'Event edited',
        registrationOpen: false,
        surveyIntro: 'Stale deleted intro',
        surveyQuestions: [question],
      },
    },
    actor,
    originals,
  );
  assert.equal((await liveEvents(db, originals))[0].title, 'Event edited');
  assert.deepEqual((await liveEvents(db, originals))[0].surveyQuestions, []);
  assert.equal((await editorEvents(db, originals))[0].draft.surveyIntro, '');
  assert.equal(
    (await rsvpSurveyCatalog(db, originals)).some(
      (s) => s.eventId === original.id,
    ),
    false,
  );
  const receipts = (
    await db.query(
      "SELECT content FROM club_forms.event_history WHERE action LIKE 'rsvp-survey-%'",
    )
  ).rows;
  assert.ok(
    receipts.every(
      (row) =>
        Object.keys(row.content).sort().join(',') === 'digest,requestId,status',
    ),
  );
  assert.ok(!JSON.stringify(receipts).includes(a.email));
});

test('orphan response surveys archive and delete without public recreation; request IDs are globally unique', async () => {
  const a = await submit(db, body(), originals);
  await changeRsvpSurvey(db, action('archive', 0), actor, []);
  assert.deepEqual(await liveEvents(db, []), []);
  assert.equal(
    (await db.query('SELECT published FROM club_forms.events')).rows[0]
      .published,
    null,
  );
  const [row] = await rsvpSurveyCatalog(db, []);
  assert.equal(row.hasEvent, false);
  assert.equal(row.status, 'archived');
  const deletion = action('delete', 1);
  await changeRsvpSurvey(db, deletion, actor, []);
  assert.equal(
    (await db.query('SELECT * FROM club_forms.entries WHERE id=$1', [a.id]))
      .rows.length,
    0,
  );
  assert.deepEqual(await liveEvents(db, []), []);
  const other = { ...original, id: 'other' };
  await submit(db, body('other@example.edu', other), [other]);
  await assert.rejects(
    changeRsvpSurvey(
      db,
      action('archive', 0, other.id, deletion.requestId),
      actor,
      [other],
    ),
    { status: 409 },
  );
  assert.equal(
    (await db.query('SELECT * FROM club_forms.events WHERE id=$1', [other.id]))
      .rows.length,
    0,
  );
  await saveEvent(
    db,
    { id: other.id, action: 'publish', revision: 0, event: other },
    actor,
    [other],
  );
  await assert.rejects(
    db.query(
      "INSERT INTO club_forms.event_history(event_id,revision,action,actor,content) VALUES($1,2,'rsvp-survey-archive',$2,$3)",
      [
        other.id,
        actor,
        JSON.stringify({
          requestId: deletion.requestId,
          digest: 'race',
          status: 'archived',
        }),
      ],
    ),
    { code: '23505' },
  );
});

test('archive between public validation and transaction blocks stale submit; APIs and bulk review preserve parent archive', async () => {
  const entry = await submit(db, body(), originals);
  let injected = false;
  const raced = {
    query: (...args) => db.query(...args),
    transaction: async (fn) => {
      if (!injected) {
        injected = true;
        await lifecycle('archive', 0);
      }
      return db.transaction(fn);
    },
  };
  await assert.rejects(submit(raced, body('racer@example.edu'), originals), {
    status: 409,
  });
  assert.equal(
    (await db.query('SELECT * FROM club_forms.entries')).rows.length,
    1,
  );
  const handler = adminHandler({
    authorize: async () => ({ email: actor }),
    getDatabase: () => db,
    getEvents: () => liveEvents(db, originals),
  });
  for (const snapshotOnly of [false, true]) {
    if (snapshotOnly)
      await db.query(
        "UPDATE club_forms.entries SET data=data-'eventId' WHERE id=$1",
        [entry.id],
      );
    for (const status of ['new', 'closed']) {
      const reply = await http(handler, {
        method: 'POST',
        body: {
          action: 'review',
          id: entry.id,
          status,
          comment: { id: randomUUID(), body: 'Must not be saved' },
        },
      });
      assert.equal(reply.status, 409);
    }
    const detail = await http(handler, {
      method: 'GET',
      url: '/api/admin?edit=' + entry.id,
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.entry.data.rsvpSurveyArchived, true);
  }
  assert.equal(
    (
      await db.query(
        'SELECT review_status FROM club_forms.entries WHERE id=$1',
        [entry.id],
      )
    ).rows[0].review_status,
    'new',
  );
  assert.equal(
    (await db.query('SELECT * FROM club_forms.entry_comments')).rows.length,
    0,
  );
  const many = await reviewMany(
    db,
    { items: [{ id: entry.id, from: 'new' }], status: 'reviewed' },
    actor,
  );
  assert.deepEqual(many.saved, []);
  assert.equal(many.skipped.length, 1);
  const sweep = await reviewKinds(
    db,
    {
      kinds: ['rsvp'],
      from: 'new',
      status: 'reviewed',
      before: new Date().toISOString(),
    },
    actor,
  );
  assert.deepEqual(sweep, { saved: [], more: false });
  assert.equal(
    (
      await db.query(
        'SELECT review_status FROM club_forms.entries WHERE id=$1',
        [entry.id],
      )
    ).rows[0].review_status,
    'new',
  );
  const surveys = surveysHandler({
    authorize: async () => ({ email: actor }),
    getDatabase: () => db,
    getOriginalEvents: async () => originals,
  });
  const catalog = await http(surveys, {
    method: 'GET',
    url: '/api/surveys?catalog=1',
  });
  assert.equal(catalog.status, 200);
  assert.ok(
    catalog.body.surveys.some(
      (row) => row.eventId === original.id && row.status === 'archived',
    ),
  );
  const invalid = await http(surveys, {
    method: 'POST',
    body: { ...action('restore', 1), unexpected: true },
  });
  assert.equal(invalid.status, 400);
});

test('migration reruns preserve receipts and existing restricted runtime privileges support RSVP lifecycle', async () => {
  const entry = await submit(db, body(), originals);
  await db.exec('CREATE ROLE club_forms_api');
  for (const name of [
    '006_event_editor.sql',
    '010_event_surveys.sql',
    '014_event_response_management.sql',
    '015_contact_identity_management.sql',
    '025_rsvp_survey_lifecycle.sql',
    '025_rsvp_survey_lifecycle.sql',
  ])
    await db.exec(
      await readFile(new URL('../' + name, import.meta.url), 'utf8'),
    );
  await db.exec('GRANT USAGE ON SCHEMA club_forms TO club_forms_api');
  await db.exec('GRANT SELECT ON club_forms.entries TO club_forms_api');
  await db.exec('SET ROLE club_forms_api');
  try {
    await lifecycle('archive', 0);
    await lifecycle('delete', 1);
  } finally {
    await db.exec('RESET ROLE');
  }
  assert.equal(
    (await db.query('SELECT * FROM club_forms.entries WHERE id=$1', [entry.id]))
      .rows.length,
    0,
  );
  const receipt = (
    await db.query(
      "SELECT content FROM club_forms.event_history WHERE action='rsvp-survey-delete'",
    )
  ).rows[0].content;
  await db.exec(
    await readFile(
      new URL('../025_rsvp_survey_lifecycle.sql', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT content FROM club_forms.event_history WHERE action='rsvp-survey-delete'",
      )
    ).rows[0].content,
    receipt,
  );
  const grants = (
    await db.query(
      "SELECT has_table_privilege('club_forms_api','club_forms.event_history','DELETE') AS delete_history,has_table_privilege('club_forms_api','club_forms.event_attendance','DELETE') AS delete_attendance",
    )
  ).rows[0];
  assert.deepEqual(grants, { delete_history: false, delete_attendance: false });
});
