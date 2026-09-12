import { readRun, visitSavedPage } from '../storage/drive.js';
import { routeFromUrl } from './routes.js';
import { JOIN_URL } from '../content/club.js';
import { mountRankings } from '../games/rankings.js';
import { renderActivity } from '../pages/lab.js';
import { mountHub } from '../games/hub.js';
import { mountGame } from '../games/player.js';
import { readArcade, markGame } from '../storage/games.js';
import { GAMES } from '../games/registry.js';
let ClubJourney;
const $ = (s) => document.querySelector(s),
  params = new URLSearchParams(location.search),
  view = $('#world-view'),
  content = $('#content');
let journey = null,
  cleanup = () => {},
  mode = 'summary',
  reduced =
    params.get('motion') === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const names = {
  compare: 'AI Lab',
  drift: 'AI Lab',
  about: 'About',
  summary: 'Latest',
  play: 'Explore & Play',
  rankings: 'Rankings',
  explore: 'Dallas Drive',
  ride: 'Retro Ride',
  snake: 'Snake',
  journal: 'The AI Review',
  article: 'The AI Review',
  lab: 'AI Lab',
  ethics: 'AI Lab',
  projects: 'Projects',
  events: 'Events',
  join: 'Join the club',
  subscribe: 'Subscribe',
  contribute: 'Contribute',
};
for (const game of GAMES) names[game.id] = game.title;
const games = new Set(GAMES.map((g) => g.id)),
  retroGames = new Set(GAMES.filter((g) => g.load).map((g) => g.id));
const normalize = (id) =>
  ({ campuses: 'explore', join: 'about', home: 'summary', browse: 'summary', latest: 'summary' })[
    id
  ] || id;
