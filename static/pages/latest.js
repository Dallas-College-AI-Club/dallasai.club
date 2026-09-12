import { desktopMarkup, renderViews, safeURL } from '../desktop/views.js';
import { mountDesktop } from '../desktop/windows.js';
import { mountReplay } from '../desktop/replay.js';
import { buildLatest } from '../content/latest.js';

let cachedContent = null;

export function mountLatest(root) {
  root.classList.remove('content', 'space-page');
  root.classList.add('latest-desktop');
  let current = null,
    views = null,
    player = null,
    stopDesktop = null;
  let request = null,
    disposed = false;
  const freshness = (message, stale = false) => {
    const indicator = root.querySelector('[data-freshness]');
    if (!indicator) return;
    indicator.setAttribute('aria-label', message);
    indicator.title = message;
    indicator.classList.toggle('is-stale', stale);
  };
  function render(data) {
    const next = renderViews(data);
    if (!current) {
      root.innerHTML = desktopMarkup(data, next);
      stopDesktop = mountDesktop(root);
      player = mountReplay(root, data.recordings, data.introSeconds);
    } else {
      for (const [id, view] of Object.entries(next)) {
        const section = root.querySelector('[data-window="' + id + '"]');
        const recordingChanged =
          id === 'major' &&
          (data.introSeconds !== current.introSeconds ||
            JSON.stringify(data.recordings) !== JSON.stringify(current.recordings));
        if (view.body !== views[id].body || recordingChanged) {
          const saved = id === 'major' ? player?.getState() : null;
          if (id === 'major') player?.destroy();
          const body = section.querySelector('.r95-window-body');
          const scroll = body.scrollTop;
          body.innerHTML = view.body;
          body.scrollTop = scroll;
          if (id === 'major')
            player = mountReplay(section, data.recordings, data.introSeconds, saved);
        }
        if (view.menu !== views[id].menu) {
          const menu = section.querySelector('.r95-window-menu');
          menu.innerHTML = view.menu;
          menu.hidden = !view.menu;
        }
        section.querySelector('.r95-statusbar > span').textContent = view.footer;
      }
      // The Start menu keeps its focus and open state when club destinations change.
      for (const name of ['major', 'join']) {
        if (data.links[name] === current.links[name]) continue;
        for (const anchor of root.querySelectorAll('.r95-start-menu a')) {
          if (anchor.getAttribute('href') === safeURL(current.links[name]))
            anchor.href = safeURL(data.links[name]);
        }
      }
    }
    current = data;
    cachedContent = data;
    views = next;
    freshness(
      'Club content checked at ' +
        new Date(data.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    );
  }
  async function refresh() {
    if (request || disposed || document.hidden) return;
    request = new AbortController();
    const timeout = setTimeout(() => request?.abort(), 8000);
    try {
      const response = await fetch('latest.json', { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('Content unavailable');
      const data = await response.json();
      if (!Array.isArray(data.articles) || !Array.isArray(data.events))
        throw new Error('Invalid published content');
      if (!disposed) render(buildLatest(new Date(), data));
    } catch {
      if (disposed) return;
      freshness('Showing the last available club updates. Reconnecting automatically.', true);
    } finally {
      clearTimeout(timeout);
      request = null;
    }
  }
  const timer = setInterval(refresh, 60000);
  const navigate = (event) => {
    const anchor = event.target.closest('a[href]');
    if (
      !anchor ||
      anchor.target === '_blank' ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || url.pathname !== '/club.html') return;
    event.preventDefault();
    document.dispatchEvent(new CustomEvent('club:navigate', { detail: { href: url.href } }));
  };
  root.addEventListener('click', navigate);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('online', refresh);
  render(cachedContent || buildLatest());
  refresh();
  return () => {
    disposed = true;
    clearInterval(timer);
    request?.abort();
    root.removeEventListener('click', navigate);
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('online', refresh);
    player?.destroy();
    stopDesktop?.();
    root.classList.remove('latest-desktop');
    root.classList.add('content');
  };
}
