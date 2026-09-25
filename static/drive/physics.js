import { arrivalLocal } from './collisions.js';
import { CAMPUSES, clampPoint } from './geography.js';
export const STOPS = [
  {
    id: 'journal',
    title: 'The AI Review',
    hint: 'Student essays and research notes.',
    action: 'Read the Review',
    color: '#d8dbc6',
  },
  {
    id: 'lab',
    title: 'AI Lab',
    hint: 'Train a model. Inspect its predictions.',
    action: 'Open AI Lab',
    color: '#a6ced3',
  },
  {
    id: 'projects',
    title: 'Projects',
    hint: 'Major, the college planning assistant, and two interface concepts.',
    action: 'See the projects',
    color: '#d8bfa0',
  },
  {
    id: 'events',
    title: 'Events',
    hint: 'Upcoming workshops and past meetings.',
    action: 'View events',
    color: '#bed4a9',
  },
  {
    id: 'join',
    title: 'Join the club',
    hint: 'Get to know the club and find your way in.',
    action: 'About the club',
    color: '#b5c2df',
  },
];
export const campusScale = (c) => (c.id === 'el-centro' ? 0.55 : 1);
export const forecourtX = (c) => c.x - (c.id === 'el-centro' ? 8 : 0);
export const campusPoint = (c) => ({ x: forecourtX(c), z: c.z + 7 * campusScale(c) });
export const stopPoint = (c, id) => {
  const p = arrivalLocal(c, id);
  return { x: forecourtX(c) + p.x * campusScale(c), z: c.z + p.z * campusScale(c) };
};
export const START = (() => {
  const c = CAMPUSES.find((c) => c.id === 'el-centro');
  return { x: forecourtX(c), z: c.z + 13 * campusScale(c) };
})();
export const LINKS = [
  ['north-lake', 'brookhaven'],
  ['brookhaven', 'richland'],
  ['richland', 'eastfield'],
  ['eastfield', 'el-centro'],
  ['el-centro', 'mountain-view'],
  ['mountain-view', 'cedar-valley'],
  ['cedar-valley', 'el-centro'],
  ['north-lake', 'mountain-view'],
  ['brookhaven', 'el-centro'],
];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function linkPoints(a, b) {
  if (a.id > b.id) return linkPoints(b, a).reverse();
  const p = campusPoint(a),
    q = campusPoint(b),
    side = q.x >= p.x ? 1 : -1;
  return softenCorners([p, { x: p.x + side * 15, z: p.z }, { x: q.x - side * 15, z: q.z }, q]);
}
function softenCorners(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1],
      r = Math.min(1.8, distance(a, b) * 0.2, distance(b, c) * 0.2),
      u = r / distance(a, b),
      v = r / distance(b, c),
      start = { x: b.x + (a.x - b.x) * u, z: b.z + (a.z - b.z) * u },
      end = { x: b.x + (c.x - b.x) * v, z: b.z + (c.z - b.z) * v };
    out.push(start);
    for (let j = 1; j <= 8; j++) {
      const t = j / 8,
        k = 1 - t;
      out.push({
        x: k * k * start.x + 2 * k * t * b.x + t * t * end.x,
        z: k * k * start.z + 2 * k * t * b.z + t * t * end.z,
      });
    }
  }
  out.push(points.at(-1));
  return out;
}
export function travelRoute(position, campus, id = null) {
  const nearest = CAMPUSES.reduce((a, b) =>
    distance(position, campusPoint(a)) < distance(position, campusPoint(b)) ? a : b,
  );
  const costs = new Map(CAMPUSES.map((c) => [c.id, Infinity])),
    prev = new Map(),
    todo = new Set(CAMPUSES.map((c) => c.id));
  costs.set(nearest.id, 0);
  while (todo.size) {
    const u = [...todo].reduce((a, b) => (costs.get(a) < costs.get(b) ? a : b));
    todo.delete(u);
    if (u === campus.id) break;
    for (const [a, b] of LINKS) {
      const v = a === u ? b : b === u ? a : null;
      if (!v || !todo.has(v)) continue;
      const cost =
        costs.get(u) +
        distance(
          campusPoint(CAMPUSES.find((c) => c.id === u)),
          campusPoint(CAMPUSES.find((c) => c.id === v)),
        );
      if (cost < costs.get(v)) {
        costs.set(v, cost);
        prev.set(v, u);
      }
    }
  }
  const chain = [campus.id];
  while (chain[0] !== nearest.id) {
    const p = prev.get(chain[0]);
    if (!p) break;
    chain.unshift(p);
  }
  let route = [{ x: position.x, z: position.z }, campusPoint(nearest)];
  for (let i = 1; i < chain.length; i++)
    route.push(
      ...linkPoints(
        CAMPUSES.find((c) => c.id === chain[i - 1]),
        CAMPUSES.find((c) => c.id === chain[i]),
      ).slice(1),
    );
  if (id) route.push({ x: stopPoint(campus, id).x, z: campus.z + 5 }, stopPoint(campus, id));
  return route.filter((p, i, a) => !i || distance(p, a[i - 1]) > 0.05);
}
export function routeLength(points) {
  return points.reduce((sum, p, i) => sum + (i ? distance(p, points[i - 1]) : 0), 0);
}
export function advanceRoute(state, dt, speed = 7) {
  let remaining = dt * speed,
    moved = 0;
  while (state.route.length && remaining > 0) {
    const p = state.route[0],
      d = distance(state.position, p);
    if (d < 0.001) {
      state.route.shift();
      continue;
    }
    const step = Math.min(d, remaining);
    state.heading = Math.atan2(p.x - state.position.x, p.z - state.position.z);
    state.position.x += ((p.x - state.position.x) / d) * step;
    state.position.z += ((p.z - state.position.z) / d) * step;
    moved += step;
    remaining -= step;
    if (step === d) state.route.shift();
  }
  state.speed = state.route.length ? speed : 0;
  return moved;
}
export function resetDrive(state) {
  state.position.x = START.x;
  state.position.z = START.z;
  state.heading = Math.PI;
  state.speed = 0;
  state.steer = 0;
  state.route = [];
  state.keys = {};
  state.target = null;
  state.nearest = null;
  state.distanceDone = 0;
  state.distanceTotal = 0;
  state.overview = false;
  state.orbit = 0;
}
export function advanceDrive(state, keys, dt) {
  const forward =
      state.driveInput?.throttle ??
      (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0),
    turn =
      state.driveInput?.steer ??
      (keys.a || keys.arrowleft ? 1 : 0) - (keys.d || keys.arrowright ? 1 : 0);
  state.speed +=
    (forward * (keys.shift ? 12 : 7) - state.speed) * Math.min(1, dt * (forward ? 3 : 7));
  if (keys[' ']) state.speed *= Math.max(0, 1 - dt * 18);
  const steerTarget = (turn * 0.44) / (1 + Math.abs(state.speed) * 0.035);
  state.steer = (state.steer || 0) + (steerTarget - (state.steer || 0)) * (1 - Math.exp(-dt * 9));
  state.heading += (state.speed / 1.5) * Math.tan(state.steer) * dt;
  const p = clampPoint({
    x: state.position.x + Math.sin(state.heading) * state.speed * dt,
    z: state.position.z + Math.cos(state.heading) * state.speed * dt,
  });
  state.position.x = p.x;
  state.position.z = p.z;
}
