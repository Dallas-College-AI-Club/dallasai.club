import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';
import { createHash } from 'node:crypto';
import { originalEvents } from './events.mjs';
import {
  draftContent,
  editableContent,
  eventIdPattern,
} from './event-content.mjs';

export async function rsvpSurveyCatalog(db, originals) {
  originals ??= await originalEvents();
  const stored = (await db.query('SELECT * FROM club_forms.events')).rows;
  const counts = (
    await db.query(`SELECT s.event_id AS id,
    (array_agg(s.event_title ORDER BY s.created_at DESC,s.entry_id))[1] AS title,
    count(*) FILTER (WHERE m.archived_at IS NULL)::int AS active,
    count(*) FILTER (WHERE m.archived_at IS NOT NULL)::int AS archived
    FROM club_forms.survey_responses s LEFT JOIN club_forms.survey_response_state m USING(entry_id)
    GROUP BY s.event_id`)
  ).rows;
  const rows = new Map(
    originals
      .filter((e) => e.registrationOpen !== false)
      .map((e) => [
        e.id,
        {
          eventId: e.id,
          title: e.title,
          status: 'active',
          revision: 0,
          registrationOpen: true,
          hasEvent: true,
        },
      ]),
  );
  for (const row of counts)
    rows.set(row.id, {
      ...rows.get(row.id),
      eventId: row.id,
      title: rows.get(row.id)?.title || row.title,
      status: 'active',
      revision: 0,
      registrationOpen: rows.get(row.id)?.registrationOpen || false,
      hasEvent: originals.some((e) => e.id === row.id),
    });
  for (const row of stored) {
    if (row.rsvp_survey_status === 'deleted') {
      rows.delete(row.id);
      continue;
    }
    if (
      rows.has(row.id) ||
      row.rsvp_survey_status === 'archived' ||
      row.draft.registrationOpen ||
      row.published?.registrationOpen
    )
      rows.set(row.id, {
        eventId: row.id,
        title: row.draft.title || row.published?.title || row.id,
        status: row.rsvp_survey_status,
        revision: row.revision,
        registrationOpen:
          row.rsvp_survey_status === 'active' &&
          !row.archived_at &&
          row.published?.registrationOpen !== false &&
          Boolean(row.published),
        hasEvent:
          Boolean(row.published) || originals.some((e) => e.id === row.id),
      });
  }
  return [...rows.values()].map((row) => {
    const count = counts.find((c) => c.id === row.eventId);
    return {
      ...row,
      responseCount: count?.active || 0,
      archivedResponseCount: count?.archived || 0,
    };
  });
}

