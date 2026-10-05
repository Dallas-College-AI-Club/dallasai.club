import { node, button } from './ui.js';
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
      'Choose any linked address as the primary email. Removing an address keeps its saved submissions, RSVPs, notes and survey membership in this contact history. To remove the primary email, save a different primary first.',
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
        link.href = '#/inbox/' + encodeURIComponent(response.id);
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
      const remove = button('Remove address', () => {
        if (dirty()) return;
        const confirmation = node('div', undefined, 'contact-confirmation');
        confirmation.append(
          node(
            'p',
            'Remove ' +
              alias.email +
              ' from the linked addresses? Saved submissions, RSVPs, notes and survey membership stay in this contact history.',
          ),
          button('Cancel removal', () => {
            confirmation.remove();
            remove.disabled = false;
          }),
          button('Confirm remove address', () =>
            save(
              { action: 'contact-remove-alias', alias: alias.email },
              'Address removed. Its saved records stay in this contact history.',
            ),
          ),
        );
        row.append(confirmation);
        confirmation.querySelector('button').focus();
        remove.disabled = true;
      });
      removeButtons.push(remove);
      row.append(use, remove);
    }
    aliases.append(row);
  }
  const dirty = () =>
    name.value !== contact.name || email.value !== contact.email;
  function sync() {
    remember(dirty() ? { name: name.value, primaryEmail: email.value } : null);
    for (const remove of removeButtons) remove.disabled = dirty();
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
