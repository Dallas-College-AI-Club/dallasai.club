import assert from 'node:assert/strict';
import {
  EVENTS,
  eventDate,
  eventTime,
  eventCalendar,
  eventIsPast,
} from '../public/content/club.js';
import { SEARCH_ENTRIES, searchClub } from '../public/app/search-index.js';
import { readEventPlans, saveEventPlan } from '../public/storage/event-plans.js';
assert.ok(EVENTS.length >= 22);
assert.equal(new Set(EVENTS.map((e) => e.id)).size, EVENTS.length);
const untimed = EVENTS.find((e) => e.id === 'github-june');
assert.equal(eventDate(untimed), 'Jun 10');
assert.equal(eventTime(untimed), 'Wednesday');
assert.ok(eventCalendar(untimed).includes('DTSTART;VALUE=DATE:20260610'));
assert.ok(!eventCalendar(untimed).includes('T000000Z'));
assert.equal(eventIsPast(untimed, new Date('2026-06-11T04:59:00Z')), false);
assert.equal(eventIsPast(untimed, new Date('2026-06-11T05:01:00Z')), true);
const kickoff = EVENTS.find((e) => e.id === 'kickoff-may');
assert.equal(eventTime(kickoff), 'Tuesday 2:00 PM–5:00 PM CT');
assert.ok(eventCalendar(kickoff).includes('DTEND:20260526T220000Z'));
assert.ok(
  eventCalendar(EVENTS.find((e) => e.id === 'sprint-2-checkin')).includes(
    'DTSTART:20260624T210000Z',
  ),
);
assert.equal(searchClub('résumé')[0].id, 'project-career');
assert.equal(
  searchClub('What our dataset leaves out')[0].href,
  'club.html?mode=article&article=what-the-data-leaves-out',
);
assert.ok(searchClub('June 24').some((e) => e.id === 'event-sprint-2-checkin'));
assert.equal(searchClub('First semester')[0].id, 'project-major');
assert.equal(searchClub('Second Nature')[0].href, 'club.html?mode=projects#project-nature');
assert.equal(searchClub('AI Trading')[0].href, 'club.html?mode=projects#project-ai-trading');
assert.equal(
  searchClub('Analyzing World Events')[0].href,
  'club.html?mode=projects#project-world-events-stocks',
);
for (const program of [
  'Nursing',
  'Hospitality Management',
  'Paralegal',
  'CADD',
  'Early Childhood',
  'Foreign Language',
])
  assert.ok(searchClub(program).some((entry) => entry.id === 'lab-fields'));
assert.ok(searchClub('articles').some((e) => e.id === 'article-confidence-and-correctness'));
assert.ok(searchClub('projects').some((e) => e.id === 'project-signal'));
assert.equal(searchClub('definitelynotathing987').length, 0);
for (const event of EVENTS) assert.ok(SEARCH_ENTRIES.some((e) => e.href === event.url));
const memory = new Map(),
  storage = {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
  };
assert.deepEqual(readEventPlans(storage), []);
assert.equal(saveEventPlan('git', true, storage), true);
assert.equal(saveEventPlan('git', true, storage), true);
assert.deepEqual(readEventPlans(storage), ['git']);
assert.equal(saveEventPlan('productivity', true, storage), true);
assert.equal(saveEventPlan('git', false, storage), true);
assert.deepEqual(readEventPlans(storage), ['productivity']);
assert.equal(
  saveEventPlan('git', true, {
    getItem: () => null,
    setItem: () => {
      throw Error('blocked');
    },
  }),
  false,
);
assert.deepEqual(readEventPlans({ getItem: () => '{broken json' }), []);
console.log(
  'PASS: 22 dated events, unknown times and Central date rollover, documented end times, content search routes/categories/accents, and personal event-plan persistence/removal/failure handling.',
);
