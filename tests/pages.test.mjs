import assert from 'node:assert/strict';
import test from 'node:test';
import { articles } from '../public/content/articles.js';
import { EVENTS } from '../public/content/club.js';
import { renderPublication } from '../public/pages/review.js';
import { mountEvents } from '../public/pages/events.js';

function classes() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle: (name, enabled) => (enabled ? values.add(name) : values.delete(name)),
  };
}

function withGlobals(values, run) {
  const saved = Object.fromEntries(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  try {
    run();
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

// Capture output and event bindings; browser layout is checked separately.
function articleRoot() {
  const controls = new Map(),
    print = {};
  return {
    classList: classes(),
    innerHTML: '',
    insertAdjacentHTML(position, markup) {
      assert.equal(position, 'beforeend');
      this.innerHTML += markup;
    },
    querySelector(selector) {
      assert.equal(selector, '#print-article');
      return print;
    },
    querySelectorAll(selector) {
      assert.ok(['[data-open]', '[data-read]'].includes(selector));
      if (!controls.has(selector)) {
        const key = selector.slice(6, -1);
        controls.set(
          selector,
          [...this.innerHTML.matchAll(new RegExp('data-' + key + '="([^"]+)"', 'g'))].map(
            ([, value]) => ({ dataset: { [key]: value } }),
          ),
        );
      }
      return controls.get(selector);
    },
  };
}

test('student articles use their author, date, editor and next action without sample credit', () => {
  const original = articles.slice(),
    root = articleRoot(),
    body = { classList: classes() },
    opened = [];
  let printed = 0;
  articles.splice(0, articles.length, {
    slug: 'what-our-students-tested',
    title: 'What our students tested',
    author: 'Casey Student',
    editor: 'Jordan Editor',
    publishedAt: '2026-11-10',
    date: '2025-01-01',
    isSample: false,
    category: 'Reflection',
    section: 'Student research',
    abstract: 'A small experiment with a useful result.',
    headings: ['What we learned'],
    paragraphs: ['We tried an idea.', 'Then we checked the result.'],
    references: [],
    takeaway: { text: 'Try the follow-up.', mode: 'compare', label: 'Compare results' },
  });
  try {
    withGlobals({ document: { body }, window: { print: () => printed++ } }, () => {
      const dispose = renderPublication(root, 'article', 'what-our-students-tested', {
        open: (...args) => opened.push(args),
      });
      assert.match(root.innerHTML, /Casey Student/);
      assert.match(root.innerHTML, /Edited by Jordan Editor/);
      assert.match(root.innerHTML, /10 November 2026/);
      assert.doesNotMatch(root.innerHTML, /1 January 2025|class="sample-credit"/);
      assert.match(root.innerHTML, /Try the follow-up\./);
      assert.match(root.innerHTML, /Compare results/);
      assert.equal(globalThis.document.title, 'What our students tested | The AI Review');
      root
        .querySelectorAll('[data-open]')
        .find((control) => control.dataset.open === 'compare')
        .onclick();
      assert.deepEqual(opened, [['compare']]);
      root.querySelector('#print-article').onclick();
      assert.equal(printed, 1);
      assert.ok(body.classList.contains('reading'));
      dispose();
      assert.equal(body.classList.contains('reading'), false);
      assert.equal(root.classList.contains('publication'), false);
      assert.equal(root.classList.contains('reader-page'), false);
    });
  } finally {
    articles.splice(0, articles.length, ...original);
  }
});

test('articles can omit a date, editor and takeaway without broken metadata or an invented action', () => {
  const original = articles.slice(),
    root = articleRoot();
  articles.splice(0, articles.length, {
    ...original[0],
    publishedAt: undefined,
    date: undefined,
    editor: undefined,
    takeaway: undefined,
    isSample: true,
  });
  try {
    withGlobals({ document: { body: { classList: classes() } } }, () => {
      const dispose = renderPublication(root, 'article', articles[0].slug, { open() {} });
      assert.match(root.innerHTML, /class="sample-credit"/);
      assert.doesNotMatch(
        root.innerHTML,
        /Invalid Date|undefined|Edited by|class="article-takeaway"/,
      );
      assert.match(root.innerHTML, /min\s+read/);
      dispose();
    });
  } finally {
    articles.splice(0, articles.length, ...original);
  }
});

test('article links preserve browser gestures for opening another tab or window', () => {
  const root = articleRoot(),
    opened = [];
  withGlobals({ document: { body: { classList: classes() } } }, () => {
    const dispose = renderPublication(root, 'article', articles[0].slug, {
      open: (...args) => opened.push(args),
    });
    try {
      const link = root.querySelectorAll('[data-read]')[0];
      assert.ok(link, 'related reading exposes a normal article link');
      for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
        let prevented = false;
        link.onclick({ [modifier]: true, preventDefault: () => (prevented = true) });
        assert.equal(prevented, false, modifier + ' must preserve the browser link action');
        assert.deepEqual(opened, [], 'the current article must stay open');
      }
      let prevented = false;
      link.onclick({ preventDefault: () => (prevented = true) });
      assert.equal(prevented, true);
      assert.deepEqual(opened, [['article', link.dataset.read]]);
    } finally {
      dispose();
    }
  });
});

test('removed and unknown article bookmarks show recovery instead of a different article', () => {
  const original = articles.slice(),
    removed = original[0];
  articles.splice(0, 1);
  try {
    withGlobals({ document: { body: { classList: classes() } } }, () => {
      for (const reference of [removed.slug, removed.legacyIndex, 'missing-article', '']) {
        const root = articleRoot(),
          opened = [];
        const dispose = renderPublication(root, 'article', reference, {
          open: (mode) => opened.push(mode),
        });
        assert.match(root.innerHTML, /This article is unavailable\./);
        assert.doesNotMatch(root.innerHTML, /id="print-article"/);
        const browse = root
          .querySelectorAll('[data-open]')
          .find((link) => link.dataset.open === 'journal');
        assert.ok(browse, 'a missing article offers a route back to the publication');
        browse.onclick();
        assert.deepEqual(opened, ['journal']);
        dispose();
      }
      const root = articleRoot();
      const dispose = renderPublication(root, 'article', null, { open() {} });
      assert.equal(
        globalThis.document.title,
        articles[0].title + ' | The AI Review',
        'no reference still opens the default article',
      );
      dispose();
      articles.splice(0);
      const empty = articleRoot();
      const stop = renderPublication(empty, 'article', null, { open() {} });
      assert.match(empty.innerHTML, /This article is unavailable\./);
      stop();
    });
  } finally {
    articles.splice(0, articles.length, ...original);
  }
});

test('an empty event catalog remains navigable and its workshop dialog closes on cleanup', () => {
  const original = EVENTS.splice(0),
    controls = new Map(
      [
        'calendar-read',
        'calendar-prev',
        'calendar-next',
        'calendar-month',
        'calendar-days',
        'calendar-agenda',
        'event-detail',
        'workshop-request',
      ].map((id) => ['#' + id, {}]),
    ),
    close = {},
    dialog = {
      open: false,
      querySelector: () => close,
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    },
    root = {
      querySelector: (selector) => controls.get(selector) || null,
      querySelectorAll: () => [],
    },
    navigations = [];
  controls.set('#workshop-dialog', dialog);
  try {
    withGlobals(
      {
        location: new URL('https://dallasai.club/club.html?mode=events&event=removed#calendar'),
        history: { replaceState: (state, title, url) => navigations.push(new URL(url)) },
      },
      () => {
        const dispose = mountEvents(root);
        assert.equal(controls.get('#calendar-read').hidden, true);
        assert.equal(controls.get('#event-detail').innerHTML, '');
        assert.match(controls.get('#calendar-agenda').innerHTML, /No events listed/);
        assert.doesNotMatch(controls.get('#calendar-agenda').innerHTML, /next-announced/);
        const month = controls.get('#calendar-month').textContent;
        controls.get('#calendar-next').onclick();
        assert.notEqual(controls.get('#calendar-month').textContent, month);
        controls.get('#calendar-prev').onclick();
        assert.equal(controls.get('#calendar-month').textContent, month);
        assert.equal(navigations.at(-1).searchParams.has('event'), false);
        assert.equal(navigations.at(-1).searchParams.get('mode'), 'events');
        assert.equal(navigations.at(-1).hash, '#calendar');
        assert.doesNotThrow(() => controls.get('#calendar-read').onclick());
        controls.get('#workshop-request').onclick();
        assert.equal(dialog.open, true);
        close.onclick();
        assert.equal(dialog.open, false);
        controls.get('#workshop-request').onclick();
        dispose();
        assert.equal(dialog.open, false);
      },
    );
  } finally {
    EVENTS.splice(0, EVENTS.length, ...original);
  }
});
