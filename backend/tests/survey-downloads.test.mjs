import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/custom-survey-fixture.mjs';
import {
  advisorResponses,
  builderSample,
} from './helpers/survey-response-samples.mjs';
import { pdfLines } from './helpers/pdf-text.mjs';
import { definition } from '../lib/survey-contract.mjs';
import { changeDraft } from '../lib/survey-builder.mjs';
import {
  responseDocument,
  responseFilename,
} from '../admin/response-document.js';
import { responsePdf, pdfText } from '../admin/response-pdf.js';
let f, server, origin;
const officer = 'test-officer=yes';
const get = (params, cookie = officer) =>
  fetch(origin + '/api/custom-surveys?' + new URLSearchParams(params), {
    headers: cookie ? { Cookie: cookie } : {},
  });
// Every cell is quoted by csvCell.
const parseCSV = (text) =>
  text
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n')
    .map((line) =>
      [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) =>
        m[1].replaceAll('""', '"'),
      ),
    );
const audits = async (prefix) =>
  (
    await f.db.query(
      'SELECT actor,action FROM club_forms.audit WHERE action LIKE $1 ORDER BY id',
      [prefix + '%'],
    )
  ).rows;
async function respondent(surveyId, id, name, responses, active = true) {
  await f.db.query(
    'INSERT INTO club_forms.custom_survey_members(survey_id,advisor_id,display_name,email,active) VALUES($1,$2,$3,$4,$5)',
    [surveyId, id, name, id + '@example.com', active],
  );
  await f.db.query(
    'INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses,submitted_at) VALUES($1,$2,1,$3,$4)',
    [surveyId, id, JSON.stringify(responses), '2026-10-03T03:30:00Z'],
  );
}
before(async () => {
  f = await fixture();
  server = http.createServer(f.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = 'http://127.0.0.1:' + server.address().port;
  process.env.AUTH_BASE_URL = origin;
  await respondent(f.id, 'avery', 'Avery Sample', advisorResponses());
  await respondent(f.id, 'formula', '=HYPERLINK("http://x")', [
    advisorResponses()[1],
  ]);
  await respondent(
    f.id,
    'removed',
    'Removed Respondent',
    advisorResponses(),
    false,
  );
});
after(async () => {
  await new Promise((r) => server.close(r));
  await f.db.close();
});
test('Advisor Studio CSV: active respondents, survey order, answers as on screen, formula protection and an audit row', async () => {
  const response = await get({ action: 'export', id: f.id });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(
    response.headers.get('content-disposition'),
    /^attachment; filename="advisor-studio-responses-\d{4}-\d{2}-\d{2}\.csv"$/,
  );
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  // A UTF-8 byte order mark, as in the event survey export, for Excel.
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
  const [header, ...rows] = parseCSV(bytes.toString('utf8'));
  assert.deepEqual(header, [
    'Name',
    'Email',
    'Submitted (Central)',
    'Status',
    'What would you actually look forward to?',
    'My thoughts — Find your sparks',
    'What most concerns you about students’ futures?',
    'How I would like to help — Struggling to find entry-level opportunities or show their abilities',
    'When your week gets busy, how should an officer check availability?',
    'Students are building their first AI prototype. How would you help?',
    'Possible resource — Guest speakers, specialist feedback, or mentors',
    'What would your ideal responsibilities in this club look like?',
  ]);
  // Archived (removed) respondents stay out, as on the results screen.
  assert.deepEqual(rows.map((row) => row[0]).sort(), [
    '\'=HYPERLINK("http://x")',
    'Avery Sample',
  ]);
  const avery = rows.find((row) => row[0] === 'Avery Sample');
  assert.equal(avery[1], 'avery@example.com');
  assert.match(avery[2], /^Oct 2, 2026, 10:30:00\sPM CDT$/);
  assert.equal(avery[3], 'Active');
  assert.equal(
    avery[4],
    '1. Build or review an AI prototype together 2. Shape a project around a useful real-world problem / Help students explain and evaluate what they built (tied)',
  );
  // Free text that looks like a formula is neutralised.
  assert.match(avery[5], /^'=SUM\(A1\) is how a formula starts — /);
  assert.equal(
    avery[7],
    '65 of 100 — Slightly favoring: A main focus of my contribution',
  );
  assert.equal(
    avery[8],
    'An officer can message me directly on Teams; An officer can email me directly',
  );
  assert.equal(avery[10], 'Could help directly, within my remit');
  assert.doesNotMatch(avery[11], /[\r\n]/);
  assert.equal(rows.find((row) => row[0] !== 'Avery Sample')[4], '');
  assert.deepEqual(await audits('custom-survey-export-csv:'), [
    {
      actor: 'officer@example.com',
      action: 'custom-survey-export-csv:' + f.id,
    },
  ]);
});
test('builder survey CSV lists every question in order, including unanswered ones', async () => {
  const id = randomUUID(),
    sample = builderSample();
  for (const [action, expectedRevision] of [
    ['save', 0],
    ['publish', 1],
  ])
    await changeDraft(
      f.db,
      { email: 'officer@example.com' },
      {
        id,
        definition: sample.definition,
        action,
        expectedRevision,
        requestId: randomUUID(),
      },
    );
  await respondent(id, 'jordan', 'Jordan Example', sample.answers('Clear'));
  const response = await get({ action: 'export', id });
  assert.match(
    response.headers.get('content-disposition'),
    /filename="workshop-feedback-sample-responses-\d{4}-\d{2}-\d{2}\.csv"/,
  );
  const [header, row] = parseCSV(await response.text());
  assert.deepEqual(header.slice(4), [
    'What worked well?',
    'Which format suits you?',
    'Which topics should we cover?',
    'How useful was it?',
    'Anything else?',
  ]);
  assert.deepEqual(row.slice(3), [
    'Active',
    'Clear',
    'Online',
    'Prompting; Agents',
    '4 / 5',
    '',
  ]);
});
test('only signed-in officers can export or record a PDF download', async () => {
  const before = (await audits('custom-survey-')).length;
  // No session, and a respondent's survey device, are both refused.
  assert.equal((await get({ action: 'export', id: f.id }, null)).status, 401);
  assert.equal(
    (await get({ action: 'export', id: f.id }, 'test-neon=pearlman')).status,
    401,
  );
  const post = (body, cookie = officer, extra = {}) =>
    fetch(origin + '/api/custom-surveys?action=response-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...extra,
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ id: f.id }, null)).status, 401);
  assert.equal((await post({ id: 'not-a-survey' })).status, 400);
  assert.equal(
    (await post({ id: f.id }, officer, { Origin: 'https://evil.example' }))
      .status,
    403,
  );
  assert.equal((await get({ action: 'response-pdf', id: f.id })).status, 405);
  assert.equal((await get({ action: 'export', id: randomUUID() })).status, 404);
  assert.equal((await audits('custom-survey-')).length, before);
  const response = await post({ id: f.id });
  assert.equal(response.status, 200);
  assert.deepEqual((await audits('custom-survey-pdf:')).at(-1), {
    actor: 'officer@example.com',
    action: 'custom-survey-pdf:' + f.id,
  });
});
test('the PDF document reads like the results screen', () => {
  const result = {
    display_name: 'Avery Sample',
    email: 'avery@example.com',
    submitted_at: '2026-10-03T03:30:00Z',
    responses: advisorResponses(),
  };
  const model = responseDocument(result, {
    title: 'Advisor Studio',
    definition,
  });
  assert.equal(model.club, 'Dallas College AI Club');
  assert.deepEqual(model.details, [
    ['Respondent', 'Avery Sample'],
    ['Email', 'avery@example.com'],
    ['Submitted', 'Fri, Oct 2, 2026, 10:30 PM CT'],
    ['Answers', '8'],
  ]);
  assert.deepEqual(
    model.blocks.map((b) => b.heading || b.kind),
    [
      'Find your sparks',
      'ranked',
      'text',
      'Give students a better next step',
      'ranked',
      'text',
      'choices',
      'Dial in your working style',
      'text',
      'Make it possible',
      'text',
      'Your playbook, in your words',
      'text',
    ],
  );
  const block = (title) =>
    model.blocks.find((b) => b.question?.startsWith(title));
  assert.deepEqual(block('My thoughts').notes, ['Shared wording only']);
  assert.deepEqual(block('How I would like to help').notes, [
    'Dial position: 65 of 100.',
  ]);
  assert.equal(block('What would your ideal').lines.length, 6);
  assert.equal(
    responseFilename('Advisor Studio — Fall Round', result),
    'advisor-studio-fall-round-avery-sample-2026-10-02.pdf',
  );
  assert.equal(
    responseFilename('', { ...result, display_name: '한국' }),
    'custom-survey-respondent-2026-10-02.pdf',
  );
  const sample = builderSample();
  const builder = responseDocument(
    {
      display_name: 'Jordan Example',
      email: 'jordan@example.com',
      submitted_at: '2026-10-01T15:00:00Z',
      responses: sample.answers('Clear'),
    },
    { title: 'Workshop feedback sample', definition: sample.definition },
  );
  assert.deepEqual(
    builder.blocks.map((b) => [b.question, b.kind, b.lines.join(' | ')]),
    [
      ['What worked well?', 'text', 'Clear'],
      ['Which format suits you?', 'text', 'Online'],
      ['Which topics should we cover?', 'choices', 'Prompting | Agents'],
      ['How useful was it?', 'text', '4 / 5'],
      ['Anything else?', 'none', 'No answer'],
    ],
  );
});
test('the PDF is a real, paged file in the built-in font', () => {
  // Common punctuation survives; emoji and unsupported scripts do not
  // garble the line around them.
  assert.equal(pdfText('— – ‘ ’ “ ” · • … café €'), '— – ‘ ’ “ ” · • … café €');
  assert.equal(pdfText('Great 🎉 👍🏽 work'), 'Great ? ? work');
  assert.equal(pdfText('→ ≥ Ősz 한'), '-> >= Osz ?');
  const model = responseDocument(
    {
      display_name: 'Avery Sample',
      email: 'avery@example.com',
      submitted_at: '2026-10-03T03:30:00Z',
      responses: advisorResponses(),
    },
    { title: 'Advisor Studio', definition },
  );
  const bytes = Buffer.from(responsePdf(model).output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const lines = pdfLines(bytes);
  for (const text of [
    'Dallas College AI Club',
    'Avery Sample',
    'Fri, Oct 2, 2026, 10:30 PM CT',
    'Find your sparks',
    '1.',
    'Build or review an AI prototype together',
    '•',
    'An officer can email me directly',
    'Dial position: 65 of 100.',
    'Page 1 of 2',
    'Page 2 of 2',
  ])
    assert.ok(lines.includes(text), text);
  assert.ok(lines.some((line) => line.includes('“show their work”… ?')));
  // Long text wraps inside the margins instead of running off the page.
  const wide = responsePdf({
    ...model,
    blocks: [
      {
        question: 'Long',
        kind: 'text',
        lines: [
          'https://example.com/' + 'x'.repeat(300) + ' ' + 'word '.repeat(80),
        ],
        notes: [],
      },
    ],
  });
  wide.setFont('helvetica', 'normal').setFontSize(10.5);
  const drawn = pdfLines(Buffer.from(wide.output('arraybuffer')));
  assert.ok(drawn.length > 8);
  for (const line of drawn)
    assert.ok(wide.getTextWidth(line) <= 612 - 2 * 60 + 0.5, line);
});
test('page breaks never leave a heading or question title at the foot of a page', () => {
  const kept = ['Next chapter', 'Kept question', 'Second kept question'];
  // Shift the content a line at a time, so a page break falls in every place.
  for (let filler = 0; filler < 48; filler++) {
    const lines = pdfLines(
      Buffer.from(
        responsePdf({
          club: 'Dallas College AI Club',
          title: 'Page break check',
          details: [['Respondent', 'Avery Sample']],
          blocks: [
            {
              question: 'Filler',
              kind: 'text',
              lines: Array(filler).fill('Line'),
              notes: [],
            },
            { heading: kept[0] },
            {
              question: kept[1],
              kind: 'ranked',
              lines: ['1. First', '2. Second'],
              notes: [],
            },
            {
              question: kept[2],
              kind: 'choices',
              lines: ['One', 'Two'],
              notes: [],
            },
          ],
        }).output('arraybuffer'),
      ),
    );
    // Each page ends with its footer: a label, then 'Page N of M'.
    lines.forEach((line, i) => {
      if (/^Page \d+ of \d+$/.test(line))
        assert.ok(!kept.includes(lines[i - 2]), `${filler}: ${lines[i - 2]}`);
    });
  }
});
