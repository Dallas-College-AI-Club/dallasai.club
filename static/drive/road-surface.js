import * as T from '../vendor/three.module.js';
// Follow the OSM centerlines with a continuous surface sampled from the visible terrain.
export function roadSurfaces(world, data) {
  for (const mesh of world.roadMeshes || []) {
    world.scene.remove(mesh);
    mesh.geometry.dispose();
  }
  world.roadMeshes = [];
  const surfaces = [],
    shoulders = [],
    marks = [],
    seen = new Set(),
    height = (x, z) => world.terrain?.height(x, z) || 0;
  const strip = (out, a, b, w, lift) => {
    const dx = b.x - a.x,
      dz = b.z - a.z,
      d = Math.hypot(dx, dz) || 1,
      nx = ((-dz / d) * w) / 2,
      nz = ((dx / d) * w) / 2,
      pts = [
        [a.x + nx, a.z + nz],
        [a.x - nx, a.z - nz],
        [b.x + nx, b.z + nz],
        [b.x - nx, b.z - nz],
      ];
    for (const i of [0, 1, 2, 1, 3, 2]) {
      const [x, z] = pts[i];
      out.push(x, height(x, z) + lift, z);
    }
  };
  for (const [ai, bi, , type] of data.edges) {
    const key = [Math.min(ai, bi), Math.max(ai, bi)].join();
    if (seen.has(key)) continue;
    seen.add(key);
    const a = data.nodes[ai],
      b = data.nodes[bi],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      distance = Math.hypot(dx, dz),
      steps = Math.max(1, Math.ceil(distance / 1.7)),
      w =
        type === 'motorway' ? 2.15 : type.includes('link') ? 1.45 : type === 'access' ? 2.4 : 1.85;
    for (let i = 0; i < steps; i++) {
      const t = i / steps,
        u = (i + 1) / steps,
        p = { x: a[0] + dx * t, z: a[1] + dz * t },
        q = { x: a[0] + dx * u, z: a[1] + dz * u };
      strip(shoulders, p, q, w + 0.3, 0.012);
      strip(surfaces, p, q, w, 0.04);
      if (i % 2 === 0 && distance > 0.6) {
        const m = { x: p.x + (q.x - p.x) * 0.32, z: p.z + (q.z - p.z) * 0.32 },
          n = { x: p.x + (q.x - p.x) * 0.69, z: p.z + (q.z - p.z) * 0.69 };
        strip(marks, m, n, 0.045, 0.052);
      }
    }
  }
  for (const [values, color] of [
    [shoulders, '#74806e'],
    [surfaces, '#56645f'],
    [marks, '#d5d7bd'],
  ]) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(values, 3));
    geometry.computeVertexNormals();
    const material = world.mat(color, 0.04, 0.93);
    material.side = T.DoubleSide;
    const mesh = new T.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.userData.cameraIgnore = true;
    world.scene.add(mesh);
    world.roadMeshes.push(mesh);
  }
}
