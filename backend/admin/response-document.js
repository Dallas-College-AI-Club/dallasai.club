// One respondent's saved answers as a document for the PDF download. Pure
// (no DOM), so node --test covers it; response-pdf.js lays it out.
import { answerFormat, answerRank, fileSlug } from '../surveys/results-ui.js';
import { fullDateTime, isoDay } from './format.js';
// Chapter headings and questions follow the survey, and answers read as on
// screen. A builder question the respondent skipped says 'No answer'.
export function responseDocument(result, { title, definition }) {
  const rank = answerRank(definition),
    chapters = definition?.chapters || [],
    answers = [...result.responses];
  if (!chapters.length)
    for (const q of definition?.questions || [])
      if (!answers.some((a) => a.id === q.id))
        answers.push({ id: q.id, title: q.title });
  const blocks = [];
  let lastGroup;
  for (const answer of answers.sort((a, b) => rank(a) - rank(b))) {
    const chapter = chapters.find((c) => c.id === answer.group);
    if (chapter && lastGroup !== chapter.id) {
      blocks.push({ heading: chapter.title });
      lastGroup = chapter.id;
    }
    const { kind, lines, dial } = answerFormat(answer, definition);
    blocks.push({
      question: answer.title,
      kind: lines.length ? kind : 'none',
      lines: lines.length ? lines : ['No answer'],
      notes: [
        ...(answer.mode === 'narrative' ? ['Shared wording only'] : []),
        ...(dial === undefined ? [] : [`Dial position: ${dial} of 100.`]),
      ],
    });
  }
  return {
    club: 'Dallas College AI Club',
    title,
    details: [
      ['Respondent', result.display_name || result.email],
      ['Email', result.email],
      ['Submitted', fullDateTime(result.submitted_at)],
      ['Answers', String(result.responses.length)],
    ],
    blocks,
  };
}
// <survey>-<respondent>-<Central submission day>.pdf
export const responseFilename = (title, result) =>
  [
    fileSlug(title) || 'custom-survey',
    fileSlug(result.display_name) || 'respondent',
    isoDay(result.submitted_at),
  ].join('-') + '.pdf';
