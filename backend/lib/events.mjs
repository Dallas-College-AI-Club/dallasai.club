import { readFile } from 'node:fs/promises';
import { RequestError } from './errors.mjs';
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
    if (row.published) events.set(row.id, row.published);
    else events.delete(row.id);
  }
  return [...events.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export async function liveEvents(db, originals) {
  originals ??= await originalEvents();
  return mergeEvents(
    originals,
    (await db.query('SELECT id,published FROM club_forms.events')).rows,
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
      },
    ]),
  );
  for (const row of (await db.query('SELECT * FROM club_forms.events')).rows)
    rows.set(row.id, row);
  return [...rows.values()].sort((a, b) =>
    (b.draft.date || '').localeCompare(a.draft.date || ''),
  );
}
export async function saveEvent(db, body, actor, originals) {
  if (
    !['draft', 'publish', 'unpublish'].includes(body.action) ||
    !eventIdPattern.test(body.id || '') ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    throw new RequestError(400, 'Reload the event and try again.');
  const draft =
    body.action === 'unpublish'
      ? null
      : draftContent(body.event, body.action === 'publish');
  const published =
    body.action === 'publish' ? publicContent(body.id, draft) : null;
  originals ??= await originalEvents();
  const original = originals.find((event) => event.id === body.id);
  return db.transaction(async (tx) => {
    if (body.revision === 0 && (original || body.action !== 'unpublish')) {
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
    const nextDraft = draft || current.draft;
    const nextLive = body.action === 'draft' ? current.published : published;
    const revision = current.revision + 1;
    const row = (
      await tx.query(
        `UPDATE club_forms.events SET draft=$2,published=$3,revision=$4,
       published_revision=CASE WHEN $5='publish' THEN $4 ELSE published_revision END,
       published_at=CASE WHEN $5='publish' THEN now() ELSE published_at END,
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
        JSON.stringify({ draft: nextDraft, published: nextLive }),
      ],
    );
    return row;
  });
}
