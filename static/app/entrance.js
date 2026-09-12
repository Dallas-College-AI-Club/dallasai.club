const preference = matchMedia('(prefers-reduced-motion: reduce)');
function update() {
  const reduced =
    new URLSearchParams(location.search).get('motion') === 'off' || preference.matches;
  document.body.classList.toggle('still-mode', reduced);
  for (const [id, mode] of [
    ['browse', 'summary'],
    ['explore', 'play'],
    ['skip', 'summary'],
  ])
    document.querySelector('#' + id).href =
      'club.html?mode=' + mode + '&entry=gateway' + (reduced ? '&motion=off' : '');
}
preference.addEventListener('change', update);
update();
