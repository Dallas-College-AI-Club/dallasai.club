import { Readable } from 'node:stream';
import { get } from '@vercel/blob';
import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin } from '../lib/auth.mjs';
import { send, fail, jsonBody } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { kinds, uuid } from '../lib/validation.mjs';
import { drainOutbox } from '../lib/mail.mjs';
export function csvCell(value) {
  const text = String(value ?? '');
  return (
    '"' +
    (/^[\s]*[=+\-@\t\r]/.test(text) ? "'" : '') +
    text.replaceAll('"', '""') +
    '"'
  );
}
export default async function handler(req, res) {
  try {
    const user = await requireAdmin(req);
    const db = database();
    const url = new URL(req.url, 'https://admin.invalid');
    if (req.method === 'GET') {
      if (url.searchParams.has('attachment')) {
        const id = url.searchParams.get('attachment');
        if (!uuid.test(id)) throw new RequestError(400, 'Invalid attachment.');
        const file = (
          await db.query('SELECT * FROM club_forms.attachments WHERE id=$1', [
            id,
          ])
        ).rows[0];
        if (!file) throw new RequestError(404, 'Attachment not found.');
        const blob = await get(file.pathname, { access: 'private' });
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
      const kind = url.searchParams.get('kind') || '';
      const status = url.searchParams.get('status') || '';
      const search = (url.searchParams.get('search') || '').slice(0, 200);
      const offset = Math.max(
        0,
        Math.min(100000, Number(url.searchParams.get('offset')) || 0),
      );
      if (
        (kind && !kinds.includes(kind)) ||
        (status && !['new', 'reviewed', 'closed'].includes(status))
      )
        throw new RequestError(400, 'Invalid filter.');
      const filters = [kind, status, search];
      const requestedId = url.searchParams.get('id') || '';
      if (requestedId && !uuid.test(requestedId))
        throw new RequestError(400, 'Invalid submission link.');
      filters.push(requestedId);
      const where = `WHERE ($1='' OR e.kind=$1) AND ($2='' OR e.review_status=$2) AND ($3='' OR e.email ILIKE '%'||$3||'%' OR e.name ILIKE '%'||$3||'%') AND ($4='' OR e.id::text=$4)`;
      if (url.searchParams.get('export') === 'csv') {
        const rows = (
          await db.query(
            `SELECT kind,email,name,state,review_status,created_at,data FROM club_forms.entries e ${where} ORDER BY created_at DESC LIMIT 10000`,
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
        res.end(
          [
            'Type,Email,Name,State,Review status,Received,Details',
            ...rows.map((row) =>
              [
                row.kind,
                row.email,
                row.name,
                row.state,
                row.review_status,
                new Date(row.created_at).toISOString(),
                JSON.stringify(row.data),
              ]
                .map(csvCell)
                .join(','),
            ),
          ].join('\r\n'),
        );
        return;
      }
      const result = await db.query(
        `SELECT e.*,
        (SELECT COALESCE(json_agg(json_build_object('id',a.id,'name',a.name,'size',a.size)),'[]') FROM club_forms.attachments a WHERE a.entry_id=e.id) AS attachments,
        (SELECT count(*)::int FROM club_forms.outbox o WHERE o.entry_id=e.id AND o.sent_at IS NULL) AS pending_emails
        FROM club_forms.entries e ${where} ORDER BY e.created_at DESC,e.id LIMIT 51 OFFSET $5`,
        [...filters, offset],
      );
      const counts = (
        await db.query(
          `SELECT kind,count(*)::int AS total,count(*) FILTER (WHERE review_status='new')::int AS new FROM club_forms.entries GROUP BY kind`,
        )
      ).rows;
      const queue = (
        await db.query(
          `SELECT count(*) FILTER(WHERE sent_at IS NULL)::int AS pending,count(*) FILTER(WHERE sent_at IS NULL AND last_error IS NOT NULL)::int AS failed FROM club_forms.outbox`,
        )
      ).rows[0];
      return send(res, 200, {
        user: user.email,
        entries: result.rows.slice(0, 50),
        hasMore: result.rows.length > 50,
        counts,
        queue,
        configured: {
          email: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
          notifications: Boolean(process.env.NOTIFICATION_EMAILS),
          newsletter: Boolean(
            process.env.RESEND_SEGMENT_ID && process.env.RESEND_WEBHOOK_SECRET,
          ),
          uploads: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
        },
      });
    }
    if (req.method !== 'POST')
      throw new RequestError(405, 'Method not allowed.');
    adminOrigin(req);
    const body = await jsonBody(req, 2048);
    if (body.action === 'retry') {
      await db.query(
        'UPDATE club_forms.outbox SET available_at=now(),attempts=0 WHERE sent_at IS NULL AND (locked_until IS NULL OR locked_until<now())',
      );
      await db.query(
        "INSERT INTO club_forms.audit(actor,action) VALUES($1,'retry-notifications')",
        [user.email],
      );
      return send(res, 200, await drainOutbox(db));
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
}
