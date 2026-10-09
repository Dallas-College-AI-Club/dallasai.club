import test from 'node:test';
import assert from 'node:assert/strict';

// The imported officer session registers browser listeners; these tests exercise
// only the asynchronous results reader, without starting a session or rendering.
globalThis.window = { addEventListener() {} };
globalThis.location = { hash: '#/surveys' };
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
  const controller = mountCustomSurveys(root, async (url) => {
    if (url === '/api/custom-surveys?action=catalog') return { surveys };
    if (url === '/api/events?admin=1') return { events: [] };
    if (url === '/api/surveys?catalog=1')
      return {
        surveys: [
          {
            eventId: 'registration',
            title: 'AI workshop RSVP',
            status: 'active',
            revision: 7,
            responseCount: 1,
            archivedResponseCount: 0,
            registrationOpen: true,
            hasEvent: true,
          },
        ],
      };
    throw new Error('Unexpected library request: ' + url);
  });
  await controller.library(root, '', '  AI WORKSHOP  ');
  assert.deepEqual(
    root.children[0].children.map((section) => section.dataset.group),
    ['Drafts', 'Event surveys', 'Custom surveys'],
  );
  const titles = (element) =>
    [element.textContent, ...element.children.flatMap(titles)].filter(Boolean);
  assert.ok(!titles(root).includes('Officers'));
  assert.ok(titles(root).includes('AI workshop RSVP'));
  await controller.library(root, 'events', '  AI WORKSHOP  ');
  assert.ok(titles(root).includes('AI workshop feedback'));
  assert.ok(!titles(root).includes('AI workshop custom'));
  await controller.library(root, 'custom', '  AI WORKSHOP  ');
  assert.ok(titles(root).includes('AI workshop custom'));
  assert.ok(!titles(root).includes('AI workshop feedback'));
  assert.ok(!titles(root).includes('AI workshop RSVP'));
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

test('custom response viewer shows skipped original builder questions and preserves zero and shared-only Advisor answers', async () => {
  const { responseSections } = await import('../surveys/results-ui.js');
  document.createElement = (tag) => ({
    tag,
    children: [],
    append(...children) {
      this.children.push(...children);
    },
  });
  const text = (el) =>
    [el.textContent, ...el.children.map(text)]
      .filter((value) => value !== undefined)
      .join('\n');
  const saved = {
    ...result('builder'),
    response_definition: {
      questions: [
        { id: 'zero', title: 'Original zero question' },
        {
          id: 'skipped',
          title: 'Original optional question',
          choiceDate: '2099-10-02',
        },
      ],
    },
    responses: [{ id: 'zero', title: 'Original zero question', text: 0 }],
  };
  const shown = text(
    responseSections([saved], {
      definition: { questions: [{ id: 'skipped', title: 'Changed wording' }] },
    }),
  );
  assert.match(shown, /Original zero question\n0/);
  assert.match(shown, /2099-10-02 · Original optional question\nNo answer/);
  assert.doesNotMatch(shown, /Changed wording/);
  const blank = text(responseSections([{ ...saved, responses: [] }]));
  assert.match(blank, /Original zero question\nNo answer/);
  assert.match(blank, /Original optional question\nNo answer/);
  const { responseDocument } = await import('../admin/response-document.js');
  assert.equal(
    responseDocument(saved, { title: 'Survey', definition: {} }).blocks[1]
      .question,
    '2099-10-02 · Original optional question',
  );
  const advisor = text(
    responseSections(
      [
        {
          ...result('advisor'),
          response_definition: {
            chapters: [
              {
                id: 'first',
                title: 'Original chapter',
                core: ['shared', 'private'],
              },
            ],
            questions: [{ id: 'q-private', title: 'Private question' }],
          },
          responses: [
            {
              id: 'q-shared',
              group: 'first',
              title: 'Shared question',
              text: 'Shared answer',
              mode: 'narrative',
            },
          ],
        },
      ],
      { definition: { chapters: [{ id: 'first', title: 'Changed chapter' }] } },
    ),
  );
  assert.match(advisor, /Original chapter/);
  assert.match(advisor, /Shared question\nShared answer/);
  assert.doesNotMatch(advisor, /Private question|Changed chapter/);
});
