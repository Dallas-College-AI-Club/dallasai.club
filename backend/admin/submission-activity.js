import { node, time } from './ui.js';
import { actionLabel, actorLabel } from './format.js';
import { currentOfficer, drafts } from './session.js';
// The comment draft lives in the drafts store as note:<entryId>, so it
// survives re-renders and re-authentication. onDraft runs when it changes.
export function submissionActivity(entry, api, onDraft = () => {}) {
  const key = 'note:' + entry.id,
    remember = (draft) =>
      drafts.set(
        key,
        { ...draft, email: entry.email },
        'Comment on ' + (entry.name || entry.email) + '’s submission',
      );
  const panel = node('details', undefined, 'submission-activity');
  panel.append(node('summary', 'Activity & comments'));
  panel.append(
    node(
      'p',
      'Visible to all authorized club admins. Edits, status changes, comments, and attachment downloads are recorded here. Times are Central.',
      'hint',
    ),
  );
  const list = node('ol', undefined, 'submission-timeline');
  list.setAttribute('aria-label', 'Submission activity');
  const status = node('p', '', 'hint');
  status.setAttribute('role', 'status');
  const more = node('button', 'Load older activity', 'secondary');
  more.type = 'button';
  more.hidden = true;
  let before = null,
    loaded = false,
    loading = false,
    refreshPending = false;
  async function load(reset = false) {
    if (loading) {
      refreshPending ||= reset;
      return;
    }
    if (reset) {
      before = null;
      loaded = false;
      list.replaceChildren();
    }
    loading = true;
    more.disabled = true;
    status.textContent = 'Loading activity…';
    try {
      const data = await api(
        '/api/admin?history=' + entry.id + (before ? '&before=' + before : ''),
      );
      if (!panel.isConnected) return;
      for (const item of data.activity) {
        // New details sent through the website are a system event, not an
        // officer's comment.
        const system = item.action === 'resubmitted',
          row = node('li', undefined, 'activity-item');
        row.classList.toggle('system-event', system);
        row.append(
          node('strong', actionLabel(item.action)),
          node(
            'span',
            system
              ? 'From the website'
              : 'By ' + actorLabel(item.actor, currentOfficer()),
            'activity-actor',
          ),
          time(item.created_at),
        );
        if (item.comment !== null && item.comment !== undefined)
          row.append(
            node('p', item.comment, system ? 'system-note' : 'officer-comment'),
          );
        list.append(row);
      }
      before = data.nextBefore;
      loaded = true;
      more.hidden = !before;
      more.textContent = 'Load older activity';
      status.textContent = list.children.length
        ? ''
        : 'No officer actions or comments yet.';
    } catch (error) {
      if (!panel.isConnected) return;
      status.textContent = 'Could not load activity. ' + error.message;
      more.hidden = false;
      more.textContent = 'Try again';
    } finally {
      loading = false;
      more.disabled = false;
      if (refreshPending && panel.isConnected) {
        refreshPending = false;
        load(true);
      }
    }
  }
  panel.addEventListener('toggle', () => {
    if (panel.open && !loaded) load();
  });
  more.onclick = () => load();
  const form = node('form', undefined, 'comment-form');
  const label = node('label', 'Add a comment');
  const input = node('textarea');
  input.rows = 3;
  input.maxLength = 5000;
  input.required = true;
  input.value = drafts.get(key)?.text || '';
  input.oninput = () => {
    if (input.value.trim())
      remember({ text: input.value, id: crypto.randomUUID() });
    else drafts.delete(key);
    onDraft();
  };
  label.append(input);
  const button = node('button', 'Add comment');
  button.type = 'submit';
  const saved = node('p', '', 'hint');
  saved.setAttribute('role', 'status');
  form.append(label, button, saved);
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (button.disabled || !form.reportValidity()) return;
    const draft = drafts.get(key) || {
      text: input.value,
      id: crypto.randomUUID(),
    };
    remember(draft);
    button.disabled = true;
    input.disabled = true;
    saved.textContent = 'Saving comment…';
    try {
      await api('/api/admin', {
        action: 'comment',
        id: entry.id,
        commentId: draft.id,
        comment: draft.text,
      });
      if (drafts.get(key)?.id === draft.id) drafts.delete(key);
      if (!panel.isConnected) return;
      input.value = '';
      onDraft();
      saved.textContent =
        'Comment saved with this entry. Visible to all authorized club admins.';
      await load(true);
    } catch (error) {
      if (panel.isConnected)
        saved.textContent =
          'Could not confirm the comment was saved. Your text is still here. ' +
          error.message;
    } finally {
      button.disabled = false;
      input.disabled = false;
    }
  };
  panel.append(list, status, more, form);
  return panel;
}
