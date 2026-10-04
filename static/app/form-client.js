import { PUBLISHED } from '../content/published.js';
export const formsURL = PUBLISHED.club.FORMS_API_URL || '';
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );
export const formFooter = (
  label,
  consent = 'I agree that club officers may use this information to respond to my request.',
) => `
  <div class="form-honeypot" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
  <label class="form-consent"><input name="consent" type="checkbox" required> <span>${consent}</span></label>
  <p class="form-note">Your information is shared with authorized club officers. <a href="privacy.html">How we use your information</a></p>
  <button type="submit" class="solid-link">${label}</button><p class="form-status" role="status" aria-live="polite"></p>`;
export const identityFields = (educationOnly = false) =>
  `<label>Your full name<input name="name" autocomplete="name" maxlength="100" required></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="${educationOnly ? 'you@student.dallascollege.edu' : 'you@example.com'}" ${educationOnly ? 'pattern="[^\\s@]+@[^\\s@]+[.][eE][dD][uU]" title="Use a college or alumni email address ending in .edu."' : ''}>${educationOnly ? '<span>Use a college or alumni email address ending in .edu.</span>' : ''}</label>`;
export async function request(endpoint, body, signal) {
  if (!formsURL)
    throw new Error('Forms are being connected. Please try again later.');
  const url = new URL(formsURL);
  url.pathname = url.pathname.replace(/\/forms\/?$/, '/' + endpoint);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(
      'We could not confirm receipt. Your information is still here; please try again.',
    );
  }
  const result = await response.json().catch(() => ({
    error: 'This service is not available yet. Please try again later.',
  }));
  if (
    !response.ok ||
    typeof result?.message !== 'string' ||
    !result.message.trim()
  )
    throw new Error(
      result?.error ||
        'We could not confirm receipt. Your information is still here; please try again.',
    );
  return result;
}
async function encodeFiles(files) {
  if (
    files.length > 3 ||
    files.reduce((sum, file) => sum + file.size, 0) > 2097152
  )
    throw new Error('Choose up to three files, under 2 MB in total.');
  return Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () =>
            reject(
              new Error('A file could not be read. Please choose it again.'),
            );
          reader.onload = () =>
            resolve({
              name: file.name,
              content: String(reader.result).split(',')[1],
            });
          reader.readAsDataURL(file);
        }),
    ),
  );
}
const confirmationTitles = {
  join: 'Welcome to the club!',
  subscribe: 'Subscription request received',
  rsvp: 'RSVP received',
  contribution: 'Contribution received',
  workshop: 'Workshop request received',
  question: 'Question received',
};
// Drafts live only in this tab. Keep the retry receipt with the draft so an
// uncertain save is not submitted as a new request after navigation.
const drafts = new Map();
export function mountForm(
  form,
  {
    kind,
    extra = {},
    onSuccess = () => {},
    serialize = () => ({}),
    doneURL = 'club.html',
    onDone,
  },
) {
  const controller = new AbortController();
  const dialog = form.closest('dialog');
  const draftKey = kind + ':' + (extra.eventId || '');
  const draft = drafts.get(draftKey) || {
    fields: [],
    requestId: crypto.randomUUID(),
    lastPayload: '',
  };
  const schema = (field) =>
    field.closest('[data-draft-schema]')?.dataset.draftSchema || '';
  for (const field of form.elements) {
    const saved = draft.fields.find(
      (saved) =>
        saved.name === field.name &&
        saved.type === field.type &&
        saved.schema === schema(field) &&
        (!['checkbox', 'radio'].includes(field.type) ||
          saved.value === field.value),
    );
    if (!saved) continue;
    if (field.type === 'file') field.files = saved.files;
    else if (['checkbox', 'radio'].includes(field.type))
      field.checked = saved.checked;
    else field.value = saved.value;
  }
  let attempt,
    originalContent,
    confirmation,
    completed = false;
  const hiddenIntro = [];
  const originalLabel = dialog?.getAttribute('aria-labelledby');
  const restore = () => {
    confirmation?.remove();
    if (originalContent) {
      form.replaceChildren(originalContent);
      originalContent = null;
      form.reset();
    }
    for (const [element, hidden] of hiddenIntro.splice(0))
      element.hidden = hidden;
    if (dialog && originalLabel)
      dialog.setAttribute('aria-labelledby', originalLabel);
    form.classList.remove('form-complete');
    completed = false;
    button.disabled = false;
    button.textContent = label;
    status.textContent = '';
    status.classList.remove('form-error');
  };
  let busy = false;
  const button = form.querySelector('button[type="submit"]'),
    status = form.querySelector('.form-status'),
    label = button.textContent;
  const remember = () => {
    if (completed) return;
    draft.fields = [...form.elements]
      .filter((field) => field.name && field.name !== 'website')
      .map((field) => ({
        name: field.name,
        type: field.type,
        value: field.value,
        checked: field.checked,
        files: field.type === 'file' ? field.files : undefined,
        schema: schema(field),
      }));
    drafts.set(draftKey, draft);
  };
  form.addEventListener('input', remember, { signal: controller.signal });
  form.addEventListener('change', remember, { signal: controller.signal });
  const handler = async (event) => {
    event.preventDefault();
    if (busy || completed || !form.reportValidity()) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    status.textContent = '';
    status.classList.remove('form-error');
    const currentAttempt = (attempt = new AbortController());
    try {
      const data = new FormData(form),
        body = {
          ...Object.fromEntries(data),
          ...extra,
          ...serialize(data),
          kind,
          consent: data.get('consent') === 'on',
        };
      delete body.attachments;
      if (kind === 'contribution')
        body.files = await encodeFiles([
          ...form.querySelector('[type="file"]').files,
        ]);
      const serialized = JSON.stringify(body);
      if (draft.lastPayload && serialized !== draft.lastPayload)
        draft.requestId = crypto.randomUUID();
      draft.lastPayload = serialized;
      body.requestId = draft.requestId;
      remember();
      if (controller.signal.aborted || currentAttempt.signal.aborted) return;
      const result = await request('forms', body, currentAttempt.signal);
      if (controller.signal.aborted || currentAttempt.signal.aborted) return;
      completed = true;
      drafts.delete(draftKey);
      originalContent = document.createDocumentFragment();
      originalContent.append(...form.childNodes);
      for (const element of form.parentElement.children) {
        if (
          element.matches('[data-form-intro]') ||
          (dialog && element !== form && !element.matches('.dialog-toolbar'))
        ) {
          hiddenIntro.push([element, element.hidden]);
          element.hidden = true;
        }
      }
      confirmation = document.createElement('section');
      confirmation.className = 'form-confirmation';
      const heading = document.createElement('h2');
      heading.id = 'confirmation-' + crypto.randomUUID();
      heading.tabIndex = -1;
      heading.textContent = confirmationTitles[kind];
      const message = document.createElement('p');
      message.className = 'form-success';
      message.textContent = result.message;
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'solid-link';
      done.textContent = dialog ? 'Close' : 'Done';
      done.onclick = () => {
        if (dialog) dialog.close();
        else if (onDone) onDone();
        else
          document.dispatchEvent(
            new CustomEvent('club:navigate', { detail: { href: doneURL } }),
          );
      };
      confirmation.append(heading, message, done);
      form.append(confirmation);
      form.classList.add('form-complete');
      if (dialog) {
        dialog.setAttribute('aria-labelledby', heading.id);
        dialog.scrollTop = 0;
      }
      heading.focus({ preventScroll: true });
      if (!dialog)
        confirmation.scrollIntoView({ block: 'center', behavior: 'instant' });
      draft.requestId = crypto.randomUUID();
      draft.lastPayload = '';
      onSuccess(result);
    } catch (error) {
      if (error.name !== 'AbortError') {
        status.textContent = error.message;
        status.classList.add('form-error');
        button.disabled = false;
        button.textContent = label;
      }
    } finally {
      busy = false;
    }
  };
  dialog?.addEventListener(
    'close',
    () => {
      remember();
      attempt?.abort();
      restore();
    },
    { signal: controller.signal },
  );
  form.addEventListener('submit', handler);
  return () => {
    remember();
    controller.abort();
    attempt?.abort();
    form.removeEventListener('submit', handler);
    restore();
  };
}
