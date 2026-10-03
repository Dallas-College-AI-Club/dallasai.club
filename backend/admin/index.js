import { mountSurveyResults } from './survey-results.js';
import { createAuthClient } from 'better-auth/client';
import { mountCustomSurveys } from './custom-surveys.js';
import { mountSurveyArchive } from './survey-archive.js';
import { emailOTPClient } from 'better-auth/client/plugins';
import { mountEventEditor } from './event-editor.js';
import { mountBrowserAlerts } from './browser-alerts.js';
import { submissionActivity } from './submission-activity.js';
import { activityTime } from './event-activity.js';
import { submissionEditor } from './submission-editor.js';
const auth = createAuthClient({ plugins: [emailOTPClient()] }),
  q = (s) => document.querySelector(s);
const labels = {
  join: 'Club signups',
  subscribe: 'The AI Review subscription',
  rsvp: 'Event RSVPs (upcoming only)',
  'rsvp-past': 'Event RSVPs (past)',
  contribution: 'AI Review submissions',
  workshop: 'Workshop requests',
  question: 'Questions',
};
let offset = 0,
  signedIn = false,
  loading = false,
  reloadPending = false,
  sessionGeneration = 0;
let lastNewCount = null,
  lastReceived = 0;
const commentDrafts = new Map();
const alerts = mountBrowserAlerts(
  q('#enable-alerts'),
  q('#notification-status'),
);
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function status(message = '') {
  q('#status').textContent = message;
}
async function api(path = '/api/admin', body) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) showLogin();
    const error = new Error(data.error || 'Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function showLogin() {
  q('#session-loading').hidden = true;
  sessionGeneration++;
  signedIn = false;
  lastNewCount = null;
  lastReceived = 0;
  q('#inbox-alert').textContent = '';
  document.title = 'Club office · Dallas AI Club';
  q('#login').hidden = false;
  q('#office').hidden = true;
  q('#signout').hidden = true;
  q('#entries').replaceChildren();
  commentDrafts.clear();
  emailStep();
  q('#events-pane').hidden = true;
  q('#inbox-pane').hidden = false;
  editor.clear();
  surveys.clear();
  customSurveys.clear();
  surveyArchive.clear();
  responses.clear();
  q('#surveys-pane').hidden = true;
}
function filters() {
  const params = new URLSearchParams([
    ...new FormData(q('#filters')).entries(),
    ['offset', String(offset)],
  ]);
  const entry = new URLSearchParams(location.hash.slice(1)).get('entry');
  if (entry) {
    params.set('id', entry);
    params.delete('status');
    params.delete('kind');
    params.delete('eventId');
  }
  return params;
}
function renderEntry(entry) {
  const card = node('details', undefined, 'entry survey-response');
  card.id = 'entry-' + entry.id;
  const heading = node('summary');
  heading.append(
    node('strong', entry.name || entry.email),
    node('span', entry.email),
    node('small', activityTime(entry.created_at)),
  );
  card.append(heading);
  const top = node('div', undefined, 'entry-top');
  top.append(
    node(
      'span',
      entry.review_status === 'closed' ? 'archived' : entry.review_status,
      'badge ' + entry.review_status,
    ),
    node(
      'span',
      entry.kind === 'rsvp' ? 'Event RSVP' : labels[entry.kind],
    ),
    node('span', activityTime(entry.created_at)),
  );
  card.append(top);
  if (entry.edit_revision > 0)
    card.append(
      node(
        'p',
        'Edited by an admin · ' + activityTime(entry.updated_at),
        'hint',
      ),
    );
  const address = node('a', entry.email);
  address.href = 'mailto:' + entry.email;
  card.append(
    address,
    node(
      'p',
      entry.state === 'active' ? 'Received in club inbox' : entry.state,
    ),
  );
  if (entry.kind === 'rsvp') {
    card.append(
      node(
        'p',
        entry.data.eventTitle +
          ' · ' +
          (entry.data.eventDate?.slice(0, 10) || 'TBD'),
      ),
    );
    if (entry.data.hasSurvey) {
      const button = node('button', 'View survey answers');
      button.onclick = () => {
        if (showPane('surveys', true) === false) return;
        history.replaceState({}, '', '#survey=' + entry.id);
        surveys.show(entry.id);
      };
      card.append(button);
    }
  }
  const details = node('details');
  details.append(node('summary', 'Submission details'));
  for (const [key, value] of Object.entries(entry.data)) {
    if (['hasSurvey', 'potential'].includes(key)) continue;
    details.append(
      node('strong', key.replace(/([A-Z])/g, ' $1')),
      node('pre', key === 'eventDate' && !value ? 'TBD' : String(value)),
    );
  }
  for (const file of entry.attachments) {
    const p = node('p'),
      a = node('a', `${file.name} (${Math.ceil(file.size / 1024)} KB)`);
    a.href = '/api/admin?attachment=' + encodeURIComponent(file.id);
    p.append(a);
    details.append(p);
  }
  details.append(node('p', 'Reference: ' + entry.id));
  card.append(details);
  const actions = node('div', undefined, 'entry-actions');
  const edit = node('button', 'Edit response');
  edit.onclick = () => responses.open(entry.id);
  actions.append(edit);
  if (entry.review_status === 'closed') {
    const remove = node('button', 'Delete permanently', 'danger');
    remove.onclick = () => responses.open(entry.id, { remove: true });
    actions.append(remove);
  }
  for (const [value, label] of [
    ['reviewed', 'Mark reviewed'],
    ['closed', 'Archive submission'],
    ['new', 'Mark new'],
  ])
    if (value !== entry.review_status) {
      const b = node('button', label);
      b.onclick = async () => {
        b.disabled = true;
        try {
          await api('/api/admin', {
            action: 'review',
            id: entry.id,
            status: value,
          });
          await load();
          status(
            value === 'closed'
              ? 'Submission moved to Archived. Comments and history are kept.'
              : 'Submission moved to ' +
                  (value === 'new' ? 'New.' : 'Reviewed.'),
          );
        } catch (e) {
          status(e.message);
          b.disabled = false;
        }
      };
      actions.append(b);
    }
  card.append(actions, submissionActivity(entry, api, commentDrafts));
  return card;
}
function groupedEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.data.eventId
      ? 'event:' + entry.data.eventId
      : 'kind:' + entry.kind;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups].map(([key, rows]) => {
    const group = node(
      'details',
      undefined,
      'survey-event-group inbox-group',
    );
    group.dataset.group = key;
    group.open = true;
    group.append(
      node(
        'summary',
        (rows[0].data.eventTitle || labels[rows[0].kind]) +
          ' · ' +
          rows.length +
          ' on this page',
      ),
      ...rows.map(renderEntry),
    );
    return group;
  });
}
async function load({ background = false } = {}) {
  if (loading) {
    reloadPending ||= !background;
    return;
  }
  loading = true;
  if (location.hash === '#archived-survey-questions')
    selectSurveyArchive();
  const generation = sessionGeneration,
    requestedFilters = filters().toString();
  q('#entries').setAttribute('aria-busy', 'true');
  q('#refresh').disabled = true;
  try {
    const data = await api('/api/admin?' + requestedFilters);
    if (generation !== sessionGeneration) return;
    if (filters().toString() !== requestedFilters) {
      reloadPending = true;
      return;
    }
    if (!data.entries.length && offset > 0) {
      offset = Math.max(0, offset - 50);
      reloadPending = true;
      return;
    }
    const linkedId = new URLSearchParams(location.hash.slice(1)).get(
      'entry',
    );
    const linkedEntry =
      linkedId && data.entries.find((entry) => entry.id === linkedId);
    if (linkedEntry) selectInboxStatus(linkedEntry.review_status);
    signedIn = true;
    q('#session-loading').hidden = true;
    q('#login').hidden = true;
    q('#office').hidden = false;
    q('#signout').hidden = false;
    q('#identity').textContent = 'Signed in as ' + data.user;
    const newCount = data.counts.reduce((sum, row) => sum + row.new, 0);
    document.title =
      (newCount ? '(' + newCount + ') ' : '') +
      'Club office · Dallas AI Club';
    const latest = Math.max(
      0,
      ...data.counts.map((row) => Date.parse(row.latest) || 0),
    );
    if (
      lastNewCount !== null &&
      (newCount > lastNewCount || latest > lastReceived)
    ) {
      q('#inbox-alert').textContent =
        'New submissions arrived. Review the inbox below.';
      alerts.notify();
    }
    lastNewCount = newCount;
    lastReceived = latest;
    const eventSelect = q('#filters [name="eventId"]'),
      selectedEvent = eventSelect.value,
      past = q('#filters [name="kind"]').value === 'rsvp-past';
    eventSelect.replaceChildren(
      new Option(past ? 'All past events' : 'All upcoming events', ''),
      ...(data.events || [])
        .filter((e) => Boolean(e.past) === past)
        .map(
          (e) =>
            new Option(
              e.title + ' · ' + (e.date?.slice(0, 10) || 'TBD'),
              e.id,
            ),
        ),
    );
    if (
      [...eventSelect.options].some(
        (option) => option.value === selectedEvent,
      )
    )
      eventSelect.value = selectedEvent;
    if (location.hash === '#events' && q('#events-pane').hidden)
      showPane('events');
    if (
      (location.hash === '#surveys' ||
        location.hash.startsWith('#survey=') ||
        location.hash.startsWith('#custom-survey=')) &&
      q('#surveys-pane').hidden
    )
      showPane('surveys', true);
    q('#counts').replaceChildren(
      ...Object.entries(labels).map(([kind, label]) => {
        const count = data.counts.find((x) => x.kind === kind) || {
            new: 0,
            total: 0,
          },
          box = node('div', undefined, 'count');
        box.append(
          node('span', label),
          node('strong', count.new),
          node('small', `new · ${count.total} total`),
        );
        return box;
      }),
    );
    const missing = Object.entries(data.configured)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    q('#configuration').hidden = !missing.length;
    q('#configuration').textContent =
      'Setup still needed: ' + missing.join(', ') + '.';
    if (
      !background ||
      (!commentDrafts.size &&
        !q('#entries').contains(document.activeElement))
    ) {
      const expanded = new Map(
        [...q('#entries').querySelectorAll('[id^="entry-"]')].map(
          (card) => [
            card.id,
            [
              card.open,
              ...[...card.querySelectorAll('details')].map(
                (panel) => panel.open,
              ),
            ],
          ],
        ),
      );
      const groupStates = new Map(
        [...q('#entries').querySelectorAll('[data-group]')].map(
          (group) => [group.dataset.group, group.open],
        ),
      );
      q('#entries').replaceChildren(
        ...(data.entries.length
          ? groupedEntries(data.entries)
          : [node('p', 'No submissions match these filters.')]),
      );
      for (const group of q('#entries').querySelectorAll('[data-group]'))
        group.open = groupStates.get(group.dataset.group) ?? true;
      for (const card of q('#entries').querySelectorAll(
        '[id^="entry-"]',
      )) {
        card.open = expanded.get(card.id)?.[0] || false;
        [...card.querySelectorAll('details')].forEach((panel, index) => {
          panel.open = expanded.get(card.id)?.[index + 1] || false;
        });
      }
    }
    q('#previous').disabled = offset === 0;
    q('#next').disabled = !data.hasMore;
    q('#page').textContent = 'Page ' + (offset / 50 + 1);
    q('#export').href = '/api/admin?' + filters() + '&export=csv';
    surveyArchive.load(filters(), { background });
    const linked = new URLSearchParams(location.hash.slice(1)).get(
      'entry',
    );
    if (linked) {
      const card = document.getElementById('entry-' + linked);
      if (card) {
        card.open = true;
        card.closest('.inbox-group').open = true;
        card.querySelector('details').open = true;
        card.scrollIntoView({ block: 'center' });
        history.replaceState({}, '', location.pathname);
      }
    }
  } catch (error) {
    if (!signedIn) showLogin();
    status(error.message);
  } finally {
    loading = false;
    q('#refresh').disabled = false;
    q('#entries').setAttribute('aria-busy', 'false');
    if (reloadPending) {
      reloadPending = false;
      load();
    }
  }
}
function selectInboxStatus(value) {
  q('#filters [name="status"]').value = value;
  document.querySelectorAll('[data-inbox-status]').forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.inboxStatus === value),
    );
  });
  q('#inbox-view-note').textContent = {
    new: 'New submissions awaiting review.',
    reviewed:
      'Reviewed submissions. Archive them when follow-up is complete.',
    closed:
      'Archived submissions. Comments and history are kept. Mark an entry new or reviewed to restore it.',
  }[value];
}
for (const button of document.querySelectorAll('[data-inbox-status]')) {
  button.onclick = () => {
    if (button.getAttribute('aria-pressed') === 'true') return;
    selectInboxStatus(button.dataset.inboxStatus);
    offset = 0;
    if (location.hash !== '#events')
      history.replaceState({}, '', location.pathname);
    status();
    q('#entries').replaceChildren(node('p', 'Loading submissions…'));
    load();
  };
}
let pendingEmail = '',
  resendAt = 0,
  resendTimer = null;
