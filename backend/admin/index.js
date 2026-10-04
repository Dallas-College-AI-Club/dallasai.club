import {
  busy,
  button,
  download,
  focusFallback,
  h,
  lock,
  menu,
  node,
  time,
  toast,
} from './ui.js';
import { mountSurveyResults } from './survey-results.js';
import { mountCustomSurveys } from './custom-surveys.js';
import { mountSurveyArchive } from './survey-archive.js';
import { mountEventEditor } from './event-editor.js';
import { mountBrowserAlerts } from './browser-alerts.js';
import { submissionActivity } from './submission-activity.js';
import { submissionEditor } from './submission-editor.js';
import {
  KINDS,
  clock,
  dateTime,
  day,
  fieldLabel,
  kindLabel,
  plural,
  statusLabel,
} from './format.js';
import * as router from './router.js';
import {
  accountChanged,
  api,
  drafts,
  isPaused,
  loadFailed,
  ready,
  startSession,
} from './session.js';
const q = (s) => document.querySelector(s);
let offset = 0,
  signedIn = false,
  sessionGeneration = 0;
// The Inbox list shown: API status, kind and event, or one submission (id).
// It comes from the route; loadedKey is the request it shows.
let view = { status: 'new', kind: '', eventId: '', id: '' },
  loadedKey = null,
  listRequest = null,
  inboxList = '#/inbox';
// The counts poll: arrivals are submissions created after `since` (the
// newest one the list has shown); alerts fire when the newest submission
// time moves on, so status changes never count as arrivals.
let since = null,
  lastLatest = null,
  lastCounts = null,
  lastPoll = 0,
  polling = false,
  newCount = 0,
  routeTitle = 'Inbox';
const latestOf = (counts) =>
  counts.reduce(
    (max, row) =>
      row.latest && (!max || Date.parse(row.latest) > Date.parse(max))
        ? row.latest
        : max,
    null,
  );
