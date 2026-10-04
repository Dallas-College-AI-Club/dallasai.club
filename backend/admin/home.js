// Home: tiles of what needs an officer this week. index.js fetches
// /api/admin?home=1 (which also opens the office, like the Inbox list);
// this module only draws it. Every value is set as text.
import { button, h, node, time } from './ui.js';
import {
  KINDS,
  actionLabel,
  actorLabel,
  dateTime,
  day,
  kindLabel,
  plural,
} from './format.js';
import { build } from './router.js';
const link = (text, href, className) => {
  const a = node('a', text, className);
  a.href = href;
  return a;
};
function tile(label, className = '') {
  const section = node('section', undefined, ('tile ' + className).trim()),
    heading = node('h2', label, 'tile-label');
  heading.id = 'tile-' + label.toLowerCase().replace(/[^a-z]+/g, '-');
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading);
  return section;
}
const when = (date) => (/T/.test(date || '') ? dateTime(date) : day(date));
const number = (value, words) =>
  h(
    'p',
    { className: 'tile-number' },
    node('strong', Number(value).toLocaleString('en-US')),
    ' ' + words,
  );
// The event card from the Events list, with its yellow DRAFT badge.
function draftCard(event, openEvent) {
  const card = button('', () => openEvent(event.id), 'event-choice has-draft');
  card.append(
    node('strong', event.title),
    node('span', event.date ? day(event.date) : 'Date TBD'),
    node(
      'small',
      'DRAFT · ' + (event.live ? 'Changes not published' : 'Not published'),
      'draft-badge',
    ),
  );
  return card;
}
export function renderHome(root, data, actions) {
  const { me, review, openEvent, newEvent, newSurvey, findContact } = actions;
  const totalNew = data.counts.reduce((sum, row) => sum + row.new, 0);
  // Needs review: RSVPs by event, then the newest other submissions.
  const needs = tile(
    'Needs review',
    'tile-wide' + (totalNew ? ' has-new' : ''),
  );
  needs.append(
    number(totalNew, totalNew === 1 ? 'new submission' : 'new submissions'),
  );
  const list = node('ul', undefined, 'tile-list');
  for (const group of data.rsvpGroups) {
    const item = node('li', undefined, 'tile-row rsvp-group');
    item.dataset.event = group.id;
    item.append(
      h(
        'div',
        {},
        node('strong', group.title || group.id),
        node(
          'span',
          [
            group.past ? 'Past event' : day(group.date),
            plural(group.new, 'new RSVP'),
            plural(group.total, 'RSVP') + ' in all',
          ].join(' · '),
        ),
      ),
      link(
        'Show all',
        build('inbox', { type: 'rsvp-all', event: group.id, status: 'active' }),
        'button-link',
      ),
    );
    list.append(item);
  }
  for (const entry of data.newest) {
    const item = node('li', undefined, 'tile-row'),
      who = link(entry.name || entry.email, '#/inbox/' + entry.id);
    who.dataset.focus = '';
    item.append(
      h(
        'div',
        {},
        who,
        node(
          'span',
          kindLabel(entry.kind) + (entry.preview ? ' · ' + entry.preview : ''),
        ),
        time(entry.created_at),
      ),
      button('Mark reviewed', () => review(entry, item)),
    );
    list.append(item);
  }
  needs.append(
    list.children.length
      ? list
      : node('p', 'Nothing new. You’re all caught up.', 'hint'),
    link('Open inbox', '#/inbox', 'button-link primary'),
  );
  // The next dated event; undated potential events get their own line.
  const next = tile('Next event');
  if (data.nextEvent) {
    const event = data.nextEvent;
    next.append(
      node('h3', event.title),
      node(
        'p',
        [when(event.date), event.category].filter(Boolean).join(' · '),
        'hint',
      ),
      number(event.rsvps, event.rsvps === 1 ? 'RSVP' : 'RSVPs'),
      button('Open event', () => openEvent(event.id)),
    );
  } else next.append(node('p', 'No upcoming event has a date yet.', 'hint'));
  if (data.potential.length)
    next.append(
      node(
        'p',
        'Date TBD: ' + data.potential.map((event) => event.title).join(', '),
        'hint',
      ),
    );
  // The open custom survey. Its PDF and CSV downloads are in the survey.
  const survey = tile('Custom survey');
  if (data.survey)
    survey.append(
      node('h3', data.survey.title),
      node(
        'p',
        'Open · ' +
          plural(data.survey.responses, 'response') +
          ' · link expires ' +
          dateTime(data.survey.expires_at),
        'hint',
      ),
      ...(data.survey.latest
        ? [node('p', 'Latest response ' + dateTime(data.survey.latest), 'hint')]
        : []),
      link(
        'Open responses',
        '#/surveys/custom/' + data.survey.id,
        'button-link',
      ),
    );
  else
    survey.append(
      node('p', 'No custom survey is open.', 'hint'),
      link('Custom surveys', '#/surveys/custom', 'button-link'),
    );
  const drafts = tile('Drafts & unpublished changes');
  drafts.append(
    ...(data.unpublished.length
      ? data.unpublished.map((event) => draftCard(event, openEvent))
      : [node('p', 'Everything is published.', 'hint')]),
  );
  // Active submissions only; past and upcoming RSVPs share one category.
  const totals = tile('Inbox totals'),
    grid = node('div', undefined, 'tile-totals');
  for (const kind of KINDS) {
    const count = data.counts
        .filter(
          (row) =>
            row.kind === kind || (kind === 'rsvp' && row.kind === 'rsvp-past'),
        )
        .reduce(
          (sum, row) => ({
            new: sum.new + row.new,
            total: sum.total + row.new + row.reviewed,
          }),
          { new: 0, total: 0 },
        ),
      cell = link(
        '',
        build('inbox', {
          type: kind === 'rsvp' ? 'rsvp-all' : kind,
          status: 'active',
        }),
        'total',
      );
    cell.classList.toggle('has-new', count.new > 0);
    cell.append(
      node('strong', count.total.toLocaleString('en-US')),
      node(
        'span',
        kindLabel(kind, 'plural') +
          (count.new ? ' · ' + count.new.toLocaleString('en-US') + ' new' : ''),
      ),
    );
    grid.append(cell);
  }
  const active = data.counts.reduce(
    (sum, row) => sum + row.new + row.reviewed,
    0,
  );
  totals.append(
    number(active, active === 1 ? 'active submission' : 'active submissions'),
    grid,
  );
  // Officers' own actions; never a member's name, email or text.
  const recent = node('details', undefined, 'tile tile-wide recent-activity'),
    log = node('ul', undefined, 'tile-list activity-list');
  recent.append(node('summary', 'Recent activity', 'tile-label'));
  for (const row of data.activity) {
    const subject =
      row.source === 'entry'
        ? row.label
          ? kindLabel(row.label)
          : ''
        : row.label;
    log.append(
      h(
        'li',
        { className: 'tile-row' },
        node(
          'span',
          [actionLabel(row.action), subject, actorLabel(row.actor, me)]
            .filter(Boolean)
            .join(' · '),
        ),
        time(row.created_at),
      ),
    );
  }
  recent.append(
    log.children.length ? log : node('p', 'No officer activity yet.', 'hint'),
  );
  const quick = tile('Quick actions'),
    row = node('div', undefined, 'entry-actions');
  row.append(
    button('New event', newEvent),
    button('Create custom survey', newSurvey),
    button('Find a contact', findContact),
  );
  quick.append(row);
  root.replaceChildren(needs, next, survey, drafts, totals, recent, quick);
}
