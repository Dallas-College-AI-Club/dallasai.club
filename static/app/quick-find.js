import { searchClub } from './search-index.js';
export function installQuickFind(icon) {
  const search = document.createElement('button');
  search.type = 'button';
  search.className = 'section-search';
  search.setAttribute('aria-haspopup', 'dialog');
  search.innerHTML =
    icon('M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M16 16l5 5') +
    '<span>Quick find</span><kbd>Ctrl K</kbd>';
  document.querySelector('#club-navigation').append(search);
  const dialog = document.createElement('dialog');
  dialog.className = 'section-switcher';
  dialog.setAttribute('aria-labelledby', 'switcher-title');
  dialog.innerHTML =
    '<form method="dialog"><h2 id="switcher-title">Quick find</h2><button class="switcher-close" aria-label="Close quick find">×</button></form><label class="switcher-input"><span class="sr-only">Search articles, projects, events, and more</span><input type="search" placeholder="Articles, projects, events…" autocomplete="off" spellcheck="false"></label><p class="search-count" role="status"></p><div class="switcher-results" aria-label="Search results"></div><p class="switcher-empty" hidden>No matches yet. Try a title, topic, or month.</p><footer><span>↑ ↓ to move · Enter to open</span><kbd>Esc</kbd></footer>';
  document.body.append(dialog);
  const input = dialog.querySelector('input'),
    results = dialog.querySelector('.switcher-results');
  const openEntry = (entry) => {
    dialog.close();
    if (document.body.classList.contains('menu-open'))
      document.querySelector('#nav-toggle').click();
    document.dispatchEvent(new CustomEvent('club:navigate', { detail: { href: entry.href } }));
  };
  function filter() {
    const entries = searchClub(input.value);
    results.replaceChildren();
    dialog.querySelector('.search-count').textContent = input.value.trim()
      ? `${entries.length} ${entries.length === 1 ? 'match' : 'matches'}`
      : 'Browse the club, or search by a title or topic.';
    dialog.querySelector('.switcher-empty').hidden = entries.length > 0;
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.href = entry.href;
      const copy = document.createElement('span'),
        type = document.createElement('small'),
        title = document.createElement('strong'),
        description = document.createElement('small'),
        arrow = document.createElement('span');
      type.className = 'switcher-type';
      type.textContent = entry.category;
      title.textContent = entry.title;
      description.textContent = entry.description;
      arrow.textContent = '↗';
      arrow.setAttribute('aria-hidden', 'true');
      copy.append(type, title, description);
      button.append(copy, arrow);
      button.onclick = () => openEntry(entry);
      results.append(button);
    }
    results.scrollTop = 0;
  }
  input.addEventListener('input', filter);
  const searchState = () =>
    document.dispatchEvent(new CustomEvent('club:search', { detail: { open: dialog.open } }));
  dialog.addEventListener('close', searchState);
  search.onclick = () => {
    input.value = '';
    filter();
    dialog.showModal();
    searchState();
    document.dispatchEvent(new CustomEvent('club:pause-games'));
    input.focus();
  };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dialog.open) dialog.close();
      else search.click();
    }
  });
  dialog.addEventListener('keydown', (e) => {
    const shown = [...results.querySelectorAll('button')],
      index = shown.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length)
        shown[
          index < 0
            ? e.key === 'ArrowDown'
              ? 0
              : shown.length - 1
            : (index + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length
        ].focus();
    }
    if (e.key === 'Enter' && e.target === input) {
      e.preventDefault();
      shown[0]?.click();
    }
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        dialog.close();
    }
  });
  search.querySelector('kbd').textContent = navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K';
}
