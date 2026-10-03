import { mountAdvisor } from './advisor-ui.js';

export function renderPreview({ definition, expiresAt }, link) {
  document.body.classList.add('survey-preview');
  document.querySelector('#survey-tools').hidden = false;
  document.querySelector('#restart').hidden = true;
  document.querySelector('#survey-signout').hidden = true;

  const welcome = document.querySelector('#main .welcome').cloneNode(true);
  welcome.querySelector('.auth-panel').remove();
  const title = welcome.querySelector('h1');
  title.id = 'title';
  title.tabIndex = -1;
  const people = document.createElement('div');
  people.className = 'people';
  people.setAttribute('role', 'group');
  people.setAttribute('aria-label', 'Advisor names · preview only');
  for (const person of definition.respondents) {
    const button = document.createElement('button');
    button.className = 'person';
    button.textContent = person.name;
    button.setAttribute('aria-pressed', 'false');
    people.append(button);
  }
  welcome.querySelector('.start-guide').before(people);
  const footer = document.createElement('div');
  footer.className = 'footer';
  const begin = document.createElement('button');
  begin.id = 'begin';
  begin.className = 'primary';
  begin.textContent = 'Preview the questions →';
  footer.append(begin);
  welcome.append(footer);

  const expiry = document.createElement('p');
  expiry.className = 'micro';
  expiry.textContent =
    'Private link expires ' +
    new Date(expiresAt).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
    }) +
    ' Central.';
  const answer = document.createElement('a');
  answer.href = '/surveys/#' + new URLSearchParams({ invite: link });
  answer.textContent = 'Sign in to answer →';
  answer.onclick = () => setTimeout(() => location.reload(), 0);
  document.querySelector('.sidebar').append(expiry, answer);

  mountAdvisor({ definition, advisorId: null }, null, {
    readOnly: true,
    welcomeHTML: welcome.outerHTML,
  });
}
