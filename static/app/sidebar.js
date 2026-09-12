const button = document.querySelector('#nav-toggle'),
  nav = document.querySelector('#club-navigation'),
  backdrop = document.querySelector('#nav-backdrop'),
  mobile = matchMedia('(max-width:760px)');
function set(open) {
  document.body.classList.toggle('menu-open', open);
  button.setAttribute('aria-expanded', String(open));
  button.textContent = open ? '✕ Close' : '☰ Menu';
  nav.inert = mobile.matches && !open;
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
  if (e.key === 'Escape' && document.body.classList.contains('menu-open')) {
    set(false);
    button.focus();
  }
});
mobile.addEventListener('change', () => set(false));
set(false);
