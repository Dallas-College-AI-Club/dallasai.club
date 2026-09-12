import { COPYRIGHT, SOCIAL_LINKS } from '../content/club.js';

const footer = document.querySelector('.site-footer');
if (footer) {
  footer.innerHTML = /* HTML */ `<div class="footer-main">
      <a class="footer-brand" href="index.html" aria-label="Dallas College AI Club — welcome">
        <img src="assets/club-logo.png" alt="" width="46" height="46" />
        <span>Dallas College<strong>AI Club</strong></span>
      </a>
      <p class="footer-thought">Different perspectives. <em>Shared possibilities.</em></p>
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
    link.insertAdjacentHTML('beforeend', '<span class="footer-arrow" aria-hidden="true">↗</span>');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer';
    return link;
  });
  footer.querySelector('nav').replaceChildren(...links);
}
