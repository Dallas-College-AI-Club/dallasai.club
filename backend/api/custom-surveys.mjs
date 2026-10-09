import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin, sameOriginRead } from '../lib/auth.mjs';
import { neonSession, proxyNeonAuth } from '../lib/neon-auth.mjs';
import { expiredAdminCookies } from '../lib/admin-session.mjs';
import { send, fail, jsonBody, limit } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { definition } from '../lib/survey-contract.mjs';
import {
  getDraft,
  changeDraft,
  changeSurveyLifecycle,
} from '../lib/survey-builder.mjs';
import { surveyCatalog } from '../lib/survey-catalog.mjs';
import {
  changeSurveyShareLink,
  generateSurveyShareLink,
} from '../lib/survey-share-link.mjs';
import {
  surveyResultPage,
  surveyExportRows,
  surveyResultsCSV,
  surveyExportFilename,
} from '../lib/survey-results.mjs';
import {
  respondentList,
  changeRespondent,
  surveyId,
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
} from '../lib/custom-surveys.mjs';
export const config = { api: { bodyParser: false } };
export function customSurveysHandler({
  getDatabase = database,
  authorize = requireAdmin,
  getSession = neonSession,
  authProxy = proxyNeonAuth,
  generateShareLink = generateSurveyShareLink,
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
      if (action === 'sample') {
        await authorize(req);
        if (req.method !== 'GET')
          throw new RequestError(405, 'Sample previews are read-only.');
        return send(res, 200, {
          definition: {
            ...definition,
            respondents: [
              { id: 'sample-jordan', name: 'Jordan Morgan' },
              { id: 'sample-alex', name: 'Alex Rivera' },
            ],
          },
        });
      }
      if (action === 'lifecycle') {
        const actor = await authorize(req);
        if (req.method !== 'POST') throw new RequestError(405, 'Use POST.');
        return send(
          res,
          200,
          await changeSurveyLifecycle(
            getDatabase(),
            actor,
            await jsonBody(req, 20000),
          ),
        );
      }
      if (action === 'archived-responses') {
        await authorize(req);
        if (req.method !== 'GET')
          throw new RequestError(405, 'Archived responses are read-only.');
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
          throw new RequestError(400, 'Choose a valid archive page.');
        const rows = (
          await getDatabase().query(
            `SELECT s.id AS survey_id,s.title AS survey_title,s.definition,m.advisor_id,m.display_name,m.email,m.active,r.revision,r.responses,r.submitted_at,coalesce(r.response_definition,s.definition) AS response_definition,
          (SELECT max(a.created_at) FROM club_forms.custom_survey_activity a WHERE a.survey_id=m.survey_id AND a.advisor_id=m.advisor_id AND a.action='respondent_removed') AS archived_at
          FROM club_forms.custom_survey_members m JOIN club_forms.custom_survey_responses r USING(survey_id,advisor_id) JOIN club_forms.custom_surveys s ON s.id=m.survey_id
          WHERE (NOT m.active OR s.status='archived') AND (jsonb_array_length(r.responses)>0 OR coalesce(r.response_definition,s.definition) IS NOT NULL) ORDER BY archived_at DESC NULLS LAST,r.submitted_at DESC,s.id,m.advisor_id LIMIT 11 OFFSET $1`,
            [offset],
          )
        ).rows;
        return send(res, 200, {
          responses: rows
            .slice(0, 10)
            .map((r) => ({ ...r, definition: r.definition || definition })),
          hasMore: rows.length > 10,
          pageSize: 10,
          readOnly: true,
        });
      }
      if (action === 'share-link' || action === 'generate-share-link') {
        const actor = await authorize(req);
        if (req.method !== 'POST') throw new RequestError(405, 'Use POST.');
        return send(
          res,
          200,
          await (
            action === 'share-link' ? changeSurveyShareLink : generateShareLink
          )(getDatabase(), actor, await jsonBody(req, 20000)),
        );
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
      // The PDF of one response is made in the browser from the results it
      // already shows. Like the CSV export, it records who downloaded it:
      // the survey and the respondent's id, never an email address.
      if (action === 'response-pdf') {
        const actor = await authorize(req);
        if (req.method !== 'POST') throw new RequestError(405, 'Use POST.');
        const body = await jsonBody(req, 1000),
          id = surveyId(body.id),
          db = getDatabase();
        if (
          typeof body.advisorId !== 'string' ||
          !body.advisorId ||
          body.advisorId.length > 100
        )
          throw new RequestError(400, 'Choose a response.');
        const found = await db.query(
          'SELECT 1 FROM club_forms.custom_survey_responses WHERE survey_id=$1 AND advisor_id=$2',
          [id, body.advisorId],
        );
        if (!found.rows.length)
          throw new RequestError(404, 'Response not found.');
        await db.query(
          'INSERT INTO club_forms.audit(actor,action) VALUES($1,$2)',
          [actor.email, `custom-survey-pdf:${id}:${body.advisorId}`],
        );
        return send(res, 200, { recorded: true });
      }
      if (action === 'catalog' || action === 'results' || action === 'export') {
        const actor = await authorize(req);
        if (req.method !== 'GET')
          throw new RequestError(405, 'Survey results are read-only.');
        if (action === 'export') sameOriginRead(req);
        const db = getDatabase();
        if (action === 'catalog') {
          return send(res, 200, {
            surveys: await surveyCatalog(db),
          });
        }
        const id = surveyId(url.searchParams.get('id'));
        const survey = (
          await db.query(
            'SELECT id,title,status,content_version,definition FROM club_forms.custom_surveys WHERE id=$1',
            [id],
          )
        ).rows[0];
        if (!survey) throw new RequestError(404, 'Survey not found.');
        const view = url.searchParams.get('view') || 'active';
        const search = (url.searchParams.get('search') || '').trim();
        if (
          !['active', 'archived', 'all'].includes(view) ||
          search.length > 200
        )
          throw new RequestError(400, 'Choose valid response filters.');
        if (action === 'export') {
          const csv = surveyResultsCSV(
            await surveyExportRows(db, id, { view, search }),
            survey.definition || definition,
          );
          // Vercel sends at most 4.5 MB; refuse rather than fail midway.
          if (Buffer.byteLength(csv) > 4000000)
            throw new RequestError(
              413,
              'These responses make a CSV larger than 4 MB, more than Club Office can send at once. Download responses one at a time as PDF instead.',
            );
          // Like the event survey export, record who read the full set.
          await db.query(
            'INSERT INTO club_forms.audit(actor,action) VALUES($1,$2)',
            [actor.email, 'custom-survey-export-csv:' + id],
          );
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${surveyExportFilename(survey.title)}"`,
          );
          res.setHeader('X-Content-Type-Options', 'nosniff');
          return res.end(csv);
        }
        return send(res, 200, {
          survey,
          resultsDefinition: survey.definition || definition,
          ...(await surveyResultPage(db, id, url.searchParams.get('offset'), {
            view,
            search,
          })),
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
      if (action === 'shared-results' && req.method === 'GET') {
        if (survey.definition?.permissions.results !== 'respondents')
          throw new RequestError(
            403,
            'This survey does not share respondent results.',
          );
        return send(
          res,
          200,
          await surveyResultPage(
            db,
            survey.id,
            url.searchParams.get('offset'),
            {
              activeOnly: true,
              exclude: member.advisor_id,
            },
          ),
        );
      }
      if (action === 'bootstrap' && req.method === 'GET') {
        const members = survey.definition
          ? [member]
          : await surveyMembers(db, survey.id);
        const shared =
          survey.definition?.permissions.results === 'respondents'
            ? await surveyResultPage(db, survey.id, '0', {
                activeOnly: true,
                exclude: member.advisor_id,
              })
            : { results: [], nextOffset: null };
        return send(res, 200, {
          mode: 'connected',
          survey: {
            id: survey.id,
            title: survey.title,
            expiresAt: survey.expires_at,
          },
          advisorId: member.advisor_id,
          nextOffset: shared.nextOffset,
          definition: {
            ...(survey.definition || definition),
            content_version: survey.content_version,
            respondents: members.map((m) => ({
              id: m.advisor_id,
              name: m.display_name,
            })),
          },
          results: survey.definition
            ? [
                ...(await currentResponses(db, survey.id, member.advisor_id, {
                  ownOnly: true,
                })),
                ...shared.results,
              ]
            : await currentResponses(db, survey.id, member.advisor_id),
        });
      }
      // 30 answers of 5,000 characters at up to 3 UTF-8 bytes each, plus JSON.
      if (action === 'submit' && req.method === 'POST')
        return send(res, 200, {
          receipt: await submitSurvey(
            db,
            req,
            link,
            await jsonBody(req, 500000),
          ),
        });
      throw new RequestError(404, 'Survey action unavailable.');
    } catch (error) {
      fail(res, error);
    }
  };
}
export default customSurveysHandler();
