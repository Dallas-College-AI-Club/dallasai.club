import { RequestError } from './errors.mjs';
import { uuid } from './validation.mjs';
import { surveyQuestions, surveyVersion } from './surveys.mjs';
export const eventIdPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;
function text(value, label, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new RequestError(400, `Check ${label}.`);
  value = value.trim();
  if (
    (required && !value) ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw new RequestError(400, `Check ${label} (maximum ${max} characters).`);
  return value;
}
function day(value, required = false) {
  if (!value && !required) return '';
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new RequestError(400, 'Choose a valid event date.');
  return value;
}
const central = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
// Dallas changes between UTC-5 and UTC-6. Reject missing/repeated clock-change times.
export function centralTime(date, time) {
  day(date, true);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new RequestError(400, 'Choose a valid time.');
  const local = date + 'T' + time;
  const candidates = ['-05:00', '-06:00']
    .map((offset) => local + ':00' + offset)
    .filter(
      (candidate) =>
        central.format(new Date(candidate)).replace(' ', 'T') === local,
    );
  if (candidates.length !== 1)
    throw new RequestError(
      400,
      'That Central time is skipped or repeated when clocks change. Choose another time.',
    );
  return candidates[0];
}
function lines(value, label) {
  if (typeof value === 'string') value = value.split(/\r?\n/);
  if (value === undefined) value = [];
  if (!Array.isArray(value) || value.length > 30)
    throw new RequestError(400, `Use up to 30 lines for ${label}.`);
  return value.map((line) => text(line, label, 600)).filter(Boolean);
}
export function draftContent(input, publish = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new RequestError(400, 'Check the event details.');
  for (const key of ['potential', 'requireEduEmail']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean')
      throw new RequestError(400, 'Check the event settings.');
  }
  const draft = {
    title: text(input.title, 'the event title', 160, true),
    category: text(input.category, 'the event type', 80) || 'Club event',
    potential: input.potential === true,
    requireEduEmail:
      input.requireEduEmail ??
      String(input.category || '')
        .trim()
        .toLowerCase() === 'social',
    date: day(
      text(input.date, 'the date', 10),
      publish && input.potential !== true,
    ),
    surveyIntro: text(input.surveyIntro, 'the RSVP introduction', 2000),
    surveyQuestions: surveyQuestions(input.surveyQuestions),
    startTime: text(input.startTime, 'the start time', 5),
    endDate: day(text(input.endDate, 'the end date', 10)),
    endTime: text(input.endTime, 'the end time', 5),
    location: text(input.location, 'the location', 300),
    summary: text(input.summary, 'the description', 3000),
    targetAudience: text(input.targetAudience, 'the audience', 1000),
    learningOutcomes: lines(input.learningOutcomes, 'the learning outcomes'),
    agenda: lines(input.agenda, 'the agenda'),
    preparation: lines(input.preparation, 'what to bring'),
    meetingUrl: text(input.meetingUrl, 'the meeting link', 2000),
    registrationOpen: input.registrationOpen !== false,
    images: [],
  };
  if (
    input.images !== undefined &&
    (!Array.isArray(input.images) || input.images.length > 3)
  )
    throw new RequestError(400, 'Use up to three event images.');
  draft.images = (input.images || []).map((image) => {
    if (!image || !uuid.test(image.id || ''))
      throw new RequestError(400, 'Upload a valid event image.');
    return {
      id: image.id,
      alt: text(image.alt, 'the image description', 300),
    };
  });
  if (
    new Set(draft.images.map((image) => image.id)).size !== draft.images.length
  )
    throw new RequestError(400, 'Each image can appear only once.');
  if (draft.meetingUrl) {
    let url;
    try {
      url = new URL(draft.meetingUrl);
    } catch {
      /* checked below */
    }
    if (!url || url.protocol !== 'https:' || url.username || url.password)
      throw new RequestError(400, 'Use a full https:// meeting link.');
    draft.meetingUrl = url.href;
  }
  if (draft.startTime && !draft.date)
    throw new RequestError(400, 'Add a date before choosing a time.');
  if ((draft.endTime || draft.endDate) && !draft.startTime)
    throw new RequestError(400, 'Add a start time before setting an end time.');
  if (draft.endDate && !draft.endTime)
    throw new RequestError(400, 'Add an end time or clear the end date.');
  const start = draft.startTime
    ? centralTime(draft.date, draft.startTime)
    : draft.date;
  const end = draft.endTime
    ? centralTime(draft.endDate || draft.date, draft.endTime)
    : null;
  if (end && Date.parse(end) <= Date.parse(start))
    throw new RequestError(
      400,
      'The end must be after the start. For an overnight event, choose the next day.',
    );
  return draft;
}
export function publicContent(id, input, preview = false) {
  const draft = draftContent(input, !preview);
  return {
    id,
    title: draft.title,
    category: draft.category,
    potential: draft.potential,
    requireEduEmail: draft.requireEduEmail,
    surveyIntro: draft.surveyIntro,
    surveyQuestions: draft.surveyQuestions,
    surveyVersion: surveyVersion(draft.surveyQuestions),
    date: draft.startTime
      ? centralTime(draft.date, draft.startTime)
      : draft.date,
    ...(draft.endTime
      ? { end: centralTime(draft.endDate || draft.date, draft.endTime) }
      : {}),
    location: draft.location,
    summary: draft.summary,
    agenda: draft.agenda,
    targetAudience: draft.targetAudience,
    learningOutcomes: draft.learningOutcomes,
    preparation: draft.preparation,
    meetingUrl: draft.meetingUrl,
    registrationOpen: draft.registrationOpen,
    images: draft.images,
    url: 'club.html?mode=events&event=' + encodeURIComponent(id),
  };
}
export function editableContent(event) {
  const local = (value) =>
    value && value.includes('T')
      ? central.format(new Date(value))
      : value || '';
  const start = local(event.date),
    end = local(event.end);
  return {
    ...event,
    date: start.slice(0, 10),
    startTime: start.slice(11, 16),
    endDate: end.slice(0, 10),
    endTime: end.slice(11, 16),
    meetingUrl: event.meetingUrl || '',
    registrationOpen: event.registrationOpen !== false,
  };
}
