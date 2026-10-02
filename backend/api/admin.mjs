import { Readable } from 'node:stream';
import { get } from '@vercel/blob';
import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin } from '../lib/auth.mjs';
import { send, fail, jsonBody } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { kinds, uuid } from '../lib/validation.mjs';
import { liveEvents } from '../lib/events.mjs';
import { upcomingEvents, inboxFilter } from '../lib/inbox.mjs';
import { submissionsCSV } from '../lib/submission-export.mjs';
import {
  submissionActivity,
  addSubmissionComment,
} from '../lib/submission-activity.mjs';
export { csvCell } from '../lib/submission-export.mjs';
export function adminHandler({
  authorize = requireAdmin,
  getDatabase = database,
  getEvents = liveEvents,
  storage = { get },
} = {}) {
  return async function handler(req, res) {
    try {
      const user = await authorize(req);
      const db = getDatabase();
      const url = new URL(req.url, 'https://admin.invalid');
      if (req.method === 'GET') {
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
          const blob = await storage.get(file.pathname, { access: 'private' });
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
          await new Promise((resolve, reject) => {
            const stream = Readable.fromWeb(blob.stream);
            stream.on('error', reject);
            res.on('finish', resolve);
            stream.pipe(res);
          });
          return;
        }
        const events = upcomingEvents(await getEvents(db));
        const { values: filters, where } = inboxFilter(
          url.searchParams,
          events,
        );
        const offset = Math.max(
          0,
          Math.min(100000, Number(url.searchParams.get('offset')) || 0),
        );
        if (url.searchParams.get('export') === 'csv') {
          const rows = (
            await db.query(
              `SELECT id,kind,email,name,state,review_status,created_at,data FROM club_forms.entries e ${where} ORDER BY created_at DESC LIMIT 10000`,
              filters,
            )
          ).rows;
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
            `SELECT kind,count(*)::int AS total,count(*) FILTER (WHERE review_status='new')::int AS new,max(created_at) AS latest FROM club_forms.entries WHERE kind<>'rsvp' OR data->>'eventId'=ANY($1::text[]) GROUP BY kind`,
            [events.map((e) => e.id)],
          )
        ).rows;
        return send(res, 200, {
          user: user.email,
          entries: result.rows.slice(0, 50),
          hasMore: result.rows.length > 50,
          counts,
          events: events.map(({ id, title, date }) => ({ id, title, date })),
          notifications: { email: false },
          configured: {
            uploads: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
          },
        });
      }
      if (req.method !== 'POST')
        throw new RequestError(405, 'Method not allowed.');
      adminOrigin(req);
      const body = await jsonBody(req, 32768);
      if (body.action === 'comment') {
        const comment = await addSubmissionComment(db, body, user.email);
        return send(res, 200, { comment });
      }
      if (
        body.action !== 'review' ||
        !uuid.test(body.id || '') ||
        !['new', 'reviewed', 'closed'].includes(body.status)
      )
        throw new RequestError(400, 'Invalid update.');
      await db.transaction(async (tx) => {
        const result = await tx.query(
          'UPDATE club_forms.entries SET review_status=$2 WHERE id=$1 RETURNING id',
          [body.id, body.status],
        );
        if (!result.rows.length)
          throw new RequestError(404, 'Submission not found.');
        await tx.query(
          'INSERT INTO club_forms.audit(actor,entry_id,action) VALUES($1,$2,$3)',
          [user.email, body.id, 'review:' + body.status],
        );
      });
      send(res, 200, { saved: true });
    } catch (error) {
      if (!res.headersSent) fail(res, error);
      else res.destroy();
    }
  };
}
export default adminHandler();
