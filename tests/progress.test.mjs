import assert from 'node:assert/strict';
import { DriveScore } from '../public/drive/score.js';
import { readRun, writeRun, RUN_KEY } from '../public/storage/drive.js';
import { randomVehicle, VEHICLES } from '../public/drive/vehicle.js';
import { mascotBody, MASCOT_STYLE } from '../public/drive/mascot.js';
import * as T from '../public/vendor/three.module.js';
const data = {
    nodes: [
      [0, 0],
      [120, 0],
    ],
    edges: [[0, 1, 'Test road', 'motorway']],
  },
  score = new DriveScore(data);
assert.equal(score.campus('el-centro'), 0);
assert.equal(score.campus('brookhaven'), 250);
assert.equal(score.campus('brookhaven'), 0);
score.visit('brookhaven', 'journal');
score.bonus('route-3');
for (let x = 0; x < 40; x++) score.step({ x, z: 0 }, { x: x + 1, z: 0 }, true);
let saved = null;
const storage = {
  setItem(k, v) {
    assert.equal(k, RUN_KEY);
    saved = v;
  },
  getItem() {
    return saved;
  },
};
assert.ok(
  writeRun(
    { position: { x: 0, z: 0 }, heading: 0.5, campus: 'brookhaven', score: score.snapshot() },
    storage,
  ),
);
const run = readRun(storage),
  restored = new DriveScore(data);
assert.ok(restored.restore(run.score));
assert.equal(restored.points, score.points);
assert.equal(restored.multiplier, score.multiplier);
assert.deepEqual(restored.campuses, score.campuses);
const points = restored.points;
assert.equal(restored.campus('brookhaven'), 0);
assert.equal(restored.visit('brookhaven', 'journal'), 0);
assert.equal(restored.bonus('route-3'), 0);
for (let x = 0; x < 40; x++) restored.step({ x, z: 0 }, { x: x + 1, z: 0 }, true);
assert.equal(restored.points, points);
assert.equal(restored.previewPage('journal'), 20);
assert.equal(restored.previewPage('journal'), 0);
assert.equal(restored.visitPage('journal'), 100);
assert.equal(restored.returnToDrive(), 50);
assert.equal(restored.visitPage('journal'), 0);
assert.equal(restored.returnToDrive(), 0);
assert.equal(restored.previewPage('invalid'), 0);
const again = new DriveScore(data);
again.restore(restored.snapshot());
assert.equal(again.previewPage('journal'), 0);
assert.equal(again.visitPage('journal'), 0);
assert.equal(again.returnToDrive(), 0);
assert.equal(again.previewPage('projects'), 20);
assert.equal(again.visitPage('projects'), 100);
assert.equal(again.returnToDrive(), 50);
restored.reset();
assert.equal(restored.points, 0);
assert.equal(restored.campuses.size, 1);
assert.equal(restored.campus('brookhaven'), 250);
saved = '{malformed';
assert.equal(readRun(storage), null);
saved = JSON.stringify({ version: 1, position: { x: Infinity, z: 0 }, heading: 0 });
assert.equal(readRun(storage), null);
assert.equal(
  writeRun(
    {},
    {
      setItem() {
        throw Error('Storage unavailable');
      },
    },
  ),
  false,
);
for (const v of VEHICLES) {
  assert.notEqual(randomVehicle(v.id, () => 0).id, v.id);
  assert.notEqual(randomVehicle(v.id, () => 0.999).id, v.id);
}
const paint = new T.MeshStandardMaterial();
for (const id of Object.keys(MASCOT_STYLE)) {
  const g = mascotBody(id, paint);
  g.traverse((o) => {
    if (o.geometry) {
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.array.length; i++)
        assert.ok(Number.isFinite(pos.array[i]), id + ' has an invalid vertex');
    }
  });
}
console.log(
  'Progress survives serialization; repeated road, campus, stop and route bonuses remain blocked. Reset starts a clean drive. Corrupt or blocked storage falls back safely. Five random vehicle types and eight mascot bodies verified.',
);
