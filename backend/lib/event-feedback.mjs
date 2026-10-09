import { createHash } from 'node:crypto';
import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';
import { surveyQuestions, surveyVersion, validateSurvey } from './surveys.mjs';
import { originalEvents } from './events.mjs';
import {
  defaultFeedbackQuestions,
  eventFeedbackState,
} from './event-feedback-definition.mjs';
export {
  defaultFeedbackQuestions,
  eventFeedbackState,
  eventFeedbackURL,
} from './event-feedback-definition.mjs';

const eventIdPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;
function checkEventId(id) {
  if (typeof id !== 'string' || !eventIdPattern.test(id))
    throw new RequestError(400, 'Choose a valid event.');
}

async function feedbackEvent(db, id, originals, lock = false) {
  checkEventId(id);
  const row = (
    await db.query(
      'SELECT published,archived_at FROM club_forms.events WHERE id=$1' +
        (lock ? ' FOR SHARE' : ''),
      [id],
    )
  ).rows[0];
  const event = row
    ? !row.archived_at && row.published
    : (originals ?? (await originalEvents())).find((event) => event.id === id);
  if (!event) throw new RequestError(404, 'This event is unavailable.');
  return event;
}

export async function readEventFeedback(db, id, originals, now = Date.now()) {
  const event = await feedbackEvent(db, id, originals);
  const state = eventFeedbackState(event, now);
  const questions = surveyQuestions(
    event.feedbackQuestions ?? defaultFeedbackQuestions(),
  );
  return {
    event: { id, title: event.title, date: event.date },
    questions: state.status === 'unavailable' ? [] : questions,
    version: surveyVersion(questions),
    ...state,
  };
}

export async function submitEventFeedback(
  db,
  body,
  originals,
  now = () => Date.now(),
) {
  checkEventId(body.eventId);
  if (typeof body.requestId !== 'string' || !uuid.test(body.requestId))
    throw new RequestError(400, 'Refresh the feedback form and try again.');
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        eventId: body.eventId,
        surveyVersion: body.surveyVersion,
        answers: body.answers,
      }),
    )
    .digest('hex');
  const receipt = (row) => {
    if (row.request_digest !== digest)
      throw new RequestError(
        409,
        'This submission reference was already used. Reopen the feedback form.',
      );
    return { received: true };
  };
  return db.transaction(async (tx) => {
    // Event publication, archival and RSVP changes use this same lock. Read
    // the saved event after acquiring it so a stale open form cannot submit.
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('event-rsvp:' || $1,0))",
      [body.eventId],
    );
    const previous = (
      await tx.query(
        'SELECT request_digest FROM club_forms.event_feedback_responses WHERE id=$1',
        [body.requestId],
      )
    ).rows[0];
    if (previous) return receipt(previous);
    const event = await feedbackEvent(tx, body.eventId, originals, true);
    const state = eventFeedbackState(event, now());
    if (state.status !== 'open')
      throw new RequestError(
        409,
        state.status === 'upcoming'
          ? 'Event feedback opens when the event starts.'
          : state.status === 'expired'
            ? 'Event feedback closed 72 hours after the event started.'
            : 'Event feedback is unavailable for this event.',
      );
    let response;
    try {
      response = validateSurvey(body, {
        surveyQuestions: event.feedbackQuestions ?? defaultFeedbackQuestions(),
      });
    } catch (error) {
      if (error instanceof RequestError)
        error.message = error.message.replaceAll('RSVP', 'feedback');
      throw error;
    }
    if (!response)
      throw new RequestError(409, 'This event has no feedback questions.');
    const emailQuestion = response.questions.find((q) => q.type === 'email');
    const email = emailQuestion
      ? response.answers.find((a) => a.questionId === emailQuestion.id).value
      : '';
    const inserted = (
      await tx.query(
        `INSERT INTO club_forms.event_feedback_responses
        (id,event_id,event_title,event_date,email,request_digest,survey_version,questions,answers)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING RETURNING request_digest`,
        [
          body.requestId,
          body.eventId,
          event.title,
          event.date,
          email,
          digest,
          response.version,
          JSON.stringify(response.questions),
          JSON.stringify(response.answers),
        ],
      )
    ).rows[0];
    return receipt(
      inserted ||
        (
          await tx.query(
            'SELECT request_digest FROM club_forms.event_feedback_responses WHERE id=$1',
            [body.requestId],
          )
        ).rows[0],
    );
  });
}

export async function eventFeedbackResults(db, { eventId, offset = 0 }) {
  checkEventId(eventId);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    throw new RequestError(400, 'Choose a valid feedback page.');
  const rows = (
    await db.query(
      `SELECT id,event_id,event_title,event_date,email,survey_version,questions,answers,created_at
      FROM club_forms.event_feedback_responses WHERE event_id=$1
      ORDER BY created_at DESC,id LIMIT 51 OFFSET $2`,
      [eventId, offset],
    )
  ).rows;
  const total = (
    await db.query(
      'SELECT count(*)::int AS count FROM club_forms.event_feedback_responses WHERE event_id=$1',
      [eventId],
    )
  ).rows[0].count;
  return { responses: rows.slice(0, 50), total, hasMore: rows.length > 50 };
}
