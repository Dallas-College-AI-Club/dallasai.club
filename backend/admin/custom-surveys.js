import { confirmDialog, copyText, download as save, lock, node } from './ui.js';
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
      question.id + ':' + question.title,
      { id: question.id, title: question.title, answers: [] },
    ]),
  );
  for (const result of results)
    for (const answer of result.responses) {
      const key = answer.id + ':' + answer.title;
      if (!questions.has(key))
        questions.set(key, { id: answer.id, title: answer.title, answers: [] });
      questions.get(key).answers.push({ result, answer });
    }
  const rank = answerRank(definition);
  for (const [id, question] of [...questions].sort(
    ([, a], [, b]) => rank(a) - rank(b),
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
  if (survey.published_at)
    title.append(
      node('p', 'Published ' + dateTime(survey.published_at), 'hint'),
    );
  if (survey.status !== 'draft' && survey.expires_at)
    title.append(
      node('p', 'Ends ' + dateTime(survey.expires_at), 'event-deadline'),
    );
  const status = survey.expired
    ? 'Expired'
    : survey.status === 'open'
      ? 'Published'
      : survey.status[0].toUpperCase() + survey.status.slice(1);
  summary.append(
    title,
    node('span', status, 'chip survey-' + status.toLowerCase()),
    node('span', plural(survey.response_count, 'response'), 'hint'),
  );
  return summary;
}
function lifecycleControl(survey, action, api, isCurrent, onSuccess) {
  const route = location.hash;
  const current = () => isCurrent() && location.hash === route;
  const rsvp = survey.kind === 'rsvp';
  const [label, message] = (
    rsvp
      ? {
          archive: [
            'Archive RSVP survey',
            'Stop accepting RSVPs for ' +
              survey.title +
              ' and move its RSVP survey to Archived. Saved responses and the event are kept.',
          ],
          restore: [
            'Restore RSVP survey',
            'Restore the RSVP survey for ' +
              survey.title +
              '. Registration stays closed until you reopen it in the event editor. Saved responses stay unchanged.',
          ],
          delete: [
            'Delete RSVP survey permanently',
            'Permanently delete the RSVP survey for ' +
              survey.title +
              ' and ' +
              plural(
                survey.response_count + survey.archived_response_count,
                'saved response',
              ) +
              ', including RSVP registrations and their answers. This cannot be undone. The event, feedback surveys, contacts and attendance records are kept.',
          ],
        }
      : {
          edit: [
            'Edit survey',
            'Move this survey to a draft and stop new answers while you edit. Saved responses keep their original questions and answers. Publish when the changes are ready.',
          ],
          archive: [
            'Archive survey',
            'Stop answering and move this survey to Archived. Its questions, respondents and saved responses are kept.',
          ],
          restore: [
            survey.definition && !survey.published_at
              ? 'Restore as draft'
              : 'Restore survey',
            'Restore this survey for review. Saved responses stay unchanged. Answering stays closed until the editable survey is published.',
          ],
          delete: [
            'Delete survey permanently',
            'Permanently delete ' +
              survey.title +
              ' and ' +
              plural(
                survey.response_count + survey.archived_response_count,
                'saved response',
              ) +
              ', including respondents, answer data and device access. This cannot be undone. Existing short URLs are kept at their provider.',
          ],
        }
  )[action];
  const control = node('span', undefined, 'survey-lifecycle-control');
  const button = node('button', label, 'secondary'),
    status = node('span');
  status.setAttribute('role', 'status');
  button.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!current() || button.disabled) return;
    button.disabled = true;
    try {
      if (
        !(await confirmDialog({
          title: label + '?',
          body: message,
          confirmLabel: label,
        })) ||
        !current()
      )
        return;
      await api(
        rsvp ? '/api/surveys' : '/api/custom-surveys?action=lifecycle',
        {
          ...(rsvp
            ? { eventId: survey.id, action: 'rsvp-survey-' + action }
            : { id: survey.id, action }),
          expectedRevision: survey.edit_revision,
          requestId: crypto.randomUUID(),
        },
      );
      if (current()) await onSuccess();
    } catch (error) {
      if (current()) status.textContent = error.message;
    } finally {
      if (current()) button.disabled = false;
    }
  };
  control.append(button, status);
  return control;
}
function rowLifecycleActions(summary, survey, api, isCurrent, onChange) {
  const actions = node('span', undefined, 'survey-row-actions');
  for (const action of survey.status === 'archived'
    ? ['restore', 'delete']
    : ['archive'])
    actions.append(lifecycleControl(survey, action, api, isCurrent, onChange));
  summary.append(actions);
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
    const open = node('a', 'Manage survey →', 'button-link');
    open.href = '#/surveys/custom/' + survey.id;
    const summary = surveySummary(survey);
    rowLifecycleActions(
      summary,
      survey,
      api,
      () => !disposed && isCurrent(),
      onChange,
    );
    card.append(summary, open, body);
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
          const isCurrent = () =>
            current === generation &&
            request === requestGeneration &&
            options.isCurrent?.() !== false;
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
          const lifecycleButton = (action) =>
            content.append(
              lifecycleControl(survey, action, api, isCurrent, async () => {
                options.onChange?.();
                if (action === 'delete') {
                  selected = '';
                  go('#/surveys');
                  return;
                }
                if (
                  action === 'edit' ||
                  (action === 'restore' &&
                    survey.definition &&
                    !survey.published_at)
                ) {
                  if (options.inline) go('#/surveys/custom/' + survey.id);
                  else edit(survey.id);
                } else await load();
              }),
            );
          if (survey.status === 'archived') {
            lifecycleButton('restore');
            lifecycleButton('delete');
          } else {
            if (survey.definition && survey.status !== 'draft')
              lifecycleButton('edit');
            lifecycleButton('archive');
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
          if (!options.inline || survey.status !== 'open' || survey.expired)
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
            const actions = node('div', undefined, 'entry-actions'),
              notice = node('p');
            notice.setAttribute('role', 'status');
            if (survey.privateLink) {
              const link = node('a', 'Open private survey ↗'),
                copy = node('button', 'Copy link', 'secondary');
              link.href = survey.privateLink;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              copy.onclick = async () => {
                const shareLink = survey.short_link || survey.privateLink;
                notice.textContent = (await copyText(shareLink))
                  ? 'Answering link copied. Share it with the intended respondents.'
                  : 'Copy this link: ' + shareLink;
              };
              actions.append(link, copy, surveyQR(survey));
            } else {
              const preview = node('a', 'Preview questions ↗'),
                copyPreview = node('button', 'Copy preview link', 'secondary');
              preview.href = survey.previewLink;
              preview.target = '_blank';
              preview.rel = 'noopener noreferrer';
              copyPreview.onclick = async () => {
                notice.textContent = (await copyText(preview.href))
                  ? 'Preview link copied. Answer controls are disabled.'
                  : 'Copy this preview link: ' + preview.href;
              };
              actions.append(preview, copyPreview);
            }
            if (!survey.definition) {
              const sample = node('a', 'Test sample', 'button-link');
              sample.href = '/surveys/#sample=sample-jordan&step=review';
              sample.target = '_blank';
              sample.rel = 'noopener noreferrer';
              actions.append(sample);
            }
            content.append(actions, notice);
            if (survey.privateLink) {
              const sharing = node('details', undefined, 'entry'),
                form = node('form'),
                label = node('label', 'Short link (optional)'),
                input = node('input'),
                saveLink = node('button', 'Save short link', 'secondary'),
                createLink = node('button', 'Create short link', 'secondary'),
                status = node('p');
              sharing.append(node('summary', 'Short link'));
              input.type = 'url';
              input.maxLength = 2048;
              input.placeholder = 'https://tinyurl.com/…';
              input.value = survey.short_link || '';
              createLink.type = 'button';
              const updateCreate = () => {
                createLink.hidden = Boolean(
                  survey.short_link || input.value.trim(),
                );
              };
              input.oninput = updateCreate;
              updateCreate();
              label.append(input);
              status.setAttribute('role', 'status');
              form.append(
                label,
                node(
                  'p',
                  'Use a TinyURL or another HTTPS link that opens this survey. Copy link and QR code use it. Leave blank to use the original link.',
                  'hint',
                ),
                saveLink,
                createLink,
                status,
              );
              createLink.onclick = async () => {
                if (
                  createLink.disabled ||
                  survey.short_link ||
                  input.value.trim()
                )
                  return;
                const unlock = lock(form);
                status.textContent = '';
                try {
                  const saved = await api(
                    '/api/custom-surveys?action=generate-share-link',
                    { id: survey.id },
                  );
                  if (!isCurrent()) return;
                  survey.short_link = saved.short_link;
                  input.value = saved.short_link;
                  updateCreate();
                  status.textContent =
                    'Short link created. Copy link and QR code now use it.';
                } catch (error) {
                  if (isCurrent()) status.textContent = error.message;
                } finally {
                  unlock();
                }
              };
              form.onsubmit = async (event) => {
                event.preventDefault();
                if (saveLink.disabled) return;
                const unlock = lock(form);
                status.textContent = '';
                try {
                  const saved = await api(
                    '/api/custom-surveys?action=share-link',
                    {
                      id: survey.id,
                      shortLink: input.value,
                      expectedShortLink: survey.short_link || null,
                    },
                  );
                  if (!isCurrent()) return;
                  survey.short_link = saved.short_link;
                  input.value = saved.short_link || '';
                  updateCreate();
                  status.textContent = saved.short_link
                    ? 'Short link saved. Copy link and QR code now use it.'
                    : 'Short link removed. Copy link and QR code use the original link.';
                } catch (error) {
                  if (isCurrent()) status.textContent = error.message;
                } finally {
                  unlock();
                }
              };
              sharing.append(form);
              content.append(sharing);
            }
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
            if (!result.active || survey.status === 'archived') {
              const remove = node(
                'button',
                'Delete response permanently',
                'danger',
              );
              remove.onclick = async () => {
                if (
                  !(await confirmDialog({
                    title: 'Delete this response permanently?',
                    body: 'This removes the saved answers and submission receipts. This cannot be undone. The respondent membership is kept.',
                    confirmLabel: 'Delete response permanently',
                  }))
                )
                  return;
                remove.disabled = true;
                try {
                  const roster = await api(
                    '/api/custom-surveys?action=members&id=' + survey.id,
                  );
                  await api('/api/custom-surveys?action=member-change', {
                    surveyId: survey.id,
                    advisorId: result.advisor_id,
                    expectedRevision: roster.revision,
                    requestId: crypto.randomUUID(),
                    action: 'delete',
                  });
                  if (!isCurrent()) return;
                  await load();
                  options.onChange?.();
                } catch (error) {
                  if (isCurrent()) status.textContent = error.message;
                  remove.disabled = false;
                }
              };
              actions.append(remove);
            }
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
              'View archived responses in Inbox → Archived',
            );
            archived.href = '#/inbox?status=archived';
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
        const [{ surveys }, { events }, { surveys: rsvpSurveys }] =
          await Promise.all([
            api('/api/custom-surveys?action=catalog'),
            api('/api/events?admin=1'),
            collection === 'custom'
              ? Promise.resolve({ surveys: [] })
              : api('/api/surveys?catalog=1'),
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
        let archivedCount = 0;
        const sectionFor = (name) => {
          let section = [...list.children].find(
            (child) => child.dataset.group === name,
          );
          if (!section) {
            section = node('section', undefined, 'survey-library-section');
            section.dataset.group = name;
            section.append(node('h2', name));
            list.append(section);
          }
          return section;
        };
        for (const saved of rsvpSurveys) {
          if (!saved.title.toLowerCase().includes(query.trim().toLowerCase()))
            continue;
          const survey = {
            kind: 'rsvp',
            id: saved.eventId,
            title: saved.title,
            status: saved.status,
            edit_revision: saved.revision,
            response_count: saved.responseCount,
            archived_response_count: saved.archivedResponseCount,
          };
          const archived = survey.status === 'archived';
          if (archived) archivedCount++;
          const row = node(
            'div',
            undefined,
            'survey-library-row rsvp-survey-library-row',
          );
          const summary = node('div', undefined, 'survey-library-summary');
          const title = node('div');
          title.append(node('strong', survey.title));
          const link = node('a', 'Open responses →', 'button-link');
          link.href =
            '#/surveys/events?event=' +
            encodeURIComponent(survey.id) +
            (archived ? '&view=archived' : '');
          summary.append(
            title,
            node('span', archived ? 'RSVP · Archived' : 'RSVP', 'chip'),
            link,
          );
          rowLifecycleActions(
            summary,
            survey,
            api,
            () => request === generation,
            () => this.library(target, collection, query),
          );
          row.append(summary);
          sectionFor(archived ? 'Archived' : 'Event surveys').append(row);
        }
        for (const survey of matching) {
          if (survey.status === 'archived') archivedCount++;
          const sectionName =
            survey.status === 'archived'
              ? 'Archived'
              : survey.status === 'draft'
                ? 'Drafts'
                : survey.definition?.eventId
                  ? 'Event surveys'
                  : 'Custom surveys';
          const section = sectionFor(sectionName);
          const event = events.find(
            (event) => event.id === survey.definition?.eventId,
          );
          if (event && options.renderEvent) {
            const row = node('details', undefined, 'survey-library-row');
            const body = node('div', undefined, 'custom-survey-group-body');
            const summary = surveySummary(survey);
            rowLifecycleActions(
              summary,
              survey,
              api,
              () => request === generation,
              () => this.library(target, collection, query),
            );
            row.append(summary, body);
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
        for (const name of [
          'Drafts',
          'Event surveys',
          'Custom surveys',
          'Archived',
        ]) {
          const section = [...list.children].find(
            (child) => child.dataset.group === name,
          );
          if (section) list.append(section);
        }
        target.replaceChildren(
          list.children.length
            ? list
            : node('p', 'No surveys in this collection yet.', 'empty-state'),
        );
        const archived = [...list.children].find(
          (child) => child.dataset.group === 'Archived',
        );
        if (archived) {
          const jump = node(
            'button',
            'Archived surveys (' + archivedCount + ')',
            'secondary',
          );
          jump.onclick = () => {
            const heading = archived.querySelector('h2');
            heading.tabIndex = -1;
            heading.focus({ preventScroll: true });
            heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
          };
          target.prepend(jump);
        }
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
      options.view = 'active';
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
