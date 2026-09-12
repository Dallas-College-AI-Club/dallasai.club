// Pavilion centers and orientations. Arrival circles sit in front of each pavilion.
// Fixed, irregular placements keep discoveries memorable and routes verifiable.
export const LAYOUTS = {
  brookhaven: [
    [-20, -9, 1.5],
    [16, -22, -1.2],
    [20, 7, -2],
    [4, 19, 3.14],
    [-14, 17, 2.6],
  ],
  'cedar-valley': [
    [-19, -18, 1.1],
    [10, -25, -0.5],
    [22, -5, -1.4],
    [12, 18, -2.7],
    [-17, 13, 2],
  ],
  eastfield: [
    [-22, 1, 1.7],
    [-15, -23, 0.7],
    [17, -20, -0.8],
    [22, 12, -1.9],
    [-5, 20, 3],
  ],
  'el-centro': [
    [-19, 4, 1.8],
    [-19, -21, 0.9],
    [18, -24, -0.7],
    [20, 5, -1.9],
    [-11, 22, 2.7],
  ],
  'mountain-view': [
    [-19, -20, 1],
    [19, -14, -1.1],
    [15, 18, -2.6],
    [-8, 21, 2.9],
    [-23, 3, 1.7],
  ],
  'north-lake': [
    [17, -22, -0.6],
    [-22, -10, 1.4],
    [23, 6, -1.9],
    [-13, 18, 2.5],
    [6, 21, -2.9],
  ],
  richland: [
    [-21, 8, 1.9],
    [-17, -23, 0.6],
    [20, -17, -1],
    [17, 18, -2.5],
    [-3, 21, 3],
  ],
};
export const VEHICLE_CLEARANCE = 1.3;
export const approachOffset = (c) => 1.7 + 1.5 / (c.id === 'el-centro' ? 0.55 : 1);
export const STOP_IDS = ['journal', 'lab', 'projects', 'events', 'join'];
export function stationLayout(c, id) {
  const [x, z, yaw] = LAYOUTS[c.id][STOP_IDS.indexOf(id)];
  return { x, z, yaw };
}
export function arrivalLocal(c, id) {
  const p = stationLayout(c, id);
  return {
    x: p.x + Math.sin(p.yaw) * approachOffset(c),
    z: p.z + Math.cos(p.yaw) * approachOffset(c),
  };
}

