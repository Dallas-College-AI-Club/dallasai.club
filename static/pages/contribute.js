import { spaceHeader } from './spaces.js';
import { formFooter, identityFields, mountForm } from '../app/form-client.js';
export function renderContribution(root) {
  root.innerHTML =
    spaceHeader('Contribute to The AI Review') +
    `<section class="contribution"><h2>What are you thinking about?</h2><p class="lead">Send a question, reflection, or project idea to the club editor. You can save a draft on this device before submitting.</p>
    <form id="draft-form" class="club-form">${identityFields()}
      <label>Title<input name="title" id="draft-title" required maxlength="140" placeholder="The question I keep coming back to…"></label>
      <label>Your draft or a note to the editor<textarea name="body" id="draft-body" rows="10" maxlength="40000"></textarea></label>
      <label>Attachments <span>(optional)</span><input name="attachments" type="file" multiple accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"></label>
      <p class="form-note">Up to three PDF, DOCX, text, Markdown, PNG, or JPG files, under 2 MB in total. Files are private and available to authorized club officers.</p>
      ${formFooter('Submit for review', 'I agree to share this contribution with the club editors for review. Submission does not guarantee publication.')}
      <div class="draft-actions"><button type="button" id="save-draft">Save draft on this device</button><button type="button" id="download-draft">Download draft</button></div>
      <p id="draft-local-status" role="status"></p>
    </form><a class="draft-back" href="club.html?mode=journal">← Back to The AI Review</a></section>`;
  const form = root.querySelector('form'),
    title = root.querySelector('#draft-title'),
    body = root.querySelector('#draft-body');
  try {
    const draft = JSON.parse(
      localStorage.getItem('dc-ai-contribution') || 'null',
    );
    if (draft) {
      title.value = typeof draft.title === 'string' ? draft.title : '';
      body.value = typeof draft.body === 'string' ? draft.body : '';
    }
  } catch {}
  root.querySelector('#save-draft').onclick = () => {
    try {
      localStorage.setItem(
        'dc-ai-contribution',
        JSON.stringify({ title: title.value, body: body.value }),
      );
      root.querySelector('#draft-local-status').textContent =
        'Draft text saved on this device. Attachments are not saved.';
    } catch {
      root.querySelector('#draft-local-status').textContent =
        'Device storage is unavailable. Download your draft to keep it.';
    }
  };
  root.querySelector('#download-draft').onclick = () => {
    const url = URL.createObjectURL(
        new Blob([title.value + '\n\n' + body.value], {
          type: 'text/plain;charset=utf-8',
        }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = 'my-club-draft.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return mountForm(form, { kind: 'contribution' });
}
