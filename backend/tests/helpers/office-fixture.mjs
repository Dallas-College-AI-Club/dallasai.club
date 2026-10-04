import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from './custom-survey-fixture.mjs';
import { adminHandler } from '../../api/admin.mjs';
import { surveysHandler } from '../../api/surveys.mjs';
import { eventHandler } from '../../api/events.mjs';
import { saveEvent, liveEvents } from '../../lib/events.mjs';
import { rawBody } from '../../lib/http.mjs';
export async function officeFixture() {
  const f = await fixture(),
    db = f.db;
  const backend = path.resolve(import.meta.dirname, '../..'),
    site = path.resolve(backend, '../public');
  const workshop = JSON.parse(
    await readFile(path.join(backend, 'tests/fixtures/workshop.json'), 'utf8'),
  );
  const event = await saveEvent(
    db,
    {
      id: 'office-audit-event',
      revision: 0,
      action: 'publish',
      event: {
        ...workshop,
        title: 'Office audit event',
        date: '2030-10-04',
        endDate: '',
        images: [],
        surveyQuestions: [
          {
            id: randomUUID(),
            label: 'Preferred time?',
            type: 'single',
            options: ['Afternoon', 'Evening'],
            required: true,
            allowOther: false,
          },
        ],
      },
    },
    'officer@example.com',
  );
  const entries = [];
  for (const kind of [
    'join',
    'subscribe',
    'rsvp',
    'question',
    'workshop',
    'contribution',
  ]) {
    const id = randomUUID(),
      email = kind + '@example.edu',
      name = 'Office ' + kind;
    const data =
      kind === 'rsvp'
        ? {
            eventId: event.id,
            eventTitle: event.draft.title,
            eventDate: '2030-10-04',
            hasSurvey: true,
          }
        : {
            ...(kind === 'join' ? { campus: 'Richland', interests: '' } : {}),
            message: 'Saved ' + kind + ' example',
            topic: 'Example topic',
          };
    await db.query(
      `INSERT INTO club_forms.entries(id,kind,email,name,dedupe_key,data) VALUES($1::uuid,$2,$3,$4,$1::text,$5)`,
      [id, kind, email, name, JSON.stringify(data)],
    );
    if (kind === 'rsvp')
      await db.query(
        `INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,event_date,survey_version,questions,answers) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          event.id,
          event.draft.title,
          '2030-10-04',
          event.published.surveyVersion,
          JSON.stringify(event.draft.surveyQuestions),
          JSON.stringify([
            {
              questionId: event.draft.surveyQuestions[0].id,
              value: 'Afternoon',
              other: '',
            },
          ]),
        ],
      );
    entries.push({ id, kind, email, name });
  }
  // The officer signed in through the mocked email codes below; requests act
  // as this address.
  let signedIn = true,
    sessionEmail = 'officer@example.com';
  // Set session.expiresAt to have get-session report a session deadline.
  const session = { expiresAt: undefined };
  const authorize = (req) => ({ ...f.authorize(req), email: sessionEmail });
  const admin = adminHandler({
    authorize,
    getDatabase: () => db,
    getEvents: () => liveEvents(db, []),
  });
  const surveys = surveysHandler({
    authorize,
    getDatabase: () => db,
  });
  const events = eventHandler({
    authorize,
    getDatabase: () => db,
    originals: [],
    rateLimit: async () => {},
  });
  const json = (res, body, status = 200) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/auth/get-session')
      return json(
        res,
        signedIn
          ? {
              user: { email: sessionEmail },
              ...(session.expiresAt
                ? { session: { expiresAt: session.expiresAt } }
                : {}),
            }
          : null,
      );
    // Neon Auth email codes: any address gets a code, and 123456 signs in.
    if (url.pathname === '/api/auth/email-otp/send-verification-otp')
      return json(res, { success: true });
    if (url.pathname === '/api/auth/sign-in/email-otp') {
      const body = JSON.parse(await rawBody(req));
      if (body.otp !== '123456')
        return json(res, { code: 'INVALID_OTP', message: 'Invalid OTP' }, 400);
      signedIn = true;
      sessionEmail = body.email;
      res.setHeader(
        'Set-Cookie',
        'test-officer=yes; Path=/; HttpOnly; SameSite=Strict',
      );
      return json(res, { token: 'test', user: { email: body.email } });
    }
    if (url.pathname === '/api/auth/sign-out') {
      signedIn = false;
      return json(res, { success: true });
    }
    if (url.pathname === '/test-signin') {
      signedIn = true;
      sessionEmail = 'officer@example.com';
      res.setHeader(
        'Set-Cookie',
        'test-officer=yes; Path=/; HttpOnly; SameSite=Strict',
      );
      res.writeHead(302, { Location: '/admin/' });
      return res.end();
    }
    if (!signedIn && url.pathname.startsWith('/api/')) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      return res.end('{"error":"Sign in again."}');
    }
    if (url.pathname === '/api/admin') return admin(req, res);
    if (url.pathname === '/api/surveys') return surveys(req, res);
    if (url.pathname === '/api/events') return events(req, res);
    if (url.pathname === '/api/custom-surveys') return f.handler(req, res);
    const root =
      url.pathname.startsWith('/admin/') || url.pathname.startsWith('/surveys/')
        ? path.join(backend, 'public')
        : site;
    const file = path.resolve(
      root,
      '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''),
    );
    try {
      if (!file.startsWith(root + path.sep)) throw Error('Path');
      const body = await readFile(file);
      res.setHeader(
        'Content-Type',
        file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : file.endsWith('.html')
              ? 'text/html'
              : 'application/octet-stream',
      );
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        file.endsWith(path.join('admin', 'index.html'))
          ? body
              .toString()
              .replace(
                'data-site-origin="https://dallasai.club"',
                'data-site-origin="' + origin + '"',
              )
          : body,
      );
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
  return {
    ...f,
    event,
    entries,
    origin,
    session,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    },
  };
}
