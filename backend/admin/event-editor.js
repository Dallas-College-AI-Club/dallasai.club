const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const blank = () => ({
  title: '',
  category: 'Club event',
  date: '',
  startTime: '',
  endDate: '',
  endTime: '',
  location: '',
  meetingUrl: '',
  summary: '',
  agenda: [],
  preparation: [],
  targetAudience: '',
  learningOutcomes: [],
  registrationOpen: true,
});

export function mountEventEditor(api) {
  const q = (s) => document.querySelector(s);
  const form = q('#event-form');
  let rows = [],
    current = null,
    saved = '',
    busy = false,
    generation = 0;
  const say = (message = '') => {
    q('#event-status').textContent = message;
  };
  function values() {
    const content = Object.fromEntries(new FormData(form));
    content.registrationOpen = form.elements.registrationOpen.checked;
    return content;
  }
  const dirty = () => current && JSON.stringify(values()) !== saved;
  const canLeave = () =>
    !busy && (!dirty() || confirm('Discard your unsaved event changes?'));
  const state = (row) =>
    !row.published
      ? 'Draft · not visible on the website'
      : row.revision === row.published_revision
        ? 'Published'
        : 'Published · draft changes waiting';
  function list() {
    const search = q('#event-search').value.toLowerCase().trim();
    const matches = rows.filter((r) =>
      r.draft.title.toLowerCase().includes(search),
    );
    q('#event-list').replaceChildren(
      ...matches.map((row) => {
        const button = node('button', undefined, 'event-choice');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(row.id === current?.id));
        button.append(
          node('strong', row.draft.title),
          node('span', row.draft.date || 'Date to be decided'),
          node('small', state(row)),
        );
        button.onclick = () => {
          if (canLeave()) edit(row);
        };
        return button;
      }),
    );
    if (!matches.length)
      q('#event-list').append(node('p', 'No matching events.'));
  }
  function edit(row) {
    current = row;
    form.hidden = false;
    q('#event-empty').hidden = true;
    q('#event-preview').hidden = true;
    for (const [key, value] of Object.entries({ ...blank(), ...row.draft })) {
      const input = form.elements.namedItem(key);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = value !== false;
      else input.value = Array.isArray(value) ? value.join('\n') : value || '';
    }
    saved = JSON.stringify(values());
    q('#event-heading').textContent =
      row.revision || row.published ? 'Edit event' : 'New event';
    q('#event-state').textContent = state(row);
    q('#unpublish-event').hidden = !row.published;
    q('#view-event').hidden = !row.published;
    q('#view-event').href =
      'https://dallasai.club/club.html?mode=events&event=' +
      encodeURIComponent(row.id);
    list();
    say();
  }
  function newEvent(content = blank()) {
    edit({
      id: 'event-' + crypto.randomUUID(),
      revision: 0,
      published_revision: 0,
      published: null,
      draft: content,
    });
    form.elements.title.focus();
  }
  async function load() {
    const version = generation;
    say('Loading events…');
    try {
      const data = await api('/api/events?admin=1');
      if (version !== generation) return;
      rows = data.events;
      list();
      say();
    } catch (e) {
      if (version === generation) say(e.message);
    }
  }
  function preview(event) {
    const box = q('#event-preview');
    const date = event.date
      ? new Intl.DateTimeFormat('en-US', {
          dateStyle: 'full',
          ...(event.date.includes('T') ? { timeStyle: 'short' } : {}),
          timeZone: 'America/Chicago',
        }).format(
          new Date(
            event.date.includes('T')
              ? event.date
              : event.date + 'T12:00:00-06:00',
          ),
        )
      : 'Date to be decided';
    box.replaceChildren(
      node('p', 'PREVIEW · ' + event.category, 'eyebrow'),
      node('h2', event.title),
      node('p', date + (event.date ? ' · Central' : '')),
      node('p', event.location),
      node('p', event.summary, 'event-description'),
    );
    if (event.targetAudience)
      box.append(
        node('h3', 'Who is this for?'),
        node('p', event.targetAudience),
      );
    for (const [title, items] of [
      ['Learning outcomes', event.learningOutcomes],
      ['On the agenda', event.agenda],
      ['Before you come', event.preparation],
    ]) {
      if (!items.length) continue;
      const ul = node('ul');
      ul.append(...items.map((item) => node('li', item)));
      box.append(node('h3', title), ul);
    }
    if (event.meetingUrl) {
      const a = node('a', 'Open meeting link ↗');
      a.href = event.meetingUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      box.append(a);
    }
    box.append(
      node(
        'p',
        event.registrationOpen
          ? 'RSVPs open for upcoming events.'
          : 'RSVPs closed.',
        'hint',
      ),
    );
    box.hidden = false;
    box.focus();
  }
  async function save(action) {
    if (busy || !current) return;
    busy = true;
    const version = generation;
    // FormData excludes disabled fields, so collect before locking the form.
    const body = {
      action,
      id: current.id,
      revision: current.revision,
      event: values(),
    };
    const controls = [...form.querySelectorAll('input,textarea,button')];
    controls.forEach((input) => {
      input.disabled = true;
    });
    say(action === 'preview' ? 'Preparing preview…' : 'Saving…');
    try {
      const data = await api('/api/events', body);
      if (version !== generation) return;
      if (action === 'preview') {
        preview(data.event);
        say('Preview only. Your changes have not been saved.');
      } else {
        rows = [data.event, ...rows.filter((r) => r.id !== data.event.id)];
        // Re-enable before computing the saved FormData.
        controls.forEach((input) => {
          input.disabled = false;
        });
        edit(data.event);
        say(
          action === 'publish'
            ? 'Published. The website will show this event on its next refresh.'
            : action === 'unpublish'
              ? 'Unpublished. Your draft and existing RSVPs are kept.'
              : 'Draft saved. The website has not changed.',
        );
      }
    } catch (e) {
      if (version === generation) say(e.message);
    } finally {
      busy = false;
      controls.forEach((input) => {
        input.disabled = false;
      });
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    save(event.submitter?.value || 'draft');
  };
  q('#new-event').onclick = () => {
    if (canLeave()) newEvent();
  };
  q('#duplicate-event').onclick = () => {
    if (!canLeave()) return;
    newEvent({ ...values(), title: values().title + ' (copy)' });
  };
  q('#unpublish-event').onclick = () => {
    if (busy || !current?.published) return;
    if (
      confirm(
        'Remove this event from the public calendar? Existing RSVPs will be kept. Unsaved edits will be discarded.',
      )
    )
      save('unpublish');
  };
  q('#reload-events').onclick = async () => {
    if (!canLeave()) return;
    const id = current?.id;
    await load();
    const updated = rows.find((r) => r.id === id);
    if (updated) edit(updated);
  };
  q('#event-search').oninput = list;
  window.addEventListener('beforeunload', (event) => {
    if (dirty() || busy) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  return {
    show: load,
    canLeave,
    clear() {
      generation++;
      current = null;
      rows = [];
      saved = '';
      form.reset();
      form.hidden = true;
      q('#event-empty').hidden = false;
      q('#event-list').replaceChildren();
      q('#event-preview').replaceChildren();
      q('#event-preview').hidden = true;
      say();
    },
  };
}
