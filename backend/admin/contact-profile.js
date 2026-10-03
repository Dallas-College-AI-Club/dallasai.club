const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
const button = (text, action) => {
  const el = node('button', text, 'secondary');
  el.type = 'button';
  el.onclick = action;
  return el;
};
export function contactProfile(
  contact,
  save,
  cancel,
  draft,
  remember = () => {},
  openResponse = () => {},
) {
  const panel = node('section', undefined, 'contact-profile');
  const form = node('form'),
    nameLabel = node('label', 'Contact name'),
    name = node('input'),
    emailLabel = node('label', 'Primary email'),
    email = node('input');
  name.value = draft?.name ?? contact.name;
  name.maxLength = 100;
  nameLabel.append(name);
  email.type = 'email';
  email.required = true;
  email.maxLength = 254;
  email.value = draft?.primaryEmail ?? contact.email;
  emailLabel.append(email);
  const actions = node('div', undefined, 'survey-response-actions'),
    submit = node('button', 'Save contact changes');
  submit.type = 'submit';
  actions.append(submit, button('Cancel', cancel));
  form.append(
    nameLabel,
    emailLabel,
    node(
      'p',
      'This is the name and address shown in the contact directory. Saved submissions and notes stay together.',
      'hint',
    ),
    actions,
  );
  form.onsubmit = (event) => {
    event.preventDefault();
    save(
      {
        action: 'contact-edit',
        name: name.value,
        primaryEmail: email.value,
      },
      'Contact updated. Its history stays together under this primary email.',
    );
  };
  panel.append(node('h3', 'Edit contact'), form);
  const aliases = node('section');
  aliases.append(
    node('h4', 'Linked addresses'),
    node(
      'p',
      'An address can be removed when no saved submission, follow-up note or survey membership uses it. Open the relevant submission in the history below to correct or remove its response first.',
      'hint',
    ),
  );
  const hint = node('p', undefined, 'hint');
  hint.setAttribute('role', 'status');
  aliases.append(hint);
  const removeButtons = [];
  for (const alias of contact.aliases || []) {
    const row = node('div', undefined, 'contact-alias-row'),
      details = node('div');
    details.append(node('strong', alias.email));
    const used = Boolean(
      alias.submissions || alias.notes || alias.membership,
    );
    details.append(
      node(
        'p',
        alias.email === contact.email
          ? 'Primary email'
          : `${alias.submissions} submission(s) · ${alias.notes} note(s)${alias.membership ? ' · Survey membership' : ''}`,
        'hint',
      ),
    );
    row.append(details);
    if (alias.submissions) {
      const links = node('div', undefined, 'contact-alias-responses');
      links.append(
        node(
          'p',
          'To correct this saved email, open its response and choose Edit response.',
          'hint',
        ),
      );
      for (const response of alias.responses || []) {
        const link = node('a', 'Open response: ' + response.title);
        link.href = '#entry=' + encodeURIComponent(response.id);
        link.onclick = () => openResponse();
        links.append(link);
      }
      if (alias.submissions > 5)
        links.append(
          node(
            'p',
            'More responses are listed in the contact history below.',
            'hint',
          ),
        );
      row.append(links);
    }
    if (alias.email !== contact.email) {
      const use = button('Use as primary', () => {
        email.value = alias.email;
        sync();
        email.focus();
      });
      const remove = button('Remove unused address', () => {
        if (used || dirty()) return;
        const confirmation = node(
          'div',
          undefined,
          'contact-confirmation',
        );
        confirmation.append(
          node(
            'p',
            'Remove ' +
              alias.email +
              ' from this contact? Existing admin activity stays in this history. A future submission using this address will create a separate contact.',
          ),
          button('Cancel removal', () => {
            confirmation.remove();
            remove.disabled = false;
          }),
          button('Confirm remove address', () =>
            save(
              { action: 'contact-remove-alias', alias: alias.email },
              'Unused address removed.',
            ),
          ),
        );
        row.append(confirmation);
        confirmation.querySelector('button').focus();
        remove.disabled = true;
      });
      removeButtons.push({ button: remove, used });
      row.append(use, remove);
    }
    aliases.append(row);
  }
  const dirty = () =>
    name.value !== contact.name || email.value !== contact.email;
  function sync() {
    remember(
      dirty() ? { name: name.value, primaryEmail: email.value } : null,
    );
    for (const row of removeButtons)
      row.button.disabled = row.used || dirty();
    hint.textContent = dirty()
      ? 'Save or cancel the name and primary email changes before removing an address.'
      : '';
    aliases
      .querySelectorAll('.contact-confirmation')
      .forEach((el) => el.remove());
  }
  form.addEventListener('input', sync);
  sync();
  panel.append(aliases);
  return panel;
}
