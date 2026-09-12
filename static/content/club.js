import { EVENTS } from './events.js';
import { PUBLISHED } from './published.js';
export { EVENTS };
export const ADVISORS = PUBLISHED.club.ADVISORS;
export const CONTACT_EMAIL = PUBLISHED.club.CONTACT_EMAIL;
export const COPYRIGHT = PUBLISHED.club.COPYRIGHT;
export const EDITOR_EMAIL = PUBLISHED.club.EDITOR_EMAIL;
export const JOIN_URL = PUBLISHED.club.JOIN_URL;
export const PROJECT_URL = PUBLISHED.club.PROJECT_URL;
export const SITE_URL = PUBLISHED.club.SITE_URL;
export const SOCIAL_LINKS = PUBLISHED.club.SOCIAL_LINKS;
export const WORKSHOP_REQUEST_URL = PUBLISHED.club.WORKSHOP_REQUEST_URL;

const dateOnly = (e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date);
export const eventDate = (e) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: dateOnly(e) ? 'UTC' : 'America/Chicago',
  }).format(new Date(e.date));
export function eventTime(e) {
  if (dateOnly(e))
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(e.date),
    );
  const start = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  }).format(new Date(e.date));
  const end = e.end
    ? '–' +
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
      }).format(new Date(e.end))
    : '';
  return start + end + ' CT';
}
export function eventIsPast(e, now = new Date()) {
  if (!dateOnly(e)) return new Date(e.end || e.date) < now;
  const day = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Chicago',
  }).format(now);
  return e.date < day;
}
export function splitEvents(now = new Date(), events = EVENTS) {
  return {
    upcoming: events
      .filter((e) => !eventIsPast(e, now))
      .sort((a, b) => a.date.localeCompare(b.date)),
    past: events.filter((e) => eventIsPast(e, now)).sort((a, b) => b.date.localeCompare(a.date)),
  };
}
export function eventCalendar(e) {
  const url = new URL(e.url, globalThis.location?.href || 'https://dallasai.club/').href;
  const utc = (s) => new Date(s).toISOString().replace(/[-:]/g, '').replace('.000', '');
  const escape = (s) =>
    s
      .replaceAll('\\', '\\\\')
      .replaceAll(';', '\\;')
      .replaceAll(',', '\\,')
      .replaceAll('\n', '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dallas College AI Club//Event Preview//EN',
    'BEGIN:VEVENT',
    'UID:' + e.id + '-' + e.date.slice(0, 4) + '@dallasai.club',
    'DTSTAMP:' + utc(new Date().toISOString()),
    dateOnly(e) ? 'DTSTART;VALUE=DATE:' + e.date.replaceAll('-', '') : 'DTSTART:' + utc(e.date),
    ...(e.end ? ['DTEND:' + utc(e.end)] : []),
    'SUMMARY:' + escape(e.title),
    'DESCRIPTION:' +
      escape(
        [e.summary, ...e.agenda, ...e.preparation, 'Details: ' + url].filter(Boolean).join('\n'),
      ),
    ...(e.location ? ['LOCATION:' + escape(e.location)] : []),
    'URL:' + url,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
