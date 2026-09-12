import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.module.js';
import { DallasTerrain } from '../public/drive/terrain.js';
import { roadSurfaces } from '../public/drive/road-surface.js';
import { MeshPrimitives } from '../public/drive/mesh-primitives.js';
import { CAMPUSES } from '../public/drive/geography.js';
import { LANDMARKS } from '../public/drive/landmarks.js';
const map = JSON.parse(await fs.readFile('public/dallas-map.json', 'utf8')),
  roads = JSON.parse(await fs.readFile('public/road-network.json', 'utf8'));
const world = {
  scene: new T.Scene(),
  materials: {},
  ground: new T.Mesh(new T.PlaneGeometry(2800, 2800), new T.MeshStandardMaterial()),
  mat: MeshPrimitives.prototype.mat,
};
world.terrain = new DallasTerrain(world, map, roads);
roadSurfaces(world, roads);
let highest = 0;
for (const [x, z] of roads.nodes) {
  const y = world.terrain.height(x, z);
  assert.ok(Number.isFinite(y) && y >= -0.00001);
  highest = Math.max(highest, y);
}
assert.ok(highest > 2, 'Road grades should no longer be completely flat');
for (const c of CAMPUSES)
  assert.ok(world.terrain.height(c.x, c.z) < 0.001, 'Campus building foundation stays flat');
const bridge = LANDMARKS.find((l) => l.id === 'bridge');
assert.ok(
  world.terrain.height(bridge.x, bridge.z) >= 0.245,
  'Vehicle rides on top of the bridge deck',
);
for (const mesh of world.roadMeshes) {
  const p = mesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i += 7) {
    const offset = p.getY(i) - world.terrain.height(p.getX(i), p.getZ(i));
    assert.ok(offset > 0 && offset < 0.06, 'Road vertices must remain above the terrain');
  }
}
console.log(
  `Road surfaces and car heights use the same terrain. Elevated roads verified (maximum ${highest.toFixed(2)} scene units). Campus foundations and bridge deck verified.`,
);
