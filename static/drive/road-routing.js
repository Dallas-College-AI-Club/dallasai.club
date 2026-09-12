// Only actual shared OSM nodes connect roads. Crossing lines are not junctions.
export class RoadRouter {
  constructor(data) {
    this.data = data;
    this.nodes = data.nodes;
    this.edges = data.edges;
    this.adj = this.nodes.map(() => []);
    for (const e of this.edges) {
      const [a, b, name, type] = e,
        p = this.nodes[a],
        q = this.nodes[b],
        factor =
          type === 'motorway' ? 0.7 : type.includes('link') ? 0.85 : type === 'trunk' ? 0.8 : 1.15;
      this.adj[a].push({ to: b, cost: Math.hypot(p[0] - q[0], p[1] - q[1]) * factor, name });
    }
  }
  route(position, campus) {
    const goal = campus.node ?? this.data.anchors[campus.id];
    let closest = null;
    for (const [a, b] of this.edges) {
      const p = this.nodes[a],
        q = this.nodes[b],
        dx = q[0] - p[0],
        dz = q[1] - p[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((position.x - p[0]) * dx + (position.z - p[1]) * dz) / (dx * dx + dz * dz || 1),
          ),
        ),
        x = p[0] + t * dx,
        z = p[1] + t * dz,
        d = Math.hypot(x - position.x, z - position.z);
      if (!closest || d < closest.d) closest = { d, x, z, a, b };
    }
    const start = closest.b,
      costs = new Float64Array(this.nodes.length).fill(Infinity),
      prev = new Int32Array(this.nodes.length).fill(-1),
      names = [];
    costs[start] = 0;
    const heap = [];
    const push = (v) => {
      heap.push(v);
      let i = heap.length - 1;
      while (i) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= v[0]) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = v;
    };
    const pop = () => {
      const first = heap[0],
        last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let c = i * 2 + 1;
          if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
          if (heap[c][0] >= last[0]) break;
          heap[i] = heap[c];
          i = c;
        }
        heap[i] = last;
      }
      return first;
    };
    push([0, start]);
    while (heap.length) {
      const [cost, u] = pop();
      if (cost !== costs[u]) continue;
      if (u === goal) break;
      for (const e of this.adj[u]) {
        const next = cost + e.cost;
        if (next < costs[e.to]) {
          costs[e.to] = next;
          prev[e.to] = u;
          names[e.to] = e.name;
          push([next, e.to]);
        }
      }
    }
    if (!Number.isFinite(costs[goal]))
      throw new Error('No connected road route. Return to a campus approach.');
    const chain = [goal];
    while (chain[0] !== start) chain.unshift(prev[chain[0]]);
    return [
      { x: position.x, z: position.z },
      { x: closest.x, z: closest.z, road: 'Joining the road' },
      ...chain.map((i) => ({
        x: this.nodes[i][0],
        z: this.nodes[i][1],
        road: names[i] || 'Campus approach',
      })),
    ];
  }
}
