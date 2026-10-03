import { kinds, uuid } from './validation.mjs';
import { RequestError } from './errors.mjs';
export function upcomingEvents(events, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return events
    .filter(
      (e) =>
        (e.potential === true && !e.date) ||
        (e.date &&
          (/^\d{4}-\d{2}-\d{2}$/.test(e.date)
            ? e.date >= today
            : new Date(e.end || e.date) > now)),
    )
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}
export function inboxFilter(params, events) {
  const kind = params.get('kind') || '',
    status = params.get('status') || '',
    id = params.get('id') || '',
    eventId = params.get('eventId') || '';
  if (
    (kind && !kinds.includes(kind) && kind !== 'rsvp-past') ||
    (status && !['new', 'reviewed', 'closed'].includes(status)) ||
    (id && !uuid.test(id)) ||
    (eventId && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(eventId))
  )
    throw new RequestError(400, 'Invalid filter.');
  return {
    values: [kind, status, id, eventId, events.map((e) => e.id)],
    where: `WHERE ($1='' OR e.kind=$1 OR ($1='rsvp-past' AND e.kind='rsvp')) AND ($2='' OR e.review_status=$2) AND ($3='' OR e.id::text=$3)
      AND ($4='' OR (e.kind='rsvp' AND e.data->>'eventId'=$4))
      AND ($1 NOT IN ('rsvp','rsvp-past') OR (coalesce(e.data->>'eventId','')=ANY($5::text[]))=($1='rsvp'))`,
  };
}