const alerts = mountBrowserAlerts(
  q('#enable-alerts'),
  q('#notification-status'),
  () => router.go('#/inbox'),
);
menu(q('#account-button'), q('#account-menu'));
// The editor's sticky action bar is a bottom bar while it shows: it joins
// --dock, so toasts sit above it and focused fields scroll clear of it.
new ResizeObserver(([entry]) =>
  document.documentElement.style.setProperty(
    '--editor-bar',
    entry.target.offsetHeight ? entry.target.offsetHeight + 12 + 'px' : '0px',
  ),
).observe(q('.primary-actions'));
q('.skip-link').onclick = (event) => {
  event.preventDefault();
  q('#main').focus();
};
const say = (text, type = 'success') => toast({ type, text });
let exporting = false;
q('#export').onclick = async (event) => {
  event.preventDefault();
  if (exporting) return;
  exporting = true;
  const generation = sessionGeneration;
  q('#export').setAttribute('aria-disabled', 'true');
  try {
    if (
      await download(q('#export').href, 'club-submissions.csv', {
        isCurrent: () => generation === sessionGeneration,
      })
    )
      say('CSV download started.');
  } catch (error) {
    if (generation === sessionGeneration) say(error.message, 'error');
  } finally {
    exporting = false;
    q('#export').removeAttribute('aria-disabled');
  }
};
// Runs only on sign-out or when a different account signs in.
function clearOffice() {
  sessionGeneration++;
  signedIn = false;
  since = lastLatest = lastCounts = loadedKey = listRequest = null;
  setNewCount(0);
  q('#arrivals').hidden = true;
  q('#inbox-updated').replaceChildren();
  q('#entries').replaceChildren();
  shownEntry = customShown = null;
  editor.clear();
  surveys.clear();
  customSurveys.clear();
  surveyArchive.clear();
  responses.clear();
}
function filters() {
  const params = new URLSearchParams();
  if (view.id) params.set('id', view.id);
  else {
    params.set('status', view.status);
    params.set('kind', view.kind);
    params.set('eventId', view.eventId);
  }
  params.set('offset', String(offset));
  return params;
}
function renderEntry(entry) {
  const card = node('details', undefined, 'entry survey-response');
  card.id = 'entry-' + entry.id;
  const heading = node('summary');
  heading.dataset.focus = '';
  heading.append(
    node('strong', entry.name || entry.email),
    node('span', entry.email),
    h('small', {}, time(entry.created_at)),
  );
  card.append(heading);
  const top = node('div', undefined, 'entry-top');
  top.append(
    node(
      'span',
      statusLabel(entry.review_status),
      'badge ' + entry.review_status,
    ),
    node('span', kindLabel(entry.kind)),
    time(entry.created_at),
  );
  card.append(top);
  if (entry.edit_revision > 0)
    card.append(
      node('p', 'Edited by an admin · ' + dateTime(entry.updated_at), 'hint'),
    );
  const address = node('a', entry.email);
  address.href = 'mailto:' + entry.email;
  card.append(
    address,
    node(
      'p',
      entry.state === 'active' ? 'Received in club inbox' : entry.state,
    ),
  );
  if (entry.kind === 'rsvp') {
    card.append(
      node('p', entry.data.eventTitle + ' · ' + day(entry.data.eventDate)),
    );
    if (entry.data.hasSurvey)
      card.append(
        button(
          'View survey answers',
          () =>
            router.go(
              '#/surveys/events/' +
                encodeURIComponent(entry.data.eventId) +
                '/r/' +
                entry.id,
            ),
          '',
        ),
      );
  }
  const details = node('details');
  details.append(node('summary', 'Submission details'));
  for (const [key, value] of Object.entries(entry.data)) {
    if (['hasSurvey', 'potential', 'eventId'].includes(key)) continue;
    details.append(
      node('strong', fieldLabel(key)),
      node('pre', key === 'eventDate' ? day(value) : String(value)),
    );
  }
  for (const file of entry.attachments) {
    const p = node('p'),
      a = node('a', `${file.name} (${Math.ceil(file.size / 1024)} KB)`);
    a.href = '/api/admin?attachment=' + encodeURIComponent(file.id);
    p.append(a);
    details.append(p);
  }
  details.append(node('p', 'Reference: ' + entry.id));
  card.append(details);
  const actions = node('div', undefined, 'entry-actions');
  actions.append(button('Edit response', () => responses.open(entry.id), ''));
  if (entry.review_status === 'closed')
    actions.append(
      button(
        'Delete permanently',
        () => responses.open(entry.id, { remove: true }),
        'danger',
      ),
    );
  // While the comment box has text, a status button also saves the note.
  const statusButtons = [];
  for (const [value, label, withNote] of [
    ['reviewed', 'Mark reviewed', 'Save note & mark reviewed'],
    ['closed', 'Archive submission', 'Save note & archive'],
    ['new', 'Mark new', 'Save note & mark new'],
  ])
    if (value !== entry.review_status) {
      const b = button(label, () => review(card, entry, value), '');
      statusButtons.push([b, label, withNote]);
      actions.append(b);
    }
  const relabel = () => {
    const note = drafts.get('note:' + entry.id);
    for (const [b, label, withNote] of statusButtons)
      b.textContent = note ? withNote : label;
  };
  card.append(actions, submissionActivity(entry, api, relabel));
  relabel();
  return card;
}
// One request saves the typed note and the new status together. The note
// box is locked meanwhile, so the sent text is the whole draft.
async function review(card, entry, value) {
  const key = 'note:' + entry.id,
    note = drafts.get(key),
    version = sessionGeneration,
    release = busy(card),
    unlock = lock(card, 'textarea');
  try {
    await api('/api/admin', {
      action: 'review',
      id: entry.id,
      status: value,
      from: entry.review_status,
      ...(note ? { comment: { id: note.id, body: note.text.trim() } } : {}),
    });
    if (note) drafts.delete(key);
    if (version !== sessionGeneration) return;
    // A card dropped while the session was paused just reports the result.
    if (card.isConnected) removeEntry(card);
    say(
      (value === 'closed'
        ? 'Submission moved to Archived. Comments and history are kept.'
        : 'Submission moved to ' + (value === 'new' ? 'New.' : 'Reviewed.')) +
        (note ? ' Your note was saved with it.' : ''),
    );
    poll();
  } catch (error) {
    if (version !== sessionGeneration) return;
    release();
    unlock();
    if (
      card.isConnected &&
      error.code === 'stale-status' &&
      error.current?.status
    ) {
      // Someone else changed it first: show the current status on this card.
      entry.review_status = error.current.status;
      const fresh = renderEntry(entry),
        open = [card, ...card.querySelectorAll('details')].map((d) => d.open);
      [fresh, ...fresh.querySelectorAll('details')].forEach((d, index) => {
        d.open = open[index] || false;
      });
      card.replaceWith(fresh);
      fresh.querySelector('summary').focus();
    }
    say(error.message, 'error');
  }
}
// Removes a card in place; focus moves to the next card, never to <body>.
function removeEntry(card) {
  const group = card.closest('.inbox-group');
  focusFallback(card, q('#entries'));
  card.remove();
  const left = group?.querySelectorAll('.entry').length;
  if (group && !left) group.remove();
  else if (group)
    group.querySelector(':scope > summary').textContent =
      group.dataset.label + ' · ' + left + ' on this page';
  if (!q('#entries').children.length)
    q('#entries').append(node('p', 'No submissions match these filters.'));
}
function groupedEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.data.eventId
      ? 'event:' + entry.data.eventId
      : 'kind:' + entry.kind;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups].map(([key, rows]) => {
    const group = node('details', undefined, 'survey-event-group inbox-group');
    group.dataset.group = key;
    group.dataset.label =
      rows[0].data.eventTitle || kindLabel(rows[0].kind, 'plural');
    group.open = true;
    group.append(
      node(
        'summary',
        group.dataset.label + ' · ' + rows.length + ' on this page',
      ),
      ...rows.map(renderEntry),
    );
    return group;
  });
}
// The badge, the title, the per-kind counts and the setup notice. Both the
// list and the counts poll call this; it never touches the list itself.
function updateCounts(data) {
  setNewCount(data.counts.reduce((sum, row) => sum + row.new, 0));
  q('#counts').replaceChildren(
    ...KINDS.map((kind) => {
      const count = data.counts.find((x) => x.kind === kind) || {
          new: 0,
          total: 0,
        },
        box = node('div', undefined, 'count');
      box.append(
        node('span', kindLabel(kind, 'plural')),
        node('strong', count.new.toLocaleString('en-US')),
        node('small', `new · ${count.total.toLocaleString('en-US')} total`),
      );
      return box;
    }),
  );
  const missing = Object.entries(data.configured)
    .filter(([, value]) => !value)
    .map(([key]) => ({ uploads: 'Image uploads' })[key] || key);
  const setup = missing.length
    ? missing.join(', ') + ' aren’t set up on this deployment.'
    : '';
  q('#configuration').hidden = !setup;
  q('#configuration').textContent = setup;
  q('#help-setup-status').textContent = setup || 'Everything is set up.';
  q('#account-button').classList.toggle('needs-setup', Boolean(setup));
}
function setNewCount(count) {
  newCount = count;
  const badge = q('#nav-new-count');
  badge.hidden = !count;
  badge.replaceChildren(
    count.toLocaleString('en-US'),
    node('span', ' new', 'visually-hidden'),
  );
  setTitle();
}
// People's names never go into titles: they land in browser history.
function setTitle() {
  document.title =
    (signedIn && newCount > 0 ? '(' + newCount + ') ' : '') +
    (signedIn ? routeTitle + ' · ' : '') +
    'Club Office';
}
function updated(error) {
  q('#inbox-updated').replaceChildren(
    ...(error
      ? ['Couldn’t update · ', button('Retry', poll, 'btn-quiet')]
      : ['Updated ' + clock(new Date())]),
  );
}
// Loads the Inbox list for the current filters. A second call for the same
// filters joins the request already running.
function load() {
  const key = filters().toString();
  if (listRequest?.key === key) return listRequest.promise;
  const request = { key, promise: fetchList(key) };
  listRequest = request;
  request.promise.finally(() => {
    if (listRequest === request) listRequest = null;
  });
  return request.promise;
}
async function fetchList(key) {
  const generation = sessionGeneration;
  q('#entries').setAttribute('aria-busy', 'true');
  q('#refresh').setAttribute('aria-busy', 'true');
  try {
    const data = await api('/api/admin?' + key);
    if (generation !== sessionGeneration || filters().toString() !== key)
      return;
    // Another tab signed in as someone else: never show their data here.
    if (signedIn && accountChanged(data.user)) return;
    if (!data.entries.length && offset > 0) {
      offset = Math.max(0, offset - 50);
      return load();
    }
    if (!signedIn) {
      signedIn = true;
      ready(data.user);
    }
    loadedKey = key;
    lastPoll = Date.now();
    since = latestOf(data.counts) || since;
    lastLatest ??= Date.parse(since) || 0;
    lastCounts ??= data.counts;
    q('#arrivals').hidden = true;
    toast.resolve('inbox-load');
    updateCounts(data);
    updated();
    const eventSelect = q('#filters [name="eventId"]'),
      past = view.kind === 'rsvp-past';
    eventSelect.replaceChildren(
      new Option(past ? 'All past events' : 'All upcoming events', ''),
      ...(data.events || [])
        .filter((e) => Boolean(e.past) === past)
        .map((e) => new Option(e.title + ' · ' + day(e.date), e.id)),
    );
    eventSelect.value = view.eventId;
    const expanded = new Map(
      [...q('#entries').querySelectorAll('[id^="entry-"]')].map((card) => [
        card.id,
        [
          card.open,
          ...[...card.querySelectorAll('details')].map((panel) => panel.open),
        ],
      ]),
    );
    const groupStates = new Map(
      [...q('#entries').querySelectorAll('[data-group]')].map((group) => [
        group.dataset.group,
        group.open,
      ]),
    );
    q('#entries').replaceChildren(
      ...(data.entries.length
        ? groupedEntries(data.entries)
        : [
            node(
              'p',
              view.id
                ? 'This submission no longer exists or the link is incomplete.'
                : 'No submissions match these filters.',
            ),
          ]),
    );
    for (const group of q('#entries').querySelectorAll('[data-group]'))
      group.open = groupStates.get(group.dataset.group) ?? true;
    for (const card of q('#entries').querySelectorAll('[id^="entry-"]')) {
      card.open = expanded.get(card.id)?.[0] || false;
      [...card.querySelectorAll('details')].forEach((panel, index) => {
        panel.open = expanded.get(card.id)?.[index + 1] || false;
      });
    }
    q('#previous').disabled = offset === 0;
    q('#next').disabled = !data.hasMore;
    q('#page').textContent = 'Page ' + (offset / 50 + 1);
    q('#export').href = '/api/admin?' + filters() + '&export=csv';
    surveyArchive.load(filters());
    // A submission's own address opens its card.
    const card = view.id && document.getElementById('entry-' + view.id);
    if (card) {
      selectInboxStatus(data.entries[0].review_status);
      card.open = true;
      card.querySelector('details').open = true;
      card.scrollIntoView({ block: 'center' });
    }
  } catch (error) {
    if (generation !== sessionGeneration) return;
    if (!signedIn) loadFailed(error);
    else
      toast({
        type: 'error',
        key: 'inbox-load',
        text: error.message,
        action: { label: 'Retry', run: load },
      });
  } finally {
    if (generation === sessionGeneration) {
      q('#refresh').removeAttribute('aria-busy');
      q('#entries').setAttribute('aria-busy', 'false');
    }
  }
}
// The background poll: counts only. It updates the badge, the title, the
// counts, the arrivals button and browser alerts, and never touches the
// list, an open card or an editor, or moves focus. Failures only change
// the 'Updated' line.
async function poll() {
  if (!signedIn || isPaused() || polling) return;
  polling = true;
  const generation = sessionGeneration,
    params = new URLSearchParams({ counts: '1' });
  if (since) params.set('since', since);
  if (!view.id)
    for (const [key, value] of [
      ['status', view.status],
      ['kind', view.kind],
      ['eventId', view.eventId],
    ])
      if (value) params.set(key, value);
  try {
    const data = await api('/api/admin?' + params);
    if (generation !== sessionGeneration || accountChanged(data.user)) return;
    lastPoll = Date.now();
    since ??= data.asOf;
    updateCounts(data);
    const latest = Date.parse(data.latest) || 0;
    if (lastLatest !== null && latest > lastLatest)
      alerts.notify(arrivals(data.counts));
    lastLatest = Math.max(lastLatest ?? 0, latest);
    lastCounts = data.counts;
    const pill = q('#arrivals');
    pill.hidden = !data.arrivedInView || Boolean(view.id);
    pill.textContent = plural(data.arrivedInView, 'new submission') + ' · Show';
    updated();
  } catch (error) {
    if (generation === sessionGeneration) updated(error);
  } finally {
    polling = false;
  }
}
// '3 new: 2 questions, 1 signup', from the counts since the last poll.
function arrivals(counts) {
  const lower = (word) => (/^[A-Z]{2}/.test(word) ? word : word.toLowerCase());
  const parts = counts
    .map((row) => [
      row.total -
        (lastCounts?.find((before) => before.kind === row.kind)?.total ??
          row.total),
      row.kind,
    ])
    .filter(([n]) => n > 0);
  const total = parts.reduce((sum, [n]) => sum + n, 0);
  return total
    ? total.toLocaleString('en-US') +
        ' new: ' +
        parts
          .map(([n, kind]) =>
            plural(n, lower(kindLabel(kind)), lower(kindLabel(kind, 'plural'))),
          )
          .join(', ')
    : 'New submissions are waiting in the Inbox.';
}
q('#arrivals').onclick = () => {
  q('#inbox-pane [data-focus-fallback]').focus();
  q('#arrivals').hidden = true;
  offset = 0;
  load();
};
setInterval(() => {
  if (!document.hidden || alerts.enabled) poll();
}, 60000);
// Coming back to the tab checks at once when the last check is stale.
const pollIfStale = () => {
  if (!document.hidden && Date.now() - lastPoll > 15000) poll();
};
document.addEventListener('visibilitychange', pollIfStale);
window.addEventListener('focus', pollIfStale);
function selectInboxStatus(value) {
  document.querySelectorAll('[data-inbox-status]').forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.inboxStatus === value),
    );
  });
}
// Filters live in the address (replaceState), so Back and reload keep them.
const showList = (changes) =>
  router.go(
    router.build('inbox', {
      status: router.routeStatus(view.status),
      type: view.kind,
      event: view.eventId,
      ...changes,
    }),
    { replace: true },
  );
