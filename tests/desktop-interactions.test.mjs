import assert from 'node:assert/strict';
import test from 'node:test';
import { mountDesktop } from '../public/desktop/windows.js';
import { apps, latestApps } from '../public/desktop/views.js';
import { mountLatest } from '../public/pages/latest.js';
import { PUBLISHED } from '../public/content/published.js';

function desktop(t, mount = mountDesktop, globals = {}) {
  const document = new EventTarget(),
    window = Object.assign(new EventTarget(), {
      innerWidth: 1350,
      innerHeight: 1272,
      matchMedia: () => ({ matches: false }),
      scrollTo() {},
    }),
    timers = new Set();
  function element(selectors = [], parent = null) {
    const classes = new Set(),
      attributes = new Map(),
      captures = new Set();
    return Object.assign(new EventTarget(), {
      parent,
      selectors,
      dataset: {},
      hidden: false,
      style: {
        setProperty(name, value) {
          this[name] = value;
        },
        removeProperty(name) {
          delete this[name];
        },
      },
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        contains: (name) => classes.has(name),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle(name, enabled = !classes.has(name)) {
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
      },
      closest(selector) {
        return selector.split(',').some((part) => selectors.includes(part))
          ? this
          : parent?.closest(selector) || null;
      },
      contains(target) {
        return target === this || (target?.parent ? this.contains(target.parent) : false);
      },
      getBoundingClientRect() {
        return this.rect || { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
      },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
      setPointerCapture: (id) => captures.add(id),
      hasPointerCapture: (id) => captures.has(id),
      releasePointerCapture: (id) => captures.delete(id),
      focus() {
        document.activeElement = this;
      },
      scrollIntoView() {},
    });
  }
  const shell = element(),
    workspace = { clientWidth: 1350, clientHeight: 1234 },
    start = element(['.r95-start']),
    toggle = element(['.r95-show-desktop']),
    arrange = element(['[data-arrange]']),
    menu = Object.assign(element(['.r95-start-menu']), { hidden: true }),
    folder = element(['.r95-start-folder'], menu),
    projects = element(['.r95-start-projects', '.r95-start-item', 'button'], folder),
    projectMenu = Object.assign(element(['.r95-project-menu'], folder), { hidden: true }),
    projectLinks = Array.from({ length: 7 }, () =>
      element(['a', '.r95-project-link'], projectMenu),
    ),
    mainItems = [
      element(['a', '.r95-start-item'], menu),
      projects,
      element(['a', '.r95-start-item'], menu),
    ],
    links = mainItems.filter((item) => item !== projects);
  start.rect = { left: 0, top: 1234, right: 100, bottom: 1272, width: 100, height: 38 };
  projectMenu.querySelectorAll = () => projectLinks;
  projectMenu.querySelector = () => projectLinks[0];
  menu.querySelector = (selector) =>
    ({ '.r95-start-projects': projects, '.r95-project-menu': projectMenu })[selector] ||
    mainItems[0];
  menu.querySelectorAll = (selector) =>
    selector === '.r95-start-item' ? mainItems : [...links, ...projectLinks];
  const windows = apps.map(({ id }) => {
    const node = element(['[data-window]']);
    node.dataset = { window: id, state: latestApps.includes(id) ? 'open' : 'closed' };
    node.hidden = !latestApps.includes(id);
    const titlebar = element(['.r95-titlebar'], node),
      title = element(['.r95-titlebar h2'], titlebar),
      resize = element(['.r95-resize'], node);
    node.controls = Object.fromEntries(
      ['minimize', 'maximize', 'close'].map((action) => {
        const button = element(['[data-window-action]', 'button'], node);
        button.dataset.windowAction = action;
        return [action, button];
      }),
    );
    Object.assign(node, { titlebar, title, resize });
    node.querySelector = (selector) =>
      selector === 'h2' ? title : selector === 'video' ? null : node.controls.maximize;
    for (const [property, style] of Object.entries({
      offsetLeft: 'left',
      offsetTop: 'top',
      offsetWidth: 'width',
      offsetHeight: 'height',
    }))
      Object.defineProperty(node, property, { get: () => parseFloat(node.style[style]) || 0 });
    return node;
  });
  const tasks = apps.map(({ id }) =>
      Object.assign(element(['[data-task]']), { dataset: { task: id } }),
    ),
    icons = apps.map(({ id }) =>
      Object.assign(element(['[data-open]']), { dataset: { open: id } }),
    ),
    nodes = new Map(
      Object.entries({
        '.r95-shell': shell,
        '.r95-workspace': workspace,
        '.r95-start': start,
        '.r95-start-menu': menu,
        '.r95-show-desktop': toggle,
        '.r95-start-projects': projects,
        '.r95-project-menu': projectMenu,
      }),
    );
  const root = Object.assign(element(), {
    querySelector(selector) {
      // Recording playback is covered separately; this fixture isolates windows and refreshes.
      if (selector === 'video') return null;
      const id = selector.match(/^\[data-window="([^"]+)"\]$/)?.[1];
      if (id) return windows.find((node) => node.dataset.window === id);
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll: (selector) =>
      ({ '[data-window]': windows, '[data-task]': tasks, '[data-open]': icons })[selector],
  });
  const originals = new Map();
  for (const [name, value] of Object.entries({
    document,
    window,
    setInterval: (callback) => {
      timers.add(callback);
      return callback;
    },
    clearInterval: (callback) => timers.delete(callback),
    ...globals,
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const stop = mount(root);
  let disposed = false;
  const dispose = () => {
    if (!disposed) stop();
    disposed = true;
  };
  t.after(() => {
    dispose();
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    }
  });
  return {
    root,
    window,
    document,
    menu,
    mainItems,
    projects,
    projectMenu,
    projectLinks,
    start,
    toggle,
    arrange,
    timers,
    dispose,
    get: (id) => windows.find((node) => node.dataset.window === id),
    task: (id) => tasks.find((node) => node.dataset.task === id),
    icon: (id) => icons.find((node) => node.dataset.open === id),
    event(type, target, extra = {}, dispatcher = shell) {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { button: 0, pointerId: 1, clientX: 0, clientY: 0, ...extra });
      Object.defineProperty(event, 'target', { value: target });
      dispatcher.dispatchEvent(event);
      return event;
    },
  };
}

test('desktop minimize, task restore, close and icon reopen retain distinct states', (t) => {
  const app = desktop(t),
    events = app.get('events');
  app.event('click', events.controls.minimize);
  assert.equal(events.hidden, true);
  assert.equal(app.task('events').hidden, false);
  assert.equal(events.dataset.state, 'minimized');
  app.event('click', app.task('events'));
  assert.equal(events.hidden, false);
  assert.equal(app.document.activeElement, events.title);
  app.event('click', events.controls.close);
  assert.equal(events.dataset.state, 'closed');
  assert.equal(app.task('events').hidden, true);
  app.event('click', app.icon('events'));
  assert.equal(events.hidden, false);
  assert.equal(app.task('events').hidden, false);
  assert.equal(events.dataset.state, 'open');
});

test('desktop cleanup cancels its clock and stops window input and resize reactions', (t) => {
  const app = desktop(t),
    events = app.get('events');
  app.event('pointerdown', events.titlebar, { clientX: 10 });
  assert.equal(events.titlebar.hasPointerCapture(1), true);
  assert.equal(app.timers.size, 1);
  app.dispose();
  assert.equal(events.titlebar.hasPointerCapture(1), false);
  assert.equal(app.timers.size, 0);
  const left = events.style.left;
  app.event('pointermove', events.titlebar, { clientX: 100 });
  app.event('click', events.controls.close);
  app.window.innerWidth = 900;
  app.window.dispatchEvent(new Event('resize'));
  assert.equal(events.style.left, left);
  assert.equal(events.hidden, false);
});

test('desktop cleanup closes both Start levels and detaches their interactions', (t) => {
  const app = desktop(t);
  app.event('click', app.start);
  app.event('keydown', app.projects, { key: 'ArrowRight' });
  assert.equal(app.menu.hidden, false);
  assert.equal(app.projectMenu.hidden, false);
  app.dispose();
  assert.equal(app.menu.hidden, true);
  assert.equal(app.projectMenu.hidden, true);
  app.event('click', app.start);
  app.event('pointerover', app.projects, { pointerType: 'mouse' });
  app.event('keydown', app.projects, { key: 'ArrowRight' });
  assert.equal(app.menu.hidden, true, 'the departed page must no longer react to Start clicks');
  assert.equal(app.projectMenu.hidden, true);
  assert.equal(app.projects.getAttribute('aria-expanded'), 'false');
});

test('desktop drag ignores release from an unrelated pointer', (t) => {
  const app = desktop(t),
    events = app.get('events'),
    left = events.offsetLeft;
  app.event('pointerdown', events.titlebar, { clientX: 10 });
  app.event('pointerdown', events.titlebar, { pointerId: 2, clientX: 200 });
  app.event('pointerup', events.titlebar, { pointerId: 2 });
  app.event('pointermove', events.titlebar, { clientX: 50 });
  assert.equal(events.offsetLeft, left + 40, 'another finger must not cancel the active drag');
});

test('Show desktop restores only windows that were visible before the toggle', (t) => {
  const app = desktop(t);
  app.event('click', app.get('events').controls.minimize);
  const visible = latestApps.filter((id) => !app.get(id).hidden);
  assert.equal(visible.length, 3);
  app.event('click', app.toggle);
  assert.ok(latestApps.every((id) => app.get(id).hidden));
  app.event('click', app.toggle);
  assert.deepEqual(
    latestApps.filter((id) => !app.get(id).hidden),
    visible,
  );
  assert.equal(
    app.get('events').dataset.state,
    'minimized',
    'a previously minimized window stays minimized',
  );
});

test('Start and Projects keyboard navigation stays within the active menu level', (t) => {
  const app = desktop(t);
  app.event('click', app.start);
  assert.equal(app.document.activeElement, app.mainItems[0]);
  app.event('keydown', app.mainItems[0], { key: 'ArrowUp' });
  assert.equal(
    app.document.activeElement,
    app.mainItems.at(-1),
    'main navigation skips hidden project links',
  );
  app.projects.focus();
  app.event('keydown', app.projects, { key: 'ArrowRight' });
  assert.equal(app.projectMenu.hidden, false);
  assert.equal(app.projects.getAttribute('aria-expanded'), 'true');
  assert.equal(app.document.activeElement, app.projectLinks[0]);
  app.event('keydown', app.projectLinks[0], { key: 'ArrowUp' });
  assert.equal(app.document.activeElement, app.projectLinks.at(-1));
  app.event('keydown', app.projectLinks.at(-1), { key: 'Home' });
  assert.equal(app.document.activeElement, app.projectLinks[0]);
  app.event('keydown', app.projectLinks[0], { key: 'End' });
  assert.equal(app.document.activeElement, app.projectLinks.at(-1));
  app.event('keydown', app.projectLinks.at(-1), { key: 'ArrowLeft' });
  assert.equal(app.projectMenu.hidden, true);
  assert.equal(app.menu.hidden, false);
  assert.equal(app.document.activeElement, app.projects);
  app.event('keydown', app.projects, { key: 'ArrowRight' });
  app.event('keydown', app.projectLinks[0], { key: 'Escape' });
  assert.equal(app.projectMenu.hidden, true);
  assert.equal(app.menu.hidden, false);
  assert.equal(app.document.activeElement, app.projects);
  app.event('keydown', app.projects, { key: 'Escape' });
  assert.equal(app.menu.hidden, true);
  assert.equal(app.document.activeElement, app.start);
});

test('Start project selection and outside clicks close both menu levels', (t) => {
  const app = desktop(t);
  app.event('click', app.start);
  app.event('click', app.projects, { detail: 0 });
  assert.equal(app.projectMenu.hidden, false);
  const selection = app.event('click', app.projectLinks[0]);
  assert.equal(selection.defaultPrevented, false, 'the project link keeps its navigation action');
  assert.equal(app.menu.hidden, true);
  assert.equal(app.projectMenu.hidden, true);
  assert.equal(app.projects.getAttribute('aria-expanded'), 'false');
  app.event('click', app.start);
  app.event('pointerover', app.projects, { pointerType: 'mouse' });
  assert.equal(app.projectMenu.hidden, false);
  app.event('pointerdown', app.icon('events'), {}, app.document);
  assert.equal(app.menu.hidden, true);
  assert.equal(app.projectMenu.hidden, true);
  app.event('click', app.start);
  app.event('keydown', app.projects, { key: 'ArrowRight' });
  app.event('focusin', app.mainItems.at(-1));
  assert.equal(app.projectMenu.hidden, true, 'tabbing to another main item dismisses the submenu');
  assert.equal(app.menu.hidden, false);
  app.event('focusin', app.icon('events'));
  assert.equal(app.menu.hidden, true, 'moving focus into the desktop dismisses Start');
});

for (const screen of ['compact', 'coarse pointer']) {
  test(`Projects on a ${screen} screen opens only on explicit activation`, (t) => {
    const app = desktop(t);
    if (screen === 'compact') {
      app.window.innerWidth = 320;
      app.window.innerHeight = 740;
      app.window.dispatchEvent(new Event('resize'));
    } else app.window.matchMedia = () => ({ matches: true });
    app.event('click', app.start);
    app.event('pointerover', app.projects, { pointerType: 'mouse' });
    assert.equal(
      app.projectMenu.hidden,
      true,
      'hover must not move the inline menu before the click',
    );
    assert.equal(app.menu.hidden, false);
    app.event('click', app.projects, { detail: 1 });
    assert.equal(app.projectMenu.hidden, false);
    assert.equal(app.projects.getAttribute('aria-expanded'), 'true');
    assert.equal(app.menu.hidden, false, 'opening Projects must not select a destination');
    app.event('click', app.projects, { detail: 1 });
    assert.equal(app.projectMenu.hidden, true);
    assert.equal(app.projects.getAttribute('aria-expanded'), 'false');
    assert.equal(app.menu.hidden, false);
  });
}

test('leaving Latest aborts its pending refresh and ignores a late response', async (t) => {
  let finish,
    signal,
    requests = 0;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const app = desktop(t, mountLatest, {
    fetch: (url, options) => {
      assert.equal(url, 'latest.json');
      requests++;
      signal = options.signal;
      return pending;
    },
  });
  assert.equal(app.timers.size, 2, 'Latest owns one refresh interval and one desktop clock');
  app.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(app.timers.size, 0);
  app.root.innerHTML = '<h1>The next page</h1>';
  const indicator = app.root.querySelector('[data-freshness]');
  indicator.setAttribute('aria-label', 'Next page status');
  app.window.dispatchEvent(new Event('online'));
  app.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(requests, 1);
  // Resolve even after abort to exercise the race guard independently of fetch cancellation.
  finish({ ok: true, json: async () => PUBLISHED });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.root.innerHTML, '<h1>The next page</h1>');
  assert.equal(indicator.getAttribute('aria-label'), 'Next page status');
  assert.equal(app.timers.size, 0);
});

test('Latest keeps usable windows after a failed refresh and recovers when online', async (t) => {
  let requests = 0;
  const app = desktop(t, mountLatest, {
    fetch: async () => {
      requests++;
      if (requests === 1) throw new Error('Connection interrupted');
      return { ok: true, json: async () => PUBLISHED };
    },
  });
  const markup = app.root.innerHTML;
  app.event('click', app.start);
  await new Promise((resolve) => setImmediate(resolve));
  const indicator = app.root.querySelector('[data-freshness]');
  assert.equal(indicator.classList.contains('is-stale'), true);
  assert.equal(app.root.innerHTML, markup);
  assert.equal(app.menu.hidden, false);
  app.window.dispatchEvent(new Event('online'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 2);
  assert.equal(indicator.classList.contains('is-stale'), false);
  assert.equal(app.menu.hidden, false, 'refreshing must preserve the open Start menu');
});
