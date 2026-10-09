import { button, node } from './ui.js';
import { eventText, eventList, eventAgenda } from '../lib/event-format.mjs';
import {
  eventFeedbackState,
  eventFeedbackURL,
} from '../lib/event-feedback-definition.mjs';
import { availabilityValues } from '../surveys/availability-values.js';
import { dateTime } from './format.js';

export function eventFeedbackOverview(row, api, isCurrent, startEditing) {
  const section = node('section', undefined, 'event-overview-section');
  section.id = 'event-feedback-overview';
  const live = row.archived_at ? null : row.published;
  const state = eventFeedbackState(live);
  section.append(node('h4', 'Event feedback'));
  section.append(
    node(
      'p',
      live?.feedbackEnabled
        ? state.status === 'upcoming'
          ? 'Opens ' +
            dateTime(state.opensAt) +
            ' · Closes ' +
            dateTime(state.closesAt)
          : state.status === 'open'
            ? 'Open · Closes ' + dateTime(state.closesAt)
            : state.status === 'expired'
              ? 'Closed · ' + dateTime(state.closesAt)
              : 'Confirm the event date and start time, then publish to schedule feedback.'
        : row.draft.feedbackEnabled
          ? 'Publish the event to enable feedback.'
          : 'Event feedback is off.',
      'hint',
    ),
  );
  section.append(button('Edit event feedback', startEditing));
  if (row.draft.feedbackEnabled && row.draft.feedbackQuestions?.length) {
    const questions = node('details');
    questions.append(node('summary', 'Feedback questions'));
    const list = node('ol');
    for (const question of row.draft.feedbackQuestions)
      list.append(
        node(
          'li',
          question.label + (question.required ? ' (required)' : ' (optional)'),
        ),
      );
    questions.append(list);
    section.append(questions);
  }
  if (live?.feedbackEnabled) {
    const sharing = node('div', undefined, 'event-actions');
    const address = node(
      'a',
      live.feedbackShortLink || 'Open event feedback ↗',
    );
    address.href = live.feedbackShortLink || eventFeedbackURL(row.id);
    address.target = '_blank';
    address.rel = 'noopener';
    const qr = node('a', 'Download feedback QR', 'button-link');
    qr.href =
      '/api/events?qr=' + encodeURIComponent(row.id) + '&feedback=1&download=1';
    qr.download = row.id + '-feedback-qr.svg';
    sharing.append(address, qr);
    if (!live.feedbackShortLink) {
      const status = node('p');
      status.setAttribute('role', 'status');
      const create = button('Create feedback short link', async () => {
        create.disabled = true;
        try {
          const result = await api('/api/events', {
            action: 'feedback-share-link',
            id: row.id,
          });
          if (!isCurrent()) return;
          const shortLink = result.event?.published?.feedbackShortLink;
          if (!shortLink)
            throw new Error('The feedback short link could not be created.');
          live.feedbackShortLink = shortLink;
          address.href = shortLink;
          address.textContent = shortLink;
          create.remove();
          status.textContent = 'Feedback short link created.';
        } catch (error) {
          if (isCurrent()) status.textContent = error.message;
        } finally {
          create.disabled = false;
        }
      });
      sharing.append(create, status);
    }
    section.append(sharing);
  }
  const responses = node('details');
  const summary = node('summary', 'Feedback responses');
  const results = node('div');
  const status = node('p');
  status.setAttribute('role', 'status');
  let offset = 0;
  const more = button('Load more feedback', () => load());
  more.hidden = true;
  async function load() {
    more.disabled = true;
    status.textContent = 'Loading feedback…';
    try {
      const data = await api(
        '/api/event-feedback?eventId=' +
          encodeURIComponent(row.id) +
          '&admin=1&offset=' +
          offset,
      );
      if (!isCurrent()) return;
      summary.textContent = 'Feedback responses (' + data.total + ')';
      for (const response of data.responses) {
        const card = node('details', undefined, 'response-person');
        card.append(
          node(
            'summary',
            (response.email || 'Event attendee') +
              ' · ' +
              dateTime(response.created_at),
          ),
        );
        const answers = node('dl');
        for (const question of response.questions) {
          const answer = response.answers.find(
            (item) => item.questionId === question.id,
          );
          const values =
            question.type === 'availability'
              ? availabilityValues(answer?.value)
              : (Array.isArray(answer?.value)
                  ? answer.value
                  : [answer?.value ?? '']
                )
                  .filter((value) => value !== '')
                  .map((value) =>
                    value === '__other__' ? 'Other: ' + answer.other : value,
                  );
          answers.append(
            node('dt', question.label),
            node('dd', values.length ? values.join('\n') : 'No answer'),
          );
        }
        card.append(answers);
        results.append(card);
      }
      offset += data.responses.length;
      more.hidden = !data.hasMore;
      status.textContent = data.total ? '' : 'No feedback responses yet.';
    } catch (error) {
      if (isCurrent()) {
        status.textContent = error.message;
        more.hidden = false;
        more.textContent = 'Retry loading feedback';
      }
    } finally {
      more.disabled = false;
    }
  }
  responses.append(summary, results, status, more);
  section.append(responses);
  load();
  api('/api/custom-surveys?action=catalog')
    .then(({ surveys }) => {
      if (!isCurrent()) return;
      const previous = surveys.filter(
        (survey) => survey.definition?.eventId === row.id,
      );
      if (!previous.length) return;
      const history = node('details');
      history.append(node('summary', 'Previous feedback surveys'));
      for (const survey of previous) {
        const link = node(
          'a',
          survey.title + ' · ' + (survey.expired ? 'expired' : survey.status),
        );
        link.href = '#/surveys/custom/' + survey.id;
        const item = node('p');
        item.append(link);
        history.append(item);
      }
      section.append(history);
    })
    .catch((error) => {
      if (isCurrent()) section.append(node('p', error.message));
    });
  return section;
}
export function eventOverview(row, status, startEditing) {
  const event = row.draft,
    fragment = document.createDocumentFragment();
  fragment.append(
    node('p', 'READ-ONLY', 'eyebrow'),
    node('h3', event.title),
    node('p', status, 'hint'),
  );
  const edit = node('button', 'Edit event');
  if (event.rsvpDeadline)
    fragment.append(
      node('p', 'Please reply by ' + event.rsvpDeadline, 'event-deadline'),
    );
  edit.type = 'button';
  edit.id = 'edit-selected-event';
  edit.onclick = startEditing;
  const actions = node('div', undefined, 'event-actions');
  actions.append(edit);
  if (row.published) {
    const link = node('a', 'View published event ↗');
    link.href =
      row.published.shortLink ||
      'https://dallasai.club/club.html?mode=events&event=' +
        encodeURIComponent(row.id);
    link.target = '_blank';
    link.rel = 'noopener';
    actions.append(link);
    if (row.published.shortLink) {
      const address = node('a', row.published.shortLink);
      address.href = row.published.shortLink;
      address.target = '_blank';
      address.rel = 'noopener';
      const qr = node('a', 'Open event QR ↗');
      qr.href = '/api/events?qr=' + encodeURIComponent(row.id);
      qr.target = '_blank';
      qr.rel = 'noopener';
      fragment.append(address);
      actions.append(qr);
    }
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
      if (question.type === 'availability')
        item.append(node('p', question.dates.join(' · '), 'hint'));
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