for (const button of document.querySelectorAll('[data-inbox-status]'))
  button.onclick = () => {
    if (button.getAttribute('aria-pressed') === 'true' && !view.id) return;
    showList({ status: router.routeStatus(button.dataset.inboxStatus) });
  };
q('#filters').onsubmit = (event) => event.preventDefault();
q('#filters [name="kind"]').onchange = (event) =>
  showList({ type: event.target.value, event: '' });
q('#filters [name="eventId"]').onchange = (event) =>
  showList({ event: event.target.value });
q('#refresh').onclick = async () => {
  await load();
  poll();
};
q('#previous').onclick = () => {
  offset = Math.max(0, offset - 50);
  load();
};
q('#next').onclick = () => {
  offset += 50;
  load();
};
const editor = mountEventEditor(api);
const responses = submissionEditor(api, async (result) => {
  if (result.removed) drafts.delete('note:' + result.entryId);
  await load();
  // The list was rebuilt under the closed dialog: focus the response's
  // Edit button again, or the list when it is gone.
  if (document.activeElement === document.body) {
    const card = document.getElementById('entry-' + result.entryId),
      edit = card?.querySelector('.entry-actions button');
    (edit?.checkVisibility()
      ? edit
      : card?.querySelector('summary') || q('#inbox-pane [data-focus-fallback]')
    ).focus();
  }
  say(
    result.removed
      ? result.filesCleaned === false
        ? 'Response deleted. Attachment removal is queued for retry.'
        : 'Response permanently deleted.'
      : 'Response updated.',
  );
});
// A deleted response or a purged contact changed the inbox. Contact purge
// removes that person's drafts itself; other drafts stay.
const surveys = mountSurveyResults(
  api,
  (result) => {
    offset = 0;
    if (result?.removed) drafts.delete('note:' + result.entryId);
    load();
  },
  // New filters replaced a single response: drop it from the address, but
  // only while that response is still the page shown (the search waits
  // 250 ms, and the officer may have moved on).
  () => {
    shownEntry = '';
    if (router.route().name.startsWith('surveys/events/'))
      router.go('#/surveys/events', { replace: true });
  },
);
const customSurveys = mountCustomSurveys(q('#custom-surveys-root'), api);
const surveyArchive = mountSurveyArchive(q('#archived-survey-questions'), api);
// Surveys: the sub-section and what each one shows.
let surveysSub = 'events',
  shownEntry = null,
  customShown = null;
