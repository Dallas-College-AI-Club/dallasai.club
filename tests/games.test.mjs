import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as bike from '../public/games/retro-ride.js';
import * as snake from '../public/games/snake.js';
import { advanceGame } from '../public/games/loop.js';
import { ScoreStore, centralDate } from '../server.mjs';
import { DriveScore } from '../public/drive/score.js';
import { stationNews } from '../public/drive/station-news.js';
import { readArcade, saveGame, markGame } from '../public/storage/games.js';
const memory = new Map(),
  storage = { getItem: (k) => memory.get(k) || null, setItem: (k, v) => memory.set(k, v) };
const run = bike.createState();
run.score = 123;
assert.ok(saveGame('ride', run, storage));
run.score = 23;
saveGame('ride', run, storage);
assert.equal(readArcade(storage).games.ride.best, 123);
assert.equal(readArcade(storage).games.ride.state.score, 23);
markGame('snake', storage);
assert.equal(readArcade(storage).games.ride.best, 123);
assert.equal(readArcade(storage).last, 'snake');
assert.equal(
  saveGame('ride', run, {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
  }),
  false,
);
assert.deepEqual(readArcade({ getItem: () => '{broken' }), { version: 1, games: {}, last: null });
const newsScore = new DriveScore({ nodes: [], edges: [] });
assert.equal(newsScore.bonus('news-read:review', 30, 'Club news read'), 30);
assert.equal(newsScore.bonus('news-read:review', 30, 'Club news read'), 0);
const newsRestored = new DriveScore({ nodes: [], edges: [] });
newsRestored.restore(newsScore.snapshot());
assert.equal(
  newsRestored.bonus('news-read:review', 30, 'Club news read'),
  0,
  'Reading rewards survive page changes',
);
for (const station of ['journal', 'lab', 'projects', 'events', 'join']) {
  const news = stationNews(station);
  assert.ok(news.title && news.body && news.mode);
}
const simulate = (fps) => {
  const s = bike.createState();
  s.phase = 'running';
  let remainder = 0;
  for (let i = 0; i < fps * 20; i++) remainder = advanceGame(bike, s, 1 / fps, remainder);
  return s;
};
const fast = simulate(120);
for (const fps of [15, 30, 60]) {
  const s = simulate(fps);
  assert.ok(Math.abs(s.distance - fast.distance) < 0.00001, `${fps} fps movement`);
  assert.equal(s.score, fast.score, `${fps} fps scoring`);
  assert.equal(s.checkpoints, fast.checkpoints);
}
assert.ok(fast.checkpoints >= 2);
assert.equal(fast.phase, 'running', 'News never stops the bike');
const slow = bike.createState(),
  boost = bike.createState();
for (const s of [slow, boost]) {
  s.phase = 'running';
  s.lane = s.displayLane = 0;
}
boost.boost = true;
for (let i = 0; i < 180; i++) {
  bike.step(slow, 1 / 120);
  bike.step(boost, 1 / 120);
}
assert.ok(boost.distance > slow.distance);
assert.ok(boost.score > slow.score, 'Faster driving earns more');
bike.input(boost, 'boost', false);
assert.equal(boost.boost, false);
boost.phase = 'paused';
const stopped = boost.distance;
advanceGame(bike, boost, 10);
assert.equal(boost.distance, stopped);
const ramp = bike.createState();
Object.assign(ramp, { phase: 'running', distance: 148, speed: 160 });
bike.step(ramp, 0.04);
assert.ok(ramp.velocity > 0);
for (let i = 0; i < 140; i++) bike.step(ramp, 1 / 120);
assert.equal(ramp.jump, 0);
const heat = bike.createState();
heat.phase = 'running';
heat.boost = true;
for (let i = 0; i < 500; i++) bike.step(heat, 1 / 120);
assert.equal(heat.boost, false);
assert.ok(heat.heat <= 100);
const s = snake.createState();
s.phase = 'running';
snake.input(s, 'left');
assert.equal(s.queue.length, 0);
snake.input(s, 'up');
snake.input(s, 'right');
snake.input(s, 'down');
assert.equal(s.queue.length, 2);
snake.step(s, snake.interval(s));
assert.deepEqual(s.body[0], [10, 7]);
snake.step(s, snake.interval(s));
assert.deepEqual(s.body[0], [11, 7]);
const grow = snake.createState();
Object.assign(grow, { phase: 'running', eaten: 3, food: [11, 8] });
snake.step(grow, snake.interval(grow));
assert.equal(grow.checkpoints, 1);
assert.equal(grow.phase, 'running', 'News never stops Snake');
assert.ok(grow.score >= 120);
assert.ok(!grow.body.some((p) => p.join() === grow.food.join()));
const low = snake.createState(),
  high = snake.createState();
