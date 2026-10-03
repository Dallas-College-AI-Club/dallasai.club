import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin } from '../lib/auth.mjs';
import { neonSession, proxyNeonAuth } from '../lib/neon-auth.mjs';
import { expiredAdminCookies } from '../lib/admin-session.mjs';
import { send, fail, jsonBody, limit } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { definition } from '../lib/survey-contract.mjs';
import { getDraft, changeDraft, builderLinks } from '../lib/survey-builder.mjs';
import {
  respondentList,
  changeRespondent,
} from '../lib/survey-respondents.mjs';
import {
  linkedSurvey,
  linkedPreview,
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
      if (action === 'archived-responses') {
        await authorize(req);
        if (req.method !== 'GET')
          throw new RequestError(405, 'Archived responses are read-only.');
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
          throw new RequestError(400, 'Choose a valid archive page.');
        const rows = (
          await getDatabase().query(
            `SELECT s.id AS survey_id,s.title AS survey_title,s.definition,m.advisor_id,m.display_name,m.email,m.active,r.revision,r.responses,r.submitted_at,
          (SELECT max(a.created_at) FROM club_forms.custom_survey_activity a WHERE a.survey_id=m.survey_id AND a.advisor_id=m.advisor_id AND a.action='respondent_removed') AS archived_at
          FROM club_forms.custom_survey_members m JOIN club_forms.custom_survey_responses r USING(survey_id,advisor_id) JOIN club_forms.custom_surveys s ON s.id=m.survey_id
          WHERE NOT m.active AND jsonb_array_length(r.responses)>0 ORDER BY archived_at DESC NULLS LAST,r.submitted_at DESC,s.id,m.advisor_id LIMIT 21 OFFSET $1`,
            [offset],
          )
        ).rows;
        return send(res, 200, {
          responses: rows
            .slice(0, 20)
            .map((r) => ({ ...r, definition: r.definition || definition })),
          hasMore: rows.length > 20,
          readOnly: true,
        });
      }
      if (action === 'draft' || action === 'draft-change') {
        const actor = await authorize(req),
          db = getDatabase();
        if (action === 'draft' && req.method === 'GET')
          return send(res, 200, {
            survey: await getDraft(db, url.searchParams.get('id')),
          });
        if (action === 'draft-change' && req.method === 'POST')
          return send(
            res,
            200,
            await changeDraft(db, actor, await jsonBody(req, 100000)),
          );
        throw new RequestError(405, 'Method not allowed.');
      }
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
              `SELECT s.id,s.title,s.status,s.expires_at,s.content_version,s.link_digest,s.definition,count(r.advisor_id)::int AS response_count FROM club_forms.custom_surveys s LEFT JOIN club_forms.custom_survey_responses r ON r.survey_id=s.id GROUP BY s.id ORDER BY s.created_at DESC`,
            )
          ).rows;
          return send(res, 200, {
            surveys: surveys.map(({ link_digest, ...s }) => ({
              ...s,
              previewLink: s.definition ? builderLinks(s).previewLink : null,
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
            'SELECT id,title,status,content_version,definition FROM club_forms.custom_surveys WHERE id=$1',
            [id],
          )
        ).rows[0];
        if (!survey) throw new RequestError(404, 'Survey not found.');
        return send(res, 200, {
          survey,
          resultsDefinition: survey.definition || definition,
          results: await currentResponses(db, id),
          readOnly: true,
        });
      }
      const db = getDatabase();
      await rateLimit(db, req);
      const link = req.headers['x-survey-link'],
        previewOnly = req.headers['x-survey-preview'] === '1',
        survey = previewOnly
          ? await linkedPreview(db, link)
          : await linkedSurvey(db, link);
      if (
        previewOnly &&
        !['welcome', 'preview', 'auth', 'verify-device', 'signout'].includes(
          action,
        )
      )
        throw new RequestError(
          403,
          'Preview links cannot be used to answer or read results.',
        );
      if (action === 'welcome' && req.method === 'GET')
        return send(res, 200, {
          title: survey.title,
          expiresAt: survey.expires_at,
          ...(survey.definition
            ? {
                kind: 'custom',
                intro: survey.definition.intro,
                audience: survey.definition.audience,
                permissions: survey.definition.permissions,
              }
            : {}),
        });
      if (action === 'preview' && req.method === 'GET') {
        if (survey.definition?.permissions.preview === 'respondents')
          await requireDevice(db, req, survey);
        return send(res, 200, {
          definition: survey.definition || definition,
          expiresAt: survey.expires_at,
          readOnly: true,
        });
      }
      if (action === 'auth') {
        const path = url.searchParams.get('path');
        if (
          req.method !== 'POST' ||
          !['email-otp/send-verification-otp', 'sign-in/email-otp'].includes(
            path,
          )
        )
          throw new RequestError(404, 'Sign-in action unavailable.');
        req.url = '/api/auth/' + path;
        return await authProxy(req, res, {
          approvedEmail: async (email) => {
            const member = (
              await db.query(
                'SELECT active FROM club_forms.custom_survey_members WHERE survey_id=$1 AND email=$2',
                [survey.id, email],
              )
            ).rows[0];
            return member
              ? member.active
              : survey.definition?.permissions.answer === 'verified';
          },
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
            ...(survey.definition || definition),
            respondents: members
              .filter(
                (m) => !survey.definition || m.advisor_id === member.advisor_id,
              )
              .map((m) => ({
                id: m.advisor_id,
                name: m.display_name,
              })),
          },
          results: survey.definition
            ? survey.definition.permissions.results === 'respondents'
              ? (await currentResponses(db, survey.id)).filter((r) => r.active)
              : (
                  await currentResponses(db, survey.id, member.advisor_id)
                ).filter((r) => r.advisor_id === member.advisor_id)
            : await currentResponses(db, survey.id, member.advisor_id),
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
