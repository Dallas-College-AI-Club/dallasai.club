import { PUBLISHED } from '../content/published.js';
export const formsURL = PUBLISHED.club.FORMS_API_URL || '';
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );
export const formFooter = (
  label,
  consent = 'I agree that club officers may use this information to respond to my request.',
) => `
  <div class="form-honeypot" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
  <label class="form-consent"><input name="consent" type="checkbox" required> <span>${consent}</span></label>
  <p class="form-note">Your information is shared with authorized club officers. <a href="privacy.html">How we use your information</a></p>
  <button type="submit" class="solid-link">${label}</button><p class="form-status" role="status" aria-live="polite"></p>`;
export const identityFields = () =>
  `<label>Your name<input name="name" autocomplete="name" maxlength="100" required></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label>`;
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
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(
      'We could not confirm receipt. Your information is still here; please try again.',
    );
  }
  const result = await response
    .json()
    .catch(() => ({
      error: 'This service is not available yet. Please try again later.',
    }));
  if (!response.ok) throw new Error(result.error || 'Please try again later.');
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
export function mountForm(form, { kind, extra = {}, onSuccess = () => {} }) {
  const controller = new AbortController();
  let requestId = crypto.randomUUID(),
    busy = false,
    lastPayload = '';
  const button = form.querySelector('button[type="submit"]'),
    status = form.querySelector('.form-status'),
    label = button.textContent;
  const handler = async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    status.textContent = '';
    status.classList.remove('form-error');
    try {
      const data = new FormData(form),
        body = {
          ...Object.fromEntries(data),
          ...extra,
          kind,
          consent: data.get('consent') === 'on',
        };
      delete body.attachments;
      if (kind === 'contribution')
        body.files = await encodeFiles([
          ...form.querySelector('[type="file"]').files,
        ]);
      const serialized = JSON.stringify(body);
      if (lastPayload && serialized !== lastPayload)
        requestId = crypto.randomUUID();
      lastPayload = serialized;
      body.requestId = requestId;
      const result = await request('forms', body, controller.signal);
      if (controller.signal.aborted) return;
      status.textContent = result.message;
      status.classList.add('form-success');
      onSuccess(result);
      button.textContent = 'Received';
      // Keep the submitted details visible; edits enable another submission.
      form.addEventListener(
        'input',
        () => {
          button.disabled = false;
          button.textContent = label;
          status.classList.remove('form-success');
        },
        { once: true, signal: controller.signal },
      );
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
  form.addEventListener('submit', handler);
  return () => {
    controller.abort();
    form.removeEventListener('submit', handler);
  };
}
