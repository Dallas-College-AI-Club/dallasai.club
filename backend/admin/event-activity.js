import { node, time } from './ui.js';
import { actionLabel, actorLabel } from './format.js';
import { currentOfficer } from './session.js';
export function mountEventActivity(api) {
  const panel = document.getElementById('event-activity');
  const list = document.getElementById('event-activity-list');
  const status = document.getElementById('event-activity-status');
  const more = document.getElementById('event-activity-more');
  const updated = document.getElementById('event-updated');
  let current = null,
    version = 0,
    before = null,
    loaded = false,
    loading = false;
  async function load() {
    if (!current || panel.hidden || loading || (loaded && before === null))
      return;
    const requestVersion = version;
    loading = true;
    more.hidden = true;
    status.textContent = 'Loading activity…';
    try {
      const data = await api(
        '/api/events?admin=1&history=' +
          encodeURIComponent(current.id) +
          (before === null ? '' : '&before=' + before),
      );
      if (requestVersion !== version) return;
      for (const item of data.activity) {
        const row = node('li', '', 'activity-item');
        row.append(
          node('strong', actionLabel(item.action)),
          node(
            'span',
            'By ' + actorLabel(item.actor, currentOfficer()),
            'activity-actor',
          ),
          time(item.created_at),
        );
        list.append(row);
      }
      loaded = true;
      before = data.nextBefore;
      status.textContent = list.children.length
        ? ''
        : 'No office activity recorded yet. This event came from the website.';
      more.textContent = 'Load older activity';
      more.hidden = before === null;
    } catch (error) {
      if (requestVersion !== version) return;
      status.textContent = 'Could not load activity. ' + error.message;
      more.textContent = 'Try again';
      more.hidden = false;
    } finally {
      if (requestVersion === version) loading = false;
    }
  }
  panel.addEventListener('toggle', () => {
    if (panel.open && !loaded) load();
  });
  more.onclick = load;
  function clear() {
    version++;
    current = null;
    loaded = false;
    loading = false;
    before = null;
    list.replaceChildren();
    status.textContent = '';
    updated.replaceChildren();
    more.hidden = true;
    panel.hidden = true;
  }
  return {
    clear,
    show(row) {
      clear();
      current = row;
      if (row.updated_at && row.updated_by) {
        updated.append(
          document.createTextNode(
            'Last updated by ' +
              actorLabel(row.updated_by, currentOfficer()) +
              ' · ',
          ),
          time(row.updated_at),
        );
      } else
        updated.textContent = row.published
          ? 'Imported from the website · no office edits recorded yet.'
          : 'Not saved yet.';
      panel.hidden = !row.revision && !row.published;
      if (panel.open && !panel.hidden) load();
    },
  };
}
