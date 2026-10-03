// Local browser fixture: synthetic records in memory; no production services.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { adminHandler } from '../api/admin.mjs';
import { surveysHandler } from '../api/surveys.mjs';
import { submit } from '../lib/submissions.mjs';
import { surveyQuestions, surveyVersion } from '../lib/surveys.mjs';
const db = new PGlite(),
  root = path.resolve(import.meta.dirname, '../public');
for (const file of [
  '003_club_forms.sql',
  '005_screen_confirmations.sql',
  '007_office_tools.sql',
  '009_submission_comments.sql',
  '010_event_surveys.sql',
  '014_event_response_management.sql',
  '015_contact_identity_management.sql',
  '016_submission_management.sql',
  '017_contact_profile_editing.sql',
])
  await db.exec(
    await readFile(new URL('../' + file, import.meta.url), 'utf8'),
  );
const event = {
  id: 'game-night',
  ...JSON.parse(
    await readFile(
      new URL('./fixtures/game-night.json', import.meta.url),
      'utf8',
    ),
  ),
  date: '2099-10-16',
};
const questions = surveyQuestions(event.surveyQuestions);
for (let i = 0; i < 2; i++) {
  await submit(
    db,
    {
      kind: 'rsvp',
      requestId: randomUUID(),
      consent: true,
      eventId: event.id,
      email: `tester${i}@example.edu`,
      name: 'Test Respondent ' + i,
      surveyVersion: surveyVersion(questions),
      answers: questions.map((q) => ({
        questionId: q.id,
        value:
          q.type === 'text'
            ? 'A test answer'
            : q.type === 'multiple'
              ? [q.options[0]]
              : q.options[0],
        other: '',
      })),
    },
    [event],
  );
}
await submit(
  db,
  {
    kind: 'question',
    requestId: randomUUID(),
    consent: true,
    email: 'question@example.edu',
    name: 'Test Question',
    subject: 'Accessibility',
    message: 'Is the room accessible?',
  },
  [],
);
const past = randomUUID();
await db.query(
  "INSERT INTO club_forms.entries(id,kind,email,name,dedupe_key,data) VALUES($1::uuid,'rsvp','past@example.edu','Past Attendee',$1::text,$2)",
  [
    past,
    JSON.stringify({
      eventId: 'past-event',
      eventTitle: 'Past workshop',
      eventDate: '2020-01-01',
    }),
  ],
);
const config = {
  getDatabase: () => db,
  getEvents: async () => [event],
  authorize: async () => ({ email: 'admin@example.edu' }),
  storage: { del: async () => {} },
};
const admin = adminHandler(config),
  surveys = surveysHandler(config);
const port = Number(process.env.PORT || 4194),
  origin = 'http://127.0.0.1:' + port;
process.env.AUTH_BASE_URL = origin;
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (url.pathname === '/api/admin') return admin(req, res);
      if (url.pathname === '/api/surveys') return surveys(req, res);
      if (url.pathname === '/api/custom-surveys') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(
          '{"surveys":[],"responses":[],"members":[],"hasMore":false}',
        );
      }
      if (url.pathname.startsWith('/api/auth/')) {
        res.setHeader('Content-Type', 'application/json');
        return res.end('{"user":{"email":"admin@example.edu"}}');
      }
      if (url.pathname === '/qa') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(
          `<!doctype html><title>Office responsive check</title><style>body{margin:0}iframe{border:0;display:block;max-width:none}output{display:block;font:12px monospace}</style><label>Viewport<select><option>320</option><option>768</option><option>1440</option></select></label><output aria-label="Layout measurements"></output><iframe title="Office under test" src="/admin/" height="950"></iframe><script>const frame=document.querySelector('iframe'),select=document.querySelector('select');function resize(){frame.width=select.value}select.onchange=resize;resize();setInterval(()=>{const d=frame.contentDocument,w=frame.contentWindow;document.querySelector('output').textContent=JSON.stringify({width:w.innerWidth,scrollWidth:d.documentElement.scrollWidth,dialog:d.querySelector('dialog[open]')?.scrollWidth,dialogWidth:d.querySelector('dialog[open]')?.clientWidth})},250)</script>`,
        );
      }
      const file = path.resolve(
        root,
        '.' +
          url.pathname +
          (url.pathname.endsWith('/') ? 'index.html' : ''),
      );
      if (!file.startsWith(root + path.sep)) throw Error('Path');
      res.setHeader(
        'Content-Type',
        file.endsWith('.js')
          ? 'text/javascript; charset=utf-8'
          : file.endsWith('.css')
            ? 'text/css; charset=utf-8'
            : 'text/html; charset=utf-8',
      );
      res.setHeader('Cache-Control', 'no-store');
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  })
  .listen(port, '127.0.0.1', () =>
    console.log(
      'Synthetic response management fixture: ' + origin + '/admin/',
    ),
  );
