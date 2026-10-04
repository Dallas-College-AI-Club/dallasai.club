// Sign-in, the officer session and the shared request helper. A 401 while
// working pauses the office instead of clearing it: the office is hidden,
// open dialogs close with their values kept, failed requests wait, and
// signing in again as the same officer retries them. Only sign-out or a
// different account discards work.
import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
const auth = createAuthClient({ plugins: [emailOTPClient()] }),
  q = (s) => document.querySelector(s),
  // quiet: announce without the visible banner, when the page already says it.
  status = (message = '', quiet = false) => {
    q('#status').textContent = message;
    q('#status').classList.toggle('visually-hidden', quiet);
  };
const offline =
    'Couldn’t reach Club Office. Check your connection and try again.',
  otherAccount = 'Not saved — signed in as a different account.',
  signInHeading = q('#login h1').textContent;

// Unsaved work, in memory only: browser storage would outlive the session.
// Typed notes are stored here; editors whose text lives in their own form
// register a source that reports what is unsaved.
const stored = new Map(),
  sources = new Set();
export const drafts = {
  get: (key) => stored.get(key)?.value,
  set(key, value, label = key) {
    stored.set(key, { value, label });
  },
  delete: (key) => stored.delete(key),
  list: () => [
    ...[...stored].map(([key, { value, label }]) => ({ key, value, label })),
    ...[...sources].flatMap((source) => source()),
  ],
  dirtyCount: () => drafts.list().length,
  track(source) {
    sources.add(source);
    return () => sources.delete(source);
  },
};
window.addEventListener('beforeunload', (event) => {
  if (drafts.dirtyCount()) {
    event.preventDefault();
    event.returnValue = '';
  }
});
const draftList = () =>
  drafts
    .list()
    .map((draft) => '• ' + draft.label)
    .join('\n');

class ApiError extends Error {
  constructor(kind, message, status = 0, details = {}) {
    super(message);
    Object.assign(this, details, { kind, status });
  }
}

let hooks,
  account = '', // the officer whose work is on the page
  identity = '', // the signed-in email, also for a non-officer
  paused = null,
  round = 0,
  pendingEmail = '',
  resendAt = 0,
  resendTimer,
  loadTries = 0,
  loadTimer;
export const isPaused = () => Boolean(paused);
// The last control focused in the office. Dialogs reopened after signing in
// again return focus here when they close, instead of to <body>.
let opener = null;
document.addEventListener('focusin', (event) => {
  if (q('#office').contains(event.target)) opener = event.target;
});

