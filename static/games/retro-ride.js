export function createState() {
  return {
    version: 1,
    phase: 'ready',
    distance: 0,
    score: 0,
    scoreRemainder: 0,
    newsRead: [],
    lane: 2,
    displayLane: 2,
    speed: 0,
    heat: 0,
    jump: 0,
    velocity: 0,
    checkpoints: 0,
    nextCheckpoint: 1200,
    hit: 0,
    clock: 0,
    obstacles: {},
    boost: false,
  };
}
export function restore(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    ![
      'distance',
      'score',
      'lane',
      'displayLane',
      'speed',
      'heat',
      'jump',
      'velocity',
      'checkpoints',
      'nextCheckpoint',
      'hit',
      'clock',
    ].every((k) => Number.isFinite(raw[k])) ||
    raw.distance < 0 ||
    raw.lane < 0 ||
    raw.lane > 3 ||
    raw.heat < 0 ||
    raw.heat > 100
  )
    return createState();
  return {
    ...createState(),
    ...raw,
    boost: false,
    obstacles: raw.obstacles && typeof raw.obstacles === 'object' ? raw.obstacles : {},
    scoreRemainder: Number.isFinite(raw.scoreRemainder) ? raw.scoreRemainder : 0,
    newsRead: Array.isArray(raw.newsRead) ? raw.newsRead.filter(Number.isInteger) : [],
    phase: raw.phase === 'ready' ? 'ready' : 'paused',
  };
}
export function input(s, key, held = true) {
  if (key === 'up' && held) s.lane = Math.max(0, s.lane - 1);
  if (key === 'down' && held) s.lane = Math.min(3, s.lane + 1);
  if (key === 'boost') s.boost = held;
}
export function obstacle(n) {
  return {
    x: 150 + n * 135,
    lane: (n * 7 + 2) % 4,
    kind: n % 3 === 0 ? 'ramp' : n % 3 === 1 ? 'mud' : 'barrier',
  };
}
export const multiplier = (s) => Math.max(1, Math.min(2.5, s.speed / 160));
export const paceLabel = (s) =>
  `${Math.round(s.speed)} speed · ${multiplier(s).toFixed(1)}× points`;
function distanceScore(s, amount) {
  s.scoreRemainder = (s.scoreRemainder || 0) + amount;
  const whole = Math.floor(s.scoreRemainder);
  s.score += whole;
  s.scoreRemainder -= whole;
}
export function step(s, dt) {
  if (s.phase !== 'running') return;
  dt = Math.min(dt, 0.05);
  s.clock += dt;
  s.hit = Math.max(0, s.hit - dt);
  s.heat = Math.max(0, Math.min(100, s.heat + dt * (s.boost ? 27 : -24)));
  if (s.heat >= 100) {
    s.boost = false;
    s.hit = 1.5;
  }
  const cruise = Math.min(215, 160 + s.checkpoints * 7),
    speed = s.hit ? 70 : s.boost ? Math.min(320, cruise * 1.55) : cruise;
  s.speed += (speed - s.speed) * Math.min(1, dt * 4);
  const before = s.distance;
  s.distance += s.speed * dt;
  distanceScore(s, s.speed * dt * 0.12 * multiplier(s));
  s.displayLane += (s.lane - s.displayLane) * Math.min(1, dt * 11);
  if (s.jump > 0 || s.velocity > 0) {
    s.velocity -= 230 * dt;
    s.jump = Math.max(0, s.jump + s.velocity * dt);
  }
  for (
    let n = Math.max(0, Math.floor((before - 150) / 135) - 1);
    n < Math.ceil((s.distance + 150) / 135);
    n++
  ) {
    const o = obstacle(n);
    if (o.x <= before || o.x > s.distance || s.obstacles[n]) continue;
    s.obstacles[n] = true;
    if (Math.abs(s.displayLane - o.lane) < 0.55) {
      if (o.kind === 'ramp') {
        s.velocity = 95;
        s.score += Math.round(40 * multiplier(s));
      } else if (s.jump < 14) {
        s.hit = 1;
        s.score = Math.max(0, s.score - 10);
      } else s.score += Math.round(30 * multiplier(s));
    } else s.score += Math.round(15 * multiplier(s));
  }
  if (s.distance >= s.nextCheckpoint && s.jump <= 0) {
    s.checkpoints++;
    s.score += 100;
    s.nextCheckpoint += 1200;
  }
  for (const n in s.obstacles) if (obstacle(+n).x < s.distance - 400) delete s.obstacles[n];
}
export const checkpointLabel = (s) => `PIT STOP ${s.checkpoints}`;
export const stat = (s) =>
  s.phase === 'checkpoint'
    ? `Pit stop ${s.checkpoints} · ${Math.floor(s.distance)} m traveled`
    : `${Math.floor(s.distance)} m · ${Math.max(0, Math.ceil(s.nextCheckpoint - s.distance))} m to the next discovery`;
