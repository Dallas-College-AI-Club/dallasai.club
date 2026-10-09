import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import qrcode from 'qrcode-generator';
import { testDatabase } from './helpers/db.mjs';
import { saveEvent } from '../lib/events.mjs';
import {
  createEventShareLink,
  createEventFeedbackShareLink,
} from '../lib/event-share-link.mjs';
import { createShortLink } from '../lib/survey-share-link.mjs';
import { eventFeedbackURL } from '../lib/event-feedback-definition.mjs';
import { eventHandler } from '../api/events.mjs';

const actor = 'officer@example.com';
const event = {
  title: 'Meeting',
  category: 'Meeting',
  date: '2099-10-15',
  startTime: '16:00',
  endTime: '17:30',
  feedbackEnabled: true,
};
let db;
before(async () => {
  db = await testDatabase();
});
after(async () => db?.close());
beforeEach(async () =>
  db.exec('TRUNCATE club_forms.events, club_forms.audit CASCADE'),
);
const publish = (id = 'meeting') =>
  saveEvent(db, { action: 'publish', id, revision: 0, event }, actor, []);
const link = (id = 'meeting', alias = 'ai-meeting-2026-10-15') =>
  createEventShareLink(
    db,
    id,
    actor,
    async () => 'https://go.dallasai.club/' + alias,
  );

test('feedback uses the exact event alias suffix and retains its separate QR through edits', async () => {
  await publish();
  await link();
  let calls = 0;
  const provider = async (target, alias, domain) => {
    calls++;
    assert.equal(target, eventFeedbackURL('meeting'));
    assert.equal(alias, 'ai-meeting-2026-10-15-feedback');
    assert.equal(domain, 'go.dallasai.club');
    return 'https://' + domain + '/' + alias;
  };
  const saved = await createEventFeedbackShareLink(
    db,
    'meeting',
    actor,
    provider,
  );
  await createEventFeedbackShareLink(db, 'meeting', actor, provider);
  assert.equal(calls, 1);
  const address = saved.published.feedbackShortLink;
  assert.equal(address, saved.published.shortLink + '-feedback');
  await saveEvent(
    db,
    {
      action: 'publish',
      id: 'meeting',
      revision: saved.revision,
      event: {
        ...saved.draft,
        feedbackShortLink: 'https://evil.example/wrong',
      },
    },
    actor,
    [],
  );
  const handler = eventHandler({
    getDatabase: () => db,
    originals: [],
    authorize: () => assert.fail('public QR must not require sign-in'),
  });
  const response = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(value) {
      this.body = value;
    },
  };
  await handler(
    { method: 'GET', url: '/api/events?qr=meeting&feedback=1&download=1' },
    response,
  );
  const expected = qrcode(0, 'M');
  expected.addData(address);
  expected.make();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, expected.createSvgTag(6, 24));
  assert.equal(
    response.headers['Content-Disposition'],
    'attachment; filename="meeting-feedback-qr.svg"',
  );
  const duplicate = await saveEvent(
    db,
    {
      action: 'publish',
      id: 'other-meeting',
      revision: 0,
      event: { ...saved.draft, feedbackShortLink: address },
    },
    actor,
    [],
  );
  assert.equal(duplicate.published.feedbackShortLink, undefined);
});

test('unavailable events, mismatched providers and alias collisions never save a misleading link', async () => {
  await publish();
  await assert.rejects(
    createEventFeedbackShareLink(db, 'meeting', actor, () => assert.fail()),
    { status: 409 },
  );
  await link();
  await assert.rejects(
    createEventFeedbackShareLink(
      db,
      'meeting',
      actor,
      async () => 'https://tinyurl.com/another-name',
    ),
    { status: 502 },
  );
  await assert.rejects(
    createEventFeedbackShareLink(db, 'meeting', actor, async () => {
      throw Object.assign(new Error('occupied'), { status: 409 });
    }),
    { status: 409 },
  );
  assert.equal(
    (
      await db.query(
        "SELECT published->>'feedbackShortLink' link FROM club_forms.events WHERE id='meeting'",
      )
    ).rows[0].link,
    null,
  );
  await saveEvent(
    db,
    {
      action: 'publish',
      id: 'disabled-meeting',
      revision: 0,
      event: { ...event, feedbackEnabled: false },
    },
    actor,
    [],
  );
  await link('disabled-meeting');
  await assert.rejects(
    createEventFeedbackShareLink(db, 'disabled-meeting', actor, () =>
      assert.fail(),
    ),
    { status: 409 },
  );
  await saveEvent(
    db,
    { action: 'archive', id: 'meeting', revision: 1 },
    actor,
    [],
  );
  await assert.rejects(
    createEventFeedbackShareLink(db, 'meeting', actor, () => assert.fail()),
    { status: 409 },
  );
});

