import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { RECORDINGS, INTRO_SECONDS, replayMarkup } from '../public/projects/chatbot.js';
import { stationUpdates, updateRewardKey } from '../public/drive/station-news.js';
import { DriveScore } from '../public/drive/score.js';
const source = JSON.parse(
  await fs.readFile(new URL('./fixtures/chatbot-responses.json', import.meta.url), 'utf8'),
);
assert.equal(RECORDINGS.length, 9);
assert.equal(new Set(RECORDINGS.map((c) => c.lang)).size, 9);
assert.equal(RECORDINGS[0].q, 'what do i take for my first semester?');
assert.ok(INTRO_SECONDS > 0 && INTRO_SECONDS < 9);
for (const c of RECORDINGS) {
  assert.equal(c.a, source.replies.find((r) => r.lang === c.lang).a);
  assert.ok(c.duration < 18);
  assert.ok((await fs.stat(new URL('../public/' + c.src, import.meta.url))).size > 10000);
  assert.ok((await fs.stat(new URL('../public/' + c.poster, import.meta.url))).size > 1000);
}
const markup = replayMarkup();
assert.equal((markup.match(/data-recording=/g) || []).length, 9);
assert.ok(!markup.includes('replay-pause'));
assert.ok(!markup.includes('replay-restart'));
assert.ok(!/\scontrols(?:\s|>)/.test(markup));
assert.ok(markup.includes('https://major-demo-chi.vercel.app/'));
const score = new DriveScore({ edges: [], nodes: [] });
let total = 0;
for (const id of ['journal', 'projects', 'events', 'lab', 'join']) {
  const list = stationUpdates(id);
  assert.ok(list.length >= 2);
  assert.equal(new Set(list.map((n) => n.id)).size, list.length);
  score.collected.add(updateRewardKey(list[0]));
  for (const news of list.slice(1)) {
    assert.ok(news.title && news.body && news.mode);
    total += score.bonus(updateRewardKey(news), 30);
  }
  for (const news of list) assert.equal(score.bonus(updateRewardKey(news), 30), 0);
}
assert.equal(score.points, total);
const restored = new DriveScore({ edges: [], nodes: [] });
restored.restore(score.snapshot());
for (const n of stationUpdates('journal')) assert.equal(restored.bonus(updateRewardKey(n), 30), 0);
assert.deepEqual(
  stationUpdates('journal').map((x) => x.article),
  ['confidence-and-correctness', 'a-smaller-question', 'what-the-data-leaves-out'],
);
assert.equal(stationUpdates('lab')[1].mode, 'ethics');
console.log(
  'PASS: nine real UI recordings, short first-semester replies, clickable languages, no replay controls; all five station carousels, correct article/experiment routes, one-time next-update rewards and persistence.',
);
