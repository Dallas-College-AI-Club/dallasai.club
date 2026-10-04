import { node } from './ui.js';
import { choiceEditor } from './survey-choices.js';
export function surveyEditor(root, addButton) {
  let questions = [];
  function render() {
    root.replaceChildren(
      ...questions.map((question, index) => {
        const box = node('fieldset');
        box.className = 'survey-editor-question';
        box.append(node('legend', 'Question ' + (index + 1)));
        function field(label, key, tag = 'input', max = 300) {
          const wrapper = node('label', label),
            input = node(tag);
          input.value = question[key] || '';
          input.maxLength = max;
          if (tag === 'textarea') input.rows = 3;
          input.oninput = () => (question[key] = input.value);
          wrapper.append(input);
          box.append(wrapper);
          return input;
        }
        field('Question', 'label');
        field('Help text (optional)', 'description', 'textarea', 1000);
        const typeLabel = node('label', 'Answer type'),
          type = node('select');
        for (const [value, label] of [
          ['text', 'Written answer'],
          ['single', 'Choose one'],
          ['multiple', 'Choose several'],
        ])
          type.append(new Option(label, value));
        type.value = question.type;
        type.onchange = () => {
          question.type = type.value;
          if (type.value !== 'multiple') delete question.exclusiveOption;
          render();
        };
        typeLabel.append(type);
        box.append(typeLabel);
        function check(label, key) {
          const wrapper = node('label'),
            input = node('input');
          wrapper.className = 'checkbox';
          input.type = 'checkbox';
          input.checked = question[key];
          input.onchange = () => (question[key] = input.checked);
          wrapper.append(input, document.createTextNode(label));
          box.append(wrapper);
        }
        check('Required answer', 'required');
        if (question.type !== 'text') {
          const wrapper = node(
              'label',
              'Answer options (one per line, 2–30 options)',
            ),
            input = node('textarea');
          input.rows = 6;
          input.maxLength = 6029;
          input.value = question.options.join('\n');
          const choices = node('div');
          const refreshChoices = () =>
            choices.replaceChildren(
              choiceEditor(
                question,
                () => {
                  input.value = question.options.join('\n');
                },
                { limit: 30, maxLength: 200 },
              ),
            );
          input.oninput = () => {
            const exclusive = question.options[question.exclusiveOption];
            question.options = input.value.split('\n');
            const index =
              exclusive === undefined
                ? -1
                : question.options.indexOf(exclusive);
            if (index < 0) delete question.exclusiveOption;
            else question.exclusiveOption = index;
            refreshChoices();
          };
          refreshChoices();
          wrapper.append(input);
          box.append(wrapper, choices);
          check('Allow an Other answer', 'allowOther');
        }
        const actions = node('div');
        actions.className = 'event-actions';
        for (const [label, delta] of [
          ['Move up', -1],
          ['Move down', 1],
          ['Remove question', 0],
        ]) {
          const button = node('button', label);
          button.type = 'button';
          button.className = 'secondary';
          button.disabled =
            (delta === -1 && index === 0) ||
            (delta === 1 && index === questions.length - 1);
          button.onclick = () => {
            if (!delta) questions.splice(index, 1);
            else {
              const target = index + delta;
              if (target < 0 || target >= questions.length) return;
              [questions[index], questions[target]] = [
                questions[target],
                questions[index],
              ];
            }
            render();
          };
          actions.append(button);
        }
        box.append(actions);
        return box;
      }),
    );
    addButton.disabled = questions.length >= 20;
  }
  addButton.onclick = () => {
    if (questions.length >= 20) return;
    questions.push({
      id: crypto.randomUUID(),
      label: '',
      description: '',
      type: 'text',
      required: false,
      options: [],
      allowOther: false,
    });
    render();
    root.lastElementChild.querySelector('input').focus();
  };
  return {
    set(value = []) {
      questions = structuredClone(value);
      render();
    },
    value() {
      return questions.map(({ exclusiveOption, ...question }) => {
        const options =
          question.type === 'text'
            ? []
            : question.options.map((x) => x.trim()).filter(Boolean);
        const exclusive =
          exclusiveOption === undefined
            ? -1
            : options.indexOf(question.options[exclusiveOption]?.trim());
        return {
          ...question,
          options,
          allowOther: question.type !== 'text' && question.allowOther,
          ...(exclusive >= 0 && question.type === 'multiple'
            ? { exclusiveOption: exclusive }
            : {}),
        };
      });
    },
  };
}
