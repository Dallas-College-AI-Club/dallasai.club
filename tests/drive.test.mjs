import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as T from '../public/vendor/three.module.js';
import { MeshPrimitives } from '../public/drive/mesh-primitives.js';
import { DriveWorld } from '../public/drive/world.js';
import { CAMPUSES, project, MAP_BOUNDS } from '../public/drive/geography.js';
import { STOPS, campusPoint, stopPoint, advanceDrive } from '../public/drive/physics.js';
import {
  LAYOUTS,
  localRoute,
  hitsObstacle,
  avoidObstacles,
  VEHICLE_CLEARANCE,
  movementBlocked,
} from '../public/drive/collisions.js';
import { RoadRouter } from '../public/drive/road-routing.js';
import { DriveScore } from '../public/drive/score.js';
import { WeatherCycle } from '../public/drive/weather-cycle.js';
import { LANDMARKS } from '../public/drive/landmarks.js';
import { ScoreStore } from '../server.mjs';
import { landscape } from '../public/drive/environment.js';
// Geometry construction uses a minimal DOM adapter; routing inspects the actual emitted obstacles.
const element = () => ({
  width: 512,
  height: 256,
  dataset: {},
  style: { setProperty() {} },
  lastElementChild: {},
  setAttribute() {},
  append() {},
  addEventListener() {},
  getContext() {
    return { fillRect() {}, strokeRect() {}, fillText() {} };
  },
});
globalThis.document = { createElement: element, querySelector: element };
const world = {
  scene: new T.Scene(),
  materials: {},
  obstacles: [],
  markers: [],
  wheels: [],
  boxGeo: new T.BoxGeometry(1, 1, 1),
  sphereGeo: new T.SphereGeometry(1, 12, 8),
};
for (const name of ['mat', 'mesh', 'box', 'cylinder', 'sphere', 'tube'])
  world[name] = MeshPrimitives.prototype[name];
world.label = () => new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial());
world.tree = DriveWorld.prototype.tree;
world.travelTo = () => {};
DriveWorld.prototype.makeCampuses.call(world);
DriveWorld.prototype.makeLandmarks.call(world);
world.roadData = JSON.parse(await fs.readFile('public/road-network.json', 'utf8'));
world.position = campusPoint(CAMPUSES.find((c) => c.id === 'el-centro'));
world.terrain = { height: () => 0 };
landscape(world);
assert.equal(world.stations.length, 35);
assert.equal(new Set(Object.values(LAYOUTS).map((x) => JSON.stringify(x))).size, 7);
function checkClear(route) {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1],
      b = route[i],
      d = Math.hypot(b.x - a.x, b.z - a.z),
      steps = Math.ceil(d / 0.23);
    for (let n = 1; n <= steps; n++) {
      const t = n / steps,
        p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      const hit = world.obstacles.find((o) => hitsObstacle(p, o, VEHICLE_CLEARANCE));
      assert.ok(!hit, 'Obstacle hit ' + JSON.stringify({ p, hit }));
    }
  }
}
for (const c of CAMPUSES)
  for (const s of STOPS) {
    const route = localRoute(
      campusPoint(c),
      stopPoint(c, s.id),
      world.obstacles,
      c.id === 'el-centro' ? 0.55 : 1,
    );
    checkClear(route);
  }
console.log('35 station approaches clear for the full vehicle; seven distinct layouts.');
assert.equal(
  movementBlocked({ x: -4, z: 0 }, { x: 4, z: 0 }, [{ x: 0, z: 0, w: 0.1, d: 3 }]),
  true,
);
assert.equal(
  movementBlocked({ x: -4, z: 5 }, { x: 4, z: 5 }, [{ x: 0, z: 0, w: 0.1, d: 3 }]),
  false,
);
const network = JSON.parse(await fs.readFile('public/road-network.json', 'utf8')),
  router = new RoadRouter(network);
let routes = 0;
for (const a of CAMPUSES)
  for (const b of CAMPUSES) {
    if (a === b) continue;
    const raw = router.route(campusPoint(a), b),
      safe = avoidObstacles(raw, world.obstacles);
    checkClear(safe);
    assert.ok(
      Math.hypot(safe.at(-1).x - campusPoint(b).x, safe.at(-1).z - campusPoint(b).z) < 0.01,
    );
    routes++;
  }
console.log(routes + ' campus routes checked against rendered buildings and furniture.');
const data = {
    nodes: [
      [0, 0],
      [150, 0],
    ],
    edges: [[0, 1, 'Test road', 'motorway']],
  },
  score = new DriveScore(data);
