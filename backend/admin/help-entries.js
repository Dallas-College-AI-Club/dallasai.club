// Officer topics in Help: officers add, edit, archive, restore and delete
// their own notes. Text is shown only as text: a blank line starts a new
// paragraph, and nothing typed ever becomes markup.
import {
  button,
  busy,
  confirmDialog,
  focusFallback,
  node,
  toast,
} from './ui.js';
import { actorLabel, dateTime } from './format.js';
import { currentOfficer, drafts } from './session.js';
const q = (s) => document.querySelector(s);
export function paragraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => node('p', part, 'help-entry-text'));
}
export function mountHelpEntries(api) {
  const form = q('#help-form'),
    status = q('#help-officer-status'),
    add = q('#help-add');
  // The topic being written: { id, revision } (no revision for a new one).
  let editing = null,
    generation = 0;
  const draftKey = () => 'help:' + editing.id;
  const remember = () => {
    if (!editing) return;
    const title = form.elements['help-title'].value,
      body = form.elements['help-body'].value;
    if (title.trim() || body.trim())
      drafts.set(
        draftKey(),
        { ...editing, title, body },
        'Help topic “' + (title.trim() || 'Untitled') + '”',
      );
    else drafts.delete(draftKey());
  };
  form.addEventListener('input', remember);
  function start(entry) {
    editing = entry
      ? { id: entry.id, revision: entry.revision }
      : { id: crypto.randomUUID() };
    const draft = drafts.get(draftKey());
    form.elements['help-title'].value = draft?.title ?? entry?.title ?? '';
    form.elements['help-body'].value = draft?.body ?? entry?.body ?? '';
    q('#help-form-heading').textContent = entry ? 'Edit topic' : 'New topic';
    form.hidden = false;
    add.hidden = true;
    form.elements['help-title'].focus();
  }
  function stop() {
    if (editing) drafts.delete(draftKey());
    editing = null;
    form.reset();
    form.hidden = true;
    add.hidden = false;
  }
  add.onclick = () => start();
  form.querySelector('[data-cancel]').onclick = () => {
    stop();
    add.focus();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (form.getAttribute('aria-busy') === 'true') return;
    const version = generation,
      release = busy(form);
    try {
      const { entry } = await api('/api/admin', {
        action: 'help-save',
        id: editing.id,
        title: form.elements['help-title'].value,
        body: form.elements['help-body'].value,
        ...(editing.revision ? { revision: editing.revision } : {}),
      });
      if (version !== generation) return;
      release();
      stop();
      toast({ text: 'Help topic “' + entry.title + '” saved.' });
      await load();
      q('#help-' + entry.id + ' h3')?.focus();
    } catch (error) {
      if (version !== generation) return;
      release();
      toast({ type: 'error', text: error.message });
    }
  };
  async function change(entry, action, element) {
    if (
      action === 'help-delete' &&
      !(await confirmDialog({
        title: 'Delete “' + entry.title + '” permanently?',
        body: 'Officers will no longer see this topic. This can’t be undone.',
        confirmLabel: 'Delete topic',
        tone: 'danger',
      }))
    )
      return;
    const version = generation,
      release = busy(element);
    try {
      await api('/api/admin', {
        action,
        id: entry.id,
        revision: entry.revision,
      });
      if (version !== generation) return;
      focusFallback(element, q('#help-officer'));
      toast({
        text:
          'Help topic “' +
          entry.title +
          '” ' +
          ({ 'help-archive': 'archived.', 'help-restore': 'restored.' }[
            action
          ] || 'deleted.'),
      });
      await load();
    } catch (error) {
      if (version !== generation) return;
      release();
      toast({ type: 'error', text: error.message });
    }
  }
  function render(entry) {
    const article = node('article', undefined, 'help-entry'),
      title = node('h3', entry.title),
      actions = node('div', undefined, 'entry-actions');
    article.id = 'help-' + entry.id;
    title.tabIndex = -1;
    title.dataset.focus = '';
    if (!entry.archived)
      actions.append(
        button('Edit', () => start(entry)),
        button('Archive', () => change(entry, 'help-archive', article)),
      );
    else
      actions.append(
        button('Restore', () => change(entry, 'help-restore', article)),
      );
    const remove = button('Delete', () =>
      change(entry, 'help-delete', article),
    );
    remove.classList.add('danger');
    actions.append(remove);
    article.append(
      title,
      ...paragraphs(entry.body),
      node(
        'p',
        'Updated by ' +
          actorLabel(entry.updated_by, currentOfficer()) +
          ' · ' +
          dateTime(entry.updated_at),
        'hint',
      ),
      actions,
    );
    return article;
  }
  async function load() {
    const version = ++generation;
    try {
      const data = await api('/api/admin?help=1');
      if (version !== generation) return;
      const active = data.entries.filter((entry) => !entry.archived),
        archived = data.entries.filter((entry) => entry.archived);
      q('#help-officer-list').replaceChildren(...active.map(render));
      q('#help-archived-list').replaceChildren(...archived.map(render));
      q('#help-archived').hidden = !archived.length;
      q('#help-archived summary').textContent =
        'Archived topics (' + archived.length + ')';
      status.textContent = !data.ready
        ? 'Officer topics are not set up yet.'
        : active.length
          ? ''
          : 'No officer topics yet.';
      add.hidden = !data.ready || !form.hidden;
    } catch (error) {
      if (version === generation) status.textContent = error.message;
    }
  }
  return {
    load,
    // Sign-out or ten minutes paused: drop the topics; an open form and its
    // draft stay until sign-out clears drafts.
    reset() {
      generation++;
      q('#help-officer-list').replaceChildren();
      q('#help-archived-list').replaceChildren();
      q('#help-archived').hidden = true;
      status.textContent = '';
    },
    clear() {
      this.reset();
      editing = null;
      form.reset();
      form.hidden = true;
      add.hidden = true;
    },
  };
}
