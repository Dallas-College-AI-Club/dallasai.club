import * as T from '../vendor/three.module.js';
import { CITY_PLACES } from './places-data.js';
export function addCityPlaces(w) {
  w.cityModels = [];
  for (const p of CITY_PLACES) {
    const g = new T.Group();
    g.position.set(p.x, 0, p.z);
    g.name = p.name;
    g.userData.cityPlace = p;
    w.scene.add(g);
    w.cityModels.push(g);
    const stone = w.mat('#cabfa9', 0.05, 0.82),
      white = w.mat('#e0dfd4', 0.15, 0.5),
      dark = w.mat('#314549', 0.28, 0.53),
      glass = w.mat('#709a9d', 0.7, 0.16),
      brick = w.mat('#90624c', 0.02, 0.9),
      grass = w.mat('#63896a', 0, 0.97),
      gold = w.mat('#dca862', 0.55, 0.3);
    const solids = [];
    const box = (x, y, z, a, b, c, m = stone, solid = true) => {
      const o = w.box(x, y, z, a, b, c, m, g);
      if (solid) solids.push(o);
      return o;
    };
    const cylinder = (x, y, z, r, h, m = white, solid = true) => {
      const o = w.cylinder(x, y, z, r, h, m, g);
      if (solid) solids.push(o);
      return o;
    };
    const line = (points, mat = white, r = 0.045) => {
      const curve = new T.CatmullRomCurve3(points.map((v) => new T.Vector3(...v)));
      const m = new T.Mesh(
        new T.TubeGeometry(curve, Math.max(30, points.length * 5), r, 6, false),
        mat,
      );
      g.add(m);
      m.castShadow = true;
      return m;
    };
    const tree = (x, z, s = 1) => {
      cylinder(x, 0, z, 0.08 * s, 1.5 * s, brick);
      const crown = new T.Mesh(new T.IcosahedronGeometry(0.65 * s, 2), grass);
      crown.scale.set(1, 1.35, 0.85);
      crown.position.set(x, 1.7 * s, z);
      crown.castShadow = true;
      g.add(crown);
    };
    const windows = (width, rows, height, z, material = glass) => {
      for (let y = 0; y < rows; y++)
        for (let x = -width / 2 + 0.3; x < width / 2; x += 0.55)
          box(x, 0.35 + y * height, z, 0.29, 0.46, 0.04, material, false);
    };
    const grounds = (a, b) => box(0, -0.07, 0, a, 0.09, b, stone, false);
    if (p.model === 'perot') {
      grounds(5, 5);
      box(0, 0, 0, 2.8, 3.6, 2.6, stone);
      for (let y = 0.15; y < 3.6; y += 0.17)
        for (let x = -1.35; x < 1.4; x += 0.24)
          box(
            x,
            y,
            1.32,
            0.2,
            0.07 + (((Math.round(x * 10 + y * 10) % 3) + 3) % 3) * 0.025,
            0.035,
            white,
            false,
          );
      const escalator = box(0.15, 1.35, 1.58, 3.5, 0.4, 0.36, glass);
      escalator.rotation.z = 0.38;
      line(
        [
          [-1.45, 1.2, 1.79],
          [1.8, 2.5, 1.79],
        ],
        dark,
        0.04,
      );
      box(0, 0, -1.6, 4, 0.25, 1, stone);
    } else if (p.model === 'art') {
      grounds(5.4, 4);
      box(0, 0, 0, 4.6, 1.35, 2.7, stone);
      box(0, 1.35, -0.3, 1.65, 0.85, 2.1, white);
      box(0, 0, 1.39, 3, 0.88, 0.06, glass, false);
      for (const x of [-1.8, -1.2, -0.6, 0, 0.6, 1.2, 1.8]) cylinder(x, 0, 1.65, 0.07, 1.45, white);
      box(0, 1.45, 1.65, 4, 0.12, 0.52, white);
      for (const x of [-1.8, 1.8]) tree(x, -1.6, 0.65);
    } else if (p.model === 'brick') {
      box(0, 0, 0, 2.6, 3.15, 2.5, brick);
      windows(2.6, 6, 0.47, 1.27);
      box(0, 3.13, 0, 2.75, 0.12, 2.65, stone);
      for (let y = 0.05; y < 3; y += 0.47) box(0, y, 1.29, 2.65, 0.035, 0.025, stone, false);
    } else if (p.model === 'mall' || p.model === 'galleria') {
      grounds(15, 13);
      box(-5.5, 0, 0, 3, 1.6, 12, brick);
      box(5.5, 0, 0, 3, 1.6, 12, brick);
      box(0, 0, -4.5, 8, 1.6, 3, brick);
      box(0, 0, 4.5, 8, 1.6, 3, brick);
      box(0, 0.025, 0, 7.7, 0.04, 5.7, grass, false);
      for (const x of [-2.6, 2.6]) for (const z of [-1.8, 1.8]) tree(x, z, 0.8);
      if (p.model === 'galleria') {
        const roof = new T.Mesh(
          new T.CylinderGeometry(2.5, 2.5, 10, 24, 1, true, 0, Math.PI),
          glass,
        );
        roof.rotation.z = Math.PI / 2;
        roof.rotation.y = Math.PI / 2;
        roof.position.y = 2;
        g.add(roof);
        box(0, 0.08, 0, 3.7, 0.06, 6.2, w.mat('#adc8d0', 0.5, 0.14), false);
      }
      for (let i = -5; i < 6; i++) box(i, 1.1, 6.03, 0.7, 0.35, 0.03, glass, false);
    } else if (p.model === 'stadium' || p.model === 'bowl') {
      grounds(20, 15);
      const outer = new T.Shape(),
        inner = new T.Path();
      outer.absellipse(0, 0, 9, 6, 0, Math.PI * 2, false);
      inner.absellipse(0, 0, 6, 3.5, 0, Math.PI * 2, true);
      outer.holes.push(inner);
      const mesh = new T.Mesh(
        new T.ExtrudeGeometry(outer, {
          depth: 2,
          bevelEnabled: true,
          bevelThickness: 0.3,
          bevelSize: 0.3,
          bevelSegments: 3,
        }),
        white,
      );
      mesh.rotation.x = -Math.PI / 2;
      g.add(mesh);
      solids.push(mesh);
      box(0, 0.03, 0, 9, 0.06, 5, grass, false);
      for (const x of [-4, -2, 0, 2, 4]) box(x, 0.1, 0, 0.03, 0.01, 4.8, white, false);
      if (p.model === 'stadium') {
        for (const z of [-2, 2]) {
          line(
            Array.from({ length: 21 }, (_, i) => {
              const x = -9 + i * 0.9;
              return [x, 1 + 6 * Math.sqrt(Math.max(0, 1 - (x / 9) ** 2)), z];
            }),
            white,
            0.14,
          );
        }
        const roof = new T.Mesh(
          new T.SphereGeometry(1, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2),
          glass,
        );
        roof.scale.set(8.8, 4, 5.8);
        roof.position.y = 2;
        g.add(roof);
      }
    } else if (p.model === 'coaster') {
      grounds(28, 23);
      box(0, 0.01, 0, 25, 0.04, 20, grass, false);
      const points = Array.from({ length: 65 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return [Math.cos(a) * 10, 1.1 + 5.5 * (0.5 + 0.5 * Math.sin(a * 3)) ** 2, Math.sin(a) * 7];
      });
      line(points, w.mat('#db6853', 0.5, 0.3), 0.14);
      line(
        points.map((v) => [v[0], v[1] - 0.3, v[2]]),
        dark,
        0.09,
      );
      for (let i = 0; i < 64; i += 3) {
        const [x, y, z] = points[i];
        cylinder(x, 0, z, 0.08, y, white);
      }
      cylinder(-3, 0, 0, 0.35, 8, white);
      cylinder(-3, 7, 0, 1.3, 0.45, gold);
      cylinder(-3, 8, 0, 0.2, 1.5, white);
      for (let i = 0; i < 6; i++) {
        cylinder(-5 + i * 1.7, 0, 10, 0.055, 2.6, white);
        box(
          -4.6 + i * 1.7,
          2.2,
          10,
          0.8,
          0.42,
          0.04,
          w.mat(['#cb5b50', '#d7b447', '#547f9c'][i % 3], 0, 0.6),
          false,
        );
      }
      box(2, 0, 0, 3.5, 1.3, 2.5, brick);
      const car = box(points[0][0], points[0][1], points[0][2], 0.7, 0.4, 0.6, gold, false);
      p.animation = { mesh: car, points };
    } else if (p.model === 'music') {
      grounds(15, 12);
      box(0, 0, -2, 9, 3, 5, dark);
      const canopy = box(0, 3, -0.5, 11, 0.22, 7, white);
      canopy.rotation.z = -0.06;
      box(0, 0.25, 1.1, 7, 0.3, 3, brick);
      for (const x of [-4.5, 4.5]) cylinder(x, 0, 2, 0.1, 3, white);
      for (let i = 0; i < 5; i++)
        box(
          -3 + i * 1.5,
          1,
          -0.5,
          0.5,
          1.7,
          0.06,
          w.mat(['#9d8ec2', '#d8aa79', '#87b9a4'][i % 3], 0.3, 0.25),
          false,
        );
      for (const x of [-6, 6]) tree(x, 4, 1.2);
    } else {
      const garden = p.model === 'garden',
        zoo = p.model === 'zoo',
        size = garden || zoo ? 21 : 9;
      grounds(size, size * 0.72);
      box(0, 0.01, 0, size - 0.4, 0.035, size * 0.72 - 0.4, grass, false);
      box(0, 0.055, 0, size, 0.025, 0.7, stone, false);
      box(0, 0.055, 0, 0.7, 0.025, size * 0.72, stone, false);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        tree(Math.cos(a) * (size / 2 - 1), Math.sin(a) * (size * 0.36 - 1), 0.8 + (i % 3) * 0.16);
      }
      if (garden) {
        for (const x of [-5, 5])
          for (const z of [-3, 3]) {
            box(x, 0.06, z, 3.2, 0.17, 1.6, w.mat('#85745d', 0, 0.9));
            for (let i = 0; i < 12; i++) {
              const flower = new T.Mesh(
                new T.SphereGeometry(0.12, 7, 5),
                w.mat(['#e7c28b', '#c699af', '#e6e4d3'][i % 3], 0, 0.8),
              );
              flower.position.set(
                x - 1.3 + (i % 6) * 0.5,
                0.32,
                z - 0.45 + Math.floor(i / 6) * 0.7,
              );
              g.add(flower);
            }
          }
      }
      if (zoo) {
        box(-2, 0, 4, 0.25, 3, 0.25, stone);
        box(2, 0, 4, 0.25, 3, 0.25, stone);
        box(0, 2.7, 4, 4.5, 0.5, 0.3, brick);
        cylinder(-4, 0, -2, 0.45, 2.2, gold);
        cylinder(-3.65, 1, -2, 0.17, 3.5, gold);
        box(-3.4, 4, -2, 0.8, 0.3, 0.4, gold);
      } else {
        box(0, 0.06, 0, 2.3, 0.025, 1.7, w.mat('#6a9baf', 0.7, 0.13), false);
        box(2, 0, -2.3, 2.3, 1.6, 1.4, glass);
        box(2, 1.6, -2.3, 2.7, 0.16, 1.8, white);
      }
    }
    g.updateMatrixWorld(true);
    // Register all solid pieces, including poles and supports, in world coordinates.
    for (const mesh of solids) {
      const b = new T.Box3().setFromObject(mesh),
        s = b.getSize(new T.Vector3()),
        c = b.getCenter(new T.Vector3());
      w.obstacles.push({ x: c.x, z: c.z, w: s.x, d: s.z, place: p.id });
    }
  }
}
