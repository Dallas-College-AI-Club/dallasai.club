import { responseSections } from './results-ui.js';
import { hasAnswer } from './form-values.js';
const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
export const audienceNames = {
  students: 'Dallas College students',
  staff: 'Dallas College staff',
  public: 'Open to the public',
  officers: 'Club officers',
  advisors: 'Advisors',
};
export function questionFields(
  definition,
  { readOnly = false, values = {}, onChange = () => {} } = {},
) {
  const form = node('div');
  for (const q of definition.questions) {
    const card = node('section', undefined, 'question');
    const title = node('h2', q.title + (q.required ? ' *' : ''));
    title.id = 'question-' + q.id;
    card.append(title);
    if (q.description) card.append(node('p', q.description, 'sub'));
    const group = node('div');
    group.setAttribute('aria-labelledby', title.id);
    if (q.type === 'text') {
      const input = node('textarea');
      input.rows = 4;
      input.maxLength = 5000;
      input.value = values[q.id] || '';
      input.setAttribute('aria-labelledby', title.id);
      input.disabled = readOnly;
      input.required = q.required;
      input.oninput = () => onChange(q.id, input.value);
      group.append(input);
    } else if (q.type === 'scale') {
      const input = node('select');
      input.setAttribute('aria-labelledby', title.id);
      input.disabled = readOnly;
      input.required = q.required;
      const empty = node('option', 'Choose a rating');
      empty.value = '';
      input.append(empty);
      for (let i = 1; i <= 5; i++) {
        const o = node('option', i + ' / 5');
        o.value = i;
        input.append(o);
      }
      input.value = values[q.id] ?? '';
      input.onchange = () =>
        onChange(q.id, input.value === '' ? '' : Number(input.value));
      group.append(input, node('p', '1 = lowest · 5 = highest', 'micro'));
    } else {
      group.setAttribute('role', 'group');
      q.options.forEach((option, i) => {
        const label = node('label', undefined, 'form-option'),
          input = node('input');
        input.type = q.type === 'single' ? 'radio' : 'checkbox';
        input.name = q.id;
        input.value = i;
        input.disabled = readOnly;
        input.checked =
          q.type === 'single'
            ? values[q.id] === i
            : (values[q.id] || []).includes(i);
        input.onchange = () => {
          onChange(
            q.id,
            q.type === 'single'
              ? i
              : [...group.querySelectorAll('input:checked')].map((e) =>
                  Number(e.value),
                ),
          );
        };
        label.append(input, node('span', option));
        group.append(label);
      });
      if (!readOnly && !q.required) {
        const clear = node('button', 'Clear selection', 'small ghost');
        clear.type = 'button';
        clear.onclick = () => {
          group.querySelectorAll('input').forEach((e) => (e.checked = false));
          onChange(q.id, '');
        };
        group.append(clear);
      }
    }
    card.append(group);
    form.append(card);
  }
  return form;
}
export async function mountCustomForm({ welcome, request, previewOnly }) {
  const main = document.querySelector('#main'),
    sidebar = document.querySelector('.sidebar');
  document.title = welcome.title + ' · Dallas College AI Club';
  document.querySelector('.brand').textContent = 'Survey Studio';
  document.body.classList.add('custom-form');
  if (previewOnly) document.body.classList.add('survey-preview');
  sidebar.querySelector('.eyebrow').textContent =
    audienceNames[welcome.audience];
  sidebar.querySelector('.sidebar-intro').textContent = welcome.title;
  document.querySelector('#who').textContent = previewOnly
    ? 'Preview · answering disabled'
    : 'Email verification required to answer';
  const expiry =
    'Expires ' +
    new Date(welcome.expiresAt).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
    }) +
    ' Central.';
  const tools = document.querySelector('#survey-tools');
  tools.hidden = false;
  document.querySelector('#restart').hidden = true;
  document.querySelector('#survey-signout').hidden = true;
  document.querySelector('#mode').onclick = (e) => {
    document.body.classList.toggle('plain');
    e.target.textContent = document.body.classList.contains('plain')
      ? 'Studio mode'
      : 'Plain mode';
  };
  document.querySelector('#motion').onclick = (e) => {
    document.body.classList.toggle('still');
    e.target.textContent = document.body.classList.contains('still')
      ? 'Motion off'
      : 'Motion on';
  };
  let definition,
    bootstrap,
    values = {},
    dirty = false,
    revision = 0,
    pending,
    busy = false;
  const status = node('p', undefined, 'auth-message');
  status.setAttribute('role', 'status');
  function heading(text) {
    const h = node('h1', text);
    h.tabIndex = -1;
    main.append(h);
  }
  function intro() {
    main.replaceChildren();
    heading(welcome.title);
    main.append(
      node('p', welcome.intro, 'welcome-copy'),
      node('p', expiry, 'micro'),
      node(
        'p',
        welcome.permissions.results === 'respondents'
          ? 'Submitted answers and your name are visible to admins and verified respondents, including people who join later.'
          : 'Submitted answers are visible to club admins. You can also review your own saved response.',
        'sub',
      ),
    );
  }
  function button(label, fn, cls = 'primary') {
    const b = node('button', label, cls);
    b.type = 'button';
    b.onclick = fn;
    return b;
  }
  async function authenticate() {
    intro();
    main.append(
      node('h2', 'Verify your email'),
      node(
        'p',
        'This device is remembered until the survey expires, you sign out, or access is removed.',
      ),
    );
    const form = node('form', undefined, 'auth-panel'),
      label = node('label', 'Email address'),
      email = node('input');
    email.type = 'email';
    email.required = true;
    email.maxLength = 254;
    email.autocomplete = 'email';
    label.append(email);
    const send = node('button', 'Send sign-in code', 'primary');
    send.type = 'submit';
    form.append(label, send);
    main.append(form, status);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      send.disabled = true;
      try {
        await request(
          'auth',
          { email: email.value.trim().toLowerCase() },
          'email-otp/send-verification-otp',
        );
        const address = email.value.trim().toLowerCase();
        form.replaceChildren(
          node(
            'p',
            'If this email is eligible, a code has been sent. Check your inbox and junk folder.',
          ),
        );
        const codeLabel = node('label', 'Sign-in code'),
          code = node('input');
        code.required = true;
        code.inputMode = 'numeric';
        code.autocomplete = 'one-time-code';
        code.pattern = '[0-9]{6}';
        code.maxLength = 6;
        codeLabel.append(code);
        const verify = node('button', 'Verify and continue', 'primary');
        verify.type = 'submit';
        form.append(
          codeLabel,
          verify,
          button(
            'Use another email',
            () => {
              status.textContent = '';
              authenticate();
            },
            'ghost',
          ),
        );
        form.onsubmit = async (event) => {
          event.preventDefault();
          if (busy) return;
          busy = true;
          verify.disabled = true;
          try {
            await request(
              'auth',
              { email: address, otp: code.value },
              'sign-in/email-otp',
            );
            await request('verify-device', {});
            await open();
          } catch (error) {
            status.textContent = error.message;
          } finally {
            busy = false;
            verify.disabled = false;
          }
        };
        form.append(
          button(
            'Send a new code',
            async () => {
              if (busy) return;
              busy = true;
              try {
                await request(
                  'auth',
                  { email: address },
                  'email-otp/send-verification-otp',
                );
                status.textContent = 'A new code was requested.';
              } catch (error) {
                status.textContent = error.message;
              } finally {
                busy = false;
              }
            },
            'ghost',
          ),
        );
        status.textContent = 'Enter the latest six-digit code.';
        code.focus();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
        send.disabled = false;
      }
    };
  }
  function renderQuestions() {
    status.textContent = '';
    intro();
    main.append(
      node(
        'p',
        previewOnly
          ? 'Question preview · all answer controls are disabled.'
          : 'Required questions are marked with *.',
        'micro',
      ),
    );
    main.append(
      questionFields(definition, {
        readOnly: previewOnly,
        values,
        onChange: (id, value) => {
          values[id] = value;
          dirty = true;
          pending = null;
        },
      }),
    );
    if (!previewOnly) main.append(button('Review answers →', review));
    main.append(status);
    main.querySelector('h1').focus();
  }
  function answerText(q) {
    const v = values[q.id];
    if (!hasAnswer(v)) return 'Not answered';
    return q.type === 'text'
      ? v.trim()
      : q.type === 'scale'
        ? v + ' / 5'
        : (q.type === 'single' ? [v] : v).map((i) => q.options[i]).join('\n');
  }
  function review() {
    const missing = definition.questions.find(
      (q) => q.required && !hasAnswer(values[q.id]),
    );
    if (missing) {
      status.textContent = 'Answer the required question: ' + missing.title;
      main
        .querySelector('[aria-labelledby="question-' + missing.id + '"]')
        ?.querySelector('input,textarea,select')
        ?.focus();
      const field = main.querySelector(
        'textarea[aria-labelledby="question-' +
          missing.id +
          '"],select[aria-labelledby="question-' +
          missing.id +
          '"]',
      );
      field?.focus();
      return;
    }
    status.textContent = '';
    intro();
    main.append(node('h2', 'Review your answers'));
    for (const q of definition.questions) {
      const card = node('section', undefined, 'question');
      card.append(node('h3', q.title), node('p', answerText(q), 'answer-copy'));
      main.append(card);
    }
    const label = node('label', undefined, 'form-option'),
      consent = node('input');
    consent.type = 'checkbox';
    label.append(
      consent,
      node(
        'span',
        welcome.permissions.results === 'respondents'
          ? 'I reviewed my answers and agree to share them and my name with admins and verified respondents, including future respondents.'
          : 'I reviewed my answers and agree to share them with club admins.',
      ),
    );
    main.append(label);
    const submit = button('Submit answers', async () => {
      if (busy) return;
      if (!consent.checked) {
        status.textContent =
          'Confirm the sharing permission before submitting.';
        return;
      }
      busy = true;
      submit.disabled = true;
      status.textContent = 'Saving…';
      pending ||= {
        requestId: crypto.randomUUID(),
        expectedRevision: revision,
        contentVersion: 'custom-form/1',
        advisorId: bootstrap.advisorId,
        consent: welcome.permissions.results,
        answers: definition.questions
          .filter((q) => hasAnswer(values[q.id]))
          .map((q) => ({ id: q.id, value: values[q.id] })),
      };
      try {
        const saved = await request('submit', pending);
        if (
          !saved.receipt?.id ||
          !Number.isInteger(saved.receipt.revision) ||
          !Number.isFinite(Date.parse(saved.receipt.submittedAt))
        )
          throw new Error(
            'We could not confirm the save. Retry this submission; your answers remain here.',
          );
        revision = saved.receipt.revision;
        pending = null;
        dirty = false;
        intro();
        main.append(
          node('h2', 'Your response is saved'),
          node(
            'p',
            'Saved ' +
              new Date(saved.receipt.submittedAt).toLocaleString() +
              '.',
          ),
          button('Review or update my answers', () => {
            status.textContent = '';
            renderQuestions();
          }),
        );
        main.querySelector('h1').focus();
        await showResults();
      } catch (error) {
        status.textContent = error.message;
        if (error.status && error.status < 500) pending = null;
      } finally {
        busy = false;
        submit.disabled = false;
      }
    });
    main.append(
      button(
        '← Edit answers',
        () => {
          if (pending) {
            status.textContent =
              'Retry the same submission to confirm whether it was saved before editing.';
            return;
          }
          if (!busy) {
            status.textContent = '';
            renderQuestions();
          }
        },
        'ghost',
      ),
      submit,
      status,
    );
    main.querySelector('h1').focus();
  }
  async function showResults(existing) {
    try {
      const data = existing || (await request('bootstrap'));
      const details = node('details', undefined, 'saved-summary');
      details.append(node('summary', 'Saved results · read-only'));
      details.append(responseSections(data.results, { definition }));
      let nextOffset = data.nextOffset;
      const pageStatus = node('p');
      pageStatus.setAttribute('role', 'status');
      const more = button(
        'Load more saved results',
        async () => {
          more.disabled = true;
          try {
            const page = await request(
              'shared-results',
              undefined,
              undefined,
              nextOffset,
            );
            details.insertBefore(
              responseSections(page.results, { definition }),
              more,
            );
            nextOffset = page.nextOffset;
            more.hidden = nextOffset === null;
            pageStatus.textContent = '';
          } catch (error) {
            pageStatus.textContent = error.message;
          } finally {
            more.disabled = false;
          }
        },
        'ghost',
      );
      more.hidden = nextOffset === null || nextOffset === undefined;
      details.append(more, pageStatus);
      main.append(details);
    } catch {
      main.append(
        node('p', 'The response was saved. Reload later to view results.'),
      );
    }
  }
  async function open() {
    status.textContent = '';
    try {
      if (previewOnly) definition = (await request('preview')).definition;
      else {
        bootstrap = await request('bootstrap');
        definition = bootstrap.definition;
        const mine = bootstrap.results.find(
          (r) => r.advisor_id === bootstrap.advisorId,
        );
        revision = mine?.revision || 0;
        if (!dirty)
          values = Object.fromEntries(
            (mine?.responses || []).map((a) => [a.id, a.value]),
          );
        document.querySelector('#who').textContent =
          bootstrap.definition.respondents.find(
            (r) => r.id === bootstrap.advisorId,
          )?.name || 'Verified respondent';
      }
      renderQuestions();
      if (!previewOnly) {
        if (bootstrap.results.some((r) => r.revision))
          await showResults(bootstrap);
        const out = document.querySelector('#survey-signout');
        out.hidden = false;
        out.onclick = async () => {
          if (busy) return;
          if (dirty) {
            status.textContent =
              'Submit your changes or reload before signing out.';
            return;
          }
          try {
            await request('signout', {});
            location.reload();
          } catch (error) {
            status.textContent = error.message;
          }
        };
      }
    } catch (error) {
      if (error.status === 401) await authenticate();
      else {
        intro();
        status.textContent = error.message;
        main.append(status);
      }
    }
  }
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  intro();
  main.append(
    button(
      previewOnly ? 'Preview the questions →' : 'Continue to questions →',
      open,
    ),
    status,
  );
  if (!previewOnly && welcome.permissions.preview === 'link')
    main.append(
      button(
        'Preview questions without signing in',
        async () => {
          try {
            definition = (await request('preview')).definition;
            intro();
            main.append(
              questionFields(definition, { readOnly: true }),
              button('Sign in to answer', open),
            );
          } catch (error) {
            status.textContent = error.message;
          }
        },
        'ghost',
      ),
    );
}
