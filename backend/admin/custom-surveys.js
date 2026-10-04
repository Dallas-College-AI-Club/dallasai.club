import { copyText, download as save, node } from './ui.js';
import { actionLabel, actorLabel, dateTime, isoDay, plural } from './format.js';
import { currentOfficer } from './session.js';
import { mountRespondents } from './survey-respondents.js';
import { mountSurveyBuilder } from './survey-builder.js';
import {
  answerRank,
  fileSlug,
  partitionResponses,
  responseSections,
} from '../surveys/results-ui.js';
import { closePrintView, downloadResponse } from './response-download.js';
import { surveyQR } from './survey-qr.js';
import { go } from './router.js';
// Self-registered respondents may have no display name; officers see the
// email instead. Respondent-facing pages keep their own masking.
const named = (results) =>
  results.map((result) => ({
    ...result,
    display_name: result.display_name || result.email,
  }));
export async function allSurveyResponses(
  api,
  id,
  first,
  isCurrent = () => true,
  scope = {},
) {
  const results = [...first.results];
  let offset = first.nextOffset;
  while (offset !== null && offset !== undefined && isCurrent()) {
    const page = await api(
      '/api/custom-surveys?' +
        new URLSearchParams({ action: 'results', id, offset, ...scope }),
    );
    if (!isCurrent()) return [];
    results.push(...page.results);
    offset = page.nextOffset;
  }
  const groups = partitionResponses(results);
  return named(
    scope.view === 'archived'
      ? groups.archived
      : scope.view === 'all'
        ? [...groups.active, ...groups.archived]
        : groups.active,
  );
}
function consolidatedAnswers(results, definition) {
  const root = node('div', undefined, 'survey-report');
  const questions = new Map(
    (definition?.questions || []).map((question) => [
      question.id,
      { title: question.title, answers: [] },
    ]),
  );
  for (const result of results)
    for (const answer of result.responses) {
      if (!questions.has(answer.id))
        questions.set(answer.id, { title: answer.title, answers: [] });
      questions.get(answer.id).answers.push({ result, answer });
    }
  const rank = answerRank(definition);
  for (const [id, question] of [...questions].sort(
    ([a], [b]) => rank({ id: a }) - rank({ id: b }),
  )) {
    const section = node('section', undefined, 'response-answer');
    section.append(node('h4', question.title));
    if (!question.answers.length) section.append(node('p', 'No answers yet.'));
    for (const { result, answer } of question.answers)
      section.append(
        node('strong', result.display_name),
        node('p', answer.text),
      );
    root.append(section);
  }
  if (!results.length) root.prepend(node('p', 'No matching saved responses.'));
  return root;
}
function surveySummary(survey) {
  const summary = node('summary', undefined, 'survey-library-summary');
  const title = node('div');
  title.append(node('strong', survey.title));
  const dates = [];
  if (survey.published_at)
    dates.push('Published ' + dateTime(survey.published_at));
  if (survey.status !== 'draft' && survey.expires_at)
    dates.push('Ends ' + dateTime(survey.expires_at));
  if (dates.length) title.append(node('p', dates.join(' · '), 'hint'));
  const status = survey.expired
    ? 'Expired'
    : survey.status === 'open'
      ? 'Published'
      : survey.status[0].toUpperCase() + survey.status.slice(1);
  summary.append(
    title,
    node(
      'span',
      status,
      'chip' + (survey.status === 'draft' ? ' survey-draft' : ''),
    ),
    node('span', plural(survey.response_count, 'response'), 'hint'),
  );
  return summary;
}
export function mountFeedbackGroups(
  root,
  api,
  {
    surveys,
    isCurrent = () => true,
    onChange = () => {},
    search = '',
    view = 'active',
  } = {},
) {
  let disposed = false,
    expanded = null;
  const mounted = [];
  root.replaceChildren();
  for (const survey of [...surveys].sort(
    (a, b) => Number(b.status === 'draft') - Number(a.status === 'draft'),
  )) {
    const card = node(
      'details',
      undefined,
      'survey-library-row custom-survey-group',
    );
    const body = node('div', undefined, 'custom-survey-group-body');
    const open = node('a', 'Open survey →', 'button-link');
    open.href = '#/surveys/custom/' + survey.id;
    card.append(surveySummary(survey), open, body);
    root.append(card);
    let controller;
    const entry = {
      card,
      dispose: () => controller?.clear(),
      setExpanded: (value) => controller?.setExpanded(value),
    };
    mounted.push(entry);
    card.ontoggle = async () => {
      if (!card.open || controller || disposed || !isCurrent()) return;
      controller = mountCustomSurveys(body, api, {
        inline: true,
        id: survey.id,
        isCurrent: () => !disposed && isCurrent(),
        onChange,
        search,
        view,
        expanded,
      });
      await controller.load();
    };
  }
  if (!surveys.length)
    root.append(node('p', 'No feedback surveys yet.', 'empty-state'));
  return {
    setExpanded(value) {
      expanded = value;
      for (const entry of mounted) {
        entry.card.open = value;
        entry.setExpanded(value);
      }
    },
    dispose() {
      disposed = true;
      for (const entry of mounted) entry.dispose();
      root.replaceChildren();
    },
  };
}
export function mountCustomSurveys(root, api, options = {}) {
  let generation = 0,
    selected = options.id || '',
    builder,
    eventFilter = '',
    expandResponses,
    reload = () => load();
  const groups = [];
  function stopGroups() {
    for (const group of groups.splice(0)) group?.dispose?.();
  }
  function stopBuilder() {
    builder?.dispose();
    builder = null;
  }
  async function load(filter) {
    reload = () => load();
    if (typeof filter === 'string') eventFilter = filter;
    stopBuilder();
    stopGroups();
    closePrintView();
    const current = ++generation;
    root.replaceChildren(node('p', 'Loading custom surveys…'));
    try {
      const catalog = await api('/api/custom-surveys?action=catalog');
      const surveys = catalog.surveys.filter(
        (survey) =>
          (!eventFilter || survey.definition?.eventId === eventFilter) &&
          (!options.inline || survey.id === options.id),
      );
      if (current !== generation || options.isCurrent?.() === false) return;
      root.replaceChildren();
      if (!options.inline)
        root.append(
          node('h2', 'Custom surveys'),
          node(
            'p',
            'Create surveys, manage respondents, and read submitted results.',
          ),
        );
      const create = node('button', 'Create custom survey', 'btn-primary');
      const edit = (id) => {
        generation++;
        builder = mountSurveyBuilder(
          root,
          api,
          async (next) => {
            if (next) selected = next;
            await load();
          },
          id,
        );
      };
      create.onclick = () =>
        go('#/surveys/new' + (eventFilter ? '?event=' + eventFilter : ''));
      if (!options.inline) root.append(create);
      if (!surveys.length) {
        root.append(node('p', 'No custom surveys have been opened yet.'));
        return;
      }
      const label = node('label', 'Survey'),
        select = node('select');
      select.setAttribute('aria-label', 'Custom survey');
      for (const survey of surveys) {
        const option = node(
          'option',
          `${survey.title} · ${survey.expired ? 'expired' : survey.status} · ${plural(survey.response_count, 'active response')}${survey.archived_response_count ? ` · ${survey.archived_response_count} archived` : ''}`,
        );
        option.value = survey.id;
        select.append(option);
      }
      if (surveys.some((s) => s.id === selected)) select.value = selected;
      label.append(select);
      const refresh = node('button', 'Refresh results', 'secondary'),
        top = node('div', undefined, 'custom-survey-controls');
      const responseView = node('select');
      responseView.setAttribute('aria-label', 'Custom survey responses');
      for (const [value, title] of [
        ['active', 'Active'],
        ['archived', 'Archived'],
        ['all', 'All saved'],
      ]) {
        const option = node('option', title);
        option.value = value;
        responseView.append(option);
      }
      responseView.value = options.view || 'active';
      top.append(label, responseView, refresh);
      if (!options.inline) root.append(top);
      const content = node('div');
      root.append(content);
      let requestGeneration = 0;
      async function show() {
        const request = ++requestGeneration;
        selected = select.value;
        const scope = {
          view: responseView.value,
          search: options.search?.trim() || '',
        };
        content.replaceChildren(node('p', 'Loading shared responses…'));
        try {
          const data = await api(
            '/api/custom-surveys?' +
              new URLSearchParams({
                action: 'results',
                id: selected,
                ...scope,
              }),
          );
          if (current !== generation || request !== requestGeneration) return;
          const survey = surveys.find((s) => s.id === selected);
          content.replaceChildren(
            node(
              'p',
              survey.definition
                ? 'Saved responses · read-only. Each new submission replaces the respondent’s previous response.'
                : 'Current shared responses · read-only. Each new submission replaces the advisor’s previous shared summary.',
            ),
          );
          if (survey.definition?.eventId) {
            const related = node(
              'p',
              'Linked event: ' + survey.definition.eventId,
              'hint',
            );
            content.prepend(related);
          }
          if (survey.definition) {
            const duplicate = node('a', 'Duplicate survey', 'button-link');
            duplicate.href = '#/surveys/new?copy=' + survey.id;
            content.append(duplicate);
            if (survey.status === 'draft') {
              const resume = node('button', 'Continue editing draft');
              resume.onclick = () =>
                options.inline
                  ? go('#/surveys/custom/' + survey.id)
                  : edit(survey.id);
              content.append(resume);
            }
            const permissions = survey.definition.permissions;
            content.append(
              node(
                'p',
                `Preview: ${permissions.preview === 'link' ? 'anyone with preview link' : 'verified respondents'} · Answering: ${permissions.answer === 'verified' ? 'any verified email' : 'approved respondents'} · Results: ${permissions.results === 'admins' ? 'admins only' : 'admins and respondents'}`,
                'hint',
              ),
            );
            if (survey.status === 'open') {
              const close = node('button', 'Close survey', 'secondary'),
                closeNote = node('p');
              close.onclick = () => {
                close.disabled = true;
                closeNote.textContent =
                  'Closing stops previews and new answers. Saved results remain available.';
                const confirm = node('button', 'Confirm close', 'secondary');
                const cancel = node('button', 'Cancel closing', 'secondary');
                cancel.onclick = () => {
                  confirm.remove();
                  cancel.remove();
                  close.disabled = false;
                  closeNote.textContent = '';
                  close.focus();
                };
                confirm.onclick = async () => {
                  confirm.disabled = true;
                  cancel.disabled = true;
                  try {
                    const { survey: latest } = await api(
                      '/api/custom-surveys?action=draft&id=' + survey.id,
                    );
                    await api('/api/custom-surveys?action=draft-change', {
                      id: survey.id,
                      action: 'close',
                      definition: latest.definition,
                      expectedRevision: latest.edit_revision,
                      requestId: crypto.randomUUID(),
                    });
                    if (current !== generation || request !== requestGeneration)
                      return;
                    const reloadGeneration = generation + 1;
                    await load();
                    options.onChange?.();
                    if (generation !== reloadGeneration) return;
                    const notice = node(
                      'p',
                      'Survey closed. Saved responses remain available.',
                    );
                    notice.setAttribute('role', 'status');
                    root.prepend(notice);
                  } catch (error) {
                    closeNote.textContent = error.message;
                    confirm.disabled = false;
                    cancel.disabled = false;
                  }
                };
                content.insertBefore(confirm, closeNote);
                content.insertBefore(cancel, closeNote);
              };
              content.append(close, closeNote);
            }
          }
          content.append(
            node(
              'p',
              survey.status === 'draft'
                ? 'Draft · the answering period begins when you publish.'
                : survey.status === 'closed' || survey.status === 'archived'
                  ? 'This survey is closed. Saved responses remain available.'
                  : survey.expired
                    ? 'This survey has expired. Saved responses remain available.'
                    : 'Private link expires ' +
                      dateTime(survey.expires_at) +
                      '.',
            ),
          );
          if (survey.privateLink || survey.previewLink) {
            const link = node('a', 'Open private survey ↗');
            if (survey.privateLink) link.href = survey.privateLink;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const copy = node('button', 'Copy private link', 'secondary'),
              notice = node('p');
            notice.setAttribute('role', 'status');
            copy.onclick = async () => {
              notice.textContent = (await copyText(survey.privateLink))
                ? 'Answering link copied. Share it with the intended respondents.'
                : 'Copy this private link: ' + survey.privateLink;
            };
            const preview = node('a', 'Preview questions ↗');
            preview.href =
              survey.previewLink || survey.privateLink + '&preview=1';
            preview.target = '_blank';
            preview.rel = 'noopener noreferrer';
            const copyPreview = node(
              'button',
              'Copy preview link',
              'secondary',
            );
            copyPreview.onclick = async () => {
              notice.textContent = (await copyText(preview.href))
                ? 'Preview link copied. Answer controls are disabled.'
                : 'Copy this preview link: ' + preview.href;
            };
            const actions = node('div', undefined, 'entry-actions');
            actions.append(preview, copyPreview);
            if (survey.privateLink)
              actions.append(link, copy, surveyQR(survey));
            content.append(actions, notice);
          }
          const respondents = node(
            'details',
            undefined,
            'entry respondent-management',
          );
          respondents.append(node('summary', 'Respondents & access'));
          const respondentContent = node('div');
          respondents.append(respondentContent);
          content.append(respondents);
          await mountRespondents(respondentContent, selected, api, async () => {
            await load();
            options.onChange?.();
          });
          if (current !== generation || request !== requestGeneration) return;
          if (survey.definition) {
            const { survey: detail } = await api(
              '/api/custom-surveys?action=draft&id=' +
                encodeURIComponent(selected),
            );
            if (current !== generation || request !== requestGeneration) return;
            const history = node('details');
            history.append(node('summary', 'Survey activity'));
            for (const entry of detail.activity)
              history.append(
                node(
                  'p',
                  `${dateTime(entry.created_at)} · ${actorLabel(entry.actor_email, currentOfficer())} · ${actionLabel(entry.action)}`,
                ),
              );
            content.append(history);
          }
          const isCurrent = () =>
            current === generation &&
            request === requestGeneration &&
            options.isCurrent?.() !== false;
          // Each response downloads as a PDF made here from what is shown.
          const pdfActions = (result) => {
            const actions = node('div', undefined, 'entry-actions'),
              button = node('button', 'Download PDF', 'secondary'),
              status = node('p');
            button.setAttribute(
              'aria-label',
              'Download PDF for ' + result.display_name,
            );
            status.setAttribute('role', 'status');
            button.onclick = () =>
              downloadResponse({
                survey,
                result,
                definition: data.resultsDefinition,
                api,
                isCurrent,
                status,
                trigger: button,
              });
            actions.append(button, status);
            return actions;
          };
          let expanded = options.expanded ?? (options.inline ? false : null);
          const responseList = node('div', undefined, 'custom-response-list');
          const matches = (results) =>
            results.filter(
              (result) =>
                !options.search ||
                `${result.display_name || ''} ${result.email || ''}`
                  .toLowerCase()
                  .includes(options.search.trim().toLowerCase()),
            );
          const appendResponses = (results) => {
            const section = responseSections(named(matches(results)), {
              definition: data.resultsDefinition,
              actions: pdfActions,
              view: scope.view,
            });
            if (expanded !== null)
              for (const person of section.querySelectorAll('.response-person'))
                person.open = expanded;
            responseList.append(section);
          };
          const expand = node('button', 'Expand all', 'secondary');
          const collapse = node('button', 'Collapse all', 'secondary');
          const setExpanded = (value) => {
            expanded = value;
            for (const person of responseList.querySelectorAll(
              '.response-person',
            ))
              person.open = value;
          };
          expandResponses = setExpanded;
          expand.onclick = () => setExpanded(true);
          collapse.onclick = () => setExpanded(false);
          const consolidated = node(
            'details',
            undefined,
            'custom-consolidated',
          );
          consolidated.append(node('summary', 'Consolidated answers'));
          const consolidatedBody = node('div');
          consolidated.append(consolidatedBody);
          let compiling = false,
            compiled = false;
          consolidated.ontoggle = async () => {
            if (!consolidated.open || compiling || compiled) return;
            compiling = true;
            consolidatedBody.replaceChildren(node('p', 'Loading all answers…'));
            try {
              const all = await allSurveyResponses(
                api,
                survey.id,
                data,
                isCurrent,
                scope,
              );
              if (!isCurrent()) return;
              consolidatedBody.replaceChildren(
                consolidatedAnswers(matches(all), data.resultsDefinition),
              );
              compiled = true;
            } catch (error) {
              if (isCurrent())
                consolidatedBody.replaceChildren(node('p', error.message));
            } finally {
              compiling = false;
            }
          };
          const exportCSV = node('button', 'Export CSV', 'secondary'),
            exportStatus = node('p'),
            exportActions = node('div', undefined, 'entry-actions');
          exportStatus.setAttribute('role', 'status');
          // From these results, not the survey list, which may be older.
          exportCSV.disabled = !data.results.length;
          exportCSV.onclick = async () => {
            exportCSV.disabled = true;
            exportStatus.textContent = 'Preparing CSV for matching responses…';
            try {
              const saved = await save(
                '/api/custom-surveys?' +
                  new URLSearchParams({
                    action: 'export',
                    id: survey.id,
                    ...scope,
                  }),
                `${fileSlug(survey.title) || 'custom-survey'}-responses-${isoDay(new Date())}.csv`,
                { isCurrent },
              );
              if (saved)
                exportStatus.textContent =
                  'CSV downloaded. It includes every matching response across all pages.';
            } catch (error) {
              if (isCurrent()) exportStatus.textContent = error.message;
            } finally {
              exportCSV.disabled = false;
            }
          };
          exportActions.append(expand, collapse, exportCSV, exportStatus);
          appendResponses(data.results);
          content.append(
            node('h3', 'Submitted responses'),
            exportActions,
            consolidated,
            responseList,
          );
          let nextOffset = data.nextOffset;
          const more = node('button', 'Load more responses', 'secondary'),
            pageStatus = node('p');
          pageStatus.setAttribute('role', 'status');
          more.hidden = nextOffset === null || nextOffset === undefined;
          more.onclick = async () => {
            more.disabled = true;
            try {
              const page = await api(
                '/api/custom-surveys?' +
                  new URLSearchParams({
                    action: 'results',
                    id: survey.id,
                    offset: nextOffset,
                    ...scope,
                  }),
              );
              if (current !== generation || request !== requestGeneration)
                return;
              appendResponses(page.results);
              nextOffset = page.nextOffset;
              more.hidden = nextOffset === null || nextOffset === undefined;
              pageStatus.textContent = '';
            } catch (error) {
              if (current === generation && request === requestGeneration)
                pageStatus.textContent = error.message;
            } finally {
              more.disabled = false;
            }
          };
          content.append(more, pageStatus);
          if (
            survey.archived_response_count ||
            data.results.some((r) => !r.active && r.responses?.length)
          ) {
            const archived = node(
              'a',
              'View archived responses in Inbox → Archived → Questions',
            );
            archived.href = '#/inbox?status=archived&type=question';
            content.append(archived);
          }
        } catch (error) {
          if (current === generation && request === requestGeneration)
            content.replaceChildren(node('p', error.message));
        }
      }
      select.onchange = show;
      responseView.onchange = () => {
        options.view = responseView.value;
        return show();
      };
      refresh.onclick = load;
      await show();
    } catch (error) {
      if (current === generation) {
        root.replaceChildren(node('p', error.message));
        const retry = node('button', 'Try loading surveys again');
        retry.onclick = load;
        root.append(retry);
      }
    }
  }
  let dropped = false;
  return {
    load,
    setExpanded(value) {
      options.expanded = value;
      expandResponses?.(value);
    },
    async library(target, collection = '', query = '') {
      reload = () => this.library(target, collection, query);
      stopGroups();
      stopBuilder();
      closePrintView();
      const request = ++generation;
      target.replaceChildren(node('p', 'Loading surveys…', 'hint'));
      try {
        const [{ surveys }, { events }] = await Promise.all([
          api('/api/custom-surveys?action=catalog'),
          api('/api/events?admin=1'),
        ]);
        if (request !== generation) return;
        const matching = surveys
          .filter(
            (survey) =>
              (!collection ||
                (collection === 'events'
                  ? Boolean(survey.definition?.eventId)
                  : !survey.definition?.eventId)) &&
              survey.title.toLowerCase().includes(query.trim().toLowerCase()),
          )
          .sort(
            (a, b) =>
              Number(b.status === 'draft') - Number(a.status === 'draft'),
          );
        const list = node('div', undefined, 'survey-library-list');
        for (const survey of matching) {
          const sectionName =
            survey.status === 'draft'
              ? 'Drafts'
              : survey.definition?.eventId
                ? 'Event surveys'
                : 'Custom surveys';
          let section = [...list.children].find(
            (child) => child.dataset.group === sectionName,
          );
          if (!section) {
            section = node('section', undefined, 'survey-library-section');
            section.dataset.group = sectionName;
            section.append(node('h2', sectionName));
            list.append(section);
          }
          const event = events.find(
            (event) => event.id === survey.definition?.eventId,
          );
          if (event && options.renderEvent) {
            const row = node('details', undefined, 'survey-library-row');
            const body = node('div', undefined, 'custom-survey-group-body');
            row.append(surveySummary(survey), body);
            section.append(row);
            let mounted = false;
            row.ontoggle = () => {
              if (!row.open || mounted || request !== generation) return;
              mounted = true;
              groups.push(
                options.renderEvent(body, event, {
                  surveys: [survey],
                  isCurrent: () => request === generation,
                  onChange: () => this.library(target, collection, query),
                }),
              );
            };
          } else {
            const groupRoot = node('div');
            section.append(groupRoot);
            groups.push(
              mountFeedbackGroups(groupRoot, api, {
                surveys: [survey],
                isCurrent: () => request === generation,
                onChange: () => this.library(target, collection, query),
              }),
            );
          }
        }
        for (const name of ['Drafts', 'Event surveys', 'Custom surveys']) {
          const section = [...list.children].find(
            (child) => child.dataset.group === name,
          );
          if (section) list.append(section);
        }
        target.replaceChildren(
          matching.length
            ? list
            : node('p', 'No surveys in this collection yet.', 'empty-state'),
        );
      } catch (error) {
        if (request !== generation) return;
        target.replaceChildren(node('p', error.message));
        const retry = node('button', 'Try loading surveys again');
        retry.onclick = () => this.library(target, collection, query);
        target.append(retry);
      }
    },
    create(eventId, copyId) {
      generation++;
      stopGroups();
      stopBuilder();
      closePrintView();
      builder = mountSurveyBuilder(
        root,
        api,
        (id) => go(id ? '#/surveys/custom/' + id : '#/surveys'),
        undefined,
        eventId,
        copyId,
      );
    },
    // Ten minutes paused: drop shown results unless the builder is open.
    reset() {
      if (builder) return;
      generation++;
      stopGroups();
      dropped = true;
      closePrintView();
      root.replaceChildren();
    },
    refresh() {
      if (dropped) reload();
      dropped = false;
    },
    leave() {
      if (builder?.canLeave() === false) return false;
      if (builder) {
        generation++;
        stopBuilder();
        root.replaceChildren();
      }
      return true;
    },
    show(id) {
      selected = id;
      eventFilter = '';
      return load();
    },
    clear() {
      generation++;
      stopGroups();
      stopBuilder();
      closePrintView();
      selected = '';
      root.replaceChildren();
    },
  };
}
