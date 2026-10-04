import { button, lock, node } from './ui.js';
import {
  actionLabel,
  actorLabel,
  dateTime,
  kindLabel,
  plural,
} from './format.js';
import { contactProfile } from './contact-profile.js';
import { currentOfficer, drafts } from './session.js';
// Unsaved notes are kept as contactNote:<email> and profile edits as
// profile:<email> in the drafts store. A profile draft remembers the
// contact revision it started from, so a later change can be pointed out.
const noteKey = (address) => 'contactNote:' + address,
  noteDraftLabel = (address) => 'Follow-up note for ' + address,
  profileKey = (address) => 'profile:' + address;
function forgetProfiles(addresses) {
  for (const address of addresses) drafts.delete(profileKey(address));
}
// The Contacts tab: renders into root (the pane), which stays in the page
// while other tabs show, so a search or an open profile is kept.
export function contactHistory(api, onChange = () => {}, root) {
  const heading = node('h1', 'Contacts'),
    intro = node(
      'p',
      'Link a person’s school email addresses to see their website submissions and officer notes together. Notes record follow-up; this page does not send or read emails.',
      'hint',
    );
  heading.id = 'contacts-heading';
  heading.tabIndex = -1;
  const toolbar = node('div', undefined, 'heading view-header');
  toolbar.append(heading);
  const searchForm = node('form', undefined, 'survey-tools'),
    label = node('label', 'Find a contact by name or email'),
    search = node('input'),
    find = node('button', 'Search contacts'),
    viewLabel = node('label', 'Show contacts'),
    view = node('select');
  search.type = 'search';
  search.maxLength = 200;
  label.append(search);
  view.append(
    new Option('Active', 'active'),
    new Option('Deleted', 'deleted'),
    new Option('All contacts', 'all'),
  );
  view.setAttribute('aria-label', 'Show contacts');
  viewLabel.append(view);
  searchForm.append(label, viewLabel, find);
  const status = node('p');
  status.setAttribute('role', 'status');
  const content = node('div'),
    paging = node('div', undefined, 'pagination'),
    prev = node('button', 'Previous', 'secondary'),
    next = node('button', 'Next', 'secondary'),
    retry = node('button', 'Try loading contacts again', 'secondary');
  retry.hidden = true;
  retry.onclick = () => load();
  paging.append(prev, next);
  root.append(toolbar, intro, searchForm, status, retry, content, paging);
  let generation = 0,
    email = '',
    offset = 0,
    loaded = false;
  async function load() {
    const version = ++generation;
    loaded = true;
    retry.hidden = true;
    status.textContent = 'Loading contacts…';
    content.replaceChildren();
    prev.disabled = next.disabled = true;
    try {
      const params = new URLSearchParams(
        email
          ? { contact: email, offset }
          : {
              contacts: '1',
              search: search.value,
              offset,
              view: view.value,
            },
      );
      const data = await api('/api/surveys?' + params);
      if (version !== generation) return;
      if (!email) {
        heading.textContent = 'Contacts';
        for (const c of data.contacts) {
          const button = node('button', undefined, 'contact-choice secondary');
          button.append(
            node('strong', c.name || c.email),
            node('span', c.email),
            node('small', plural(c.submissions, 'submission')),
          );
          if (c.emails.length > 1)
            button.append(
              node(
                'small',
                plural(
                  new Set(c.emails).size - 1,
                  'more linked email address',
                  'more linked email addresses',
                ),
              ),
            );
          if (c.is_test)
            button.append(node('span', 'Test contact', 'contact-badge'));
          if (c.deleted_at)
            button.append(node('span', 'Deleted', 'contact-badge'));
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
        email = data.contact.email;
        heading.textContent = data.contact.name || email;
        const back = node('button', '← All contacts', 'secondary');
        back.onclick = () => {
          email = '';
          offset = 0;
          load();
        };
        content.append(
          back,
          node('p', 'Primary email: ' + email, 'contact-note-text'),
          node(
            'p',
            'Other linked emails: ' +
              ([...new Set(data.contact.emails)]
                .filter((address) => address !== email)
                .join(' · ') || 'None'),
            'contact-note-text',
          ),
          node(
            'p',
            'Names used: ' + (data.contact.names || []).join(' · '),
            'hint',
          ),
        );
        content.append(management(data.contact, version));
        const form = node('form', undefined, 'contact-note-form'),
          noteLabel = node('label', 'Record a follow-up note'),
          note = node('textarea'),
          save = node('button', 'Save note'),
          noteStatus = node('p');
        note.rows = 3;
        note.maxLength = 5000;
        note.required = true;
        const address = data.contact.email;
        const previous = drafts.get(noteKey(address));
        note.value = previous?.text || '';
        noteLabel.append(note);
        noteStatus.setAttribute('role', 'status');
        form.append(noteLabel, save, noteStatus);
        if (!data.contact.deleted_at) content.append(form);
        let noteId = previous?.id || crypto.randomUUID();
        if (previous)
          noteStatus.textContent =
            'Unsaved note restored. Select Save note to add it to the contact history.';
        note.oninput = () => {
          noteId = crypto.randomUUID();
          if (note.value)
            drafts.set(
              noteKey(address),
              { text: note.value, id: noteId },
              noteDraftLabel(address),
            );
          else drafts.delete(noteKey(address));
        };
        form.onsubmit = async (event) => {
          event.preventDefault();
          if (save.disabled) return;
          const submittedId = noteId;
          save.disabled = true;
          note.disabled = true;
          noteStatus.textContent = 'Saving note…';
          try {
            await api('/api/surveys', {
              action: 'contact-note',
              email: address,
              noteId: submittedId,
              note: note.value,
            });
            if (drafts.get(noteKey(address))?.id === submittedId)
              drafts.delete(noteKey(address));
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
                ? kindLabel(item.label)
                : item.type === 'comment'
                  ? 'Officer comment'
                  : item.type === 'activity'
                    ? actionLabel(item.label)
                    : item.label,
            ),
            node(
              'p',
              dateTime(item.created_at) +
                ' · ' +
                actorLabel(item.actor, currentOfficer()),
              'hint',
            ),
          );
          if (item.body) card.append(node('p', item.body, 'contact-note-text'));
          if (item.source_email)
            card.append(node('p', item.source_email, 'hint contact-note-text'));
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
            link.href = '#/inbox/' + encodeURIComponent(item.entry_id);
            card.append(link);
          }
          content.append(card);
        }
        status.textContent =
          (data.contact.deleted_at ? 'Deleted contact · ' : '') +
          (data.contact.is_test ? 'Test contact · ' : '') +
          'History · page ' +
          (offset / 50 + 1);
      }
      prev.disabled = offset === 0;
      next.disabled = !data.hasMore;
    } catch (error) {
      if (version === generation) {
        status.textContent = error.message;
        retry.hidden = false;
      }
    }
  }
  function management(contact, version) {
    const panel = node('section', undefined, 'contact-management'),
      actions = node('div', undefined, 'survey-response-actions'),
      // Filled red marks the one action that cannot be undone; Delete
      // contact can be restored, so it stays neutral.
      test = node(
        'button',
        contact.is_test ? 'Unmark as test' : 'Mark as test',
        contact.is_test ? 'secondary' : 'danger filled',
      ),
      remove = node(
        'button',
        contact.is_test ? 'Permanently delete test contact' : 'Delete contact',
        contact.is_test ? 'danger filled' : 'secondary',
      ),
      restore = node('button', 'Restore contact', 'secondary'),
      merge = node('button', 'Merge with another contact', 'secondary'),
      edit = node('button', 'Edit contact', 'secondary'),
      details = node('div', undefined, 'contact-confirmation');
    const fresh = () => version === generation;
    async function save(body, message) {
      if (!fresh()) return;
      const unlock = lock(panel, 'button, input');
      status.textContent = 'Saving contact changes…';
      try {
        const result = await api('/api/surveys', {
          email: contact.email,
          revision: contact.revision,
          ...body,
        });
        if (result.edited || result.purged || result.deleted)
          forgetProfiles(contact.emails);
        // A purge deletes this person's records, so only their drafts go.
        if (result.purged)
          for (const draft of drafts.list())
            if (
              contact.emails.some(
                (address) => draft.key === noteKey(address),
              ) ||
              (draft.key.startsWith('note:') &&
                contact.emails.includes(draft.value?.email))
            )
              drafts.delete(draft.key);
        if (result.merged || result.edited) {
          const combined = [
            drafts.get(noteKey(result.email)),
            ...contact.emails.map((address) => drafts.get(noteKey(address))),
          ].filter(Boolean);
          for (const address of contact.emails) drafts.delete(noteKey(address));
          if (combined.length)
            drafts.set(
              noteKey(result.email),
              {
                text: [...new Set(combined.map((draft) => draft.text))].join(
                  '\n\n',
                ),
                id: crypto.randomUUID(),
              },
              noteDraftLabel(result.email),
            );
        }
        if (!fresh()) return;
        if (result.purged || result.deleted) email = '';
        else email = result.email;
        offset = 0;
        await load();
        status.textContent =
          result.purged && !result.filesDeleted
            ? 'Test contact and saved records permanently deleted. Attachment cleanup is pending and will retry automatically.'
            : message;
        onChange(result);
      } catch (error) {
        if (fresh()) {
          status.textContent = error.message;
          unlock();
        }
      }
    }
    function confirm(
      title,
      description,
      label,
      body,
      message,
      requireEmail = false,
    ) {
      const heading = node('h3', title),
        row = node('div', undefined, 'survey-response-actions');
      heading.tabIndex = -1;
      details.replaceChildren(heading, node('p', description));
      let input;
      // The typed email matches whatever its letter case.
      const typed = () => input.value.trim().toLowerCase(),
        matches = () => typed() === contact.email.toLowerCase();
      const accept = button(
        label,
        () => {
          if (requireEmail && !matches()) return;
          save(
            { ...body, ...(requireEmail ? { confirmEmail: typed() } : {}) },
            message,
          );
        },
        requireEmail ? 'danger filled' : 'danger',
      );
      if (requireEmail) {
        const field = node('label', 'Type the primary email to confirm'),
          hint = node('p', undefined, 'hint contact-note-text');
        input = node('input');
        input.type = 'email';
        input.autocomplete = 'off';
        hint.id = 'contact-confirm-hint';
        input.setAttribute('aria-describedby', hint.id);
        field.append(input);
        details.append(field, hint);
        const sync = () => {
          accept.disabled = !matches();
          hint.textContent = matches()
            ? ''
            : 'Type ' + contact.email + ' to turn on “' + label + '”.';
        };
        input.oninput = sync;
        sync();
      }
      row.append(
        accept,
        button('Cancel', () => {
          details.replaceChildren();
          merge.focus();
        }),
      );
      details.append(row);
      heading.focus();
    }
    // Mark as test deletes the contact and everything linked to it in one
    // step, after the officer types the primary email. The counts go back
    // to the server, which refuses if anything changed since. Contacts
    // marked as test earlier keep Unmark and the same permanent delete.
    const n = contact.counts;
    const purge = () =>
      confirm(
        contact.is_test
          ? 'Permanently delete this test contact?'
          : 'Mark as test and delete permanently?',
        `This permanently deletes ${contact.name || contact.email} and everything linked to them: ${plural(n.submissions, 'submission')}, ${plural(n.survey_responses, 'event survey response')}, ${plural(n.comments, 'officer comment')}, ${plural(n.website_notes, 'website note')}, ${plural(n.notes, 'follow-up note')}, ${plural(n.attachments, 'attachment')} and ${plural(n.addresses, 'linked email address', 'linked email addresses')}. This cannot be undone.`,
        'Delete test contact permanently',
        { action: 'contact-purge', counts: n },
        'Test contact and all linked records permanently deleted.',
        true,
      );
    test.onclick = contact.is_test
      ? () =>
          confirm(
            'Remove test flag?',
            'Deleting this contact will keep their submissions and allow restoration.',
            'Confirm unmark as test',
            { action: 'contact-test', value: false },
            'Test flag removed.',
          )
      : purge;
    restore.onclick = () =>
      save({ action: 'contact-restore' }, 'Contact restored to Active.');
    remove.onclick = contact.is_test
      ? purge
      : () =>
          confirm(
            'Delete this contact from the directory?',
            'Their submissions, survey answers and notes will stay saved. Find this person under Deleted to restore them.',
            'Confirm delete contact',
            { action: 'contact-delete' },
            'Contact deleted from the directory. Submissions and notes are preserved.',
          );
    merge.onclick = () => {
      const form = node('form', undefined, 'contact-merge-search'),
        label = node('label', 'Find the contact to keep'),
        input = node('input'),
        find = node('button', 'Find merge candidates'),
        results = node('div'),
        hint = node(
          'p',
          'Choose the same person’s other contact. Its primary email and name will be kept; both histories remain unchanged.',
          'hint',
        );
      input.type = 'search';
      input.maxLength = 200;
      input.required = true;
      label.append(input);
      form.append(label, find);
      details.replaceChildren(
        node('h3', 'Merge contacts'),
        hint,
        form,
        results,
      );
      input.focus();
      let searchVersion = 0;
      form.onsubmit = async (event) => {
        event.preventDefault();
        const attempt = ++searchVersion;
        results.textContent = 'Finding contacts…';
        find.disabled = true;
        try {
          const data = await api(
            '/api/surveys?' +
              new URLSearchParams({
                contacts: '1',
                search: input.value.trim(),
              }),
          );
          if (!fresh() || attempt !== searchVersion || !form.isConnected)
            return;
          const candidates = data.contacts.filter(
            (c) => c.email !== contact.email,
          );
          results.replaceChildren();
          for (const candidate of candidates) {
            const choose = button(
              '',
              () =>
                confirm(
                  'Confirm these contacts are the same person',
                  `Keep ${candidate.name || candidate.email} (${candidate.email}) and link ${contact.emails.join(', ')}. ${plural(candidate.submissions + contact.submissions, 'submission')} will appear together. No original answers, emails or notes will be rewritten.`,
                  'Confirm merge',
                  {
                    action: 'contact-merge',
                    targetEmail: candidate.email,
                    targetRevision: candidate.revision,
                  },
                  'Contacts merged. Both email addresses now open the same history.',
                ),
              'contact-choice secondary',
            );
            choose.append(
              node('strong', candidate.name || candidate.email),
              node('span', candidate.emails.join(' · ')),
              node(
                'small',
                candidate.is_test ? 'Test contact' : 'Regular contact',
              ),
            );
            results.append(choose);
          }
          if (!candidates.length)
            results.textContent =
              'No other active contacts match. Try their other email address.';
          if (data.hasMore)
            results.append(
              node(
                'p',
                'More contacts match. Narrow your search to find the person.',
              ),
            );
        } catch (error) {
          if (fresh()) results.textContent = error.message;
        } finally {
          find.disabled = false;
        }
      };
    };
    edit.onclick = () => {
      const draft = [contact.email, ...contact.emails]
        .map((address) => drafts.get(profileKey(address)))
        .find(Boolean);
      details.replaceChildren(
        contactProfile(
          contact,
          save,
          () => {
            forgetProfiles(contact.emails);
            details.replaceChildren();
            edit.focus();
          },
          draft,
          (next) => {
            forgetProfiles([contact.email, ...contact.emails]);
            if (next)
              drafts.set(
                profileKey(contact.email),
                { ...next, revision: contact.revision },
                'Contact changes for ' + contact.email,
              );
          },
        ),
      );
      if (draft && draft.revision !== contact.revision)
        status.textContent =
          'This contact changed after you started editing. Your unsaved name and email are restored; check them before saving.';
      details.querySelector('input')?.focus();
    };
    if (!contact.deleted_at) actions.append(edit);
    actions.append(test);
    if (!contact.deleted_at) actions.append(merge);
    if (contact.deleted_at) actions.append(restore);
    if (!contact.deleted_at || contact.is_test) actions.append(remove);
    panel.append(actions, details);
    return panel;
  }
  searchForm.onsubmit = (event) => {
    event.preventDefault();
    email = '';
    offset = 0;
    load();
  };
  view.onchange = () => {
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
      view.value = 'active';
      offset = 0;
      load();
    },
    // Entering the tab shows the list the first time, then keeps its place.
    show() {
      if (!loaded) this.open();
    },
    // Drops the shown history after a long pause; drafts stay in the store.
    reset() {
      generation++;
      loaded = false;
      content.replaceChildren();
      status.textContent = '';
      retry.hidden = false;
    },
    clear() {
      generation++;
      loaded = false;
      heading.textContent = 'Contacts';
      content.replaceChildren();
      search.value = '';
      status.textContent = '';
      email = '';
      offset = 0;
    },
  };
}
