import { activityTime } from './event-activity.js';
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
export function mountSurveyResults(api) {
  const q = (selector) => document.querySelector(selector);
  let offset = 0,
    entryId = '',
    generation = 0;
  async function load() {
    const version = ++generation,
      eventId = q('#survey-event').value;
    q('#survey-status').textContent = 'Loading survey results…';
    q('#survey-results').replaceChildren();
    q('#survey-previous').disabled = q('#survey-next').disabled = true;
    try {
      const params = new URLSearchParams({
        eventId,
        entryId,
        offset: String(offset),
      });
      const data = await api('/api/surveys?' + params);
      if (version !== generation) return;
      q('#survey-event').replaceChildren(
        new Option('All events, including past events', ''),
        ...data.events.map(
          (event) =>
            new Option(
              event.title + ' · ' + (event.date?.slice(0, 10) || 'TBD'),
              event.id,
            ),
        ),
      );
      if (
        [...q('#survey-event').options].some(
          (option) => option.value === eventId,
        )
      )
        q('#survey-event').value = eventId;
      q('#survey-results').replaceChildren(
        ...data.responses.map((response) => {
          const card = node('article', undefined, 'entry survey-response');
          card.append(
            node('h3', response.event_title),
            node(
              'p',
              'Event date: ' + (response.event_date?.slice(0, 10) || 'TBD'),
            ),
            node('h4', response.name),
          );
          const email = node('a', response.email);
          email.href = 'mailto:' + response.email;
          card.append(
            email,
            node('p', 'Received ' + activityTime(response.created_at)),
          );
          const details = node('dl');
          for (const question of response.questions) {
            const answer = response.answers.find(
              (answer) => answer.questionId === question.id,
            );
            let values = Array.isArray(answer?.value)
              ? answer.value
              : [answer?.value || ''];
            values = values
              .filter(Boolean)
              .map((value) =>
                value === '__other__' ? 'Other: ' + answer.other : value,
              );
            details.append(
              node('dt', question.label),
              node('dd', values.length ? values.join('\n') : 'No answer'),
            );
          }
          card.append(details);
          return card;
        }),
      );
      q('#survey-status').textContent = data.responses.length
        ? entryId
          ? 'Showing this RSVP’s survey answers.'
          : 'Showing saved survey responses. Questions and event details reflect the time of submission.'
        : 'No survey responses match this view.';
      q('#survey-previous').disabled = offset === 0;
      q('#survey-next').disabled = !data.hasMore;
      q('#survey-page').textContent = 'Page ' + (offset / 50 + 1);
      q('#survey-all').hidden = !entryId;
    } catch (error) {
      if (version === generation)
        q('#survey-status').textContent = error.message;
    }
  }
  q('#survey-event').onchange = () => {
    offset = 0;
    entryId = '';
    history.replaceState({}, '', '#surveys');
    load();
  };
  q('#survey-reload').onclick = load;
  q('#survey-previous').onclick = () => {
    offset = Math.max(0, offset - 50);
    load();
  };
  q('#survey-next').onclick = () => {
    offset += 50;
    load();
  };
  q('#survey-all').onclick = () => {
    entryId = '';
    offset = 0;
    history.replaceState({}, '', '#surveys');
    load();
  };
  return {
    show(id = '') {
      entryId = id;
      offset = 0;
      q('#survey-event').value = '';
      load();
    },
    clear() {
      generation++;
      entryId = '';
      offset = 0;
      q('#survey-results').replaceChildren();
      q('#survey-event').replaceChildren(
        new Option('All events, including past events', ''),
      );
      q('#survey-status').textContent = '';
      q('#survey-page').textContent = '';
    },
  };
}
