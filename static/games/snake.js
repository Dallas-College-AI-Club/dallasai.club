const WIDTH = 24,
  HEIGHT = 16,
  dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export function createState() {
  const s = {
    version: 1,
    phase: 'ready',
    body: [
      [10, 8],
      [9, 8],
      [8, 8],
    ],
    direction: 'right',
    queue: [],
    food: [16, 8],
    score: 0,
    eaten: 0,
    checkpoints: 0,
    newsRead: [],
    seed: 841,
    clock: 0,
  };
  return s;
}
export function restore(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    !Array.isArray(raw.body) ||
    raw.body.length < 3 ||
    raw.body.length > 384 ||
    raw.body.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every(Number.isInteger) ||
        p[0] < 0 ||
        p[0] >= WIDTH ||
        p[1] < 0 ||
        p[1] >= HEIGHT,
    ) ||
    new Set(raw.body.map((p) => p.join(','))).size !== raw.body.length ||
    !dirs[raw.direction]
  )
    return createState();
  const s = { ...createState(), ...raw, queue: [] };
  if (
    !['score', 'eaten', 'checkpoints', 'seed'].every((k) => Number.isInteger(s[k]) && s[k] >= 0) ||
    s.seed < 1 ||
    s.seed >= 2147483647 ||
    !Number.isFinite(s.clock) ||
    s.clock < 0 ||
    !Array.isArray(s.food) ||
    s.food.length !== 2 ||
    !s.food.every(Number.isInteger) ||
    s.food[0] < 0 ||
    s.food[0] >= WIDTH ||
    s.food[1] < 0 ||
    s.food[1] >= HEIGHT
  )
    return createState();
  s.newsRead = Array.isArray(s.newsRead) ? s.newsRead.filter(Number.isInteger) : [];
  s.phase = ['over', 'ready'].includes(s.phase) ? s.phase : 'paused';
  return s;
}
export function input(s, key) {
  const d = dirs[key];
  if (!d || s.queue.length >= 2) return;
  const last = s.queue.at(-1) || s.direction,
    v = dirs[last];
  if (d[0] + v[0] === 0 && d[1] + v[1] === 0) return;
  if (last !== key) s.queue.push(key);
}
function food(s) {
  const empty = [];
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++)
      if (!s.body.some((p) => p[0] === x && p[1] === y)) empty.push([x, y]);
  if (!empty.length) {
    s.phase = 'over';
    s.won = true;
    return;
  }
  s.seed = (s.seed * 16807) % 2147483647;
  s.food = empty[s.seed % empty.length];
}
export const interval = (s) => Math.max(0.065, 0.145 - Math.floor(s.eaten / 3) * 0.012);
export const multiplier = (s) => 0.145 / interval(s);
export const paceLabel = (s) =>
  `${(1 / interval(s)).toFixed(1)} cells/sec · ${multiplier(s).toFixed(1)}× points`;
export function step(s, dt) {
  if (s.phase !== 'running') return;
  s.clock += dt;
  const seconds = interval(s);
  while (s.clock >= seconds && s.phase === 'running') {
    s.clock -= seconds;
    if (s.queue.length) s.direction = s.queue.shift();
    const [dx, dy] = dirs[s.direction],
      head = [s.body[0][0] + dx, s.body[0][1] + dy],
      eat = head[0] === s.food[0] && head[1] === s.food[1],
      solid = eat ? s.body : s.body.slice(0, -1);
    if (
      head[0] < 0 ||
      head[0] >= WIDTH ||
      head[1] < 0 ||
      head[1] >= HEIGHT ||
      solid.some((p) => p[0] === head[0] && p[1] === head[1])
    ) {
      s.phase = 'over';
      return;
    }
    s.body.unshift(head);
    s.score += Math.max(1, Math.round(multiplier(s)));
    if (eat) {
      s.score += Math.round(20 * multiplier(s));
      s.eaten++;
      food(s);
      if (s.eaten % 4 === 0 && s.phase !== 'over') {
        s.checkpoints++;
        s.score += 100;
      }
    } else s.body.pop();
  }
}
export const checkpointLabel = (s) => `NEWS CAPSULE ${s.checkpoints}`;
export const stat = (s) => `${s.eaten % 4} / 4 collected until the next update`;
export const help =
  'Every three sparks make you faster and increase your points multiplier. Every four sparks earn 100 bonus points and a club discovery. Read it whenever you like; the game keeps moving. Use arrows or WASD; on a phone, swipe or use the direction buttons. Avoid walls and your tail.';
export function draw(ctx, s, time = 0) {
  const w = 768,
    h = 512,
    cell = 28,
    x0 = 48,
    y0 = 32;
  ctx.fillStyle = '#0d2024';
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(380, 240, 0, 380, 240, 450);
  glow.addColorStop(0, '#20423d');
  glow.addColorStop(1, '#0e2229');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#bfd9c315';
  ctx.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x++) {
    ctx.beginPath();
    ctx.moveTo(x0 + x * cell, y0);
    ctx.lineTo(x0 + x * cell, y0 + HEIGHT * cell);
    ctx.stroke();
  }
  for (let y = 0; y <= HEIGHT; y++) {
    ctx.beginPath();
    ctx.moveTo(x0, y0 + y * cell);
    ctx.lineTo(x0 + WIDTH * cell, y0 + y * cell);
    ctx.stroke();
  }
  ctx.strokeStyle = '#639d8a';
  ctx.strokeRect(x0 - 3, y0 - 3, WIDTH * cell + 6, HEIGHT * cell + 6);
  s.body.forEach(([x, y], i) => {
    ctx.fillStyle = i === 0 ? '#eaf6cc' : i % 2 ? '#91cab0' : '#7bbda5';
    ctx.fillRect(x0 + x * cell + 2, y0 + y * cell + 2, cell - 4, cell - 4);
  });
  const [hx, hy] = s.body[0],
    [dx, dy] = dirs[s.direction];
  ctx.fillStyle = '#163f3d';
  for (const side of [-1, 1])
    ctx.fillRect(
      x0 + hx * cell + 12 + dx * 6 + (dy ? side * 5 : 0),
      y0 + hy * cell + 12 + dy * 6 + (dx ? side * 5 : 0),
      4,
      4,
    );
  const [fx, fy] = s.food,
    news = s.eaten % 4 === 3;
  ctx.save();
  ctx.translate(x0 + (fx + 0.5) * cell, y0 + (fy + 0.5) * cell);
  ctx.fillStyle = news ? '#ead398' : '#c7b9f1';
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 18;
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-7, -7, 14, 14);
  ctx.restore();
  if (news) {
    ctx.fillStyle = '#e7d2a1';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NEWS', x0 + (fx + 0.5) * cell, y0 + fy * cell - 6);
  }
}
