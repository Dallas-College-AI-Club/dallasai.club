import * as T from '../vendor/three.module.js';

export const BUILDINGS = {
  brookhaven: 'Early College Center · Building V',
  'cedar-valley': 'Student Engagement Center',
  eastfield: 'Student Success Center',
  'el-centro': 'El Centro campus entrance',
  'mountain-view': 'Student Center · S Building',
  'north-lake': 'Library · L Building',
  richland: 'Sabine Hall',
};

// Original, reference-led architectural models. Repeated facade pieces are instanced.
class ArchitectureKit {
  constructor(world, parent) {
    this.w = world;
    this.parent = parent;
    this.batches = new Map();
    this.materials = {};
  }
  material(name, color, metalness = 0.05, roughness = 0.8) {
    return (this.materials[name] ??= new T.MeshStandardMaterial({ color, metalness, roughness }));
  }
  brick(name, color) {
    const m = this.material(name, color);
    if (m.map) return m;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const g = canvas.getContext('2d');
    g.fillStyle = '#514d44';
    g.fillRect(0, 0, 512, 256);
    let seed = 27;
    for (let y = 0; y < 16; y++)
      for (let x = -1; x < 9; x++) {
        seed = (seed * 16807) % 2147483647;
        g.fillStyle = `hsl(30 9% ${62 + (seed % 16)}%)`;
        g.fillRect(x * 64 + (y % 2) * 32 + 1, y * 16 + 1, 62, 14);
      }
    const texture = new T.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.colorSpace = T.SRGBColorSpace;
    m.map = texture;
    m.bumpMap = texture;
    m.bumpScale = 0.018;
    return m;
  }
  box(x, y, z, w, h, d, material, ry = 0) {
    if (!this.batches.has(material)) this.batches.set(material, []);
    const o = new T.Object3D();
    o.position.set(x, y + h / 2, z);
    o.scale.set(w, h, d);
    o.rotation.y = ry;
    o.updateMatrix();
    this.batches.get(material).push(o.matrix.clone());
  }
  mesh(geometry, material, x = 0, y = 0, z = 0) {
    return this.w.mesh(geometry, material, x, y, z, this.parent);
  }
  cylinder(x, y, z, r, h, m) {
    return this.w.cylinder(x, y, z, r, h, m, this.parent);
  }
  sign(text, x, y, z, w = 5, h = 0.46) {
    const sign = this.w.label([text], w, h, '#253637', '#e6e5d9');
    sign.position.set(x, y, z);
    this.parent.add(sign);
  }
  glazing(x, y, z, w, h, cols, rows = 2) {
    const glass = this.material('glass', '#597d8a', 0.82, 0.16),
      frame = this.material('frame', '#b9c2bf', 0.6, 0.35);
    this.box(x, y, z, w, h, 0.08, glass);
    for (let i = 0; i <= cols; i++)
      this.box(x - w / 2 + (w * i) / cols, y, z + 0.06, 0.04, h, 0.09, frame);
    for (let j = 0; j <= rows; j++) this.box(x, y + (h * j) / rows, z + 0.06, w, 0.04, 0.09, frame);
  }
  finish() {
    for (const [mat, transforms] of this.batches) {
      const mesh = new T.InstancedMesh(this.w.boxGeo, mat, transforms.length);
      transforms.forEach((t, i) => mesh.setMatrixAt(i, t));
      mesh.castShadow = mesh.receiveShadow = true;
      this.parent.add(mesh);
    }
  }
}

