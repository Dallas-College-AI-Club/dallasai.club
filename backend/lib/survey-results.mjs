import { RequestError } from './errors.mjs';
import { csvCell, centralDate, received } from './submission-export.mjs';
import { answerFormat, answerRank, fileSlug } from '../surveys/results-ui.js';

export async function surveyResultPage(
  db,
  surveyId,
  offset = '0',
  {
    activeOnly = false,
    exclude = null,
    view = activeOnly ? 'active' : 'all',
    search = '',
  } = {},
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
    SELECT advisor_id,response_definition,CASE WHEN $3::text IS NOT NULL AND (btrim(display_name)='' OR strpos(display_name,'@')>0)
      THEN 'Respondent ' || ordinal ELSE display_name END AS display_name,email,active,revision,responses,submitted_at
    FROM (
      SELECT m.advisor_id,m.display_name,m.email,m.active,r.revision,r.responses,r.submitted_at,r.response_definition,
        row_number() OVER (ORDER BY (
          SELECT min(c.created_at) FROM club_forms.custom_survey_receipts c
          WHERE c.survey_id=m.survey_id AND c.advisor_id=m.advisor_id
        ),m.advisor_id) AS ordinal
      FROM club_forms.custom_survey_members m
      JOIN club_forms.custom_survey_responses r USING(survey_id,advisor_id)
      WHERE m.survey_id=$1 AND jsonb_array_length(r.responses)>0
        AND (NOT $2::boolean OR m.active)
        AND ($3::text IS NULL OR r.response_definition IS NULL OR r.response_definition->'permissions'->>'results'='respondents')
        AND ($5='all' OR m.active=($5='active'))
        AND strpos(lower(m.display_name || ' ' || m.email),lower($6))>0
    ) shown
    WHERE $3::text IS NULL OR advisor_id<>$3
    ORDER BY active DESC,advisor_id DESC LIMIT 11 OFFSET $4`,
    [surveyId, activeOnly, exclude, start, view, search.trim()],
  );
  return {
    results: rows
      .slice(0, 10)
      .map(({ email, ...row }) => (exclude === null ? { ...row, email } : row)),
    nextOffset: rows.length > 10 ? start + 10 : null,
  };
}
// The CSV export holds what Submitted responses lists: every active
// respondent's saved answers, across every page. Like the Inbox export, it
// refuses a set too large to send instead of cutting it short.
export async function surveyExportRows(
  db,
  surveyId,
  { view = 'active', search = '' } = {},
) {
  const { rows } = await db.query(
    `SELECT m.display_name,m.email,m.active,r.responses,r.submitted_at,r.response_definition
    FROM club_forms.custom_survey_members m
    JOIN club_forms.custom_survey_responses r USING(survey_id,advisor_id)
    WHERE m.survey_id=$1 AND ($2='all' OR m.active=($2='active')) AND jsonb_array_length(r.responses)>0
      AND strpos(lower(m.display_name || ' ' || m.email),lower($3))>0
    ORDER BY r.submitted_at DESC,m.advisor_id LIMIT 10001`,
    [surveyId, view, search.trim()],
  );
  if (rows.length > 10000)
    throw new RequestError(
      413,
      'More than 10,000 responses. Download responses one at a time as PDF instead.',
    );
  return rows;
}
// One row per respondent and one column per question, in survey order.
// Answers read as on screen: '1. … 2. …' rankings, chosen options joined
// with '; ', and dials as '65 of 100 — <wording>'. Wording a respondent
// rewrote for sharing starts '[Shared wording only] '. Builder surveys list
// every question; Advisor Studio lists the answers respondents shared.
export function surveyResultsCSV(rows, definition) {
  const rank = answerRank(definition),
    columns = new Map();
  const columnTitle = (column) =>
    (column.choiceDate ? column.choiceDate + ' · ' : '') + column.title;
  const key = (column) => column.id + ':' + columnTitle(column);
  if (!definition?.chapters)
    for (const q of definition?.questions || []) columns.set(key(q), q);
  for (const row of rows)
    for (const answer of row.responses)
      if (!columns.has(key(answer))) columns.set(key(answer), answer);
  const ordered = [...columns.values()].sort(
    (a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id),
  );
  const cell = (answer, savedDefinition) => {
    if (!answer) return '';
    const { kind, lines, dial } = answerFormat(answer, savedDefinition),
      text = lines.filter(Boolean).join(kind === 'choices' ? '; ' : ' ');
    return (
      (answer.mode === 'narrative' ? '[Shared wording only] ' : '') +
      (dial === undefined ? text : `${dial} of 100 — ${text}`)
    );
  };
  const header = [
    'Name',
    'Email',
    'Submitted (Central)',
    'Status',
    ...ordered.map(columnTitle),
  ];
  const lines = rows.map((row) => [
    // As on screen, a respondent without a name is shown by email.
    row.display_name || row.email,
    row.email,
    received.format(new Date(row.submitted_at)),
    row.active ? 'Active' : 'Archived',
    ...ordered.map((column) =>
      cell(
        row.responses.find((answer) => key(answer) === key(column)),
        row.response_definition || definition,
      ),
    ),
  ]);
  return (
    '\uFEFF' +
    [header, ...lines]
      .map((line) =>
        line
          .map((value) => csvCell(String(value ?? '').replace(/[\r\n]+/g, ' ')))
          .join(','),
      )
      .join('\r\n') +
    '\r\n'
  );
}
// <survey>-responses-<Central date>.csv
export const surveyExportFilename = (title, now = new Date()) =>
  `${fileSlug(title) || 'custom-survey'}-responses-${centralDate.format(now)}.csv`;
