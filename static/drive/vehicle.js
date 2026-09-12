import { drawFlagPreview } from './flag-preview.js';
import { MASCOT_STYLE, mascotBody } from './mascot.js';
import * as T from '../vendor/three.module.js';
export const MASCOTS = [
  ['club', 'AI Club'],
  ['brookhaven', 'Brookhaven · Bears'],
  ['cedar-valley', 'Cedar Valley · Suns'],
  ['eastfield', 'Eastfield · Harvester Bees'],
  ['el-centro', 'El Centro · Eagles'],
  ['mountain-view', 'Mountain View · Lions'],
  ['north-lake', 'North Lake · Blazers'],
  ['richland', 'Richland · Thunderducks'],
];

export const VEHICLES = [
  { id: 'hatch', name: 'City hatch', length: 2.5, cabin: 1.25, cabinZ: -0.16, roof: 1.35 },
  { id: 'buggy', name: 'Trail buggy', length: 2.3, cabin: 1.1, cabinZ: -0.1, roof: 1.44 },
  { id: 'pickup', name: 'Mini pickup', length: 2.8, cabin: 0.95, cabinZ: 0.48, roof: 1.4 },
  { id: 'van', name: 'Campus van', length: 2.7, cabin: 2.05, cabinZ: -0.05, roof: 1.9 },
  { id: 'rally', name: 'Rally coupe', length: 2.65, cabin: 1.15, cabinZ: -0.15, roof: 1.16 },
];
export function randomVehicle(previous, random = Math.random) {
  const options = VEHICLES.filter((v) => v.id !== previous);
  return options[Math.floor(random() * options.length) % options.length];
}
export function makeVehicle(world, { shuffle = false } = {}) {
  let choice = { mascot: 'club' };
  try {
    const saved = JSON.parse(localStorage.getItem('dc-drive-car') || '{}');
    choice.mascot = saved.mascot || 'club';
    choice.vehicle = saved.vehicle;
  } catch {
    // Vehicle choices still work when browser storage is unavailable.
  }
  const type =
    (!shuffle && VEHICLES.find((v) => v.id === choice.vehicle)) || randomVehicle(choice.vehicle);
  choice.vehicle = type.id;
  if (world.rover) {
    world.scene.remove(world.rover);
    world.rover.traverse((o) => {
      if (o.geometry && o.geometry !== world.boxGeo && o.geometry !== world.sphereGeo)
        o.geometry.dispose();
    });
  }

  const g = new T.Group();
  g.scale.setScalar(0.7);
  world.rover = g;
  world.scene.add(g);
  world.wheels = [];
  world.steeringWheels = [];
  const paint = new T.MeshPhysicalMaterial({
      color: MASCOT_STYLE.club.paint,
      metalness: 0.42,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
    }),
    white = world.mat('#e9e9df', 0.45, 0.25),
    dark = world.mat('#18262e', 0.25, 0.55),
    glass = world.mat('#284756', 0.7, 0.12);
  world.carPaint = paint;
  const rounded = (w, d, h, y, mat, bevel = 0.1) => {
    const shape = new T.Shape();
    shape.moveTo(-w / 2, -d / 2);
    shape.lineTo(w / 2, -d / 2);
    shape.lineTo(w / 2, d / 2);
    shape.lineTo(-w / 2, d / 2);
    shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, {
      depth: h,
      bevelEnabled: true,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 3,
      steps: 1,
      curveSegments: 8,
    });
    geo.rotateX(-Math.PI / 2);
    const m = new T.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  rounded(1.55, type.length, 0.3, 0.4, paint, 0.12);
  rounded(1.48, type.length - 0.15, 0.11, 0.31, dark, 0.05);
  const cabin = rounded(1.28, type.cabin, type.roof - 0.87, 0.83, glass, 0.07);
  cabin.position.z = type.cabinZ;
  if (type.id === 'buggy') cabin.visible = false;
  const roof = rounded(1.33, type.cabin + 0.05, 0.05, type.roof, white.clone(), 0.06);
  roof.position.z = type.cabinZ;
  const box = (x, y, z, w, h, d, m) => world.box(x, y, z, w, h, d, m, g),
    front = type.length / 2 + 0.1;
  for (const x of [-0.69, 0.69]) {
    for (const z of [type.cabinZ - type.cabin / 2, type.cabinZ + type.cabin / 2])
      box(x, 0.85, z, 0.065, type.roof - 0.83, 0.065, paint);
    box(x, 0.73, type.cabinZ, 0.04, 0.09, type.cabin, paint);
    box(x * 1.13, 1.01, type.cabinZ + type.cabin / 2, 0.18, 0.12, 0.2, dark);
  }
  box(0, 0.6, front, 1.5, 0.15, 0.12, dark);
  box(0, 0.49, -front, 1.55, 0.12, 0.13, white);
  if (type.id === 'pickup') {
    box(0, 0.76, -0.83, 1.28, 0.07, 0.8, dark);
    for (const x of [-0.67, 0.67]) box(x, 0.77, -0.82, 0.09, 0.32, 1, paint);
    box(0, 0.77, -1.3, 1.35, 0.32, 0.08, paint);
  }
  if (type.id === 'buggy') {
    for (const x of [-0.38, 0.38]) {
      box(x, 0.7, -0.2, 0.39, 0.12, 0.5, dark);
      box(x, 0.75, -0.4, 0.39, 0.48, 0.1, dark);
    }
    for (const x of [-0.58, 0.58]) box(x, 0.79, 0.68, 0.065, 0.57, 0.065, white);
    box(0, 1.28, 0.68, 1.16, 0.05, 0.07, white);
  }
  if (type.id === 'van') {
    for (const x of [-0.68, 0.68]) {
      box(x, 0.86, -0.55, 0.045, 0.4, 0.92, paint);
      box(x, 1.35, -0.68, 0.05, 0.45, 0.55, glass);
      box(x, 1.12, 0.05, 0.055, 0.03, 0.16, white);
    }
  }
  if (type.id === 'rally') {
    for (const x of [-0.53, 0.53]) box(x, 0.78, -1.1, 0.06, 0.35, 0.09, dark);
    box(0, 1.11, -1.1, 1.7, 0.09, 0.32, paint);
    for (const x of [-0.25, 0.25]) box(x, 0.815, 0.94, 0.12, 0.02, 0.58, white);
  }
  const frontLight = new T.MeshStandardMaterial({
      color: '#fffbef',
      emissive: '#fff6d9',
      emissiveIntensity: 1.5,
    }),
    tail = new T.MeshStandardMaterial({
      color: '#f34535',
      emissive: '#e3241b',
      emissiveIntensity: 0.6,
    });
  for (const x of [-0.51, 0.51]) {
    box(x, 0.72, front, 0.35, 0.11, 0.03, frontLight);
    box(x, 0.68, -front, 0.31, 0.1, 0.04, tail);
  }
  box(0, 0.73, front, 0.3, 0.025, 0.03, white);
  for (const x of [-0.91, 0.91])
    for (const z of [-0.82, 0.82]) {
      const pivot = new T.Group();
      pivot.position.set(x, 0.4, z);
      g.add(pivot);
      const spin = new T.Group();
      pivot.add(spin);
      const tire = new T.Mesh(
        new T.CylinderGeometry(0.38, 0.38, 0.27, 32),
        world.mat('#182128', 0.05, 0.9),
      );
      tire.rotation.z = Math.PI / 2;
      spin.add(tire);
      const rim = new T.Mesh(new T.CylinderGeometry(0.225, 0.225, 0.29, 20), white);
      rim.rotation.z = Math.PI / 2;
      spin.add(rim);
      for (let i = 0; i < 5; i++) {
        const spoke = new T.Mesh(new T.BoxGeometry(0.3, 0.035, 0.33), dark);
        spoke.rotation.x = (i * Math.PI) / 5;
        spin.add(spoke);
      }
      world.wheels.push(spin);
      if (z > 0) world.steeringWheels.push(pivot);
    }
  const flag = new T.Group();
  flag.position.set(0.7, Math.max(0, type.roof - 1.35), -0.9);
  g.add(flag);
  world.cylinder(0, 1.2, 0, 0.018, 0.85, white, flag);
  const badge = new T.Mesh(
    new T.PlaneGeometry(0.72, 0.48),
    new T.MeshBasicMaterial({ color: '#ffffff', side: T.DoubleSide, toneMapped: false }),
  );
  badge.position.set(0.36, 1.85, 0);
  flag.add(badge);
  world.carBadge = badge;
  const flagColor = { value: new T.Color('#324c51') };
  badge.material.onBeforeCompile = (shader) => {
    shader.uniforms.flagColor = flagColor;
    shader.fragmentShader = 'uniform vec3 flagColor;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\nfloat paper = smoothstep(0.82, 0.97, min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))); diffuseColor.rgb = mix(diffuseColor.rgb, flagColor, paper);',
    );
  };
  badge.material.customProgramCacheKey = () => 'campus-flag-solid-background';
  const logo = new T.TextureLoader().load('assets/club-logo.png');
  logo.colorSpace = T.SRGBColorSpace;
  badge.material.map = logo;
  const lamp = new T.SpotLight('#fff1d7', 12, 12, 0.6, 0.75, 1.5);
  lamp.position.set(0, 0.75, 1.4);
  lamp.target.position.set(0, 0, 8);
  g.add(lamp, lamp.target);
  const save = () => {
    try {
      localStorage.setItem('dc-drive-car', JSON.stringify(choice));
    } catch {
      // Vehicle choices still work when browser storage is unavailable.
    }
  };
  const select = document.querySelector('#car-mascot'),
    preview = document.querySelector('#mascot-preview');
  select.replaceChildren();
  for (const [id, name] of MASCOTS) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = name;
    select.append(o);
  }
  let bodyKit = null;
  const apply = (id) => {
    choice.mascot = MASCOTS.some((m) => m[0] === id) ? id : 'club';
    select.value = choice.mascot;
    const style = MASCOT_STYLE[choice.mascot];
    paint.color.set(style.paint);
    flagColor.value.set(style.paint).multiplyScalar(0.24);
    roof.material.color.set(style.type === 'club' ? '#e9e9df' : style.trim);
    if (bodyKit) {
      g.remove(bodyKit);
      const materials = new Set();
      bodyKit.traverse((o) => {
        o.geometry?.dispose();
        if (o.material && o.material !== paint) materials.add(o.material);
      });
      materials.forEach((m) => m.dispose());
    }
    bodyKit = mascotBody(choice.mascot, paint);
    bodyKit.position.set(0, type.roof - 1.35, type.cabinZ + 0.16);
    for (const part of bodyKit.children)
      if (part.userData.chassis) {
        part.position.y -= bodyKit.position.y;
        part.position.z -= bodyKit.position.z;
      }
    g.add(bodyKit);
    document.querySelector('#ride-description').textContent = type.name + ' · ' + style.description;
    const requested = choice.mascot,
      url =
        choice.mascot === 'club'
          ? 'assets/club-logo.png'
          : 'assets/mascots/' + choice.mascot + '-mark.webp';
    preview.setAttribute('aria-label', MASCOTS.find((m) => m[0] === choice.mascot)[1]);
    new T.TextureLoader().load(url, (tx) => {
      tx.colorSpace = T.SRGBColorSpace;
      if (choice.mascot !== requested || world.rover !== g) {
        tx.dispose();
        return;
      }
      drawFlagPreview(preview, tx.image, flagColor.value);
      badge.material.map?.dispose();
      badge.material.map = tx;
      badge.material.needsUpdate = true;
      badge.scale.x = tx.image.width / tx.image.height / 1.5;
    });
    save();
  };
  select.onchange = (e) => {
    choice.mascot = e.target.value;
    save();
    makeVehicle(world, { shuffle: true });
  };
  apply(choice.mascot);
  return g;
}
