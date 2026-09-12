import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.module.js';
import { makeVehicle, VEHICLES, MASCOTS } from '../public/drive/vehicle.js';
import { MeshPrimitives } from '../public/drive/mesh-primitives.js';
import { VEHICLE_CLEARANCE } from '../public/drive/collisions.js';
const element = () => ({
    style: {},
    append() {},
    replaceChildren() {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
  }),
  fields = new Map();
globalThis.document = {
  createElement: element,
  createElementNS: element,
  querySelector: (id) => {
    if (!fields.has(id)) fields.set(id, element());
    return fields.get(id);
  },
};
let selected;
globalThis.localStorage = {
  getItem() {
    return JSON.stringify(selected);
  },
  setItem(k, v) {
    selected = JSON.parse(v);
  },
};
const world = {
  scene: new T.Scene(),
  materials: {},
  boxGeo: new T.BoxGeometry(1, 1, 1),
  sphereGeo: new T.SphereGeometry(1, 20, 12),
};
for (const key of ['mat', 'mesh', 'box', 'cylinder']) world[key] = MeshPrimitives.prototype[key];
let largest = 0;
for (const type of VEHICLES)
  for (const [mascot] of MASCOTS) {
    selected = { vehicle: type.id, mascot };
    const g = makeVehicle(world);
    g.updateMatrixWorld(true);
    g.traverse((mesh) => {
      if (!mesh.geometry) return;
      const p = mesh.geometry.attributes.position,
        v = new T.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        largest = Math.max(largest, Math.hypot(v.x, v.z));
        assert.ok(
          Math.hypot(v.x, v.z) <= VEHICLE_CLEARANCE,
          `${type.id}/${mascot} exceeds collision clearance: ${Math.hypot(v.x, v.z)}`,
        );
      }
    });
  }
console.log(
  `All ${VEHICLES.length * MASCOTS.length} vehicle/mascot combinations fit inside the collision envelope. Largest radius: ${largest.toFixed(3)}; clearance: ${VEHICLE_CLEARANCE}.`,
);
