import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { customSurveysHandler } from '../../api/custom-surveys.mjs';
import { privateSurveyToken, digest } from '../../lib/custom-surveys.mjs';
import { definition } from '../../lib/survey-contract.mjs';
import { RequestError } from '../../lib/errors.mjs';
import { jsonBody, send } from '../../lib/http.mjs';
export async function fixture() {
  const db = new PGlite();
  for (const name of [
    '003_club_forms.sql',
    '005_screen_confirmations.sql',
    '010_event_surveys.sql',
    '011_custom_surveys.sql',
  ])
    await db.exec(
      await readFile(new URL('../../' + name, import.meta.url), 'utf8'),
    );
  process.env.FORM_TOKEN_SECRET = 'isolated-survey-tests-' + 'x'.repeat(40);
  const id = randomUUID(),
    token = privateSurveyToken(id);
  await db.query(
    `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,expires_at) VALUES($1,'advisor-studio','Advisor Studio',$2,'open',$3,now()+interval '30 days')`,
    [id, definition.content_version, digest(token)],
  );
  for (const p of definition.respondents)
    await db.query(
      'INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email) VALUES($1,$2,$3,$4)',
      [id, p.id, p.name, p.id + '@example.com'],
    );
  const authorize = (req) => {
    if (req.headers.cookie?.includes('test-officer=yes'))
      return { email: 'officer@example.com' };
    throw new RequestError(401, 'Sign in as an officer.');
  };
  const getSession = async (req) => {
    const advisor = /test-neon=(pearlman|bracewell)/.exec(
      req.headers.cookie || '',
    )?.[1];
    return advisor
      ? {
          user: {
            id: 'neon-' + advisor,
            email: advisor + '@example.com',
            emailVerified: true,
            role: 'user',
          },
        }
      : null;
  };
  const authProxy = async (req, res, { approvedEmail }) => {
    const body = await jsonBody(req);
    if (req.url.includes('send-verification'))
      return send(res, 200, { success: true });
    if (!(await approvedEmail(body.email)) || body.otp !== '123456')
      throw new RequestError(401, 'Use the latest sign-in code.');
    res.setHeader(
      'Set-Cookie',
      'test-neon=' +
        body.email.split('@')[0] +
        '; Path=/; HttpOnly; SameSite=Strict',
    );
    send(res, 200, { user: { email: body.email } });
  };
  const handler = customSurveysHandler({
    getDatabase: () => db,
    authorize,
    getSession,
    authProxy,
    rateLimit: async () => {},
  });
  return { db, id, token, handler, authorize, getSession };
}
