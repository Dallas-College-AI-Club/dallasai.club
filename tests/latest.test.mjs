import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { PUBLISHED } from '../public/content/published.js';
import { selectArticle, buildLatest } from '../public/content/latest.js';
import { createClubServer, createLatestReader } from '../server.mjs';
import { renderViews, desktopMarkup, latestApps } from '../public/desktop/views.js';
import { initialLayout, fitsDesktop, clampBox } from '../public/desktop/windows.js';
import { COPYRIGHT, SOCIAL_LINKS } from '../public/content/club.js';
import { PROJECT_LINKS } from '../public/content/projects.js';

const publicRoot = path.resolve(import.meta.dirname, '../public');
const today = new Date('2026-09-11T18:00:00Z');

test('publication selection excludes future articles and prefers the newest publication', () => {
  const articles = [
    { title: 'Editorial sample' },
    { title: 'Scheduled', publishedAt: '2027-01-01' },
    { title: 'Previous', publishedAt: '2026-08-01' },
    { title: 'Newest', publishedAt: '2026-09-10' },
  ];
  assert.equal(selectArticle(articles, today).index, 3);
  assert.equal(selectArticle([{ title: 'First' }, { title: 'Second' }], today).title, 'First');
  assert.equal(selectArticle([articles[1]], today), null);
  assert.equal(selectArticle([], today), null);
});

test('published snapshots refresh event selections as Central Time advances', () => {
  const snapshot = structuredClone(PUBLISHED);
  snapshot.events = [
    {
      id: 'new',
      title: 'New meeting',
      date: '2026-09-12T17:00:00-05:00',
      category: 'Club meeting',
      summary: 'Fresh information',
      url: 'club.html?mode=events&event=new',
    },
  ];
  assert.equal(buildLatest(today, snapshot).event.title, 'New meeting');
  assert.equal(buildLatest(new Date('2026-09-13T18:00:00Z'), snapshot).event, null);
  snapshot.events = [];
  assert.equal(buildLatest(today, snapshot).event, null);
});

test('concurrent refreshes share one snapshot and use the current source counts', async () => {
  const read = createLatestReader(publicRoot, { now: () => today });
  const [a, b] = await Promise.all([read(), read()]);
  assert.deepEqual(
    a,
    buildLatest(today),
    'initial browser render and live API share one content model',
  );
  assert.strictEqual(a, b);
  assert.strictEqual(await read(), a);
  const { RECORDINGS } = await import('../public/content/chatbot-recordings.js');
  const { LAB_CASES } = await import('../public/content/lab-cases.js');
  const { articles } = await import('../public/content/articles.js');
  const articleSlug = new URL(a.article.url, 'https://dallasai.club/').searchParams.get('article');
  assert.equal(articles.find((article) => article.slug === articleSlug)?.title, a.article.title);
  assert.equal(a.recordings.length, RECORDINGS.length);
  assert.equal(a.practiceCount, LAB_CASES.length);
  assert.deepEqual(
    a.recordings.map((r) => r.src),
    RECORDINGS.map((r) => r.src),
  );
});

