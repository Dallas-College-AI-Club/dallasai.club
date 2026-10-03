import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveries } from '../../static/storage/discoveries.js';

test('discoveries award once per location, survive reloads, and merge other tabs', () => {
  let saved = null;
  const storage = () => ({
    getItem: () => saved,
    setItem: (_, value) => {
      saved = value;
    },
  });
  const first = createDiscoveries(storage),
    second = createDiscoveries(storage);
  assert.equal(first.claim('snake').total, 25);
  assert.equal(first.claim('snake').added, false);
  assert.equal(second.claim('drive').total, 50);
  assert.equal(first.claim('ride').total, 75);
  assert.equal(createDiscoveries(storage).claim('arcade').total, 100);
  assert.equal(first.claim('footer').total, 100);
  assert.equal(first.claim('unknown').added, false);
});

test('blocked storage keeps one-time rewards in memory and reports the limitation', () => {
  const discoveries = createDiscoveries(() => {
    throw new Error('Storage blocked');
  });
  assert.equal(discoveries.claim('snake').total, 25);
  assert.equal(discoveries.claim('snake').added, false);
  assert.equal(discoveries.read().persistent, false);
});

test('damaged storage recovers without trusting unknown or repeated discoveries', () => {
  let saved = '{broken';
  const discoveries = createDiscoveries(() => ({
    getItem: () => saved,
    setItem: (_, value) => {
      saved = value;
    },
  }));
  assert.equal(discoveries.read().total, 0);
  assert.equal(discoveries.claim('ride').persistent, true);
  saved = '["snake","snake","unknown"]';
  assert.equal(discoveries.read().total, 50);
});
