import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildReviewFeed, createReviewReader, createClubServer } from '../server.mjs';
import { articles } from '../public/content/articles.js';
import { SITE_URL } from '../public/content/club.js';

const today = new Date('2026-09-11T18:00:00Z');

test('RSS uses canonical links, stable IDs, publication dates and escaped editorial samples', () => {
  const feed = buildReviewFeed(
    [
      { slug: 'sample', title: 'A < B & C', abstract: 'A "quote"', isSample: true },
      { slug: 'future', title: 'Scheduled', abstract: 'Later', publishedAt: '2027-01-01' },
      {
        slug: 'published',
        title: 'Published',
        abstract: 'Ready',
        author: 'Club member',
        publishedAt: '2026-09-10',
      },
    ],
    SITE_URL,
    today,
  );
  assert.ok(feed.includes('<title>A &lt; B &amp; C</title>'));
  assert.ok(feed.includes('Editorial sample. A &quot;quote&quot;'));
  assert.ok(feed.includes('<description>Ready</description>'));
  assert.ok(feed.includes('<guid isPermaLink="false">ai-review:published</guid>'));
  assert.ok(feed.includes('club.html?mode=article&amp;article=published'));
  assert.ok(feed.indexOf('<title>Published</title>') < feed.indexOf('<title>A &lt;'));
  assert.equal((feed.match(/<pubDate>/g) || []).length, 1);
  assert.ok(!feed.includes('Scheduled'));
  assert.ok(!feed.includes('127.0.0.1'));
  assert.equal((buildReviewFeed([], SITE_URL, today).match(/<item>/g) || []).length, 0);
});

test('RSS refreshes articles and canonical configuration without a server restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'club-feed-'));
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    await fs.mkdir(path.join(root, 'content'));
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    const source = path.join(root, 'content/articles.js');
    const config = path.join(root, 'content/club.js');
    await fs.writeFile(source, 'export const articles = ' + JSON.stringify(articles) + ';');
    await fs.writeFile(config, 'export const SITE_URL = "https://dallasai.club/";');
    const read = createReviewReader(root, { cacheMs: 0, now: () => today });
    assert.ok((await read()).includes(articles[0].slug));
    await fs.writeFile(
      source,
      'export const articles = [{slug:"fresh",title:"Fresh article",abstract:"New writing"}];',
    );
    await fs.writeFile(config, 'export const SITE_URL = "https://club.example/";');
    const updated = await read();
    assert.ok(updated.includes('Fresh article'));
    assert.ok(updated.includes('https://club.example/club.html'));
    assert.ok(!updated.includes(articles[0].slug));
    await fs.writeFile(source, 'invalid syntax');
    await assert.rejects(read());
    await fs.writeFile(source, 'export const articles = [];');
    assert.ok(!(await read()).includes('<item>'));
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('RSS keeps its public URL, supports HEAD, rejects writes and handles source failure', async () => {
  const root = path.resolve(import.meta.dirname, '../public');
  for (const [directory, status] of [
    [root, 200],
    [path.join(root, 'missing-content'), 503],
  ]) {
    const server = createClubServer(directory, {});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/review-feed.xml';
    try {
      const response = await fetch(url);
      assert.equal(response.status, status);
      if (status === 200) {
        assert.match(response.headers.get('content-type'), /^application\/rss\+xml/);
        assert.equal(await response.text(), buildReviewFeed(articles, SITE_URL));
      }
      const head = await fetch(url, { method: 'HEAD' });
      assert.equal(head.status, status);
      assert.equal(await head.text(), '');
      const post = await fetch(url, { method: 'POST' });
      assert.equal(post.status, 405);
      assert.equal(post.headers.get('allow'), 'GET, HEAD');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
