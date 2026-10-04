import { builderLinks } from './survey-builder.mjs';

export async function surveyCatalog(db) {
  const { rows } = await db.query(`
    SELECT s.id,s.title,s.status,s.expires_at,s.content_version,s.link_digest,s.preview_digest,
      CASE WHEN s.definition IS NULL THEN NULL
        ELSE jsonb_strip_nulls(jsonb_build_object('permissions',s.definition->'permissions','eventId',s.definition->'eventId')) END AS definition,
      count(r.advisor_id) FILTER (WHERE m.active AND jsonb_array_length(r.responses)>0)::int AS response_count,
      count(r.advisor_id) FILTER (WHERE NOT m.active AND jsonb_array_length(r.responses)>0)::int AS archived_response_count
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
