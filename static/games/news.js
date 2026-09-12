import { splitEvents, eventDate } from '../content/club.js';
import { stationUpdates } from '../content/discovery.js';
export function clubBulletins() {
  const events = splitEvents(),
    event = events.upcoming[0] || events.past[0],
    article = stationUpdates('journal')[0];
  return [
    ...(event
      ? [
          {
            id: 'event-' + event.id,
            label: events.upcoming.length ? 'COMING UP · ' + eventDate(event) : 'FROM THE CLUB',
            title: event.title,
            body: event.summary,
            action: 'View events',
            mode: 'events',
            event: event.id,
          },
        ]
      : []),
    stationUpdates('projects')[0],
    // Keep the arcade reward ID stable so existing saves do not earn it twice.
    ...(article ? [{ ...article, id: 'review' }] : []),
    stationUpdates('about')[0],
  ];
}
export const bulletinAt = (index) => {
  const items = clubBulletins();
  return items[index % items.length];
};
