import { pipeline } from 'node:stream/promises';
import { get, del } from '@vercel/blob';
import { database } from '../lib/db.mjs';
import { requireAdmin, adminOrigin } from '../lib/auth.mjs';
import { send, fail, jsonBody } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { uuid } from '../lib/validation.mjs';
import { liveEvents } from '../lib/events.mjs';
import {
  upcomingEvents,
  recentEndedEvents,
  inboxFilter,
  inboxPage,
  summarize,
  reviewMany,
  reviewKinds,
  changeState,
  validTime,
} from '../lib/inbox.mjs';
import { submissionsCSV, exportFilename } from '../lib/submission-export.mjs';
import { homeSummary } from '../lib/home.mjs';
import {
  inboxSource,
  inboxCountsQuery as countsQuery,
} from '../lib/inbox-surveys.mjs';
import { centralTime } from '../lib/event-content.mjs';
import {
  helpEntries,
  helpHistory,
  saveHelpEntry,
  changeHelpEntry,
} from '../lib/help.mjs';
import { changeSubmission } from '../lib/submission-management.mjs';
import {
  cleanupContactFiles,
  contactRef,
  submissionContact,
} from '../lib/contacts.mjs';
import {
  submissionActivity,
  addSubmissionComment,
  insertSubmissionComment,
  staleStatus,
} from '../lib/submission-activity.mjs';
export { csvCell } from '../lib/submission-export.mjs';
// Per-kind counts; RSVPs for events that are no longer upcoming count as
// rsvp-past.
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
      const inboxEvents = async () => {
        const published = await getEvents(db);
        const saved = (
          await db.query(
            'SELECT id,draft,published,archived_at FROM club_forms.events',
          )
        ).rows.map((row) => {
          const event = row.published || row.draft;
          return {
            ...event,
            id: row.id,
            archived_at: row.archived_at,
            live: Boolean(row.published) && !row.archived_at,
            ...(event.startTime && event.date
              ? { date: centralTime(event.date, event.startTime) }
              : {}),
            ...(event.endTime && event.date
              ? { end: centralTime(event.endDate || event.date, event.endTime) }
              : {}),
          };
        });
        return [
          ...new Map(
            [...saved, ...published].map((event) => [event.id, event]),
          ).values(),
        ];
      };
      if (req.method === 'GET') {
        if (url.searchParams.has('edit')) {
          const id = url.searchParams.get('edit');
          if (!uuid.test(id || ''))
            throw new RequestError(400, 'Choose a submission.');
          const row = (
            await db.query(
              `SELECT e.*,(SELECT row_to_json(s) FROM club_forms.survey_responses s WHERE s.entry_id=e.id) AS survey,
              (SELECT COALESCE(json_agg(json_build_object('id',a.id,'name',a.name,'size',a.size)),'[]') FROM club_forms.attachments a WHERE a.entry_id=e.id) AS attachments,
              (SELECT json_build_object('starred',m.starred,'archived_at',m.archived_at,'updated_by',m.updated_by,'updated_at',m.updated_at) FROM club_forms.survey_response_state m WHERE m.entry_id=e.id) AS survey_state
              FROM club_forms.entries e WHERE e.id=$1`,
              [id],
            )
          ).rows[0];
          if (!row) throw new RequestError(404, 'Submission not found.');
          const { attachments, survey_state, ...entry } = row;
          return send(res, 200, {
            entry,
            attachments,
            survey_state,
            contact: await submissionContact(db, entry),
          });
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
        // The background poll: counts and arrivals only, no rows. An arrival
        // is a submission created after `since`, so status changes (an
        // officer's own Mark new) never count as one.
        if (url.searchParams.get('counts') === '1') {
          // A strict ISO time: Date.parse alone accepts '0' or a year like
          // +275760, which Postgres then refuses.
          const since = url.searchParams.get('since') || null;
          if (since && !validTime(since))
            throw new RequestError(400, 'Invalid filter.');
          const events = await inboxEvents();
          const { values: filters, where } = inboxFilter(
            url.searchParams,
            events,
          );
          const counts = (
            await db.query(countsQuery, [
              upcomingEvents(events).map((event) => event.id),
              recentEndedEvents(events).map((event) => event.id),
            ])
          ).rows;
          const { asOf, arrived } = (
            await db.query(
              // `since` comes back from JSON in milliseconds; created_at has
              // microseconds, so compare at the same precision.
              `${inboxSource} SELECT now() AS "asOf",count(*) FILTER (WHERE review_status<>'closed' AND date_trunc('milliseconds',created_at)>$1::timestamptz)::int AS arrived FROM inbox_rows`,
              [since],
            )
          ).rows[0];
          const { arrivedInView, newInView } = (
            await db.query(
              `${inboxSource} SELECT count(*) FILTER (WHERE date_trunc('milliseconds',e.created_at)>$${filters.length + 1}::timestamptz)::int AS "arrivedInView",count(*) FILTER (WHERE review_status<>'closed' AND created_at>=now()-interval '14 days')::int AS "newInView" FROM inbox_rows e ${where}`,
              [...filters, since],
            )
          ).rows[0];
          return send(res, 200, {
            user: user.email,
            counts,
            latest: counts.reduce(
              (max, row) => (!max || row.latest > max ? row.latest : max),
              null,
            ),
            arrived,
            arrivedInView,
            newInView,
            asOf,
            configured: {
              uploads: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
            },
          });
        }
        // Home: one read-only summary, with the same counts as the poll.
        if (url.searchParams.get('home') === '1') {
          const published = await inboxEvents(),
            upcoming = upcomingEvents(
              published.filter(
                (event) => !event.archived_at && event.live !== false,
              ),
            );
          const counts = (
            await db.query(countsQuery, [
              upcoming.map((event) => event.id),
              recentEndedEvents(published).map((event) => event.id),
            ])
          ).rows;
          return send(res, 200, {
            user: user.email,
            counts,
            ...(await homeSummary(db, published, upcoming)),
            configured: {
              uploads: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
            },
          });
        }
        if (url.searchParams.has('helpHistory'))
          return send(
            res,
            200,
            await helpHistory(
              db,
              url.searchParams.get('helpHistory'),
              url.searchParams.get('before'),
            ),
          );
        if (url.searchParams.get('help') === '1')
          return send(res, 200, {
            user: user.email,
            ...(await helpEntries(db)),
          });
        const savedEvents = (
          await db.query(
            `SELECT DISTINCT ON (data->>'eventId') data->>'eventId' AS id,data->>'eventTitle' AS title,data->>'eventDate' AS date,(data->>'potential')='true' AS potential FROM club_forms.entries WHERE kind='rsvp' ORDER BY data->>'eventId',created_at DESC,id`,
          )
        ).rows;
        const publishedEvents = await inboxEvents();
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
          publishedEvents,
          { search: true },
        );
        // $7 is the offset; the cursor uses $8 and $9.
        const page = inboxPage(
          url.searchParams,
          filters.length + 2,
          'inbox_rows',
        );
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
          throw new RequestError(400, 'Choose a valid inbox page.');
        if (url.searchParams.get('export') === 'csv') {
          const rows = (
            await db.query(
              `${inboxSource} SELECT id,kind,email,name,state,review_status,created_at,data FROM inbox_rows e ${where} ORDER BY ${page.order} LIMIT 10001`,
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
            `attachment; filename="${exportFilename({
              status: filters[1],
              kind: filters[0],
              eventId: filters[3],
              search: filters[6],
            })}"`,
          );
          res.end(submissionsCSV(rows));
          return;
        }
        // One statement, so total, asOf and the page share one snapshot. total
        // counts the whole filtered set, whatever the cursor; asOf is the
        // statement's now(). A submission whose transaction began before asOf
        // but commits after this read is not shown, yet is not newer than asOf
        // either; inserts commit within milliseconds, so that gap is accepted.
        // The page is chosen first, so the per-row extras run for 51 rows; an
        // empty page still returns one row, with a null id, for the totals.
        const result = await db.query(
          `${inboxSource} SELECT list.total AS list_total,list."newInView" AS list_new,list."asOf" AS list_as_of,e.*,
        (SELECT COALESCE(json_agg(json_build_object('id',a.id,'name',a.name,'size',a.size)),'[]') FROM club_forms.attachments a WHERE a.entry_id=e.id) AS attachments,
        (SELECT count(*)::int FROM club_forms.entry_comments c WHERE c.entry_id=e.id) AS comment_count,
        (SELECT json_build_object('action',a.action,'actor',a.actor,'at',a.created_at) FROM club_forms.audit a WHERE a.entry_id=e.id AND a.action LIKE 'review:%' ORDER BY a.id DESC LIMIT 1) AS last_review,
        link.contact_email,
        (SELECT count(*)::int FROM club_forms.contact_emails a JOIN club_forms.entries o ON o.email=a.email WHERE a.contact_email=link.contact_email AND o.id<>e.id) AS contact_others,
        (SELECT count(*)::int FROM club_forms.contact_emails a JOIN club_forms.contact_notes n ON n.email=a.email WHERE a.contact_email=link.contact_email) AS contact_notes,
        person.deleted_at AS contact_deleted_at
        FROM (SELECT count(*)::int AS total,count(*) FILTER (WHERE review_status<>'closed' AND created_at>=now()-interval '14 days')::int AS "newInView",now() AS "asOf" FROM inbox_rows e ${where}) list
        LEFT JOIN (SELECT e.*,to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM inbox_rows e ${where}${page.where} ORDER BY ${page.order} LIMIT 51 OFFSET $${filters.length + 1}) e ON true
        LEFT JOIN club_forms.contact_emails link ON link.email=e.email
        LEFT JOIN club_forms.contacts person ON person.email=link.contact_email
        ORDER BY ${page.order}`,
          [...filters, offset, ...page.values],
        );
        const {
          list_total: total,
          list_new: newInView,
          list_as_of: asOf,
        } = result.rows[0];
        const rows = result.rows.filter((row) => row.id !== null);
        const summary = url.searchParams.get('summary') === '1';
        const entries = rows
          .slice(0, 50)
          .map(
            ({
              list_total,
              list_new,
              list_as_of,
              cursor_at,
              contact_email,
              contact_others,
              contact_notes,
              contact_deleted_at,
              ...entry
            }) => ({
              ...entry,
              ...(summary ? { data: summarize(entry.data) } : {}),
              contact: {
                ref: contactRef(contact_email),
                other_submissions: contact_others,
                notes: contact_notes,
                deleted_at: contact_deleted_at,
              },
            }),
          );
        const last = rows[49];
        const counts = (
          await db.query(countsQuery, [
            upcomingIds,
            recentEndedEvents(publishedEvents).map((event) => event.id),
          ])
        ).rows;
        // Each event group's true size under these filters, not just the page.
        const eventCounts = Object.fromEntries(
          (
            await db.query(
              `${inboxSource} SELECT e.data->>'eventId' AS id,count(*)::int AS n FROM inbox_rows e ${where} AND e.kind='rsvp' GROUP BY 1`,
              filters,
            )
          ).rows.map((row) => [row.id, row.n]),
        );
        return send(res, 200, {
          user: user.email,
          entries,
          hasMore: rows.length > 50,
          // Send back as `before` for the next page: it carries the exact
          // microsecond time, which a JSON created_at does not.
          nextBefore: rows.length > 50 ? `${last.cursor_at}|${last.id}` : null,
          total,
          newInView,
          asOf,
          counts,
          eventCounts,
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
      if (body.action === 'help-save')
        return send(res, 200, await saveHelpEntry(db, body, user.email));
      if (['help-archive', 'help-restore', 'help-delete'].includes(body.action))
        return send(res, 200, await changeHelpEntry(db, body, user.email));
      if (body.action === 'comment') {
        const comment = await addSubmissionComment(db, body, user.email);
        return send(res, 200, { comment });
      }
      if (body.action === 'review' && body.items !== undefined)
        return send(res, 200, await reviewMany(db, body, user.email));
      if (body.action === 'review-kinds')
        return send(res, 200, await reviewKinds(db, body, user.email));
      if (body.action === 'state')
        return send(res, 200, await changeState(db, body, user.email));
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
