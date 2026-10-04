const button = document.querySelector('#nav-toggle'),
  nav = document.querySelector('#club-navigation'),
  backdrop = document.querySelector('#nav-backdrop'),
  mobile = matchMedia('(max-width:760px)');
function set(open) {
  open = mobile.matches && open;
  document.body.classList.toggle('menu-open', open);
  button.setAttribute('aria-expanded', String(open));
  button.textContent = open ? '✕ Close' : '☰ Menu';
  nav.inert = mobile.matches && !open;
  document
    .querySelectorAll('body > main, body > footer, body > .skip')
    .forEach((element) => {
      element.inert = open;
    });
}
button.onclick = () => {
  const open = button.getAttribute('aria-expanded') !== 'true';
  set(open);
  if (open) nav.querySelector('a').focus();
};
backdrop.onclick = () => {
  set(false);
  button.focus();
};
nav.addEventListener('click', (e) => {
  if (e.target.closest('a') && mobile.matches) set(false);
});
window.addEventListener('keydown', (e) => {
  if (
    !document.body.classList.contains('menu-open') ||
    document.querySelector('dialog[open]')
  )
    return;
  if (e.key === 'Tab') {
    const stops = [
      button,
      ...nav.querySelectorAll('a[href], button:not([disabled])'),
    ].filter((element) => element.getClientRects().length);
    const first = stops[0],
      last = stops.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  if (e.key === 'Escape') {
    set(false);
    button.focus();
  }
});
mobile.addEventListener('change', () => set(false));
set(false);
