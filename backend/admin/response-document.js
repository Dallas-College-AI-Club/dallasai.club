// One respondent's saved answers as a document for the PDF download and the
// print view. Pure (no DOM), so node --test covers it; response-pdf.js lays
// it out as a PDF and response-download.js as a page to print.
import { answerFormat, answerRank, fileSlug } from '../surveys/results-ui.js';
import { fullDateTime, isoDay } from './format.js';
// Chapter headings and questions follow the survey, and answers read as on
// screen. A builder question the respondent skipped says 'No answer'. The
// title is the officer's chosen heading.
export function responseDocument(result, { title, definition }) {
  definition = result.response_definition || definition;
  const rank = answerRank(definition),
    chapters = definition?.chapters || [],
    answers = [...result.responses];
  if (!chapters.length)
    for (const q of definition?.questions || [])
      if (!answers.some((a) => a.id === q.id))
        answers.push({
          id: q.id,
          title: (q.choiceDate ? q.choiceDate + ' · ' : '') + q.title,
        });
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
// Helvetica, built into every PDF reader, has Windows-1252 glyphs only, and
// jsPDF garbles a whole line that contains anything else. A few symbols get
// an ASCII spelling, emoji are left out, accented letters lose the accent,
// and anything else becomes '?'.
const supported = /[\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/,
  spelled = {
    '→': '->',
    '←': '<-',
    '↔': '<->',
    '≥': '>=',
    '≤': '<=',
    '≠': '!=',
    '−': '-',
    '‐': '-',
    '‑': '-',
    '‒': '–',
    '―': '—',
    '′': "'",
    '″': '"',
    '✓': 'v',
    '✔': 'v',
    '‼': '!!',
  },
  // An emoji with its modifiers, joined parts or flag letters, and the space
  // on either side, so 'Great 🎉 work' reads 'Great work'.
  emoji =
    /( ?)(\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\u200d\p{Extended_Pictographic})*|\p{Regional_Indicator}+)( ?)/gu;
export const pdfText = (text) =>
  Array.from(
    Array.from(
      String(text ?? '').replace(/[\r\u200b\u200c\u2060\ufe0e\ufe0f]/g, ''),
      (c) => spelled[c] ?? c,
    )
      .join('')
      .replace(emoji, (all, before, symbol, after) =>
        supported.test(symbol) ? all : before && after ? ' ' : '',
      ),
    (c) => {
      if (supported.test(c)) return c;
      if (/\s/.test(c)) return ' ';
      const plain = c.normalize('NFKD').replace(/\p{M}/gu, '');
      return plain && [...plain].every((p) => supported.test(p)) ? plain : '?';
    },
  ).join('');
// True when the PDF font cannot show something in text, e.g. a name in
// another script; Print / Save as PDF keeps it.
export const pdfMissing = (text) =>
  pdfText(String(text).replaceAll('?', '')).includes('?');
// The document with every text passed through pdfText(), ready for jsPDF.
export const pdfReady = (model) =>
  JSON.parse(JSON.stringify(model), (key, value) =>
    typeof value === 'string' ? pdfText(value) : value,
  );