// Grid A*: local approaches go around pavilion furniture, with rover clearance.
export function hitsObstacle(p, o, pad = VEHICLE_CLEARANCE) {
  const dx = p.x - o.x,
    dz = p.z - o.z,
    a = o.yaw || 0,
    x = Math.cos(a) * dx - Math.sin(a) * dz,
    z = Math.sin(a) * dx + Math.cos(a) * dz;
  return Math.abs(x) < o.w / 2 + pad && Math.abs(z) < o.d / 2 + pad;
}
export function localRoute(start, end, obstacles, scale = 1) {
  const step = 0.5 * scale,
    pad = VEHICLE_CLEARANCE,
    minX = Math.min(start.x, end.x) - 25 * scale,
    minZ = Math.min(start.z, end.z) - 25 * scale;
  const width = Math.ceil((Math.abs(start.x - end.x) + 50 * scale) / step) + 1,
    height = Math.ceil((Math.abs(start.z - end.z) + 50 * scale) / step) + 1;
  const point = (i) => ({ x: minX + (i % width) * step, z: minZ + Math.floor(i / width) * step });
  const index = (p) => Math.round((p.z - minZ) / step) * width + Math.round((p.x - minX) / step);
  const blocked = new Uint8Array(width * height),
    cost = new Float64Array(width * height).fill(Infinity),
    prev = new Int32Array(width * height).fill(-1);
  const obs = obstacles.filter(
    (o) =>
      Math.abs(o.x - (start.x + end.x) / 2) < 55 * scale &&
      Math.abs(o.z - (start.z + end.z) / 2) < 55 * scale,
  );
  for (let i = 0; i < blocked.length; i++) {
    const p = point(i);
    blocked[i] = obs.some((o) => hitsObstacle(p, o, pad)) ? 1 : 0;
  }
  const segmentClear = (p, q) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.12));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        r = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t };
      if (obs.some((o) => hitsObstacle(r, o, pad))) return false;
    }
    return true;
  };
  const connect = (p) => {
    const base = index(p),
      choices = [];
    for (let dz = -4; dz <= 4; dz++)
      for (let dx = -4; dx <= 4; dx++) {
        const n = base + dz * width + dx;
        if (n < 0 || n >= blocked.length || blocked[n]) continue;
        const q = point(n);
        if (segmentClear(p, q)) choices.push({ n, d: Math.hypot(q.x - p.x, q.z - p.z) });
      }
    if (!choices.length) throw new Error('Move away from the pavilion before choosing a route.');
    return choices.sort((x, y) => x.d - y.d)[0].n;
  };
  const a = connect(start),
    b = connect(end);
  cost[a] = 0;
  const open = new Set([a]);
  while (open.size) {
    let current = -1,
      best = Infinity;
    for (const n of open) {
      const p = point(n),
        h = cost[n] + Math.hypot(p.x - end.x, p.z - end.z);
      if (h < best) {
        best = h;
        current = n;
      }
    }
    if (current === b) {
      const ids = [b];
      while (ids[0] !== a) ids.unshift(prev[ids[0]]);
      return [start, ...ids.map(point), end];
    }
    open.delete(current);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const x = (current % width) + dx,
        z = Math.floor(current / width) + dz;
      if (x < 0 || x >= width || z < 0 || z >= height) continue;
      const n = z * width + x;
      if (blocked[n] || (dx && dz && (blocked[current + dx] || blocked[current + dz * width])))
        continue;
      const c = cost[current] + Math.hypot(dx, dz) * step;
      if (c < cost[n] && segmentClear(point(current), point(n))) {
        cost[n] = c;
        prev[n] = current;
        open.add(n);
      }
    }
  }
  throw new Error('That approach is blocked. Drive into the courtyard and try again.');
}
export function avoidObstacles(route, obstacles) {
  const blocked = (a, b) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z),
      steps = Math.ceil(d / 0.3);
    const relevant = obstacles.filter(
      (o) =>
        o.x + o.w + 2 > Math.min(a.x, b.x) &&
        o.x - o.w - 2 < Math.max(a.x, b.x) &&
        o.z + o.d + 2 > Math.min(a.z, b.z) &&
        o.z - o.d - 2 < Math.max(a.z, b.z),
    );
    for (let n = 1; n <= steps; n++) {
      const t = n / steps,
        p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (relevant.some((o) => hitsObstacle(p, o))) return true;
    }
    return false;
  };
  const out = [route[0]];
  for (let i = 1; i < route.length; i++) {
    const start = out.at(-1);
    if (!blocked(start, route[i])) {
      out.push(route[i]);
      continue;
    }
    let end = i;
    while (
      end < route.length - 1 &&
      obstacles.some((o) => hitsObstacle(route[end], o, VEHICLE_CLEARANCE + 0.15))
    )
      end++;
    const detour = localRoute(start, route[end], obstacles);
    out.push(...detour.slice(1).map((p) => ({ ...p, road: 'Campus approach' })));
    i = end;
  }
  return out;
}

export function movementBlocked(a, b, obstacles) {
  const relevant = obstacles.filter(
      (o) =>
        Math.abs(o.x - (a.x + b.x) / 2) < o.w + o.d + 4 &&
        Math.abs(o.z - (a.z + b.z) / 2) < o.w + o.d + 4,
    ),
    steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.15));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps,
      p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    if (relevant.some((o) => hitsObstacle(p, o))) return true;
  }
  return false;
}
