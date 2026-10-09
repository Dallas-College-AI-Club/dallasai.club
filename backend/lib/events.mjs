import { readFile } from 'node:fs/promises';
import { RequestError } from './errors.mjs';
import { normalizeEventType } from './event-types.mjs';
import {
  draftContent,
  publicContent,
  editableContent,
  eventIdPattern,
} from './event-content.mjs';
export async function originalEvents() {
  return JSON.parse(
    await readFile(
      new URL('../generated/events.json', import.meta.url),
      'utf8',
    ),
  );
}
export function mergeEvents(originals, rows) {
  const events = new Map(originals.map((event) => [event.id, event]));
  for (const row of rows) {
    if (row.published && !row.archived_at)
      events.set(row.id, {
        ...row.published,
        ...(row.rsvp_survey_status && row.rsvp_survey_status !== 'active'
          ? { registrationOpen: false }
          : {}),
      });
    else events.delete(row.id);
  }
  return [...events.values()]
    .map(normalizeEventType)
    .sort((a, b) => a.date.localeCompare(b.date));
}
export async function liveEvents(db, originals) {
  originals ??= await originalEvents();
  return mergeEvents(
    originals,
    (
      await db.query(
        'SELECT id,published,archived_at,rsvp_survey_status FROM club_forms.events',
      )
    ).rows,
  );
}
export async function editorEvents(db, originals) {
  originals ??= await originalEvents();
  const rows = new Map(
    originals.map((event) => [
      event.id,
      {
        id: event.id,
        draft: editableContent(event),
        published: event,
        revision: 0,
        published_revision: 0,
        updated_at: null,
        updated_by: '',
        archived_at: null,
      },
    ]),
  );
  for (const row of (await db.query('SELECT * FROM club_forms.events')).rows)
    rows.set(row.id, row);
  return [...rows.values()]
    .map((row) => ({
      ...row,
      draft: normalizeEventType({
        ...row.draft,
        ...(row.rsvp_survey_status && row.rsvp_survey_status !== 'active'
          ? { registrationOpen: false }
          : {}),
      }),
      published: normalizeEventType(
        row.published && {
          ...row.published,
          ...(row.rsvp_survey_status && row.rsvp_survey_status !== 'active'
            ? { registrationOpen: false }
            : {}),
        },
      ),
    }))
    .sort((a, b) => (b.draft.date || '').localeCompare(a.draft.date || ''));
}
export async function eventActivity(db, id, before = null) {
  if (
    !eventIdPattern.test(id || '') ||
    (before !== null &&
      (!/^[1-9]\d{0,9}$/.test(before) || Number(before) > 2147483647))
  )
    throw new RequestError(400, 'Reload the event activity and try again.');
  const rows = (
    await db.query(
      `SELECT revision,action,actor,created_at FROM club_forms.event_history
     WHERE event_id=$1 AND ($2::integer IS NULL OR revision<$2)
     ORDER BY revision DESC LIMIT 51`,
      [id, before === null ? null : Number(before)],
    )
  ).rows;
  const activity = rows.slice(0, 50);
  return {
    activity,
    nextBefore: rows.length > 50 ? activity.at(-1).revision : null,
  };
}
export async function saveEvent(db, body, actor, originals) {
  if (
    !['draft', 'publish', 'unpublish', 'archive', 'restore'].includes(
      body.action,
    ) ||
    !eventIdPattern.test(body.id || '') ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    throw new RequestError(400, 'Reload the event and try again.');
  const draft = ['unpublish', 'archive', 'restore'].includes(body.action)
    ? null
    : draftContent(normalizeEventType(body.event), body.action === 'publish');
  const published =
    body.action === 'publish' ? publicContent(body.id, draft) : null;
  originals ??= await originalEvents();
  const original = originals.find((event) => event.id === body.id);
  return db.transaction(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('event-rsvp:' || $1,0))",
      [body.id],
    );
    if (
      body.revision === 0 &&
      (original || ['draft', 'publish'].includes(body.action))
    ) {
      await tx.query(
        `INSERT INTO club_forms.events(id,draft,published,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
        [
          body.id,
          JSON.stringify(original ? editableContent(original) : draft),
          original ? JSON.stringify(original) : null,
          actor,
        ],
      );
    }
    const current = (
      await tx.query('SELECT * FROM club_forms.events WHERE id=$1 FOR UPDATE', [
        body.id,
      ])
    ).rows[0];
    if (!current) throw new RequestError(404, 'Event not found.');
    if (current.revision !== body.revision)
      throw new RequestError(
        409,
        'Another admin updated this event. Your edits are still here. Copy them, then reopen the event to review the latest version.',
      );
    if (current.rsvp_survey_status !== 'active' && draft?.registrationOpen)
      throw new RequestError(
        409,
        current.rsvp_survey_status === 'archived'
          ? 'Restore the RSVP survey before reopening registration.'
          : 'This RSVP survey was permanently deleted. Registration cannot be reopened.',
      );
    if (
      current.archived_at &&
      ['publish', 'unpublish', 'archive'].includes(body.action)
    )
      throw new RequestError(
        409,
        'This event is archived. Restore it as a draft before publishing.',
      );
    if (!current.archived_at && body.action === 'restore')
      throw new RequestError(
        409,
        'This event is already active. Reload the event.',
      );
    const nextDraft = draft || normalizeEventType(current.draft);
    const nextLive = body.action === 'draft' ? current.published : published;
    if (current.rsvp_survey_status === 'deleted') {
      const removed = {
        registrationOpen: false,
        surveyIntro: '',
        surveyQuestions: [],
        surveyVersion: '',
      };
      Object.assign(nextDraft, removed);
      if (nextLive) Object.assign(nextLive, removed);
    }
    // Ignore a client-supplied URL and preserve the server-created link through
    // edits, unpublishing and restoration. Duplicates receive their own link.
    for (const key of ['shortLink', 'feedbackShortLink']) {
      const link = current.draft[key] || current.published?.[key];
      if (link) {
        nextDraft[key] = link;
        if (nextLive) nextLive[key] = link;
      }
    }
    const revision = current.revision + 1;
    const row = (
      await tx.query(
        `UPDATE club_forms.events SET draft=$2,published=$3,revision=$4,
       published_revision=CASE WHEN $5='publish' THEN $4 ELSE published_revision END,
       published_at=CASE WHEN $5='publish' THEN now() ELSE published_at END,
       archived_at=CASE WHEN $5='archive' THEN now() WHEN $5='restore' THEN NULL ELSE archived_at END,
       updated_at=now(),updated_by=$6 WHERE id=$1 RETURNING *`,
        [
          body.id,
          JSON.stringify(nextDraft),
          nextLive ? JSON.stringify(nextLive) : null,
          revision,
          body.action,
          actor,
        ],
      )
    ).rows[0];
    await tx.query(
      `INSERT INTO club_forms.event_history(event_id,revision,action,actor,content) VALUES($1,$2,$3,$4,$5)`,
      [
        body.id,
        revision,
        body.action,
        actor,
        JSON.stringify({
          draft: nextDraft,
          published: nextLive,
          archived_at: row.archived_at,
          ...(body.action === 'archive'
            ? { previousPublished: current.published }
            : {}),
        }),
      ],
    );
    return row;
  });
}
