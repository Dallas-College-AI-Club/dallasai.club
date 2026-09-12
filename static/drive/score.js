export const PAGE_IDS = ['summary', 'journal', 'lab', 'projects', 'events', 'about'];
export const pageId = (id) =>
  id === 'article' || id === 'contribute'
    ? 'journal'
    : ['ethics', 'compare', 'drift'].includes(id)
      ? 'lab'
      : id === 'join'
        ? 'about'
        : id;
const segmentDistance = (p, a, b) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / (dx * dx + dz * dz || 1)),
    );
  return Math.hypot(p.x - a[0] - t * dx, p.z - a[1] - t * dz);
};
export class DriveScore {
  constructor(data) {
    this.data = data;
    this.cells = new Map();
    const seen = new Set();
    for (const [a, b, , type] of data.edges) {
      const key = [Math.min(a, b), Math.max(a, b)].join('/');
      if (seen.has(key)) continue;
      seen.add(key);
      const p = data.nodes[a],
        q = data.nodes[b],
        seg = {
          a: p,
          b: q,
          width: type === 'motorway' ? 1.55 : type.includes('link') ? 1.2 : 1.45,
        };
      for (
        let x = Math.floor(Math.min(p[0], q[0]) / 12);
        x <= Math.floor(Math.max(p[0], q[0]) / 12);
        x++
      )
        for (
          let z = Math.floor(Math.min(p[1], q[1]) / 12);
          z <= Math.floor(Math.max(p[1], q[1]) / 12);
          z++
        ) {
          const k = x + ',' + z;
          if (!this.cells.has(k)) this.cells.set(k, []);
          this.cells.get(k).push(seg);
        }
    }
    this.reset();
  }
  reset() {
    this.points = 0;
    this.streak = 0;
    this.offDistance = 0;
    this.visited = new Set();
    this.collected = new Set();
    this.places = new Set();
    this.campuses = new Set(['el-centro']);
    this.previews = new Set();
    this.pages = new Set();
    this.returns = new Set();
    this.pendingPage = null;
    this.onRoad = false;
    this.lastAward = null;
  }
  campus(id) {
    if (this.campuses.has(id)) return 0;
    this.campuses.add(id);
    this.points += 250;
    this.lastAward = { amount: 250, label: 'New campus' };
    return 250;
  }
  previewPage(id) {
    if (!PAGE_IDS.includes(id) || this.previews.has(id)) return 0;
    this.previews.add(id);
    this.points += 20;
    return 20;
  }
  visitPage(id) {
    if (!PAGE_IDS.includes(id)) return 0;
    this.pendingPage = id;
    if (this.pages.has(id)) return 0;
    this.pages.add(id);
    this.points += 100;
    return 100;
  }
  returnToDrive() {
    const id = this.pendingPage;
    this.pendingPage = null;
    if (!id || !PAGE_IDS.includes(id) || this.returns.has(id)) return 0;
    this.returns.add(id);
    this.points += 50;
    return 50;
  }
  snapshot() {
    return {
      points: this.points,
      streak: this.streak,
      offDistance: this.offDistance,
      visited: [...this.visited],
      collected: [...this.collected],
      places: [...this.places],
      campuses: [...this.campuses],
      previews: [...this.previews],
      pages: [...this.pages],
      returns: [...this.returns],
      pendingPage: this.pendingPage,
    };
  }
  restore(data) {
    if (!data || !Number.isFinite(data.points) || data.points < 0 || data.points > 1000000)
      return false;
    const strings = (v) =>
      Array.isArray(v)
        ? v.filter((x) => typeof x === 'string' && x.length < 80).slice(0, 100000)
        : [];
    this.points = Math.floor(data.points);
    this.streak = Math.max(0, Math.min(10000, +data.streak || 0));
    this.offDistance = Math.max(0, Math.min(10000, +data.offDistance || 0));
    for (const field of [
      'visited',
      'collected',
      'places',
      'campuses',
      'previews',
      'pages',
      'returns',
    ])
      this[field] = new Set(strings(data[field]));
    this.pendingPage = PAGE_IDS.includes(data.pendingPage) ? data.pendingPage : null;
    this.campuses.add('el-centro');
    return true;
  }
  roadAt(p) {
    const x = Math.floor(p.x / 12),
      z = Math.floor(p.z / 12);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const s of this.cells.get(x + dx + ',' + (z + dz)) || [])
          if (segmentDistance(p, s.a, s.b) <= s.width) return true;
    return false;
  }
  step(before, p, manual) {
    this.lastAward = null;
    this.onRoad = this.roadAt(p);
    const d = Math.hypot(p.x - before.x, p.z - before.z);
    if (!manual || d < 0.005 || d > 4) return 0;
    if (!this.onRoad) {
      this.offDistance += d;
      if (this.offDistance > 2) this.streak = 0;
      return 0;
    }
    this.offDistance = 0;
    const key = Math.floor(p.x / 2) + ',' + Math.floor(p.z / 2);
    if (this.visited.has(key)) return 0;
    this.visited.add(key);
    this.streak += 2;
    const amount = 3 * this.multiplier;
    this.points += amount;
    this.lastAward = { amount, label: 'On the road' };
    return amount;
  }
  get multiplier() {
    return Math.min(3, 1 + Math.floor(this.streak / 40));
  }
  bonus(id, amount = 50, label = 'Route bonus') {
    if (this.collected.has(id)) return 0;
    this.collected.add(id);
    this.points += amount;
    this.lastAward = { amount, label };
    return amount;
  }
  visit(campus, stop) {
    const key = campus + '/' + stop;
    if (this.places.has(key)) return 0;
    this.places.add(key);
    this.points += 100;
    this.lastAward = { amount: 100, label: 'New club stop' };
    return 100;
  }
}
