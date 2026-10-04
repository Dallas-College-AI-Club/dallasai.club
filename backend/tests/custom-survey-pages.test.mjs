import test from 'node:test';
import assert from 'node:assert/strict';

// The imported officer session registers browser listeners; these tests exercise
// only the asynchronous results reader, without starting a session or rendering.
globalThis.window = { addEventListener() {} };
globalThis.ResizeObserver = class {
  observe() {}
};
globalThis.document = {
  getElementById() {
    return {};
  },
  querySelector() {
    return { textContent: 'Club office' };
  },
  addEventListener() {},
};
const { allSurveyResponses, mountCustomSurveys } =
  await import('../admin/custom-surveys.js');
const result = (name, active = true) => ({
  email: name + '@example.com',
  active,
  revision: 1,
  responses: [{ id: 'question', title: 'Question', text: name }],
});

test('consolidated custom answers include later pages and exclude archived responses', async () => {
  const offsets = [];
  const all = await allSurveyResponses(
    async (url) => {
      const offset = new URL(url, 'https://example.com').searchParams.get(
        'offset',
      );
      offsets.push(offset);
      return offset === '10'
        ? {
            results: [result('second'), result('archived', false)],
            nextOffset: 20,
          }
        : { results: [result('third')], nextOffset: null };
    },
    'survey',
    { results: [result('first')], nextOffset: 10 },
  );
  assert.deepEqual(offsets, ['10', '20']);
  assert.deepEqual(
    all.map((row) => row.display_name),
    ['first@example.com', 'second@example.com', 'third@example.com'],
  );
});

test('leaving during a page request discards the response and stops fetching', async () => {
  let current = true,
    calls = 0;
  const all = await allSurveyResponses(
    async () => {
      calls++;
      current = false;
      return { results: [result('late')], nextOffset: 20 };
    },
    'survey',
    { results: [result('first')], nextOffset: 10 },
    () => current,
  );
  assert.deepEqual(all, []);
  assert.equal(calls, 1);
});

test('a later-page failure rejects instead of presenting a partial compilation', async () => {
  await assert.rejects(
    allSurveyResponses(
      async () => {
        throw new Error('Connection failed');
      },
      'survey',
      { results: [result('first')], nextOffset: 10 },
    ),
    /Connection failed/,
  );
});

test('consolidation carries archived scope through later pages without dropping saved answers', async () => {
  const seen = [];
  const all = await allSurveyResponses(
    async (url) => {
      const query = new URL(url, 'https://example.com').searchParams;
      seen.push([query.get('view'), query.get('search')]);
      return { results: [result('archived-later', false)], nextOffset: null };
    },
    'survey',
    { results: [result('archived-first', false)], nextOffset: 10 },
    () => true,
    { view: 'archived', search: 'archived' },
  );
  assert.deepEqual(seen, [['archived', 'archived']]);
  assert.equal(all.length, 2);
  const mixed = await allSurveyResponses(
    async () => {},
    'survey',
    {
      results: [result('active'), result('archived', false)],
      nextOffset: null,
    },
    () => true,
    { view: 'all' },
  );
  assert.equal(mixed.length, 2);
});

test('library combines title search with collection and keeps draft, event, custom group order', async () => {
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
    }
    append(...children) {
      for (const child of children) {
        this.children = this.children.filter((value) => value !== child);
        this.children.push(child);
      }
    }
    replaceChildren(...children) {
      this.children = [];
      this.append(...children);
    }
    setAttribute() {}
  }
  document.createElement = (tag) => new Element(tag);
  const surveys = [
    {
      id: 'custom',
      title: 'AI workshop custom',
      status: 'open',
      response_count: 2,
    },
    {
      id: 'event',
      title: 'AI workshop feedback',
      status: 'open',
      response_count: 3,
      definition: { eventId: 'event' },
    },
    {
      id: 'draft',
      title: 'AI workshop draft',
      status: 'draft',
      response_count: 0,
    },
    { id: 'unrelated', title: 'Officers', status: 'open', response_count: 0 },
  ];
  const root = new Element('main');
  const controller = mountCustomSurveys(root, async (url) =>
    url.startsWith('/api/events') ? { events: [] } : { surveys },
  );
  await controller.library(root, '', '  AI WORKSHOP  ');
  assert.deepEqual(
    root.children[0].children.map((section) => section.dataset.group),
    ['Drafts', 'Event surveys', 'Custom surveys'],
  );
  const titles = (element) =>
    [element.textContent, ...element.children.flatMap(titles)].filter(Boolean);
  assert.ok(!titles(root).includes('Officers'));
  await controller.library(root, 'events', '  AI WORKSHOP  ');
  assert.ok(titles(root).includes('AI workshop feedback'));
  assert.ok(!titles(root).includes('AI workshop custom'));
  await controller.library(root, 'custom', '  AI WORKSHOP  ');
  assert.ok(titles(root).includes('AI workshop custom'));
  assert.ok(!titles(root).includes('AI workshop feedback'));
  controller.reset();
  controller.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    root.children[0].children.map((section) => section.dataset.group),
    ['Drafts', 'Custom surveys'],
  );
  assert.ok(titles(root).includes('AI workshop custom'));
  controller.clear();
});
