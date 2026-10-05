import { csvCell } from './submission-export.mjs';
import { RequestError } from './errors.mjs';
import { exclusiveSurveyChoice } from './event-format.mjs';
import { uuid } from './validation.mjs';
import {
  availabilityValues,
  availabilityColumns,
} from '../surveys/availability-values.js';
import {
  responseFilter,
  responseSelect,
  participationJoins,
} from './survey-management.mjs';
const anyChoice = (value) =>
  String(value).trim().toLowerCase() === 'any of these';
const ordinaryChoice = (value) =>
  value !== '__other__' && !exclusiveSurveyChoice(value);
const impliedChoice = (question, values, choice) =>
  question.type === 'multiple' &&
  question.expandAny !== false &&
  values.some(anyChoice) &&
  ordinaryChoice(choice);
export const answerValues = (answer) =>
  answer?.value &&
  typeof answer.value === 'object' &&
  !Array.isArray(answer.value)
    ? availabilityValues(answer.value)
    : (Array.isArray(answer?.value) ? answer.value : [answer?.value ?? ''])
        .filter(
          (value) => value !== '' && value !== null && value !== undefined,
        )
        .map((value) =>
          value === '__other__' ? 'Other: ' + answer.other : value,
        );
export async function reportRows(db, filter = {}) {
  const { where, values } = responseFilter(filter);
  const type = filter.type || 'rsvp';
  const surveyId = filter.surveyId || '';
  if (surveyId && !uuid.test(surveyId))
    throw new RequestError(400, 'Choose a valid feedback survey.');
  if (!['all', 'rsvp', 'feedback'].includes(type))
    throw new RequestError(400, 'Choose a valid response type.');
  // Never silently export or summarize only the visible page.
  const rows =
    type === 'feedback'
      ? []
      : (
          await db.query(
            `${responseSelect} ${where} ORDER BY s.created_at DESC,s.entry_id LIMIT 10001`,
            values,
          )
        ).rows;
  if (type !== 'rsvp') {
    const feedback = (
      await db.query(
        `SELECT cs.id AS survey_id,cs.title AS survey_title,coalesce(cr.response_definition->>'content_version',cs.content_version) AS content_version,coalesce(cr.response_definition,cs.definition) AS definition,
        s.event_id,coalesce(ev.published->>'title',ev.draft->>'title',registered.event_title,s.event_id) AS event_title,
        coalesce(ev.published->>'date',ev.draft->>'date',registered.event_date,'') AS event_date,
        e.name,e.email,cr.responses,cr.submitted_at AS created_at,m.archived_at,false AS starred,
        coalesce(a.attendance,'not_recorded') AS attendance,
        f.feedback_status,f.feedback_submitted_count,f.feedback_survey_count
       FROM club_forms.custom_surveys cs
       JOIN club_forms.custom_survey_members cm ON cm.survey_id=cs.id
       JOIN club_forms.custom_survey_responses cr USING(survey_id,advisor_id)
       CROSS JOIN LATERAL (SELECT cs.definition->>'eventId' AS event_id,NULL::uuid AS entry_id) s
       CROSS JOIN LATERAL (SELECT cm.display_name AS name,cm.email) e
       CROSS JOIN LATERAL (SELECT false AS starred,CASE WHEN cm.active THEN NULL::timestamptz ELSE cr.submitted_at END AS archived_at) m
       LEFT JOIN club_forms.events ev ON ev.id=s.event_id
       LEFT JOIN LATERAL (SELECT event_title,event_date FROM club_forms.survey_responses sr
         WHERE sr.event_id=s.event_id ORDER BY sr.created_at DESC,sr.entry_id LIMIT 1) registered ON true
       ${participationJoins} ${where}
       AND s.event_id IS NOT NULL AND (cs.status<>'draft' OR cs.published_at IS NOT NULL) AND jsonb_array_length(cr.responses)>0
       AND ($8='' OR cs.id::text=$8)
       ORDER BY cr.submitted_at DESC,cs.id,cm.advisor_id LIMIT 10001`,
        [...values, surveyId],
      )
    ).rows;
    for (const row of feedback) {
      const questions = row.definition.questions.map((q) => ({
        ...q,
        label: q.title,
        allowOther: false,
        expandAny: false,
        type: ['single', 'multiple', 'availability'].includes(q.type)
          ? q.type
          : 'text',
      }));
      const answers = row.responses.map((answer) => {
        const q = questions.find((q) => q.id === answer.id);
        return {
          questionId: answer.id,
          other: '',
          value:
            q?.type === 'availability'
              ? answer.value
              : q?.type === 'multiple'
                ? answer.value.map((index) => q.options[index])
                : q?.type === 'single'
                  ? q.options[answer.value]
                  : answer.text,
        };
      });
      const { definition, responses, content_version, ...metadata } = row;
      rows.push({
        ...metadata,
        response_type: 'feedback',
        survey_version: row.survey_id + ':' + content_version,
        questions,
        answers,
      });
    }
  }
  if (rows.length > 10000)
    throw new RequestError(
      413,
      'More than 10,000 responses match. Select an event or narrow the search first.',
    );
  return rows;
}
export function summarizeResponses(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.event_id + ':' + row.survey_version;
    if (!groups.has(key))
      groups.set(key, {
        eventId: row.event_id,
        title: row.event_title,
        date: row.event_date,
        version: row.survey_version,
        responseType: row.response_type || 'rsvp',
        surveyTitle: row.survey_title || '',
        count: 0,
        questions: row.questions.map((q) => ({
          ...q,
          answered: 0,
          skipped: 0,
          choices: (q.type === 'availability'
            ? availabilityColumns(q)
            : [...q.options, ...(q.allowOther ? ['__other__'] : [])]
          ).map((value) => ({
            value,
            label: value === '__other__' ? 'Other' : value,
            count: 0,
          })),
          written: [],
        })),
      });
    const group = groups.get(key);
    group.count++;
    for (const q of group.questions) {
      const answer = row.answers.find((a) => a.questionId === q.id);
      const values =
        q.type === 'availability'
          ? availabilityValues(answer?.value)
          : Array.isArray(answer?.value)
            ? answer.value
            : [answer?.value ?? ''];
      if (!values.some((value) => value !== '')) {
        q.skipped++;
        continue;
      }
      q.answered++;
      for (const choice of q.choices)
        if (
          values.includes(choice.value) ||
          impliedChoice(q, values, choice.value)
        )
          choice.count++;
      if (q.type === 'availability' && answer.value?.alternatives.length)
        q.written.push({
          name: row.name,
          email: row.email,
          value: availabilityValues({ ...answer.value, selections: [] }).join(
            '\n',
          ),
        });
      else if (!['single', 'multiple', 'availability'].includes(q.type))
        q.written.push({
          name: row.name,
          email: row.email,
          value: answer.value,
        });
      else if (answer.other)
        q.written.push({
          name: row.name,
          email: row.email,
          value: answer.other,
        });
    }
  }
  for (const group of groups.values())
    for (const q of group.questions)
      for (const c of q.choices)
        c.percent = q.answered
          ? Math.round((c.count / q.answered) * 1000) / 10
          : 0;
  return { total: rows.length, groups: [...groups.values()] };
}
export function responsesCSV(rows) {
  const questions = new Map();
  for (const row of rows)
    for (const q of row.questions)
      questions.set(row.survey_version + ':' + q.id, {
        ...q,
        version: row.survey_version,
      });
  const columns = [...questions.values()].flatMap((q) => [
    { question: q, option: null },
    ...(['multiple', 'availability'].includes(q.type)
      ? (q.type === 'availability' ? availabilityColumns(q) : q.options).map(
          (option) => ({ question: q, option }),
        )
      : []),
  ]);
  const header = [
    'Event',
    'Event date',
    'Response type',
    'Survey',
    'Name',
    'Email',
    'Received (UTC)',
    'Starred',
    'Archived',
    'Attendance',
    'Feedback status',
    'Feedback surveys submitted',
    'Linked feedback surveys',
    'Question version',
    ...columns.map(
      ({ question: q, option }) =>
        (q.choiceDate ? q.choiceDate + ' · ' : '') +
        (option === null ? q.label : q.label + ' — ' + option) +
        ' [' +
        q.version.slice(0, 8) +
        ']',
    ),
  ];
  const lines = rows.map((row) => [
    row.event_title,
    row.event_date || 'TBD',
    row.response_type || 'rsvp',
    row.survey_title || 'RSVP',
    row.name,
    row.email,
    new Date(row.created_at).toISOString(),
    row.starred ? 'Yes' : 'No',
    row.archived_at ? 'Yes' : 'No',
    row.attendance || 'not_recorded',
    row.feedback_status || 'no_survey',
    row.feedback_submitted_count || 0,
    row.feedback_survey_count || 0,
    row.survey_version,
    ...columns.map(({ question: q, option }) => {
      if (q.version !== row.survey_version) return '';
      const answer = row.answers.find((a) => a.questionId === q.id);
      if (option === null) return answerValues(answer).join('; ');
      if (q.type === 'availability')
        return answer?.value
          ? availabilityValues(answer.value).includes(option)
            ? 'Yes'
            : 'No'
          : '';
      if (!answer?.value?.length) return '';
      const selected = answer.value.includes(option);
      return selected
        ? 'Yes'
        : impliedChoice(q, answer.value, option)
          ? 'Yes (Any of these)'
          : 'No';
    }),
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
