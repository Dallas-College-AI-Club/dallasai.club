import { node } from './ui.js';
import { choiceEditor } from './survey-choices.js';
import { availabilityDateEditor } from '../surveys/availability-ui.js';
const answerTypes = [
  ['short', 'Short answer', 'Students enter a few words, such as a name.'],
  ['text', 'Long answer', 'Students write a detailed answer in a text box.'],
  ['single', 'Single choice', 'Students select one of the choices you add.'],
  ['multiple', 'Multiple choice', 'Students can select more than one choice.'],
  ['date', 'Date', 'Students choose one calendar date.'],
  ['time', 'Time', 'Students choose a time, such as 6:30 PM.'],
  ['number', 'Number', 'Students enter a number, such as 2 guests.'],
  [
    'email',
    'Email',
    'Students enter an email address, such as name@example.edu.',
  ],
  [
    'availability',
    'Date availability',
    'Students mark the dates and time periods that work for them.',
  ],
];
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
        const title = field('Question', 'label');
        title.required = true;
        title.setCustomValidity(
          question.label.trim() ? '' : 'Enter question ' + (index + 1) + '.',
        );
        title.oninput = () => {
          question.label = title.value;
          title.setCustomValidity(
            title.value.trim() ? '' : 'Enter question ' + (index + 1) + '.',
          );
        };
        field('Help text (optional)', 'description', 'textarea', 1000);
        const typeLabel = node('label', 'Answer type'),
          type = node('select');
        for (const [value, label] of answerTypes)
          type.append(new Option(label, value));
        type.value = question.type;
        type.onchange = () => {
          question.type = type.value;
          if (type.value !== 'multiple') delete question.exclusiveOption;
          if (!['single', 'multiple'].includes(type.value))
            delete question.choiceDate;
          if (type.value === 'availability') question.dates ||= [];
          else delete question.dates;
          render();
        };
        typeLabel.append(type);
        box.append(
          typeLabel,
          node(
            'p',
            answerTypes.find(([value]) => value === question.type)?.[2],
            'hint',
          ),
        );
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
        if (question.type === 'availability')
          box.append(
            availabilityDateEditor(question.dates, (dates) => {
              question.dates = dates;
            }),
          );
        if (['single', 'multiple'].includes(question.type)) {
          const date = field('Date for these choices (optional)', 'choiceDate');
          date.type = 'date';
          date.min = '0001-01-01';
          date.max = '9999-12-31';
          date.oninput = () => {
            if (date.value) question.choiceDate = date.value;
            else delete question.choiceDate;
          };
        }
        if (['single', 'multiple', 'availability'].includes(question.type)) {
          const wrapper = node(
              'label',
              question.type === 'availability'
                ? 'Time periods (one per line, 1–12 periods)'
                : 'Answer options (one per line, 2–30 options)',
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
                {
                  limit: question.type === 'availability' ? 12 : 30,
                  maxLength: 200,
                },
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
          box.append(
            wrapper,
            node(
              'p',
              'The list above and the individual choices below edit the same choices.',
              'hint',
            ),
            choices,
          );
          if (question.type !== 'availability')
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
    validate() {
      for (const [index, question] of questions.entries()) {
        const title = root.children[index].querySelector('input');
        title.setCustomValidity(
          question.label.trim() ? '' : 'Enter question ' + (index + 1) + '.',
        );
        if (!title.checkValidity()) {
          title.focus();
          title.reportValidity();
          return false;
        }
      }
      return true;
    },
    set(value = []) {
      questions = structuredClone(value);
      render();
    },
    value() {
      return questions.map(({ exclusiveOption, ...question }) => {
        const options = ['single', 'multiple', 'availability'].includes(
          question.type,
        )
          ? question.options.map((x) => x.trim()).filter(Boolean)
          : [];
        const exclusive =
          exclusiveOption === undefined
            ? -1
            : options.indexOf(question.options[exclusiveOption]?.trim());
        return {
          ...question,
          options,
          allowOther:
            ['single', 'multiple'].includes(question.type) &&
            question.allowOther,
          ...(exclusive >= 0 && question.type === 'multiple'
            ? { exclusiveOption: exclusive }
            : {}),
        };
      });
    },
  };
}
