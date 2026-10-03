// Isolated manual/browser regression fixture. No production credentials or emails.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/custom-survey-fixture.mjs';
import { changeDraft } from '../lib/survey-builder.mjs';
import { privateSurveyToken } from '../lib/custom-surveys.mjs';

const f = await fixture(),
  id = randomUUID();
const port = Number(process.env.SURVEY_TEST_PORT || 4188);
const origin = 'http://127.0.0.1:' + port;
process.env.AUTH_BASE_URL = origin;
const definition = {
  template: 'blank',
  title: 'Survey quality checks',
  intro: 'Synthetic data for local testing.',
  audience: 'public',
  durationDays: 30,
  permissions: {
    preview: 'link',
    answer: 'verified',
    results: 'respondents',
  },
  questions: [
    {
      id: randomUUID(),
      title: 'Your feedback',
      description: '',
      type: 'text',
      required: true,
      options: [],
    },
    {
      id: randomUUID(),
      title: 'Optional comment',
      description: '',
      type: 'text',
      required: false,
      options: [],
    },
    {
      id: randomUUID(),
      title: 'Choose a game',
      description: '',
      type: 'single',
      required: false,
      options: ['Chess', 'Cards'],
    },
  ],
};
for (const [action, expectedRevision] of [
  ['save', 0],
  ['publish', 1],
])
  await changeDraft(
    f.db,
    { email: 'officer@example.com' },
    {
      id,
      definition,
      action,
      expectedRevision,
      requestId: randomUUID(),
    },
  );
for (let n = 0; n < 23; n++) {
  const who = 'respondent-' + String(n).padStart(2, '0');
  await f.db.query(
    'INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email,active) VALUES($1,$2,$2,$3,$4)',
    [id, who, who + '@example.com', n !== 22],
  );
  await f.db.query(
    'INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses) VALUES($1,$2,1,$3)',
    [
      id,
      who,
      JSON.stringify([
        {
          id: definition.questions[0].id,
          title: 'Your feedback',
          mode: 'form',
          text: 'Synthetic answer ' + n,
          value: 'Synthetic answer ' + n,
        },
      ]),
    ],
  );
}
const root = path.resolve(import.meta.dirname, '../public');
let dropNext = false,
  rejectExport = false;
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/test-controls') {
      if (req.method === 'POST') {
        if (url.searchParams.has('export')) rejectExport = true;
        else dropNext = true;
      }
      const counts = (
        await f.db.query(
          'SELECT count(*)::int AS receipts FROM club_forms.custom_survey_receipts WHERE survey_id=$1',
          [id],
        )
      ).rows[0];
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(
        `<!doctype html><title>Local survey test controls</title><h1>Local survey test controls</h1><p>No production services.</p><form method="post"><button>Drop the next submit reply after saving</button></form><form method="post" action="?export=1"><button>Reject the next CSV export as too large</button></form><p>${dropNext ? 'Armed: next save will lose its reply.' : 'Normal replies.'}</p><p>Saved submission receipts: ${counts.receipts}</p>`,
      );
    }
    if (url.pathname === '/api/custom-surveys') {
      if (
        dropNext &&
        req.method === 'POST' &&
        url.searchParams.get('action') === 'submit'
      ) {
        dropNext = false;
        res.end = () => {
          req.socket.destroy();
        };
      }
      return f.handler(req, res);
    }
    if (url.pathname === '/test-officer') {
      res.setHeader(
        'Set-Cookie',
        'test-officer=yes; Path=/; HttpOnly; SameSite=Strict',
      );
      res.writeHead(302, { Location: '/admin/#surveys' });
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) {
      if (
        url.pathname === '/api/admin' &&
        url.searchParams.get('export') === 'csv'
      ) {
        if (rejectExport) {
          rejectExport = false;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              error:
                'This export exceeds 10,000 submissions. Narrow the filters and try again.',
            }),
          );
        }
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="club-submissions.csv"',
        });
        return res.end(
          'Name,Email\nSynthetic respondent,audit@example.com\n',
        );
      }
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify(
          url.pathname === '/api/auth/get-session'
            ? { user: { email: 'officer@example.com' } }
            : {
                user: 'officer@example.com',
                entries: [],
                counts: [],
                events: [],
                responses: [],
                configured: { uploads: true },
                notifications: { email: false },
              },
        ),
      );
    }
    try {
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
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/html; charset=utf-8',
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  })
  .listen(port, '127.0.0.1', () =>
    console.log(
      JSON.stringify({
        officer: origin + '/test-officer',
        respondent:
          origin + '/surveys/#invite=' + privateSurveyToken(id),
        controls: origin + '/test-controls',
        email: 'audit@example.com',
        code: '123456',
      }),
    ),
  );