export const help =
  'Your bike moves automatically. Change lanes with ↑ ↓ or W S. Hold Space to boost, then release to cool down. Ramps launch the bike; avoid barriers and mud. Speed increases your points multiplier. Every 1,200 m earns 100 bonus points and a club discovery without stopping your ride. Open discoveries whenever you like.';
function bike(c, x, y, color, tilt = 0, scale = 1) {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  c.rotate(tilt);
  c.fillStyle = '#172c3b';
  c.fillRect(-22, -8, 12, 15);
  c.fillRect(15, -8, 12, 15);
  c.fillStyle = '#e7dbc0';
  c.fillRect(-19, -5, 6, 9);
  c.fillRect(18, -5, 6, 9);
  c.strokeStyle = color;
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(-15, -2);
  c.lineTo(-4, -16);
  c.lineTo(21, -2);
  c.lineTo(8, -21);
  c.stroke();
  c.fillStyle = color;
  c.fillRect(-13, -24, 23, 8);
  c.fillStyle = '#f3ead2';
  c.fillRect(-6, -49, 15, 12);
  c.fillStyle = '#24394b';
  c.fillRect(1, -45, 9, 4);
  c.fillStyle = color;
  c.fillRect(-9, -35, 18, 15);
  c.fillStyle = '#203649';
  c.fillRect(-12, -19, 10, 13);
  c.fillStyle = '#eecbb0';
  c.fillRect(8, -31, 9, 5);
  c.restore();
}
export function draw(c, s, time = 0) {
  const w = c.canvas.width,
    h = 512,
    shift = s.distance;
  c.fillStyle = '#aacbc7';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#dae6d8';
  for (let i = 0; i < Math.ceil(w / 185) + 2; i++) {
    const x = ((((i * 185 - shift * 0.12) % (w + 260)) + (w + 260)) % (w + 260)) - 130;
    c.fillRect(x, 28 + (i % 2) * 20, 100, 12);
    c.fillRect(x + 20, 18 + (i % 2) * 20, 55, 16);
  }
  c.fillStyle = '#395966';
  c.fillRect(0, 98, w, 93);
  for (let row = 0; row < 5; row++)
    for (let i = 0; i < Math.ceil(w / 14) + 1; i++) {
      c.fillStyle = ['#b3cdac', '#cfaa8b', '#a6c2ce', '#d4c9b5'][(i * 3 + row) % 4];
      c.fillRect(i * 14 - 6, 105 + row * 14, 5, 7);
    }
  c.fillStyle = '#e2d3b9';
  c.fillRect(0, 179, w, 30);
  c.fillStyle = '#294655';
  c.font = 'bold 14px monospace';
  c.textAlign = 'left';
  for (let i = 0; i < Math.ceil(w / 340) + 1; i++)
    c.fillText('DALLAS COLLEGE  /  AI CLUB', i * 340 - ((shift * 0.25) % 340), 199);
  c.fillStyle = '#849a68';
  c.fillRect(0, 210, w, 26);
  c.fillStyle = '#c39164';
  c.fillRect(0, 236, w, 222);
  for (let lane = 0; lane < 4; lane++) {
    c.fillStyle = lane % 2 ? '#bf875e' : '#ca966b';
    c.fillRect(0, 238 + lane * 54, w, 52);
    c.strokeStyle = '#e9c79977';
    c.setLineDash([12, 12]);
    c.lineDashOffset = shift % 24;
    c.beginPath();
    c.moveTo(0, 289 + lane * 54);
    c.lineTo(w, 289 + lane * 54);
    c.stroke();
  }
  c.setLineDash([]);
  c.fillStyle = '#829564';
  c.fillRect(0, 458, w, 54);
  c.fillStyle = '#d7c9a3';
  for (let i = 0; i < Math.ceil(w / 36) + 1; i++) {
    const x = i * 36 - (shift % 36);
    c.fillRect(x, 223, 16, 7);
    c.fillRect(x, 470, 16, 7);
  }
  const pitX =
    150 + (s.phase === 'checkpoint' ? s.nextCheckpoint - 1200 : s.nextCheckpoint) - shift;
  if (pitX > -50 && pitX < w + 150) {
    c.fillStyle = '#edf0d9';
    c.fillRect(pitX - 3, 220, 6, 250);
    for (let j = 0; j < 20; j++) {
      c.fillStyle = j % 2 ? '#274b48' : '#dce0bd';
      c.fillRect(pitX - 3, 236 + j * 11, 6, 11);
    }
    c.fillStyle = '#2c514a';
    c.fillRect(pitX - 61, 195, 126, 32);
    c.fillStyle = '#edf0d9';
    c.font = 'bold 12px monospace';
    c.fillText('CLUB NEWS →', pitX - 51, 216);
  }
  const drawObstacle = (o) => {
    const x = 150 + o.x - shift,
      y = 270 + o.lane * 54;
    if (x < -100 || x > w + 100) return;
    if (o.kind === 'ramp') {
      c.fillStyle = '#e6c78b';
      c.beginPath();
      c.moveTo(x - 28, y + 5);
      c.lineTo(x + 16, y - 28);
      c.lineTo(x + 27, y + 5);
      c.fill();
      c.fillStyle = '#9f714d';
      c.fillRect(x + 18, y - 23, 8, 28);
    } else if (o.kind === 'mud') {
      c.fillStyle = '#70583f';
      c.fillRect(x - 24, y - 4, 48, 9);
      c.fillStyle = '#a57c56';
      c.fillRect(x - 13, y - 1, 19, 3);
    } else {
      c.fillStyle = '#e4ddc1';
      c.fillRect(x - 10, y - 18, 20, 20);
      c.fillStyle = '#c26651';
      c.fillRect(x - 10, y - 15, 20, 7);
    }
  };
  for (let n = Math.max(0, Math.floor((shift - 250) / 135)); n < Math.ceil((shift + w) / 135); n++)
    drawObstacle(obstacle(n));
  for (let i = 0; i < 2; i++) {
    const x = w * (0.6 + i * 0.22) - Math.sin(s.clock * 0.3 + i) * 110,
      y = 270 + ((i * 2 + 1) % 4) * 54;
    bike(c, x, y, i ? '#758cb7' : '#8ba777', -0.02, 0.84);
  }
  const y = 270 + s.displayLane * 54;
  c.fillStyle = '#513f393e';
  c.fillRect(126, y + 7, 50, 6);
  bike(
    c,
    150,
    y - s.jump,
    s.hit ? '#d89b8c' : '#f0d3a0',
    s.jump ? -Math.min(0.3, s.velocity * 0.002) : 0,
  );
  if (s.boost && s.phase === 'running') {
    c.fillStyle = '#f1d48f';
    c.fillRect(109, y - 9, 13 + Math.sin(time * 0.03) * 5, 4);
  }
  c.fillStyle = '#172b39';
  c.fillRect(22, 27, 146, 34);
  c.fillStyle = '#edf0d9';
  c.font = 'bold 15px monospace';
  c.fillText('LAP ' + String(s.checkpoints + 1).padStart(2, '0'), 37, 49);
  c.fillStyle = '#172b39';
  c.fillRect(w - 238, 27, 216, 34);
  c.fillStyle = '#afbaae';
  c.font = '11px monospace';
  c.fillText('ENGINE', w - 227, 48);
  c.fillStyle = '#4d645e';
  c.fillRect(w - 175, 39, 137, 9);
  c.fillStyle = s.heat > 78 ? '#de9c80' : '#c2d9aa';
  c.fillRect(w - 175, 39, (137 * s.heat) / 100, 9);
}
