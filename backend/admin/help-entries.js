import { button, busy, confirmDialog, copyText, h, node, toast } from './ui.js';
import { actionLabel, actorLabel, dateTime } from './format.js';
import { currentOfficer, drafts } from './session.js';
import * as router from './router.js';
const q = (s) => document.querySelector(s);
const categories = {
  everyday: 'Everyday tasks',
  essentials: 'Office essentials',
};
const oldTopics = {
  statuses: '101',
  submissions: '105',
  exports: '104',
  sessions: '106',
  alerts: '107',
  setup: '108',
  privacy: '109',
};
const topicLink = (id) => '#/help/' + id;
// Plain text stays text, including anything that resembles HTML.
export function paragraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lines = part.split('\n');
      if (lines.every((line) => /^\d+\.\s+/.test(line)))
        return h(
          'ol',
          { className: 'help-steps' },
          ...lines.map((line) => node('li', line.replace(/^\d+\.\s+/, ''))),
        );
      return node('p', part, 'help-entry-text');
    });
}
export function mountHelpEntries(api) {
  const form = q('#help-form'),
    status = q('#help-officer-status'),
    add = q('#help-add'),
    article = q('#help-article');
  let editing = null,
    entries = [],
    generation = 0,
    category = 'everyday',
    saving = false,
    historyVersion = 0;
  const draftKey = () => 'help:' + editing.id;
  const actor = (value) =>
    value === 'club-office'
      ? 'Club Office'
      : actorLabel(value, currentOfficer());
  const dirty = () => editing && Boolean(drafts.get(draftKey()));
  function remember() {
    if (!editing) return;
    const title = form.elements['help-title'].value,
      body = form.elements['help-body'].value;
    if (
      title !== editing.title ||
      body !== editing.body ||
      category !== editing.category
    )
      drafts.set(
        draftKey(),
        { title, body, category },
        'Help topic “' + (title.trim() || 'Untitled') + '”',
      );
    else drafts.delete(draftKey());
  }
  function stop() {
    if (editing) drafts.delete(draftKey());
    editing = null;
    form.reset();
    form.hidden = true;
    article.hidden = false;
  }
  function leave() {
    if (
      saving ||
      (dirty() && !confirm('Discard your unsaved Help topic changes?'))
    )
      return false;
    stop();
    return true;
  }
  function setCategory(value) {
    category = value;
    for (const control of form.querySelectorAll('[data-category]'))
      control.setAttribute(
        'aria-pressed',
        String(control.dataset.category === value),
      );
  }
  function start(entry) {
    if (!leave()) return;
    editing = entry || {
      id: crypto.randomUUID(),
      title: '',
      body: '',
      category: 'everyday',
    };
    form.elements['help-title'].value = editing.title;
    form.elements['help-body'].value = editing.body;
    setCategory(editing.category);
    q('#help-form-heading').textContent = entry ? 'Edit topic' : 'New topic';
    form.hidden = false;
    article.hidden = true;
    form.elements['help-title'].focus();
  }
  form.addEventListener('input', remember);
  for (const control of form.querySelectorAll('[data-category]'))
    control.onclick = () => {
      setCategory(control.dataset.category);
      remember();
    };
  add.onclick = () => start();
  form.querySelector('[data-cancel]').onclick = () => {
    if (leave()) add.focus();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    const version = generation,
      release = busy(form);
    try {
      const { entry } = await api('/api/admin', {
        action: 'help-save',
        id: editing.id,
        title: form.elements['help-title'].value,
        body: form.elements['help-body'].value,
        category,
        ...(editing.revision ? { revision: editing.revision } : {}),
      });
      if (version !== generation) return;
      stop();
      saving = false;
      toast({ text: 'Help topic “' + entry.title + '” saved.' });
      if (router.route()?.params.id === entry.id) await load();
      else await router.go(topicLink(entry.id));
      article.querySelector('h2')?.focus();
    } catch (error) {
      if (version === generation) toast({ type: 'error', text: error.message });
    } finally {
      saving = false;
      release();
    }
  };
  async function change(entry, action) {
    if (saving) return;
    if (
      action === 'help-delete' &&
      !(await confirmDialog({
        title: 'Delete “' + entry.title + '” permanently?',
        body: 'The topic text will be removed. Its action history stays in Activity. This can’t be undone.',
        confirmLabel: 'Delete topic',
        tone: 'danger',
      }))
    )
      return;
    saving = true;
    const version = generation,
      release = busy(article);
    try {
      await api('/api/admin', {
        action,
        id: entry.id,
        revision: entry.revision,
      });
      if (version !== generation) return;
      saving = false;
      toast({
        text:
          'Topic ' +
          {
            'help-archive': 'archived.',
            'help-restore': 'restored.',
            'help-delete': 'deleted.',
          }[action],
      });
      if (action === 'help-delete') await router.go('#/help/archived');
      else await load();
      article.querySelector('h2')?.focus();
    } catch (error) {
      if (version === generation) toast({ type: 'error', text: error.message });
    } finally {
      saving = false;
      release();
    }
  }
  async function historyInto(container, id) {
    const version = ++historyVersion;
    const list = node('ol'),
      more = button('Show earlier activity', () => fetchPage(next));
    let next = null;
    container.replaceChildren(
      node('h3', id === 'all' ? 'Topic activity' : 'History'),
      list,
      more,
    );
    async function fetchPage(before) {
      more.disabled = true;
      try {
        const data = await api(
          '/api/admin?helpHistory=' + id + (before ? '&before=' + before : ''),
        );
        if (version !== historyVersion) return;
        for (const row of data.history) {
          const item = node('li'),
            entry = entries.find((e) => e.id === row.help_topic_id);
          item.append(
            node('strong', actionLabel(row.action)),
            node('span', actor(row.actor)),
            h('time', { dateTime: row.created_at }, dateTime(row.created_at)),
          );
          if (id === 'all')
            item.append(
              entry
                ? h('a', { href: topicLink(entry.id) }, entry.title)
                : node(
                    'span',
                    row.help_topic_id
                      ? 'Deleted topic · ' + row.help_topic_id
                      : 'Earlier topic action',
                  ),
            );
          list.append(item);
        }
        if (!list.children.length)
          list.append(node('li', 'No recorded changes for this topic.'));
        next = data.next;
        more.hidden = !next;
      } catch (error) {
        if (version === historyVersion)
          toast({ type: 'error', text: error.message });
      } finally {
        more.disabled = false;
      }
    }
    await fetchPage();
  }
  function selectedId(route) {
    return (
      route.params.id ||
      (oldTopics[route.query.topic]
        ? '00000000-0000-4000-8000-000000000' + oldTopics[route.query.topic]
        : null)
    );
  }
  function render() {
    const route = router.route();
    if (route?.section !== 'help') return;
    const id = selectedId(route),
      selected = entries.find((e) => e.id === id);
    const activity = route.name === 'help/activity',
      archived = route.name === 'help/archived' || Boolean(selected?.archived);
    q('#help-sidebar').hidden = activity;
    q('.help-columns').classList.toggle('help-activity-view', activity);
    for (const link of q('#help-views').querySelectorAll('a')) {
      const active =
        link.hash ===
        (activity
          ? '#/help/activity'
          : archived
            ? '#/help/archived'
            : '#/help');
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const term = q('#help-search').value.trim().toLocaleLowerCase();
    const filtered = entries.filter(
      (e) =>
        e.archived === archived &&
        (e.title + '\n' + e.body).toLocaleLowerCase().includes(term),
    );
    const list = q('#help-topic-list');
    list.replaceChildren();
    const current = selected || (!id ? filtered[0] : null);
    for (const [key, label] of Object.entries(categories)) {
      const group = filtered.filter((e) => e.category === key);
      if (!group.length) continue;
      list.append(node('h2', label));
      for (const entry of group) {
        const link = h('a', { href: topicLink(entry.id) }, entry.title);
        if (entry.id === current?.id) link.setAttribute('aria-current', 'page');
        list.append(link);
      }
    }
    if (!filtered.length)
      list.append(
        node(
          'p',
          term
            ? 'No matching topics.'
            : archived
              ? 'No archived topics.'
              : 'No topics yet.',
          'hint',
        ),
      );
    if (editing) return;
    historyVersion++;
    article.replaceChildren();
    if (activity) {
      article.className = 'help-history';
      historyInto(article, 'all');
      return;
    }
    article.className = '';
    if (!current) {
      article.append(
        node(
          'h2',
          id
            ? 'Topic unavailable'
            : archived
              ? 'Archived topics'
              : 'Your guide',
        ),
      );
      if (id)
        article.append(
          node(
            'p',
            'This topic may have been deleted. Choose another topic from the guide.',
          ),
        );
      return;
    }
    const heading = h('h2', { tabIndex: -1 }, current.title),
      actions = node('div', undefined, 'help-topic-actions');
    const history = h('section', {
      className: 'help-history',
      id: 'help-topic-history',
      hidden: true,
    });
    if (current.archived)
      actions.append(
        button('Restore', () => change(current, 'help-restore'), 'quiet'),
        button(
          'Delete permanently',
          () => change(current, 'help-delete'),
          'quiet danger',
        ),
      );
    else
      actions.append(
        button('Edit topic', () => start(current), 'quiet'),
        button('Archive', () => change(current, 'help-archive'), 'quiet'),
      );
    const historyButton = button(
      'History',
      () => {
        history.hidden = !history.hidden;
        historyButton.setAttribute('aria-expanded', String(!history.hidden));
        if (!history.hidden) historyInto(history, current.id);
      },
      'quiet',
    );
    historyButton.setAttribute('aria-expanded', 'false');
    historyButton.setAttribute('aria-controls', history.id);
    const copy = button(
      'Copy topic link',
      async () => {
        const url = new URL(location.href);
        url.hash = topicLink(current.id);
        if (await copyText(url.href)) toast({ text: 'Topic link copied.' });
        else {
          const field = h('input', {
            value: url.href,
            readOnly: true,
            'aria-label': 'Topic link',
          });
          actions.append(field);
          field.focus();
          field.select();
        }
      },
      'quiet',
    );
    actions.append(historyButton, copy);
    const meta =
      current.updated_by === 'club-office'
        ? 'Club Office guide'
        : (current.revision === 1 ? 'Added by ' : 'Updated by ') +
          actor(current.updated_by) +
          ' · ' +
          dateTime(current.updated_at);
    article.append(
      h(
        'header',
        { className: 'help-article-heading' },
        h(
          'div',
          {},
          node(
            'p',
            categories[current.category] +
              (current.archived ? ' · Archived' : ''),
            'hint',
          ),
          heading,
          node('p', meta, 'help-meta'),
        ),
        actions,
      ),
      h('div', { className: 'help-copy' }, ...paragraphs(current.body)),
      history,
    );
  }
  q('#help-search').oninput = render;
  async function load() {
    const version = ++generation;
    try {
      const data = await api('/api/admin?help=1');
      if (version !== generation) return;
      entries = data.entries;
      status.textContent = data.ready ? '' : 'Help topics are not set up yet.';
      add.hidden = !data.ready;
      render();
    } catch (error) {
      if (version === generation) status.textContent = error.message;
    }
  }
  return {
    load,
    leave,
    reset() {
      generation++;
      historyVersion++;
      entries = [];
      article.replaceChildren();
      q('#help-topic-list').replaceChildren();
      status.textContent = '';
    },
    clear() {
      this.reset();
      stop();
      add.hidden = true;
      q('#help-search').value = '';
    },
  };
}
