import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from '../public/vendor/three.module.js';
import { MeshPrimitives } from '../public/drive/mesh-primitives.js';
import { DriveWorld } from '../public/drive/world.js';
import { CITY_PLACES } from '../public/drive/places-data.js';
import { MAP_BOUNDS } from '../public/drive/geography.js';
import { RoadRouter } from '../public/drive/road-routing.js';
import { routeToPlace } from '../public/drive/places.js';
import { movementBlocked } from '../public/drive/collisions.js';
import { START, advanceDrive } from '../public/drive/physics.js';
import { touchVector } from '../public/drive/touch.js';
import { landscape } from '../public/drive/environment.js';
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
const w = {
  scene: new T.Scene(),
  materials: {},
  obstacles: [],
  markers: [],
  wheels: [],
  boxGeo: new T.BoxGeometry(1, 1, 1),
  sphereGeo: new T.SphereGeometry(1, 12, 8),
  position: { ...START },
};
for (const name of ['mat', 'mesh', 'box', 'cylinder', 'sphere', 'tube'])
  w[name] = MeshPrimitives.prototype[name];
w.label = () => new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial());
w.tree = DriveWorld.prototype.tree;
w.travelTo = () => {};
DriveWorld.prototype.makeCampuses.call(w);
DriveWorld.prototype.makeLandmarks.call(w);
w.router = new RoadRouter(JSON.parse(await fs.readFile('public/road-network.json', 'utf8')));
w.roadData = w.router.data;
w.terrain = { height: () => 0 };
landscape(w);
for (const p of CITY_PLACES) {
  assert.ok(
    p.x > MAP_BOUNDS.minX &&
      p.x < MAP_BOUNDS.maxX &&
      p.z > MAP_BOUNDS.minZ &&
      p.z < MAP_BOUNDS.maxZ,
  );
  const route = routeToPlace(w, p);
  assert.ok(route.length > 1);
  for (let i = 1; i < route.length; i++)
    assert.equal(
      movementBlocked(route[i - 1], route[i], w.obstacles),
      false,
      p.name + ' path crosses a solid',
    );
  console.log(p.name + ': clear connected approach');
}
assert.equal(touchVector(0, 0).throttle, 0);
assert.equal(touchVector(0, -40).throttle, 1);
assert.equal(touchVector(0, 40).throttle, -1);
assert.equal(touchVector(40, 0).steer, -1);
const car = {
  position: { x: 0, z: 0 },
  heading: 0,
  speed: 0,
  driveInput: { throttle: 1, steer: 0.5 },
};
for (let i = 0; i < 100; i++) advanceDrive(car, {}, 0.02);
assert.ok(car.speed > 5);
assert.ok(car.heading > 0);
assert.ok(Math.hypot(car.position.x, car.position.z) > 5);
car.driveInput = null;
for (let i = 0; i < 80; i++) advanceDrive(car, {}, 0.02);
assert.ok(car.speed < 0.01);
console.log('12 geographic places, collision-safe approaches and analog phone steering passed.');
