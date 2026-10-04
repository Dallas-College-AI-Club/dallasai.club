import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  actionLabel,
  actorLabel,
  clock,
  dateTime,
  day,
  fieldLabel,
  fullDateTime,
  isoDay,
  kindLabel,
  newSummary,
  plural,
  statusLabel,
} from '../admin/format.js';
// Noon Central on Saturday, Oct 3, 2026.
const now = new Date('2026-10-03T17:00:00Z');
test('dateTime() is one Central format across daylight saving changes', () => {
  assert.equal(
    dateTime('2026-10-03T04:34:00Z', now),
    'Fri, Oct 2, 11:34 PM CT',
  );
  // Spring forward: 1:59 AM CST, then 3:00 AM CDT.
  assert.equal(dateTime('2026-03-08T07:59:00Z', now), 'Sun, Mar 8, 1:59 AM CT');
  assert.equal(dateTime('2026-03-08T08:00:00Z', now), 'Sun, Mar 8, 3:00 AM CT');
  // Fall back: 1:30 AM happens twice.
  assert.equal(dateTime('2026-11-01T06:30:00Z', now), 'Sun, Nov 1, 1:30 AM CT');
  assert.equal(dateTime('2026-11-01T07:30:00Z', now), 'Sun, Nov 1, 1:30 AM CT');
  assert.equal(
    dateTime('2025-12-31T18:00:00Z', now),
    'Wed, Dec 31, 2025, 12:00 PM CT',
  );
  assert.equal(clock('2026-07-02T20:05:00Z'), '3:05 PM');
  for (const text of [dateTime('2026-07-02T20:05:00Z', now), clock(now)])
    assert.doesNotMatch(text, /[\u202f\u2009]|:\d\d:\d\d|C[DS]T|\d{4}-\d{2}/);
  assert.equal(dateTime(null), '');
  // Downloads always carry the year, and file names the Central day.
  assert.equal(
    fullDateTime('2026-10-03T04:34:00Z'),
    'Fri, Oct 2, 2026, 11:34 PM CT',
  );
  assert.equal(isoDay('2026-10-03T04:34:00Z'), '2026-10-02');
  assert.equal(isoDay('2026-10-03T05:00:00Z'), '2026-10-03');
  assert.equal(fullDateTime(null) + isoDay(undefined), '');
});
test('day() shows calendar dates without shifting them', () => {
  assert.equal(day('2026-10-23', now), 'Fri, Oct 23');
  assert.equal(day('2027-01-05', now), 'Tue, Jan 5, 2027');
  assert.equal(day('', now), 'Date TBD');
  assert.equal(day(undefined, now), 'Date TBD');
});
test('plural() counts with Intl plural rules', () => {
  assert.equal(plural(0, 'submission'), '0 submissions');
  assert.equal(plural(1, 'submission'), '1 submission');
  assert.equal(plural(2, 'submission'), '2 submissions');
  assert.equal(plural(1234, 'submission'), '1,234 submissions');
  assert.equal(plural(1, 'reply', 'replies'), '1 reply');
  assert.equal(plural(3, 'reply', 'replies'), '3 replies');
});
test('kinds, statuses and stored fields read as words', () => {
  assert.equal(kindLabel('join'), 'Signup');
  assert.equal(kindLabel('join', 'plural'), 'Signups');
  assert.equal(kindLabel('contribution', 'plural'), 'Articles');
  assert.equal(kindLabel('unknown'), 'Submission');
  assert.equal(statusLabel('closed'), 'Archived');
  assert.equal(statusLabel('new'), 'New');
  assert.equal(fieldLabel('eventDate'), 'Event date');
  assert.equal(fieldLabel('body'), 'Draft');
  assert.equal(fieldLabel('preferredMeetingTime'), 'Preferred meeting time');
});
test('actors: you, other officers, the website and automatic updates', () => {
  const me = 'Ava.Lee@example.edu';
  assert.equal(actorLabel('ava.lee@example.edu', me), 'You');
  assert.equal(actorLabel('sam@example.edu', me), 'sam@example.edu');
  assert.equal(actorLabel('website', me), 'The website');
  assert.equal(
    actorLabel('codex:requested-any-of-these-date-choice', me),
    'Automatic update',
  );
});
// Every action code the server can write has a label: the CHECK lists in the
// migrations, the literal codes in audit inserts, and the codes built at run
// time.
test('every server action code has a label', async () => {
  const backend = new URL('../', import.meta.url),
    codes = new Set([
      'review:new',
      'review:reviewed',
      'review:closed',
      'comment-added',
      'resubmitted',
      'download-attachment',
      'survey-starred',
      'survey-unstarred',
      'survey-archived',
      'survey-restored',
      'survey-summary:all',
      'survey-export-csv:office-event',
      // Built as '<code>:<survey id>' and '<code>:<survey id>:<respondent>'.
      'custom-survey-export-csv:2c1f0b4e-0000-4000-8000-000000000000',
      'custom-survey-pdf:2c1f0b4e-0000-4000-8000-000000000000:avery',
      'contact-purged:entries=1:notes=0:files=0',
      // Built as 'state:' + body.state.
      'state:cancelled',
      'state:unsubscribed',
      'state:active',
    ]);
  for (const name of await readdir(backend))
    if (name.endsWith('.sql'))
      for (const [, list] of (
        await readFile(new URL(name, backend), 'utf8')
      ).matchAll(/CHECK\s*\(\s*action IN \(([^)]*)\)/g))
        for (const [, code] of list.matchAll(/'([^']+)'/g)) codes.add(code);
  for (const folder of ['lib/', 'api/'])
    for (const name of await readdir(new URL(folder, backend)))
      for (const [, code] of (
        await readFile(new URL(folder + name, backend), 'utf8')
      ).matchAll(/club_forms\.audit\([^)]*\) VALUES\([^)]*'([^']+)'\)/g))
        codes.add(code);
  assert.ok(codes.has('submission-permanently-deleted'));
  assert.ok(codes.has('Unused address removed'));
  const missing = [...codes].filter((code) => actionLabel(code) === 'Updated');
  assert.deepEqual(missing, []);
  assert.equal(actionLabel('review:closed'), 'Archived');
  assert.equal(actionLabel('something-new'), 'Updated');
});

test('newSummary() lowercases kinds mid-sentence but keeps The AI Review', () => {
  assert.equal(
    newSummary(
      [
        [2, 'rsvp'],
        [1, 'question'],
        [0, 'join'],
      ],
      'nothing new',
    ),
    '3 new: 2 RSVPs, 1 question',
  );
  assert.equal(
    newSummary(
      [
        [1, 'subscribe'],
        [2, 'subscribe'],
        [2, 'workshop'],
      ],
      '',
    ),
    '5 new: 1 The AI Review subscription, 2 The AI Review, 2 workshops',
  );
  assert.equal(newSummary([[0, 'join']], 'nothing new'), 'nothing new');
});
