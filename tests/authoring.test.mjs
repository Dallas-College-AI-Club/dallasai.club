import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENTS, SITE_URL, SOCIAL_LINKS } from '../public/content/club.js';
import { articles } from '../public/content/articles.js';
import { PROPOSED_PROJECTS, WORLD_MARKET_EVENTS } from '../public/content/projects.js';

const text = (value, label) => assert.ok(typeof value === 'string' && value.trim(), label);
const identifiers = (items, field) => {
  assert.equal(new Set(items.map((item) => item[field])).size, items.length, `Duplicate ${field}`);
  for (const item of items)
    assert.match(item[field], /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `Invalid ${field}`);
};
const date = (value, label) => {
  assert.match(
    value,
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))?$/,
    label,
  );
  assert.ok(Number.isFinite(Date.parse(value)), label);
  assert.equal(new Date(value.slice(0, 10)).toISOString().slice(0, 10), value.slice(0, 10), label);
};

test('calendar content has stable IDs, complete copy and valid dates in chronological order', () => {
  identifiers(EVENTS, 'id');
  for (const event of EVENTS) {
    for (const field of ['title', 'summary', 'category'])
      text(event[field], event.id + ': ' + field);
    date(event.date, event.id + ': date');
    if (event.end) {
      date(event.end, event.id + ': end');
      assert.ok(
        Date.parse(event.end) > Date.parse(event.date),
        event.id + ': end must follow start',
      );
    }
    assert.equal(new URL(event.url, SITE_URL).searchParams.get('event'), event.id);
    for (const field of ['agenda', 'preparation']) {
      assert.ok(Array.isArray(event[field]), event.id + ': ' + field);
      for (const item of event[field]) text(item, event.id + ': ' + field);
    }
  }
});

test('article content fits its renderer and provides stable feed IDs and complete references', () => {
  identifiers(articles, 'slug');
  const legacyIndexes = new Set();
  for (const article of articles) {
    assert.ok(
      !/^\d+$/.test(article.slug),
      article.slug + ': numeric references are reserved for old bookmarks',
    );
    if (article.legacyIndex !== undefined) {
      assert.ok(
        Number.isSafeInteger(article.legacyIndex) && article.legacyIndex >= 0,
        article.slug + ': legacyIndex must be a nonnegative integer',
      );
      assert.ok(!legacyIndexes.has(article.legacyIndex), article.slug + ': duplicate legacyIndex');
      legacyIndexes.add(article.legacyIndex);
    }
    for (const field of ['title', 'abstract', 'category', 'section'])
      text(article[field], article.slug + ': ' + field);
    assert.ok(
      Array.isArray(article.paragraphs) && article.paragraphs.length > 0,
      article.slug + ': paragraphs',
    );
    assert.equal(
      article.headings.length,
      Math.ceil(article.paragraphs.length / 2),
      article.slug + ': one heading per two paragraphs',
    );
    for (const item of [...article.headings, ...article.paragraphs])
      text(item, article.slug + ': body');
    if (article.publishedAt || article.date)
      date(article.publishedAt || article.date, article.slug + ': publication date');
    if (article.isSample === false) text(article.author, article.slug + ': credited author');
    for (const reference of article.references) {
      assert.equal(reference.length, 3, article.slug + ': reference organization, title and URL');
      for (const value of reference) text(value, article.slug + ': reference');
      assert.equal(new URL(reference[2]).protocol, 'https:');
    }
  }
});

test('proposed projects and shared links are complete and uniquely identified', () => {
  identifiers(PROPOSED_PROJECTS, 'id');
  for (const project of PROPOSED_PROJECTS) {
    for (const field of ['title', 'summary', 'question'])
      text(project[field], project.id + ': ' + field);
    assert.equal(new URL(project.source).protocol, 'https:');
  }
  assert.equal(new URL(SITE_URL).protocol, 'https:');
  assert.equal(new Set(SOCIAL_LINKS.map((link) => link.label)).size, SOCIAL_LINKS.length);
  for (const link of SOCIAL_LINKS) {
    text(link.label, 'Social link label');
    assert.equal(new URL(link.href).protocol, 'https:');
  }
});

test('reported market snapshots keep their date, asset, trading window and source together', () => {
  assert.ok(Array.isArray(WORLD_MARKET_EVENTS) && WORLD_MARKET_EVENTS.length > 0);
  identifiers(WORLD_MARKET_EVENTS, 'id');
  for (const event of WORLD_MARKET_EVENTS) {
    for (const field of ['label', 'title', 'summary', 'asset', 'region', 'sourceName'])
      text(event[field], event.id + ': ' + field);
    date(event.date, event.id + ': reported date');
    assert.ok(Number.isFinite(event.change), event.id + ': numeric percentage change');
    assert.match(
      event.period,
      /^(?:Session close|After-hours|Pre-market|Intraday at \d{1,2}:\d{2} (?:ET|CT|UTC))$/,
      event.id + ': specify the trading window; intraday snapshots also need a time and zone',
    );
    const source = new URL(event.source);
    assert.equal(source.protocol, 'https:', event.id + ': source URL');
    assert.ok(
      source.hostname && source.pathname !== '/',
      event.id + ': link to the source article',
    );
  }
});
