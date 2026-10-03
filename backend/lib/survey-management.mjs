import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';

export function responseFilter({
  eventId = '',
  entryId = '',
  search = '',
  view = 'active',
  starred = false,
  offset = 0,
} = {}) {
  if (
    (eventId && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(eventId)) ||
    (entryId && !uuid.test(entryId)) ||
    typeof search !== 'string' ||
    search.length > 200 ||
    !['active', 'archived', 'all'].includes(view) ||
    typeof starred !== 'boolean' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000
  )
    throw new RequestError(400, 'Invalid survey filter.');
  return {
    offset,
    values: [eventId, entryId, search.trim().toLowerCase(), view, starred],
    where: `WHERE ($1='' OR s.event_id=$1) AND ($2='' OR s.entry_id::text=$2)
    AND ($3='' OR strpos(lower(e.name || ' ' || e.email),$3)>0)
    AND ($4='all' OR ($4='active' AND m.archived_at IS NULL) OR ($4='archived' AND m.archived_at IS NOT NULL))
    AND (NOT $5 OR coalesce(m.starred,false))`,
  };
}
export const responseFrom = `FROM club_forms.survey_responses s JOIN club_forms.entries e ON e.id=s.entry_id LEFT JOIN club_forms.survey_response_state m ON m.entry_id=s.entry_id`;
export const responseSelect = `SELECT s.*,e.name,e.email,e.review_status,coalesce(m.starred,false) AS starred,m.archived_at ${responseFrom}`;
export async function manageResponse(db, body, actor) {
  if (
    !uuid.test(body.entryId || '') ||
    !['star', 'archive'].includes(body.action) ||
    typeof body.value !== 'boolean'
  )
    throw new RequestError(400, 'Choose a response and a valid action.');
  return db.transaction(async (tx) => {
    if (
      !(
        await tx.query(
          'SELECT entry_id FROM club_forms.survey_responses WHERE entry_id=$1',
          [body.entryId],
        )
      ).rows.length
    )
      throw new RequestError(404, 'Survey response not found.');
    await tx.query(
      `INSERT INTO club_forms.survey_response_state(entry_id,updated_by) VALUES($1,$2) ON CONFLICT(entry_id) DO NOTHING`,
      [body.entryId, actor],
    );
    const row = (
      await tx.query(
        'SELECT * FROM club_forms.survey_response_state WHERE entry_id=$1 FOR UPDATE',
        [body.entryId],
      )
    ).rows[0];
    const previous =
      body.action === 'star' ? row.starred : Boolean(row.archived_at);
    if (previous === body.value) return row;
    const assignment =
      body.action === 'star'
        ? 'starred=$2'
        : 'archived_at=CASE WHEN $2 THEN now() ELSE NULL END';
    const updated = (
      await tx.query(
        `UPDATE club_forms.survey_response_state SET ${assignment},updated_at=now(),updated_by=$3 WHERE entry_id=$1 RETURNING *`,
        [body.entryId, body.value, actor],
      )
    ).rows[0];
    const action =
      body.action === 'star'
        ? body.value
          ? 'survey-starred'
          : 'survey-unstarred'
        : body.value
          ? 'survey-archived'
          : 'survey-restored';
    await tx.query(
      'INSERT INTO club_forms.audit(actor,entry_id,action) VALUES($1,$2,$3)',
      [actor, body.entryId, action],
    );
    return updated;
  });
}
