import { splitEvents, eventDate, eventTime, PROJECT_URL, JOIN_URL } from './club.js';
import { articles, readingMinutes } from './articles.js';
import { articleUrl } from './article-links.js';
import { stationUpdates } from './discovery.js';
import { LAB_CASES } from './lab-cases.js';
import { GAMES } from '../games/registry.js';
import { RECORDINGS, INTRO_SECONDS } from './chatbot-recordings.js';
import { PUBLISHED } from './published.js';

// Dated publications sort by publication date. Undated editions retain their source order.
export function selectArticle(articles, now) {
  return (
    articles
      .map((article, index) => ({
        ...article,
        index,
        published: Date.parse(article.publishedAt || article.date || ''),
      }))
      .filter((article) => !Number.isFinite(article.published) || article.published <= +now)
      .sort(
        (a, b) =>
          (Number.isFinite(b.published) ? b.published : -Infinity) -
            (Number.isFinite(a.published) ? a.published : -Infinity) || a.index - b.index,
      )[0] || null
  );
}

// Hugo supplies published content; the browser recomputes date-sensitive selections.
export function buildLatest(now = new Date(), snapshot = PUBLISHED) {
  const next = splitEvents(now, snapshot.events).upcoming[0];
  const article = selectArticle(snapshot.articles || articles, now);
  const [month, day] = next ? eventDate(next).split(' ') : [];
  return {
    checkedAt: now.toISOString(),
    event: next
      ? {
          id: next.id,
          title: next.title,
          summary: next.summary,
          category: next.category,
          month,
          day,
          when: eventTime(next),
          url: next.url,
        }
      : null,
    article: article
      ? {
          title: article.title,
          abstract: article.abstract,
          category: article.category,
          minutes: readingMinutes(article),
          url: articleUrl(article),
          edition: Number.isFinite(article.published)
            ? new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC',
              }).format(article.published)
            : 'Current edition' + (article.isSample ? ' · Editorial sample' : ''),
        }
      : null,
    projects: stationUpdates('projects', snapshot),
    experiments: stationUpdates('lab', snapshot),
    practiceCount: (snapshot.lab?.LAB_CASES || LAB_CASES).length,
    games: GAMES.map(({ id, title, description }) => ({ id, title, description })),
    recordings: (snapshot.recordings?.RECORDINGS || RECORDINGS).map(
      ({ lang, english, label, src, poster, startPoster }) => ({
        lang,
        english,
        label,
        src,
        poster,
        startPoster,
      }),
    ),
    introSeconds: snapshot.recordings?.INTRO_SECONDS ?? INTRO_SECONDS,
    links: {
      major: snapshot.club?.PROJECT_URL || PROJECT_URL,
      join: snapshot.club?.JOIN_URL || JOIN_URL,
    },
  };
}