// Each section: its pane, enter(route) and leave(next) → false to stay.
const sections = {
  inbox: {
    pane: q('#inbox-pane'),
    enter(route) {
      const next = {
        status: router.apiStatus(route.query.status),
        kind: route.query.type || '',
        eventId: route.query.event || '',
        id: route.params.id || '',
      };
      if (JSON.stringify(next) !== JSON.stringify(view)) offset = 0;
      view = next;
      if (!view.id) inboxList = router.build('inbox', route.query);
      selectInboxStatus(view.status);
      q('#filters [name="kind"]').value = view.kind;
      q('#filters [name="eventId"]').value = view.eventId;
      q('#event-filter-label').hidden = !['rsvp', 'rsvp-past'].includes(
        view.kind,
      );
      if (filters().toString() !== loadedKey) {
        q('#arrivals').hidden = true;
        load();
      }
    },
  },
  events: {
    pane: q('#events-pane'),
    // Entering Events always refreshes the list; the editor keeps its form.
    enter: () => editor.show(),
    leave: (next) => next.section === 'events' || editor.leave(),
  },
  surveys: {
    pane: q('#surveys-pane'),
    enter(route) {
      if (route.name === 'surveys')
        return router.go('#/surveys/' + surveysSub, { replace: true });
      const custom = route.name.startsWith('surveys/custom');
      surveysSub = custom ? 'custom' : 'events';
      q('#custom-surveys-root').hidden = !custom;
      q('#event-surveys-root').hidden = custom;
      for (const [link, current] of [
        [q('#custom-surveys-group'), custom],
        [q('#event-surveys-group'), !custom],
      ])
        if (current) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      if (custom) {
        const id = route.params.id || '';
        if (customShown === id && q('#custom-surveys-root').childNodes.length)
          return;
        customShown = id;
        if (id) customSurveys.show(id);
        else customSurveys.load();
        return;
      }
      const entry = route.params.entryId || '';
      if (shownEntry === entry) return;
      shownEntry = entry;
      surveys.show(entry);
    },
    // Leaving a custom survey asks its unsaved builder first.
    leave: () =>
      !router.route().name.startsWith('surveys/custom') ||
      customSurveys.leave(),
  },
  help: {
    pane: q('#help-pane'),
    enter(route) {
      if (route.query.topic)
        q('#help-' + route.query.topic)?.scrollIntoView({ block: 'start' });
    },
  },
  'not-found': {
    pane: q('#not-found'),
    enter(route) {
      q('#not-found-message').textContent = route.message;
    },
  },
};
const titles = {
  inbox: 'Inbox',
  'inbox/:id': 'Submission · Inbox',
  events: 'Events',
  surveys: 'Surveys',
  'surveys/events': 'Event surveys · Surveys',
  'surveys/events/:eventId/r/:entryId': 'Response · Event surveys',
  'surveys/custom': 'Custom surveys · Surveys',
  'surveys/custom/:id': 'Custom survey · Surveys',
  help: 'Help',
  'not-found': 'Page not found',
};
const sectionNames = {
  inbox: 'Inbox',
  events: 'Events',
  surveys: 'Surveys',
  help: 'Help',
  'not-found': 'Not found',
};
// Nav state for the route: aria-current, and each link's address. A link
// reopens its section's last page; the current section's link goes back to
// its list with the filters kept.
function onRender(route, from) {
  if (from && from.section !== route.section) toast.dismissPassing();
  routeTitle = titles[route.name];
  setTitle();
  q('#app-title').textContent = sectionNames[route.section];
  const roots = {
    inbox: route.name === 'inbox' ? router.lastRoute('inbox') : inboxList,
    events: '#/events',
    surveys:
      '#/surveys/' +
      (route.name.startsWith('surveys/custom') ? 'custom' : 'events'),
    help: '#/help',
  };
  for (const [name, root] of Object.entries(roots)) {
    const link = q('#' + name + '-tab'),
      current = route.section === name || route.from === name;
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    link.setAttribute(
      'href',
      (current ? root : router.lastRoute(name)) || '#/' + name,
    );
  }
}
// Opens the office: the first load, a retry, or after signing in. The list
// load decides whether the office opens.
let started = false;
function open() {
  if (started) router.refresh();
  else {
    started = true;
    router.start({ sections, onRender });
  }
  return load();
}
startSession({
  load: open,
  // After signing in again: the counts refresh; lists rebuild only when
  // their records were dropped, so open cards, reports and drafts stay.
  refresh(dropped) {
    poll();
    if (!dropped) return;
    load();
    const route = router.route();
    if (route.section === 'events') editor.show();
    else if (route.section !== 'surveys') return;
    else if (surveysSub === 'events') surveys.reload();
    else customSurveys.refresh();
  },
  // Ten minutes paused: drop member records, keep editors and drafts.
  reset() {
    q('#entries').replaceChildren();
    loadedKey = null;
    editor.reset();
    surveys.reset();
    customSurveys.reset();
    surveyArchive.clear();
  },
  clear: clearOffice,
});
