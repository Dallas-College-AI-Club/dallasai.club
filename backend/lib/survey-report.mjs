import { csvCell } from './submission-export.mjs';
import { RequestError } from './errors.mjs';
import { responseFilter, responseSelect } from './survey-management.mjs';
export const answerValues = (answer) =>
  (Array.isArray(answer?.value) ? answer.value : [answer?.value || ''])
    .filter(Boolean)
    .map((value) => (value === '__other__' ? 'Other: ' + answer.other : value));
export async function reportRows(db, filter) {
  const { where, values } = responseFilter(filter);
  // Never silently export or summarize only the visible page.
  const rows = (
    await db.query(
      `${responseSelect} ${where} ORDER BY s.created_at DESC,s.entry_id LIMIT 10001`,
      values,
    )
  ).rows;
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
        count: 0,
        questions: row.questions.map((q) => ({
          ...q,
          answered: 0,
          skipped: 0,
          choices: [...q.options, ...(q.allowOther ? ['__other__'] : [])].map(
            (value) => ({
              value,
              label: value === '__other__' ? 'Other' : value,
              count: 0,
            }),
          ),
          written: [],
        })),
      });
    const group = groups.get(key);
    group.count++;
    for (const q of group.questions) {
      const answer = row.answers.find((a) => a.questionId === q.id);
      const values = Array.isArray(answer?.value)
        ? answer.value
        : [answer?.value || ''];
      if (!values.some(Boolean)) {
        q.skipped++;
        continue;
      }
      q.answered++;
      for (const choice of q.choices)
        if (values.includes(choice.value)) choice.count++;
      if (q.type === 'text')
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
  const columns = [...questions.values()].flatMap(q=>[
    {question:q, option:null},
    ...(q.type==='multiple'?q.options.map(option=>({question:q,option})):[]),
  ]);
  const header = [
    'Event',
    'Event date',
    'Name',
    'Email',
    'Received (UTC)',
    'Starred',
    'Archived',
    'Question version',
    ...columns.map(({question:q,option}) => (option===null?q.label:q.label+' — '+option) + ' [' + q.version.slice(0, 8) + ']'),
  ];
  const lines = rows.map((row) => [
    row.event_title,
    row.event_date || 'TBD',
    row.name,
    row.email,
    new Date(row.created_at).toISOString(),
    row.starred ? 'Yes' : 'No',
    row.archived_at ? 'Yes' : 'No',
    row.survey_version,
    ...columns.map(({question:q,option}) => {
      if(q.version!==row.survey_version)return '';
      const answer=row.answers.find(a=>a.questionId===q.id);
      if(option===null)return answerValues(answer).join('; ');
      if(!answer?.value?.length)return '';
      const selected=answer.value.includes(option);
      const any=answer.value.includes('Any of these');
      const individual=option!=='Any of these'&&!/^(none\b|not sure\b)/i.test(option);
      return selected?'Yes':any&&individual?'Yes (Any of these)':'No';
    }),
  ]);
  return (
    '\uFEFF' +
    [header, ...lines].map((line) => line.map(value=>csvCell(String(value??'').replace(/[\r\n]+/g,' '))).join(',')).join('\r\n') +
    '\r\n'
  );
}
