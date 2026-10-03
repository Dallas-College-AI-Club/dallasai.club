import { activityTime } from './event-activity.js';
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
const labels = {
  join: 'Club signup',
  subscribe: 'Newsletter subscription',
  rsvp: 'Event RSVP',
  question: 'Question',
  workshop: 'Workshop request',
  contribution: 'AI Review submission',
};
export function contactHistory(api) {
  const dialog = node('dialog', undefined, 'contact-dialog');
  dialog.setAttribute('aria-labelledby', 'contact-heading');
  const close = node('button', 'Close', 'secondary'),
    heading = node('h2', 'Contacts'),
    intro = node(
      'p',
      'Website submissions and officer notes are linked by email. Notes record follow-up; this page does not send or read emails.',
      'hint',
    );
  heading.id = 'contact-heading';
  const toolbar = node('div', undefined, 'heading');
  toolbar.append(heading, close);
  const searchForm = node('form', undefined, 'survey-tools'),
    label = node('label', 'Find a contact by name or email'),
    search = node('input'),
    find = node('button', 'Search contacts');
  search.type = 'search';
  search.maxLength = 200;
  label.append(search);
  searchForm.append(label, find);
  const status = node('p');
  status.setAttribute('role', 'status');
  const content = node('div'),
    paging = node('div', undefined, 'pagination'),
    prev = node('button', 'Previous', 'secondary'),
    next = node('button', 'Next', 'secondary');
  paging.append(prev, next);
  dialog.append(toolbar, intro, searchForm, status, content, paging);
  document.body.append(dialog);
  let generation = 0,
    email = '',
    offset = 0;
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    generation++;
    content.replaceChildren();
    search.value = '';
    status.textContent = '';
  });
  async function load() {
    const version = ++generation;
    status.textContent = 'Loading contacts…';
    content.replaceChildren();
    prev.disabled = next.disabled = true;
    try {
      const params = new URLSearchParams(
        email
          ? { contact: email, offset }
          : { contacts: '1', search: search.value, offset },
      );
      const data = await api('/api/surveys?' + params);
      if (version !== generation || !dialog.open) return;
      if (!email) {
        heading.textContent = 'Contacts';
        for (const c of data.contacts) {
          const button = node('button', undefined, 'contact-choice secondary');
          button.append(
            node('strong', c.name || c.email),
            node('span', c.email),
            node('small', c.submissions + ' website submissions'),
          );
          button.onclick = () => {
            email = c.email;
            offset = 0;
            load();
          };
          content.append(button);
        }
        status.textContent = data.contacts.length
          ? 'Select a contact to see their history.'
          : 'No matching contacts.';
      } else {
        heading.textContent = data.contact.name || email;
        const back = node('button', '← All contacts', 'secondary');
        back.onclick = () => {
          email = '';
          offset = 0;
          load();
        };
        content.append(
          back,
          node('p', email),
          node(
            'p',
            'Names used: ' + (data.contact.names || []).join(' · '),
            'hint',
          ),
        );
        const form = node('form', undefined, 'contact-note-form'),
          noteLabel = node('label', 'Record a follow-up note'),
          note = node('textarea'),
          save = node('button', 'Save note'),
          noteStatus = node('p');
        note.rows = 3;
        note.maxLength = 5000;
        note.required = true;
        noteLabel.append(note);
        noteStatus.setAttribute('role', 'status');
        form.append(noteLabel, save, noteStatus);
        content.append(form);
        let noteId = crypto.randomUUID();
        note.oninput = () => {
          noteId = crypto.randomUUID();
        };
        form.onsubmit = async (event) => {
          event.preventDefault();
          save.disabled = true;
          note.disabled = true;
          noteStatus.textContent = 'Saving note…';
          try {
            await api('/api/surveys', {
              action: 'contact-note',
              email,
              noteId,
              note: note.value,
            });
            if (version !== generation) return;
            offset = 0;
            await load();
            status.textContent = 'Follow-up note saved.';
          } catch (error) {
            if (version === generation) {
              noteStatus.textContent = error.message;
              save.disabled = false;
              note.disabled = false;
            }
          }
        };
        for (const item of data.history) {
          const card = node('article', undefined, 'contact-entry');
          card.append(
            node(
              'h3',
              item.type === 'submission'
                ? labels[item.label] || item.label
                : item.type === 'comment'
                  ? 'Officer comment'
                  : item.label,
            ),
            node(
              'p',
              activityTime(item.created_at) + ' · ' + item.actor,
              'hint',
            ),
          );
          if (item.body) card.append(node('p', item.body, 'contact-note-text'));
          for (const key of [
            'eventTitle',
            'eventDate',
            'topic',
            'subject',
            'question',
            'message',
            'body',
            'details',
            'title',
            'summary',
          ])
            if (typeof item.details?.[key] === 'string' && item.details[key])
              card.append(node('p', item.details[key], 'contact-note-text'));
          if (item.entry_id) {
            const link = node('a', 'Open submission');
            link.href = '#entry=' + encodeURIComponent(item.entry_id);
            link.onclick = () => dialog.close();
            card.append(link);
          }
          content.append(card);
        }
        status.textContent = 'History · page ' + (offset / 50 + 1);
      }
      prev.disabled = offset === 0;
      next.disabled = !data.hasMore;
    } catch (error) {
      if (version === generation) status.textContent = error.message;
    }
  }
  searchForm.onsubmit = (event) => {
    event.preventDefault();
    email = '';
    offset = 0;
    load();
  };
  prev.onclick = () => {
    offset = Math.max(0, offset - 50);
    load();
  };
  next.onclick = () => {
    offset += 50;
    load();
  };
  return {
    open(address = '') {
      email = address;
      offset = 0;
      if (!dialog.open) dialog.showModal();
      load();
    },
    clear() {
      generation++;
      if (dialog.open) dialog.close();
      content.replaceChildren();
      search.value = '';
      status.textContent = '';
      email = '';
      offset = 0;
    },
  };
}
