import * as T from '../vendor/three.module.js';
// Original body kits echo the mascot silhouette; official logo artwork stays unchanged.
export const MASCOT_STYLE = {
  club: {
    paint: '#ed7653',
    trim: '#f0ece0',
    type: 'club',
    description: 'AI Club · warm copper body, pearl roof.',
  },
  brookhaven: {
    paint: '#719d43',
    trim: '#d5e2b0',
    type: 'bear',
    description: 'Bears · forest green, rounded roof ears and a broad front bumper.',
  },
  'cedar-valley': {
    paint: '#f5a824',
    trim: '#ce4827',
    type: 'sun',
    description: 'Suns · solar gold with a warm orange ray crest.',
  },
  eastfield: {
    paint: '#f09a36',
    trim: '#243745',
    type: 'bee',
    description: 'Harvester Bees · amber stripes, antennae and swept side wings.',
  },
  'el-centro': {
    paint: '#428fce',
    trim: '#d5e8ee',
    type: 'eagle',
    description: 'Eagles · sky blue with silver wing fenders.',
  },
  'mountain-view': {
    paint: '#4c72c5',
    trim: '#e7bd59',
    type: 'lion',
    description: 'Lions · royal blue with a gold mane around the roof.',
  },
  'north-lake': {
    paint: '#30a895',
    trim: '#dce6df',
    type: 'horse',
    description: 'Blazers · jade green, upright ears and a swept mane.',
  },
  richland: {
    paint: '#9771c4',
    trim: '#e4c14e',
    type: 'duck',
    description: 'Thunderducks · violet, a gold bill bumper and a green crest.',
  },
};
export function mascotBody(id, paint) {
  const style = MASCOT_STYLE[id] || MASCOT_STYLE.club,
    g = new T.Group();
  g.name = 'Mascot body · ' + style.type;
  const trim = new T.MeshStandardMaterial({ color: style.trim, metalness: 0.38, roughness: 0.32 }),
    dark = new T.MeshStandardMaterial({ color: '#24333a', metalness: 0.25, roughness: 0.4 });
  const mesh = (geo, mat, x, y, z) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const ball = (x, y, z, r, mat = trim) => mesh(new T.SphereGeometry(r, 20, 12), mat, x, y, z);
  const box = (x, y, z, w, h, d, mat = trim) => mesh(new T.BoxGeometry(w, h, d), mat, x, y, z);
  const fin = (x, y, z, w, h, d, angle = 0, mat = trim) => {
    const shape = new T.Shape();
    shape.moveTo(-w / 2, 0);
    shape.quadraticCurveTo(-w * 0.2, h, w * 0.25, h);
    shape.lineTo(w / 2, 0);
    shape.closePath();
    const m = mesh(
      new T.ExtrudeGeometry(shape, {
        depth: d,
        bevelEnabled: true,
        bevelSize: 0.025,
        bevelThickness: 0.025,
        bevelSegments: 2,
      }),
      mat,
      x,
      y,
      z,
    );
    m.rotation.y = angle;
    return m;
  };
  if (style.type === 'bear') {
    for (const x of [-0.49, 0.49]) {
      ball(x, 1.49, -0.4, 0.2, paint);
      ball(x, 1.5, -0.24, 0.12, dark);
    }
    const bumper = ball(0, 0.67, 1.35, 0.42);
    bumper.scale.set(1.45, 0.35, 0.35);
    bumper.userData.chassis = true;
  }
  if (style.type === 'sun') {
    for (let i = -2; i <= 2; i++) {
      const ray = fin(i * 0.22, 1.39, -0.18, 0.16, 0.2 + (2 - Math.abs(i)) * 0.07, 0.065);
      ray.rotation.z = -i * 0.2;
    }
  }
  if (style.type === 'bee') {
    for (const z of [-0.52, -0.1, 0.31]) box(0, 1.415, z, 1.29, 0.025, 0.13, dark);
    for (const x of [-0.4, 0.4]) {
      const stem = mesh(new T.CylinderGeometry(0.016, 0.016, 0.37, 8), dark, x, 1.52, 0.34);
      stem.rotation.z = -x * 0.35;
      ball(x, 1.73, 0.34, 0.055);
    }
    for (const x of [-1, 1]) {
      const wing = ball(
        x * 0.86,
        1.04,
        -0.28,
        0.34,
        new T.MeshPhysicalMaterial({
          color: '#daece8',
          transparent: true,
          opacity: 0.65,
          roughness: 0.15,
          metalness: 0.25,
          side: T.DoubleSide,
        }),
      );
      wing.scale.set(0.25, 0.2, 1.2);
      wing.rotation.y = x * 0.45;
    }
  }
  if (style.type === 'eagle') {
    for (const x of [-1, 1]) {
      const wing = fin(x * 0.82, 0.84, -0.5, 0.9, 0.25, 0.055, (x * Math.PI) / 2);
      wing.rotation.z = x * 0.22;
    }
    fin(0, 0.89, 0.84, 0.33, 0.19, 0.17);
  }
  if (style.type === 'lion') {
    for (let i = 0; i < 11; i++) {
      const a = (i / 10) * Math.PI * 1.65 + 0.55;
      const mane = ball(Math.cos(a) * 0.63, 1.27, -0.12 + Math.sin(a) * 0.57, 0.135);
      mane.scale.y = 0.8;
    }
    for (const x of [-0.43, 0.43]) ball(x, 1.46, 0.35, 0.13, paint);
  }
  if (style.type === 'horse') {
    for (const x of [-0.38, 0.38]) fin(x, 1.37, 0.3, 0.18, 0.34, 0.09, 0, paint);
    for (let i = 0; i < 5; i++)
      fin(0, 1.39, 0.18 - i * 0.21, 0.09, 0.25 - i * 0.025, 0.17, 0, dark);
  }
  if (style.type === 'duck') {
    const bill = ball(0, 0.68, 1.35, 0.45);
    bill.scale.set(1.5, 0.2, 0.8);
    bill.userData.chassis = true;
    for (let i = 0; i < 3; i++)
      fin(
        -0.16 + i * 0.16,
        1.4,
        -0.25,
        0.14,
        0.2 + i * 0.07,
        0.12,
        0,
        new T.MeshStandardMaterial({ color: '#537c53', roughness: 0.5 }),
      );
  }
  return g;
}
