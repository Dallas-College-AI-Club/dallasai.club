import assert from 'node:assert/strict';
import test from 'node:test';
import { mountGame } from '../public/games/player.js';
import { GAMES } from '../public/games/registry.js';
import * as ride from '../public/games/retro-ride.js';
import * as snake from '../public/games/snake.js';

function element(tagName = 'div') {
  const nodes = new Map(),
    attributes = new Map();
  return Object.assign(new EventTarget(), {
    tagName,
    innerHTML: '',
    textContent: '',
    hidden: false,
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll: () => [],
    closest: (selector) => (selector.split(',').includes(tagName) ? {} : null),
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    getBoundingClientRect: () => ({ width: 768, height: 512 }),
    getContext: () => ({}),
    focus() {},
    replaceChildren() {},
    append() {},
    insertAdjacentHTML(position, markup) {
      this.innerHTML += markup;
    },
  });
}

function harness(t, id, load) {
  const root = element(),
    document = new EventTarget(),
    window = new EventTarget();
  const memory = new Map(),
    frames = new Map(),
    observers = [];
  let frameId = 0,
    writes = 0;
  Object.assign(document, { body: element(), hidden: false, createElement: element });
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  const values = {
    document,
    window,
    localStorage: {
      getItem: (key) => memory.get(key) || null,
      setItem(key, value) {
        writes++;
        memory.set(key, value);
      },
    },
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (frame) => frames.delete(frame),
  };
  const originals = new Map();
  for (const [key, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    originals.set(key, original);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.mock.method(
    GAMES.find((game) => game.id === id),
    'load',
    load,
  );
  const cleanup = mountGame(root, id, { open() {} });
  let disposed = false;
  function dispose() {
    if (disposed) return;
    cleanup();
    disposed = true;
  }
  t.after(() => {
    dispose();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    }
  });
  return {
    root,
    document,
    window,
    frames,
    observers,
    dispose,
    writes: () => writes,
    saved: () => JSON.parse(memory.get('dc-arcade-v1')).games[id].state,
    key(key, target = root.querySelector('#retro-canvas')) {
      const event = new Event('keydown', { cancelable: true });
      Object.assign(event, { key });
      Object.defineProperty(event, 'target', { value: target });
      document.dispatchEvent(event);
      return event;
    },
  };
}

for (const [id, engine] of [
  ['ride', ride],
  ['snake', snake],
]) {
  test(`${id} starts only on request and pauses/saves when its tab is hidden`, async (t) => {
    const app = harness(t, id, () => Promise.resolve(engine));
    await Promise.resolve();
    assert.equal(app.saved().phase, 'ready');
    const start = app.root.querySelector('#game-pause');
    start.onclick();
    assert.equal(app.saved().phase, 'running');
    assert.equal(app.root.querySelector('#game-overlay').hidden, true);
    const input = element('input');
    assert.equal(app.key('ArrowUp', input).defaultPrevented, false);
    assert.equal(app.key('ArrowUp').defaultPrevented, true);
    if (id === 'ride') app.key(' ');
    app.document.hidden = true;
    app.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(app.saved().phase, 'paused');
    assert.equal(app.root.querySelector('#game-overlay').hidden, false);
    if (id === 'ride') {
      assert.equal(app.saved().lane, 1, 'one game-directed arrow changes one lane');
      assert.equal(app.saved().boost, false, 'hidden tabs must release a held boost');
    }
    const paused = app.saved();
    app.document.hidden = false;
    app.document.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(app.saved(), paused, 'returning to the tab does not silently resume play');
    start.onclick();
    assert.equal(app.saved().phase, 'running');
  });

  test(`${id} restarts from open instructions with only the introduction visible`, async (t) => {
    const app = harness(t, id, () => Promise.resolve(engine));
    await Promise.resolve();
    app.root.querySelector('#game-pause').onclick();
    const help = app.root.querySelector('#game-help'),
      instructions = app.root.querySelector('#game-instructions'),
      overlay = app.root.querySelector('#game-overlay');
    help.onclick({ currentTarget: help });
    assert.equal(instructions.hidden, false);
    assert.equal(help.getAttribute('aria-expanded'), 'true');
    assert.equal(overlay.hidden, true);
    app.root.querySelector('#game-restart').onclick();
    assert.equal(app.saved().phase, 'ready');
    assert.equal(instructions.hidden, true, 'instructions must not cover the new introduction');
    assert.equal(help.getAttribute('aria-expanded'), 'false');
    assert.equal(overlay.hidden, false);
    assert.equal(app.root.querySelector('#game-pause').textContent, 'Start game ▶');
  });

  test(`${id} pauses for a club overlay and resumes only when requested`, async (t) => {
    const app = harness(t, id, () => Promise.resolve(engine));
    await Promise.resolve();
    const start = app.root.querySelector('#game-pause');
    start.onclick();
    if (id === 'ride') app.key(' ');
    app.document.dispatchEvent(new Event('club:pause-games'));
    assert.equal(app.saved().phase, 'paused');
    assert.equal(app.root.querySelector('#game-overlay').hidden, false);
    if (id === 'ride') assert.equal(app.saved().boost, false);
    assert.equal(
      app.key('ArrowUp').defaultPrevented,
      false,
      'paused games do not consume navigation keys',
    );
    app.window.dispatchEvent(new Event('focus'));
    assert.equal(app.saved().phase, 'paused');
    start.onclick();
    assert.equal(app.saved().phase, 'running');
  });
}

test('leaving a running game cancels work and removes its global input listeners', async (t) => {
  const app = harness(t, 'ride', () => Promise.resolve(ride));
  await Promise.resolve();
  app.root.querySelector('#game-pause').onclick();
  assert.equal(app.frames.size, 1);
  app.dispose();
  assert.equal(app.saved().phase, 'paused');
  assert.equal(app.frames.size, 0);
  assert.ok(app.observers.every((observer) => observer.disconnected));
  const writes = app.writes();
  assert.equal(app.key('ArrowUp').defaultPrevented, false);
  app.window.dispatchEvent(new Event('blur'));
  app.window.dispatchEvent(new Event('pagehide'));
  app.document.hidden = true;
  app.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(app.writes(), writes, 'the abandoned game must stop writing saved state');
});

test('leaving before a game finishes loading cannot restart it or overwrite the next page', async (t) => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const app = harness(t, 'snake', () => pending);
  app.dispose();
  app.root.innerHTML = '<h1>Another page</h1>';
  finish(snake);
  await pending;
  await Promise.resolve();
  assert.equal(app.root.innerHTML, '<h1>Another page</h1>');
  assert.equal(app.frames.size, 0);
  assert.equal(app.writes(), 0);
  assert.ok(app.observers.every((observer) => observer.disconnected));
});
