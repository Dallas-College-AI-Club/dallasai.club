import { PUBLISHED } from './published.js';
import { articles } from './articles.js';
import { splitEvents, eventDate } from './club.js';
import { PROPOSED_PROJECTS } from './projects.js';
export function stationUpdates(id, snapshot = PUBLISHED) {
  if (id === 'journal')
    return (snapshot.articles || articles).map((a) => ({
      id: 'review-' + a.slug,
      label: 'THE AI REVIEW' + (a.isSample ? ' · EDITORIAL SAMPLE' : ''),
      title: a.title,
      body: a.abstract,
      action: 'Read the article',
      mode: 'article',
      article: a.slug,
    }));
  if (id === 'projects')
    return [
      ...snapshot.discovery.projects,
      ...(snapshot.projects?.PROPOSED_PROJECTS || PROPOSED_PROJECTS).map((project) => ({
        id: project.id,
        label: 'PROJECTS · IDEAS IN MOTION',
        title: project.title,
        body: project.summary,
        action: 'Explore the concept',
        mode: 'projects',
      })),
    ];
  if (id === 'events') {
    const { upcoming, past } = splitEvents(new Date(), snapshot.events);
    return [...upcoming, ...past].map((e) => ({
      id: 'event-' + e.id,
      label: (upcoming.includes(e) ? 'COMING UP · ' : 'PAST EVENT · ') + eventDate(e),
      title: e.title,
      body: e.summary,
      action: 'View events',
      mode: 'events',
    }));
  }
  if (id === 'lab') return snapshot.discovery.lab;
  return snapshot.discovery.community;
}
