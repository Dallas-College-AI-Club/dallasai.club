export function csvCell(value) {
  const text = String(value ?? '');
  return (
    '"' +
    (/^[\s]*[=+\-@\t\r]/.test(text) ? "'" : '') +
    text.replaceAll('"', '""') +
    '"'
  );
}
const types = {
  join: 'Club signups',
  subscribe: 'The AI Review subscription',
  rsvp: 'Event RSVPs',
  contribution: 'AI Review submissions',
  workshop: 'Workshop requests',
  question: 'Questions',
};
const knownFields = new Set([
  'subject',
  'title',
  'topic',
  'message',
  'body',
  'details',
  'campus',
  'interests',
  'eventTitle',
  'eventDate',
  'location',
  'eventId',
  // Internal flags, not details anyone submitted.
  'hasSurvey',
  'potential',
]);
const received = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  dateStyle: 'medium',
  timeStyle: 'long',
});
// Keep any older or future fields readable instead of dropping them or exporting JSON.
function plainText(value) {
  if (Array.isArray(value)) return value.map(plainText).join('; ');
  if (value && typeof value === 'object')
    return Object.entries(value)
      .map(
        ([key, text]) =>
          `${key.replace(/([A-Z])/g, ' $1')}: ${plainText(text)}`,
      )
      .join('\n');
  return String(value ?? '');
}
const centralDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
// Says what the file holds: club-submissions-<status|all>-<kind|all>[-<event>]
// [-search]-<Central date>.csv. The values are already validated filters.
export function exportFilename(
  { status, kind, eventId, search },
  now = new Date(),
) {
  return (
    [
      'club-submissions',
      { closed: 'archived' }[status] || status || 'all',
      kind || 'all',
      eventId,
      search && 'search',
      centralDate.format(now),
    ]
      .filter(Boolean)
      .join('-') + '.csv'
  );
}
export function submissionsCSV(rows) {
  const columns = [
    'Type',
    'Email',
    'Name',
    'Submission state',
    'Review status',
    'Received (Central)',
    'Subject / title',
    'Message / body',
    'Campus',
    'Interests',
    'Event title',
    'Event date',
    'Event location',
    'Event ID',
    'Other details',
    'Reference',
  ];
  return (
    '\uFEFF' +
    [
      columns,
      ...rows.map((row) => {
        const data = row.data || {};
        return [
          types[row.kind] || row.kind,
          row.email,
          row.name,
          {
            active: 'Received in club inbox',
            cancelled: 'RSVP cancelled',
            unsubscribed: 'The AI Review subscription withdrawn',
          }[row.state] || row.state,
          { new: 'New', reviewed: 'Reviewed', closed: 'Archived' }[
            row.review_status
          ] || row.review_status,
          received.format(new Date(row.created_at)),
          data.subject ?? data.title ?? data.topic ?? '',
          data.message ?? data.body ?? data.details ?? '',
          data.campus,
          data.interests,
          data.eventTitle,
          row.kind === 'rsvp' && !data.eventDate ? 'TBD' : data.eventDate,
          data.location,
          data.eventId,
          plainText(
            Object.fromEntries(
              Object.entries(data).filter(([key]) => !knownFields.has(key)),
            ),
          ),
          row.id,
        ].map(plainText);
      }),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')
  );
}
