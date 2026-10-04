import { availabilityStatuses } from './availability-values.js';
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const dateLabel = (date) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date + 'T12:00:00Z'));

export function availabilityFields(
  question,
  { value = '', readOnly = false, onChange = () => {} } = {},
) {
  const root = node('div', undefined, 'availability'),
    statuses = node('fieldset', undefined, 'availability-status'),
    dates = node('fieldset', undefined, 'availability-dates'),
    alternatives = node('fieldset', undefined, 'availability-alternatives'),
    rows = node('div'),
    statusInputs = [],
    slots = [],
    suggestionRows = [];
  statuses.append(node('legend', 'Availability for these dates'));
  dates.append(node('legend', 'Mark any periods that work'));
  alternatives.append(node('legend', 'Alternative dates'), rows);
  for (const [status, label] of Object.entries(availabilityStatuses)) {
    const wrapper = node('label'),
      input = node('input');
    input.type = 'radio';
    input.name = 'availability-status-' + question.id;
    input.value = status;
    input.checked = status === 'available';
    input.disabled = readOnly;
    wrapper.append(input, node('span', label));
    statuses.append(wrapper);
    statusInputs.push(input);
  }
  for (const date of question.dates) {
    const row = node('div', undefined, 'availability-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', dateLabel(date));
    row.append(node('span', dateLabel(date), 'availability-date'));
    for (const period of question.options) {
      const wrapper = node('label'),
        input = node('input');
      input.type = 'checkbox';
      input.setAttribute('aria-label', dateLabel(date) + ' · ' + period);
      wrapper.append(input, node('span', period));
      row.append(wrapper);
      slots.push({ date, period, input });
    }
    dates.append(row);
  }
  const mode = () =>
    statusInputs.find((input) => input.checked)?.value || 'available';
  function read() {
    const status = mode();
    const selections =
      status === 'available'
        ? question.dates
            .map((date) => ({
              date,
              periods: slots
                .filter((slot) => slot.date === date && slot.input.checked)
                .map((slot) => slot.period),
            }))
            .filter((slot) => slot.periods.length)
        : [];
    if (status === 'available' && !selections.length) return '';
    return {
      status,
      selections,
      alternatives: ['unavailable', 'alternative'].includes(status)
        ? suggestionRows
            .filter((row) => row.date.value || row.time.value)
            .map((row) => ({ date: row.date.value, time: row.time.value }))
        : [],
    };
  }
  function sync(notify = true) {
    const status = mode(),
      suggest = ['unavailable', 'alternative'].includes(status);
    dates.disabled = readOnly || status !== 'available';
    alternatives.hidden = !suggest;
    alternatives.disabled = readOnly || !suggest;
    if (status !== 'available')
      slots.forEach(({ input }) => {
        input.checked = false;
      });
    if (!suggest)
      suggestionRows.forEach(({ date, time }) => {
        date.value = time.value = '';
      });
    if (suggest && !suggestionRows.length) addSuggestion();
    for (const row of suggestionRows)
      row.date.required = Boolean(
        row.time.value ||
        (status === 'alternative' &&
          !suggestionRows.some((r) => r.date.value) &&
          row === suggestionRows[0]),
      );
    statusInputs[3].setCustomValidity(
      question.required && read() === ''
        ? 'Mark a date and period, or choose an answer for all dates.'
        : '',
    );
    add.disabled = readOnly || suggestionRows.length >= 10;
    if (notify) onChange(read());
  }
  function addSuggestion(saved = {}) {
    const row = node('div', undefined, 'availability-suggestion');
    const date = node('input'),
      time = node('input');
    date.type = 'date';
    date.min = '0001-01-01';
    date.max = '9999-12-31';
    date.value = saved.date || '';
    time.type = 'time';
    time.value = saved.time || '';
    for (const [label, input] of [
      ['Suggested date', date],
      ['Time (optional)', time],
    ]) {
      const wrapper = node('label', label);
      wrapper.append(input);
      row.append(wrapper);
    }
    const remove = node('button', 'Remove date');
    remove.type = 'button';
    const entry = { row, date, time };
    remove.onclick = () => {
      suggestionRows.splice(suggestionRows.indexOf(entry), 1);
      row.remove();
      sync();
    };
    row.append(remove);
    rows.append(row);
    suggestionRows.push(entry);
  }
  const add = node('button', 'Add another date');
  add.type = 'button';
  add.onclick = () => {
    addSuggestion();
    sync();
    suggestionRows.at(-1).date.focus();
  };
  alternatives.append(add);
  const clear = node('button', 'Clear availability');
  clear.type = 'button';
  clear.disabled = readOnly;
  clear.onclick = () => {
    restore('');
    onChange('');
  };
  root.append(statuses, dates, alternatives, clear);
  root.addEventListener('input', () => sync());
  root.addEventListener('change', () => sync());
  function restore(saved) {
    statusInputs.forEach((input) => {
      input.checked = input.value === (saved?.status || 'available');
    });
    slots.forEach(({ date, period, input }) => {
      input.checked = Boolean(
        saved?.selections
          ?.find((slot) => slot.date === date)
          ?.periods.includes(period),
      );
    });
    rows.replaceChildren();
    suggestionRows.length = 0;
    for (const slot of saved?.alternatives || []) addSuggestion(slot);
    sync(false);
  }
  restore(value);
  return { root, read, restore };
}

export function availabilityDateEditor(dates, onChange) {
  const root = node('div', undefined, 'availability-date-editor');
  const values = [...dates];
  function render() {
    root.replaceChildren(node('p', 'Dates to offer'));
    values.forEach((value, index) => {
      const row = node('div'),
        label = node('label', 'Date ' + (index + 1)),
        input = node('input');
      input.type = 'date';
      input.min = '0001-01-01';
      input.max = '9999-12-31';
      input.value = value;
      input.oninput = () => {
        values[index] = input.value;
        onChange([...values]);
      };
      const remove = node('button', 'Remove date');
      remove.type = 'button';
      remove.onclick = () => {
        values.splice(index, 1);
        onChange([...values]);
        render();
      };
      label.append(input);
      row.append(label, remove);
      root.append(row);
    });
    const add = node('button', 'Add date');
    add.type = 'button';
    add.disabled = values.length >= 31;
    add.onclick = () => {
      values.push('');
      onChange([...values]);
      render();
      root
        .querySelectorAll('input')
        .item(values.length - 1)
        .focus();
    };
    root.append(add);
  }
  render();
  return root;
}
