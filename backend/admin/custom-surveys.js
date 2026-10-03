import { mountRespondents } from './survey-respondents.js';
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
          'Manage respondents and read their shared responses. Only assigned respondents can answer this survey.',
        ),
      );
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
          if (survey.privateLink) {
            const link = node('a', 'Open private survey ↗');
            link.href = survey.privateLink;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const copy = node('button', 'Copy private link', 'secondary'),
              notice = node('p');
            notice.setAttribute('role', 'status');
            copy.onclick = async () => {
              try {
                await navigator.clipboard.writeText(survey.privateLink);
                notice.textContent =
                  'Private link copied. Share it with the assigned advisors.';
              } catch {
                notice.textContent =
                  'Copy this private link: ' + survey.privateLink;
              }
            };
            const preview = node('a', 'Preview questions ↗');
            preview.href = survey.privateLink + '&preview=1';
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
                  'Preview link copied. Questions are visible without sign-in; answering requires advisor verification.';
              } catch {
                notice.textContent = 'Copy this preview link: ' + preview.href;
              }
            };
            const actions = node('div', undefined, 'entry-actions');
            actions.append(preview, copyPreview, link, copy);
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
          const grid = node('div', undefined, 'custom-survey-comparison');
          const ids = [
            ...new Set(
              data.results.flatMap((r) => (r.responses || []).map((a) => a.id)),
            ),
          ];
          for (const result of data.results) {
            const column = node('article', undefined, 'entry');
            column.append(node('h3', result.display_name));
            if (!result.active)
              column.append(
                node(
                  'p',
                  'Removed respondent · saved responses retained',
                  'hint',
                ),
              );
            column.append(
              node(
                'p',
                result.revision
                  ? `Revision ${result.revision} · ${new Date(result.submitted_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Central`
                  : 'No shared responses yet.',
              ),
            );
            for (const id of ids) {
              const answer = (result.responses || []).find((a) => a.id === id),
                reference =
                  answer ||
                  data.results
                    .flatMap((r) => r.responses || [])
                    .find((a) => a.id === id);
              const block = node('section', undefined, 'custom-survey-answer');
              block.append(node('h4', reference.title));
              block.append(node('p', answer?.text || 'No shared response.'));
              if (answer?.mode === 'narrative')
                block.append(node('p', 'Shared wording only', 'hint'));
              if (
                answer?.mode === 'structured' &&
                answer.answer?.mode === 'value'
              )
                block.append(
                  node(
                    'p',
                    `Dial position: ${answer.answer.value} of 100.`,
                    'hint',
                  ),
                );
              column.append(block);
            }
            grid.append(column);
          }
          content.append(grid);
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
    clear() {
      generation++;
      selected = '';
      root.replaceChildren();
    },
  };
}
