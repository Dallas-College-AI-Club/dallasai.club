// Shared by public RSVP, custom forms, officer editing and server-side exports.
export const availabilityStatuses = {
  unavailable: 'Not available',
  unsure: 'Not sure yet',
  alternative: 'Suggest alternative dates',
  available: 'Choose dates below',
};
export function availabilityValues(value) {
  if (!value || typeof value !== 'object') return [];
  return [
    ...(value.status === 'available'
      ? []
      : [availabilityStatuses[value.status]]),
    ...(value.selections || []).flatMap(({ date, periods }) =>
      periods.map((period) => date + ' · ' + period),
    ),
    ...(value.alternatives || []).map(
      ({ date, time }) => 'Suggested: ' + date + (time ? ' · ' + time : ''),
    ),
  ].filter(Boolean);
}
export const availabilityColumns = (question) => [
  ...Object.entries(availabilityStatuses)
    .filter(([status]) => status !== 'available')
    .map(([, label]) => label),
  ...question.dates.flatMap((date) =>
    question.options.map((period) => date + ' · ' + period),
  ),
];
