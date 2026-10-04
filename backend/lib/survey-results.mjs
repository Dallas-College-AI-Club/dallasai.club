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
  // Respondents (exclude is set) never see each other's email addresses: a
  // blank or email-like name becomes 'Respondent N', numbered the same way for
  // every viewer. N follows each respondent's first submission (its earliest
  // receipt), so edits never renumber anyone and newcomers are added at the end.
  // Officers see the stored name and the email.
  const { rows } = await db.query(
    `
    SELECT advisor_id,CASE WHEN $3::text IS NOT NULL AND (btrim(display_name)='' OR strpos(display_name,'@')>0)
      THEN 'Respondent ' || ordinal ELSE display_name END AS display_name,email,active,revision,responses,submitted_at
    FROM (
      SELECT m.advisor_id,m.display_name,m.email,m.active,r.revision,r.responses,r.submitted_at,
        row_number() OVER (ORDER BY (
          SELECT min(c.created_at) FROM club_forms.custom_survey_receipts c
          WHERE c.survey_id=m.survey_id AND c.advisor_id=m.advisor_id
        ),m.advisor_id) AS ordinal
      FROM club_forms.custom_survey_members m
      JOIN club_forms.custom_survey_responses r USING(survey_id,advisor_id)
      WHERE m.survey_id=$1 AND jsonb_array_length(r.responses)>0
        AND (NOT $2::boolean OR m.active)
    ) shown
    WHERE $3::text IS NULL OR advisor_id<>$3
    ORDER BY active DESC,advisor_id DESC LIMIT 11 OFFSET $4`,
    [surveyId, activeOnly, exclude, start],
  );
  return {
    results: rows
      .slice(0, 10)
      .map(({ email, ...row }) => (exclude === null ? { ...row, email } : row)),
    nextOffset: rows.length > 10 ? start + 10 : null,
  };
}
