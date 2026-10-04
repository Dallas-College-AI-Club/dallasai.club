import { copyText, download as save, node } from './ui.js';
import { actionLabel, actorLabel, dateTime, isoDay, plural } from './format.js';
import { currentOfficer } from './session.js';
import { mountRespondents } from './survey-respondents.js';
import { mountSurveyBuilder } from './survey-builder.js';
import {
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
export function mountCustomSurveys(root, api) {
  let generation = 0,
    selected = '',
    builder,
    eventFilter = '';
  function stopBuilder() {
    builder?.dispose();
    builder = null;
  }
  async function load(filter) {
    if (typeof filter === 'string') eventFilter = filter;
    stopBuilder();
    closePrintView();
    const current = ++generation;
    root.replaceChildren(node('p', 'Loading custom surveys…'));
    try {
      const catalog = await api('/api/custom-surveys?action=catalog');
      const surveys = catalog.surveys.filter(
        (survey) => !eventFilter || survey.definition?.eventId === eventFilter,
      );
      if (current !== generation) return;
      root.replaceChildren(
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
      root.append(create);
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
      top.append(label, refresh);
      root.append(top);
      const content = node('div');
      root.append(content);
      let requestGeneration = 0;
      async function show() {
        const request = ++requestGeneration;
        selected = select.value;
        content.replaceChildren(node('p', 'Loading shared responses…'));
        try {
          const data = await api(
            '/api/custom-surveys?action=results&id=' +
              encodeURIComponent(selected),
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
              resume.onclick = () => edit(survey.id);
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
          await mountRespondents(respondentContent, selected, api, load);
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
            current === generation && request === requestGeneration;
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
          const exportCSV = node('button', 'Export CSV', 'secondary'),
            exportStatus = node('p'),
            exportActions = node('div', undefined, 'entry-actions');
          exportStatus.setAttribute('role', 'status');
          // From these results, not the survey list, which may be older.
          exportCSV.disabled = !partitionResponses(data.results).active.length;
          exportCSV.onclick = async () => {
            exportCSV.disabled = true;
            exportStatus.textContent = 'Preparing CSV for all responses…';
            try {
              const saved = await save(
                '/api/custom-surveys?' +
                  new URLSearchParams({ action: 'export', id: survey.id }),
                `${fileSlug(survey.title) || 'custom-survey'}-responses-${isoDay(new Date())}.csv`,
                { isCurrent },
              );
              if (saved)
                exportStatus.textContent =
                  'CSV downloaded. It includes every active response across all pages.';
            } catch (error) {
              if (isCurrent()) exportStatus.textContent = error.message;
            } finally {
              exportCSV.disabled = false;
            }
          };
          exportActions.append(exportCSV, exportStatus);
          content.append(
            node('h3', 'Submitted responses'),
            exportActions,
            responseSections(named(data.results), {
              definition: data.resultsDefinition,
              actions: pdfActions,
            }),
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
                  }),
              );
              if (current !== generation || request !== requestGeneration)
                return;
              content.insertBefore(
                responseSections(named(page.results), {
                  definition: data.resultsDefinition,
                  actions: pdfActions,
                }),
                more,
              );
              nextOffset = page.nextOffset;
              more.hidden = nextOffset === null;
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
    async library(target, collection = '') {
      const request = ++generation;
      target.replaceChildren(node('p', 'Loading surveys…', 'hint'));
      try {
        const [{ surveys }, { events }] = await Promise.all([
          api('/api/custom-surveys?action=catalog'),
          api('/api/events?admin=1'),
        ]);
        if (request !== generation) return;
        const matching = surveys.filter(
          (survey) =>
            !collection ||
            (collection === 'events'
              ? Boolean(survey.definition?.eventId)
              : !survey.definition?.eventId),
        );
        const list = node('div', undefined, 'survey-library-list');
        for (const survey of matching) {
          const row = node('article', undefined, 'survey-library-row');
          const event = events.find(
            (event) => event.id === survey.definition?.eventId,
          );
          const info = node('div');
          info.append(
            node('h2', survey.title),
            node(
              'p',
              survey.definition?.eventId
                ? 'Event feedback' + (event ? ' · ' + event.draft.title : '')
                : 'Custom survey',
              'hint',
            ),
          );
          const status = node('div', undefined, 'survey-library-status');
          status.append(
            node(
              'span',
              survey.expired
                ? 'Expired'
                : survey.status[0].toUpperCase() + survey.status.slice(1),
              'chip',
            ),
            node('span', plural(survey.response_count, 'response'), 'hint'),
          );
          const open = node('a', 'Open →', 'button-link');
          open.href = '#/surveys/custom/' + survey.id;
          open.setAttribute('aria-label', 'Open ' + survey.title);
          row.append(info, status, open);
          list.append(row);
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
        retry.onclick = () => this.library(target, collection);
        target.append(retry);
      }
    },
    create(eventId, copyId) {
      generation++;
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
      dropped = true;
      closePrintView();
      root.replaceChildren();
    },
    refresh() {
      if (dropped) load();
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
      stopBuilder();
      closePrintView();
      selected = '';
      root.replaceChildren();
    },
  };
}
