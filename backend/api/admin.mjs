import { pipeline } from 'node:stream/promises';
import { get, del } from '@vercel/blob';
import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin } from '../lib/auth.mjs';
import { send, fail, jsonBody } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { uuid } from '../lib/validation.mjs';
import { liveEvents } from '../lib/events.mjs';
import { upcomingEvents, inboxFilter } from '../lib/inbox.mjs';
import { submissionsCSV } from '../lib/submission-export.mjs';
import { changeSubmission } from '../lib/submission-management.mjs';
import { cleanupContactFiles } from '../lib/contacts.mjs';
import {
  submissionActivity,
  addSubmissionComment,
  insertSubmissionComment,
  staleStatus,
} from '../lib/submission-activity.mjs';
export { csvCell } from '../lib/submission-export.mjs';
export function adminHandler({
  authorize = requireAdmin,
  getDatabase = database,
  getEvents = liveEvents,
  storage = { get, del },
} = {}) {
  return async function handler(req, res) {
    try {
      const user = await authorize(req);
      const db = getDatabase();
      const url = new URL(req.url, 'https://admin.invalid');
      if (req.method === 'GET') {
        if (url.searchParams.has('edit')) {
          const id = url.searchParams.get('edit');
          if (!uuid.test(id || ''))
            throw new RequestError(400, 'Choose a submission.');
          const entry = (
            await db.query(
              `SELECT e.*,(SELECT row_to_json(s) FROM club_forms.survey_responses s WHERE s.entry_id=e.id) AS survey FROM club_forms.entries e WHERE e.id=$1`,
              [id],
            )
          ).rows[0];
          if (!entry) throw new RequestError(404, 'Submission not found.');
          return send(res, 200, { entry });
        }
        if (url.searchParams.has('history'))
          return send(
            res,
            200,
            await submissionActivity(
              db,
              url.searchParams.get('history'),
              url.searchParams.get('before'),
            ),
          );
        if (url.searchParams.has('attachment')) {
          const id = url.searchParams.get('attachment');
          if (!uuid.test(id))
            throw new RequestError(400, 'Invalid attachment.');
          const file = (
            await db.query('SELECT * FROM club_forms.attachments WHERE id=$1', [
              id,
            ])
          ).rows[0];
          if (!file) throw new RequestError(404, 'Attachment not found.');
          const blob = await storage.get(file.pathname, {
            access: 'private',
          });
          if (!blob || blob.statusCode !== 200)
            throw new RequestError(404, 'Attachment unavailable.');
          await db.query(
            'INSERT INTO club_forms.audit(actor,entry_id,action) VALUES($1,$2,$3)',
            [user.email, file.entry_id, 'download-attachment'],
          );
          res.setHeader('Cache-Control', 'private, no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          );
          await pipeline(blob.stream, res);
          return;
        }
        const savedEvents = (
          await db.query(
            `SELECT DISTINCT ON (data->>'eventId') data->>'eventId' AS id,data->>'eventTitle' AS title,data->>'eventDate' AS date,(data->>'potential')='true' AS potential FROM club_forms.entries WHERE kind='rsvp' ORDER BY data->>'eventId',created_at DESC,id`,
          )
        ).rows;
        const publishedEvents = await getEvents(db);
        const allEvents = [
          ...new Map(
            [...savedEvents, ...publishedEvents].map((event) => [
              event.id,
              event,
            ]),
          ).values(),
        ];
        // Saved RSVP snapshots supply history, never current publication status.
        const events = upcomingEvents(publishedEvents);
        const upcomingIds = events.map((event) => event.id);
        const { values: filters, where } = inboxFilter(
          url.searchParams,
          events,
        );
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
          throw new RequestError(400, 'Choose a valid inbox page.');
        if (url.searchParams.get('export') === 'csv') {
          const rows = (
            await db.query(
              `SELECT id,kind,email,name,state,review_status,created_at,data FROM club_forms.entries e ${where} ORDER BY created_at DESC,id LIMIT 10001`,
              filters,
            )
          ).rows;
          if (rows.length > 10000)
            throw new RequestError(
              413,
              'More than 10,000 submissions match. Narrow the filters before exporting.',
            );
          await db.query(
            "INSERT INTO club_forms.audit(actor,action) VALUES($1,'export-csv')",
            [user.email],
          );
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader(
            'Content-Disposition',
            'attachment; filename="club-submissions.csv"',
          );
          res.end(submissionsCSV(rows));
          return;
        }
        const result = await db.query(
          `SELECT e.*,
        (SELECT COALESCE(json_agg(json_build_object('id',a.id,'name',a.name,'size',a.size)),'[]') FROM club_forms.attachments a WHERE a.entry_id=e.id) AS attachments
        FROM club_forms.entries e ${where} ORDER BY e.created_at DESC,e.id LIMIT 51 OFFSET $6`,
          [...filters, offset],
        );
        const counts = (
          await db.query(
            `SELECT CASE WHEN kind='rsvp' AND NOT(coalesce(data->>'eventId','')=ANY($1::text[])) THEN 'rsvp-past' ELSE kind END AS kind,count(*)::int AS total,count(*) FILTER (WHERE review_status='new')::int AS new,max(created_at) AS latest FROM club_forms.entries GROUP BY 1`,
            [upcomingIds],
          )
        ).rows;
        return send(res, 200, {
          user: user.email,
          entries: result.rows.slice(0, 50),
          hasMore: result.rows.length > 50,
          counts,
          events: allEvents.map(({ id, title, date }) => ({
            id,
            title,
            date,
            past: !upcomingIds.includes(id),
          })),
          notifications: { email: false },
          configured: {
            uploads: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
          },
        });
      }
      if (req.method !== 'POST')
        throw new RequestError(405, 'Method not allowed.');
      adminOrigin(req);
      const body = await jsonBody(req, 400000);
      if (['edit-submission', 'delete-submission'].includes(body.action)) {
        const result = await changeSubmission(db, body, user.email);
        if (result.deleted)
          result.filesCleaned = await cleanupContactFiles(db, storage);
        return send(res, 200, result);
      }
      if (body.action === 'comment') {
        const comment = await addSubmissionComment(db, body, user.email);
        return send(res, 200, { comment });
      }
      const statuses = ['new', 'reviewed', 'closed'];
      if (
        body.action !== 'review' ||
        !uuid.test(body.id || '') ||
        !statuses.includes(body.status) ||
        (body.from != null && !statuses.includes(body.from))
      )
        throw new RequestError(400, 'Invalid update.');
      // An optional note and the status change commit together or not at all.
      const comment = await db.transaction(async (tx) => {
        const saved =
          body.comment != null
            ? await insertSubmissionComment(
                tx,
                {
                  entryId: body.id,
                  id: body.comment.id,
                  body: body.comment.body,
                },
                user.email,
              )
            : undefined;
        // `from` is the status the officer saw; a different one means someone
        // else changed it first.
        const result = await tx.query(
          'UPDATE club_forms.entries SET review_status=$2 WHERE id=$1 AND ($3::text IS NULL OR review_status=$3) RETURNING id',
          [body.id, body.status, body.from ?? null],
        );
        if (!result.rows.length) await staleStatus(tx, body.id);
        await tx.query(
          'INSERT INTO club_forms.audit(actor,entry_id,action) VALUES($1,$2,$3)',
          [user.email, body.id, 'review:' + body.status],
        );
        return saved;
      });
      send(res, 200, comment ? { saved: true, comment } : { saved: true });
    } catch (error) {
      fail(res, error);
    }
  };
}
export default adminHandler();
