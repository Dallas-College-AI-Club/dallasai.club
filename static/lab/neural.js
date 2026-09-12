export function random(seed = 41) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
export function makeData(pattern = 'circle', count = 240, seed = 41) {
  const r = random(seed);
  return Array.from({ length: count }, () => {
    const x = r() * 2 - 1,
      y = r() * 2 - 1;
    return { x, y, label: pattern === 'xor' ? Number(x * y > 0) : Number(x * x + y * y < 0.5) };
  });
}
export class TinyNetwork {
  constructor(units = 8, seed = 71) {
    this.units = units;
    const r = random(seed);
    this.w1 = Array.from({ length: units }, () => [(r() - 0.5) * 1.8, (r() - 0.5) * 1.8]);
    this.b1 = Array.from({ length: units }, () => (r() - 0.5) * 0.3);
    this.w2 = Array.from({ length: units }, () => (r() - 0.5) * 1.8);
    this.b2 = 0;
    this.epoch = 0;
  }
  forward(x, y) {
    const h = this.w1.map((w, i) => Math.tanh(w[0] * x + w[1] * y + this.b1[i]));
    const z = h.reduce((sum, v, i) => sum + v * this.w2[i], this.b2);
    return { h, p: 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))) };
  }
  train(data, rate = 0.3) {
    const a = this.w1.map(() => [0, 0]),
      b = this.b1.map(() => 0),
      c = this.w2.map(() => 0);
    let d = 0;
    for (const { x, y, label } of data) {
      const { h, p } = this.forward(x, y),
        error = p - label;
      d += error;
      for (let j = 0; j < this.units; j++) {
        c[j] += error * h[j];
        const e = error * this.w2[j] * (1 - h[j] * h[j]);
        a[j][0] += e * x;
        a[j][1] += e * y;
        b[j] += e;
      }
    }
    const step = rate / data.length;
    for (let j = 0; j < this.units; j++) {
      this.w1[j][0] -= step * a[j][0];
      this.w1[j][1] -= step * a[j][1];
      this.b1[j] -= step * b[j];
      this.w2[j] -= step * c[j];
    }
    this.b2 -= step * d;
    this.epoch++;
  }
  metrics(data) {
    let loss = 0,
      correct = 0;
    for (const { x, y, label } of data) {
      const p = this.forward(x, y).p;
      loss -= label * Math.log(Math.max(p, 1e-8)) + (1 - label) * Math.log(Math.max(1 - p, 1e-8));
      correct += Number(p >= 0.5 === Boolean(label));
    }
    return { loss: loss / data.length, accuracy: correct / data.length };
  }
}
