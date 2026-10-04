// Hash routes: '#/inbox?status=reviewed', '#/surveys/custom/<id>'. The query
// lives inside the hash, defaults are left out, and free text or email
// addresses never appear. parse(), build() and legacy() are pure, so
// node --test covers them; start() wires them to the page.
import { KINDS } from './format.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  slug = /^[a-z0-9][a-z0-9-]{0,99}$/;
// The values each query key may take; anything else is dropped.
const queries = {
  surveys: { event: slug, copy: uuid },
  inbox: {
    status: ['reviewed', 'archived', 'all'],
    type: [...KINDS, 'rsvp-past', 'rsvp-all'],
    event: slug,
  },
  help: {
    topic: [
      'submissions',
      'statuses',
      'sessions',
      'exports',
      'alerts',
      'setup',
      'privacy',
    ],
  },
};
function cleanQuery(section, search) {
  const allowed = queries[section] || {},
    query = {};
  for (const [key, value] of new URLSearchParams(search))
    if (
      allowed[key] &&
      (Array.isArray(allowed[key])
        ? allowed[key].includes(value)
        : allowed[key].test(value))
    )
      query[key] = value;
  return query;
}
const notFound = (section, message) => ({
  name: 'not-found',
  section: 'not-found',
  from: section,
  message,
  params: {},
  query: {},
});
// '#/surveys/custom/<id>?x=1' → { name: 'surveys/custom/:id', section:
// 'surveys', params: { id }, query: {} }. Ids are checked here, so a bad id
// never reaches the server.
export function parse(hash) {
  const [path, search = ''] = hash.replace(/^#?\/?/, '').split('?'),
    parts = path.split('/').filter(Boolean),
    [section = 'home'] = parts,
    route = (name, params = {}) => ({
      name,
      section,
      params,
      query: cleanQuery(section, search),
    });
  const [, a, b, c, d] = parts,
    n = parts.length;
  if (section === 'home' && n === 1) return route('home');
  if (section === 'inbox' && n === 1) return route('inbox');
  if (section === 'inbox' && n === 2)
    return uuid.test(a)
      ? route('inbox/:id', { id: a.toLowerCase() })
      : notFound(
          'inbox',
          'This submission no longer exists or the link is incomplete.',
        );
  if (section === 'events' && n === 1) return route('events');
  if (section === 'contacts' && n === 1) return route('contacts');
  if (section === 'help' && n === 1) return route('help');
  if (section === 'help' && n === 2) {
    if (['archived', 'activity'].includes(a)) return route('help/' + a);
    return uuid.test(a)
      ? route('help/:id', { id: a.toLowerCase() })
      : notFound(
          'help',
          'This topic link is incomplete. Open Help to find a topic.',
        );
  }
  if (section === 'surveys' && n === 1) return route('surveys');
  if (section === 'surveys' && a === 'new' && n === 2)
    return route('surveys/new');
  if (section === 'surveys' && a === 'events') {
    if (n === 2) return route('surveys/events');
    if (n === 5 && c === 'r' && slug.test(b) && uuid.test(d))
      return route('surveys/events/:eventId/r/:entryId', {
        eventId: b,
        entryId: d.toLowerCase(),
      });
    if (n === 5 && c === 'r')
      return notFound(
        'surveys',
        'This response no longer exists or the link is incomplete.',
      );
  }
  if (section === 'surveys' && a === 'custom') {
    if (n === 2) return route('surveys/custom');
    if (n === 3)
      return uuid.test(b)
        ? route('surveys/custom/:id', { id: b.toLowerCase() })
        : notFound(
            'surveys',
            'This survey no longer exists or the link is incomplete.',
          );
  }
  return notFound(section, 'There is no page at this address.');
}
// build('inbox', { status: 'reviewed', type: '' }) → '#/inbox?status=reviewed'.
export function build(path, query = {}) {
  const search = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value),
  ).toString();
  return '#/' + path + (search ? '?' + search : '');
}
// Old links keep working: each is rewritten to its route, or null when the
// hash is already a route (or unknown, which shows 'not found').
export function legacy(hash) {
  const value = hash.replace(/^#/, '');
  if (!value || value === '/') return '#/home';
  if (value.startsWith('/')) return null;
  if (value === 'events') return '#/events';
  if (value === 'surveys') return '#/surveys';
  // Archived survey answers are listed under Inbox › Archived › Questions.
  if (value === 'archived-survey-questions')
    return build('inbox', { status: 'archived', type: 'question' });
  const [key, id = ''] = value.split('=');
  if (key === 'entry' || key === 'survey')
    return build('inbox/' + encodeURIComponent(id), { status: 'all' });
  if (key === 'custom-survey')
    return build('surveys/custom/' + encodeURIComponent(id));
  return null;
}
// The Inbox 'Archived' view is the API status 'closed'; New is the default.
export const apiStatus = (status) =>
  ({ reviewed: 'reviewed', archived: 'closed', all: '' })[status] ?? 'new';
export const routeStatus = (status) =>
  ({ reviewed: 'reviewed', closed: 'archived', '': 'all' })[status] ?? '';

// --- The page ---------------------------------------------------------------
// seq numbers history entries in order, so a refused Back or Forward knows
// which way to step to undo itself.
let sections,
  onRender,
  current = null,
  href = '',
  seq = 0;
const memory = new Map(), // route hash → { scroll, focus }
  last = {}; // section → its last route hash
export const route = () => current;
export const lastRoute = (section) => last[section];
const visible = (element) =>
  element?.isConnected && element.getClientRects().length > 0;
// The view heading (h1, tabindex=-1) of the shown section.
function focusHeading() {
  const pane = current && sections[current.section]?.pane;
  pane?.querySelector('h1')?.focus({ preventScroll: true });
}
// Leaves the current route only when its section agrees (a dirty editor asks
// first). A drafted note never blocks.
const canLeave = (next) =>
  !current || sections[current.section].leave?.(next) !== false;
// Shows the route's section and enters it. Switching pages restores that
// page's scroll; Back also restores the control that had focus, otherwise
// focus moves to the view heading.
async function render(hash, { restore = false, focus = true } = {}) {
  const from = current,
    next = parse(hash),
    switching =
      !from || from.section !== next.section || from.name !== next.name;
  if (from) {
    const active = document.activeElement;
    memory.set(href, {
      scroll: scrollY,
      focus: sections[from.section].pane.contains(active) ? active : null,
    });
  }
  current = next;
  href = hash;
  if (next.section !== 'not-found') last[next.section] = hash;
  for (const [name, section] of Object.entries(sections))
    section.pane.hidden = name !== next.section;
  const remembered = (restore || switching) && memory.get(hash);
  if (switching && from && !remembered) scrollTo(0, 0);
  onRender(next, from);
  await sections[next.section].enter?.(next, from);
  if (current !== next) return;
  if (remembered) scrollTo(0, remembered.scroll);
  if (!focus) return;
  if (restore && visible(remembered?.focus))
    remembered.focus.focus({ preventScroll: true });
  else if (switching) focusHeading();
}
// pushState for sections and records; replace for filters and rewrites.
export function go(hash, { replace = false } = {}) {
  if (hash === href) return;
  const next = parse(hash);
  if (!canLeave(next)) return;
  if (replace) history.replaceState({ seq }, '', hash);
  else history.pushState({ seq: ++seq }, '', hash);
  return render(hash);
}
// Re-enters the current route, e.g. after signing in again; focus stays.
export const refresh = () => render(href, { focus: false });
function onHashChange() {
  const rewritten = legacy(location.hash);
  if (rewritten) history.replaceState(history.state, '', rewritten);
  const hash = rewritten || location.hash;
  if (hash === href) return;
  // Back, Forward or a typed link (a new entry, without seq). A refused leave
  // steps back to the page still shown, which keeps both entries; arriving
  // there fires a hashchange for the current address, which does nothing.
  const to = history.state?.seq;
  if (!canLeave(parse(hash))) {
    history.go(to === undefined || to > seq ? -1 : 1);
    return;
  }
  if (to === undefined) history.replaceState({ seq: ++seq }, '', hash);
  else seq = to;
  render(hash, { restore: true });
}
// sections: { name: { pane, enter(route, from), leave(next) } }. onRender
// runs before enter(): nav state, title.
export function start(options) {
  ({ sections, onRender } = options);
  const hash = legacy(location.hash) || location.hash;
  seq = history.state?.seq ?? 0;
  history.replaceState({ seq }, '', hash);
  window.addEventListener('hashchange', onHashChange);
  // In-app links go through go(), so every page gets a history entry with
  // its place remembered. Modified clicks open a new tab as usual.
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href^="#/"]');
    if (
      !link ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      link.target
    )
      return;
    event.preventDefault();
    go(link.getAttribute('href'));
  });
  return render(hash, { focus: false });
}
