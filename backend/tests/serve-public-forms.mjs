// Isolated public-site checks: run Hugo with local API URLs, then this fixture.
// All submissions go to a fresh in-memory database. No production services.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { testDatabase } from './helpers/db.mjs';
import { formsHandler } from '../api/forms.mjs';
import { publicContent } from '../lib/event-content.mjs';

const db = await testDatabase();
const root = path.resolve(import.meta.dirname, '../../public');
const source = path.resolve(import.meta.dirname, '../../static');
const origin = 'http://127.0.0.1:4186';
process.env.FORMS_ALLOWED_ORIGINS = origin;
delete process.env.BLOB_READ_WRITE_TOKEN;
const event = JSON.parse(
  await readFile(new URL('./fixtures/game-night.json', import.meta.url)),
);
event.date = '2099-10-16';
let unavailable = false,
  dropReply = false,
  cutoff = null;
const getEvents = async () => {
  const content = publicContent('game-night', event);
  return [{ ...content, date: cutoff || content.date }];
};
const forms = formsHandler({
  getDatabase: () => db,
  getEvents,
  rateLimit: async () => {},
});
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (url.pathname === '/api/events') {
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = unavailable ? 503 : 200;
        return res.end(
          JSON.stringify(
            unavailable
              ? { error: 'Calendar unavailable' }
              : { events: await getEvents() },
          ),
        );
      }
      if (url.pathname === '/api/forms') {
        if (dropReply) {
          const end = res.end.bind(res);
          res.end = (...args) =>
            res.statusCode === 200 ? res.destroy() : end(...args);
        }
        return forms(req, res);
      }
      if (url.pathname === '/control' && req.method === 'POST') {
        const action = url.searchParams.get('action');
        if (action === 'fail') unavailable = true;
        if (action === 'recover') unavailable = dropReply = false;
        if (action === 'drop') dropReply = true;
        if (action === 'expire')
          cutoff = new Date(Date.now() + 30000).toISOString();
        if (action === 'future') cutoff = null;
        if (action === 'questions')
          event.surveyQuestions[0].label += ' Updated question.';
        res.writeHead(303, { Location: '/test-controls' });
        return res.end();
      }
      if (url.pathname === '/test-controls') {
        const counts = (
          await db.query(
            'SELECT kind,count(*)::int AS count FROM club_forms.entries GROUP BY kind ORDER BY kind',
          )
        ).rows;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(
          '<!doctype html><title>Public form test controls</title><h1>Isolated test controls</h1>' +
            ['fail', 'recover', 'drop', 'expire', 'future', 'questions']
              .map(
                (action) =>
                  '<form method="post" action="/control?action=' +
                  action +
                  '"><button>' +
                  action +
                  '</button></form>',
              )
              .join('') +
            '<h2>Saved submissions</h2><pre>' +
            JSON.stringify(counts, null, 2) +
            '</pre><a href="/test-controls">Refresh counts</a>' +
            '<p><a href="/club.html?mode=join">Open club</a></p>',
        );
      }
      if (url.pathname === '/qa') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(
          '<!doctype html><title>Public site phone check</title><style>body{margin:0}iframe{display:block;border:0;height:calc(100vh - 26px)}</style><label>Width <select id="width"><option>320</option><option>360</option><option>390</option><option>768</option><option>1280</option><option>1440</option></select></label><label>Page <select id="page"><option value="/club.html?mode=join">Join</option><option value="/">Entrance</option><option value="/club.html?mode=events">Events</option></select></label><iframe width="320" src="/club.html?mode=join" title="Public site"></iframe><script>const frame=document.querySelector("iframe");document.querySelector("#width").onchange=e=>frame.width=e.target.value;document.querySelector("#page").onchange=e=>frame.src=e.target.value;</script>',
        );
      }
      const route =
        url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const file = path.resolve(root, '.' + route);
      if (!file.startsWith(root + path.sep)) throw Error('Path');
      let data;
      if (route === '/app/event-format.js')
        data = await readFile(
          new URL('../lib/event-format.mjs', import.meta.url),
        );
      else
        data = await readFile(path.resolve(source, '.' + route)).catch(() =>
          readFile(file),
        );
      res.setHeader(
        'Content-Type',
        mime[path.extname(file)] || 'application/octet-stream',
      );
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  })
  .listen(4186, '127.0.0.1', () => console.log(origin + '/test-controls'));
