// Synthetic saved responses shaped like real ones, for the PDF and CSV
// downloads. Both kinds pass the submission checks, so they have exactly the
// stored shape: rankings, dials, chosen options, resource offers, free text.
import { randomUUID } from 'node:crypto';
import { canonicalResponse } from '../../lib/survey-contract.mjs';
import {
  FORM_VERSION,
  validateFormResponse,
} from '../../lib/survey-builder.mjs';
const structured = (fields) =>
  canonicalResponse({
    kind: 'question',
    mode: 'structured',
    wordingReviewed: true,
    included: true,
    customOptions: [],
    ...fields,
  });
const ideal = Array.from(
  { length: 6 },
  (_, n) =>
    `Paragraph ${n + 1}: a monthly check-in, a review of student prototypes before showcases, and introductions to people who can give honest feedback on real problems. Students would lead; I would ask the questions that sharpen their thinking.`,
).join('\n');
export const advisorResponses = () => [
  structured({
    id: 'q-spark',
    questionId: 'spark',
    text: '1. Build or review an AI prototype together\n2. Shape a project around a useful real-world problem / Help students explain and evaluate what they built (tied)',
    answer: { mode: 'rank', groups: [['build'], ['useful', 'learning']] },
  }),
  canonicalResponse({
    id: 'note-spark',
    kind: 'comment',
    pageId: 'spark',
    mode: 'narrative',
    wordingReviewed: true,
    included: true,
    text: '=SUM(A1) is how a formula starts — I’d like students to “show their work”… 🎉 The best sessions felt like a café conversation → then a build. 한국어',
  }),
  structured({
    id: 'q-concerns',
    questionId: 'concerns',
    text: '1. Struggling to find entry-level opportunities or show their abilities\n2. Relying on AI without building understanding or judgment',
    answer: { mode: 'rank', groups: [['opportunity'], ['foundations']] },
  }),
  structured({
    id: 'focus-opportunity',
    kind: 'concern',
    questionId: 'concern_focus',
    optionId: 'opportunity',
    text: 'Slightly favoring: A main focus of my contribution',
    answer: { mode: 'value', value: 65 },
  }),
  structured({
    id: 'q-new_team',
    questionId: 'new_team',
    text: 'More emphasis on: Coach through questions and student-led attempts',
    answer: { mode: 'value', value: 30 },
  }),
  structured({
    id: 'q-busy_route',
    questionId: 'busy_route',
    text: 'An officer can message me directly on Teams\nAn officer can email me directly',
    answer: { values: ['teams', 'email'] },
  }),
  structured({
    id: 'resource-expertise',
    kind: 'resource',
    questionId: 'resources',
    optionId: 'expertise',
    text: 'Could help directly, within my remit',
    answer: { status: 'direct' },
  }),
  structured({
    id: 'q-ideal_responsibilities',
    questionId: 'ideal_responsibilities',
    text: ideal,
    answer: { text: ideal },
  }),
];
// A published builder survey: text, single, multiple and rating questions,
// with the optional last question left unanswered.
export function builderSample() {
  const question = (title, type, options = [], required = true) => ({
    id: randomUUID(),
    title,
    description: '',
    type,
    required,
    options,
  });
  const definition = {
    template: 'blank',
    title: 'Workshop feedback sample',
    intro: '',
    audience: 'public',
    durationDays: 30,
    permissions: { preview: 'link', answer: 'verified', results: 'admins' },
    questions: [
      question('What worked well?', 'text'),
      question('Which format suits you?', 'single', ['In person', 'Online']),
      question('Which topics should we cover?', 'multiple', [
        'Prompting',
        'Evaluation',
        'Agents',
      ]),
      question('How useful was it?', 'scale'),
      question('Anything else?', 'text', [], false),
    ],
  };
  const answers = (text) =>
    validateFormResponse(
      {
        requestId: randomUUID(),
        expectedRevision: 0,
        contentVersion: FORM_VERSION,
        advisorId: 'sample',
        consent: 'admins',
        answers: [
          { id: definition.questions[0].id, value: text },
          { id: definition.questions[1].id, value: 1 },
          { id: definition.questions[2].id, value: [0, 2] },
          { id: definition.questions[3].id, value: 4 },
        ],
      },
      { definition },
      { advisor_id: 'sample' },
    );
  return { definition, answers };
}
