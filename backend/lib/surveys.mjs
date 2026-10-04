import {
  responseFilter,
  responseSelect,
  responseFrom,
} from './survey-management.mjs';
import { createHash } from 'node:crypto';
import { RequestError } from './errors.mjs';
import { exclusiveSurveyChoice } from './event-format.mjs';
import { email, isCalendarDate } from './validation.mjs';
import {
  availabilityDates,
  validateAvailability,
} from './survey-availability.mjs';
const questionId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function text(value, label, max, required = false) {
  if (value === undefined) value = '';
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) ||
    (required && !value.trim())
  )
    throw new RequestError(400, 'Check ' + label + '.');
  return value.trim();
}
export function surveyQuestions(input = []) {
  if (!Array.isArray(input) || input.length > 20)
    throw new RequestError(400, 'Use up to 20 RSVP questions.');
  const ids = new Set();
  return input.map((question) => {
    if (
      !question ||
      !questionId.test(question.id || '') ||
      ids.has(question.id)
    )
      throw new RequestError(
        400,
        'Each RSVP question needs a unique identifier.',
      );
    ids.add(question.id);
    if (
      ![
        'text',
        'short',
        'single',
        'multiple',
        'date',
        'time',
        'number',
        'email',
        'availability',
      ].includes(question.type)
    )
      throw new RequestError(400, 'Choose a valid question type.');
    if (
      typeof question.required !== 'boolean' ||
      typeof question.allowOther !== 'boolean'
    )
      throw new RequestError(400, 'Check the RSVP question settings.');
    const choices = ['single', 'multiple'].includes(question.type);
    const availability = question.type === 'availability';
    if (
      question.choiceDate !== undefined &&
      (!choices || !isCalendarDate(question.choiceDate))
    )
      throw new RequestError(400, 'Choose a valid date for these choices.');
    if (
      !Array.isArray(question.options) ||
      question.options.length > 30 ||
      (choices && question.options.length < 2) ||
      (availability &&
        (question.options.length < 1 || question.options.length > 12))
    )
      throw new RequestError(
        400,
        availability
          ? 'Availability needs 1–12 time periods.'
          : 'Choice questions need 2–30 options.',
      );
    const options = question.options.map((option) =>
      text(option, 'the answer option', 200, true),
    );
    if (
      question.exclusiveOption !== undefined &&
      (question.type !== 'multiple' ||
        !Number.isInteger(question.exclusiveOption) ||
        question.exclusiveOption < 0 ||
        question.exclusiveOption >= options.length)
    )
      throw new RequestError(400, 'Choose a listed exclusive option.');
    if (options.includes('__other__'))
      throw new RequestError(400, 'Use a different answer option.');
    if (
      new Set(options.map((option) => option.toLowerCase())).size !==
      options.length
    )
      throw new RequestError(400, 'Use different answer options.');
    if (
      (!choices && !availability && options.length) ||
      (!choices && question.allowOther)
    )
      throw new RequestError(400, 'Only choice questions use answer options.');
    return {
      id: question.id,
      label: text(question.label, 'the question', 300, true),
      description: text(question.description, 'the question description', 1000),
      type: question.type,
      required: question.required,
      options,
      allowOther: choices && question.allowOther,
      ...(availability ? { dates: availabilityDates(question.dates) } : {}),
      ...(question.choiceDate ? { choiceDate: question.choiceDate } : {}),
      ...(question.exclusiveOption !== undefined
        ? { exclusiveOption: question.exclusiveOption }
        : {}),
    };
  });
}
export function surveyVersion(questions) {
  return questions.length
    ? createHash('sha256').update(JSON.stringify(questions)).digest('hex')
    : '';
}
export function validateSurvey(body, event) {
  const questions = surveyQuestions(event.surveyQuestions || []);
  if (!questions.length) {
    if (
      body.surveyVersion ||
      (Array.isArray(body.answers)
        ? body.answers.length
        : body.answers !== undefined)
    )
      throw new RequestError(
        409,
        'The RSVP questions changed. Reopen this event and try again.',
      );
    return null;
  }
  const version = surveyVersion(questions);
  if (body.surveyVersion !== version)
    throw new RequestError(
      409,
      'The RSVP questions changed. Reopen this event and review the current questions.',
    );
  if (!Array.isArray(body.answers) || body.answers.length !== questions.length)
    throw new RequestError(400, 'Please complete the RSVP questions.');
  const byId = new Map();
  for (const answer of body.answers) {
    if (
      !answer ||
      !questions.some((question) => question.id === answer.questionId) ||
      byId.has(answer.questionId)
    )
      throw new RequestError(400, 'Check the RSVP answers.');
    byId.set(answer.questionId, answer);
  }
  const answers = questions.map((question) => {
    const answer = byId.get(question.id);
    const other = text(answer.other, 'the Other answer', 1000);
    let value;
    if (question.type === 'availability') {
      value = validateAvailability(answer.value, question);
    } else if (question.type === 'number') {
      value = answer.value ?? '';
      if (value === '' && !question.required) value = '';
      else if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        Math.abs(value) > Number.MAX_SAFE_INTEGER
      )
        throw new RequestError(400, 'Enter a valid number: ' + question.label);
    } else if (!['single', 'multiple'].includes(question.type)) {
      value = text(
        answer.value,
        question.label,
        question.type === 'text' ? 3000 : question.type === 'email' ? 254 : 300,
        question.required,
      );
      if (value && question.type === 'date' && !isCalendarDate(value))
        throw new RequestError(
          400,
          'Choose a valid calendar date: ' + question.label,
        );
      if (
        value &&
        question.type === 'time' &&
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
      )
        throw new RequestError(400, 'Enter a valid time: ' + question.label);
      if (value && question.type === 'email') value = email(value);
    } else {
      const values =
        question.type === 'multiple'
          ? answer.value
          : typeof answer.value === 'string'
            ? answer.value
              ? [answer.value]
              : []
            : null;
      if (
        !Array.isArray(values) ||
        values.length > 31 ||
        new Set(values).size !== values.length ||
        values.some(
          (choice) =>
            !question.options.includes(choice) &&
            !(question.allowOther && choice === '__other__'),
        ) ||
        (question.required && !values.length)
      )
        throw new RequestError(400, 'Choose an answer for: ' + question.label);
      if (
        question.type === 'multiple' &&
        values.length > 1 &&
        values.some((choice) => exclusiveSurveyChoice(choice, question))
      )
        throw new RequestError(
          400,
          'Choose “' +
            values.find((choice) => exclusiveSurveyChoice(choice, question)) +
            '” by itself for: ' +
            question.label,
        );
      if (values.includes('__other__') !== Boolean(other))
        throw new RequestError(
          400,
          'Add an Other answer only when Other is selected.',
        );
      value = question.type === 'multiple' ? values : values[0] || '';
    }
    if ((!question.allowOther || question.type === 'text') && other)
      throw new RequestError(
        400,
        'This question does not accept an Other answer.',
      );
    return { questionId: question.id, value, other };
  });
  return { version, questions, answers };
}
export async function saveSurveyResponse(tx, entry, response) {
  if (entry.kind !== 'rsvp') return;
  response ||= { version: '', questions: [], answers: [] };
  await tx.query(
    `INSERT INTO club_forms.survey_responses(entry_id,event_id,event_title,event_date,potential,survey_version,questions,answers)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      entry.id,
      entry.data.eventId,
      entry.data.eventTitle,
      entry.data.eventDate || '',
      entry.data.potential === true,
      response.version,
      JSON.stringify(response.questions),
      JSON.stringify(response.answers),
    ],
  );
}
export async function surveyResults(db, filter = {}) {
  const { where, values, offset } = responseFilter(filter);
  const result = await db.query(
    `${responseSelect} ${where} ORDER BY s.created_at DESC,s.entry_id LIMIT 51 OFFSET $8`,
    [...values, offset],
  );
  const total = (
    await db.query(
      `SELECT count(*)::int AS count ${responseFrom} ${where}`,
      values,
    )
  ).rows[0].count;
  const events = (
    await db.query(
      `SELECT DISTINCT ON (event_id) event_id AS id,event_title AS title,event_date AS date FROM club_forms.survey_responses ORDER BY event_id,created_at DESC,entry_id`,
    )
  ).rows;
  return {
    responses: result.rows.slice(0, 50),
    hasMore: result.rows.length > 50,
    events,
    total,
  };
}
