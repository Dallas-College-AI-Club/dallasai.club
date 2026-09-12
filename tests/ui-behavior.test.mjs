import assert from 'node:assert/strict';
import test from 'node:test';
import { mountRankings } from '../public/games/rankings.js';
import { DriveWorld } from '../public/drive/world.js';
import { mountTouchDrive } from '../public/drive/touch.js';
import { mountReplay as mountProjectReplay } from '../public/projects/chatbot.js';
import { mountReplay as mountDesktopReplay } from '../public/desktop/replay.js';
import { StationNewsBubble } from '../public/drive/station-news.js';
import { clubBulletins } from '../public/games/news.js';
import { EVENTS } from '../public/content/club.js';
import { articles } from '../public/content/articles.js';

function globals(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
}

function element() {
  const attributes = new Map(),
    classes = new Set();
  return Object.assign(new EventTarget(), {
    style: { setProperty() {} },
    dataset: {},
    value: '',
    textContent: '',
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    removeAttribute: (name) => attributes.delete(name),
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle(name, value = !classes.has(name)) {
        if (value) classes.add(name);
        else classes.delete(name);
        return value;
      },
    },
    replaceChildren() {},
    append() {},
    before() {},
    focus() {},
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 180 }),
  });
}

test('empty event and article catalogs leave Drive stations and game discoveries usable', () => {
  const events = EVENTS.splice(0),
    publication = articles.splice(0);
  try {
    for (const [id, title] of [
      ['events', 'Events'],
      ['journal', 'The AI Review'],
    ]) {
      const bubble = {
        node: { hidden: true },
        reopen: {},
        indices: new Map(),
        journey: { world: { experience: {} } },
        render() {},
        renderNext() {},
      };
      StationNewsBubble.prototype.show.call(bubble, {
        campus: { id: 'el-centro' },
        stop: { id, title },
      });
      assert.equal(bubble.items.length, 1);
      assert.equal(bubble.items[0].mode, id);
      assert.equal(bubble.items[0].title, title);
      assert.equal(bubble.index, 0);
    }
    const discoveries = clubBulletins();
    assert.ok(discoveries.length > 0);
    assert.ok(discoveries.every((news) => news.title && news.mode));
  } finally {
    EVENTS.push(...events);
    articles.push(...publication);
  }
});

test('rankings recover from malformed saved identities and block duplicate in-flight submissions', async (t) => {
  let savedIdentity = 'null',
    finishSave,
    submissions = 0,
    requests = 0;
  globals(t, {
    localStorage: {
      getItem: (key) =>
        key === 'dc-drive-player'
          ? savedIdentity
          : key === 'dc-arcade-v1'
            ? JSON.stringify({
                version: 1,
                last: 'snake',
                games: { snake: { state: { score: 20 } } },
              })
            : null,
      setItem() {},
    },
    fetch: async (url, options) => {
      requests++;
      if (options?.method === 'POST') {
        submissions++;
        return new Promise((resolve) => {
          finishSave = resolve;
        });
      }
      return { ok: true, json: async () => ({ entries: [] }) };
    },
  });
  const mount = (apiBaseURL = '/api') => {
    const nodes = new Map();
    const root = element();
    root.querySelector = (selector) => {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    };
    root.querySelector('#rank-game').value = 'snake';
    return { root, destroy: mountRankings(root, { open() {}, apiBaseURL }) };
  };
  for (const raw of [
    'null',
    '42',
    'true',
    '[]',
    '"nickname"',
    '{broken',
    '{"nickname":{},"id":42}',
  ]) {
    savedIdentity = raw;
    const { root, destroy } = mount();
    assert.equal(root.querySelector('#rank-nickname').value, '', raw);
    destroy();
  }
  savedIdentity = '{"nickname":"Club player","id":"invalid"}';
  const { root, destroy } = mount();
  assert.equal(root.querySelector('#rank-nickname').value, 'Club player');
  const submit = () => root.querySelector('#rank-submit').onsubmit({ preventDefault() {} });
  const pending = submit();
  assert.equal(root.querySelector('#rank-save').disabled, true);
  await root.querySelector('#rank-refresh').onclick();
  assert.equal(root.querySelector('#rank-save').disabled, true);
  await submit();
  assert.equal(submissions, 1);
  finishSave({ ok: true });
  await pending;
  assert.equal(root.querySelector('#rank-save').disabled, false);
  assert.equal(root.querySelector('#rank-status').textContent, 'Score saved for Club player.');
  destroy();
  const previousRequests = requests;
  const deferred = mount('');
  assert.equal(deferred.root.querySelector('#rank-submit').hidden, true);
  assert.equal(deferred.root.querySelector('#rank-save').disabled, true);
  assert.match(
    deferred.root.querySelector('#rank-empty').textContent,
    /Shared rankings are coming later/,
  );
  await deferred.root.querySelector('#rank-submit').onsubmit({ preventDefault() {} });
  assert.equal(requests, previousRequests, 'deferred rankings make no network requests');
  assert.equal(deferred.root.querySelector('#rank-my-score').textContent, '20');
  deferred.destroy();
});

