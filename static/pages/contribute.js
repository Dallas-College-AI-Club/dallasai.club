import { spaceHeader } from './spaces.js';
import { EDITOR_EMAIL } from '../content/club.js';

const DRAFT_FILE = 'my-club-draft.txt';

export function submissionEmail(title, text, files = []) {
  const subject = 'The AI Review submission: ' + title.replace(/[\r\n]+/g, ' ').trim();
  const attachmentNote = files.length
    ? '\n\nFiles I will attach in my email app:\n' + files.map((name) => '- ' + name).join('\n')
    : '';
  const url = (body) =>
    `mailto:${EDITOR_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const full = url(
    `Hello AI Review editors,\n\nI would like to submit the following draft for The AI Review.\n\n${title}\n\n${text}${attachmentNote}`,
  );
  // Mail apps have different URL limits. Use a downloadable file for longer drafts.
  if (full.length <= 1800) return { href: full, needsDraftFile: false };
  return {
    href: url(
      'Hello AI Review editors,\n\nI would like to submit a draft for The AI Review. I will attach ' +
        DRAFT_FILE +
        (files.length ? ' and my supporting files' : '') +
        ' before sending.',
    ),
    needsDraftFile: true,
  };
}

export function renderContribution(root) {
  root.innerHTML =
    spaceHeader(
      'Contribute to The AI Review',
      '<span class="editorial-aside">A draft is a good place to start.</span>',
    ) +
    /* HTML */ ` <section class="contribution" aria-labelledby="draft-heading">
      <h2 id="draft-heading">What are you thinking about?</h2>
      <p class="lead">
        Write a question, reflection or project idea. Save your work here, or send a draft to the
        club editor for review.
      </p>
      <form id="draft-form">
        <label for="draft-title">Title</label>
        <input
          id="draft-title"
          required
          maxlength="140"
          placeholder="The question I keep coming back to…"
        />
        <label for="draft-body">Your draft or a note to the editor</label>
        <textarea
          id="draft-body"
          placeholder="What did you notice? What would you like to explore?"
          rows="8"
        ></textarea>
        <div class="draft-attachments">
          <label for="draft-attachments">Attachments <span>(optional)</span></label>
          <input
            id="draft-attachments"
            type="file"
            multiple
            aria-describedby="draft-attachment-note"
          />
          <p id="draft-attachment-note">
            Files stay on your device. Email links cannot attach them automatically, so add your
            selected files in your email app before sending.
          </p>
          <p id="draft-files" role="status"></p>
        </div>
        <div class="draft-actions">
          <a id="send-draft" class="solid-link" href="mailto:${EDITOR_EMAIL}"
            >Send draft for submission ↗</a
          >
          <button type="submit">Save draft on this device</button>
          <button type="button" id="download-draft">Download draft</button>
        </div>
        <p id="draft-email-note" class="draft-note">
          Opens your email app. Review the message and add attachments before you send it.
        </p>
        <p id="draft-result" role="status"></p>
      </form>
      <a class="draft-back" href="club.html?mode=journal">← Back to The AI Review</a>
    </section>`;
  const q = (selector) => root.querySelector(selector);
  const title = q('#draft-title'),
    body = q('#draft-body'),
    attachments = q('#draft-attachments');
  const files = () => [...attachments.files].map((file) => file.name);
  const sync = () => {
    body.setCustomValidity('');
    const email = submissionEmail(title.value, body.value, files());
    q('#send-draft').href = email.href;
    q('#draft-email-note').textContent = email.needsDraftFile
      ? 'This draft is too long for an email link. Sending will download the full draft as a text file. Attach it in your email app before sending.'
      : 'Opens your email app. Review the message and add attachments before you send it.';
    q('#draft-files').textContent = files().length
      ? 'Ready to attach in your email app: ' + files().join(', ')
      : '';
    return email;
  };
  const valid = () => {
    body.setCustomValidity(
      body.value.trim() || files().length
        ? ''
        : 'Write a draft or a short note, or choose a file to attach.',
    );
    return q('#draft-form').reportValidity();
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([title.value + '\n\n' + body.value], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = DRAFT_FILE;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  try {
    const draft = JSON.parse(localStorage.getItem('dc-ai-contribution') || 'null');
    if (draft && typeof draft === 'object') {
      title.value = typeof draft.title === 'string' ? draft.title : '';
      body.value = typeof draft.body === 'string' ? draft.body : '';
    }
  } catch {
    // The form still works when browser storage is unavailable.
  }
  title.oninput = body.oninput = attachments.onchange = sync;
  q('#send-draft').onclick = (event) => {
    if (!valid()) {
      event.preventDefault();
      return;
    }
    const email = sync();
    if (email.needsDraftFile) download();
    q('#draft-result').textContent = email.needsDraftFile
      ? 'Attach the downloaded draft and any selected files in your email app. If no email window opens, check that a default mail app is set up.'
      : 'Your email app will open a message to the club editor. Add any selected files, then review and send. If it does not open, check your default mail app.';
  };
  q('#draft-form').onsubmit = (event) => {
    event.preventDefault();
    if (!valid()) return;
    try {
      localStorage.setItem(
        'dc-ai-contribution',
        JSON.stringify({ title: title.value, body: body.value }),
      );
      q('#draft-result').textContent =
        'Text saved on this device. You can return to keep writing. Selected files are not saved.';
    } catch {
      q('#draft-result').textContent =
        'Device storage is unavailable. Download your draft to keep it.';
    }
  };
  q('#download-draft').onclick = () => {
    if (valid()) download();
  };
  sync();
  return () => {};
}
