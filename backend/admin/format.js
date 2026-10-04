// Dates, plurals and labels for Club Office. Pure (no DOM), so node --test
// covers it. Every time is Central and says 'CT'; nothing shows ISO strings,
// seconds, 24-hour times or raw codes.
const zone = 'America/Chicago',
  formatter = (options, locale = 'en-US') =>
    new Intl.DateTimeFormat(locale, { timeZone: zone, ...options }),
  clockFormat = formatter({ hour: 'numeric', minute: '2-digit' }),
  full = formatter({
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }),
  fullYear = formatter({
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }),
  // Calendar dates such as an event's '2026-10-23' have no time zone.
  calendar = (options) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }),
  dayName = calendar({ weekday: 'short', month: 'short', day: 'numeric' }),
  dayNameYear = calendar({
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }),
  centralDay = formatter(
    { year: 'numeric', month: '2-digit', day: '2-digit' },
    'en-CA',
  ),
  rules = new Intl.PluralRules('en-US');
// ICU puts a narrow no-break space before AM/PM; keep plain spaces.
const plain = (text) => text.replace(/[\u202f\u2009]/g, ' ');
const valid = (value) => {
  const date = value instanceof Date ? value : new Date(value ?? NaN);
  return Number.isFinite(date.getTime()) ? date : null;
};
const sameYear = (date, now) =>
  centralDay.format(date).slice(0, 4) === centralDay.format(now).slice(0, 4);

// 'Thu, Oct 2, 11:34 PM CT'; the year is added outside the current year.
export function dateTime(value, now = new Date()) {
  const date = valid(value);
  if (!date) return '';
  return plain((sameYear(date, now) ? full : fullYear).format(date)) + ' CT';
}
// '9:14 AM' (Central), e.g. 'Updated 9:14 AM'.
export function clock(value) {
  const date = valid(value);
  return date ? plain(clockFormat.format(date)) : '';
}
// Attributes for <time>: the exact instant plus the full Central time.
export function timeAttrs(value) {
  const date = valid(value);
  return date
    ? { dateTime: date.toISOString(), title: dateTime(date) }
    : { dateTime: '', title: '' };
}
// '2026-10-23' → 'Fri, Oct 23'; blank → 'Date TBD'.
export function day(value, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return 'Date TBD';
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return (
    match[1] === centralDay.format(now).slice(0, 4) ? dayName : dayNameYear
  ).format(date);
}
// plural(1, 'submission') → '1 submission'; plural(2, 'reply', 'replies').
export function plural(n, word, pluralWord = word + 's') {
  return (
    Number(n).toLocaleString('en-US') +
    ' ' +
    (rules.select(n) === 'one' ? word : pluralWord)
  );
}

const kinds = {
  question: ['Question', 'Questions'],
  join: ['Signup', 'Signups'],
  subscribe: ['Newsletter', 'Newsletter'],
  rsvp: ['RSVP', 'RSVPs'],
  'rsvp-past': ['RSVP', 'RSVPs for past events'],
  workshop: ['Workshop request', 'Workshops'],
  contribution: ['Article', 'Articles'],
};
// The kinds of submission, in the order the Inbox lists them.
export const KINDS = [
  'question',
  'join',
  'subscribe',
  'rsvp',
  'workshop',
  'contribution',
];
export const kindLabel = (kind, form = 'short') =>
  kinds[kind]?.[form === 'plural' ? 1 : 0] || 'Submission';
export const statusLabel = (status) =>
  ({ new: 'New', reviewed: 'Reviewed', closed: 'Archived' })[status] ||
  'Unknown';

// The fields officers can edit on each kind of submission:
// [key, label, max length, required].
export const FIELD_SCHEMA = {
  subscribe: [],
  rsvp: [],
  join: [
    ['campus', 'Campus', 100, true],
    ['interests', 'Interests', 1500, false],
  ],
  workshop: [
    ['topic', 'Topic', 160, true],
    ['details', 'Details', 3000, false],
  ],
  contribution: [
    ['title', 'Title', 140, true],
    ['body', 'Draft', 40000, false],
  ],
  question: [
    ['subject', 'Subject', 160, true],
    ['message', 'Message', 5000, true],
  ],
};
const fieldLabels = {
  ...Object.fromEntries(
    Object.values(FIELD_SCHEMA)
      .flat()
      .map(([key, label]) => [key, label]),
  ),
  eventTitle: 'Event',
  eventDate: 'Event date',
  eventId: 'Event link name',
  location: 'Location',
};
// A stored data key as a label: 'eventDate' → 'Event date'.
export const fieldLabel = (key) =>
  fieldLabels[key] ||
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (first) => first.toUpperCase());

// Who did it: the signed-in officer is 'You'; ids such as
// 'codex:requested-date-choice' are an automatic update.
export function actorLabel(actor, me) {
  if (!actor) return 'Someone';
  if (me && actor.toLowerCase() === me.toLowerCase()) return 'You';
  if (actor === 'website') return 'The website';
  if (!actor.includes('@') && actor.includes(':')) return 'Automatic update';
  return actor;
}
// Every audit and activity code the server writes, as plain words.
const actions = {
  'review:new': 'Marked as new',
  'review:reviewed': 'Marked reviewed',
  'review:closed': 'Archived',
  'comment-added': 'Added a note',
  'submission-edited': 'Edited the response',
  'submission-permanently-deleted': 'Permanently deleted a submission',
  'edit-submission': 'Edited the response',
  'delete-submission': 'Permanently deleted a submission',
  'download-attachment': 'Downloaded an attachment',
  resubmitted: 'Updated details from the website (unverified)',
  'survey-starred': 'Starred',
  'survey-unstarred': 'Unstarred',
  'survey-archived': 'Excluded from results',
  'survey-restored': 'Included in results',
  'survey-summary': 'Compiled a survey summary',
  'survey-export-csv': 'Exported survey responses',
  'export-csv': 'Exported CSV',
  'state:cancelled': 'RSVP marked cancelled',
  'state:unsubscribed': 'Newsletter request withdrawn',
  'state:active': 'Restored as active',
  'contact-purged': 'Permanently deleted a test contact',
  draft: 'Draft saved',
  publish: 'Published',
  unpublish: 'Unpublished',
  archive: 'Archived',
  restore: 'Restored as draft',
  draft_saved: 'Saved draft',
  published: 'Published survey',
  closed: 'Closed survey',
  respondent_added: 'Added',
  respondent_restored: 'Restored',
  respondent_removed: 'Archived',
  respondent_registered: 'Registered',
};
for (const label of [
  'Merged contact',
  'Contact deleted',
  'Contact restored',
  'Marked as test',
  'Unmarked as test',
  'Contact edited',
  'Unused address removed',
])
  actions[label] = label;
// Codes such as survey-export-csv:<event> carry details after the colon.
export const actionLabel = (code = '') =>
  actions[code] || actions[code.split(':')[0]] || 'Updated';
