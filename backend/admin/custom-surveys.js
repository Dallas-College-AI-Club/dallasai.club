import { mountRespondents } from './survey-respondents.js';
import { mountSurveyBuilder } from './survey-builder.js';
import { responseSections } from '../surveys/results-ui.js';
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
export function mountCustomSurveys(root, api) {
  let generation = 0,
    selected = '';
  async function load() {
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
      const create = node('button', 'Create custom survey');
      const edit = (id) => {
        generation++;
        mountSurveyBuilder(
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
          `${survey.title} · ${survey.status} · ${survey.response_count} ${survey.response_count === 1 ? 'response' : 'responses'}`,
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
          content.replaceChildren(
            node(
              'p',
              'Current shared responses · read-only. Each new submission replaces the advisor’s previous shared summary.',
            ),
          );
          const survey = surveys.find((s) => s.id === selected);
          if (survey.definition) {
            content.firstChild.textContent =
              'Saved responses · read-only. Each new submission replaces the respondent’s previous response.';
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
                confirm.onclick = async () => {
                  confirm.disabled = true;
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
                    await load();
                  } catch (error) {
                    closeNote.textContent = error.message;
                    confirm.disabled = false;
                  }
                };
                content.insertBefore(confirm, closeNote);
              };
              content.append(close, closeNote);
            }
          }
          content.append(
            node(
              'p',
              'Private link expires ' +
                new Date(survey.expires_at).toLocaleString('en-US', {
                  timeZone: 'America/Chicago',
                }) +
                ' Central.',
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
              try {
                await navigator.clipboard.writeText(survey.privateLink);
                notice.textContent =
                  'Answering link copied. Share it with the intended respondents.';
              } catch {
                notice.textContent =
                  'Copy this private link: ' + survey.privateLink;
              }
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
              try {
                await navigator.clipboard.writeText(preview.href);
                notice.textContent =
                  'Preview link copied. Answer controls are disabled.';
              } catch {
                notice.textContent = 'Copy this preview link: ' + preview.href;
              }
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
                  `${new Date(entry.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Central · ${entry.actor_email} · ${{ draft_saved: 'Saved draft', published: 'Published survey', closed: 'Closed survey' }[entry.action]}`,
                ),
              );
            content.append(history);
          }
          content.append(
            node('h3', 'Submitted responses'),
            responseSections(data.results, {
              definition: data.resultsDefinition,
            }),
          );
          if (data.results.some((r) => !r.active && r.responses?.length)) {
            const archived = node(
              'a',
              'View archived responses in Inbox → Archived → Questions',
            );
            archived.href = '#archived-survey-questions';
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
      if (current === generation)
        root.replaceChildren(node('p', error.message));
    }
  }
  return {
    load,
    show(id) {
      selected = id;
      return load();
    },
    clear() {
      generation++;
      selected = '';
      root.replaceChildren();
    },
  };
}
