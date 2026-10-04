import { node } from './ui.js';
import { eventText, eventList, eventAgenda } from '../lib/event-format.mjs';
export function eventOverview(row, status, startEditing) {
  const event = row.draft,
    fragment = document.createDocumentFragment();
  fragment.append(
    node('p', 'READ-ONLY', 'eyebrow'),
    node('h3', event.title),
    node('p', status, 'hint'),
  );
  const edit = node('button', 'Edit event');
  edit.type = 'button';
  edit.id = 'edit-selected-event';
  edit.onclick = startEditing;
  const actions = node('div', undefined, 'event-actions');
  actions.append(edit);
  if (row.published) {
    const link = node('a', 'View published event ↗');
    link.href =
      'https://dallasai.club/club.html?mode=events&event=' +
      encodeURIComponent(row.id);
    link.target = '_blank';
    link.rel = 'noopener';
    actions.append(link);
  }
  fragment.append(
    actions,
    node(
      'p',
      'Select Edit event to make changes. This view shows the latest saved details.',
      'hint',
    ),
  );
  fragment.append(
    node(
      'p',
      [
        event.category,
        event.potential ? 'Potential event' : '',
        event.date || 'TBD',
        event.startTime ? event.startTime + ' Central' : '',
        event.location,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  );
  for (const [title, value, render] of [
    ['Description', event.summary, eventText],
    ['Who is this for?', event.targetAudience, eventText],
    ['Learning outcomes', event.learningOutcomes, eventList],
    ['On the agenda', event.agenda, eventAgenda],
    ['Before you come', event.preparation, eventList],
    ['RSVP introduction', event.surveyIntro, eventText],
  ])
    if (value?.length) {
      const section = node('section', undefined, 'event-overview-section');
      section.append(node('h4', title));
      const body = node('div', undefined, 'event-richtext');
      body.innerHTML = render(value);
      section.append(body);
      fragment.append(section);
    }
  fragment.append(
    node(
      'p',
      (event.registrationOpen === false ? 'RSVPs closed' : 'RSVPs open') +
        ' · ' +
        (event.requireEduEmail
          ? 'College or alumni .edu email required'
          : 'Any valid email accepted'),
      'hint',
    ),
  );
  if (event.surveyQuestions?.length) {
    fragment.append(node('h4', 'RSVP questions'));
    const list = node('ol');
    for (const question of event.surveyQuestions) {
      const item = node(
        'li',
        (question.choiceDate ? question.choiceDate + ' · ' : '') +
          question.label +
          (question.required ? ' (required)' : ' (optional)'),
      );
      if (question.options.length)
        item.append(node('p', question.options.join(' · '), 'hint'));
      list.append(item);
    }
    fragment.append(list);
  }
  if (event.meetingUrl) {
    const link = node('a', 'Open meeting link ↗');
    link.href = event.meetingUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    fragment.append(link);
  }
  if (event.images?.length) {
    const gallery = node('div', undefined, 'event-overview-gallery');
    for (const image of event.images) {
      const img = node('img');
      img.src = '/api/events?image=' + encodeURIComponent(image.id);
      img.alt = image.alt || event.title + ' — event image';
      img.loading = 'lazy';
      gallery.append(img);
    }
    fragment.append(gallery);
  }
  return fragment;
}
