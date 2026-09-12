// Legacy prototype regression harness. Hugo serves previews and builds production.
import http from 'node:http';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs, { promises as storeFs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream';
import { articleUrl } from './public/content/article-links.js';

// Ranking storage
export const GAMES = new Set(['explore', 'ride', 'snake']);
export class ScoreValidationError extends Error {}
export function centralDate(time = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(time);
}
export class ScoreStore {
  constructor(file, { now = () => new Date() } = {}) {
    this.file = file;
    this.queue = Promise.resolve();
    this.now = now;
  }
  async read() {
    try {
      const data = JSON.parse(await storeFs.readFile(this.file, 'utf8'));
      if (!Array.isArray(data)) throw Error('Invalid score file');
      return data.map((e) => ({
        ...e,
        game: e.game || 'explore',
        date: e.date || centralDate(new Date(e.savedAt)),
      }));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }
  async list({ game = 'explore', date = 'all' } = {}) {
    if (!GAMES.has(game) || (date !== 'all' && !/^\d{4}-\d{2}-\d{2}$/.test(date)))
      throw new ScoreValidationError('Invalid category');
    await this.queue;
    const entries = (await this.read()).filter(
      (e) => e.game === game && (date === 'all' || e.date === date),
    );
    const best = new Map();
    for (const row of entries) {
      const current = best.get(row.playerId);
      if (
        !current ||
        row.score > current.score ||
        (row.score === current.score && row.savedAt < current.savedAt)
      )
        best.set(row.playerId, row);
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score || a.savedAt.localeCompare(b.savedAt))
      .slice(0, 10)
      .map(({ nickname, score, game, date, savedAt }) => ({
        nickname,
        score,
        game,
        date,
        savedAt,
      }));
  }
  save(input) {
    const game = input?.game || 'explore';
    if (
      !input ||
      !GAMES.has(game) ||
      typeof input.nickname !== 'string' ||
      !/^[\p{L}\p{N} _.-]{2,20}$/u.test(input.nickname.trim()) ||
      typeof input.playerId !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(input.playerId) ||
      !Number.isSafeInteger(input.score) ||
      input.score < 1 ||
      input.score > 1000000
    )
      return Promise.reject(new ScoreValidationError('Invalid score'));
    const work = this.queue.then(async () => {
      const entries = await this.read(),
        nickname = input.nickname.trim(),
        now = this.now(),
        date = centralDate(now),
        savedAt = now.toISOString(),
        current = entries.find(
          (e) => e.playerId === input.playerId && e.game === game && e.date === date,
        );
      if (current) {
        current.nickname = nickname;
        if (input.score > current.score) {
          current.score = input.score;
          current.savedAt = savedAt;
        }
      } else
        entries.push({
          playerId: input.playerId,
          nickname,
          game,
          date,
          score: input.score,
          savedAt,
        });
      await storeFs.mkdir(path.dirname(this.file), { recursive: true });
      await storeFs.writeFile(this.file + '.tmp', JSON.stringify(entries, null, 2));
      await storeFs.rename(this.file + '.tmp', this.file);
      return true;
    });
    // A failed write rejects its caller without blocking every later submission.
    this.queue = work.catch(() => {});
    return work;
  }
}

// Latest content refreshes
// Each refresh uses a short-lived module context, so changed files AND their
// imports are re-read. No ever-growing cache-busting imports or copied datasets.
function freshContent(root, now, format) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { root, now: now.toISOString(), format },
      execArgv: [],
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Content refresh timed out'));
    }, 5000);
    worker.once('message', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Content worker exited before returning updates'));
    });
  });
}

// Coalesce concurrent visitors and briefly cache results; failed reads are retried.
function createContentReader(root, format, { cacheMs = 15000, now = () => new Date() } = {}) {
  let cache = null,
    cachedAt = 0,
    pending = null;
  return async () => {
    if (cache && Date.now() - cachedAt < cacheMs) return cache;
    if (!pending)
      pending = freshContent(root, now(), format)
        .then((data) => {
          cache = data;
          cachedAt = Date.now();
          return data;
        })
        .finally(() => {
          pending = null;
        });
    return pending;
  };
}

export const createLatestReader = (root, options) => createContentReader(root, 'latest', options);
export const createReviewReader = (root, options) => createContentReader(root, 'rss', options);

