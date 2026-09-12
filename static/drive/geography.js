// Marker coordinates are the place targets (not viewport centers) in Dallas
// College's own “View in Google Maps” links. Sources recorded 10 September 2026.
export const CAMPUSES = [
  {
    id: 'brookhaven',
    name: 'Brookhaven',
    area: 'Farmers Branch',
    lat: 32.9293568,
    lon: -96.8500684,
  },
  { id: 'cedar-valley', name: 'Cedar Valley', area: 'Lancaster', lat: 32.6248556, lon: -96.763705 },
  { id: 'eastfield', name: 'Eastfield', area: 'Mesquite', lat: 32.815289, lon: -96.65968 },
  { id: 'el-centro', name: 'El Centro', area: 'Downtown Dallas', lat: 32.77976, lon: -96.805331 },
  {
    id: 'mountain-view',
    name: 'Mountain View',
    area: 'Oak Cliff',
    lat: 32.7245844,
    lon: -96.904478,
  },
  { id: 'north-lake', name: 'North Lake', area: 'Irving', lat: 32.8712166, lon: -96.9673029 },
  { id: 'richland', name: 'Richland', area: 'North Dallas', lat: 32.9220388, lon: -96.7292051 },
].map((c) => ({
  ...c,
  ...project(c.lon, c.lat),
  source: `https://www.dallascollege.edu/maps/${c.id}/`,
}));
export function project(lon, lat) {
  return { x: (lon + 96.82) * 5000 * Math.cos((32.79 * Math.PI) / 180), z: (32.79 - lat) * 5000 };
}
export const MAP_BOUNDS = { minX: -1175, maxX: 1012, minZ: -1087, maxZ: 1275 };
export function clampPoint(p) {
  return {
    x: Math.max(MAP_BOUNDS.minX, Math.min(MAP_BOUNDS.maxX, p.x)),
    z: Math.max(MAP_BOUNDS.minZ, Math.min(MAP_BOUNDS.maxZ, p.z)),
  };
}
export function advanceVehicle(state, keys, dt) {
  const drive = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0);
  const steer = (keys.a || keys.arrowleft ? 1 : 0) - (keys.d || keys.arrowright ? 1 : 0);
  state.speed += (drive * (keys.shift ? 31 : 19) - state.speed) * Math.min(1, dt * (drive ? 3 : 6));
  if (keys[' ']) state.speed *= Math.max(0, 1 - dt * 16);
  state.heading += steer * dt * 1.8 * (Math.abs(state.speed) > 0.2 ? Math.sign(state.speed) : 1);
  const p = clampPoint({
    x: state.position.x + Math.sin(state.heading) * state.speed * dt,
    z: state.position.z + Math.cos(state.heading) * state.speed * dt,
  });
  state.position.x = p.x;
  state.position.z = p.z;
}
