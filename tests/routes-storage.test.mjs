import assert from 'node:assert/strict';
import { routeFromUrl } from '../public/app/routes.js';
import { readRun, writeRun, visitSavedPage } from '../public/storage/drive.js';
assert.deepEqual(routeFromUrl('club.html?mode=events&event=git#details'), {
  mode: 'events',
  event: 'git',
  article: null,
  anchor: 'details',
});
assert.equal(routeFromUrl('club.html?mode=projects#career%20title').anchor, 'career title');
assert.doesNotThrow(() => routeFromUrl('club.html#%E0%A4%A'));
assert.equal(routeFromUrl('club.html?mode=article&article=2').article, 2);
assert.equal(
  routeFromUrl('club.html?mode=article&article=a-smaller-question&motion=off#article-references')
    .article,
  'a-smaller-question',
);
assert.equal(routeFromUrl('club.html?mode=article&article=').article, '');
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() {
    throw new Error('Storage disabled');
  },
});
try {
  assert.equal(readRun(), null);
  assert.equal(writeRun({}), false);
  assert.doesNotThrow(() => visitSavedPage('journal'));
} finally {
  if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
  else delete globalThis.localStorage;
}
console.log(
  'PASS: deep links and malformed hashes, plus blocked-storage startup and persistence fallbacks.',
);
