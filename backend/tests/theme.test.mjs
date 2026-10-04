import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL('../admin/theme.js', import.meta.url),
  'utf8',
);
function page(saved, dark = false, blocked = false) {
  const root = { dataset: {} },
    buttons = ['light', 'dark', 'system'].map((appearance) => ({
      dataset: { appearance },
      setAttribute(key, value) {
        this[key] = value;
      },
    })),
    media = { matches: dark };
  let ready, changed;
  runInNewContext(source, {
    matchMedia: () =>
      Object.assign(media, {
        addEventListener: (_, callback) => {
          changed = callback;
        },
      }),
    localStorage: {
      getItem() {
        if (blocked) throw Error('Blocked storage');
        return saved;
      },
      setItem(_, value) {
        if (blocked) throw Error('Blocked storage');
        saved = value;
      },
    },
    document: {
      documentElement: root,
      querySelectorAll: () => buttons,
      addEventListener: (_, callback) => {
        ready = callback;
      },
    },
  });
  const initial = root.dataset.theme;
  ready();
  return {
    initial,
    root,
    selected: () =>
      buttons
        .filter((button) => button['aria-pressed'] === 'true')
        .map((button) => button.dataset.appearance),
    saved: () => saved,
    choose(value) {
      buttons.find((button) => button.dataset.appearance === value).onclick();
    },
    system(value) {
      media.matches = value;
      changed();
    },
  };
}
test('saved appearance applies before page content and explicit modes ignore system changes', () => {
  const p = page('light', true);
  assert.equal(p.initial, 'light');
  assert.deepEqual(p.selected(), ['light']);
  p.choose('dark');
  assert.equal(p.root.dataset.theme, 'dark');
  assert.equal(p.saved(), 'dark');
  assert.deepEqual(p.selected(), ['dark']);
  p.system(false);
  assert.equal(p.root.dataset.theme, 'dark');
  assert.equal(page(p.saved(), false).initial, 'dark');
});
test('system appearance follows changes and invalid stored preferences reset to system', () => {
  const p = page('invalid', true);
  assert.equal(p.initial, 'dark');
  assert.deepEqual(p.selected(), ['system']);
  p.system(false);
  assert.equal(p.root.dataset.theme, 'light');
  p.choose('dark');
  p.choose('system');
  assert.equal(p.root.dataset.theme, 'light');
  assert.deepEqual(p.selected(), ['system']);
});
test('appearance still works when browser storage is blocked', () => {
  const p = page('dark', false, true);
  assert.equal(p.initial, 'light');
  p.choose('dark');
  assert.equal(p.root.dataset.theme, 'dark');
});
