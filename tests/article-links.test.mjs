import assert from 'node:assert/strict';
import test from 'node:test';
import { articleUrl, findArticle } from '../public/content/article-links.js';
import { routeFromUrl } from '../public/app/routes.js';
import { articles } from '../public/content/articles.js';

test('article bookmarks retain identity when editors insert or reorder articles', () => {
  const reordered = [{ slug: 'a-new-student-article' }, ...articles.toReversed()];
  for (const article of articles) {
    const bookmark = articleUrl(article);
    const route = routeFromUrl(bookmark);
    assert.equal(route.mode, 'article');
    assert.equal(route.article, article.slug);
    assert.strictEqual(findArticle(reordered, route.article), article);
    assert.strictEqual(findArticle(reordered, article.legacyIndex), article);
    assert.strictEqual(findArticle(reordered, String(article.legacyIndex)), article);
  }
});

test('removed article references cannot resolve to a replacement array position', () => {
  const removed = articles[0];
  const remaining = articles.slice(1);
  assert.equal(findArticle(remaining, removed.slug), undefined);
  assert.equal(findArticle(remaining, removed.legacyIndex), undefined);
  assert.equal(findArticle([{ slug: 'new-first-article' }], 0), undefined);
  for (const invalid of [null, undefined, -1, 1.5, '1e0', 'missing-article'])
    assert.equal(findArticle(articles, invalid), undefined);
});

test('article URLs round-trip their reference without creating extra query parameters', () => {
  const slug = 'testing-&-learning#results';
  const url = new URL(articleUrl(slug), 'https://dallasai.club/');
  assert.equal(url.searchParams.get('article'), slug);
  assert.deepEqual([...url.searchParams.keys()], ['mode', 'article']);
  assert.equal(url.hash, '');
  assert.equal(routeFromUrl(url).article, slug);
});

test('route parsing distinguishes no article selection from an explicit unknown reference', () => {
  assert.equal(routeFromUrl('club.html?mode=article').article, null);
  assert.equal(routeFromUrl('club.html?mode=article&article=').article, '');
  assert.equal(routeFromUrl('club.html?mode=article&article=0').article, 0);
  assert.equal(routeFromUrl('club.html?mode=article&article=missing').article, 'missing');
});
