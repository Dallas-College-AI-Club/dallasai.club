import { PUBLISHED } from './published.js';
export const EVENTS = PUBLISHED.events;
export const EVENTS_API_URL = PUBLISHED.club.EVENTS_API_URL || '';
export const ADMIN_URL = PUBLISHED.club.ADMIN_URL || '';
// Once the live calendar is enabled, a stale site build must not resurrect an
// unpublished event while the API is unavailable.
if (EVENTS_API_URL) EVENTS.splice(0, EVENTS.length);
let started = false,
  pending = null;
export let eventsFresh = !EVENTS_API_URL;

function cleanEvent(event) {
  if (
    !event ||
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(event.id) ||
    typeof event.title !== 'string' ||
    typeof event.date !== 'string' ||
    !Number.isFinite(Date.parse(event.date))
  )
    throw new Error('Invalid event');
  let meetingUrl = '';
  if (event.meetingUrl) {
    const link = new URL(event.meetingUrl);
    if (link.protocol !== 'https:' || link.username || link.password)
      throw new Error('Invalid link');
    meetingUrl = link.href;
  }
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    end: event.end || null,
    category: String(event.category || 'Club event'),
    summary: String(event.summary || ''),
    location: String(event.location || ''),
    targetAudience: String(event.targetAudience || ''),
    learningOutcomes: Array.isArray(event.learningOutcomes)
      ? event.learningOutcomes.map(String)
      : [],
    agenda: Array.isArray(event.agenda) ? event.agenda.map(String) : [],
    preparation: Array.isArray(event.preparation)
      ? event.preparation.map(String)
      : [],
    meetingUrl,
    registrationOpen: event.registrationOpen !== false,
    url: 'club.html?mode=events&event=' + encodeURIComponent(event.id),
  };
}
export function refreshEvents() {
  if (!EVENTS_API_URL) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch(EVENTS_API_URL, {
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Events unavailable');
      const data = await response.json();
      if (!Array.isArray(data.events)) throw new Error('Invalid event list');
      const next = data.events.map(cleanEvent);
      if (new Set(next.map((e) => e.id)).size !== next.length)
        throw new Error('Duplicate event');
      eventsFresh = true;
      if (JSON.stringify(next) !== JSON.stringify(EVENTS)) {
        EVENTS.splice(0, EVENTS.length, ...next);
        document.dispatchEvent(new CustomEvent('club:events-updated'));
      }
    } catch {
      eventsFresh = false;
    } finally {
      pending = null;
      document.dispatchEvent(new CustomEvent('club:events-status'));
    }
  })();
  return pending;
}
export function startEventUpdates() {
  if (started || !EVENTS_API_URL) return;
  started = true;
  refreshEvents();
  setInterval(() => {
    if (!document.hidden) refreshEvents();
  }, 60000);
  window.addEventListener('online', refreshEvents);
  window.addEventListener('focus', refreshEvents);
}
