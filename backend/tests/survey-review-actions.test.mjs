import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sameChoice,
  toggleAllResponses,
  fullResponseFilename,
} from '../surveys/review-actions.js';
import { partitionResponses } from '../surveys/results-ui.js';

test('choice markers require identical original built-in answers without changing selection order', () => {
  const choice = {
    type: 'choice',
    options: [{ id: 'teams' }, { id: 'email' }, { id: 'usual' }],
  };
  const multi = { ...choice, type: 'multi_choice' };
  const response = (answer, fields = {}) => ({
    mode: 'structured',
    answer,
    ...fields,
  });
  const teams = response({ value: 'teams' });
  const cases = [
    ['single match', choice, teams, teams, true],
    ['different choice', choice, teams, response({ value: 'email' }), false],
    [
      'own reversed order',
      multi,
      response({ values: ['teams', 'email'] }),
      response({ values: ['email', 'teams'] }),
      true,
    ],
    [
      'peer reversed order',
      multi,
      response({ values: ['email', 'teams'] }),
      response({ values: ['teams', 'email'] }),
      true,
    ],
    [
      'different selection',
      multi,
      response({ values: ['teams', 'email'] }),
      response({ values: ['teams'] }),
      false,
    ],
    [
      'empty selection',
      multi,
      response({ values: [] }),
      response({ values: [] }),
      false,
    ],
    ['unanswered single', choice, response(), response(), false],
    [
      'own edited wording',
      choice,
      { ...teams, mode: 'narrative' },
      teams,
      false,
    ],
    [
      'peer edited wording',
      choice,
      teams,
      { ...teams, mode: 'narrative' },
      false,
    ],
    ['stale wording', choice, { ...teams, stale: true }, teams, false],
    ['peer-only row', choice, { ...teams, empty: true }, teams, false],
    [
      'custom IDs are author-specific',
      choice,
      response({ value: 'custom_one' }),
      response({ value: 'custom_one' }),
      false,
    ],
    [
      'indirect usual route',
      choice,
      response({ value: 'usual' }),
      response({ value: 'usual' }),
      false,
    ],
    ['rank is not a choice', { ...choice, type: 'rank' }, teams, teams, false],
    ['no question', undefined, teams, teams, false],
    ['no shared answer', choice, teams, undefined, false],
  ];
  for (const [label, q, own, peer, expected] of cases) {
    const before = JSON.stringify([own, peer]);
    assert.equal(sameChoice(q, own, peer), expected, label);
    assert.equal(
      JSON.stringify([own, peer]),
      before,
      label + ' keeps source order',
    );
  }
});
test('results omit unanswered people and keep archived submissions separate', () => {
  const active = { active: true, revision: 1, responses: [{ text: 'Yes' }] },
    archived = {
      active: false,
      revision: 1,
      responses: [{ text: 'Past response' }],
    };
  assert.deepEqual(
    partitionResponses([
      active,
      archived,
      { active: true, revision: null, responses: null },
      { active: true, revision: 1, responses: [] },
    ]),
    { active: [active], archived: [archived] },
  );
});
test('bulk wording review and sharing remain separate and skip empty, stale, and archived responses', () => {
  const fields = [
    { id: 'a', text: 'My response' },
    { id: 'b', text: '' },
    { id: 'c', text: 'Old wording', stale: true },
    { id: 'd', text: 'Removed', archived: true },
  ];
  const review = Object.fromEntries(
    fields.map((f) => [f.id, { reviewed: false, included: false }]),
  );
  const reviewed = new Set(),
    included = new Set();
  assert.deepEqual(toggleAllResponses(fields, review, 'reviewed', reviewed), {
    count: 1,
    undo: false,
  });
  assert.deepEqual(review.a, { reviewed: true, included: false });
  assert.deepEqual(toggleAllResponses(fields, review, 'included', included), {
    count: 1,
    undo: false,
  });
  assert.deepEqual(review.a, { reviewed: true, included: true });
  for (const id of ['b', 'c', 'd'])
    assert.deepEqual(review[id], { reviewed: false, included: false });
  assert.deepEqual(toggleAllResponses(fields, review, 'reviewed', reviewed), {
    count: 1,
    undo: true,
  });
  assert.deepEqual(review.a, { reviewed: false, included: true });
  toggleAllResponses(fields, review, 'included', included);
  assert.deepEqual(review.a, { reviewed: false, included: false });
});
test('undo bulk actions preserves preexisting individual choices and can be repeated independently', () => {
  const fields = ['a', 'b', 'c'].map((id) => ({ id, text: id }));
  const review = {
    a: { reviewed: true, included: false },
    b: { reviewed: false, included: true },
    c: { reviewed: false, included: false },
  };
  const reviewed = new Set(),
    included = new Set();
  for (let repeat = 0; repeat < 2; repeat++) {
    assert.deepEqual(toggleAllResponses(fields, review, 'reviewed', reviewed), {
      count: 2,
      undo: false,
    });
    assert.deepEqual(toggleAllResponses(fields, review, 'included', included), {
      count: 2,
      undo: false,
    });
    toggleAllResponses(fields, review, 'reviewed', reviewed);
    assert.deepEqual(
      Object.values(review).map((r) => r.reviewed),
      [true, false, false],
    );
    assert.deepEqual(
      Object.values(review).map((r) => r.included),
      [true, true, true],
    );
    toggleAllResponses(fields, review, 'included', included);
    assert.deepEqual(
      Object.values(review).map((r) => r.included),
      [false, true, false],
    );
  }
});
test('personal export names contain the form, display name, and safe Central timestamp', () => {
  assert.equal(
    fullResponseFilename(
      'Advisor Studio',
      'Minjoo Kim',
      'docx',
      new Date('2026-10-03T03:55:00Z'),
    ),
    'Advisor-Studio-full-response_Minjoo-Kim_2026-10-02_22-55-00-CT.docx',
  );
  assert.equal(
    fullResponseFilename(
      'Advisor Studio',
      '김 민주',
      'md',
      new Date('2026-12-03T06:05:09Z'),
    ),
    'Advisor-Studio-full-response_김-민주_2026-12-03_00-05-09-CT.md',
  );
  assert.doesNotMatch(
    fullResponseFilename('Form: test/', 'Name <x> \\ ?', 'md'),
    /[<>:"/\\|?*]/,
  );
});
