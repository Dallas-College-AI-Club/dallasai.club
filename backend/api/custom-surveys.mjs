import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin } from '../lib/auth.mjs';
import { neonSession, proxyNeonAuth } from '../lib/neon-auth.mjs';
import { expiredAdminCookies } from '../lib/admin-session.mjs';
import { send, fail, jsonBody, limit } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { definition } from '../lib/survey-contract.mjs';
import {
  respondentList,
  changeRespondent,
} from '../lib/survey-respondents.mjs';
import {
  linkedSurvey,
  surveyMembers,
  requireDevice,
  rememberDevice,
  deviceHeader,
  deviceCookie,
  cookieValue,
  digest,
  currentResponses,
  submitSurvey,
  privateSurveyToken,
} from '../lib/custom-surveys.mjs';
export const config = { api: { bodyParser: false } };
export function customSurveysHandler({
  getDatabase = database,
  authorize = requireAdmin,
  getSession = neonSession,
  authProxy = proxyNeonAuth,
  rateLimit = (db, req) => limit(db, req, 'custom-survey', 120, 300),
} = {}) {
  return async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      const url = new URL(req.url, 'https://survey.invalid'),
        action = url.searchParams.get('action') || 'bootstrap';
      if (!['GET', 'POST'].includes(req.method))
        throw new RequestError(405, 'Method not allowed.');
      if (req.method === 'POST') adminOrigin(req);
      if (action === 'members' || action === 'member-change') {
        const actor = await authorize(req);
        const db = getDatabase();
        if (action === 'members' && req.method === 'GET')
          return send(res, 200, {
            ...(await respondentList(db, url.searchParams.get('id'))),
            currentUser: {
              email: actor.email,
              name: actor.name || actor.email,
            },
          });
        if (action === 'member-change' && req.method === 'POST')
          return send(
            res,
            200,
            await changeRespondent(db, actor, await jsonBody(req, 10000)),
          );
        throw new RequestError(405, 'Method not allowed.');
      }
      if (action === 'catalog' || action === 'results') {
        await authorize(req);
        if (req.method !== 'GET')
          throw new RequestError(405, 'Survey results are read-only.');
        const db = getDatabase();
        if (action === 'catalog') {
          const surveys = (
            await db.query(
              `SELECT s.id,s.title,s.status,s.expires_at,s.content_version,s.link_digest,count(r.advisor_id)::int AS response_count FROM club_forms.custom_surveys s LEFT JOIN club_forms.custom_survey_responses r ON r.survey_id=s.id GROUP BY s.id ORDER BY s.created_at DESC`,
            )
          ).rows;
          return send(res, 200, {
            surveys: surveys.map(({ link_digest, ...s }) => ({
              ...s,
              privateLink:
                s.status === 'open' &&
                new Date(s.expires_at) > new Date() &&
                digest(privateSurveyToken(s.id)) === link_digest
                  ? new URL(
                      '/surveys/#invite=' + privateSurveyToken(s.id),
                      process.env.AUTH_BASE_URL,
                    ).href
                  : null,
            })),
          });
        }
        const id = url.searchParams.get('id');
        if (!/^[0-9a-f-]{36}$/i.test(id || ''))
          throw new RequestError(400, 'Choose a survey.');
        const survey = (
          await db.query(
            'SELECT id,title,status,content_version FROM club_forms.custom_surveys WHERE id=$1',
            [id],
          )
        ).rows[0];
        if (!survey) throw new RequestError(404, 'Survey not found.');
        return send(res, 200, {
          survey,
          results: await currentResponses(db, id),
          readOnly: true,
        });
      }
      const db = getDatabase();
      await rateLimit(db, req);
      const link = req.headers['x-survey-link'],
        survey = await linkedSurvey(db, link);
      if (action === 'welcome' && req.method === 'GET')
        return send(res, 200, {
          title: survey.title,
          expiresAt: survey.expires_at,
        });
      if (action === 'preview' && req.method === 'GET')
        return send(res, 200, {
          definition,
          expiresAt: survey.expires_at,
          readOnly: true,
        });
      if (action === 'auth') {
        const path = url.searchParams.get('path');
        if (
          req.method !== 'POST' ||
          !['email-otp/send-verification-otp', 'sign-in/email-otp'].includes(
            path,
          )
        )
          throw new RequestError(404, 'Sign-in action unavailable.');
        const members = await surveyMembers(db, survey.id);
        req.url = '/api/auth/' + path;
        return await authProxy(req, res, {
          approvedEmail: (email) => members.some((m) => m.email === email),
        });
      }
      if (action === 'verify-device') {
        if (req.method !== 'POST') throw new RequestError(405, 'Use POST.');
        const { token } = await rememberDevice(
          db,
          survey,
          (await getSession(req))?.user,
        );
        res.setHeader(
          'Set-Cookie',
          deviceHeader(
            survey,
            token,
            Math.max(
              0,
              Math.floor((new Date(survey.expires_at) - Date.now()) / 1000),
            ),
          ),
        );
        return send(res, 200, { verified: true });
      }
      if (action === 'signout') {
        if (req.method !== 'POST') throw new RequestError(405, 'Use POST.');
        await db.query(
          'UPDATE club_forms.custom_survey_devices SET revoked_at=now() WHERE token_digest=$1 AND survey_id=$2',
          [digest(cookieValue(req, deviceCookie(survey))), survey.id],
        );
        res.setHeader('Set-Cookie', [
          deviceHeader(survey, '', 0),
          ...expiredAdminCookies(),
        ]);
        return send(res, 200, { signedOut: true });
      }
      const member = await requireDevice(db, req, survey);
      if (action === 'bootstrap' && req.method === 'GET') {
        const members = await surveyMembers(db, survey.id);
        return send(res, 200, {
          mode: 'connected',
          survey: {
            id: survey.id,
            title: survey.title,
            expiresAt: survey.expires_at,
          },
          advisorId: member.advisor_id,
          definition: {
            ...definition,
            respondents: members.map((m) => ({
              id: m.advisor_id,
              name: m.display_name,
            })),
          },
          results: await currentResponses(db, survey.id, member.advisor_id),
        });
      }
      if (action === 'submit' && req.method === 'POST')
        return send(res, 200, {
          receipt: await submitSurvey(
            db,
            req,
            link,
            await jsonBody(req, 150000),
          ),
        });
      throw new RequestError(404, 'Survey action unavailable.');
    } catch (error) {
      fail(res, error);
    }
  };
}
export default customSurveysHandler();
