import { busy, button, focusFallback, h, keyed, node } from './ui.js';
import { activityTime } from './event-activity.js';
import { contactHistory } from './contact-history.js';
import { submissionEditor } from './submission-editor.js';
import { isPaused, signedInAgain } from './session.js';
export function mountSurveyResults(api, onContactPurge = () => {}) {
  const editor = submissionEditor(api, async (result) => {
    await load();
    onContactPurge(result);
    document.querySelector('#survey-status').textContent = result.removed
      ? result.filesCleaned === false
        ? 'Response deleted. Attachment removal is queued for retry.'
        : 'Response permanently deleted.'
      : 'Response updated.';
  });
  const q = (s) => document.querySelector(s),
    contacts = contactHistory(api, (result) => {
      load();
      if (result.purged) onContactPurge();
    });
  let offset = 0,
    entryId = '',
    generation = 0,
    reportGeneration = 0,
    timer,
    reportReturnFocus;
  // The rendered page: event id → { rows, list, summary }.
  const shown = new Map();
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
    report = node('div', undefined, 'survey-report'),
    reportDialog = node('dialog', undefined, 'survey-report-dialog'),
    reportHeader = node('div', undefined, 'survey-report-header'),
    reportHeading = node('h2', 'Compiled answers'),
    reportStatus = node('p', '', 'survey-report-status'),
    reportExport = button('Export CSV', () => {}),
    reportClose = button('Close', () => closeReport());
  reportHeading.id = 'survey-report-heading';
  reportHeading.tabIndex = -1;
  reportDialog.setAttribute('aria-labelledby', reportHeading.id);
  reportStatus.setAttribute('role', 'status');
  reportHeader.append(reportHeading, reportExport, reportClose, reportStatus);
  reportDialog.append(reportHeader, report);
  document.body.append(reportDialog);
  function clearReport() {
    reportGeneration++;
    report.replaceChildren();
    reportStatus.textContent = '';
    reportExport.disabled = true;
    reportExport.onclick = null;
    document.documentElement.classList.remove('survey-report-open');
    if (reportReturnFocus) {
      const target = reportReturnFocus.isConnected
        ? reportReturnFocus
        : reportTools.querySelector('button');
      if (target?.getClientRects().length)
        target.focus({ preventScroll: true });
      reportReturnFocus = null;
    }
  }
  function closeReport() {
    if (reportDialog.open) reportDialog.close();
    clearReport();
  }
  reportDialog.addEventListener('close', () => {
    if (!reportDialog.open && !isPaused()) clearReport();
  });
  reportDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeReport();
  });
  reportDialog.addEventListener('click', (event) => {
    if (event.target !== reportDialog) return;
    const bounds = reportDialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      closeReport();
  });
  reportTools.append(
    button('Compile summary', () => summary()),
    button('Export matching CSV', () => download()),
  );
  q('#survey-status').after(reportTools);
  const filters = (eventId = q('#survey-event').value) =>
    new URLSearchParams({
      eventId,
      entryId,
      search: search.value.trim(),
      view: view.value,
      starred: String(star.checked),
    });
  async function download(
    eventId,
    { scope, status = q('#survey-status'), isCurrent = () => true } = {},
  ) {
    if (timer) await reset();
    const version = generation,
      params = scope ? new URLSearchParams(scope) : filters(eventId);
    if (eventId) params.delete('entryId');
    params.set('export', 'csv');
    status.textContent = 'Preparing CSV for all matching responses…';
    const get = () =>
      fetch('/api/surveys?' + params, { credentials: 'same-origin' });
    try {
      let response = await get();
      // The session ended: download once the officer has signed in again.
      if (response.status === 401) {
        await signedInAgain();
        response = await get();
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw Error(data.error || 'Could not export responses.');
      }
      const blob = await response.blob();
      if (version !== generation || !isCurrent()) return;
      const link = node('a');
      link.href = URL.createObjectURL(blob);
      link.download = (eventId || 'event-surveys') + '-responses.csv';
      link.hidden = true;
      (reportDialog.open ? reportDialog : document.body).append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      status.textContent =
        'CSV downloaded. It includes all matching responses across every page.';
    } catch (error) {
      if (version === generation && isCurrent())
        status.textContent = error.message;
    }
  }
  async function summary(eventId) {
    const trigger = document.activeElement;
    if (timer) await reset();
    reportReturnFocus = trigger;
    const version = generation,
      params = filters(eventId);
    const reportVersion = ++reportGeneration;
    if (eventId) params.delete('entryId');
    const scope = new URLSearchParams(params);
    const isCurrent = () =>
      reportDialog.open &&
      version === generation &&
      reportVersion === reportGeneration;
    report.replaceChildren();
    reportStatus.textContent = 'Compiling all matching responses…';
    reportExport.disabled = true;
    reportExport.onclick = async () => {
      if (!isCurrent()) return;
      reportExport.disabled = true;
      await download(eventId, { scope, status: reportStatus, isCurrent });
      if (isCurrent()) reportExport.disabled = false;
    };
    document.documentElement.classList.add('survey-report-open');
    if (!reportDialog.open) reportDialog.showModal();
    reportHeading.focus({ preventScroll: true });
    report.scrollTop = 0;
    params.set('summary', '1');
    try {
      const data = await api('/api/surveys?' + params);
      if (!isCurrent()) return;
      reportStatus.textContent = '';
      reportExport.disabled = data.total === 0;
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
      if (isCurrent()) reportStatus.textContent = error.message;
    }
  }
  const cardVersion = (response) =>
    response.starred + ':' + (response.archived_at || '');
  // Star and Archive patch this card from the POST result instead of
  // reloading, so scroll, open cards and focus stay where they were.
  function card(response) {
    const el = node('details', undefined, 'entry survey-response');
    el.dataset.entryId = response.entry_id;
    el.open = Boolean(entryId);
    const name = h('strong'),
      when = h('small');
    el.append(
      h(
        'summary',
        { 'data-focus': '' },
        name,
        h('span', {}, response.email),
        when,
      ),
    );
    const actions = node('div', undefined, 'survey-response-actions'),
      status = node('p');
    status.setAttribute('role', 'status');
    async function manage(action, value) {
      const current = generation,
        release = busy(actions);
      try {
        const result = await api('/api/surveys', {
          entryId: response.entry_id,
          action,
          value,
        });
        if (current !== generation) return;
        release();
        patch({
          ...response,
          starred: result.starred,
          archived_at: result.archived_at,
        });
        // Say it beside the button while the card stays, so nothing above
        // it changes height and the page does not shift.
        (el.isConnected ? status : q('#survey-status')).textContent =
          action === 'star'
            ? value
              ? 'Response starred.'
              : 'Star removed.'
            : value
              ? 'Response archived. Find it under Archived to restore it.'
              : 'Response restored to Active.';
      } catch (error) {
        if (current === generation) {
          status.textContent = error.message;
          release();
        }
      }
    }
    const mark = button('', () => manage('star', !response.starred)),
      archive = button('', () => manage('archive', !response.archived_at)),
      remove = button('Delete permanently', () =>
        editor.open(response.entry_id, {
          surface: 'survey',
          remove: true,
        }),
      );
    remove.classList.add('danger');
    actions.append(
      mark,
      archive,
      button('Contact history', () => contacts.open(response.email)),
      button('Edit response', () =>
        editor.open(response.entry_id, { surface: 'survey' }),
      ),
      remove,
    );
    el.patch = (next) => {
      response = next;
      name.textContent =
        (response.starred ? '★ ' : '') + (response.name || response.email);
      when.textContent =
        activityTime(response.created_at) +
        (response.archived_at ? ' · Archived' : '');
      mark.textContent = response.starred ? '★ Unstar' : '☆ Star';
      mark.setAttribute('aria-pressed', String(response.starred));
      archive.textContent = response.archived_at ? 'Restore' : 'Archive';
      remove.hidden = !response.archived_at;
    };
    el.patch(response);
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
  const matches = (response) =>
    (view.value === 'all' ||
      (view.value === 'archived') === Boolean(response.archived_at)) &&
    (!star.checked || response.starred);
  function render(group) {
    keyed(group.list, group.rows, {
      key: (response) => response.entry_id,
      version: cardVersion,
      create: card,
      update: (el, response) => el.patch(response),
    });
    group.summary.textContent =
      group.rows[0]?.event_title + ' · ' + group.rows.length + ' on this page';
  }
  // A card that no longer matches the filters leaves; focus moves to the
  // next card rather than to <body>.
  function patch(response) {
    const group = shown.get(response.event_id);
    if (!group) return;
    const el = group.list.querySelector(
      '[data-key="' + CSS.escape(response.entry_id) + '"]',
    );
    group.rows = group.rows
      .map((row) => (row.entry_id === response.entry_id ? response : row))
      .filter(matches);
    if (el?.contains(document.activeElement) && !matches(response))
      focusFallback(el, q('#survey-results'));
    if (group.rows.length) render(group);
    else {
      group.list.closest('.survey-event-group').remove();
      shown.delete(response.event_id);
    }
  }
  async function load() {
    const version = ++generation,
      eventId = q('#survey-event').value;
    clearTimeout(timer);
    timer = null;
    closeReport();
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
      shown.clear();
      for (const response of data.responses) {
        if (!shown.has(response.event_id))
          shown.set(response.event_id, {
            rows: [],
            list: node('div'),
            summary: node('summary'),
          });
        shown.get(response.event_id).rows.push(response);
      }
      for (const [id, group] of shown) {
        const box = node('details', undefined, 'survey-event-group');
        box.open = true;
        const actions = node('div', undefined, 'survey-response-actions');
        actions.append(
          button('Compile event summary', () => summary(id)),
          button('Export event CSV', () => download(id)),
        );
        box.append(group.summary, actions, group.list);
        render(group);
        q('#survey-results').append(box);
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
    return load();
  }
  search.oninput = () => {
    clearTimeout(timer);
    generation++;
    closeReport();
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
    reload: load,
    // Ten minutes paused: drop the shown responses and history.
    reset() {
      generation++;
      clearTimeout(timer);
      timer = null;
      shown.clear();
      q('#survey-results').replaceChildren();
      q('#survey-status').textContent = '';
      clearReport();
      reportStatus.textContent = 'Close this and compile the summary again.';
      contacts.reset();
    },
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
      editor.clear();
      closeReport();
      shown.clear();
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