test('Latest API supports GET and HEAD, rejects writes, and reports unavailable content', async () => {
  const store = {
    list: () => assert.fail('Latest must not read scores'),
    save: () => assert.fail('Latest must not write scores'),
  };
  for (const [root, status] of [
    [publicRoot, 200],
    [path.join(publicRoot, 'missing-content'), 503],
  ]) {
    const server = createClubServer(root, store);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/latest`;
    try {
      const response = await fetch(url);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await fetch(url, { method: 'HEAD' })).status, status);
      assert.equal(await (await fetch(url, { method: 'HEAD' })).text(), '');
      assert.equal((await fetch(url, { method: 'POST' })).status, 405);
      assert.equal((await fetch(url, { method: 'DELETE' })).headers.get('allow'), 'GET, HEAD');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('empty content has honest fallbacks and content cannot inject markup or executable links', async () => {
  const data = await createLatestReader(publicRoot, { now: () => today })();
  const empty = {
    ...data,
    event: null,
    article: null,
    projects: [],
    experiments: [],
    games: [],
    recordings: [],
    practiceCount: 0,
  };
  const views = renderViews(empty);
  assert.match(views.events.body, /no upcoming events/);
  assert.match(views.journal.body, /new edition/);
  assert.match(views.major.body, /new recorded tour/);
  assert.equal(views.lab.footer, '0 experiments · 0 practice cases');
  assert.match(desktopMarkup(empty, views), /aria-label="Major"/);
  const injected = renderViews({
    ...data,
    article: { ...data.article, title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' },
  });
  assert.ok(!injected.journal.body.includes('<img'));
  assert.ok(!injected.journal.body.includes('javascript:'));
  assert.match(injected.journal.body, /&lt;img/);
});

test('roomy desktop tiles fit without overlap; smaller screens use flowing content', () => {
  for (const width of [1240, 1280, 1350, 1360, 1366, 1440, 1920, 2560, 3840]) {
    for (const height of [742, 800, 1042, 1402]) {
      assert.ok(fitsDesktop(width, height));
      const layout = initialLayout(width, height);
      const boxes = latestApps.map((id) => layout[id]);
      for (const box of boxes) {
        assert.ok(box.left >= 0 && box.top >= 0);
        assert.ok(box.left + box.width <= width && box.top + box.height <= height);
      }
      for (let i = 0; i < boxes.length; i++)
        for (const b of boxes.slice(i + 1)) {
          const a = boxes[i];
          assert.ok(
            a.left + a.width <= b.left ||
              b.left + b.width <= a.left ||
              a.top + a.height <= b.top ||
              b.top + b.height <= a.top,
          );
        }
    }
  }
  for (const [w, h] of [
    [320, 568],
    [768, 1024],
    [999, 1024],
    [1920, 599],
  ])
    assert.equal(fitsDesktop(w, h), false);
  assert.deepEqual(
    clampBox(
      { left: 9999, top: -200, width: 30, height: 20 },
      { width: 1440, height: 900 },
      { width: 420, height: 540 },
    ),
    { left: 1020, top: 0, width: 420, height: 540 },
  );
});

test('laptop desktops keep movable windows readable and inside the available workspace', () => {
  for (const width of [1000, 1024, 1239, 1240, 1350, 1440, 1920]) {
    for (const height of [600, 620, 692, 741, 742, 1234]) {
      assert.ok(fitsDesktop(width, height), `${width}×${height} must support desktop controls`);
      const layout = initialLayout(width, height);
      assert.ok(layout.major.width >= 420 && layout.major.height >= 540, 'Major stays readable');
      for (const box of Object.values(layout)) {
        assert.ok(box.left >= 0 && box.top >= 0);
        assert.ok(box.left + box.width <= width && box.top + box.height <= height);
      }
      // Initial stacking is Major, Review, Lab, then the active Events window.
      const stack = ['major', 'journal', 'lab', 'events'];
      for (const [index, id] of stack.entries()) {
        const title = { ...layout[id], height: 25 };
        assert.ok(
          stack.slice(index + 1).every((front) => {
            const box = layout[front];
            return (
              title.top + title.height <= box.top ||
              title.top >= box.top + box.height ||
              title.left + title.width <= box.left ||
              title.left >= box.left + box.width
            );
          }),
          `${id} title remains exposed at ${width}×${height}`,
        );
      }
    }
  }
  assert.ok(fitsDesktop(1350, 1272 - 38), 'the reported user viewport stays draggable');
  assert.ok(fitsDesktop(1366, 730 - 38), 'short laptops retain desktop controls');
  assert.deepEqual(
    clampBox(
      { left: 1400, top: 900, width: 650, height: 700 },
      { width: 1000, height: 600 },
      { width: 420, height: 540 },
    ),
    { left: 350, top: 0, width: 650, height: 600 },
    'a resized or restored window is kept inside the smaller desktop',
  );
});

test('desktop website shortcut opens About and social footer stays within its wallpaper', () => {
  const data = buildLatest(today);
  const markup = desktopMarkup(data, renderViews(data));
  const shortcut = markup.match(
    /<a\b(?=[^>]*\bclass="[^"]*\br95-about-shortcut\b)[^>]*>[\s\S]*?<\/a\s*>/,
  )?.[0];
  assert.ok(shortcut, 'desktop has a visible website shortcut');
  assert.match(shortcut, /href="\/club\.html\?mode=about"/);
  assert.match(shortcut.replace(/<[^>]+>/g, ' '), /Go to\s+website/);
  assert.match(shortcut, /src="assets\/about-browser\.svg"/);
  assert.doesNotMatch(shortcut, /data-open=/, 'the shortcut navigates instead of opening a window');
  const wallpaper = markup.match(/<div class="r95-wallpaper">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(wallpaper, 'desktop wallpaper exists');
  const footer = wallpaper.match(/<footer class="r95-club-footer">([\s\S]*?)<\/footer>/)?.[1];
  assert.ok(footer, 'club footer is contained by the desktop wallpaper');
  assert.equal((markup.match(/class="r95-club-footer"/g) || []).length, 1);
  assert.ok(footer.includes(COPYRIGHT));
  for (const { label, href } of SOCIAL_LINKS) {
    assert.ok(footer.includes(label), label + ' is visible');
    assert.ok(footer.includes('href="' + href.replaceAll('&', '&amp;') + '"'), label + ' link');
  }
});

test('Start Projects exposes every shared project destination through a disclosure', () => {
  const data = buildLatest(today);
  const markup = desktopMarkup(data, renderViews(data));
  const panel = markup.match(
    /<div\b(?=[^>]*\bclass="r95-project-menu")(?=[^>]*\bhidden\b)[^>]*>([\s\S]*?)<\/div>/,
  )?.[1];
  assert.ok(panel, 'project links start collapsed');
  const disclosure = markup.match(
    /<button\b(?=[^>]*\bclass="[^"]*\br95-start-projects\b)[^>]*>/,
  )?.[0];
  assert.ok(disclosure, 'Projects is a button in the Start menu');
  assert.match(disclosure, /\btype="button"/);
  assert.match(disclosure, /\baria-expanded="false"/);
  assert.match(disclosure, /\baria-controls="r95-project-menu"/);
  assert.deepEqual(
    [...panel.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]),
    [...PROJECT_LINKS.map((project) => '/' + project.href), '/club.html?mode=projects'],
  );
  for (const project of PROJECT_LINKS) assert.ok(panel.includes(project.label));
  const about = [...markup.matchAll(/<a\b[^>]*>[\s\S]*?<\/a\s*>/g)].find(
    ([anchor]) => anchor.replace(/<[^>]+>/g, ' ').trim() === 'About Club',
  )?.[0];
  assert.ok(about, 'Start contains About Club');
  assert.match(about, /src="assets\/windows95-flag\.svg"/);
});
