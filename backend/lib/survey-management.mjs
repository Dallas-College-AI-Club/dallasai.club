import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';

export function responseFilter({
  eventId = '',
  entryId = '',
  search = '',
  view = 'active',
  starred = false,
  attendance = 'all',
  feedback = 'all',
  offset = 0,
} = {}) {
  if (
    (eventId && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(eventId)) ||
    (entryId && !uuid.test(entryId)) ||
    typeof search !== 'string' ||
    search.length > 200 ||
    !['active', 'archived', 'all'].includes(view) ||
    typeof starred !== 'boolean' ||
    !['', 'all', 'not_recorded', 'attended', 'did_not_attend'].includes(
      attendance,
    ) ||
    !['', 'all', 'submitted', 'missing', 'no_survey'].includes(feedback) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000
  )
    throw new RequestError(400, 'Invalid survey filter.');
  return {
    offset,
    values: [
      eventId,
      entryId,
      search.trim().toLowerCase(),
      view,
      starred,
      attendance || 'all',
      feedback || 'all',
    ],
    where: `WHERE ($1='' OR s.event_id=$1) AND ($2='' OR s.entry_id::text=$2)
    AND ($3='' OR strpos(lower(e.name || ' ' || e.email),$3)>0)
    AND ($4='all' OR ($4='active' AND m.archived_at IS NULL) OR ($4='archived' AND m.archived_at IS NOT NULL))
    AND (NOT $5 OR coalesce(m.starred,false))
    AND ($6='all' OR coalesce(a.attendance,'not_recorded')=$6)
    AND ($7='all' OR f.feedback_status=$7)`,
  };
}
export const participationJoins = `LEFT JOIN club_forms.event_attendance a ON a.event_id=s.event_id AND a.email=lower(trim(e.email))
LEFT JOIN LATERAL (
  SELECT count(*)::int AS feedback_survey_count,
    count(*) FILTER (WHERE submitted)::int AS feedback_submitted_count,
    CASE WHEN count(*)=0 THEN 'no_survey'
      WHEN bool_and(submitted) THEN 'submitted' ELSE 'missing' END AS feedback_status
  FROM (
    SELECT EXISTS (
      SELECT 1 FROM club_forms.custom_survey_members cm
      JOIN club_forms.custom_survey_responses cr USING(survey_id,advisor_id)
      WHERE cm.survey_id=cs.id AND lower(trim(cm.email))=lower(trim(e.email))
        AND jsonb_array_length(cr.responses)>0
    ) AS submitted
    FROM club_forms.custom_surveys cs WHERE cs.definition->>'eventId'=s.event_id AND cs.status<>'draft'
  ) linked
) f ON true`;
export const responseFrom = `FROM club_forms.survey_responses s JOIN club_forms.entries e ON e.id=s.entry_id
LEFT JOIN club_forms.survey_response_state m ON m.entry_id=s.entry_id ${participationJoins}`;
export const responseSelect = `SELECT s.*,e.name,e.email,e.review_status,coalesce(m.starred,false) AS starred,m.archived_at,
coalesce(a.attendance,'not_recorded') AS attendance,f.feedback_status,f.feedback_submitted_count,f.feedback_survey_count ${responseFrom}`;

async function recordAttendance(db, body, actor) {
  if (
    !uuid.test(body.entryId || '') ||
    !['not_recorded', 'attended', 'did_not_attend'].includes(body.value)
  )
    throw new RequestError(
      400,
      'Choose a response and a valid attendance status.',
    );
  return db.transaction(async (tx) => {
    const entry = (
      await tx.query(
        `SELECT s.event_id,lower(trim(e.email)) AS email FROM club_forms.survey_responses s
       JOIN club_forms.entries e ON e.id=s.entry_id WHERE s.entry_id=$1 FOR UPDATE OF e`,
        [body.entryId],
      )
    ).rows[0];
    if (!entry) throw new RequestError(404, 'Survey response not found.');
    const values = [entry.event_id, entry.email];
    await tx.query(
      `INSERT INTO club_forms.event_attendance(event_id,email,attendance,updated_by)
       VALUES($1,$2,'not_recorded',$3) ON CONFLICT(event_id,email) DO NOTHING`,
      [...values, actor],
    );
    const previous = (
      await tx.query(
        'SELECT attendance FROM club_forms.event_attendance WHERE event_id=$1 AND email=$2 FOR UPDATE',
        values,
      )
    ).rows[0].attendance;
    if (previous !== body.value) {
      await tx.query(
        'UPDATE club_forms.event_attendance SET attendance=$3,updated_at=now(),updated_by=$4 WHERE event_id=$1 AND email=$2',
        [...values, body.value, actor],
      );
      await tx.query(
        'INSERT INTO club_forms.audit(actor,entry_id,action) VALUES($1,$2,$3)',
        [actor, body.entryId, `attendance:${previous}:${body.value}`],
      );
    }
    return { ...entry, attendance: body.value };
  });
}
export async function manageResponse(db, body, actor) {
  if (body.action === 'attendance') return recordAttendance(db, body, actor);
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
