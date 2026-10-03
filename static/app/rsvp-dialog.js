import {
  identityFields,
  formFooter,
  mountForm,
  escapeHTML as h,
} from './form-client.js';
export function rsvpDialog(root) {
  const dialog = document.createElement('dialog');
  dialog.className = 'workshop-dialog rsvp-dialog';
  dialog.setAttribute('aria-labelledby', 'rsvp-heading');
  root.append(dialog);
  let stop = () => {},
    eventId = '';
  function close() {
    if (dialog.open) dialog.close();
  }
  function open(event) {
    stop();
    eventId = event.id;
    const questions = event.surveyQuestions || [];
    const fields = questions
      .map((question, index) => {
        const name = 'answer-' + question.id;
        const description = question.description
          ? '<p id="' + name + '-help">' + h(question.description) + '</p>'
          : '';
        const described = question.description
          ? ' aria-describedby="' + name + '-help"'
          : '';
        const label =
          h(index + 1 + '. ' + question.label) +
          (question.required
            ? ' <span>(required)</span>'
            : ' <span>(optional)</span>');
        if (question.type === 'text')
          return (
            '<fieldset class="survey-question"><legend>' +
            label +
            '</legend>' +
            description +
            '<textarea aria-label="' +
            h(question.label) +
            '" name="' +
            name +
            '" maxlength="3000" rows="3"' +
            described +
            (question.required ? ' required' : '') +
            '></textarea></fieldset>'
          );
        const options = [
          ...question.options,
          ...(question.allowOther ? ['__other__'] : []),
        ];
        return (
          '<fieldset class="survey-question" data-question="' +
          question.id +
          '"><legend>' +
          label +
          '</legend>' +
          description +
          options
            .map(
              (option) =>
                '<label class="survey-choice"><input type="' +
                (question.type === 'multiple' ? 'checkbox' : 'radio') +
                '" name="' +
                name +
                '" value="' +
                h(option) +
                '"' +
                described +
                (question.type === 'single' && question.required
                  ? ' required'
                  : '') +
                '><span>' +
                h(option === '__other__' ? 'Other' : option) +
                '</span></label>',
            )
            .join('') +
          (question.type === 'single' && !question.required
            ? '<button type="button" class="survey-clear outline-link" data-clear="' +
              question.id +
              '">Clear answer</button>'
            : '') +
          (question.allowOther
            ? '<label class="survey-other" hidden>Other answer<textarea name="' +
              name +
              '-other" maxlength="1000" rows="2" disabled></textarea></label>'
            : '') +
          '</fieldset>'
        );
      })
      .join('');
    dialog.innerHTML =
      '<div class="dialog-toolbar"><button type="button" class="dialog-close" aria-label="Close RSVP">×</button></div>' +
      '<span class="tag">' +
      (event.potential
        ? 'POTENTIAL EVENT · DATE ' +
          (event.date ? h(event.date.slice(0, 10)) : 'TBD')
        : 'EVENT RSVP') +
      '</span>' +
      '<h2 id="rsvp-heading">' +
      h(event.title) +
      '</h2>' +
      (event.potential
        ? '<p>This records your interest. Final details and seats are not yet confirmed.</p>'
        : '') +
      (event.surveyIntro
        ? '<p class="survey-intro">' + h(event.surveyIntro) + '</p>'
        : '') +
      '<form id="event-rsvp" class="club-form">' +
      identityFields(event.requireEduEmail === true) +
      fields +
      formFooter(
        'Submit RSVP',
        'I agree that club officers may use my RSVP and answers to plan this event and contact me about it.',
      ) +
      '</form>';
    dialog.querySelector('.dialog-close').onclick = close;
    const form = dialog.querySelector('form');
    function validateChoices() {
      for (const question of questions.filter((q) => q.type !== 'text')) {
        const inputs = [
          ...form.querySelectorAll('[name="answer-' + question.id + '"]'),
        ];
        const selected = inputs
          .filter((input) => input.checked)
          .map((input) => input.value);
        if (question.type === 'multiple')
          inputs[0].setCustomValidity(
            question.required && !selected.length
              ? 'Choose at least one answer.'
              : '',
          );
        const other = form.elements.namedItem(
          'answer-' + question.id + '-other',
        );
        if (other) {
          other.disabled = !selected.includes('__other__');
          other.required = !other.disabled;
          other.closest('label').hidden = other.disabled;
        }
      }
    }
    form.addEventListener('change', validateChoices);
    form.querySelectorAll('[data-clear]').forEach((button) => {
      button.onclick = () => {
        form
          .querySelectorAll('[name="answer-' + button.dataset.clear + '"]')
          .forEach((input) => (input.checked = false));
        validateChoices();
      };
    });
    validateChoices();
    stop = mountForm(form, {
      kind: 'rsvp',
      extra: { eventId, surveyVersion: event.surveyVersion || '' },
      serialize: (data) => ({
        answers: questions.map((question) => ({
          questionId: question.id,
          value:
            question.type === 'multiple'
              ? data.getAll('answer-' + question.id)
              : data.get('answer-' + question.id) || '',
          other: data.get('answer-' + question.id + '-other') || '',
        })),
      }),
    });
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }
  return {
    open,
    update(event) {
      if (!dialog.open) return;
      if (!event || event.id !== eventId || event.registrationOpen === false)
        close();
      // Keep entered answers during feed refresh; the server rejects stale versions.
    },
    destroy() {
      stop();
      close();
      dialog.remove();
    },
  };
}
