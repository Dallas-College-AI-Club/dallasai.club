import * as T from '../vendor/three.module.js';
import { CAMPUSES } from './geography.js';
import { CITY_PLACES } from './places-data.js';
import { hitsObstacle } from './collisions.js';
// Instanced landscape: few draw calls, solid trunks, open roads and entrances.
export function landscape(world) {
  let seed = 71419;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647,
    positions = [];
  const roads = world.roadData.edges.map(([a, b]) => ({
    a: world.roadData.nodes[a],
    b: world.roadData.nodes[b],
  }));
  const nearRoad = (x, z) =>
    roads.some(({ a, b }) => {
      if (
        x < Math.min(a[0], b[0]) - 4 ||
        x > Math.max(a[0], b[0]) + 4 ||
        z < Math.min(a[1], b[1]) - 4 ||
        z > Math.max(a[1], b[1]) + 4
      )
        return false;
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        t = Math.max(
          0,
          Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)),
        );
      return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < 4;
    });
  for (const c of [...CAMPUSES, ...CITY_PLACES])
    for (let i = 0; i < 25; i++) {
      const angle = random() * Math.PI * 2,
        r = (c.radius || 28) + 12 + random() * 27,
        x = c.x + Math.cos(angle) * r,
        z = c.z + Math.sin(angle) * r;
      if (
        Math.hypot(x - world.position.x, z - world.position.z) < 5 ||
        nearRoad(x, z) ||
        world.obstacles.some((o) => hitsObstacle({ x, z }, o, 3)) ||
        positions.some((p) => Math.hypot(x - p.x, z - p.z) < 4)
      )
        continue;
      positions.push({ x, z, y: world.terrain.height(x, z), scale: 0.8 + random() * 0.7 });
    }
  const bark = world.mat('#777168', 0, 0.98),
    leaves = world.mat('#6f8c69', 0, 0.96);
  world.leafMaterials ??= new Set();
  world.leafMaterials.add(leaves);
  const trunks = new T.InstancedMesh(
      new T.CylinderGeometry(0.08, 0.13, 1.6, 7),
      bark,
      positions.length,
    ),
    crowns = new T.InstancedMesh(new T.IcosahedronGeometry(0.9, 2), leaves, positions.length * 3);
  trunks.castShadow = crowns.castShadow = true;
  trunks.receiveShadow = crowns.receiveShadow = true;
  trunks.userData.cameraIgnore = crowns.userData.cameraIgnore = true;
  world.scene.add(trunks, crowns);
  const o = new T.Object3D(),
    color = new T.Color();
  positions.forEach((p, i) => {
    o.position.set(p.x, p.y + 0.8 * p.scale, p.z);
    o.scale.setScalar(p.scale);
    o.rotation.set(0, random() * 6, 0);
    o.updateMatrix();
    trunks.setMatrixAt(i, o.matrix);
    world.obstacles.push({ x: p.x, z: p.z, w: 0.26 * p.scale, d: 0.26 * p.scale, landscape: true });
    for (let j = 0; j < 3; j++) {
      o.position.set(
        p.x + Math.sin(j * 2.1) * 0.35 * p.scale,
        p.y + (1.6 + j * 0.24) * p.scale,
        p.z + Math.cos(j * 2.1) * 0.35 * p.scale,
      );
      o.scale.set(
        p.scale * (0.85 + random() * 0.3),
        p.scale * (1.05 + random() * 0.35),
        p.scale * (0.7 + random() * 0.25),
      );
      o.updateMatrix();
      crowns.setMatrixAt(i * 3 + j, o.matrix);
      color.setHSL(0.25 + random() * 0.05, 0.15 + random() * 0.12, 0.63 + random() * 0.12);
      crowns.setColorAt(i * 3 + j, color);
    }
  });
  trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
  world.landscape = positions;
}
