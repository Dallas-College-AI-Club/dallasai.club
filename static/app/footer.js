import { COPYRIGHT, SOCIAL_LINKS } from '../content/club.js';
import { questionDialog } from './questions.js';
import { coladdeMark, installColadde } from './coladde.js';

const footer = document.querySelector('.site-footer');
if (footer) {
  installColadde();
  footer.innerHTML = /* HTML */ `<div class="footer-main">
      <a
        class="footer-brand"
        href="index.html"
        aria-label="Dallas College AI Club — welcome"
      >
        <img src="assets/club-logo.png" alt="" width="46" height="46" />
        <span>Dallas College<strong>AI Club</strong></span>
      </a>
      <div class="footer-thought">
        <div class="footer-signature">
          ${coladdeMark()}
          <p class="footer-tagline">
            Different perspectives. <em>Shared possibilities.</em>
          </p>
        </div>
      </div>
      <nav aria-label="Follow the club"></nav>
    </div>
    <div class="footer-baseline">
      <p class="footer-copyright"></p>
      <span>Made of curiosity. Powered by people.</span>
    </div>`;
  footer.querySelector('.footer-copyright').textContent = COPYRIGHT;
  const icons = {
    Instagram:
      '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".7" fill="currentColor" stroke="none"/>',
    Threads:
      '<path d="M19.2 7.8C18.4 4 16 2 12.2 2 6.5 2 3.6 5.7 3.6 12s2.9 10 8.6 10c4.7 0 7.8-2.6 7.8-6.1 0-3.2-2.5-5.1-6.5-5.1-3.1 0-5.1 1.2-5.1 3.3 0 1.9 1.5 3 3.5 3 2.7 0 4.1-2 4.1-5.5 0-3.3-1.4-5.2-3.9-5.2-1.5 0-2.7.6-3.4 1.8"/>',
    LinkedIn:
      '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7.5 10v7M7.5 7v.1M11.5 17v-7m0 3c0-4 5-4 5 0v4"/>',
  };
  const links = SOCIAL_LINKS.map(({ label, href }) => {
    const link = document.createElement('a');
    if (icons[label])
      link.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[label]}</svg>`;
    const name = document.createElement('span');
    name.textContent = label;
    link.append(name);
    link.insertAdjacentHTML(
      'beforeend',
      '<span class="footer-arrow" aria-hidden="true">↗</span>',
    );
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer';
    return link;
  });
  footer.querySelector('nav').replaceChildren(...links);
  const questions = questionDialog(),
    ask = document.createElement('button');
  ask.className = 'outline-link';
  ask.textContent = 'Ask the club';
  ask.onclick = () => questions.open();
  footer.querySelector('nav').append(ask);
}