export async function changeRsvpSurvey(db, body, actor, originals) {
  const actions = [
    'rsvp-survey-archive',
    'rsvp-survey-restore',
    'rsvp-survey-delete',
  ];
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (k) =>
        !['action', 'eventId', 'expectedRevision', 'requestId'].includes(k),
    ) ||
    !actions.includes(body.action) ||
    !eventIdPattern.test(body.eventId || '') ||
    !uuid.test(body.requestId || '') ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0
  )
    throw new RequestError(400, 'Reload the RSVP survey before changing it.');
  originals ??= await originalEvents();
  const digest = createHash('sha256')
    .update(
      JSON.stringify([actor, body.action, body.eventId, body.expectedRevision]),
    )
    .digest('hex');
  return db
    .transaction(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('event-rsvp:' || $1,0))",
        [body.eventId],
      );
      const receipt = (
        await tx.query(
          "SELECT revision,content FROM club_forms.event_history WHERE action=ANY($2::text[]) AND content->>'requestId'=$1",
          [body.requestId, actions],
        )
      ).rows[0];
      if (receipt) {
        if (receipt.content.digest !== digest)
          throw new RequestError(
            409,
            'This change reference was already used. Reload the RSVP survey.',
          );
        return {
          eventId: body.eventId,
          status: receipt.content.status,
          revision: receipt.revision,
          deleted: receipt.content.status === 'deleted',
        };
      }
      let current = (
        await tx.query(
          'SELECT * FROM club_forms.events WHERE id=$1 FOR UPDATE',
          [body.eventId],
        )
      ).rows[0];
      if (!current) {
        const original = originals.find((e) => e.id === body.eventId);
        const snapshot = (
          await tx.query(
            'SELECT event_title,event_date,potential FROM club_forms.survey_responses WHERE event_id=$1 ORDER BY created_at DESC,entry_id LIMIT 1',
            [body.eventId],
          )
        ).rows[0];
        if (!original && !snapshot)
          throw new RequestError(404, 'RSVP survey not found.');
        const draft = original
          ? editableContent(original)
          : draftContent({
              title: snapshot.event_title || body.eventId,
              registrationOpen: false,
              potential: snapshot.potential,
            });
        current = (
          await tx.query(
            'INSERT INTO club_forms.events(id,draft,published,updated_by) VALUES($1,$2,$3,$4) RETURNING *',
            [
              body.eventId,
              JSON.stringify(draft),
              original ? JSON.stringify(original) : null,
              actor,
            ],
          )
        ).rows[0];
      }
      if (current.revision !== body.expectedRevision)
        throw new RequestError(
          409,
          'Another admin updated this event or RSVP survey. Reload before continuing.',
        );
      if (current.rsvp_survey_status === 'deleted')
        throw new RequestError(
          409,
          'This RSVP survey was permanently deleted.',
        );
      if (
        (body.action === 'rsvp-survey-restore' ||
          body.action === 'rsvp-survey-delete') &&
        current.rsvp_survey_status !== 'archived'
      )
        throw new RequestError(
          409,
          'Archive this RSVP survey before restoring or permanently deleting it.',
        );
      if (
        body.action === 'rsvp-survey-archive' &&
        current.rsvp_survey_status !== 'active'
      )
        throw new RequestError(409, 'This RSVP survey is already archived.');
      const status =
        body.action === 'rsvp-survey-delete'
          ? 'deleted'
          : body.action === 'rsvp-survey-restore'
            ? 'active'
            : 'archived';
      const revision = current.revision + 1;
      const content = (value) =>
        value && {
          ...value,
          registrationOpen: false,
          ...(status === 'deleted'
            ? { surveyIntro: '', surveyQuestions: [], surveyVersion: '' }
            : {}),
        };
      await tx.query(
        `UPDATE club_forms.events SET draft=$2,published=$3,rsvp_survey_status=$4,
      revision=$5,published_revision=CASE WHEN published IS NOT NULL AND published_revision=revision THEN $5 ELSE published_revision END,
      updated_at=now(),updated_by=$6 WHERE id=$1`,
        [
          body.eventId,
          JSON.stringify(content(current.draft)),
          current.published ? JSON.stringify(content(current.published)) : null,
          status,
          revision,
          actor,
        ],
      );
      if (status === 'deleted')
        await tx.query(
          "DELETE FROM club_forms.entries e WHERE e.kind='rsvp' AND coalesce((SELECT event_id FROM club_forms.survey_responses WHERE entry_id=e.id),e.data->>'eventId')=$1",
          [body.eventId],
        );
      await tx.query(
        'INSERT INTO club_forms.event_history(event_id,revision,action,actor,content) VALUES($1,$2,$3,$4,$5)',
        [
          body.eventId,
          revision,
          body.action,
          actor,
          JSON.stringify({ requestId: body.requestId, digest, status }),
        ],
      );
      return {
        eventId: body.eventId,
        status,
        revision,
        deleted: status === 'deleted',
      };
    })
    .catch((error) => {
      if (error.code === '23505')
        throw new RequestError(
          409,
          'This change reference was already used. Reload the RSVP survey.',
        );
      throw error;
    });
}

export function responseFilter(
  {
    eventId = '',
    entryId = '',
    search = '',
    view = 'active',
    starred = false,
    attendance = 'all',
    feedback = 'all',
    offset = 0,
  } = {},
  { rsvpParent = true } = {},
) {
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
    AND ($4='all' OR ($4='active' AND m.archived_at IS NULL ${rsvpParent ? "AND coalesce(v.rsvp_survey_status,'active')='active'" : ''}) OR ($4='archived' AND (m.archived_at IS NOT NULL ${rsvpParent ? "OR v.rsvp_survey_status='archived'" : ''})))
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
        AND (jsonb_array_length(cr.responses)>0 OR coalesce(cr.response_definition,cs.definition) IS NOT NULL)
    ) AS submitted
    FROM club_forms.custom_surveys cs WHERE cs.definition->>'eventId'=s.event_id AND cs.status<>'draft'
  ) linked
) f ON true`;
export const responseFrom = `FROM club_forms.survey_responses s JOIN club_forms.entries e ON e.id=s.entry_id
LEFT JOIN club_forms.survey_response_state m ON m.entry_id=s.entry_id
LEFT JOIN club_forms.events v ON v.id=s.event_id ${participationJoins}`;
export const responseSelect = `SELECT s.*,e.name,e.email,e.review_status,coalesce(m.starred,false) AS starred,
CASE WHEN v.rsvp_survey_status='archived' THEN v.updated_at ELSE m.archived_at END AS archived_at,
coalesce(v.rsvp_survey_status='archived',false) AS rsvp_survey_archived,
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
    const eventId = (
      await tx.query(
        'SELECT event_id FROM club_forms.survey_responses WHERE entry_id=$1',
        [body.entryId],
      )
    ).rows[0]?.event_id;
    if (eventId) {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('event-rsvp:' || $1,0))",
        [eventId],
      );
      if (
        body.action === 'archive' &&
        !body.value &&
        (
          await tx.query(
            'SELECT rsvp_survey_status FROM club_forms.events WHERE id=$1',
            [eventId],
          )
        ).rows[0]?.rsvp_survey_status === 'archived'
      )
        throw new RequestError(
          409,
          'Restore the RSVP survey before restoring an individual response.',
        );
    }
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