function emailStep() {
  pendingEmail = '';
  resendAt = 0;
  clearTimeout(resendTimer);
  q('#login-form').hidden = false;
  q('#code-form').hidden = true;
  q('#code-form').reset();
  q('#code-instructions').textContent = '';
}
function loginBusy(busy) {
  q('#login')
    .querySelectorAll('button')
    .forEach((button) => {
      button.disabled = busy;
    });
  if (Date.now() < resendAt) q('#resend-code').disabled = true;
}
async function sendCode(email) {
  const result = await auth.emailOtp.sendVerificationOtp({
    email,
    type: 'sign-in',
  });
  if (result.error)
    throw new Error(
      result.error.status === 429
        ? 'Please wait a few minutes before requesting another code.'
        : 'The sign-in code could not be sent. Please try again shortly.',
    );
  pendingEmail = email;
  q('#login-form').hidden = true;
  q('#code-form').hidden = false;
  q('#code-form').reset();
  q('#code-instructions').textContent =
    'If this is an approved admin address, a code will arrive at ' +
    email +
    '.';
  resendAt = Date.now() + 60000;
  q('#resend-code').textContent = 'Send a new code (wait 1 minute)';
  clearTimeout(resendTimer);
  resendTimer = setTimeout(() => {
    q('#resend-code').disabled = false;
    q('#resend-code').textContent = 'Send a new code';
  }, 60000);
  q('#code-form [name="otp"]').focus();
}
q('#login-form').onsubmit = async (event) => {
  event.preventDefault();
  const email = new FormData(event.target)
    .get('email')
    .trim()
    .toLowerCase();
  loginBusy(true);
  status();
  try {
    await sendCode(email);
  } catch (error) {
    status(error.message);
  } finally {
    loginBusy(false);
  }
};
q('#code-form').onsubmit = async (event) => {
  event.preventDefault();
  loginBusy(true);
  status();
  try {
    const result = await auth.signIn.emailOtp({
      email: pendingEmail,
      otp: new FormData(event.target).get('otp').trim(),
    });
    if (result.error)
      throw new Error(
        'That code could not be verified. Check the latest email, or request a new code.',
      );
    await load();
    if (signedIn) emailStep();
  } catch (error) {
    status(error.message);
  } finally {
    loginBusy(false);
  }
};
q('#resend-code').onclick = async () => {
  if (Date.now() < resendAt) return;
  loginBusy(true);
  status();
  try {
    await sendCode(pendingEmail);
    status('A new sign-in code was requested. Use the latest email.');
  } catch (error) {
    status(error.message);
  } finally {
    loginBusy(false);
  }
};
q('#change-email').onclick = () => {
  emailStep();
  status();
  q('#login-form [name="email"]').focus();
};
q('#signout').onclick = async () => {
  if (!editor.canLeave()) return;
  sessionGeneration++;
  try {
    const result = await auth.signOut();
    if (result.error)
      throw new Error('Could not sign out. Please try again.');
    showLogin();
    q('#login-form').reset();
    status('Signed out.');
  } catch (e) {
    status(e.message);
  }
};
const editor = mountEventEditor(api);
const responses = submissionEditor(api, async (result) => {
  commentDrafts.delete(result.entryId);
  await load();
  status(
    result.removed
      ? result.filesCleaned === false
        ? 'Response deleted. Attachment removal is queued for retry.'
        : 'Response permanently deleted.'
      : 'Response updated.',
  );
});
const surveys = mountSurveyResults(api, (result) => {
  offset = 0;
  if (result?.entryId) commentDrafts.delete(result.entryId);
  else commentDrafts.clear();
  load();
});
const customSurveys = mountCustomSurveys(q('#custom-surveys-root'), api);
const surveyArchive = mountSurveyArchive(
  q('#archived-survey-questions'),
  api,
);
function surveyGroup(custom, id = '') {
  q('#custom-surveys-root').hidden = !custom;
  q('#event-surveys-root').hidden = custom;
  q('#custom-surveys-group').setAttribute('aria-pressed', String(custom));
  q('#event-surveys-group').setAttribute('aria-pressed', String(!custom));
  if (custom) id ? customSurveys.show(id) : customSurveys.load();
}
q('#custom-surveys-group').onclick = () => surveyGroup(true);
q('#event-surveys-group').onclick = () => {
  surveyGroup(false);
  surveys.show();
};
function showPane(name, keepHash = false) {
  if (name !== 'events' && !editor.canLeave()) return false;
  for (const pane of ['inbox', 'events', 'surveys']) {
    q('#' + pane + '-pane').hidden = name !== pane;
    q('#' + pane + '-tab').setAttribute(
      'aria-pressed',
      String(name === pane),
    );
  }
  if (!keepHash)
    history.replaceState(
      {},
      '',
      name === 'inbox' ? location.pathname : '#' + name,
    );
  if (name === 'events') editor.show();
  if (name === 'surveys') {
    const customId = new URLSearchParams(location.hash.slice(1)).get(
      'custom-survey',
    );
    if (customId) {
      surveyGroup(true, customId);
      return;
    }
    surveyGroup(false);
    surveys.show(
      new URLSearchParams(location.hash.slice(1)).get('survey') || '',
    );
  }
}
function selectSurveyArchive() {
  selectInboxStatus('closed');
  q('#filters [name="kind"]').value = 'question';
  q('#filters [name="eventId"]').value = '';
  q('#event-filter-label').hidden = true;
  history.replaceState({}, '', location.pathname);
}
window.addEventListener('hashchange', () => {
  if (signedIn && location.hash === '#archived-survey-questions') {
    if (showPane('inbox', true) === false) return;
    offset = 0;
    selectSurveyArchive();
    load();
    return;
  }
  if (
    signedIn &&
    (location.hash === '#surveys' ||
      location.hash.startsWith('#survey=') ||
      location.hash.startsWith('#custom-survey='))
  ) {
    showPane('surveys', true);
    return;
  }
  if (
    !signedIn ||
    !new URLSearchParams(location.hash.slice(1)).get('entry')
  )
    return;
  if (showPane('inbox', true) === false) return;
  offset = 0;
  q('#filters [name="kind"]').value = '';
  q('#filters [name="eventId"]').value = '';
  q('#event-filter-label').hidden = true;
  load();
});
q('#surveys-tab').onclick = () => showPane('surveys');
q('#events-tab').onclick = () => showPane('events');
q('#inbox-tab').onclick = () => showPane('inbox');
q('#refresh').onclick = () => {
  status();
  load();
};
q('#filters').onsubmit = (event) => {
  event.preventDefault();
  offset = 0;
  load();
};
q('#filters [name="kind"]').onchange = () => {
  const rsvp = ['rsvp', 'rsvp-past'].includes(
    q('#filters [name="kind"]').value,
  );
  q('#event-filter-label').hidden = !rsvp;
  q('#filters [name="eventId"]').value = '';
  offset = 0;
  load();
};
q('#previous').onclick = () => {
  offset = Math.max(0, offset - 50);
  load();
};
q('#next').onclick = () => {
  offset += 50;
  load();
};
setInterval(() => {
  if (signedIn && (!document.hidden || alerts.enabled))
    load({ background: true });
}, 60000);
auth
  .getSession()
  .then(({ data, error }) => {
    if (data?.user) load();
    else {
      showLogin();
      if (error)
        status('Could not verify your sign-in. Please try again.');
    }
  })
  .catch(() => {
    showLogin();
    status('Could not connect. Please try again.');
  });
