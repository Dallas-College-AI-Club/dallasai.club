import assert from 'node:assert/strict';
import { monthCells } from '../public/pages/events.js';
import {
  EVENTS,
  EDITOR_EMAIL,
  eventCalendar,
  eventIsPast,
  splitEvents,
} from '../public/content/club.js';
import { rubricScore, checkInstructions, instructionScenarios } from '../public/lab/evaluation.js';
import { pageId } from '../public/drive/score.js';
import { submissionEmail } from '../public/pages/contribute.js';
import { LAB_AREAS, LAB_CASES } from '../public/content/lab-cases.js';
assert.deepEqual(monthCells(2026, 8).slice(0, 5), [null, null, 1, 2, 3]);
assert.equal(monthCells(2026, 8).filter(Boolean).length, 30);
assert.equal(monthCells(2028, 1).filter(Boolean).length, 29);
for (const event of EVENTS) {
  assert.ok(event.url.startsWith('club.html?mode=events&event='));
  const ics = eventCalendar(event);
  const utc = new Date(event.date)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  assert.ok(
    ics.includes(
      event.date.length === 10
        ? 'DTSTART;VALUE=DATE:' + event.date.replaceAll('-', '')
        : 'DTSTART:' + utc,
    ),
  );
  assert.ok(ics.includes('URL:https://dallasai.club/club.html?mode=events&event=' + event.id));
  assert.ok(!ics.includes('https://dallasai.club/events/'));
  assert.equal(new URL(event.url, 'https://dallasai.club').searchParams.get('event'), event.id);
}
for (let year = 2024; year <= 2030; year++)
  for (let month = 0; month < 12; month++) {
    const cells = monthCells(year, month);
    assert.equal(cells.length, 42);
    assert.equal(cells.indexOf(1), new Date(Date.UTC(year, month, 1)).getUTCDay());
    assert.equal(cells.filter(Boolean).length, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  }
for (const day of ['2026-04-02', '2026-04-23', '2026-05-07'])
  assert.ok(EVENTS.some((e) => e.date.startsWith(day)));
const referenceDate = new Date('2026-09-11');
const { upcoming, past } = splitEvents(referenceDate);
assert.equal(upcoming.length + past.length, EVENTS.length);
assert.ok(upcoming.every((event) => !eventIsPast(event, referenceDate)));
assert.ok(past.every((event) => eventIsPast(event, referenceDate)));
assert.equal(rubricScore([100, 0, 0, 0], [5, 0, 0, 0]), 100);
assert.equal(rubricScore([100, 0, 0, 0], [0, 5, 0, 0]), 0);
assert.equal(rubricScore([100, 100, 100, 100], [1, 2, 3, 4]), 100);
assert.equal(rubricScore([100, 100, 100, 100], [0, 0, 0, 0]), null);
assert.ok(checkInstructions(instructionScenarios.follow.response).every((c) => c.pass));
assert.ok(checkInstructions(instructionScenarios.format.response).every((c) => !c.pass));
assert.equal(
  checkInstructions(instructionScenarios.drift.response).filter((c) => !c.pass).length,
  3,
);
assert.equal(
  checkInstructions(instructionScenarios.extra.response).filter((c) => !c.pass).length,
  1,
);
for (const invalid of ['null', '[]', '42', 'true', '"text"', '{'])
  assert.equal(checkInstructions(invalid)[0].pass, false);
assert.equal(
  checkInstructions(
    JSON.stringify({ topic: 'Git workshop', summary: Array(25).fill('word').join(' ') }),
  )[3].pass,
  false,
);
assert.equal(pageId('compare'), 'lab');
assert.equal(pageId('drift'), 'lab');
// Each school links to complete decision scenarios, with consequences for both choices.
assert.equal(new Set(LAB_CASES.map((c) => c.id)).size, LAB_CASES.length);
assert.equal(LAB_AREAS.length, 7);
assert.equal(new Set(LAB_AREAS.map((area) => area.id)).size, LAB_AREAS.length);
assert.deepEqual(LAB_AREAS.flatMap((area) => area.cases).sort(), LAB_CASES.map((c) => c.id).sort());
for (const area of LAB_AREAS) {
  assert.equal(new URL(area.href).hostname, 'www.dallascollege.edu');
  assert.ok(area.programs.length > 0);
  assert.ok(area.cases.length > 0);
}
for (const exercise of LAB_CASES) {
  assert.ok(exercise.facts.length >= 2 && exercise.facts.length <= 3);
  assert.ok(exercise.facts.every((fact) => fact.label && fact.value));
  assert.ok(exercise.project && exercise.career && exercise.learn);
  assert.ok(['lab', 'ethics', 'compare', 'drift'].includes(exercise.experiment));
  assert.equal(exercise.choices.length, 2);
  assert.notEqual(exercise.choices[0].text, exercise.choices[1].text);
  for (const choice of exercise.choices)
    assert.ok(choice.text && choice.benefit && choice.tradeoff && choice.check);
}
// Mail handoff preserves Unicode and punctuation without creating extra headers.
const email = submissionEmail('AI & learning? #1', 'A question.\n한국어 & español', [
  'notes & figures.pdf',
]);
const mail = new URL(email.href);
assert.equal(mail.protocol, 'mailto:');
assert.equal(mail.pathname.toLowerCase(), EDITOR_EMAIL.toLowerCase());
assert.match(mail.searchParams.get('subject'), /AI & learning\? #1/);
assert.ok(mail.searchParams.get('body').includes('한국어 & español'));
assert.ok(mail.searchParams.get('body').includes('notes & figures.pdf'));
assert.equal(email.needsDraftFile, false);
const longEmail = submissionEmail('A longer draft', 'é'.repeat(4000));
assert.equal(longEmail.needsDraftFile, true);
assert.ok(longEmail.href.length < 1800);
assert.ok(new URL(longEmail.href).searchParams.get('body').includes('my-club-draft.txt'));
const unusualTitle = new URL(submissionEmail('Title\nbcc: example@example.org', 'Draft').href);
assert.equal(unusualTitle.searchParams.get('bcc'), null);
assert.ok(!unusualTitle.searchParams.get('subject').includes('\n'));
console.log(
  'PASS: calendar weekdays/leap month, local event links and ICS times, event categorization, weighted scores and zero priorities, instruction violations and invalid JSON, Lab score routing.',
);
