export const coreEventTypes = [
  'Workshop',
  'Meeting',
  'Talk',
  'Hackathon',
  'Social',
];
const aliases = new Map([
  ['club event', 'Meeting'],
  ['club meeting', 'Meeting'],
  ['project meeting', 'Meeting'],
  ['conversation', 'Talk'],
  ['presentation', 'Talk'],
  ['project workshop', 'Workshop'],
  ['skills session', 'Workshop'],
  ['user testing', 'Workshop'],
  ...coreEventTypes.map((name) => [name.toLowerCase(), name]),
]);
export function eventType(value) {
  const name = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
  return aliases.get(name.toLowerCase()) || name || 'Meeting';
}
export function normalizeEventType(event) {
  return event ? { ...event, category: eventType(event.category) } : event;
}
