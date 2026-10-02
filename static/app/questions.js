import { identityFields, formFooter, mountForm } from './form-client.js';
export function questionDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'workshop-dialog';
  const headingId = 'question-heading-' + crypto.randomUUID();
  dialog.setAttribute('aria-labelledby', headingId);
  dialog.innerHTML = `<div class="dialog-toolbar"><button type="button" class="dialog-close" aria-label="Close question form">×</button></div><h2 id="${headingId}">Ask the club</h2><p>Your question goes to the club inbox. An officer can reply using your email address.</p><form class="club-form">${identityFields()}<label>Subject<input name="subject" maxlength="160" required></label><label>Your question<textarea name="message" maxlength="5000" rows="5" required></textarea></label>${formFooter('Send question')}</form>`;
  let stop = () => {};
  dialog.addEventListener('close', () => {
    stop();
    dialog.remove();
  });
  dialog.querySelector('.dialog-close').onclick = () => dialog.close();
  return {
    open(event) {
      document.body.append(dialog);
      stop();
      const form = dialog.querySelector('form');
      form.reset();
      form.querySelector('[name="subject"]').value = event
        ? ('About: ' + event.title).slice(0, 160)
        : '';
      form.querySelector('.form-status').textContent = '';
      const button = form.querySelector('[type="submit"]');
      button.textContent = 'Send question';
      button.disabled = false;
      stop = mountForm(form, {
        kind: 'question',
        extra: event ? { eventId: event.id } : {},
      });
      dialog.showModal();
    },
    destroy() {
      stop();
      dialog.remove();
    },
  };
}
