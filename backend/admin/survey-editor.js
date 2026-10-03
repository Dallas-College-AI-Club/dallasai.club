const node = (tag, text) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
};
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
          choices.className = 'survey-choice-editor';
          function renderChoices(focusIndex) {
            choices.replaceChildren(
              ...question.options.map((choice, i) => {
                const row = node('div');
                row.className = 'survey-option-row';
                row.dataset.index = i;
                const handle = node('button', '↕');
                handle.type = 'button';
                handle.className = 'secondary choice-drag';
                handle.setAttribute(
                  'aria-label',
                  'Drag choice ' + (i + 1) + ' to reorder',
                );
                let dragging = false;
                handle.onpointerdown = (event) => {
                  if (event.button !== 0) return;
                  dragging = true;
                  handle.setPointerCapture(event.pointerId);
                  row.classList.add('dragging');
                };
                handle.onpointercancel = () => {
                  dragging = false;
                  row.classList.remove('dragging');
                };
                handle.onpointerup = (event) => {
                  if (!dragging) return;
                  dragging = false;
                  row.classList.remove('dragging');
                  const target = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest('.survey-option-row');
                  if (target && choices.contains(target))
                    move(i, Number(target.dataset.index));
                };
                const answer = node('input');
                answer.value = choice;
                answer.maxLength = 200;
                answer.setAttribute('aria-label', 'Answer choice ' + (i + 1));
                answer.oninput = () => {
                  question.options[i] = answer.value;
                  input.value = question.options.join('\n');
                };
                row.append(handle, answer);
                for (const [text, delta] of [
                  ['↑', -1],
                  ['↓', 1],
                ]) {
                  const button = node('button', text);
                  button.type = 'button';
                  button.className = 'secondary';
                  button.setAttribute(
                    'aria-label',
                    'Move choice ' + (i + 1) + (delta < 0 ? ' up' : ' down'),
                  );
                  button.disabled =
                    i + delta < 0 || i + delta >= question.options.length;
                  button.onclick = () => move(i, i + delta);
                  row.append(button);
                }
                return row;
              }),
            );
            if (focusIndex !== undefined)
              choices.children[focusIndex]?.querySelector('input').focus();
          }
          function move(from, to) {
            if (from === to || to < 0 || to >= question.options.length) return;
            question.options.splice(to, 0, question.options.splice(from, 1)[0]);
            input.value = question.options.join('\n');
            renderChoices(to);
          }
          input.oninput = () => {
            question.options = input.value.split('\n');
            renderChoices();
          };
          renderChoices();
          wrapper.append(input);
          box.append(
            wrapper,
            node(
              'p',
              'Edit choices below. Drag ↕ to reorder, or use the arrow buttons.',
            ),
            choices,
          );
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
      return questions.map((question) => ({
        ...question,
        options:
          question.type === 'text'
            ? []
            : question.options.map((x) => x.trim()).filter(Boolean),
        allowOther: question.type !== 'text' && question.allowOther,
      }));
    },
  };
}
