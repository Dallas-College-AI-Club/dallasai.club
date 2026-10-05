import {
  busy,
  button,
  download as save,
  focusFallback,
  h,
  keyed,
  node,
} from './ui.js';
import { dateTime, day, plural } from './format.js';
import { submissionEditor } from './submission-editor.js';
import { isPaused } from './session.js';
import { mountFeedbackGroups } from './custom-surveys.js';
import { availabilityValues } from '../surveys/availability-values.js';
// onReset runs when the filters replace a single-response view, so the
// address can drop the response. openContacts(email) shows the Contacts tab.
export function mountSurveyResults(
  api,
  onContactPurge = () => {},
  onReset = () => {},
  openContacts = () => {},
  options = {},
) {
  const q = (selector) =>
    options.host
      ? options.host.querySelector(
          selector.replace(/#([\w-]+)/g, '[data-survey-ref="$1"]'),
        )
      : document.querySelector(selector);
  const prefix = options.host ? 'inline-' + crypto.randomUUID() + '-' : '';
  const openResponses = new Set(),
    expandedEvents = new Set();
  const feedbackMounts = [];
  const editor = submissionEditor(api, async (result) => {
    await load();
    // The cards were rebuilt under the closed dialog: focus this response.
    if (document.activeElement === document.body)
      (
        q('[data-entry-id="' + CSS.escape(result.entryId) + '"] summary') ||
        (options.host
          ? q('#survey-results > details > summary') || q('#survey-next')
          : q('#event-surveys-root [data-focus-fallback]'))
      )?.focus();
    onContactPurge(result);
    q('#survey-status').textContent = result.removed
      ? result.filesCleaned === false
        ? 'Response deleted. Attachment removal is queued for retry.'
        : 'Response permanently deleted.'
      : 'Response updated.';
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
  search.id = prefix + 'survey-search';
  searchLabel.append(search);
  view.id = prefix + 'survey-view';
  view.append(
    new Option('Active', 'active'),
    new Option('Archived', 'archived'),
    new Option('All saved', 'all'),
  );
  viewLabel.append(view);
  star.type = 'checkbox';
  star.id = prefix + 'survey-starred';
  starLabel.append(star, document.createTextNode('Starred only'));
  tools.append(
    searchLabel,
    viewLabel,
    starLabel,
    button('Contacts & follow-up', () => openContacts()),
  );
  const typeLabel = node('label', 'Response type'),
    type = node('select');
  type.append(
    new Option('RSVP & feedback', 'all'),
    new Option('RSVP', 'rsvp'),
    new Option('Event feedback', 'feedback'),
  );
  typeLabel.append(type);
  tools.prepend(typeLabel);
  const followup = node('div', undefined, 'survey-tools survey-followup'),
    attendanceLabel = node('label', 'Attendance'),
    attendance = node('select'),
    feedbackLabel = node('label', 'Feedback status'),
    feedback = node('select');
  attendance.append(
    new Option('All attendance', 'all'),
    new Option('Attended', 'attended'),
    new Option('Did not attend', 'did_not_attend'),
    new Option('Not recorded', 'not_recorded'),
  );
  feedback.append(
    new Option('Any feedback status', 'all'),
    new Option('Missing feedback', 'missing'),
    new Option('Feedback submitted', 'submitted'),
  );
  attendanceLabel.append(attendance);
  feedbackLabel.append(feedback);
  followup.append(
    node('strong', 'RSVP follow-up'),
    attendanceLabel,
    feedbackLabel,
  );
  q('#survey-status').before(tools);
  tools.after(followup);
  if (options.host) {
    tools.hidden = true;
    followup.hidden = true;
  }
  q('#inbox-pane .heading')?.append(
    button('Contacts & follow-up', () => openContacts()),
  );
  const reportTools = node('div', undefined, 'survey-tools'),
    report = node('div', undefined, 'survey-report'),
    reportDialog = node('dialog', undefined, 'survey-report-dialog'),
    reportHeader = node('div', undefined, 'survey-report-header'),
    reportHeading = node('h2', 'Compiled answers'),
    reportStatus = node('p', '', 'survey-report-status'),
    reportExport = button('Export CSV', () => {}),
    reportClose = button('Close', () => closeReport());
  reportHeading.id = prefix + 'survey-report-heading';
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
  if (options.host) reportTools.hidden = true;
  const filters = (eventId = q('#survey-event').value) =>
    new URLSearchParams({
      eventId,
      entryId,
      search: search.value.trim(),
      view: view.value,
      starred: String(star.checked),
      attendance: attendance.value,
      feedback: feedback.value,
      type: type.value,
      ...(options.surveys?.length === 1
        ? { surveyId: options.surveys[0].id }
        : {}),
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
    const current = () => version === generation && isCurrent();
    try {
      // The anchor goes inside an open modal report, or the click is lost.
      const saved = await save(
        '/api/surveys?' + params,
        (eventId || 'event-surveys') + '-responses.csv',
        {
          container: reportDialog.open ? reportDialog : document.body,
          isCurrent: current,
        },
      );
      if (!saved || !current()) return;
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
        node('h3', plural(data.total, 'matching response') + ' · all pages'),
        node(
          'p',
          'Includes all matching responses. Surveys and changed question versions are shown separately.',
          'hint',
        ),
      );
      for (const group of data.groups) {
        const section = node('details', undefined, 'survey-summary-group');
        section.open = true;
        section.append(
          node(
            'summary',
            [
              group.title,
              group.responseType === 'feedback'
                ? 'Event feedback' +
                  (group.surveyTitle ? ': ' + group.surveyTitle : '')
                : 'RSVP',
              plural(group.count, 'response'),
              'version ' + group.version.slice(0, 8),
            ].join(' · '),
          ),
        );
        for (const question of group.questions) {
          const part = node('section');
          part.append(
            node(
              'h4',
              (question.choiceDate ? question.choiceDate + ' · ' : '') +
                question.label,
            ),
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
                !['single', 'multiple'].includes(question.type)
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
    [
      response.starred,
      response.archived_at,
      response.attendance,
      response.feedback_status,
      response.feedback_submitted_count,
      response.feedback_survey_count,
    ].join(':');
  // Star and Archive patch this card from the POST result instead of
  // reloading, so scroll, open cards and focus stay where they were.
  function card(response) {
    const el = node('details', undefined, 'entry survey-response');
    el.dataset.entryId = response.entry_id;
    el.open =
      Boolean(entryId) ||
      openResponses.has(response.entry_id) ||
      expandedEvents.has(response.event_id);
    el.addEventListener('toggle', () => {
      el.open
        ? openResponses.add(response.entry_id)
        : openResponses.delete(response.entry_id);
      if (!el.open) expandedEvents.delete(response.event_id);
      shown.get(response.event_id)?.updateExpand?.();
    });
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
    const participation = node('span', undefined, 'survey-participation'),
      attendanceControl = node('label', 'Attendance'),
      attendanceValue = node('select');
    attendanceValue.setAttribute(
      'aria-label',
      'Attendance for ' + (response.name || response.email),
    );
    attendanceValue.append(
      new Option('Not recorded', 'not_recorded'),
      new Option('Attended', 'attended'),
      new Option('Did not attend', 'did_not_attend'),
    );
    attendanceControl.append(attendanceValue);
    el.querySelector('summary').append(participation);
    attendanceValue.onchange = async () => {
      const current = generation;
      attendanceValue.disabled = true;
      status.textContent = 'Saving attendance…';
      try {
        await api('/api/surveys', {
          action: 'attendance',
          entryId: response.entry_id,
          value: attendanceValue.value,
        });
        if (current !== generation) return;
        await load();
        q('#survey-status').textContent = 'Attendance saved.';
        q('#survey-results [data-focus]')?.focus();
      } catch (error) {
        if (current === generation) {
          status.textContent = error.message;
          attendanceValue.value = response.attendance || 'not_recorded';
          attendanceValue.disabled = false;
        }
      }
    };
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
    const manageSurvey = node(
      'a',
      'Manage archived RSVP survey',
      'button-link',
    );
    manageSurvey.href = '#/surveys';
    actions.append(
      mark,
      archive,
      button('Contact history', () => openContacts(response.email)),
      button('Edit response', () =>
        editor.open(response.entry_id, { surface: 'survey' }),
      ),
      remove,
      manageSurvey,
    );
    el.patch = (next) => {
      response = next;
      name.textContent =
        (response.starred ? '★ ' : '') + (response.name || response.email);
      when.textContent =
        dateTime(response.created_at) +
        (response.archived_at ? ' · Archived' : '');
      mark.textContent = response.starred ? '★ Unstar' : '☆ Star';
      mark.setAttribute('aria-pressed', String(response.starred));
      archive.textContent = response.archived_at ? 'Restore' : 'Archive';
      archive.hidden = Boolean(response.rsvp_survey_archived);
      remove.hidden = !response.archived_at || response.rsvp_survey_archived;
      manageSurvey.hidden = !response.rsvp_survey_archived;
      attendanceValue.value = response.attendance || 'not_recorded';
      const attendanceText = {
        not_recorded: 'Not recorded',
        attended: 'Attended',
        did_not_attend: 'Did not attend',
      }[attendanceValue.value];
      const feedbackText =
        response.feedback_survey_count > 1
          ? `${response.feedback_submitted_count} of ${response.feedback_survey_count} submitted`
          : response.feedback_status === 'no_survey'
            ? 'No survey'
            : response.feedback_status === 'submitted'
              ? 'Submitted'
              : 'Not submitted';
      participation.replaceChildren(
        node('span', 'Attendance: ' + attendanceText, 'participation-tag'),
        node('span', 'Feedback: ' + feedbackText, 'participation-tag'),
      );
    };
    el.patch(response);
    el.append(
      actions,
      status,
      attendanceControl,
      node(
        'p',
        response.event_date
          ? 'Event date: ' + day(response.event_date)
          : 'Date TBD',
      ),
    );
    const answers = node('dl');
    for (const question of response.questions) {
      const answer = response.answers.find((a) => a.questionId === question.id);
      const values =
        question.type === 'availability'
          ? availabilityValues(answer?.value)
          : (Array.isArray(answer?.value)
              ? answer.value
              : [answer?.value ?? '']
            )
              .filter((value) => value !== '')
              .map((v) => (v === '__other__' ? 'Other: ' + answer.other : v));
      answers.append(
        node(
          'dt',
          (question.choiceDate ? question.choiceDate + ' · ' : '') +
            question.label,
        ),
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
      empty: () => node('p', 'No RSVP responses match these filters.', 'hint'),
    });
    group.summary.textContent = group.title;
    group.rsvpHeading.textContent =
      'RSVP · ' + plural(group.rows.length, 'response') + ' on this page';
    group.updateExpand?.();
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
    render(group);
  }
  async function load() {
    const version = ++generation,
      eventId = options.eventId || q('#survey-event').value;
    for (const mounted of feedbackMounts.splice(0)) mounted.dispose();
    clearTimeout(timer);
    timer = null;
    closeReport();
    q('#survey-status').textContent = 'Loading survey results…';
    q('#survey-results').replaceChildren();
    q('#survey-previous').disabled = q('#survey-next').disabled = true;
    try {
      const params = filters();
      params.set('offset', String(offset));
      const [data, catalog, eventData] = await Promise.all([
        api('/api/surveys?' + params),
        options.surveys
          ? Promise.resolve({ surveys: options.surveys })
          : api('/api/custom-surveys?action=catalog'),
        options.event
          ? Promise.resolve({ events: [options.event] })
          : api('/api/events?admin=1'),
      ]);
      if (version !== generation) return;
      const priorRows = [];
      if (options.host && offset > 0) {
        const earlier = await Promise.all(
          Array.from({ length: offset / 50 }, (_, page) => {
            const previous = new URLSearchParams(params);
            previous.set('offset', String(page * 50));
            return api('/api/surveys?' + previous);
          }),
        );
        if (version !== generation) return;
        priorRows.push(...earlier.flatMap((page) => page.responses));
      }
      if (!data.responses.length && offset > 0 && !options.host) {
        offset = Math.max(0, offset - 50);
        return load();
      }
      const eventChoices = new Map(
        data.events.map((event) => [event.id, event]),
      );
      // Registration exists before the first answer, including without questions.
      // Saved responses still supply events whose registration has since closed.
      for (const event of eventData.events)
        if (event.draft?.registrationOpen || event.published?.registrationOpen)
          eventChoices.set(event.id, {
            id: event.id,
            title: event.draft?.title || event.published?.title || event.id,
            date: event.draft?.date || event.published?.date,
          });
      for (const survey of catalog.surveys) {
        const id = survey.definition?.eventId,
          event = eventData.events.find((e) => e.id === id);
        if (id && !eventChoices.has(id))
          eventChoices.set(id, {
            id,
            title: event?.draft?.title || event?.title || id,
            date: event?.draft?.date || event?.date,
          });
      }
      q('#survey-event').replaceChildren(
        new Option('All events, including past events', ''),
        ...[...eventChoices.values()].map(
          (e) => new Option(e.title + ' · ' + day(e.date), e.id),
        ),
      );
      q('#survey-event').value = eventId;
      shown.clear();
      // Browse empty events on the first page; response filters still narrow the
      // list. An explicitly selected event keeps its own empty state and reports.
      if (
        type.value !== 'feedback' &&
        !entryId &&
        (eventId ||
          (offset === 0 &&
            !search.value.trim() &&
            !star.checked &&
            view.value !== 'archived' &&
            attendance.value === 'all' &&
            feedback.value === 'all'))
      )
        for (const event of eventChoices.values()) {
          if (eventId && event.id !== eventId) continue;
          shown.set(event.id, {
            title: event.title,
            rows: [],
            list: node('div'),
            summary: node('summary'),
            rsvpHeading: node('summary'),
          });
        }
      for (const response of type.value === 'feedback'
        ? []
        : [...priorRows, ...data.responses]) {
        if (!shown.has(response.event_id))
          shown.set(response.event_id, {
            title: response.event_title,
            rows: [],
            list: node('div'),
            summary: node('summary'),
            rsvpHeading: node('summary'),
          });
        const group = shown.get(response.event_id);
        if (!group.rows.some((row) => row.entry_id === response.entry_id))
          group.rows.push(response);
      }
      if (type.value !== 'rsvp' && !star.checked)
        for (const survey of catalog.surveys) {
          const id = survey.definition?.eventId;
          if (!id || (eventId && id !== eventId)) continue;
          if (!shown.has(id))
            shown.set(id, {
              title: eventChoices.get(id)?.title || id,
              rows: [],
              list: node('div'),
              summary: node('summary'),
              rsvpHeading: node('summary'),
            });
        }
      for (const [id, group] of shown) {
        const box = node('details', undefined, 'survey-event-group');
        box.open = true;
        const actions = node('div', undefined, 'survey-response-actions');
        actions.append(
          button('Compile event summary', () => summary(id)),
          button('Export event CSV', () => download(id)),
        );
        const rsvps = node('details', undefined, 'survey-response-kind'),
          feedbackSection = node('details', undefined, 'survey-response-kind');
        rsvps.open = true;
        feedbackSection.open = true;
        rsvps.append(group.rsvpHeading, group.list);
        rsvps.hidden = type.value === 'feedback';
        feedbackSection.hidden = type.value === 'rsvp' || star.checked;
        feedbackSection.append(node('summary', 'Event feedback'));
        const feedbackRoot = node('div');
        feedbackSection.append(feedbackRoot);
        const linked = catalog.surveys.filter(
          (s) => s.definition?.eventId === id,
        );
        if (!feedbackSection.hidden) {
          const mounted = mountFeedbackGroups(feedbackRoot, api, {
            surveys: linked,
            isCurrent: () => version === generation,
            onChange: () => load(),
            search: search.value.trim(),
            view: view.value,
          });
          feedbackMounts.push(mounted);
          group.feedback = mounted;
          if (expandedEvents.has(id)) mounted.setExpanded(true);
        }
        const expand = button('Expand all answers', () => {
          const open = !expandedEvents.has(id);
          open ? expandedEvents.add(id) : expandedEvents.delete(id);
          for (const response of group.rows)
            open
              ? openResponses.add(response.entry_id)
              : openResponses.delete(response.entry_id);
          group.list.querySelectorAll('.survey-response').forEach((card) => {
            card.open = open;
          });
          group.feedback?.setExpanded(open);
          if (open) {
            rsvps.open = true;
            feedbackSection.open = true;
          }
          group.updateExpand();
        });
        group.updateExpand = () => {
          expand.textContent = expandedEvents.has(id)
            ? 'Collapse all answers'
            : 'Expand all answers';
        };
        actions.append(expand);
        if (options.host && options.onFollowup)
          group.rsvpHeading.after(
            button('Filter RSVPs for follow-up →', () =>
              options.onFollowup(id),
            ),
          );
        box.append(group.summary, actions, rsvps, feedbackSection);
        render(group);
        q('#survey-results').append(box);
      }
      q('#survey-status').textContent =
        type.value === 'feedback'
          ? 'Event feedback by event.'
          : plural(data.total, 'matching RSVP response') +
            (type.value === 'all'
              ? '. Feedback appears separately within each event.'
              : '.');
      q('#survey-previous').disabled = offset === 0;
      q('#survey-next').disabled = !data.hasMore;
      q('#survey-page').textContent = 'Page ' + (offset / 50 + 1);
      q('#survey-page').parentElement.hidden = type.value === 'feedback';
      q('#survey-all').hidden = !entryId;
    } catch (error) {
      if (version === generation)
        q('#survey-status').textContent = error.message;
    }
  }
  function reset() {
    entryId = '';
    offset = 0;
    onReset();
    return load();
  }
  search.oninput = () => {
    clearTimeout(timer);
    generation++;
    closeReport();
    timer = setTimeout(reset, 250);
  };
  view.onchange = star.onchange = q('#survey-event').onchange = reset;
  type.onchange = () => {
    if (type.value !== 'rsvp') {
      attendance.value = 'all';
      feedback.value = 'all';
    }
    followup.hidden = Boolean(options.host) || type.value === 'feedback';
    reset();
  };
  attendance.onchange = feedback.onchange = () => {
    if (attendance.value !== 'all' || feedback.value !== 'all')
      type.value = 'rsvp';
    reset();
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
  q('#survey-all').onclick = reset;
  return {
    reload: load,
    // Ten minutes paused: drop the shown responses and history.
    reset() {
      generation++;
      for (const mounted of feedbackMounts.splice(0)) mounted.dispose();
      clearTimeout(timer);
      timer = null;
      shown.clear();
      q('#survey-results').replaceChildren();
      q('#survey-status').textContent = '';
      clearReport();
      reportStatus.textContent = 'Close this and compile the summary again.';
    },
    show(
      id = '',
      eventId = options.eventId || '',
      followupOnly = false,
      responseType = '',
      responseView = '',
    ) {
      entryId = id;
      offset = 0;
      search.value = '';
      view.value = responseView || (id ? 'all' : 'active');
      star.checked = false;
      attendance.value = 'all';
      feedback.value = 'all';
      type.value = followupOnly
        ? 'rsvp'
        : responseType === 'feedback'
          ? 'feedback'
          : 'all';
      followup.hidden = Boolean(options.host);
      if (
        eventId &&
        !Array.from(q('#survey-event').options).some(
          (option) => option.value === eventId,
        )
      )
        q('#survey-event').append(
          new Option(options.event?.draft?.title || eventId, eventId),
        );
      q('#survey-event').value = eventId;
      load();
    },
    dispose() {
      generation++;
      clearTimeout(timer);
      for (const mounted of feedbackMounts.splice(0)) mounted.dispose();
      editor.dispose();
      closeReport();
      reportDialog.remove();
    },
    clear() {
      generation++;
      for (const mounted of feedbackMounts.splice(0)) mounted.dispose();
      clearTimeout(timer);
      entryId = '';
      offset = 0;
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
      attendance.value = 'all';
      feedback.value = 'all';
      type.value = 'all';
      openResponses.clear();
      expandedEvents.clear();
    },
  };
}

export function mountEventSurveyGroup(target, api, event, options = {}) {
  const host = node('section', undefined, 'inline-event-surveys');
  const ref = (tag, id, text) => {
    const el = node(tag, text);
    el.dataset.surveyRef = id;
    return el;
  };
  const select = ref('select', 'survey-event');
  select.append(new Option(event.title || event.id, event.id));
  select.hidden = true;
  const heading = node('h3', event.title || event.id);
  heading.tabIndex = -1;
  heading.dataset.focusFallback = '';
  heading.hidden = true;
  const refresh = ref('button', 'survey-reload', 'Refresh'),
    all = ref('button', 'survey-all', 'Show all responses');
  refresh.hidden = true;
  all.hidden = true;
  const status = ref('p', 'survey-status');
  status.setAttribute('role', 'status');
  const results = ref('div', 'survey-results'),
    paging = node('nav', undefined, 'pagination');
  paging.setAttribute('aria-label', 'RSVP response pages');
  const previous = ref('button', 'survey-previous', 'Previous');
  previous.hidden = true;
  paging.append(
    previous,
    ref('span', 'survey-page'),
    ref('button', 'survey-next', 'Load more responses'),
  );
  host.dataset.surveyRef = 'event-surveys-root';
  host.append(heading, select, refresh, all, status, results, paging);
  target.append(host);
  const controller = mountSurveyResults(
    api,
    options.onChange,
    () => {},
    options.openContacts,
    { ...options, host, eventId: event.id, event },
  );
  controller.show();
  return controller;
}
