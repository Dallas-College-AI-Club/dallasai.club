import { parse } from 'yaml';

export function parseEventSource(source, now = new Date()) {
  const yaml = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const json = !yaml && source.match(/^\{[\s\S]*?\r?\n\}/);
  if (!yaml && !json) return null;
  const header = (yaml || json)[0];
  const value = yaml ? parse(yaml[1]) : JSON.parse(header);
  if (!value.id || value.draft || new Date(value.publishDate || 0) > now)
    return null;
  return {
    id: value.id,
    title: value.title,
    category: value.category || 'Club event',
    date: value.eventDate,
    end: value.end || null,
    location: value.location || '',
    summary: source.slice(header.length).trim(),
    agenda: value.agenda || [],
    preparation: value.preparation || [],
    targetAudience: value.targetAudience || '',
    learningOutcomes: value.learningOutcomes || [],
    meetingUrl: value.meetingUrl || '',
    registrationOpen: value.registrationOpen !== false,
    url: 'club.html?mode=events&event=' + encodeURIComponent(value.id),
  };
}