// Resolves with the JSON body or throws an ApiError. A 401 while the office
// is open waits for the officer to sign in again instead of failing.
export function api(path = '/api/admin', body) {
  return paused ? queued(path, body) : send(path, body);
}
function queued(path, body) {
  return new Promise((resolve, reject) =>
    paused.queue.push({ path, body, resolve, reject }),
  );
}
async function send(path, body) {
  let response;
  try {
    response = await fetch(path, {
      signal: AbortSignal.timeout(20000),
      credentials: 'same-origin',
      ...(body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch (error) {
    throw error.name === 'TimeoutError'
      ? new ApiError(
          'timeout',
          'Club Office took too long to answer. Your text is still here; please try again.',
        )
      : new ApiError(
          'network',
          'Could not connect to Club Office. Check your connection and try again.',
        );
  }
  const data = await response.json().catch(() => null);
  if (response.status === 401) {
    if (data?.code === 'not-officer') {
      showNotOfficer();
      throw new ApiError('not-officer', data.error, 401, { code: data.code });
    }
    if (account) {
      pause();
      return queued(path, body);
    }
    throw new ApiError(
      'auth',
      'Your session ended. Sign in again to continue.',
      401,
    );
  }
  if (!data || typeof data !== 'object')
    throw new ApiError(
      'server',
      'Club Office is temporarily unavailable. Please try again; unsaved text has been kept.',
      response.status >= 400 ? response.status : 503,
    );
  if (!response.ok) {
    const { error, ...details } = data;
    throw new ApiError(
      response.status === 409
        ? 'conflict'
        : response.status >= 500
          ? 'server'
          : 'invalid',
      (error || 'Please try again.') +
        (data.reference ? ' Reference: ' + data.reference : ''),
      response.status,
      details,
    );
  }
  return data;
}

// For requests made without api(), such as file downloads: resolves once
// the same officer has signed in again, so the caller can repeat it.
export function signedInAgain() {
  if (!account)
    return Promise.reject(
      new ApiError(
        'auth',
        'Your session ended. Sign in again to continue.',
        401,
      ),
    );
  pause();
  return queued();
}
function pause() {
  if (paused) return;
  paused = {
    queue: [],
    dialogs: [...document.querySelectorAll('dialog[open]')],
    focus: document.activeElement,
    dropped: false,
  };
  // Close handlers check isPaused() and keep their values.
  for (const dialog of paused.dialogs) dialog.close();
  paused.timer = setTimeout(() => {
    paused.dropped = true;
    hooks.reset();
  }, 600000);
  q('#office').hidden = true;
  q('#office').inert = true;
  q('#signout').hidden = true;
  showForm(true);
  status(
    'Your session ended. Sign in again to continue — your unsaved work is kept.',
    true,
  );
  q('#login-form [type="submit"]').focus();
}
async function resume() {
  const { queue, dialogs, focus, timer, dropped } = paused,
    current = round;
  clearTimeout(timer);
  paused = null;
  q('#login').hidden = true;
  q('#office').inert = false;
  q('#office').hidden = false;
  q('#signout').hidden = false;
  if (dialogs.length && opener?.isConnected)
    opener.focus({ preventScroll: true });
  for (const dialog of dialogs)
    if (dialog.isConnected && !dialog.open) dialog.showModal();
  if (focus?.isConnected) focus.focus();
  if (!document.activeElement || document.activeElement === document.body)
    q('.office-tabs [aria-pressed="true"]').focus();
  status('Signed in again. Nothing was lost.');
  // Requests that met the 401 never ran on the server, so each is sent once
  // more, in order. The view reloads after them so it shows their results.
  for (const item of queue) {
    if (paused) {
      paused.queue.push(item);
      continue;
    }
    if (current !== round) {
      item.reject(new ApiError('auth', otherAccount, 401));
      continue;
    }
    try {
      item.resolve(item.path && (await send(item.path, item.body)));
    } catch (error) {
      item.reject(error);
    }
  }
  if (!paused && current === round) hooks.refresh(dropped);
}
// Sign-out or another account: every module clears and waiting requests fail.
function discard(message) {
  const queue = paused?.queue || [];
  clearTimeout(paused?.timer);
  paused = null;
  round++;
  account = '';
  stored.clear();
  hooks.clear();
  for (const item of queue) item.reject(new ApiError('auth', message, 401));
  q('#office').inert = false;
  showLogin();
  return queue.length;
}

function showForm(reauth) {
  for (const id of ['#session-loading', '#load-error', '#not-officer'])
    q(id).hidden = true;
  q('#login').hidden = false;
  q('#login h1').textContent = reauth ? 'Your session ended' : signInHeading;
  q('#login-intro').hidden = reauth;
  for (const id of ['#reauth-note', '#reauth-email-hint', '.login-links'])
    q(id).hidden = !reauth;
  q('#change-email').hidden = reauth;
  q('#reauth-note').textContent =
    'Sign in again as ' +
    account +
    ' to continue. Your unsaved work is still on this page.';
  const email = q('#login-form [name="email"]');
  if (reauth) email.value = account;
  else if (email.readOnly) email.value = '';
  email.readOnly = reauth;
  emailStep();
  describe(email);
}
export function showLogin() {
  clearTimeout(loadTimer);
  q('#office').hidden = true;
  q('#signout').hidden = true;
  showForm(false);
  q('#login-form [name="email"]').focus();
}
// The first successful load opens the office.
export function ready(email) {
  account = identity = email;
  loadTries = 0;
  clearTimeout(loadTimer);
  for (const id of [
    '#session-loading',
    '#login',
    '#load-error',
    '#not-officer',
  ])
    q(id).hidden = true;
  if (paused) return;
  q('#office').inert = false;
  q('#office').hidden = false;
  q('#signout').hidden = false;
  // Focus left with the sign-in card or a panel: start at the office heading.
  const active = document.activeElement;
  if (!active || active === document.body || !active.checkVisibility())
    q('#office h1').focus({ preventScroll: true });
}
// A failed first load never shows the sign-in form, except for a 401.
export function loadFailed(error) {
  if (error.kind === 'not-officer') return;
  if (error.kind === 'auth') {
    showLogin();
    return status(error.message);
  }
  // A refused request, such as a malformed #entry= link, fails again on
  // retry: drop the link and open the plain inbox instead.
  if (error.kind === 'invalid' && location.hash) {
    history.replaceState(null, '', location.pathname + location.search);
    return hooks.load();
  }
  const delay = ['network', 'timeout', 'server'].includes(error.kind)
    ? [2, 5, 10][loadTries++]
    : undefined;
  for (const id of ['#session-loading', '#login', '#not-officer'])
    q(id).hidden = true;
  if (q('#load-error').hidden) {
    q('#load-error').hidden = false;
    q('#load-error h1').focus();
  }
  q('#load-error-message').textContent =
    'This is usually a brief server hiccup. ' +
    (delay ? 'Retrying in ' + delay + '\u00a0s…' : 'Try again in a moment.');
  q('#load-error-identity').textContent = identity
    ? 'Signed in as ' + identity + '.'
    : '';
  clearTimeout(loadTimer);
  if (delay) loadTimer = setTimeout(boot, delay * 1000);
}
// Another tab signed this browser in as someone else, so requests from this
// page now act for them. Keep the drafts only by signing in again as the
// officer who wrote them; otherwise discard them and continue.
export function accountChanged(email) {
  if (!account || email === account) return false;
  const unsaved = draftList();
  if (
    unsaved &&
    !confirm(
      'This browser is now signed in as ' +
        email +
        '. Discard the unsaved work of ' +
        account +
        '?\n\n' +
        unsaved +
        '\n\nCancel to sign in again as ' +
        account +
        ' and keep it.',
    )
  ) {
    pause();
    return true;
  }
  discard(otherAccount);
  status('Now signed in as ' + email + ' from another tab.');
  hooks.load();
  return true;
}
function showNotOfficer() {
  for (const id of ['#session-loading', '#login', '#load-error'])
    q(id).hidden = true;
  q('#office').hidden = true;
  q('#signout').hidden = true;
  q('#not-officer-message').textContent =
    'You’re signed in as ' +
    (identity || 'this account') +
    ', but this account isn’t set up as a club officer. Ask an existing officer to add the admin role.';
  q('#not-officer').hidden = false;
  q('#not-officer h1').focus();
}

function emailStep() {
  pendingEmail = '';
  resendAt = 0;
  clearTimeout(resendTimer);
  clearLoginError();
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
function loginError(field, message) {
  const error = q('#login-error');
  error.textContent = message;
  error.hidden = false;
  field.closest('label').after(error);
  field.setAttribute('aria-invalid', 'true');
  describe(field, 'login-error');
  field.focus();
  if (field.name === 'otp') field.select();
}
function clearLoginError() {
  q('#login-error').hidden = true;
  for (const field of q('#login').querySelectorAll('[aria-invalid]')) {
    field.removeAttribute('aria-invalid');
    describe(field);
  }
}
function describe(field, error) {
  const ids = [error, field.readOnly && 'reauth-email-hint'].filter(Boolean);
  if (ids.length) field.setAttribute('aria-describedby', ids.join(' '));
  else field.removeAttribute('aria-describedby');
}
async function sendCode(email) {
  const result = await auth.emailOtp
    .sendVerificationOtp({ email, type: 'sign-in' })
    .catch(() => ({ error: { offline: true } }));
  if (result.error)
    throw new Error(
      result.error.offline
        ? offline
        : {
            429: 'Too many code requests from this network. Wait a few minutes, then try again.',
            403: 'Open Club Office from its bookmarked address to sign in.',
            503: 'Sign-in isn’t set up on this deployment yet. Tell the site maintainers.',
          }[result.error.status] ||
            'The sign-in code could not be sent. Please try again shortly.',
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
const confirmSignOut = () => {
  const unsaved = draftList();
  return (
    !unsaved || confirm('Sign out and discard your unsaved work?\n\n' + unsaved)
  );
};
async function signOut() {
  if (!confirmSignOut()) return;
  const result = await auth.signOut().catch(() => ({ error: true }));
  if (result.error) return status('Could not sign out. Please try again.');
  discard('Signed out.');
  q('#login-form').reset();
  status('Signed out.');
}
function boot() {
  clearTimeout(loadTimer);
  auth.getSession({ fetchOptions: { timeout: 15000 } }).then(
    ({ data, error }) => {
      if (data?.user) {
        identity = data.user.email;
        hooks.load();
      } else if (error) loadFailed({ kind: 'server' });
      else showLogin();
    },
    () => loadFailed({ kind: 'network' }),
  );
}

// hooks: load() opens the office; refresh(dropped) re-runs the current view
// after re-authentication; reset() drops rendered records after 10 minutes
// paused; clear() wipes every module on sign-out or another account.
export function startSession(options) {
  hooks = options;
  q('#login').addEventListener('input', clearLoginError);
  q('#code-form [name="otp"]').addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
  });
  q('#login-form').onsubmit = async (event) => {
    event.preventDefault();
    const field = event.target.elements.email;
    loginBusy(true);
    status();
    try {
      await sendCode(field.value.trim().toLowerCase());
    } catch (error) {
      loginError(field, error.message);
    } finally {
      loginBusy(false);
    }
  };
  q('#code-form').onsubmit = async (event) => {
    event.preventDefault();
    const field = event.target.elements.otp;
    loginBusy(true);
    clearLoginError();
    status();
    try {
      const result = await auth.signIn
        .emailOtp({
          email: pendingEmail,
          otp: field.value.replace(/\D/g, '').slice(0, 6),
        })
        .catch(() => ({ error: { offline: true } }));
      if (result.error)
        throw new Error(
          result.error.offline
            ? offline
            : {
                429: 'Too many attempts. Wait 5 minutes, then use the newest code.',
                403: 'Open Club Office from its bookmarked address to sign in.',
                503: 'Sign-in isn’t set up on this deployment yet. Tell the site maintainers.',
              }[result.error.status] ||
                'That code is wrong or has expired. Use the newest email, or send a new code.',
        );
      identity = pendingEmail;
      if (paused) {
        emailStep();
        resume();
      } else {
        await hooks.load();
        if (account) emailStep();
      }
    } catch (error) {
      loginError(field, error.message);
    } finally {
      loginBusy(false);
    }
  };
  q('#resend-code').onclick = async () => {
    if (Date.now() < resendAt) return;
    loginBusy(true);
    clearLoginError();
    try {
      await sendCode(pendingEmail);
      status('A new sign-in code was requested. Use the latest email.');
    } catch (error) {
      loginError(q('#code-form [name="otp"]'), error.message);
    } finally {
      loginBusy(false);
    }
  };
  q('#change-email').onclick = () => {
    emailStep();
    status();
    q('#login-form [name="email"]').focus();
  };
  q('#reauth-other').onclick = () => {
    const unsaved = draftList();
    if (
      unsaved &&
      !confirm(
        'Use a different account? These unsaved drafts will be discarded:\n\n' +
          unsaved,
      )
    )
      return;
    status(
      discard(otherAccount) ? otherAccount : 'Unsaved work was discarded.',
    );
  };
  q('#reauth-signout').onclick = async () => {
    if (!confirmSignOut()) return;
    discard('Signed out.');
    status('Signed out. Unsaved work was discarded.');
    await auth.signOut().catch(() => {});
  };
  q('#signout').onclick = signOut;
  q('#not-officer-signout').onclick = async () => {
    await auth.signOut().catch(() => {});
    if (account) discard('Signed out.');
    else showLogin();
    q('#login-form').reset();
    status('Signed out.');
  };
  q('#load-error-retry').onclick = () => {
    q('#load-error-message').textContent = 'Trying again…';
    boot();
  };
  boot();
}
