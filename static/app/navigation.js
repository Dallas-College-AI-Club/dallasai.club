import { installQuickFind } from './quick-find.js';
const nav = document.querySelector('.primary-nav'),
  links = [...nav.querySelectorAll('a')];
const paths = {
  journal: 'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h4v15h-3a4 4 0 0 0-4 2',
  lab: 'M9 3h6M10 3v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M8 15h8',
  projects: 'M3 6h18v13H3zM9 10l6 3-6 3z',
  events: 'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16M8 14h2M14 14h2',
  about: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 10v7M12 7v.01',
};
const icon = (path) =>
  /* HTML */ `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="${path}" />
  </svg>`;
const latestMark = /* HTML */ `<svg
  class="nav-latest-mark"
  viewBox="0 0 112 32"
  aria-hidden="true"
  shape-rendering="crispEdges"
>
  <use href="assets/retro-icons.svg#latest" />
</svg>`;
for (const link of links) {
  const label = link.textContent;
  if (link.dataset.mode === 'summary') {
    link.innerHTML = latestMark + `<span class="sr-only">${label}</span>`;
    link.title = 'Latest — return to the club desktop';
    continue;
  }
  link.innerHTML =
    icon(paths[link.dataset.mode]) +
    /* HTML */ `<span>${label}</span><span class="nav-forward" aria-hidden="true">↗</span>`;
}
const marker = document.createElement('span');
marker.className = 'nav-selection';
marker.setAttribute('aria-hidden', 'true');
nav.prepend(marker);
function selection() {
  const active = links.find((a) => a.hasAttribute('aria-current'));
  marker.hidden = !active;
  if (!active) return;
  marker.style.height = active.offsetHeight + 'px';
  marker.style.transform = `translateY(${active.offsetTop}px)`;
}
new MutationObserver(selection).observe(nav, {
  attributes: true,
  subtree: true,
  attributeFilter: ['aria-current'],
});
new ResizeObserver(selection).observe(nav);
document.fonts.ready.then(selection);
selection();
installQuickFind(icon);
