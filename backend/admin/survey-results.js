import { activityTime } from './event-activity.js';
import { contactHistory } from './contact-history.js';
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
const button = (text, handler) => {
  const el = node('button', text, 'secondary');
  el.type = 'button';
  el.onclick = handler;
  return el;
};
export function mountSurveyResults(api) {
  const q = (s) => document.querySelector(s),
    contacts = contactHistory(api);
  let offset = 0,
    entryId = '',
    generation = 0,
    reportGeneration = 0,
    timer;
  const tools = node('div', undefined, 'survey-tools'),
    searchLabel = node('label', 'Name or email'),
    search = node('input'),
    viewLabel = node('label', 'Responses'),
    view = node('select'),
    starLabel = node('label', undefined, 'survey-star-filter'),
    star = node('input');
  search.type = 'search';
  search.maxLength = 200;
  search.placeholder = 'Search saved responses';
  search.id = 'survey-search';
  searchLabel.append(search);
  view.id = 'survey-view';
  view.append(
    new Option('Active', 'active'),
    new Option('Archived', 'archived'),
    new Option('All saved', 'all'),
  );
  viewLabel.append(view);
  star.type = 'checkbox';
  star.id = 'survey-starred';
  starLabel.append(star, document.createTextNode('Starred only'));
  tools.append(
    searchLabel,
    viewLabel,
    starLabel,
    button('Contacts & follow-up', () => contacts.open()),
  );
  q('#survey-status').before(tools);
  q('#inbox-pane .heading')?.append(
    button('Contacts & follow-up', () => contacts.open()),
  );
  const reportTools = node('div', undefined, 'survey-tools'),
    report = node('div', undefined, 'survey-report');
  reportTools.append(
    button('Compile summary', () => summary()),
    button('Export matching CSV', () => download()),
  );
  q('#survey-status').after(reportTools, report);
  const filters = (eventId = q('#survey-event').value) =>
    new URLSearchParams({
      eventId,
      entryId,
      search: search.value.trim(),
      view: view.value,
      starred: String(star.checked),
    });
  async function download(eventId) {
    const version = generation,
      params = filters(eventId);
    if (eventId) params.delete('entryId');
    params.set('export', 'csv');
    q('#survey-status').textContent =
      'Preparing CSV for all matching responses…';
    try {
      const response = await fetch('/api/surveys?' + params, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        if (response.status === 401) await api('/api/surveys');
        const data = await response.json();
        throw Error(data.error || 'Could not export responses.');
      }
      const blob = await response.blob();
      if (version !== generation) return;
      const link = node('a');
      link.href = URL.createObjectURL(blob);
      link.download = (eventId || 'event-surveys') + '-responses.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      q('#survey-status').textContent =
        'CSV downloaded. It includes all matching responses across every page.';
    } catch (error) {
      if (version === generation)
        q('#survey-status').textContent = error.message;
    }
  }
  async function summary(eventId) {
    const version = generation,
      params = filters(eventId);
    const reportVersion = ++reportGeneration;
    if (eventId) params.delete('entryId');
    params.set('summary', '1');
    report.replaceChildren(node('p', 'Compiling all matching responses…'));
    try {
      const data = await api('/api/surveys?' + params);
      if (version !== generation || reportVersion !== reportGeneration) return;
      report.replaceChildren(
        node('h3', data.total + ' matching responses · all pages'),
        node(
          'p',
          'Uses the current search, archive and star filters. Changed question versions are shown separately.',
          'hint',
        ),
      );
      for (const group of data.groups) {
        const section = node('details', undefined, 'survey-summary-group');
        section.open = true;
        section.append(
          node(
            'summary',
            group.title +
              ' · ' +
              group.count +
              ' responses · version ' +
              group.version.slice(0, 8),
          ),
        );
        for (const question of group.questions) {
          const part = node('section');
          part.append(
            node('h4', question.label),
            node(
              'p',
              question.answered +
                ' answered · ' +
                question.skipped +
                ' skipped',
              'hint',
            ),
          );
          if (question.choices.length) {
            const list = node('ul', undefined, 'survey-counts');
            for (const choice of question.choices)
              list.append(
                node(
                  'li',
                  choice.label +
                    ' — ' +
                    choice.count +
                    ' (' +
                    choice.percent +
                    '%)',
                ),
              );
            part.append(
              list,
              node(
                'p',
                question.type === 'multiple'
                  ? 'Percent of people who answered; multiple selections may total more than 100%.'
                  : 'Percent of people who answered this question.',
                'hint',
              ),
            );
          }
          if (question.written.length) {
            const written = node('details');
            written.append(
              node(
                'summary',
                question.type === 'text'
                  ? 'Written answers (' + question.written.length + ')'
                  : 'Other answers (' + question.written.length + ')',
              ),
            );
            for (const answer of question.written)
              written.append(
                node(
                  'p',
                  (answer.name || answer.email) + ': ' + answer.value,
                  'contact-note-text',
                ),
              );
            part.append(written);
          }
          section.append(part);
        }
        report.append(section);
      }
    } catch (error) {
      if (version === generation && reportVersion === reportGeneration)
        report.replaceChildren(node('p', error.message));
    }
  }
  function card(response) {
    const el = node('details', undefined, 'entry survey-response');
    el.dataset.entryId = response.entry_id;
    el.open = Boolean(entryId);
    const heading = node('summary');
    heading.append(
      node(
        'strong',
        (response.starred ? '★ ' : '') + (response.name || response.email),
      ),
      node('span', response.email),
      node(
        'small',
        activityTime(response.created_at) +
          (response.archived_at ? ' · Archived' : ''),
      ),
    );
    el.append(heading);
    const actions = node('div', undefined, 'survey-response-actions'),
      status = node('p');
    status.setAttribute('role', 'status');
    async function manage(action, value) {
      const version = generation;
      actions.querySelectorAll('button').forEach((b) => (b.disabled = true));
      try {
        await api('/api/surveys', {
          entryId: response.entry_id,
          action,
          value,
        });
        if (version !== generation) return;
        await load();
        q('#survey-status').textContent =
          action === 'star'
            ? value
              ? 'Response starred.'
              : 'Star removed.'
            : value
              ? 'Response archived. Find it under Archived to restore it.'
              : 'Response restored to Active.';
      } catch (error) {
        if (version === generation) {
          status.textContent = error.message;
          actions
            .querySelectorAll('button')
            .forEach((b) => (b.disabled = false));
        }
      }
    }
    const mark = button(response.starred ? '★ Unstar' : '☆ Star', () =>
      manage('star', !response.starred),
    );
    mark.setAttribute('aria-pressed', String(response.starred));
    actions.append(
      mark,
      button(response.archived_at ? 'Restore' : 'Archive', () =>
        manage('archive', !response.archived_at),
      ),
      button('Contact history', () => contacts.open(response.email)),
    );
    el.append(
      actions,
      status,
      node('p', 'Event date: ' + (response.event_date?.slice(0, 10) || 'TBD')),
    );
    const answers = node('dl');
    for (const question of response.questions) {
      const answer = response.answers.find((a) => a.questionId === question.id);
      const values = (
        Array.isArray(answer?.value) ? answer.value : [answer?.value || '']
      )
        .filter(Boolean)
        .map((v) => (v === '__other__' ? 'Other: ' + answer.other : v));
      answers.append(
        node('dt', question.label),
        node('dd', values.length ? values.join('\n') : 'No answer'),
      );
    }
    el.append(answers);
    return el;
  }
  async function load() {
    const version = ++generation,
      eventId = q('#survey-event').value;
    clearTimeout(timer);
    report.replaceChildren();
    q('#survey-status').textContent = 'Loading survey results…';
    q('#survey-results').replaceChildren();
    q('#survey-previous').disabled = q('#survey-next').disabled = true;
    try {
      const params = filters();
      params.set('offset', String(offset));
      const data = await api('/api/surveys?' + params);
      if (version !== generation) return;
      if (!data.responses.length && offset > 0) {
        offset = Math.max(0, offset - 50);
        return load();
      }
      q('#survey-event').replaceChildren(
        new Option('All events, including past events', ''),
        ...data.events.map(
          (e) =>
            new Option(e.title + ' · ' + (e.date?.slice(0, 10) || 'TBD'), e.id),
        ),
      );
      q('#survey-event').value = eventId;
      const groups = new Map();
      for (const response of data.responses) {
        if (!groups.has(response.event_id)) groups.set(response.event_id, []);
        groups.get(response.event_id).push(response);
      }
      for (const [id, rows] of groups) {
        const group = node('details', undefined, 'survey-event-group');
        group.open = true;
        group.append(
          node(
            'summary',
            rows[0].event_title + ' · ' + rows.length + ' on this page',
          ),
        );
        const actions = node('div', undefined, 'survey-response-actions');
        actions.append(
          button('Compile event summary', () => summary(id)),
          button('Export event CSV', () => download(id)),
        );
        group.append(actions, ...rows.map(card));
        q('#survey-results').append(group);
      }
      q('#survey-status').textContent =
        data.total +
        ' matching saved responses. Expand a person to read answers or manage their response.';
      q('#survey-previous').disabled = offset === 0;
      q('#survey-next').disabled = !data.hasMore;
      q('#survey-page').textContent = 'Page ' + (offset / 50 + 1);
      q('#survey-all').hidden = !entryId;
    } catch (error) {
      if (version === generation)
        q('#survey-status').textContent = error.message;
    }
  }
  function reset() {
    entryId = '';
    offset = 0;
    history.replaceState({}, '', '#surveys');
    load();
  }
  search.oninput = () => {
    clearTimeout(timer);
    generation++;
    report.replaceChildren();
    timer = setTimeout(reset, 250);
  };
  view.onchange = star.onchange = q('#survey-event').onchange = reset;
  q('#survey-reload').onclick = load;
  q('#survey-previous').onclick = () => {
    offset = Math.max(0, offset - 50);
    load();
  };
  q('#survey-next').onclick = () => {
    offset += 50;
    load();
  };
  q('#survey-all').onclick = reset;
  return {
    show(id = '') {
      entryId = id;
      offset = 0;
      search.value = '';
      view.value = id ? 'all' : 'active';
      star.checked = false;
      q('#survey-event').value = '';
      load();
    },
    clear() {
      generation++;
      clearTimeout(timer);
      entryId = '';
      offset = 0;
      contacts.clear();
      report.replaceChildren();
      q('#survey-results').replaceChildren();
      q('#survey-event').replaceChildren(
        new Option('All events, including past events', ''),
      );
      q('#survey-status').textContent = '';
      q('#survey-page').textContent = '';
      search.value = '';
      view.value = 'active';
      star.checked = false;
    },
  };
}
