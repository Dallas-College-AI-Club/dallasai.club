import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PUBLISHED } from '../public/content/published.js';
import { buildLatest } from '../public/content/latest.js';

const root = path.resolve(import.meta.dirname, '..');

test('Hugo publishes matching content and RSS while excluding private source and archives', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'public/latest.json'), 'utf8'));
  assert.deepEqual(snapshot, PUBLISHED);
  const feed = fs.readFileSync(path.join(root, 'public/review-feed.xml'), 'utf8');
  for (const article of PUBLISHED.articles) {
    assert.ok(feed.includes(`ai-review:${article.slug}`));
    assert.ok(feed.includes(`mode=article&amp;article=${article.slug}`));
    assert.ok(article.bodyHtml.includes(`<h2 id="${article.headingIds[0]}">`));
  }
  const raw = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.ok(raw.trimStart().startsWith('<!doctype html>'));
  for (const excluded of ['archive', 'database', 'tests', 'server.mjs', '.env', 'secrets.env'])
    assert.equal(fs.existsSync(path.join(root, 'public', excluded)), false, excluded);
  for (const route of [
    'club.html',
    '404.html',
    'events/index.html',
    'events/09-03-welcome/index.html',
    'events/09-17-git/index.html',
    'events/09-24-workshop/index.html',
    'projects/success-coach-chatbot/index.html',
    'blog/first-post/index.html',
    'news/club-start/index.html',
  ])
    assert.ok(fs.existsSync(path.join(root, 'public', route)), route);
});

test('Hugo content editing publishes Markdown, schedules articles and keeps future events visible', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dallasai-hugo-'));
  assert.ok(temporary.startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    for (const name of ['config.toml', 'content', 'layouts', 'assets', 'data'])
      fs.cpSync(path.join(root, name), path.join(temporary, name), { recursive: true });
    const article = (name, extra) => {
      const front = {
        title: name,
        slug: name,
        type: 'review',
        weight: 1,
        publishDate: '2026-09-01T00:00:00Z',
        abstract: 'A < B & a "quote"',
        category: 'Essay',
        section: 'Testing',
        author: 'Test author',
        references: [],
        ...extra,
      };
      fs.writeFileSync(
        path.join(temporary, 'content/review', name + '.md'),
        JSON.stringify(front) +
          '\n\n## An editable heading\n\nA new paragraph written in **Markdown**.\n',
      );
    };
    article('published-test-article', {});
    article('private-draft-sentinel', { draft: true });
    article('future-article-sentinel', { publishDate: '2099-01-01T00:00:00Z' });
    fs.writeFileSync(
      path.join(temporary, 'content/calendar/future-event.md'),
      JSON.stringify({
        type: 'calendar',
        id: 'future-event',
        title: 'Future event',
        eventDate: '2099-01-01T17:00:00-06:00',
        category: 'Club meeting',
        draft: false,
      }) + '\n\nThe announced event.\n',
    );
    const result = spawnSync(
      'hugo',
      ['--source', temporary, '--clock', '2026-09-12T12:00:00Z', '--panicOnWarning'],
      { encoding: 'utf8', timeout: 30000, windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const read = (name) => fs.readFileSync(path.join(temporary, 'public', name), 'utf8');
    const snapshot = JSON.parse(read('latest.json'));
    const edited = snapshot.articles.find((a) => a.slug === 'published-test-article');
    assert.ok(edited.bodyHtml.includes('<strong>Markdown</strong>'));
    assert.deepEqual(edited.headingIds, ['an-editable-heading']);
    assert.ok(snapshot.events.some((e) => e.id === 'future-event'));
    assert.equal(
      snapshot.events.find((e) => e.id === 'future-event').summary,
      'The announced event.',
    );
    assert.equal(edited.publishedAt, '2026-09-01T00:00:00Z');
    assert.equal(buildLatest(new Date('2098-12-31T12:00:00Z'), snapshot).event.id, 'future-event');
    for (const file of ['latest.json', 'content/published.js', 'review-feed.xml', 'sitemap.xml']) {
      assert.ok(!read(file).includes('private-draft-sentinel'), file);
      assert.ok(!read(file).includes('future-article-sentinel'), file);
    }
    assert.equal(
      fs.existsSync(path.join(temporary, 'public/review/private-draft-sentinel')),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(temporary, 'public/review/future-article-sentinel')),
      false,
    );
    assert.ok(read('review-feed.xml').includes('A &lt; B &amp; a &#34;quote&#34;'));
  } finally {
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
