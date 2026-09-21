// Resolve the initial surface before the browser paints the shared HTML shell.
const requested = new URLSearchParams(location.search).get('mode') || 'summary';
const initial =
  { home: 'summary', browse: 'summary', latest: 'summary', campuses: 'explore' }[
    requested
  ] || requested;
document.documentElement.dataset.initialSpace = initial;
document.documentElement.classList.add('club-booting');
