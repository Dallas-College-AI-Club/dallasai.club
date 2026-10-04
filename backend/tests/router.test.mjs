import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiStatus,
  build,
  legacy,
  parse,
  routeStatus,
} from '../admin/router.js';
const id = '0b6c9a8e-5d1f-4c2a-9e3b-7f4d2a1c8e90';
test('parse() reads routes, ids and allowed query values', () => {
  assert.deepEqual(parse('#/inbox'), {
    name: 'inbox',
    section: 'inbox',
    params: {},
    query: {},
  });
  assert.deepEqual(
    parse('#/inbox?status=archived&type=question&event=fall-kickoff').query,
    { status: 'archived', type: 'question', event: 'fall-kickoff' },
  );
  // Unknown keys and values, free text and emails never reach a request.
  assert.deepEqual(
    parse('#/inbox?status=bogus&type=join&q=ava@example.edu&event=Bad_Id')
      .query,
    { type: 'join' },
  );
  assert.deepEqual(parse('#/inbox/' + id.toUpperCase()).params, { id });
  assert.equal(parse('#/events').name, 'events');
  assert.equal(parse('#/surveys').name, 'surveys');
  assert.equal(parse('#/surveys/events').name, 'surveys/events');
  assert.deepEqual(parse('#/surveys/events/fall-kickoff/r/' + id).params, {
    eventId: 'fall-kickoff',
    entryId: id,
  });
  assert.equal(parse('#/surveys/custom').name, 'surveys/custom');
  assert.deepEqual(parse('#/surveys/custom/' + id).params, { id });
  assert.deepEqual(parse('#/help?topic=exports').query, { topic: 'exports' });
});
test('Home is the landing page; Contacts and all-event RSVPs have routes', () => {
  for (const hash of ['', '#', '#/', '#/home'])
    assert.equal(parse(legacy(hash) || hash).name, 'home', hash);
  assert.equal(parse('#/contacts').name, 'contacts');
  assert.equal(parse('#/contacts/ava@example.edu').name, 'not-found');
  // Show all for one event: every RSVP for it, upcoming or past.
  assert.deepEqual(parse('#/inbox?type=rsvp-all&event=game-night').query, {
    type: 'rsvp-all',
    event: 'game-night',
  });
  assert.equal(
    build('inbox', { type: 'rsvp-all', event: 'game-night' }),
    '#/inbox?type=rsvp-all&event=game-night',
  );
  // Emails never reach the address, even on the Contacts tab.
  assert.deepEqual(parse('#/contacts?email=ava@example.edu').query, {});
});
test('bad ids and unknown pages are not found, before any request', () => {
  for (const [hash, from] of [
    ['#/inbox/abc', 'inbox'],
    ['#/inbox/' + id + 'x', 'inbox'],
    ['#/surveys/custom/abc', 'surveys'],
    ['#/surveys/events/Bad_Slug/r/' + id, 'surveys'],
    ['#/surveys/events/fall/r/abc', 'surveys'],
    ['#/people', 'people'],
    ['#/inbox/' + id + '/extra', 'inbox'],
    ['#main', 'main'],
  ]) {
    const route = parse(hash);
    assert.equal(route.name, 'not-found', hash);
    assert.equal(route.from, from, hash);
    assert.ok(route.message, hash);
  }
  assert.equal(
    parse('#/inbox/abc').message,
    'This submission no longer exists or the link is incomplete.',
  );
});
test('build() leaves out defaults', () => {
  assert.equal(build('inbox'), '#/inbox');
  assert.equal(
    build('inbox', { status: '', type: 'join', event: undefined }),
    '#/inbox?type=join',
  );
  assert.equal(
    build('inbox', { status: 'archived', type: 'question' }),
    '#/inbox?status=archived&type=question',
  );
  const route = parse(build('inbox', { status: 'reviewed', type: 'rsvp' }));
  assert.deepEqual(route.query, { status: 'reviewed', type: 'rsvp' });
});
test('old links are rewritten to their routes', () => {
  for (const [old, rewritten] of [
    ['', '#/home'],
    ['#', '#/home'],
    ['#/', '#/home'],
    ['#events', '#/events'],
    ['#surveys', '#/surveys'],
    ['#entry=' + id, '#/inbox/' + id + '?status=all'],
    ['#survey=' + id, '#/inbox/' + id + '?status=all'],
    ['#custom-survey=' + id, '#/surveys/custom/' + id],
    ['#archived-survey-questions', '#/inbox?status=archived&type=question'],
    ['#/inbox', null],
    ['#/surveys/custom', null],
    ['#something-else', null],
  ])
    assert.equal(legacy(old), rewritten, old);
  // A malformed old link becomes a not-found route, never a request.
  assert.equal(parse(legacy('#entry=abc')).name, 'not-found');
});
test('the Archived view is the API status closed', () => {
  assert.equal(apiStatus(undefined), 'new');
  assert.equal(apiStatus('reviewed'), 'reviewed');
  assert.equal(apiStatus('archived'), 'closed');
  assert.equal(apiStatus('all'), '');
  assert.equal(routeStatus('closed'), 'archived');
  assert.equal(routeStatus('new'), '');
  assert.equal(routeStatus(''), 'all');
  for (const status of ['reviewed', 'archived', 'all'])
    assert.equal(routeStatus(apiStatus(status)), status);
});