export function addCampusArchitecture(world, c) {
  const group = new T.Group();
  group.name = c.name + ' — ' + BUILDINGS[c.id];
  group.position.set(c.x, 0, c.z - 12);
  world.scene.add(group);
  const k = new ArchitectureKit(world, group),
    B = k.box.bind(k),
    stone = k.material('stone', '#c4c1b4'),
    silver = k.material('silver', '#b4bfbd', 0.55, 0.35),
    dark = k.material('dark', '#303f41', 0.55, 0.35),
    brick = k.brick('brick', '#ad7958'),
    white = k.material('white', '#d1d6d3');
  B(0, -0.02, 0, 23, 0.18, 11, k.material('paving', '#93998a'));
  // Three shallow steps and an accessible flat approach alongside each forecourt.
  for (let i = 0; i < 3; i++) B(0, i * 0.09, 5.2 - i * 0.35, 10, 0.09, 1.3, stone);
  if (c.id === 'brookhaven') {
    // Glenn Partners photograph: long low west wing, recessed court, solid east cantilever.
    B(-5.6, 0, -0.6, 10.5, 5.7, 5.8, brick);
    B(7.1, 0, -0.3, 6.4, 2.1, 5.7, k.material('ochre', '#b9894b'));
    B(7.4, 2.1, 0.1, 6.8, 4.9, 6.2, brick);
    B(1.5, 0, -2.4, 4.5, 5.2, 2.2, dark);
    k.glazing(-7.8, 0.1, 2.34, 5.3, 5.1, 9, 2);
    k.glazing(1.45, 0.2, -1.2, 4.3, 4.8, 7, 2);
    k.glazing(4.1, 0.1, 3.23, 1, 6.4, 2, 3);
    k.glazing(9.4, 3.6, 3.25, 0.66, 2.5, 1, 1);
    const wedge = new T.Shape();
    wedge.moveTo(-10.4, 0);
    wedge.lineTo(-10.4, 1.5);
    wedge.lineTo(-6.7, 3.4);
    wedge.lineTo(-5.2, 3.4);
    wedge.lineTo(-5.2, 0);
    wedge.closePath();
    k.mesh(new T.ExtrudeGeometry(wedge, { depth: 0.13, bevelEnabled: false }), brick, 0, 0, 2.42);
    for (let i = 0; i < 5; i++) k.glazing(-4.7 + i * 0.88, 0.2, 2.34, 0.16, 4.5, 1, 1);
    B(-5.5, 5.75, -0.4, 11.2, 0.24, 6.5, dark);
    B(1.1, 5.1, -1.2, 5.4, 0.2, 4.5, dark);
    B(-5.4, 6.02, -1.8, 5.8, 0.7, 2.4, dark);
    for (let i = 0; i < 18; i++) B(3.05, i * 0.16, 4.5 - i * 0.22, 1.45, 0.16, 0.24, stone);
    for (const x of [2.28, 3.8]) {
      B(x, 0, 2.6, 0.04, 3, 0.04, silver);
      B(x, 2.8, 1.8, 0.04, 0.04, 3.8, silver);
    }
    k.sign('EARLY COLLEGE CENTER', -4.5, 5.35, 2.54, 4.8, 0.34);
  }
  if (c.id === 'cedar-valley') {
    const red = k.material('red', '#9f2532', 0.2, 0.43),
      panel = k.material('panel', '#989ea9', 0.25, 0.5),
      seam = k.material('seam', '#626873', 0.2, 0.7);
    B(-7.8, 0, -1.5, 5.3, 5.45, 4.8, white);
    B(-3.5, 0, -0.8, 4.4, 4.4, 5.5, panel);
    B(6.1, 0, -1, 8.5, 5.1, 5.8, panel);
    k.glazing(-3.5, 0.12, 1.99, 4.3, 3.15, 7, 1);
    k.glazing(6.1, 0.12, 1.94, 8.3, 3.3, 12, 1);
    for (let row = 0; row < 16; row++)
      for (let col = 0; col < 8; col++)
        B(
          -10.1 + col * 0.65,
          row * 0.34,
          0.94,
          0.64,
          0.31,
          0.06,
          [panel, white, red, white, seam, white][(row * 3 + col * 7) % 6],
        );
    B(-0.7, 0, 2.1, 0.66, 7, 2.1, red);
    B(2.9, 0, 2.1, 0.66, 7, 2.1, red);
    B(1.1, 6.42, 2.1, 4.25, 0.58, 2.1, red);
    B(2.7, 0, 0.15, 1.05, 7, 4, red);
    k.glazing(1.1, 0.12, 2.84, 2.85, 6.18, 4, 3);
    B(1.1, 2.5, 3.5, 3.65, 0.18, 1.5, silver);
    k.glazing(1.3, 0.05, 2.95, 1.65, 2.4, 3, 1);
    for (let y = 0.35; y < 7; y += 0.43) {
      B(-0.7, y, 3.17, 0.66, 0.018, 0.025, seam);
      B(2.9, y, 3.17, 0.66, 0.018, 0.025, seam);
    }
    for (let y = 3.4; y < 5.1; y += 0.43) B(6.1, y, 1.96, 8.4, 0.018, 0.025, seam);
    B(-3.5, 4.4, -0.8, 4.5, 0.08, 5.6, silver);
    B(6.1, 5.1, -1, 8.6, 0.08, 5.9, silver);
    B(1.1, 7.02, 2.1, 4.4, 0.08, 2.2, silver);
  }
  if (c.id === 'eastfield') {
    B(0, 1.8, -0.5, 21, 4.8, 6.5, stone);
    k.glazing(0, 1.85, 2.8, 20.7, 3.65, 30, 2);
    B(0, 5.55, 2.88, 21, 1.15, 0.24, k.material('cladding', '#889697', 0.3, 0.5));
    for (let i = 0; i <= 36; i++) B(-10.5 + (i * 21) / 36, 1.4, 3.22, 0.095, 5.35, 1.02, silver);
    B(0, 6.7, -0.1, 21.5, 0.16, 7.1, white);
    B(5.5, 0, -1.1, 7.7, 1.8, 4.6, stone);
    B(-5.8, 0, -0.5, 0.6, 1.8, 6, stone);
    k.glazing(2, 0.1, 3.1, 3.5, 1.7, 4, 1);
    for (let i = 0; i < 6; i++) B(-8.3 + i * 0.8, 1.8 - i * 0.24, 1.8, 0.84, 0.25, 2.2, stone);
    k.sign('STUDENT SUCCESS CENTER', 0, 7.18, 2.95, 7, 0.45);
  }
  if (c.id === 'el-centro') {
    // Official 900 px entrance photograph; building letter is not asserted.
    const tan = k.brick('tan', '#b4a185'),
      blue = k.material('entryGlass', '#244d74', 0.75, 0.19);
    B(-4, 0, -1.5, 10, 8.8, 5.2, tan);
    B(5.7, 0, -2.5, 4.8, 13, 4.2, tan);
    B(5.7, 12.9, -2.5, 5, 0.18, 4.4, stone);
    for (let row = 0; row < 3; row++) {
      k.glazing(-4, 1 + row * 2.7, 1.17, 8.7, 1.65, 9, 1);
    }
    for (const y of [0, 2.65, 5.4, 8.1]) k.cylinder(2.4, y, 1, 2.8, 0.75, tan);
    for (const y of [0.75, 3.4, 6.15]) k.cylinder(2.4, y, 1, 2.79, 1.9, blue);
    k.cylinder(2.4, 8.85, 1, 2.86, 0.2, stone);
    for (const a of [-1.15, -0.55, 0.15, 0.85, 1.55]) {
      const x = 2.4 + Math.sin(a) * 2.93,
        z = 1 + Math.cos(a) * 2.93;
      B(x, 0, z, 0.24, 9.25, 0.38, stone, a);
    }
    for (const x of [-8.6, -5, -1.5]) B(x, 0, 1.48, 0.22, 8.8, 0.32, stone);
    B(2.4, 2.05, 4, 5.2, 0.16, 1.5, dark);
    k.glazing(2.4, 0.08, 3.7, 2.3, 1.93, 3, 1);
    k.sign('EL CENTRO', 2.4, 2.45, 4.79, 4.3, 0.4);
    for (const x of [-7.5, -4.3, -1.1]) {
      k.cylinder(x, 0, 5.4, 0.04, 8.6, silver);
      B(
        x + 0.4,
        6.2,
        5.4,
        0.75,
        1.25,
        0.025,
        k.material('flag' + x, x < -6 ? '#bf5560' : x < -3 ? '#e8e7db' : '#4b709f'),
      );
    }
    for (let row = 0; row < 6; row++)
      for (let col = 0; col < 3; col++)
        k.glazing(4.3 + col * 1.25, 1 + row * 1.85, -0.36, 0.7, 1.35, 1, 1);
  }
  if (c.id === 'mountain-view') {
    const limestone = k.brick('limestone', '#b9ac8a');
    B(0, 0, -0.1, 19, 2.4, 7.5, limestone);
    for (let tier = 0; tier < 3; tier++) {
      const w = 18 - tier * 4.1,
        d = 7.5 - tier * 0.7,
        y = 2.2 + tier * 1.65;
      B(0, y, -tier * 0.38, w, 1.35, d, dark);
      k.glazing(0, y + 0.05, d / 2 - tier * 0.38 + 0.04, w - 0.2, 1.22, Math.round(w * 2), 1);
      B(0, y + 1.35, -tier * 0.38, w + 1.9, 0.2, d + 1.45, white);
    }
    B(1.4, 0, 3.9, 1, 8, 2, limestone);
    B(0, 1, 5, 17, 0.15, 2.3, white);
    for (let i = 0; i < 28; i++) B(-8.4 + i * 0.62, 1.14, 6, 0.035, 0.6, 0.035, silver);
    B(0, 1.74, 6, 17, 0.04, 0.05, silver);
    for (const x of [-0.75, 0.75])
      for (const z of [-0.75, 0.75]) B(x + 3.2, 7.1, z - 1.7, 0.12, 7.1, 0.12, silver);
    for (let i = 0; i < 5; i++) {
      B(3.2, 8 + i * 1.15, -1.7, 1.6, 0.07, 1.6, silver);
      B(3.2, 8 + i * 1.15, -0.9, 1.55, 0.045, 0.06, silver);
    }
    B(3.2, 14.3, -1.7, 2.1, 0.12, 2.1, white);
    B(3.2, 11.3, -0.83, 1.55, 1.65, 0.07, dark);
    k.sign('DALLAS', 3.2, 12.15, -0.76, 1.35, 0.3);
    k.sign('MOUNTAIN VIEW', 0, 2.05, 6.18, 5.7, 0.45);
  }
  if (c.id === 'north-lake') {
    const brown = k.brick('brown', '#927151');
    B(-4, 0, -0.7, 11, 7.2, 6.8, brown);
    B(2, 0, -1, 8, 6.5, 6.3, brown);
    k.glazing(-5.5, 5.7, 2.78, 6, 0.64, 8, 1);
    k.glazing(-4.8, 1.4, 2.8, 3.5, 2.9, 5, 2);
    B(-4, 6.1, 3.5, 11, 0.14, 2.2, silver);
    for (let i = 0; i < 28; i++) B(-9.5 + i * 0.4, 6.25, 3.5, 0.1, 0.08, 2.2, silver);
    // Curved brick and green-glass bay, with radial mullions.
    const green = k.material('greenGlass', '#618b70', 0.82, 0.18);
    k.cylinder(6, 0, 0.7, 4, 2.35, brown);
    k.cylinder(6, 2.35, 0.7, 3.96, 1.85, green);
    k.cylinder(6, 4.2, 0.7, 4, 2.93, brown);
    k.cylinder(6, 7.13, 0.7, 4.08, 0.16, stone);
    for (let i = 0; i < 40; i++) {
      const a = (i * Math.PI * 2) / 40;
      B(6 + Math.sin(a) * 4, 2.3, 0.7 + Math.cos(a) * 4, 0.055, 1.95, 0.055, silver);
    }
    for (const y of [3.28]) {
      const tor = new T.Mesh(new T.TorusGeometry(4, 0.035, 5, 64), silver);
      tor.rotation.x = Math.PI / 2;
      tor.position.set(6, y, 0.7);
      group.add(tor);
    }
    B(-7.7, 4.5, 2.86, 0.9, 0.9, 0.08, k.material('letterRed', '#b73f34'));
    k.sign('L', -7.7, 4.95, 2.92, 0.67, 0.67);
    k.sign('LIBRARY', -3, 6.85, 2.89, 3, 0.48);
  }
  if (c.id === 'richland') {
    B(-7, 0, -1.7, 7, 7, 5.7, stone);
    B(7, 0, -1.7, 7, 7.4, 5.7, stone);
    B(0, 0, -2, 7, 8.5, 5.5, dark);
    k.glazing(0, 0.2, 0.8, 7, 8, 9, 4);
    for (const x of [-4, 4]) B(x, 0, 3.7, 0.3, 6.7, 0.3, silver);
    B(0, 6.5, 2.4, 11, 0.22, 4.7, silver);
    for (let i = 0; i < 36; i++) B(-5.4 + i * 0.31, 6.74, 2.4, 0.12, 0.14, 4.9, white);
    for (const x of [-2.7, 2.7]) B(x, 0, 1.05, 0.16, 7.9, 0.8, silver);
    for (const x of [-4.8, 4.8]) {
      B(x, 0, 5.4, 0.6, 0.95, 0.6, stone);
      world.sphere(c.x + x, 0.43, c.z - 6.6, 0.43, stone);
      world.sphere(c.x + x, 1.16, c.z - 6.6, 0.32, stone);
    }
    k.glazing(-7, 0.4, 1.18, 5.8, 5.8, 7, 3);
    k.glazing(7, 0.4, 1.18, 5.8, 6.2, 7, 3);
    k.sign('SABINE HALL', 0, 5.98, 4.81, 4.3, 0.48);
  }
  k.finish();
  const collisionBounds = new T.Box3().setFromObject(group),
    collisionCenter = collisionBounds.getCenter(new T.Vector3()),
    collisionSize = collisionBounds.getSize(new T.Vector3());
  world.obstacles.push({
    x: collisionCenter.x,
    z: collisionCenter.z,
    w: collisionSize.x,
    d: collisionSize.z,
  });
  return group;
}