test('Drive controls preserve browser shortcuts and avoid repeated camera/reset actions', (t) => {
  const listeners = {},
    canvas = element();
  globals(t, {
    window: {
      addEventListener: (type, handler) => {
        listeners[type] = handler;
      },
    },
    document: element(),
  });
  let resets = 0,
    views = 0,
    prevented = 0;
  const world = {
    active: true,
    keys: {},
    canvas,
    startDriving() {},
    reset: () => resets++,
    setView: () => views++,
  };
  DriveWorld.prototype.controls.call(world);
  const key = (key, extra = {}) =>
    listeners.keydown({
      key,
      target: { closest: () => null },
      preventDefault: () => prevented++,
      ...extra,
    });
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    key('r', { [modifier]: true });
    key('a', { [modifier]: true });
  }
  assert.equal(resets, 0);
  assert.deepEqual(world.keys, {});
  assert.equal(prevented, 0);
  key('m');
  key('m', { repeat: true });
  key('r');
  key('r', { repeat: true });
  assert.equal(views, 1);
  assert.equal(resets, 1);
  key('ArrowUp');
  assert.equal(world.keys.arrowup, true);
  assert.equal(prevented, 1);
});

test('leaving expanded Drive resets the visible label and pressed state before returning', (t) => {
  const body = element(),
    controls = element(),
    full = element();
  controls.querySelector = () => element();
  let observe;
  globals(t, {
    document: Object.assign(element(), {
      body,
      createElement: (tag) => (tag === 'button' ? full : controls),
    }),
    window: element(),
    MutationObserver: class {
      constructor(callback) {
        observe = callback;
      }
      observe() {}
    },
  });
  const world = { canvas: { parentElement: element() }, keys: {}, resize() {} };
  mountTouchDrive(world);
  body.dataset.space = 'explore';
  full.onclick();
  assert.equal(full.textContent, 'Exit full view');
  assert.equal(full.getAttribute('aria-pressed'), 'true');
  body.dataset.space = 'projects';
  observe();
  assert.equal(body.classList.contains('immersive-drive'), false);
  assert.equal(full.textContent, 'Expand view');
  assert.equal(full.getAttribute('aria-pressed'), 'false');
});

for (const surface of ['project', 'desktop']) {
  test(`${surface} recordings pause immediately when the visitor switches motion off`, (t) => {
    const document = Object.assign(element(), {
      body: element(),
      hidden: false,
      createElement: element,
    });
    const video = Object.assign(element(), {
      poster: 'poster.jpg',
      duration: 17,
      paused: true,
      play() {
        this.paused = false;
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
      },
      load() {},
    });
    const nodes = new Map([['video', video]]);
    const root = element();
    root.querySelector = (selector) => {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    };
    let visible;
    globals(t, {
      document,
      matchMedia: () => Object.assign(element(), { matches: false }),
      IntersectionObserver: class {
        constructor(callback) {
          visible = callback;
        }
        observe() {}
        disconnect() {}
      },
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    });
    const playback =
      surface === 'project'
        ? mountProjectReplay({ querySelectorAll: () => [root] })
        : mountDesktopReplay(
            root,
            [
              {
                lang: 'en',
                english: 'English',
                src: 'tour.mp4',
                poster: 'poster.jpg',
                startPoster: 'start.jpg',
              },
            ],
            2,
          );
    visible([{ isIntersecting: true }]);
    if (surface === 'project') video.onloadedmetadata();
    else video.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(video.paused, false);
    document.dispatchEvent(Object.assign(new Event('club:motion'), { detail: { reduced: true } }));
    assert.equal(video.paused, true);
    if (surface === 'project') playback();
    else playback.destroy();
  });
}
