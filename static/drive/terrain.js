import * as T from '../vendor/three.module.js';
import { CAMPUSES } from './geography.js';
import { LANDMARKS } from './landmarks.js';
import { CITY_PLACES } from './places-data.js';
const dist = (p, a, b) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / (dx * dx + dz * dz || 1)),
    );
  return Math.hypot(p.x - a[0] - t * dx, p.z - a[1] - t * dz);
};
const bridge = LANDMARKS.find((l) => l.id === 'bridge');
function bridgeGrade(x, z) {
  const p = { x: x - bridge.x, z: z - bridge.z };
  if (Math.abs(p.x) > 17 || Math.abs(p.z) > 10) return 0;
  let inside = false,
    edge = Infinity;
  for (let i = 0, j = bridge.footprint.length - 1; i < bridge.footprint.length; j = i++) {
    const a = bridge.footprint[i],
      b = bridge.footprint[j];
    if (a[1] > p.z !== b[1] > p.z && p.x < ((b[0] - a[0]) * (p.z - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
    edge = Math.min(edge, dist(p, a, b));
  }
  const t = inside ? 1 : Math.max(0, 1 - edge / 2);
  return 0.245 * t * t * (3 - 2 * t);
}
export class DallasTerrain {
  constructor(world, map, roads) {
    this.world = world;
    this.grid = new Map();
    this.water = [];
    const put = (a, b, pad) => {
      const seg = { a, b, pad };
      for (
        let x = Math.floor(Math.min(a[0], b[0]) / 40);
        x <= Math.floor(Math.max(a[0], b[0]) / 40);
        x++
      )
        for (
          let z = Math.floor(Math.min(a[1], b[1]) / 40);
          z <= Math.floor(Math.max(a[1], b[1]) / 40);
          z++
        ) {
          const key = x + ',' + z;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(seg);
        }
    };
    const water = new T.MeshStandardMaterial({
      color: '#387b97',
      metalness: 0.48,
      roughness: 0.19,
      transparent: true,
      opacity: 0.97,
      side: T.DoubleSide,
    });
    this.material = water;
    for (const f of map.features.filter((f) => f.type === 'river' || f.type === 'water')) {
      if (f.points.length < 2) continue;
      let geo;
      if (f.type === 'water' && f.points.length > 3) {
        const shape = new T.Shape(f.points.map(([x, z]) => new T.Vector2(x, -z)));
        geo = new T.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        const xs = f.points.map((p) => p[0]),
          zs = f.points.map((p) => p[1]);
        this.water.push({
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
          minZ: Math.min(...zs),
          maxZ: Math.max(...zs),
        });
      } else {
        const v = [],
          width = f.name.includes('Trinity') ? 1.5 : 0.65;
        for (let i = 1; i < f.points.length; i++) {
          const a = f.points[i - 1],
            b = f.points[i],
            dx = b[0] - a[0],
            dz = b[1] - a[1],
            d = Math.hypot(dx, dz) || 1,
            nx = (-dz / d) * width,
            nz = (dx / d) * width;
          v.push(
            a[0] + nx,
            0,
            a[1] + nz,
            a[0] - nx,
            0,
            a[1] - nz,
            b[0] + nx,
            0,
            b[1] + nz,
            a[0] - nx,
            0,
            a[1] - nz,
            b[0] - nx,
            0,
            b[1] - nz,
            b[0] + nx,
            0,
            b[1] + nz,
          );
          put(a, b, width + 3);
        }
        geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.Float32BufferAttribute(v, 3));
        geo.computeVertexNormals();
      }
      const mesh = new T.Mesh(geo, water);
      mesh.position.y = -0.035;
      mesh.userData.cameraIgnore = true;
      world.scene.add(mesh);
    }
    const geo = new T.PlaneGeometry(2800, 2800, 480, 480);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++)
      pos.setY(i, this.baseHeight(pos.getX(i), pos.getZ(i)) - 0.08);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    world.ground.geometry.dispose();
    world.ground.geometry = geo;
    world.ground.rotation.x = 0;
    world.ground.position.y = 0;
    this.surface = pos;
  }
  baseHeight(x, z) {
    let clearance = 55;
    const gx = Math.floor(x / 40),
      gz = Math.floor(z / 40),
      p = { x, z };
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const s of this.grid.get(gx + dx + ',' + (gz + dz)) || [])
          clearance = Math.min(clearance, dist(p, s.a, s.b) - s.pad);
    for (const c of CAMPUSES) clearance = Math.min(clearance, Math.hypot(x - c.x, z - c.z) - 34);
    for (const c of CITY_PLACES)
      clearance = Math.min(clearance, Math.hypot(x - c.x, z - c.z) - c.radius - 8);
    for (const c of LANDMARKS) clearance = Math.min(clearance, Math.hypot(x - c.x, z - c.z) - 20);
    for (const w of this.water)
      if (x > w.minX - 6 && x < w.maxX + 6 && z > w.minZ - 6 && z < w.maxZ + 6) return 0;
    if (clearance <= 0) return 0;
    const smooth = Math.min(1, clearance / 18);
    const southwest =
      Math.max(0, Math.min(1, (z + 150) / 450)) * Math.max(0.2, Math.min(1, (150 - x) / 500));
    const hills =
      (0.55 + 0.45 * Math.sin(x * 0.012 + Math.cos(z * 0.008))) * (0.6 + 0.4 * Math.cos(z * 0.01));
    const local = 0.45 + 0.55 * Math.sin(x * 0.034 + z * 0.019) ** 2;
    return smooth * smooth * (3 + 9 * southwest) * (0.7 * hills + 0.3 * local);
  }
  height(x, z) {
    if (!this.surface) return this.baseHeight(x, z);
    const u = Math.max(0, Math.min(479.999, ((x + 1400) / 2800) * 480)),
      v = Math.max(0, Math.min(479.999, ((z + 1400) / 2800) * 480)),
      ix = Math.floor(u),
      iz = Math.floor(v),
      tx = u - ix,
      tz = v - iz,
      a = iz * 481 + ix,
      h = (n) => this.surface.getY(n) + 0.08,
      ground =
        tx + tz <= 1
          ? h(a) + (h(a + 1) - h(a)) * tx + (h(a + 481) - h(a)) * tz
          : h(a + 482) + (h(a + 481) - h(a + 482)) * (1 - tx) + (h(a + 1) - h(a + 482)) * (1 - tz);
    return Math.max(ground, bridgeGrade(x, z));
  }
  update(time, reduced) {
    if (!reduced) this.material.roughness = 0.19 + Math.sin(time * 0.0004) * 0.025;
  }
}