function urlFor(next, article = null, route = {}) {
  const q = new URLSearchParams({ mode: next });
  if (next === 'article' && article !== null) q.set('article', article);
  if (route.event && next === 'events') q.set('event', route.event);
  if (reduced) q.set('motion', 'off');
  return 'club.html?' + q + (route.anchor ? '#' + encodeURIComponent(route.anchor) : '');
}
function resumeMode() {
  const a = readArcade();
  if (a.last === 'explore' && readRun()) return 'explore';
  if (retroGames.has(a.last) && a.games[a.last]?.state && a.games[a.last].state.phase !== 'ready')
    return a.last;
  return readRun() ? 'explore' : 'play';
}
function updateGameEntry() {
  const next = resumeMode(),
    entry = $('.explore-entry');
  entry.dataset.mode = next;
  entry.href = urlFor(next);
  const resumeLabels = { explore: 'Resume drive', ride: 'Resume ride', snake: 'Resume Snake' };
  $('#explore-entry-label').textContent = resumeLabels[next] || 'Explore & Play';
  entry.title =
    next === 'play' ? 'Explore & Play: choose a game' : 'Back to your spot in ' + names[next];
  entry.setAttribute('aria-label', entry.title);
  $('.arcade-library-link').hidden = next === 'play';
}
function renderView(next, article = null, push = true, route = {}) {
  next = normalize(next);
  if (!names[next]) next = 'summary';
  cleanup();
  cleanup = () => {};
  mode = next;
  const explore = next === 'explore',
    arcade = next === 'play' || next === 'rankings' || retroGames.has(next);
  view.hidden = !explore;
  content.hidden = explore;
  document.body.dataset.space = next;
  content.className = 'content';
  if (games.has(next)) markGame(next);
  updateGameEntry();
  for (const a of document.querySelectorAll('[data-mode]')) {
    const active =
      a.dataset.mode ===
      (['article', 'contribute'].includes(next)
        ? 'journal'
        : ['ethics', 'compare', 'drift'].includes(next)
          ? 'lab'
          : next);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (push) history.pushState({}, '', urlFor(next, article, route));
  document.title = names[next] + ' · Dallas College AI Club';
  if (explore) {
    document.body.classList.remove('reading');
    try {
      if (!journey) journey = new ClubJourney({ reduced, onOpen: show });
      else journey.resume();
    } catch (e) {
      console.error(e);
      $('#renderer-error').hidden = false;
    }
  } else {
    journey?.pause();
    if (article === null) delete content.dataset.article;
    else content.dataset.article = String(article);
    if (arcade)
      cleanup =
        next === 'play'
          ? mountHub(content, { open: show })
          : next === 'rankings'
            ? mountRankings(content, { open: show })
            : mountGame(content, next, { open: show });
    else {
      if (journey?.world.experience.score) journey.world.experience.page(next);
      else visitSavedPage(next);
      cleanup = renderActivity(content, next, { open: show, back: () => show(resumeMode()) });
    }
    content.focus({ preventScroll: true });
  }
  document.documentElement.classList.remove('club-booting');
  window.scrollTo(0, 0);
  if (route.anchor) {
    const target = document.getElementById(route.anchor);
    target?.scrollIntoView({ block: 'start', behavior: 'instant' });
    target?.focus({ preventScroll: true });
  }
}
let navigationTicket = 0,
  transition = null,
  hasRendered = false;
async function show(next, article = null, push = true, route = {}) {
  const ticket = ++navigationTicket;
  next = normalize(next);
  if (next === 'explore' && !ClubJourney) {
    try {
      ({ ClubJourney } = await import('../drive/journey.js'));
    } catch (e) {
      console.error(e);
    }
  }
  if (['journal', 'article', 'contribute'].includes(next)) {
    try {
      await document.fonts.load('400 24px "Source Serif 4"');
    } catch {
      // The serif fallback remains readable if a font request fails.
    }
  }
  if (ticket !== navigationTicket) return;
  const soften =
    hasRendered &&
    !['play', 'rankings'].includes(next) &&
    !['play', 'rankings'].includes(mode) &&
    !games.has(next) &&
    !games.has(mode) &&
    !reduced &&
    document.startViewTransition;
  transition?.skipTransition();
  document.documentElement.classList.toggle(
    'desktop-transition',
    Boolean(soften && (next === 'summary' || mode === 'summary')),
  );
  if (soften) {
    transition = document.startViewTransition(() => {
      if (ticket === navigationTicket) renderView(next, article, push, route);
    });
    transition.finished
      .catch(() => {})
      .finally(() => {
        if (ticket === navigationTicket)
          document.documentElement.classList.remove('desktop-transition');
      });
  } else renderView(next, article, push, route);
  hasRendered = true;
}
function motion() {
  document.body.classList.toggle('reduced', reduced);
  $('#motion-toggle').textContent = reduced ? 'Motion off' : 'Motion on';
  $('#motion-toggle').setAttribute('aria-pressed', String(reduced));
  journey?.setMotion(reduced);
  document.dispatchEvent(new CustomEvent('club:motion', { detail: { reduced } }));
}
const joinLink = document.querySelector('.join-link');
joinLink.href = JOIN_URL;
joinLink.removeAttribute('data-mode');
joinLink.target = '_blank';
joinLink.rel = 'noreferrer';
document.querySelector('.drive-maker-link').href = JOIN_URL;
document.querySelectorAll('[data-mode]').forEach(
  (a) =>
    (a.onclick = (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      show(a.dataset.mode);
    }),
);
$('.skip').onclick = (e) => {
  e.preventDefault();
  (mode === 'explore' ? $('#club-world') : content).focus();
};
$('#motion-toggle').onclick = () => {
  reduced = !reduced;
  motion();
  history.replaceState(
    {},
    '',
    urlFor(mode, content.dataset.article ?? null, routeFromUrl(location.href)),
  );
};
window.addEventListener('popstate', () => {
  const route = routeFromUrl(location.href);
  show(route.mode, route.article, false, route);
});
motion();
const initialRoute = routeFromUrl(location.href);
show(initialRoute.mode, initialRoute.article, false, initialRoute);

document.addEventListener('club:navigate', (e) => {
  if (typeof e.detail?.href !== 'string') return;
  let url;
  try {
    url = new URL(e.detail.href, location.href);
  } catch {
    return;
  }
  if (url.origin !== location.origin || !url.pathname.endsWith('/club.html')) return;
  const route = routeFromUrl(url);
  show(route.mode, route.article, true, route);
});
