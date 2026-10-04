import { copyText, download as save, node } from './ui.js';
import { actionLabel, actorLabel, dateTime, isoDay, plural } from './format.js';
import { currentOfficer } from './session.js';
import { mountRespondents } from './survey-respondents.js';
import { mountSurveyBuilder } from './survey-builder.js';
import { fileSlug, responseSections } from '../surveys/results-ui.js';
import { responseDocument, responseFilename } from './response-document.js';
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
    builder;
  function stopBuilder() {
    builder?.dispose();
    builder = null;
  }
  async function load() {
    stopBuilder();
    const current = ++generation;
    root.replaceChildren(node('p', 'Loading custom surveys…'));
    try {
      const { surveys } = await api('/api/custom-surveys?action=catalog');
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
      create.onclick = () => edit();
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
          if (survey.definition) {
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
            if (survey.privateLink) actions.append(link, copy);
            content.append(actions, notice);
          }
          const respondents = node(
            'section',
            undefined,
            'entry respondent-management',
          );
          content.append(respondents);
          await mountRespondents(respondents, selected, api, load);
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
          // Each response downloads as a PDF made here from what is shown;
          // jsPDF loads on first use.
          const pdfActions = (result) => {
            const actions = node('div', undefined, 'entry-actions'),
              button = node('button', 'Download PDF', 'secondary'),
              status = node('p');
            button.setAttribute(
              'aria-label',
              'Download PDF for ' + result.display_name,
            );
            status.setAttribute('role', 'status');
            button.onclick = async () => {
              button.disabled = true;
              status.textContent = 'Preparing PDF…';
              try {
                const [{ responsePdf }] = await Promise.all([
                  import('./response-pdf.js').catch(() => {
                    throw new Error(
                      'Couldn’t prepare the PDF. Check your connection and try again.',
                    );
                  }),
                  api('/api/custom-surveys?action=response-pdf', {
                    id: survey.id,
                  }),
                ]);
                if (!isCurrent()) return;
                responsePdf(
                  responseDocument(result, {
                    title: survey.title,
                    definition: data.resultsDefinition,
                  }),
                ).save(responseFilename(survey.title, result));
                status.textContent = 'PDF downloaded.';
              } catch (error) {
                if (isCurrent()) status.textContent = error.message;
              } finally {
                button.disabled = false;
              }
            };
            actions.append(button, status);
            return actions;
          };
          const exportCSV = node('button', 'Export CSV', 'secondary'),
            exportStatus = node('p'),
            exportActions = node('div', undefined, 'entry-actions');
          exportStatus.setAttribute('role', 'status');
          exportCSV.disabled = !survey.response_count;
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
    // Ten minutes paused: drop shown results unless the builder is open.
    reset() {
      if (builder) return;
      generation++;
      dropped = true;
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
      return load();
    },
    clear() {
      generation++;
      stopBuilder();
      selected = '';
      root.replaceChildren();
    },
  };
}
