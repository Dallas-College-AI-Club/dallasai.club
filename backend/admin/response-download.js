// Download PDF for one survey response: a dialog to choose the heading, then
// a PDF file (jsPDF, loaded on first use) or, when the PDF font cannot show
// some characters, the same document in a print view for the browser to
// print or save as PDF. Answers are never edited here.
import { button, h, node } from './ui.js';
import { isPaused } from './session.js';
import {
  pdfMissing,
  pdfReady,
  responseDocument,
  responseFilename,
} from './response-document.js';
// The last heading used for each survey. Storage can be unavailable
// (private windows, blocked site data); the survey title is the default.
const stored = (survey) => 'club-office-pdf-heading:' + survey.id;
function lastHeading(survey) {
  try {
    return localStorage.getItem(stored(survey)) || survey.title;
  } catch {
    return survey.title;
  }
}
function keepHeading(survey, heading) {
  try {
    if (heading === survey.title) localStorage.removeItem(stored(survey));
    else localStorage.setItem(stored(survey), heading);
  } catch {
    // Remembering the heading is a convenience only.
  }
}
let printing = null;
// Removes the print view, e.g. when the results are cleared or reloaded.
export function closePrintView() {
  const open = printing;
  printing = null;
  open?.view.close();
  open?.view.remove();
  open?.copy.remove();
}
// The document as a page, with the PDF's heading and order. Every script
// shows, in the page's own fonts; style.css lays it out for paper.
function printDocument(model) {
  const page = h(
    'article',
    { className: 'print-document' },
    node('p', model.club, 'print-club'),
    node('h1', model.title),
  );
  const details = node('dl');
  for (const [label, value] of model.details)
    details.append(node('dt', label), node('dd', value));
  page.append(details);
  for (const block of model.blocks) {
    if (block.heading) {
      page.append(node('h2', block.heading));
      continue;
    }
    const answer = h('section', {}, node('h3', block.question));
    if (block.kind === 'ranked' || block.kind === 'choices') {
      const list = node(block.kind === 'ranked' ? 'ol' : 'ul');
      for (const line of block.lines)
        list.append(node('li', line.replace(/^\d+\.\s*/, '')));
      answer.append(list);
    } else
      for (const paragraph of block.lines.join('\n').split('\n\n'))
        answer.append(
          node('p', paragraph, block.kind === 'none' ? 'print-note' : ''),
        );
    for (const note of block.notes)
      answer.append(node('p', note, 'print-note'));
    page.append(answer);
  }
  return page;
}
// On screen a dialog shows the document. On paper a plain copy prints: a
// dialog sits above the page, so it cannot take the page margins and
// numbers in style.css.
function openPrintView(model, trigger) {
  closePrintView();
  const view = h('dialog', {
      className: 'print-view',
      'aria-label': 'Print view',
    }),
    copy = h('div', { className: 'print-copy' }, printDocument(model));
  view.append(
    h(
      'div',
      { className: 'print-toolbar' },
      button('Print / Save as PDF', () => window.print(), 'btn-primary'),
      button('Close', () => view.close()),
    ),
    printDocument(model),
  );
  // A paused session closes dialogs and reopens them after sign-in.
  view.addEventListener('close', () => {
    if (isPaused() || printing?.view !== view) return;
    closePrintView();
    if (trigger.isConnected) trigger.focus();
  });
  document.body.append(view, copy);
  printing = { view, copy };
  view.showModal();
  window.print();
}
export function downloadResponse({
  survey,
  result,
  definition,
  api,
  isCurrent,
  status,
  trigger,
}) {
  const input = h('input', {
      name: 'heading',
      value: lastHeading(survey),
      maxLength: 200,
      autocomplete: 'off',
    }),
    note = node(
      'p',
      'Some characters here only show with Print / Save as PDF.',
      'hint',
    ),
    printButton = button('Print / Save as PDF', () => finish('print')),
    form = h(
      'form',
      {
        onsubmit: (event) => {
          event.preventDefault();
          finish('pdf');
        },
      },
      h('label', {}, 'PDF heading', input),
      note,
      h(
        'div',
        { className: 'dialog-actions' },
        button('Cancel', () => dialog.close()),
        printButton,
        h(
          'button',
          { type: 'submit', className: 'btn-primary' },
          'Download PDF',
        ),
      ),
    ),
    dialog = h(
      'dialog',
      { className: 'pdf-dialog', 'aria-labelledby': 'pdf-dialog-title' },
      h('h2', { id: 'pdf-dialog-title' }, 'Download PDF'),
      form,
    );
  const heading = () => input.value.trim() || survey.title;
  const model = () =>
    responseDocument(result, { title: heading(), definition });
  const check = () => {
    note.hidden = printButton.hidden = !pdfMissing(JSON.stringify(model()));
  };
  input.oninput = check;
  check();
  dialog.addEventListener('close', () => {
    if (isPaused()) return;
    dialog.remove();
    if (trigger.isConnected) trigger.focus();
  });
  trigger.parentElement.append(dialog);
  dialog.showModal();
  input.select();
  async function finish(kind) {
    const chosen = model();
    keepHeading(survey, heading());
    dialog.close();
    status.textContent = kind === 'pdf' ? 'Preparing PDF…' : '';
    try {
      if (kind === 'pdf') {
        // A stale file name after an update cannot load; a reload fixes it.
        const { responsePdf } = await import('./response-pdf.js').catch(() => {
          throw new Error(
            'Club Office was updated. Reload the page to download the PDF.',
          );
        });
        if (!isCurrent()) return;
        responsePdf(pdfReady(chosen)).save(
          responseFilename(survey.title, result),
        );
      } else openPrintView(chosen, trigger);
      // Recorded once the document exists, like the CSV export.
      await api('/api/custom-surveys?action=response-pdf', {
        id: survey.id,
        advisorId: result.advisor_id,
      });
      if (isCurrent() && kind === 'pdf') status.textContent = 'PDF downloaded.';
    } catch (error) {
      if (isCurrent()) status.textContent = error.message;
    }
  }
}
