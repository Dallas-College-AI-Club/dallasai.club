import { lock, node } from './ui.js';
import { actionLabel, actorLabel, dateTime } from './format.js';
import { currentOfficer } from './session.js';
export async function mountRespondents(root, surveyId, api, onChanged) {
  root.append(node('p', 'Loading respondents…'));
  try {
    const data = await api(
      '/api/custom-surveys?action=members&id=' + encodeURIComponent(surveyId),
    );
    if (!root.isConnected) return;
    root.replaceChildren(
      node('h3', 'Respondents'),
      node(
        'p',
        'Add approved email addresses, including your own for testing. Removing someone archives them and ends survey access on every device. Saved responses and the activity log are retained.',
        'hint',
      ),
    );
    const status = node('p');
    status.setAttribute('role', 'status');
    let busy = false,
      pending;
    async function change(input) {
      if (busy) return;
      const serialized = JSON.stringify(input);
      if (pending && pending.serialized !== serialized) {
        status.textContent =
          'Retry the previous change or refresh the list before making another change.';
        return;
      }
      busy = true;
      const unlock = lock(root, 'button');
      pending ||= {
        serialized,
        body: {
          ...input,
          surveyId,
          expectedRevision: data.revision,
          requestId: crypto.randomUUID(),
        },
      };
      try {
        await api('/api/custom-surveys?action=member-change', pending.body);
        if (!root.isConnected) return;
        pending = null;
        await onChanged();
      } catch (error) {
        status.textContent = error.message;
        // An explicit server rejection did not commit. Transport errors keep the
        // request ID so retrying an ambiguous result cannot duplicate the log.
        if (error.status && error.status < 500) pending = null;
      } finally {
        busy = false;
        unlock();
      }
    }
    const active = node('div', undefined, 'respondent-list');
    const removed = node('details');
    removed.append(node('summary', 'Archived respondents'));
    for (const member of data.members) {
      // Self-registered respondents may have no display name.
      const name = member.display_name || member.email;
      const row = node('div', undefined, 'respondent-row');
      const person = node('div');
      person.append(node('strong', name), node('p', member.email, 'hint'));
      const button = node(
        'button',
        member.active ? 'Remove access' : 'Restore access',
        'secondary',
      );
      button.setAttribute(
        'aria-label',
        `${member.active ? 'Remove' : 'Restore'} access for ${name}`,
      );
      button.onclick = () =>
        change(
          member.active
            ? { action: 'remove', advisorId: member.advisor_id }
            : {
                action: 'add',
                // Restore keeps the stored name, even a blank one.
                name: member.display_name,
                email: member.email,
              },
        );
      row.append(person, button);
      (member.active ? active : removed).append(row);
    }
    if (!data.members.some((m) => m.active))
      active.append(node('p', 'No active respondents.'));
    root.append(active);
    if (data.members.some((m) => !m.active)) root.append(removed);
    const form = node('form', undefined, 'respondent-add');
    for (const [key, label, type, max] of [
      ['name', 'Name', 'text', 120],
      ['email', 'Email address', 'email', 254],
    ]) {
      const field = node('label', label),
        input = node('input');
      input.name = key;
      input.type = type;
      input.required = true;
      input.maxLength = max;
      field.append(input);
      form.append(field);
    }
    const add = node('button', 'Add respondent');
    add.type = 'submit';
    form.append(add);
    form.onsubmit = (e) => {
      e.preventDefault();
      const values = new FormData(form);
      change({
        action: 'add',
        name: values.get('name'),
        email: values.get('email'),
      });
    };
    const self = data.members.find(
      (m) => m.email === data.currentUser.email.toLowerCase(),
    );
    if (!self?.active) {
      const myself = node('button', 'Add myself for testing', 'secondary');
      myself.type = 'button';
      myself.onclick = () =>
        change({
          action: 'add',
          name: data.currentUser.name,
          email: data.currentUser.email,
        });
      form.append(myself);
    }
    root.append(form, status);
    const history = node('details');
    history.append(node('summary', 'Respondent activity'));
    if (!data.activity.length)
      history.append(node('p', 'No respondent changes recorded yet.', 'hint'));
    for (const entry of data.activity) {
      const item = node('p');
      item.textContent = `${dateTime(entry.created_at)} · ${actorLabel(entry.actor_email, currentOfficer())} · ${actionLabel(entry.action)} ${entry.respondent_name ? `${entry.respondent_name} (${entry.respondent_email})` : entry.respondent_email}`;
      history.append(item);
    }
    history.append(node('p', 'Shows the latest 100 changes.', 'hint'));
    root.append(history);
  } catch (error) {
    root.replaceChildren(node('p', error.message));
  }
}
