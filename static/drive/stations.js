import { RECORDINGS } from '../content/chatbot-recordings.js';
import * as T from '../vendor/three.module.js';
import { STOPS, campusScale, forecourtX } from './physics.js';
import { stationLayout, arrivalLocal, approachOffset } from './collisions.js';

export function addStations(world, c) {
  world.stations ??= [];
  const scale = campusScale(c);
  for (const s of STOPS) {
    const p = stationLayout(c, s.id),
      group = new T.Group();
    group.position.set(forecourtX(c) + p.x * scale, 0, c.z + p.z * scale);
    group.rotation.y = p.yaw;
    group.scale.setScalar(scale);
    world.scene.add(group);
    const box = (x, y, z, w, h, d, color) => world.box(x, y, z, w, h, d, color, group),
      metal = world.mat('#43555c', 0.65, 0.32),
      cream = world.mat('#e5ded0', 0.1, 0.65),
      glass = world.mat('#55888f', 0.75, 0.2);
    const sign = (lines, w, h, x, y, z, bg = '#1b2c32', ink = s.color) => {
      const m = world.label(lines, w, h, bg, ink, s.id === 'journal');
      m.position.set(x, y, z);
      group.add(m);
      return m;
    };
    box(0, 0.02, 0, 4.6, 0.1, 2.8, world.mat('#9ba49a', 0.05, 0.85));
    if (s.id === 'journal') {
      box(0, 0, -0.7, 4.25, 2.6, 0.35, cream);
      box(0, 2.65, -0.1, 4.7, 0.12, 2.8, metal);
      sign(['THE AI REVIEW'], 3.8, 0.6, 0, 2.22, -0.48, '#e8e4d8', '#31463a');
      for (let row = 0; row < 2; row++) {
        box(0, 0.75 + row * 0.6, -0.4, 3.8, 0.06, 0.5, metal);
        for (let i = 0; i < 7; i++)
          box(
            -1.5 + i * 0.46,
            0.8 + row * 0.6,
            -0.3,
            0.32,
            0.42,
            0.065,
            world.mat(['#b9bcb0', '#867f79', '#c2b398'][i % 3]),
          );
      }
      box(-1.35, 0, 0.85, 0.85, 0.45, 0.65, world.mat('#998a71'));
      sign(['READ'], 1.1, 0.4, 1.25, 0.9, 0.92, '#e8e4d8', '#31463a');
    } else if (s.id === 'lab') {
      for (const x of [-1.65, 1.65]) box(x, 0, -0.45, 0.12, 3.6, 0.12, metal);
      box(0, 3.5, -0.45, 3.5, 0.12, 0.12, metal);
      sign(['AI LAB'], 3.7, 0.65, 0, 2.9, -0.3);
      box(0, 0.7, 0.1, 3.2, 0.18, 1.35, glass);
      for (const x of [-1.2, 1.2]) box(x, 0, 0.1, 0.12, 0.7, 1, metal);
      const ring = new T.Mesh(
        new T.TorusGeometry(0.68, 0.025, 8, 64),
        new T.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 0.6 }),
      );
      ring.position.set(0, 1.8, -0.3);
      group.add(ring);
      for (let i = 0; i < 5; i++) {
        const a = i * 1.256;
        world.sphere(Math.cos(a) * 0.68, 1.8 + Math.sin(a) * 0.68, -0.3, 0.085, cream, group);
      }
      sign(['CHANGE → OBSERVE'], 2.9, 0.3, 0, 0.52, 0.79);
    } else if (s.id === 'projects') {
      box(0, 0.8, -0.45, 4.7, 2.8, 0.22, metal);
      const screen = sign(['PROJECTS'], 4.4, 2.4, 0, 2.25, -0.3);
      if (!world.projectVideo) {
        const v = document.createElement('video');
        v.src = RECORDINGS[0].src;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = 'none';
        world.projectVideo = v;
        world.projectTexture = new T.VideoTexture(v);
        world.projectTexture.colorSpace = T.SRGBColorSpace;
      }
      screen.material.map = world.projectTexture;
      sign(['PROJECTS / NOW SHOWING'], 4.4, 0.4, 0, 3.87, -0.3);
      box(0, 0, 0.8, 3.4, 0.32, 0.75, world.mat('#8d7869'));
      for (const x of [-1.8, 1.8]) box(x, 0, -0.45, 0.16, 0.8, 0.5, metal);
    } else if (s.id === 'events') {
      box(-1.1, 0, -0.25, 0.14, 3.3, 0.2, metal);
      box(1.1, 0, -0.25, 0.14, 3.3, 0.2, metal);
      box(0, 0.7, -0.35, 3, 2.65, 0.18, cream);
      sign(['EVENTS'], 2.7, 0.5, 0, 2.9, -0.23, '#e8e6d9', '#3d5d51');
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 4; x++)
          box(
            -0.94 + x * 0.62,
            1.08 + y * 0.43,
            -0.22,
            0.39,
            0.29,
            0.045,
            world.mat(x === 1 && y === 1 ? '#4d907d' : '#bdc9bc'),
          );
      for (const x of [-0.8, 0.8]) {
        const ring = new T.Mesh(new T.TorusGeometry(0.15, 0.045, 8, 20), metal);
        ring.position.set(x, 3.37, -0.25);
        ring.rotation.y = Math.PI / 2;
        group.add(ring);
      }
      box(0, 0, 0.85, 3.3, 0.17, 0.65, metal);
    } else {
      for (const x of [-1.8, 1.8]) box(x, 0, -0.4, 0.1, 3, 0.1, metal);
      box(0, 3, -0.4, 4.1, 0.1, 2.4, world.mat('#c2becf'));
      sign(['JOIN THE CLUB'], 3.7, 0.6, 0, 2.58, -0.22);
      world.cylinder(0, 0.6, 0, 0.8, 0.14, cream, group);
      world.cylinder(0, 0, 0, 0.12, 0.6, metal, group);
      for (const x of [-1.5, 1.5]) {
        world.cylinder(x, 0, 0.5, 0.36, 0.4, world.mat('#9b9bae'), group);
      }
      box(2.2, 0, -0.6, 0.065, 3.9, 0.065, metal);
      sign(['AI CLUB'], 1.2, 0.65, 2.8, 3.5, -0.6, '#abb8cf', '#20353b');
    }
    // Measure every pavilion component before adding its non-solid approach marker.
    group.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert(),
      bounds = new T.Box3();
    group.traverse((child) => {
      if (child.isMesh) {
        child.geometry.computeBoundingBox();
        bounds.union(
          child.geometry.boundingBox
            .clone()
            .applyMatrix4(child.matrixWorld.clone().premultiply(inverse)),
        );
      }
    });
    const center = bounds.getCenter(new T.Vector3()).applyMatrix4(group.matrixWorld),
      size = bounds.getSize(new T.Vector3());
    world.obstacles.push({
      x: center.x,
      z: center.z,
      w: size.x * scale,
      d: size.z * scale,
      yaw: p.yaw,
    });
    // Approach marker and downward chevron have a consistent meaning in every layout.
    const mat = new T.MeshBasicMaterial({
      color: s.color,
      transparent: true,
      opacity: 0.85,
      side: T.DoubleSide,
    });
    const ring = new T.Mesh(new T.RingGeometry(0.93, 1.02, 64), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.15, approachOffset(c));
    group.add(ring);
    const disk = new T.Mesh(
      new T.CircleGeometry(0.93, 64),
      new T.MeshBasicMaterial({
        color: s.color,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    disk.rotation.x = -Math.PI / 2;
    disk.position.set(0, 0.145, approachOffset(c));
    group.add(disk);
    const arrow = new T.Group();
    for (const side of [-1, 1]) {
      const bar = box(
        side * 0.16,
        1.7,
        approachOffset(c),
        0.09,
        0.46,
        0.09,
        world.mat(s.color, 0.2, 0.4),
      );
      bar.rotation.z = side * -0.7;
      arrow.add(bar);
    }
    group.add(arrow);
    const q = arrivalLocal(c, s.id),
      entry = { x: forecourtX(c) + q.x * scale, z: c.z + q.z * scale };
    const button = document.createElement('button');
    button.className = 'station-label';
    button.style.setProperty('--station', s.color);
    button.innerHTML = '<span aria-hidden="true">↘</span><span></span>';
    button.lastElementChild.textContent = s.title;
    button.setAttribute('aria-label', 'Drive to ' + s.title + ' at ' + c.name);
    button.onclick = () => world.travelTo(c.id, s.id);
    document.querySelector('#station-labels').append(button);
    world.stations.push({ c, s, entry, group, ring, arrow, button, scale });
  }
}
export function updateStations(world, time) {
  const rect = world.canvas.getBoundingClientRect(),
    candidates = [];
  for (const station of world.stations || []) {
    const { entry, button, ring, arrow, scale } = station;
    const distance = Math.hypot(entry.x - world.position.x, entry.z - world.position.z);
    ring.material.opacity = world.reduced ? 0.85 : 0.7 + Math.sin(time * 0.003) * 0.15;
    arrow.position.y = world.reduced ? 0 : Math.sin(time * 0.002) * 0.12;
    const p = new T.Vector3(entry.x, 2.65 * scale, entry.z).project(world.camera);
    button.hidden = true;
    if (
      world.overview ||
      (world.nearest && !world.inspect) ||
      distance > (world.inspect ? 40 : 19) * scale ||
      p.z > 1 ||
      Math.abs(p.x) > 1.5 ||
      p.y > 0.7 ||
      p.y < -0.7
    )
      continue;
    candidates.push({
      station,
      distance,
      x: ((p.x + 1) * rect.width) / 2,
      y: ((1 - p.y) * rect.height) / 2,
    });
  }
  const placed = [];
  const limit = rect.width < 600 ? 3 : 5;
  for (const item of candidates.sort((a, b) => a.x - b.x)) {
    if (placed.length >= limit) break;
    item.x = Math.max(95, Math.min(rect.width - 95, item.x));
    item.y = Math.max(135, Math.min(rect.height - 155, item.y));
    let y = item.y;
    for (let n = 0; n < 6; n++) {
      if (!placed.some((p) => Math.abs(p.x - item.x) < 175 && Math.abs(p.y - y) < 46)) break;
      y = item.y + (n % 2 ? -1 : 1) * (Math.floor(n / 2) + 1) * 47;
    }
    item.y = Math.max(135, Math.min(rect.height - 145, y));
    const b = item.station.button;
    b.style.left = item.x + 'px';
    b.style.top = item.y + 'px';
    b.hidden = false;
    placed.push(item);
  }
  const nearProject = world.stations?.some(
    (s) =>
      s.s.id === 'projects' &&
      Math.hypot(s.entry.x - world.position.x, s.entry.z - world.position.z) < 22,
  );
  if (world.projectVideo) {
    if (nearProject && !world.reduced && !world.overview) {
      if (world.projectVideo.paused) world.projectVideo.play().catch(() => {});
    } else if (!world.projectVideo.paused) world.projectVideo.pause();
  }
}
