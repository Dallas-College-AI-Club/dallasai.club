import { builderLinks } from './survey-builder.mjs';

export async function eventFeedbackLinks(db, eventIds) {
  const links = new Map();
  if (!eventIds.length) return links;
  const { rows } = await db.query(
    `SELECT id,status,expires_at,link_digest,short_link,definition->>'eventId' AS event_id
    FROM club_forms.custom_surveys
    WHERE status='open' AND expires_at>now()
      AND definition->>'eventId'=ANY($1::text[])
      AND definition->>'template'='feedback'
      AND definition->>'audience'='public'
      AND definition->'permissions'->>'answer'='verified'
    ORDER BY published_at DESC NULLS LAST,id DESC`,
    [eventIds],
  );
  for (const survey of rows) {
    const { privateLink } = builderLinks(survey);
    if (privateLink && !links.has(survey.event_id))
      links.set(survey.event_id, survey.short_link || privateLink);
  }
  return links;
}

export async function surveyCatalog(db) {
  const { rows } = await db.query(`
    SELECT s.id,s.title,s.status,s.edit_revision,s.published_at,s.expires_at,s.content_version,s.link_digest,s.preview_digest,s.short_link,
      CASE WHEN s.definition IS NULL THEN NULL
        ELSE jsonb_strip_nulls(jsonb_build_object('permissions',s.definition->'permissions','eventId',s.definition->'eventId')) END AS definition,
      count(r.advisor_id) FILTER (WHERE m.active AND (jsonb_array_length(r.responses)>0 OR coalesce(r.response_definition,s.definition) IS NOT NULL))::int AS response_count,
      count(r.advisor_id) FILTER (WHERE NOT m.active AND (jsonb_array_length(r.responses)>0 OR coalesce(r.response_definition,s.definition) IS NOT NULL))::int AS archived_response_count
    FROM club_forms.custom_surveys s
    LEFT JOIN club_forms.custom_survey_members m ON m.survey_id=s.id
    LEFT JOIN club_forms.custom_survey_responses r ON r.survey_id=m.survey_id AND r.advisor_id=m.advisor_id
    GROUP BY s.id ORDER BY s.created_at DESC,s.id`);
  return rows.map(({ link_digest, preview_digest, ...survey }) => ({
    ...survey,
    expired:
      survey.status === 'open' && new Date(survey.expires_at) <= new Date(),
    ...builderLinks({ ...survey, link_digest, preview_digest }),
  }));
}
