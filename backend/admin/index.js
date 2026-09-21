import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
const auth = createAuthClient({ plugins: [emailOTPClient()] }),
  q = (s) => document.querySelector(s);
const labels = {
  join: 'Club signups',
  subscribe: 'Newsletter',
  rsvp: 'Event RSVPs',
  contribution: 'Contributions',
  workshop: 'Workshop requests',
};
let offset = 0,
  email = '',
  signedIn = false,
  loading = false;
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
  signedIn = false;
  q('#login').hidden = false;
  q('#office').hidden = true;
  q('#signout').hidden = true;
  q('#entries').replaceChildren();
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
    node(
      'p',
      `${entry.state} · Email ${entry.email_verified ? 'confirmed' : 'unconfirmed'}${entry.pending_emails ? ' · ' + entry.pending_emails + ' pending deliveries' : ''}`,
    ),
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
  q('#refresh').disabled = true;
  try {
    const data = await api('/api/admin?' + filters());
    signedIn = true;
    q('#login').hidden = true;
    q('#office').hidden = false;
    q('#signout').hidden = false;
    q('#identity').textContent = 'Signed in as ' + data.user;
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
    q('#queue').hidden = !data.queue.pending;
    q('#queue-text').textContent =
      `${data.queue.pending} deliveries pending. ${data.queue.failed} encountered an error. Saved submissions remain available here.`;
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
    status(error.message);
  } finally {
    loading = false;
    q('#refresh').disabled = false;
  }
}
q('#email-form').onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  status();
  email = new FormData(event.target).get('email').trim().toLowerCase();
  try {
    const result = await auth.emailOtp.sendVerificationOtp({
      email,
      type: 'sign-in',
    });
    if (result.error) throw new Error(result.error.message);
    q('#email-form').hidden = true;
    q('#code-form').hidden = false;
    status('If this address is authorized, a sign-in code is on its way.');
    q('[name="code"]').focus();
  } catch (e) {
    status(e.message);
  } finally {
    button.disabled = false;
  }
};
q('#code-form').onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await auth.signIn.emailOtp({
      email,
      otp: new FormData(event.target).get('code'),
    });
    if (result.error) throw new Error(result.error.message);
    status();
    await load();
  } catch (e) {
    status(e.message);
  } finally {
    button.disabled = false;
  }
};
q('#back').onclick = () => {
  q('#email-form').hidden = false;
  q('#code-form').hidden = true;
  q('#code-form').reset();
  status();
};
q('#signout').onclick = async () => {
  await auth.signOut();
  showLogin();
  q('#back').click();
  status('Signed out.');
};
q('#refresh').onclick = () => {
  status();
  load();
};
q('#filters').onsubmit = (event) => {
  event.preventDefault();
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
q('#retry').onclick = async () => {
  q('#retry').disabled = true;
  try {
    const result = await api('/api/admin', { action: 'retry' });
    status(
      `${result.sent} deliveries sent; ${result.failed} need another attempt.`,
    );
    await load();
  } catch (e) {
    status(e.message);
  } finally {
    q('#retry').disabled = false;
  }
};
setInterval(() => {
  if (signedIn && !document.hidden) load();
}, 60000);
auth
  .getSession()
  .then(({ data, error }) => {
    if (data?.user) load();
    else if (error)
      status('Admin sign-in is being connected. Please try again later.');
  })
  .catch(() => status('Could not connect. Please try again.'));
