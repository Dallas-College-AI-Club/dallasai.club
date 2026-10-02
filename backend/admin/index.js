import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import { mountEventEditor } from './event-editor.js';
import { mountPreferences } from './preferences.js';
mountPreferences();
const auth = createAuthClient({ plugins: [emailOTPClient()] }),
  q = (s) => document.querySelector(s);
const labels = {
  join: 'Club signups',
  subscribe: 'The AI Review',
  rsvp: 'Event RSVPs (upcoming only)',
  contribution: 'AI Review submissions',
  workshop: 'Workshop requests',
  question: 'Questions',
};
let offset = 0,
  signedIn = false,
  loading = false,
  sessionGeneration = 0;
let lastNewCount = null,
  lastReceived = 0,
  browserAlerts = false;
q('#enable-alerts').onclick = async () => {
  if (!('Notification' in window)) {
    q('#notification-status').textContent =
      'This browser does not support alerts. New counts and the inbox still refresh automatically.';
    return;
  }
  try {
    if (browserAlerts) {
      browserAlerts = false;
      q('#enable-alerts').textContent = 'Enable browser alerts';
      return;
    }
    browserAlerts = (await Notification.requestPermission()) === 'granted';
    q('#enable-alerts').textContent = browserAlerts
      ? 'Turn off browser alerts'
      : 'Enable browser alerts';
    q('#notification-status').textContent = browserAlerts
      ? 'Browser alerts are on while this office tab stays open. Email alerts are not connected.'
      : 'Browser alerts were not enabled. New counts still appear here.';
  } catch {
    q('#notification-status').textContent =
      'Browser alerts are unavailable here. New counts still appear in the inbox.';
  }
};
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
    throw new Error(data.error || 'Please try again.');
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
  emailStep();
  q('#events-pane').hidden = true;
  q('#inbox-pane').hidden = false;
  editor.clear();
}
function filters() {
  const params = new URLSearchParams([
    ...new FormData(q('#filters')).entries(),
    ['offset', String(offset)],
  ]);
  const entry = new URLSearchParams(location.hash.slice(1)).get('entry');
  if (entry) params.set('id', entry);
  return params;
}
function renderEntry(entry) {
  const card = node('article', undefined, 'entry');
  card.id = 'entry-' + entry.id;
  const top = node('div', undefined, 'entry-top');
  top.append(
    node('span', entry.review_status, 'badge ' + entry.review_status),
    node('span', labels[entry.kind]),
    node('span', new Date(entry.created_at).toLocaleString()),
  );
  card.append(top, node('h2', entry.name || entry.email));
  const address = node('a', entry.email);
  address.href = 'mailto:' + entry.email;
  card.append(
    address,
    node('p', entry.state === 'active' ? 'Saved' : entry.state),
  );
  const details = node('details');
  details.append(node('summary', 'Submission details'));
  for (const [key, value] of Object.entries(entry.data)) {
    details.append(
      node('strong', key.replace(/([A-Z])/g, ' $1')),
      node('pre', String(value)),
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
  for (const [value, label] of [
    ['reviewed', 'Mark reviewed'],
    ['closed', 'Close'],
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
        } catch (e) {
          status(e.message);
          b.disabled = false;
        }
      };
      actions.append(b);
    }
  card.append(actions);
  return card;
}
async function load() {
  if (loading) return;
  loading = true;
  const generation = sessionGeneration;
  q('#refresh').disabled = true;
  try {
    const data = await api('/api/admin?' + filters());
    if (generation !== sessionGeneration) return;
    signedIn = true;
    q('#session-loading').hidden = true;
    q('#login').hidden = true;
    q('#office').hidden = false;
    q('#signout').hidden = false;
    q('#identity').textContent = 'Signed in as ' + data.user;
    const newCount = data.counts.reduce((sum, row) => sum + row.new, 0);
    document.title =
      (newCount ? '(' + newCount + ') ' : '') + 'Club office · Dallas AI Club';
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
      if (browserAlerts && Notification.permission === 'granted') {
        try {
          new Notification('Dallas AI Club', {
            body: 'New submissions are waiting in the club inbox.',
            tag: 'club-inbox',
          });
        } catch {}
      }
    }
    lastNewCount = newCount;
    lastReceived = latest;
    const eventSelect = q('#filters [name="eventId"]'),
      selectedEvent = eventSelect.value;
    eventSelect.replaceChildren(
      new Option('All upcoming events', ''),
      ...(data.events || []).map(
        (e) => new Option(e.title + ' · ' + e.date.slice(0, 10), e.id),
      ),
    );
    if (
      [...eventSelect.options].some((option) => option.value === selectedEvent)
    )
      eventSelect.value = selectedEvent;
    if (location.hash === '#events' && q('#events-pane').hidden)
      showPane('events');
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
    q('#entries').replaceChildren(
      ...(data.entries.length
        ? data.entries.map(renderEntry)
        : [node('p', 'No submissions match these filters.')]),
    );
    q('#previous').disabled = offset === 0;
    q('#next').disabled = !data.hasMore;
    q('#page').textContent = 'Page ' + (offset / 50 + 1);
    q('#export').href = '/api/admin?' + filters() + '&export=csv';
    const linked = new URLSearchParams(location.hash.slice(1)).get('entry');
    if (linked) {
      const card = document.getElementById('entry-' + linked);
      if (card) {
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
  }
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
  const email = new FormData(event.target).get('email').trim().toLowerCase();
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
    if (result.error) throw new Error('Could not sign out. Please try again.');
    showLogin();
    q('#login-form').reset();
    status('Signed out.');
  } catch (e) {
    status(e.message);
  }
};
const editor = mountEventEditor(api);
function showPane(name) {
  if (name !== 'events' && !editor.canLeave()) return;
  q('#inbox-pane').hidden = name === 'events';
  q('#events-pane').hidden = name !== 'events';
  q('#inbox-tab').setAttribute('aria-pressed', String(name !== 'events'));
  q('#events-tab').setAttribute('aria-pressed', String(name === 'events'));
  history.replaceState(
    {},
    '',
    name === 'events' ? '#events' : location.pathname,
  );
  if (name === 'events') editor.show();
}
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
  const rsvp = q('#filters [name="kind"]').value === 'rsvp';
  q('#event-filter-label').hidden = !rsvp;
  if (!rsvp) q('#filters [name="eventId"]').value = '';
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
  if (signedIn && (!document.hidden || browserAlerts)) load();
}, 60000);
auth
  .getSession()
  .then(({ data, error }) => {
    if (data?.user) load();
    else {
      showLogin();
      if (error) status('Could not verify your sign-in. Please try again.');
    }
  })
  .catch(() => {
    showLogin();
    status('Could not connect. Please try again.');
  });
