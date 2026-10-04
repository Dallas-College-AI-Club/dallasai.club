import { lock, node } from './ui.js';
import { drafts } from './session.js';
import { FIELD_SCHEMA } from './format.js';
const campuses = [
  'Brookhaven',
  'Cedar Valley',
  'Eastfield',
  'El Centro',
  'Mountain View',
  'North Lake',
  'Richland',
  'Other / community',
];

export function submissionEditor(api, onSaved) {
  const dialog = node('dialog', undefined, 'contact-dialog submission-dialog');
  const headingId = 'submission-dialog-' + crypto.randomUUID();
  dialog.setAttribute('aria-labelledby', headingId);
  document.body.append(dialog);
  let generation = 0,
    busy = false,
    entryId = '',
    dirty = () => false;
  function canClose() {
    return (
      !busy && (!dirty() || confirm('Discard your unsaved response changes?'))
    );
  }
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (canClose()) clear();
  });
  // Unsaved edits stay in the dialog's form, also while it is closed for
  // re-authentication; report them to the drafts store.
  drafts.track(() =>
    busy || dirty()
      ? [{ key: 'response:' + entryId, label: 'Edits to a submission' }]
      : [],
  );
  function clear() {
    generation++;
    busy = false;
    dirty = () => false;
    dialog.close();
    dialog.replaceChildren();
  }
  async function open(id, { surface = 'inbox', remove = false } = {}) {
    const version = ++generation;
    entryId = id;
    const title = node(
      'h2',
      remove ? 'Permanently delete response?' : 'Edit response',
    );
    title.id = headingId;
    const message = node('p', 'Loading response…');
    message.setAttribute('role', 'status');
    const cancel = node('button', 'Cancel', 'secondary');
    cancel.type = 'button';
    cancel.onclick = () => {
      if (canClose()) clear();
    };
    dialog.replaceChildren(title, message, cancel);
    if (!dialog.open) dialog.showModal();
    try {
      const { entry } = await api('/api/admin?edit=' + encodeURIComponent(id));
      if (version !== generation || !dialog.open) return;
      const form = node('form'),
        intro = node(
          'p',
          entry.data.eventTitle ||
            entry.data.subject ||
            entry.data.title ||
            entry.data.topic ||
            'Club submission',
          'hint',
        );
      let read = () => ({});
      if (remove) {
        form.append(
          node('p', `${entry.name || entry.email} · ${entry.email}`),
          node(
            'p',
            'This permanently deletes this response, its survey answers, comments and attachments from Inbox and Surveys. It cannot be undone.',
          ),
          node(
            'p',
            'The tied name and email will also be removed if they have no other submissions, contact notes or custom survey memberships.',
          ),
        );
      } else {
        form.append(
          node(
            'p',
            'Changes are saved to this response and recorded in its activity history.',
            'hint',
          ),
        );
        const name = input(
          form,
          'Full name',
          entry.name,
          100,
          entry.kind !== 'subscribe',
        );
        const email = input(form, 'Email address', entry.email, 254, true);
        email.type = 'email';
        const values = {};
        for (const [key, label, max, required] of FIELD_SCHEMA[entry.kind] ||
          []) {
          if (key === 'campus') {
            const labelEl = node('label', label),
              select = node('select');
            select.append(...campuses.map((value) => new Option(value, value)));
            select.value = entry.data[key] || '';
            select.required = true;
            labelEl.append(select);
            form.append(labelEl);
            values[key] = select;
          } else
            values[key] = input(
              form,
              label,
              entry.data[key] || '',
              max,
              required,
            );
        }
        const answers = (entry.survey?.questions || []).map((question) =>
          questionInput(
            form,
            question,
            entry.survey.answers.find(
              (answer) => answer.questionId === question.id,
            ),
          ),
        );
        read = () => ({
          name: name.value,
          email: email.value,
          data: Object.fromEntries(
            Object.entries(values).map(([key, control]) => [
              key,
              control.value,
            ]),
          ),
          ...(entry.survey
            ? { answers: answers.map((answer) => answer()) }
            : {}),
        });
      }
      const actions = node('div', undefined, 'survey-response-actions');
      const original = JSON.stringify(read());
      dirty = () => !remove && JSON.stringify(read()) !== original;
      const save = node(
        'button',
        remove ? 'Delete permanently' : 'Save changes',
        remove ? 'danger' : '',
      );
      save.type = 'submit';
      actions.append(cancel, save);
      form.append(actions, message);
      message.textContent = '';
      dialog.replaceChildren(title, intro, form);
      if (remove) cancel.focus();
      else form.querySelector('input')?.focus();
      let previous = '',
        requestId = '';
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (busy) return;
        const payload = {
          action: remove ? 'delete-submission' : 'edit-submission',
          entryId: id,
          expectedRevision: entry.edit_revision,
          ...read(),
        };
        const signature = JSON.stringify(payload);
        if (signature !== previous) {
          previous = signature;
          requestId = crypto.randomUUID();
        }
        busy = true;
        const unlock = lock(form);
        message.textContent = remove ? 'Deleting…' : 'Saving…';
        try {
          const result = await api(
            surface === 'survey' ? '/api/surveys' : '/api/admin',
            { ...payload, requestId },
          );
          if (version !== generation) return;
          clear();
          await onSaved({
            removed: remove,
            entryId: id,
            filesCleaned: result.filesCleaned,
          });
        } catch (error) {
          if (version === generation) {
            message.textContent = error.message;
            busy = false;
            unlock();
          }
        }
      };
    } catch (error) {
      if (version === generation) message.textContent = error.message;
    }
  }
  return { open, clear };
}
function input(parent, label, value, max, required) {
  const wrapper = node('label', label),
    control = node(max > 300 ? 'textarea' : 'input');
  control.value = value;
  control.maxLength = max;
  control.required = required;
  if (control.tagName === 'TEXTAREA') control.rows = max > 5000 ? 10 : 4;
  wrapper.append(control);
  parent.append(wrapper);
  return control;
}
function questionInput(parent, question, answer) {
  const group = node('fieldset', undefined, 'submission-question');
  group.append(
    node('legend', question.label + (question.required ? ' (required)' : '')),
  );
  if (question.description)
    group.append(node('p', question.description, 'hint'));
  parent.append(group);
  if (question.type === 'text') {
    const control = input(
      group,
      'Answer',
      answer?.value || '',
      3000,
      question.required,
    );
    return () => ({
      questionId: question.id,
      value: control.value,
      other: '',
    });
  }
  const controls = [];
  let select;
  if (question.type === 'single') {
    select = node('select');
    select.setAttribute('aria-label', question.label);
    select.required = question.required;
    select.append(
      new Option('Choose an answer', ''),
      ...question.options.map((option) => new Option(option, option)),
    );
    if (question.allowOther) select.append(new Option('Other', '__other__'));
    select.value = answer?.value || '';
    group.append(select);
  } else {
    for (const option of [
      ...question.options,
      ...(question.allowOther ? ['__other__'] : []),
    ]) {
      const label = node('label', undefined, 'submission-choice'),
        control = node('input');
      control.type = 'checkbox';
      control.value = option;
      control.checked = answer?.value?.includes(option) || false;
      label.append(
        control,
        document.createTextNode(option === '__other__' ? 'Other' : option),
      );
      group.append(label);
      controls.push(control);
    }
  }
  const other = input(group, 'Other answer', answer?.other || '', 1000, false);
  const values = () =>
    select
      ? [select.value]
      : controls
          .filter((control) => control.checked)
          .map((control) => control.value);
  function sync() {
    const any = controls.find(
      (control) => control.value.toLowerCase().trim() === 'any of these',
    );
    for (const control of controls) {
      control.disabled = Boolean(any?.checked && control !== any);
      if (control.disabled) control.checked = false;
    }
    const hasOther = values().includes('__other__');
    other.disabled = !hasOther;
    other.required = hasOther;
    other.parentElement.hidden = !hasOther;
    if (controls[0])
      controls[0].setCustomValidity(
        question.required && !values().length
          ? 'Choose at least one answer.'
          : '',
      );
  }
  group.addEventListener('change', sync);
  sync();
  return () => ({
    questionId: question.id,
    value: select ? select.value : values(),
    other: values().includes('__other__') ? other.value : '',
  });
}