score.step({ x: 0, z: 0 }, { x: 0, z: 0 }, true);
assert.equal(score.points, 0);
for (let x = 1; x < 100; x++) score.step({ x: x - 1, z: 0 }, { x, z: 0 }, true);
assert.equal(score.multiplier, 3);
assert.ok(score.points > 150);
const earned = score.points;
for (let x = 99; x > 0; x--) score.step({ x: x + 1, z: 0 }, { x, z: 0 }, true);
assert.equal(score.points, earned);
score.step({ x: 101, z: 0 }, { x: 102, z: 0 }, false);
assert.equal(score.points, earned);
score.step({ x: 102, z: 2 }, { x: 102, z: 5 }, true);
assert.equal(score.multiplier, 1);
assert.equal(score.bonus('one'), 50);
assert.equal(score.bonus('one'), 0);
assert.equal(score.visit('el-centro', 'projects'), 100);
assert.equal(score.visit('el-centro', 'projects'), 0);
score.reset();
assert.equal(score.points, 0);
console.log('No idle points, repeated-road farming, duplicate bonuses, or guided-driving points.');
let seed = 3;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  cycle = new WeatherCycle(random),
  events = new Set(),
  seasons = new Set();
let current = { weather: 'clear', season: 'spring' };
for (let i = 0; i < 300; i++) {
  current = cycle.step(90, current) || current;
  events.add(current.weather);
  seasons.add(current.season);
}
assert.equal(events.size, 4);
assert.equal(seasons.size, 4);
cycle.automatic = false;
assert.equal(cycle.step(1000, current), null);
console.log('Automatic weather visits all four weather/season states; manual override pauses it.');
const state = { position: { x: 0, z: 0 }, heading: 0, speed: 0 };
advanceDrive(state, { a: true }, 0.04);
assert.equal(state.heading, 0);
for (let i = 0; i < 100; i++) advanceDrive(state, { w: true, a: true }, 0.02);
assert.ok(state.speed > 0 && state.heading > 0);
assert.ok(Number.isFinite(state.position.x));
for (const l of LANDMARKS) {
  const p = project(l.lon, l.lat);
  assert.ok(Math.hypot(p.x - l.x, p.z - l.z) < 1e-7);
  assert.ok(l.footprint.length > 3);
}
assert.ok(project(-96.957, 32.588).z < MAP_BOUNDS.maxZ);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'club-drive-'));
assert.ok(path.resolve(tmp).startsWith(path.resolve(os.tmpdir()) + path.sep));
const file = path.join(tmp, 'scores.json'),
  store = new ScoreStore(file),
  id = '12345678-1234-1234-1234-123456789abc';
await store.save({ playerId: id, nickname: 'Audit Driver', score: 123 });
await store.save({ playerId: id, nickname: 'Audit Driver', score: 12 });
assert.deepEqual(
  (await store.list()).map(({ nickname, score }) => ({ nickname, score })),
  [{ nickname: 'Audit Driver', score: 123 }],
);
await assert.rejects(store.save({ playerId: id, nickname: '<script>', score: 1 }));
await assert.rejects(store.save({ playerId: id, nickname: 'Driver', score: Infinity }));
assert.equal((await new ScoreStore(file).list())[0].score, 123);
await fs.unlink(file);
await fs.rmdir(tmp);
console.log('Ranking validation, best-score persistence and restart recovery passed.');

// A paused drive must release its frame and ignore an already queued callback.
const originalCancel = globalThis.cancelAnimationFrame;
const originalRequest = globalThis.requestAnimationFrame;
let canceledFrame,
  pauseSaves = 0;
try {
  globalThis.cancelAnimationFrame = (frame) => {
    canceledFrame = frame;
  };
  globalThis.requestAnimationFrame = () => assert.fail('A paused drive must not schedule work');
  const paused = Object.assign(Object.create(DriveWorld.prototype), {
    active: true,
    frame: 17,
    keys: { w: true },
    speed: 2,
    experience: { persist: () => pauseSaves++ },
  });
  paused.pause();
  paused.pause();
  paused.loop(500);
  assert.equal(canceledFrame, 17);
  assert.equal(pauseSaves, 1);
  assert.deepEqual(paused.keys, {});
  assert.equal(paused.speed, 0);
} finally {
  if (originalCancel) globalThis.cancelAnimationFrame = originalCancel;
  else delete globalThis.cancelAnimationFrame;
  if (originalRequest) globalThis.requestAnimationFrame = originalRequest;
  else delete globalThis.requestAnimationFrame;
}
