import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin, sameOriginRead } from '../lib/auth.mjs';
import { send, fail, jsonBody } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { changeSubmission } from '../lib/submission-management.mjs';
import { cleanupContactFiles } from '../lib/contacts.mjs';
import { surveyResults } from '../lib/surveys.mjs';
import {
  manageResponse,
  rsvpSurveyCatalog,
  changeRsvpSurvey,
} from '../lib/survey-management.mjs';
import { originalEvents } from '../lib/events.mjs';
import {
  reportRows,
  summarizeResponses,
  responsesCSV,
} from '../lib/survey-report.mjs';
import {
  contactList,
  contactHistory,
  addContactNote,
  manageContact,
} from '../lib/contacts.mjs';
export function surveysHandler({
  authorize = requireAdmin,
  getDatabase = database,
  storage,
  getOriginalEvents = originalEvents,
} = {}) {
  return async function handler(req, res) {
    try {
      const user = await authorize(req);
      if (req.method === 'POST') {
        adminOrigin(req);
        const body = await jsonBody(req, 400000),
          db = getDatabase();
        if (body.action?.startsWith('rsvp-survey-'))
          return send(
            res,
            200,
            await changeRsvpSurvey(
              db,
              body,
              user.email,
              await getOriginalEvents(),
            ),
          );
        if (['edit-submission', 'delete-submission'].includes(body.action)) {
          const result = await changeSubmission(db, body, user.email, {
            surface: 'survey',
          });
          if (result.deleted)
            result.filesCleaned = await cleanupContactFiles(db, storage);
          return send(res, 200, result);
        }
        const result =
          body.action === 'contact-note'
            ? await addContactNote(db, body, user.email)
            : body.action?.startsWith('contact-')
              ? await manageContact(db, body, user.email, storage)
              : await manageResponse(db, body, user.email);
        return send(res, 200, result);
      }
      if (req.method !== 'GET')
        throw new RequestError(405, 'Method not allowed.');
      const params = new URL(req.url, 'https://admin.invalid').searchParams;
      const db = getDatabase(),
        offset = Number(params.get('offset') || 0);
      if (params.get('catalog') === '1')
        return send(res, 200, {
          surveys: await rsvpSurveyCatalog(db, await getOriginalEvents()),
        });
      if (params.has('contact'))
        return send(
          res,
          200,
          await contactHistory(db, {
            email: params.get('contact'),
            offset,
          }),
        );
      if (params.has('contacts'))
        return send(
          res,
          200,
          await contactList(db, {
            search: params.get('search') || '',
            view: params.get('view') || 'active',
            offset,
          }),
        );
      if (
        params.has('starred') &&
        !['true', 'false'].includes(params.get('starred'))
      )
        throw new RequestError(400, 'Invalid bookmark filter.');
      const filter = {
        eventId: params.get('eventId') || '',
        entryId: params.get('entryId') || '',
        search: params.get('search') || '',
        view: params.get('view') || 'active',
        starred: params.get('starred') === 'true',
        attendance: params.get('attendance') || 'all',
        feedback: params.get('feedback') || 'all',
        type: params.get('type') || 'rsvp',
        surveyId: params.get('surveyId') || '',
        offset,
      };
      if (params.has('summary') || params.has('export')) {
        if (params.has('export') && filter.type !== 'rsvp') sameOriginRead(req);
        const rows = await reportRows(db, filter);
        const csv = params.has('export') ? responsesCSV(rows) : null;
        if (csv && filter.type !== 'rsvp' && Buffer.byteLength(csv) > 4000000)
          throw new RequestError(
            413,
            'These responses make a CSV larger than 4 MB. Narrow the event or response filters first.',
          );
        // Like the Inbox export, record who read the full response set.
        await db.query(
          'INSERT INTO club_forms.audit(actor,action) VALUES($1,$2)',
          [
            user.email,
            `${params.has('export') ? 'survey-export-csv' : 'survey-summary'}:${filter.eventId || 'all'}`,
          ],
        );
        if (params.has('export')) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${filter.eventId || 'event-surveys'}-responses.csv"`,
          );
          res.setHeader('Cache-Control', 'private, no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          return res.end(csv);
        }
        return send(res, 200, summarizeResponses(rows));
      }
      send(res, 200, await surveyResults(db, filter));
    } catch (error) {
      fail(res, error);
    }
  };
}
export default surveysHandler();
