import * as T from '../vendor/three.module.js';
import { LANDMARKS } from './landmarks.js';
export function addLandmarks(world) {
  for (const item of LANDMARKS) {
    const g = new T.Group();
    g.position.set(item.x, 0, item.z);
    g.name = item.name;
    world.scene.add(g);
    const concrete = world.mat('#c1bca9', 0.04, 0.8),
      glass = world.mat('#547580', 0.75, 0.23),
      steel = world.mat('#d2dad9', 0.75, 0.25),
      light = new T.MeshStandardMaterial({
        color: '#96d3af',
        emissive: '#65b88c',
        emissiveIntensity: 0.7,
      });
    const box = (x, y, z, w, h, d, m) => world.box(x, y, z, w, h, d, m, g),
      cyl = (x, y, z, r, h, m) => world.cylinder(x, y, z, r, h, m, g);
    const polygon = (points, height, y, mat) => {
      const shape = new T.Shape(points.map(([x, z]) => new T.Vector2(x, -z))),
        m = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    };
    if (item.id === 'reunion') {
      const h = item.heightMeters / 22.264;
      for (let i = 0; i < 3; i++) {
        const a = i * 2.094,
          x = Math.sin(a) * 0.21,
          z = Math.cos(a) * 0.21;
        cyl(x, 0, z, 0.12, h - 0.8, concrete);
        for (let y = 0.15; y < h - 1; y += 0.2) cyl(x, y, z, 0.123, 0.024, steel);
      }
      cyl(0, 0, 0, 0.09, h - 0.55, glass);
      cyl(0, h - 1.15, 0, 0.56, 0.64, glass);
      for (const y of [h - 1.15, h - 0.8, h - 0.52]) cyl(0, y, 0, 0.57, 0.05, steel);
      const geo = new T.IcosahedronGeometry(0.76, 2),
        wire = new T.LineSegments(
          new T.WireframeGeometry(geo),
          new T.LineBasicMaterial({ color: '#e8e1c2' }),
        );
      wire.position.y = h - 0.76;
      g.add(wire);
      const dots = new T.Points(geo, new T.PointsMaterial({ color: '#fff0c8', size: 0.025 }));
      dots.position.y = h - 0.76;
      g.add(dots);
      world.obstacles.push({ x: item.x, z: item.z, w: 1.6, d: 1.6 });
    } else if (item.id === 'plaza') {
      const h = item.heightMeters / 22.264;
      polygon(item.footprint, h - 0.55, 0, glass);
      const top = item.footprint.map(([x, z]) => [x * 0.85, z * 0.85]);
      polygon(top, 0.55, h - 0.55, glass);
      const lines = [];
      for (let y = 0.15; y < h - 0.5; y += h / 72)
        for (let i = 0; i < item.footprint.length; i++) {
          const p = item.footprint[i],
            q = item.footprint[(i + 1) % item.footprint.length];
          lines.push(
            new T.Vector3(p[0] * 1.004, y, p[1] * 1.004),
            new T.Vector3(q[0] * 1.004, y, q[1] * 1.004),
          );
        }
      g.add(
        new T.LineSegments(
          new T.BufferGeometry().setFromPoints(lines),
          new T.LineBasicMaterial({ color: '#9cacb0', transparent: true, opacity: 0.5 }),
        ),
      );
      for (let i = 0; i < item.footprint.length; i += 4) {
        const [x, z] = item.footprint[i];
        box(x, 0, z, 0.025, h - 0.55, 0.025, light);
      }
      for (const [points, y] of [
        [item.footprint, h - 0.55],
        [top, h],
      ]) {
        const line = new T.LineLoop(
          new T.BufferGeometry().setFromPoints(points.map(([x, z]) => new T.Vector3(x, y, z))),
          new T.LineBasicMaterial({ color: '#88eab0' }),
        );
        g.add(line);
      }
      world.obstacles.push({ x: item.x, z: item.z, w: 2.55, d: 2.9 });
    } else if (item.id === 'city-hall') {
      g.rotation.y = item.rotation;
      const profile = new T.Shape();
      profile.moveTo(-1.05, 0);
      profile.lineTo(0.45, 0);
      profile.lineTo(1.3, 1.65);
      profile.lineTo(-1.05, 1.65);
      profile.closePath();
      const m = new T.Mesh(
        new T.ExtrudeGeometry(profile, { depth: 7.65, bevelEnabled: false }),
        concrete,
      );
      m.rotation.y = Math.PI / 2;
      m.position.x = -3.825;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      for (let row = 0; row < 7; row++) {
        const y = 0.12 + row * 0.22,
          z = -(0.45 + (y / 1.65) * 0.85);
        box(0, y, z - 0.014, 7.45, 0.08, 0.02, glass);
      }
      for (const x of [-2.5, 0, 2.5]) box(x, 0, -0.48, 0.25, 1.15, 0.6, concrete);
      cyl(0, -0.02, -4, 1.55, 0.035, world.mat('#587f98', 0.5, 0.15));
      world.obstacles.push({ x: item.x, z: item.z, w: 7.8, d: 2.65, yaw: item.rotation });
    } else if (item.id === 'bridge') {
      polygon(item.footprint, 0.14, 0.1, concrete);
      let edge = null;
      for (let i = 0; i < item.footprint.length; i++) {
        const a = item.footprint[i],
          b = item.footprint[(i + 1) % item.footprint.length],
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          d = Math.hypot(dx, dz);
        if (!edge || d > edge.d) edge = { dx, dz, d };
      }
      const frame = new T.Group();
      frame.rotation.y = Math.atan2(-edge.dz, edge.dx);
      g.add(frame);
      const points = [];
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        points.push(new T.Vector3(0, 0.26 + 6.1 * 4 * t * (1 - t), -1.7 + 3.4 * t));
      }
      const arch = new T.Mesh(
        new T.TubeGeometry(new T.CatmullRomCurve3(points), 80, 0.07, 10, false),
        steel,
      );
      arch.castShadow = true;
      frame.add(arch);
      const cables = [];
      for (let i = 1; i <= 29; i++)
        for (const sign of [-1, 1]) {
          const t = 0.12 + i * 0.012;
          cables.push(
            new T.Vector3(sign * i * 0.41, 0.25, sign * 0.72),
            new T.Vector3(0, 0.26 + 6.1 * 4 * t * (1 - t), sign * (1.7 - 3.4 * t)),
          );
        }
      frame.add(
        new T.LineSegments(
          new T.BufferGeometry().setFromPoints(cables),
          new T.LineBasicMaterial({ color: '#dbe3e1' }),
        ),
      );
    }
    if (item.id === 'bridge') {
      g.updateMatrixWorld(true);
      const frame = g.children.find((child) => child.isGroup);
      for (const side of [-1, 1]) {
        const foot = frame.localToWorld(new T.Vector3(0, 0, side * 1.7));
        world.obstacles.push({ x: foot.x, z: foot.z, w: 0.15, d: 0.15 });
      }
    }
    const label = world.label(
      [item.name.toUpperCase()],
      item.id === 'bridge' ? 4.8 : 3.5,
      0.32,
      '#233f47',
      '#e4ede7',
    );
    label.position.set(item.x, 0.85, item.z + 2);
    world.scene.add(label);
  }
}