for (const item of [low, high]) {
  item.phase = 'running';
  item.food = [11, 8];
}
high.eaten = 12;
snake.step(low, snake.interval(low));
snake.step(high, snake.interval(high));
assert.ok(high.score > low.score);
assert.ok(snake.interval(high) < snake.interval(low));
const wall = snake.createState();
Object.assign(wall, {
  phase: 'running',
  body: [
    [23, 8],
    [22, 8],
    [21, 8],
  ],
});
snake.step(wall, 0.15);
assert.equal(wall.phase, 'over');
const tail = snake.createState();
Object.assign(tail, {
  phase: 'running',
  direction: 'down',
  body: [
    [4, 4],
    [4, 3],
    [3, 3],
    [3, 4],
  ],
});
snake.input(tail, 'left');
snake.step(tail, 0.15);
assert.equal(tail.phase, 'running');
const self = snake.createState();
Object.assign(self, {
  phase: 'running',
  body: [
    [4, 4],
    [4, 3],
    [5, 3],
    [5, 4],
    [5, 5],
    [4, 5],
  ],
});
snake.step(self, 0.15);
assert.equal(self.phase, 'over');
for (const engine of [bike, snake]) {
  const state = engine.createState();
  state.phase = 'checkpoint';
  state.checkpoints = 2;
  const restored = engine.restore(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.phase, 'paused', 'Old forced checkpoints migrate safely');
  assert.deepEqual(restored.newsRead, []);
}
assert.equal(snake.restore({ ...snake.createState(), seed: null }).phase, 'ready');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'club-rankings-')),
  file = path.join(dir, 'scores.json');
let now = new Date('2026-09-11T17:00:00Z');
const store = new ScoreStore(file, { now: () => now });
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
try {
  await fs.writeFile(
    file,
    JSON.stringify([
      { playerId: id(99), nickname: 'Legacy', score: 30, savedAt: '2026-09-10T19:00:00Z' },
    ]),
  );
  for (let i = 1; i <= 15; i++)
    await store.save({ playerId: id(i), nickname: 'Player ' + i, game: 'ride', score: i * 10 });
  await store.save({ playerId: id(1), nickname: 'Player 1', game: 'snake', score: 900 });
  const top = await store.list({ game: 'ride', date: '2026-09-11' });
  assert.equal(top.length, 10);
  assert.equal(top[0].score, 150);
  assert.equal((await store.list({ game: 'snake', date: '2026-09-11' })).length, 1);
  assert.equal((await store.list({ game: 'explore', date: 'all' }))[0].nickname, 'Legacy');
  now = new Date('2026-09-12T17:00:00Z');
  await store.save({ playerId: id(15), nickname: 'Player 15', game: 'ride', score: 200 });
  assert.equal((await store.list({ game: 'ride', date: '2026-09-11' }))[0].score, 150);
  assert.equal((await store.list({ game: 'ride', date: '2026-09-12' }))[0].score, 200);
  assert.equal(
    (await store.list({ game: 'ride' })).filter((e) => e.nickname === 'Player 15').length,
    1,
  );
  assert.equal(centralDate(new Date('2026-09-12T02:00:00Z')), '2026-09-11');
  await assert.rejects(() =>
    store.save({ playerId: id(1), nickname: 'Okay', game: 'invalid', score: 10 }),
  );
} finally {
  await fs.rm(file, { force: true });
  await fs.rm(file + '.tmp', { force: true });
  await fs.rmdir(dir);
}
console.log(
  'PASS: 15/30/60/120 fps parity; continuous discoveries; speed bonuses; ramps, heat, input, wall/tail collisions; save migration; independent game/date top 10, legacy scores and Central Time.',
);
