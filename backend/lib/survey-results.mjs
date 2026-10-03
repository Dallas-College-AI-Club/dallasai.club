import { RequestError } from './errors.mjs';

export async function surveyResultPage(
  db,
  surveyId,
  offset = '0',
  { activeOnly = false, exclude = null } = {},
) {
  const start = Number(offset || 0);
  if (!Number.isSafeInteger(start) || start < 0 || start > 100000)
    throw new RequestError(400, 'Choose a valid survey results page.');
  // A response can contain long written answers. Keep the serialized response
  // comfortably below the serverless response limit, even for a public survey.
  const { rows } = await db.query(
    `
    SELECT m.advisor_id,m.display_name,m.active,r.revision,r.responses,r.submitted_at
    FROM club_forms.custom_survey_members m
    JOIN club_forms.custom_survey_responses r USING(survey_id,advisor_id)
    WHERE m.survey_id=$1 AND jsonb_array_length(r.responses)>0
      AND (NOT $2::boolean OR m.active) AND ($3::text IS NULL OR m.advisor_id<>$3)
    ORDER BY m.active DESC,m.advisor_id DESC LIMIT 11 OFFSET $4`,
    [surveyId, activeOnly, exclude, start],
  );
  return {
    results: rows.slice(0, 10),
    nextOffset: rows.length > 10 ? start + 10 : null,
  };
}
