import { createHmac } from 'node:crypto';
import { RequestError } from './errors.mjs';
import { digest, privateSurveyToken } from './custom-surveys.mjs';
export const FORM_VERSION = 'custom-form/1';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const invalid = (message) => {
  throw new RequestError(400, message);
};
function object(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    invalid('Check the survey settings.');
}
function text(value, max, empty = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    invalid('Check the survey text and length.');
  return value.trim();
}
export function validateDefinition(input, publishing = false) {
  object(input, [
    'template',
    'title',
    'intro',
    'audience',
    'permissions',
    'durationDays',
    'questions',
  ]);
  if (!['blank', 'feedback'].includes(input.template))
    invalid('Choose a template.');
  if (
    !['students', 'staff', 'public', 'officers', 'advisors'].includes(
      input.audience,
    )
  )
    invalid('Choose a target audience.');
  object(input.permissions, ['preview', 'answer', 'results']);
  const p = input.permissions;
  if (
    !['link', 'respondents'].includes(p.preview) ||
    !['invited', 'verified'].includes(p.answer) ||
    !['admins', 'respondents'].includes(p.results)
  )
    invalid('Choose the preview, answering, and results permissions.');
  if (p.answer === 'verified' && input.audience !== 'public')
    invalid('Use approved respondents for a restricted audience.');
  if (
    !Number.isInteger(input.durationDays) ||
    input.durationDays < 1 ||
    input.durationDays > 90
  )
    invalid('Choose an expiration from 1 to 90 days after publishing.');
  if (
    !Array.isArray(input.questions) ||
    input.questions.length > 30 ||
    (publishing && !input.questions.length)
  )
    invalid('Add between 1 and 30 questions before publishing.');
  const ids = new Set();
  const questions = input.questions.map((q) => {
    object(q, ['id', 'title', 'description', 'type', 'required', 'options']);
    if (!uuid.test(q.id) || ids.has(q.id))
      invalid('Each question needs a unique reference.');
    ids.add(q.id);
    if (
      !['text', 'single', 'multiple', 'scale'].includes(q.type) ||
      typeof q.required !== 'boolean' ||
      !Array.isArray(q.options)
    )
      invalid('Choose a supported question type.');
    const choice = ['single', 'multiple'].includes(q.type);
    if (
      q.options.length > 12 ||
      (!choice && q.options.length) ||
      (publishing && choice && q.options.length < 2)
    )
      invalid('Choice questions need 2 to 12 options.');
    const options = q.options.map((o) => text(o, 120, !publishing));
    if (
      publishing &&
      new Set(options.map((o) => o.toLowerCase())).size !== options.length
    )
      invalid('Each choice must be different.');
    return {
      id: q.id,
      title: text(q.title, 300, !publishing),
      description: text(q.description, 1000, true),
      type: q.type,
      required: q.required,
      options,
    };
  });
  return {
    template: input.template,
    title: text(input.title, 160),
    intro: text(input.intro, 3000, true),
    audience: input.audience,
    permissions: { preview: p.preview, answer: p.answer, results: p.results },
    durationDays: input.durationDays,
    questions,
  };
}
export function previewToken(id) {
  privateSurveyToken(id); // Validate the shared configuration before deriving a separate preview capability.
  return createHmac('sha256', process.env.FORM_TOKEN_SECRET)
    .update('custom-survey-preview:' + id)
    .digest('base64url');
}
export function builderLinks(survey) {
  const origin = process.env.AUTH_BASE_URL;
  return {
    previewLink:
      survey.definition &&
      ['draft', 'open'].includes(survey.status) &&
      new Date(survey.expires_at) > new Date()
        ? new URL('/surveys/#preview=' + previewToken(survey.id), origin).href
        : null,
    privateLink:
      survey.status === 'open' && new Date(survey.expires_at) > new Date()
        ? new URL('/surveys/#invite=' + privateSurveyToken(survey.id), origin)
            .href
        : null,
  };
}
export async function getDraft(db, id) {
  if (!uuid.test(id || '')) invalid('Choose a survey.');
  const survey = (
    await db.query('SELECT * FROM club_forms.custom_surveys WHERE id=$1', [id])
  ).rows[0];
  if (!survey) throw new RequestError(404, 'Survey not found.');
  return {
    ...survey,
    ...builderLinks(survey),
    activity: (
      await db.query(
        'SELECT action,actor_email,created_at FROM club_forms.custom_survey_changes WHERE survey_id=$1 ORDER BY revision DESC LIMIT 100',
        [id],
      )
    ).rows,
  };
}
export async function changeDraft(db, actor, body) {
  object(body, ['id', 'requestId', 'expectedRevision', 'action', 'definition']);
  if (
    !uuid.test(body.id) ||
    !uuid.test(body.requestId) ||
    !Number.isInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    !['save', 'publish', 'close'].includes(body.action)
  )
    invalid('Check the survey change.');
  const definition = validateDefinition(
    body.definition,
    body.action === 'publish',
  );
  const signature = digest(
    JSON.stringify([
      body.id,
      body.action,
      body.expectedRevision,
      definition,
      actor.email,
    ]),
  );
  return db.transaction(async (tx) => {
    // Lock by id even for a new draft, so a retry cannot create competing rows.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [body.id]);
    const row = (
      await tx.query(
        'SELECT * FROM club_forms.custom_surveys WHERE id=$1 FOR UPDATE',
        [body.id],
      )
    ).rows[0];
    const receipt = (
      await tx.query(
        'SELECT * FROM club_forms.custom_survey_changes WHERE id=$1',
        [body.requestId],
      )
    ).rows[0];
    if (receipt) {
      if (receipt.request_digest !== signature)
        throw new RequestError(
          409,
          'This change reference was already used. Reload the survey.',
        );
      return { id: body.id, revision: receipt.revision };
    }
    if ((row?.edit_revision || 0) !== body.expectedRevision)
      throw new RequestError(
        409,
        'Another admin changed this survey. Reload before saving.',
      );
    if (row && !row.definition)
      throw new RequestError(
        409,
        'Use respondent management for the original Advisor Studio survey.',
      );
    if (body.action === 'close') {
      if (row?.status !== 'open')
        throw new RequestError(409, 'Only an open survey can be closed.');
      if (JSON.stringify(row.definition) !== JSON.stringify(definition)) {
        // jsonb key order is not significant; closed surveys always keep their saved definition.
        const stored = validateDefinition(row.definition);
        if (JSON.stringify(stored) !== JSON.stringify(definition))
          throw new RequestError(
            409,
            'Reload the published survey before closing it.',
          );
      }
    } else if (row && row.status !== 'draft')
      throw new RequestError(
        409,
        'Published questions and permissions are fixed. Create a new survey to change them.',
      );
    if (body.action === 'publish' && !row)
      throw new RequestError(
        400,
        'Save and preview the draft before publishing.',
      );
    if (
      body.action === 'publish' &&
      definition.permissions.answer === 'invited' &&
      !(
        await tx.query(
          'SELECT advisor_id FROM club_forms.custom_survey_members WHERE survey_id=$1 AND active LIMIT 1',
          [body.id],
        )
      ).rows.length
    )
      invalid('Add at least one approved respondent before publishing.');
    const revision = body.expectedRevision + 1;
    if (!row)
      await tx.query(
        `INSERT INTO club_forms.custom_surveys(id,slug,title,content_version,status,link_digest,preview_digest,expires_at,definition,edit_revision) VALUES($1,$2,$3,$4,'draft',$5,$6,now()+interval '30 days',$7,$8)`,
        [
          body.id,
          'custom-' + body.id,
          definition.title,
          FORM_VERSION,
          digest(privateSurveyToken(body.id)),
          digest(previewToken(body.id)),
          JSON.stringify(definition),
          revision,
        ],
      );
    else if (body.action === 'save')
      await tx.query(
        "UPDATE club_forms.custom_surveys SET title=$2,definition=$3,edit_revision=$4,expires_at=now()+interval '30 days' WHERE id=$1",
        [body.id, definition.title, JSON.stringify(definition), revision],
      );
    else if (body.action === 'publish') {
      // Publish only the exact saved and previewed definition.
      if (
        JSON.stringify(validateDefinition(row.definition)) !==
        JSON.stringify(definition)
      )
        throw new RequestError(
          409,
          'Save and preview your latest changes before publishing.',
        );
      await tx.query(
        `UPDATE club_forms.custom_surveys SET status='open',published_at=now(),expires_at=now()+($2::int*interval '1 day'),edit_revision=$3 WHERE id=$1`,
        [body.id, definition.durationDays, revision],
      );
    } else
      await tx.query(
        "UPDATE club_forms.custom_surveys SET status='closed',edit_revision=$2 WHERE id=$1",
        [body.id, revision],
      );
    await tx.query(
      'INSERT INTO club_forms.custom_survey_changes(id,survey_id,action,actor_email,revision,request_digest) VALUES($1,$2,$3,$4,$5,$6)',
      [
        body.requestId,
        body.id,
        { save: 'draft_saved', publish: 'published', close: 'closed' }[
          body.action
        ],
        actor.email,
        revision,
        signature,
      ],
    );
    return { id: body.id, revision };
  });
}
export function validateFormResponse(body, survey, member) {
  object(body, [
    'requestId',
    'expectedRevision',
    'contentVersion',
    'advisorId',
    'consent',
    'answers',
  ]);
  if (
    !uuid.test(body.requestId) ||
    !Number.isInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    body.contentVersion !== FORM_VERSION ||
    body.advisorId !== member.advisor_id ||
    body.consent !== survey.definition.permissions.results ||
    !Array.isArray(body.answers)
  )
    invalid('Review your answers and sharing permission before submitting.');
  const answers = new Map();
  for (const a of body.answers) {
    object(a, ['id', 'value']);
    if (answers.has(a.id)) invalid('Each question can be answered once.');
    answers.set(a.id, a.value);
  }
  if (
    [...answers.keys()].some(
      (id) => !survey.definition.questions.some((q) => q.id === id),
    )
  )
    invalid('An answer does not belong to this survey.');
  const result = [];
  for (const q of survey.definition.questions) {
    let value = answers.get(q.id);
    if (
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && !value.length)
    ) {
      if (q.required) invalid('Answer the required question: ' + q.title);
      continue;
    }
    let answerText;
    if (q.type === 'text') {
      value = text(value, 5000);
      answerText = value;
    } else if (q.type === 'scale') {
      if (!Number.isInteger(value) || value < 1 || value > 5)
        invalid('Choose a rating from 1 to 5.');
      answerText = value + ' / 5';
    } else {
      const values = q.type === 'single' ? [value] : value;
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.length > q.options.length ||
        new Set(values).size !== values.length ||
        values.some(
          (v) => !Number.isInteger(v) || v < 0 || v >= q.options.length,
        )
      )
        invalid('Choose a listed option.');
      answerText = values.map((v) => q.options[v]).join('\n');
    }
    result.push({
      id: q.id,
      title: q.title,
      mode: 'form',
      text: answerText,
      value,
    });
  }
  return result;
}