export function buildReviewFeed(articles, siteURL, now = new Date()) {
  const escape = (value) =>
    String(value).replace(
      /[<>&"']/g,
      (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char],
    );
  const url = (query) => new URL('club.html?' + query, siteURL).href;
  const items = articles
    .map((article, index) => ({
      article,
      index,
      published: Date.parse(article.publishedAt || article.date || ''),
    }))
    .filter(({ published }) => !Number.isFinite(published) || published <= +now)
    .sort(
      (a, b) =>
        (Number.isFinite(b.published) ? b.published : -Infinity) -
          (Number.isFinite(a.published) ? a.published : -Infinity) || a.index - b.index,
    )
    .map(
      ({ article, published }) =>
        `<item><title>${escape(article.title)}</title><link>${escape(new URL(articleUrl(article), siteURL).href)}</link><guid isPermaLink="false">ai-review:${escape(article.slug)}</guid><description>${escape((article.isSample || !article.author ? 'Editorial sample. ' : '') + article.abstract)}</description>${Number.isFinite(published) ? '<pubDate>' + new Date(published).toUTCString() + '</pubDate>' : ''}</item>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>The AI Review</title><link>${escape(url('mode=journal'))}</link><description>Articles and editorial samples from Dallas College AI Club.</description><language>en-us</language>${items}</channel></rss>\n`;
}

// HTTP routes and static files
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/rss+xml',
  '.ics': 'text/calendar',
};
const json = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
};
export function createClubServer(root, store) {
  root = path.resolve(root);
  const latest = createLatestReader(root),
    review = createReviewReader(root);
  return http.createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (name === '/review-feed.xml') {
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.writeHead(405, { Allow: 'GET, HEAD' }).end();
          return;
        }
        try {
          const feed = await review();
          res.writeHead(200, {
            'Content-Type': types['.xml'] + '; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(req.method === 'HEAD' ? undefined : feed);
        } catch {
          json(res, 503, { error: 'The publication feed is temporarily unavailable.' });
        }
        return;
      }
      if (name === '/api/latest') {
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.writeHead(405, { Allow: 'GET, HEAD' }).end();
          return;
        }
        try {
          const data = await latest();
          if (req.method === 'HEAD')
            res
              .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
              .end();
          else json(res, 200, data);
        } catch {
          json(res, 503, { error: 'Club updates are temporarily unavailable.' });
        }
        return;
      }
      if (name === '/api/leaderboard' && req.method === 'GET') {
        const q = new URL(req.url, 'http://localhost').searchParams;
        try {
          json(res, 200, {
            entries: await store.list({
              game: q.get('game') || 'explore',
              date: q.get('date') || 'all',
            }),
          });
        } catch (error) {
          const invalid = error instanceof ScoreValidationError;
          json(res, invalid ? 400 : 500, {
            error: invalid ? 'Invalid ranking category' : 'Rankings are temporarily unavailable',
          });
        }
        return;
      }
      if (name === '/api/scores' && req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) {
          json(res, 403, { error: 'Origin mismatch' });
          return;
        }
        if (!req.headers['content-type']?.startsWith('application/json')) {
          json(res, 415, { error: 'JSON required' });
          return;
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 2048) {
            json(res, 413, { error: 'Too large' });
            return;
          }
          chunks.push(chunk);
        }
        try {
          // Decode once: a network chunk can end halfway through a Unicode character.
          await store.save(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          json(res, 200, { saved: true });
        } catch (error) {
          const invalid = error instanceof SyntaxError || error instanceof ScoreValidationError;
          json(res, invalid ? 400 : 500, {
            error: invalid ? 'Invalid score' : 'Your score could not be saved. Please try again.',
          });
        }
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      const p = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
      if (!p.startsWith(root + path.sep) || name.split('/').some((part) => part.startsWith('.'))) {
        res.writeHead(403).end();
        return;
      }
      fs.stat(p, (error, stat) => {
        if (error || !stat.isFile()) {
          res.writeHead(404).end('Not found');
          return;
        }
        const headers = {
          'Content-Type': types[path.extname(p)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Accept-Ranges': 'bytes',
          ETag: `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`,
          'Last-Modified': stat.mtime.toUTCString(),
          Vary: 'Accept-Encoding',
        };
        const matches = req.headers['if-none-match'];
        const unchanged = matches
          ? matches
              .split(',')
              .some(
                (tag) =>
                  tag.trim() === '*' ||
                  tag.trim().replace(/^W\//, '') === headers.ETag.replace(/^W\//, ''),
              )
          : stat.mtimeMs < Date.parse(req.headers['if-modified-since']) + 1000;
        if (unchanged) {
          res.writeHead(304, headers).end();
          return;
        }
        let start = 0,
          end = stat.size - 1,
          status = 200;
        // A changed file must be sent in full instead of resuming an older representation.
        const range =
          !req.headers['if-range'] || stat.mtimeMs < Date.parse(req.headers['if-range']) + 1000
            ? req.headers.range
            : null;
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!m || (!m[1] && !m[2]) || stat.size === 0) {
            res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }).end();
            return;
          }
          start = m[1] ? +m[1] : Math.max(0, stat.size - Number(m[2]));
          end = m[1] && m[2] ? Math.min(+m[2], end) : end;
          if (start > end) {
            res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }).end();
            return;
          }
          status = 206;
          headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        }
        const gzip =
          status === 200 &&
          stat.size >= 1024 &&
          /\.(?:html|js|css|json|svg|xml)$/.test(p) &&
          (req.headers['accept-encoding'] || '').split(',').some((part) => {
            const [name, ...options] = part.trim().split(';');
            const quality = options.find((option) => option.trim().startsWith('q='));
            return name === 'gzip' && (!quality || Number(quality.trim().slice(2)) > 0);
          });
        if (gzip) headers['Content-Encoding'] = 'gzip';
        else headers['Content-Length'] = end - start + 1;
        res.writeHead(status, headers);
        if (req.method === 'HEAD' || stat.size === 0) res.end();
        else {
          const streams = [fs.createReadStream(p, { start, end })];
          if (gzip) streams.push(createGzip());
          pipeline(...streams, res, () => {});
        }
      });
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });
}

// Importing the server from tests does not start a listener.
if (!isMainThread) {
  const source = (file) => import(pathToFileURL(path.join(workerData.root, 'content', file)).href);
  const now = new Date(workerData.now);
  if (workerData.format === 'rss') {
    const [{ articles }, { SITE_URL }] = await Promise.all([
      source('articles.js'),
      source('club.js'),
    ]);
    parentPort.postMessage(buildReviewFeed(articles, SITE_URL, now));
  } else {
    const { buildLatest } = await source('latest.js');
    parentPort.postMessage(buildLatest(now));
  }
} else if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const root = path.join(import.meta.dirname, 'public');
  const store = new ScoreStore(
    path.join(import.meta.dirname, '.preview', 'legacy-leaderboard.json'),
  );
  createClubServer(root, store).listen(port, '127.0.0.1', () =>
    console.log('Local: http://127.0.0.1:' + port),
  );
}
