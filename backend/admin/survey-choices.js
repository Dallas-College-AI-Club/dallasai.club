import { node } from './ui.js';
export function choiceEditor(question, onChange) {
  const root = node('div');
  root.className = 'survey-choice-editor';
  let dragging = null;
  const status = node('p');
  status.setAttribute('role', 'status');
  function move(from, to) {
    if (from === null || from === to || to < 0 || to >= question.options.length)
      return;
    const [choice] = question.options.splice(from, 1);
    question.options.splice(to, 0, choice);
    onChange();
    render();
    status.textContent = `Moved choice ${from + 1} to position ${to + 1}.`;
  }
  function render() {
    root.replaceChildren(
      node('p', 'Choices · drag the grip to reorder, or use the move buttons.'),
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
      input.maxLength = 120;
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
      const remove = node('button', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove choice ' + (i + 1));
      remove.onclick = () => {
        question.options.splice(i, 1);
        onChange();
        render();
      };
      row.append(remove);
      root.append(row);
    });
    if (question.options.length < 12) {
      const add = node('button', 'Add choice');
      add.type = 'button';
      add.onclick = () => {
        question.options.push('');
        onChange();
        render();
        root.querySelectorAll('input')[question.options.length - 1].focus();
      };
      root.append(add);
    }
    root.append(status);
  }
  render();
  return root;
}
