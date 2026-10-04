import { node } from './ui.js';
import { questionFields } from '../surveys/form-ui.js';
import { isPaused } from './session.js';
export function surveyTrial(definition) {
  const root = node('details');
  root.className = 'survey-trial';
  root.append(node('summary', 'Try the form and preview results'));
  root.append(
    node(
      'p',
      'Preview only. These trial answers stay on this page and are never submitted.',
    ),
  );
  const values = {};
  root.append(
    questionFields(definition, {
      values,
      onChange: (id, value) => (values[id] = value),
    }),
  );
  const preview = node('button', 'Preview how results will look');
  preview.type = 'button';
  preview.onclick = () => {
    const dialog = node('dialog');
    dialog.className = 'survey-trial-results';
    const title = node('h3', 'Example admin results');
    title.id = 'trial-results-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const close = node('button', 'Close results preview');
    close.type = 'button';
    close.onclick = () => dialog.close();
    const header = node('div');
    header.className = 'survey-trial-header';
    header.append(title, close);
    dialog.append(
      header,
      node('p', 'Trial respondent · preview only · no saved response'),
    );
    for (const q of definition.questions) {
      const v = values[q.id];
      let answer = 'Not answered';
      if (v !== undefined && v !== '' && (!Array.isArray(v) || v.length))
        answer = ['text', 'short', 'email', 'date', 'time', 'number'].includes(
          q.type,
        )
          ? v
          : q.type === 'scale'
            ? v + ' / 5'
            : (q.type === 'single' ? [v] : v)
                .map((i) => q.options[i])
                .join('\n');
      const card = node('section');
      card.append(
        node('h4', (q.choiceDate ? q.choiceDate + ' · ' : '') + q.title),
        node('p', answer),
      );
      dialog.append(card);
    }
    root.append(dialog);
    dialog.onclose = () => {
      if (!isPaused()) dialog.remove();
    };
    dialog.showModal();
  };
  root.append(preview);
  return root;
}
