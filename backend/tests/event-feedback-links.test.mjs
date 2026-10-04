import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.mjs';
import { digest, privateSurveyToken } from '../lib/custom-surveys.mjs';
import { eventFeedbackLinks } from '../lib/survey-catalog.mjs';

let db;
before(async () => {
  process.env.FORM_TOKEN_SECRET = 'event-feedback-tests-' + 'x'.repeat(40);
  process.env.AUTH_BASE_URL = 'https://forms.example.com';
  db = await testDatabase();
});
after(async () => db?.close());
beforeEach(async () => db.exec('DELETE FROM club_forms.custom_surveys'));

async function survey(overrides = {}) {
  const id = overrides.id || randomUUID();
  const row = {
    id,
    status: 'open',
    expires_at: '2099-01-01T00:00:00Z',
    published_at: '2026-01-01T00:00:00Z',
    link_digest: digest(privateSurveyToken(id)),
    short_link: null,
    definition: {
      eventId: 'game-night',
      template: 'feedback',
      audience: 'public',
      permissions: { answer: 'verified' },
    },
    ...overrides,
  };
  await db.query(
    `INSERT INTO club_forms.custom_surveys
      (id,slug,title,content_version,status,expires_at,published_at,link_digest,short_link,definition)
    VALUES($1,$2,'Feedback','custom-form/1',$3,$4,$5,$6,$7,$8)`,
    [
      row.id,
      row.id,
      row.status,
      row.expires_at,
      row.published_at,
      row.link_digest,
      row.short_link,
      JSON.stringify(row.definition),
    ],
  );
  return new URL(
    '/surveys/#invite=' + privateSurveyToken(id),
    process.env.AUTH_BASE_URL,
  ).href;
}

test('feedback links use the saved short link or the valid answer link', async () => {
  const answer = await survey();
  assert.deepEqual(
    await eventFeedbackLinks(db, ['game-night']),
    new Map([['game-night', answer]]),
  );
  await db.query(
    "UPDATE club_forms.custom_surveys SET short_link='https://short.example/feedback'",
  );
  assert.deepEqual(
    await eventFeedbackLinks(db, ['game-night']),
    new Map([['game-night', 'https://short.example/feedback']]),
  );
});

for (const [name, overrides] of [
  ['closed', { status: 'closed' }],
  ['draft', { status: 'draft' }],
  ['expired', { expires_at: '2020-01-01T00:00:00Z' }],
  [
    'unlinked',
    {
      definition: {
        template: 'feedback',
        audience: 'public',
        permissions: { answer: 'verified' },
      },
    },
  ],
  [
    'another event',
    {
      definition: {
        eventId: 'other-event',
        template: 'feedback',
        audience: 'public',
        permissions: { answer: 'verified' },
      },
    },
  ],
  [
    'another template',
    {
      definition: {
        eventId: 'game-night',
        template: 'blank',
        audience: 'public',
        permissions: { answer: 'verified' },
      },
    },
  ],
  [
    'restricted audience',
    {
      definition: {
        eventId: 'game-night',
        template: 'feedback',
        audience: 'officers',
        permissions: { answer: 'verified' },
      },
    },
  ],
  [
    'invited answers',
    {
      definition: {
        eventId: 'game-night',
        template: 'feedback',
        audience: 'public',
        permissions: { answer: 'invited' },
      },
    },
  ],
  [
    'invalid token with saved short link',
    { link_digest: 'bad-token', short_link: 'https://short.example/private' },
  ],
])
  test(`excludes ${name} surveys`, async () => {
    await survey(overrides);
    assert.equal((await eventFeedbackLinks(db, ['game-night'])).size, 0);
  });

test('latest publication wins, with a stable id tie break and invalid tokens skipped', async () => {
  await survey({ published_at: '2025-01-01T00:00:00Z' });
  await survey({ id: '00000000-0000-4000-8000-000000000001' });
  const latest = await survey({ id: '00000000-0000-4000-8000-000000000002' });
  await survey({
    published_at: '2027-01-01T00:00:00Z',
    link_digest: 'bad-token',
  });
  assert.deepEqual(
    await eventFeedbackLinks(db, ['game-night']),
    new Map([['game-night', latest]]),
  );
});

test('empty event list does not query the database', async () => {
  assert.equal(
    (
      await eventFeedbackLinks(
        { query: () => assert.fail('unexpected query') },
        [],
      )
    ).size,
    0,
  );
});