test('publication automatically creates a separate feedback link and failures keep the event saved', async () => {
  process.env.AUTH_BASE_URL = 'https://office.example.com';
  let failure = false;
  const handler = eventHandler({
    getDatabase: () => db,
    originals: [],
    authorize: async () => ({ email: actor }),
    createShortLink: async () => 'https://go.dallasai.club/meeting',
    createFeedbackShortLink: async (target, alias, domain) => {
      if (failure) throw Error('temporary outage');
      return 'https://' + domain + '/' + alias;
    },
  });
  const call = async (body) => {
    const response = {
      setHeader() {},
      end(value) {
        this.body = JSON.parse(value);
      },
    };
    await handler(
      {
        method: 'POST',
        url: '/api/events',
        headers: {
          origin: process.env.AUTH_BASE_URL,
          'content-type': 'application/json',
        },
        body,
      },
      response,
    );
    return response;
  };
  const first = await call({
    action: 'publish',
    id: 'meeting',
    revision: 0,
    event,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(
    first.body.event.published.feedbackShortLink,
    'https://go.dallasai.club/meeting-feedback',
  );
  failure = true;
  const second = await call({
    action: 'publish',
    id: 'another-meeting',
    revision: 0,
    event,
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.event.published.feedbackEnabled, true);
  assert.match(second.body.sharingError, /Feedback short link/);
  await createEventShareLink(
    db,
    'meeting',
    actor,
    async () => 'https://go.dallasai.club/renamed-meeting',
    false,
    'renamed-meeting',
  );
  const renamed = await call({ action: 'feedback-share-link', id: 'meeting' });
  assert.equal(renamed.statusCode, 503);
  const row = (
    await db.query(
      "SELECT draft,published FROM club_forms.events WHERE id='meeting'",
    )
  ).rows[0];
  assert.equal(row.draft.feedbackShortLink, undefined);
  assert.equal(row.published.feedbackShortLink, undefined);
});

test('feedback provider supports full event aliases without silently changing domains', async () => {
  const saved = { ...process.env };
  process.env.SHORT_IO_API_KEY = 'fixture-only';
  process.env.SHORT_IO_DOMAIN = 'go.dallasai.club';
  process.env.TINYURL_API_TOKEN = 'fixture-only';
  try {
    const alias = 'a'.repeat(30) + '-feedback';
    const target = eventFeedbackURL('meeting');
    const result = await createShortLink(
      target,
      alias,
      async (url, options) => {
        assert.equal(url, 'https://api.short.io/links');
        assert.equal(JSON.parse(options.body).path, alias);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            originalURL: target,
            path: alias,
            archived: false,
            hasPassword: false,
            shortURL: 'https://go.dallasai.club/' + alias,
            secureShortURL: 'https://go.dallasai.club/' + alias,
          }),
        };
      },
      'go.dallasai.club',
    );
    assert.equal(result, 'https://go.dallasai.club/' + alias);
    let calls = 0;
    await assert.rejects(
      createShortLink(
        target,
        alias,
        async () => {
          calls++;
          throw Error('offline');
        },
        'go.dallasai.club',
      ),
    );
    assert.equal(calls, 1, 'must not fall back to a different provider');
    await assert.rejects(
      createShortLink(target, alias, () => assert.fail(), 'unknown.example'),
      { status: 409 },
    );
  } finally {
    for (const key of [
      'SHORT_IO_API_KEY',
      'SHORT_IO_DOMAIN',
      'TINYURL_API_TOKEN',
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
