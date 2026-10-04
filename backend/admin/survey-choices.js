import { node } from './ui.js';
export function choiceEditor(
  question,
  onChange,
  { limit = 12, maxLength = 120 } = {},
) {
  const root = node('div');
  root.className = 'survey-choice-editor';
  let dragging = null;
  const status = node('p');
  status.setAttribute('role', 'status');
  // Moves or removes choices with the exclusive mark attached to its choice.
  function edit(change) {
    const marks = question.options.map(
      (_, i) => i === question.exclusiveOption,
    );
    change(question.options);
    change(marks);
    if (marks.includes(true)) question.exclusiveOption = marks.indexOf(true);
    else delete question.exclusiveOption;
    onChange();
    render();
  }
  function move(from, to) {
    if (from === null || from === to || to < 0 || to >= question.options.length)
      return;
    edit((list) => list.splice(to, 0, list.splice(from, 1)[0]));
    status.textContent = `Moved choice ${from + 1} to position ${to + 1}.`;
  }
  function render() {
    root.replaceChildren(
      node('p', 'Choices · drag the grip to reorder, or use the move buttons.'),
    );
    if (question.type === 'multiple')
      root.append(
        node(
          'p',
          'Mark one choice, such as “Any of these” or “None of these”, as exclusive: choosing it clears and blocks the other choices.',
          'hint',
        ),
      );
    question.options.forEach((value, i) => {
      const row = node('div');
      row.className = 'survey-choice-row';
      const grip = node('button', '⠿');
      grip.type = 'button';
      grip.draggable = true;
      grip.setAttribute('aria-label', 'Drag choice ' + (i + 1) + ' to reorder');
      grip.ondragstart = (e) => {
        dragging = i;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      };
      grip.ondragend = () => {
        dragging = null;
        root
          .querySelectorAll('.drag-over')
          .forEach((e) => e.classList.remove('drag-over'));
      };
      row.ondragover = (e) => {
        if (dragging !== null) {
          e.preventDefault();
          row.classList.add('drag-over');
        }
      };
      row.ondragleave = () => row.classList.remove('drag-over');
      row.ondrop = (e) => {
        e.preventDefault();
        move(dragging, i);
        dragging = null;
      };
      const input = node('input');
      input.value = value;
      input.maxLength = maxLength;
      input.setAttribute('aria-label', 'Choice ' + (i + 1));
      input.oninput = () => {
        question.options[i] = input.value;
        onChange();
      };
      row.append(grip, input);
      for (const [offset, label] of [
        [-1, 'up'],
        [1, 'down'],
      ])
        if (i + offset >= 0 && i + offset < question.options.length) {
          const b = node('button', label === 'up' ? '↑' : '↓');
          b.type = 'button';
          b.setAttribute('aria-label', `Move choice ${i + 1} ${label}`);
          b.onclick = () => move(i, i + offset);
          row.append(b);
        }
      if (question.type === 'multiple') {
        // At most one exclusive choice: checking one unchecks the others in
        // place, so focus stays on this checkbox.
        const exclusive = node('label', undefined, 'builder-check'),
          check = node('input');
        check.type = 'checkbox';
        check.checked = question.exclusiveOption === i;
        check.setAttribute('aria-label', 'Choice ' + (i + 1) + ' is exclusive');
        check.onchange = () => {
          if (check.checked) question.exclusiveOption = i;
          else delete question.exclusiveOption;
          root
            .querySelectorAll('.builder-check input')
            .forEach(
              (box, j) => (box.checked = j === question.exclusiveOption),
            );
          onChange();
        };
        exclusive.append(check, node('span', 'Exclusive'));
        row.append(exclusive);
      }
      const remove = node('button', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove choice ' + (i + 1));
      remove.onclick = () => edit((list) => list.splice(i, 1));
      row.append(remove);
      root.append(row);
    });
    if (question.options.length < limit) {
      const add = node('button', 'Add choice');
      add.type = 'button';
      add.onclick = () => {
        question.options.push('');
        onChange();
        render();
        root
          .querySelectorAll('.survey-choice-row > input')
          [question.options.length - 1].focus();
      };
      root.append(add);
    }
    root.append(status);
  }
  render();
  return root;
}
