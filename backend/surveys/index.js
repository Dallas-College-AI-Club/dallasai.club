import { responseSections } from './results-ui.js';
const q = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.hash.slice(1));
// Back/Forward can change only the fragment and retain the preview DOM.
// Reopen the matching mode whenever the invitation or preview changes.
window.addEventListener('hashchange', () => {
  if (location.hash === '#main') return;
  const next = new URLSearchParams(location.hash.slice(1));
  if (
    ['invite', 'preview', 'sample'].some(
      (key) => next.get(key) !== params.get(key),
    )
  )
    location.reload();
});
const previewCapability =
  !params.has('invite') &&
  /^[A-Za-z0-9_-]{43}$/.test(params.get('preview') || '');
const link = params.get('invite') || params.get('preview') || '';
let bootstrap,
  email = '',
  busy = false,
  revision = 0,
  pending = null,
  editor = null,
  opening = false;
function message(text) {
  const element = q('#auth-message');
  if (element) element.textContent = text;
}
function unavailable(text) {
  document.title = 'Survey unavailable · Dallas College AI Club';
  q('.brand').textContent = 'Survey Studio';
  q('.sidebar .eyebrow').textContent = 'Dallas College AI Club';
  q('.sidebar-intro').textContent =
    'Contact the club if you need a current survey link.';
  const heading = document.createElement('h1'),
    note = document.createElement('p');
  heading.textContent = 'Survey unavailable';
  heading.tabIndex = -1;
  note.textContent = text;
  note.setAttribute('role', 'status');
  q('#main').replaceChildren(heading, note);
  heading.focus();
}
async function request(action, body, path, offset) {
  let response;
  try {
    response = await fetch(
      '/api/custom-surveys?' +
        new URLSearchParams({
          action,
          ...(path ? { path } : {}),
          ...(offset !== undefined ? { offset } : {}),
        }),
      {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(30000),
        headers: {
          'X-Survey-Link': link,
          ...(previewCapability ? { 'X-Survey-Preview': '1' } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      },
    );
  } catch {
    throw new Error(
      'Could not connect. Your answers remain in this tab. Check your connection and try again.',
    );
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const error = new Error(
      'The survey service is temporarily unavailable. Your answers remain in this tab; please try again.',
    );
    error.status = response.status >= 400 ? response.status : 503;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(
      data.error || 'Could not connect. Your answers remain in this tab.',
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
function authBusy(value) {
  busy = value;
  document
    .querySelectorAll('.auth-panel button,.auth-panel input')
    .forEach((e) => (e.disabled = value));
}
async function sendCode() {
  await request('auth', { email }, 'email-otp/send-verification-otp');
  q('#survey-email-form').hidden = true;
  q('#survey-code-form').hidden = false;
  q('#code-address').textContent =
    'If this is an approved advisor address, a code was sent to ' + email + '.';
  message('Use the latest six-digit code. Check your junk folder too.');
}
q('#survey-email-form').onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  email = new FormData(event.target).get('email').trim().toLowerCase();
  authBusy(true);
  try {
    await sendCode();
  } catch (error) {
    message(error.message);
  } finally {
    authBusy(false);
  }
};
q('#survey-resend').onclick = async () => {
  if (busy) return;
  authBusy(true);
  try {
    await sendCode();
  } catch (error) {
    message(error.message);
  } finally {
    authBusy(false);
  }
};
q('#survey-change-email').onclick = () => {
  q('#survey-code-form').reset();
  q('#survey-code-form').hidden = true;
  q('#survey-email-form').hidden = false;
  message('Enter your approved advisor email.');
};
q('#survey-code-form').onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  const otp = new FormData(event.target).get('otp');
  authBusy(true);
  try {
    await request('auth', { email, otp }, 'sign-in/email-otp');
    await request('verify-device', {});
    bootstrap = await request('bootstrap');
    await openQuestions();
  } catch (error) {
    message(error.message);
  } finally {
    authBusy(false);
  }
};
function savedResults(results) {
  const root = q('#saved-results');
  root.replaceChildren();
  root.hidden = false;
  const details = document.createElement('details');
  details.className = 'saved-summary';
  const summary = document.createElement('summary');
  summary.textContent = 'Saved shared summaries · read-only';
  details.append(summary);
  details.append(
    responseSections(results, { definition: bootstrap.definition }),
  );
  root.append(details);
}
async function openQuestions() {
  if (!bootstrap || editor || opening) return;
  opening = true;
  try {
    const { mountAdvisor } = await import('./advisor-ui.js');
    revision =
      bootstrap.results.find((r) => r.advisor_id === bootstrap.advisorId)
        ?.revision || 0;
    q('#survey-tools').hidden = false;
    const expiry = document.createElement('p');
    expiry.className = 'micro';
    expiry.textContent =
      'Survey expires ' +
      new Date(bootstrap.survey.expiresAt).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
      }) +
      ' Central.';
    q('.sidebar').append(expiry);
    editor = mountAdvisor(bootstrap, {
      submit: async (data) => {
        const serialized = JSON.stringify(data);
        if (pending && pending.serialized !== serialized)
          throw new Error(
            'The previous save has not been confirmed. Retry that same selection, or keep a personal copy and reload to check the saved summary.',
          );
        pending ||= {
          serialized,
          body: {
            ...data,
            requestId: crypto.randomUUID(),
            expectedRevision: revision,
          },
        };
        let result;
        try {
          result = await request('submit', pending.body);
        } catch (error) {
          if (error.status === 400) pending = null;
          throw error;
        }
        if (!result.receipt?.id || !Number.isInteger(result.receipt.revision))
          throw new Error(
            'The save could not be confirmed. Retry with the same selection.',
          );
        revision = result.receipt.revision;
        pending = null;
        // A failed refresh does not turn a committed save into a failed save.
        try {
          bootstrap = await request('bootstrap');
          editor.updateResults(bootstrap.results);
          savedResults(bootstrap.results);
        } catch {}
        return result.receipt;
      },
    });
    savedResults(bootstrap.results);
  } finally {
    opening = false;
  }
}
q('#survey-continue').onclick = async () => {
  try {
    await openQuestions();
  } catch {
    message('Could not open the questions. Reload this page and try again.');
  }
};
q('#survey-preview').onclick = () => {
  location.hash = new URLSearchParams({ invite: link, preview: '1' });
  location.reload();
};
q('#survey-signout').onclick = async () => {
  if (
    !confirm(
      'Sign out of this device? Download your full personal copy first to keep unshared answers.',
    )
  )
    return;
  try {
    await request('signout', {});
    editor?.discard();
    location.reload();
  } catch (error) {
    alert(error.message);
  }
};
for (const suffix of ['', 'Mobile'])
  q('#copyEmail' + suffix).onclick = async () => {
    try {
      await navigator.clipboard.writeText(
        'thedallascollegeaiclub@dcccd.onmicrosoft.com',
      );
      const status = q(suffix ? '#copy-status-mobile' : '#copy-status');
      status.textContent = 'Address copied.';
    } catch {
      message('Copy the club email address shown below the navigation.');
    }
  };
async function start() {
  if (params.has('sample')) {
    try {
      const data = await request('sample');
      const { renderSample } = await import('./sample.js');
      renderSample(data);
    } catch (error) {
      unavailable(error.message);
      const signIn = document.createElement('a');
      signIn.href = '/admin/#/surveys/custom';
      signIn.textContent = 'Open Club Office';
      q('#main').append(signIn);
    }
    return;
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(link)) {
    unavailable('Use the private survey link provided by the club.');
    return;
  }
  try {
    const welcome = await request('welcome');
    if (welcome.kind === 'custom') {
      const { mountCustomForm } = await import('./form-ui.js');
      await mountCustomForm({
        welcome,
        request,
        previewOnly: previewCapability || params.get('preview') === '1',
      });
      return;
    }
    q('#survey-expiration').textContent =
      'This private survey expires ' +
      new Date(welcome.expiresAt).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
      }) +
      ' Central.';
    q('#survey-preview').hidden = false;
    if (new URLSearchParams(location.hash.slice(1)).get('preview') === '1') {
      const { renderPreview } = await import('./preview.js');
      renderPreview(await request('preview'), link);
      return;
    }
    bootstrap = await request('bootstrap');
    q('#survey-continue').hidden = false;
    message(
      'This device is verified for ' +
        bootstrap.definition.respondents.find(
          (r) => r.id === bootstrap.advisorId,
        ).name +
        '.',
    );
  } catch (error) {
    if (error.status === 401) {
      q('#survey-email-form').hidden = false;
      message('Verify your email to open the questions.');
    } else unavailable(error.message);
  }
}
start();
