import assert from 'node:assert/strict';
import test from 'node:test';
import { marketStudy } from '../public/projects/market-visuals.js';

test('unseen market changes cannot alter the fitted model and increase its test error', () => {
  const steady = marketStudy('steady');
  const shift = marketStudy('shift');
  assert.deepEqual(steady.values.slice(0, 20), shift.values.slice(0, 20));
  assert.notDeepEqual(steady.values.slice(20), shift.values.slice(20));
  assert.deepEqual(steady.forecast, shift.forecast, 'held-out prices must not influence training');
  assert.ok(shift.error > steady.error * 5, 'the changed trend should visibly worsen the forecast');
  assert.equal(steady.error.toFixed(1), '0.8');
  assert.equal(shift.error.toFixed(1), '9.4');
});

test('market cases provide finite plotted values, usable errors and a safe default', () => {
  for (const id of ['steady', 'shift', 'noise']) {
    const study = marketStudy(id);
    assert.equal(study.values.length, 30);
    assert.equal(study.forecast.length, 30);
    assert.ok([...study.values, ...study.forecast].every(Number.isFinite));
    assert.ok(Number.isFinite(study.error) && study.error >= 0);
    assert.ok(study.label && study.note);
  }
  assert.deepEqual(marketStudy('missing-pattern'), marketStudy('steady'));
});
