import { node } from './ui.js';
import { responseSections } from '../surveys/results-ui.js';
export function mountSurveyArchive(root, api) {
  let generation = 0,
    offset = 0,
    currentKey = '';
  async function load(params, { background = false } = {}) {
    const visible =
      params.get('status') === 'closed' &&
      ['', 'question'].includes(params.get('kind') || '') &&
      !params.get('id');
    const request = ++generation;
    root.hidden = !visible;
    if (!visible) {
      root.replaceChildren();
      currentKey = '';
      offset = 0;
      return;
    }
    const key = params.get('kind') || '';
    if (key !== currentKey) {
      offset = 0;
      currentKey = key;
    }
    if (background && root.querySelector('details[open]')) return;
    root.replaceChildren(node('p', 'Loading archived survey responses…'));
    try {
      const data = await api(
        '/api/custom-surveys?action=archived-responses&offset=' + offset,
      );
      if (request !== generation) return;
      root.replaceChildren(node('h3', 'Archived survey responses'));
      if (!data.responses.length)
        root.append(node('p', 'No archived survey responses.'));
      for (const response of data.responses) {
        const section = node('section');
        section.className = 'entry archived-survey-entry';
        section.append(
          node('h4', response.survey_title),
          node('p', `Question responses · ${response.email}`),
        );
        if (response.archived_at)
          section.append(
            node(
              'p',
              'Archived ' +
                new Date(response.archived_at).toLocaleString('en-US', {
                  timeZone: 'America/Chicago',
                }) +
                ' Central.',
            ),
          );
        section.append(
          responseSections([{ ...response, active: true }], {
            definition: response.definition,
          }),
        );
        const link = node('a', 'Manage respondent access in Custom surveys');
        link.href = '#custom-survey=' + response.survey_id;
        section.append(link);
        root.append(section);
      }
      const pages = node('nav');
      pages.setAttribute('aria-label', 'Archived survey response pages');
      const pageSize = data.pageSize || 20;
      for (const [label, disabled, next] of [
        ['Previous archived responses', offset === 0, offset - pageSize],
        ['Next archived responses', !data.hasMore, offset + pageSize],
      ]) {
        const b = node('button', label);
        b.type = 'button';
        b.disabled = disabled;
        b.onclick = () => {
          offset = next;
          load(params);
        };
        pages.append(b);
      }
      root.append(pages);
    } catch (error) {
      if (request === generation)
        root.replaceChildren(node('p', error.message));
    }
  }
  return {
    load,
    clear() {
      generation++;
      root.replaceChildren();
      root.hidden = true;
      offset = 0;
      currentKey = '';
    },
  };
}
