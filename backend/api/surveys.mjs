import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin } from '../lib/auth.mjs';
import { send, fail, jsonBody } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { surveyResults } from '../lib/surveys.mjs';
import { manageResponse } from '../lib/survey-management.mjs';
import {
  reportRows,
  summarizeResponses,
  responsesCSV,
} from '../lib/survey-report.mjs';
import {
  contactList,
  contactHistory,
  addContactNote,
} from '../lib/contacts.mjs';
export function surveysHandler({
  authorize = requireAdmin,
  getDatabase = database,
} = {}) {
  return async function handler(req, res) {
    try {
      const user = await authorize(req);
      if (req.method === 'POST') {
        adminOrigin(req);
        const body = await jsonBody(req, 10000),
          db = getDatabase();
        const result =
          body.action === 'contact-note'
            ? await addContactNote(db, body, user.email)
            : await manageResponse(db, body, user.email);
        return send(res, 200, result);
      }
      if (req.method !== 'GET')
        throw new RequestError(405, 'Method not allowed.');
      const params = new URL(req.url, 'https://admin.invalid').searchParams;
      const db = getDatabase(),
        offset = Number(params.get('offset') || 0);
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
        offset,
      };
      if (params.has('summary') || params.has('export')) {
        const rows = await reportRows(db, filter);
        if (params.has('export')) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${filter.eventId || 'event-surveys'}-responses.csv"`,
          );
          res.setHeader('Cache-Control', 'private, no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          return res.end(responsesCSV(rows));
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
