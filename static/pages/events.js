import { readEventPlans, saveEventPlan } from '../storage/event-plans.js';
import {
  EVENTS,
  JOIN_URL,
  CONTACT_EMAIL,
  WORKSHOP_REQUEST_URL,
  eventDate,
  eventTime,
  eventCalendar,
  eventIsPast,
  splitEvents,
} from '../content/club.js';
export { WORKSHOP_REQUEST_URL } from '../content/club.js';
export function monthCells(year, month) {
  const first = new Date(Date.UTC(year, month, 1)),
    count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [
    ...Array(first.getUTCDay()).fill(null),
    ...Array.from({ length: count }, (_, i) => i + 1),
  ];
  return [...cells, ...Array(42 - cells.length).fill(null)];
}
const parts = (e) => e.date.slice(0, 10).split('-').map(Number);
export function eventsMarkup() {
  return /* HTML */ `<header class="space-masthead">
      <div class="space-title-row">
        <h1>Events</h1>
        <span class="editorial-aside">Make time for a new idea.</span>
      </div>
    </header>
    <div class="events-intro">
      <div>
        <h2>
          <span>Learn something.</span> <span>Meet someone.</span> <span>Share your thoughts.</span>
        </h2>
        <p>Workshops, conversations, and time to build together.</p>
      </div>
      <button class="solid-link" id="workshop-request">Request a workshop ↗</button>
    </div>
    <div class="events-layout">
      <section class="event-calendar" aria-label="Club event calendar">
        <div class="calendar-heading">
          <button id="calendar-prev" aria-label="Previous month">←</button>
          <h2 id="calendar-month" aria-live="polite"></h2>
          <button id="calendar-next" aria-label="Next month">→</button>
        </div>
        <div class="calendar-week" aria-hidden="true">
          ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => /* HTML */ `<span>${d}</span>`).join('')}
        </div>
        <div id="calendar-days" class="calendar-days"></div>
        <p class="calendar-key"><i></i> Club event <span>All times Central</span></p>
        <div id="calendar-agenda" class="calendar-agenda"></div>
        <button class="calendar-read" id="calendar-read">View event details ↓</button>
      </section>
      <article id="event-detail" class="event-detail" aria-live="polite" tabindex="-1"></article>
    </div>
    <dialog class="workshop-dialog" id="workshop-dialog" aria-labelledby="workshop-heading">
      <button class="dialog-close" aria-label="Close workshop information">×</button
      ><span class="tag">SHAPE WHAT WE LEARN</span>
      <h2 id="workshop-heading">What would you like to try?</h2>
      <p>
        A form for workshop requests is coming soon. For now, share a topic or an idea with the club
        in Teams.
      </p>
      <a class="solid-link" href="${JOIN_URL}" target="_blank" rel="noreferrer"
        >Suggest a topic in Teams ↗</a
      >
    </dialog>`;
}
export function mountEvents(root) {
  const q = (s) => root.querySelector(s),
    requested = new URLSearchParams(location.search).get('event');
  const fallback = splitEvents().upcoming[0] || splitEvents().past[0] || EVENTS[0];
  let selected = EVENTS.find((e) => e.id === requested) || fallback;
  let [year, month] = parts(selected || { date: new Date().toISOString() });
  month--;
  const monthEvents = () =>
    EVENTS.filter((e) => {
      const p = parts(e);
      return p[0] === year && p[1] === month + 1;
    }).sort((a, b) => a.date.localeCompare(b.date));
  const syncUrl = () => {
    const url = new URL(location.href);
    if (selected) url.searchParams.set('event', selected.id);
    else url.searchParams.delete('event');
    history.replaceState({}, '', url);
  };
  const choose = (e) => {
    selected = e;
    syncUrl();
    root
      .querySelectorAll('[data-event]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.event === e.id)));
    detail();
  };
  function detail() {
    const panel = q('#event-detail');
    panel.scrollTop = 0;
    q('#calendar-read').hidden = !selected;
    if (!selected) {
      panel.innerHTML = '';
      return;
    }
    const past = eventIsPast(selected);
    let going = readEventPlans().includes(selected.id);
    panel.innerHTML = /* HTML */ `<button class="event-calendar-back">← Back to calendar</button>
      <div class="event-detail-meta">
        <span class="tag">${selected.category}</span
        ><span>${past ? 'Past event' : 'Coming up'}</span>
      </div>
      <div class="event-detail-date">
        ${eventDate(selected)} <span>${parts(selected)[0]} · ${eventTime(selected)}</span>
      </div>
      <h2>${selected.title}</h2>
      ${selected.summary ? /* HTML */ `<p class="event-description">${selected.summary}</p>` : ''}${
        selected.location
          ? /* HTML */ `<div class="event-venue">
              <span>WHERE</span>
              <p>${selected.location}</p>
            </div>`
          : ''
      }${
        selected.agenda.length
          ? /* HTML */ `<h3>${past ? 'Meeting details' : 'On the agenda'}</h3>
              <ul>
                ${selected.agenda.map((x) => /* HTML */ `<li>${x}</li>`).join('')}
              </ul>`
          : past
            ? ''
            : '<h3>More details to come</h3><p>The workshop agenda will be announced here.</p>'
      }${
        selected.preparation.length
          ? /* HTML */ `<h3>Before you come</h3>
              <ul>
                ${selected.preparation.map((x) => /* HTML */ `<li>${x}</li>`).join('')}
              </ul>`
          : ''
      }
      <div class="event-detail-actions">
        ${past ? '' : /* HTML */ `<button id="event-going" class="solid-link" aria-pressed="${going}">${going ? '✓ In my plans' : 'Save to my plans'}</button><button id="save-event" class="outline-link">Add to calendar ↓</button>`}<a
          href="mailto:${CONTACT_EMAIL}"
          >Ask about this event ↗</a
        >
      </div>
      ${past ? '' : /* HTML */ `<p id="event-plan-status" class="event-plan-status" role="status">${going ? 'Saved on this device. Select again to remove.' : 'Save to your plans on this device.'}</p>`}`;
    q('.event-calendar-back').onclick = () => {
      q('.event-calendar').scrollIntoView({ block: 'start' });
      q(`[data-event="${selected.id}"]`)?.focus({ preventScroll: true });
    };
    const goingButton = q('#event-going');
    if (goingButton)
      goingButton.onclick = () => {
        const next = !going;
        if (saveEventPlan(selected.id, next)) {
          going = next;
          goingButton.setAttribute('aria-pressed', String(going));
          goingButton.textContent = going ? '✓ In my plans' : 'Save to my plans';
          q('#event-plan-status').textContent = going
            ? 'Saved on this device. Select again to remove.'
            : 'Removed from your plans.';
        } else {
          q('#event-plan-status').textContent =
            'This browser could not save your plan. You can still get a calendar reminder.';
        }
      };
    const save = q('#save-event');
    if (save)
      save.onclick = () => {
        const a = document.createElement('a'),
          url = URL.createObjectURL(
            new Blob([eventCalendar(selected)], { type: 'text/calendar;charset=utf-8' }),
          );
        a.href = url;
        a.download = selected.id + '-' + selected.date.slice(0, 4) + '.ics';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
  }
  function draw() {
    q('#calendar-month').textContent = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month, 1)));
    const events = monthEvents(),
      now = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    q('#calendar-days').innerHTML = monthCells(year, month)
      .map((day) => {
        if (day === null) return '<span class="calendar-blank"></span>';
        const e = events.find((e) => parts(e)[2] === day),
          key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return e
          ? /* HTML */ `<button
              data-event="${e.id}"
              aria-pressed="${selected?.id === e.id}"
              aria-label="${eventDate(e)}: ${e.title}"
              ${key === now ? 'aria-current="date"' : ''}
            >
              <span>${day}</span><i></i>
            </button>`
          : /* HTML */ `<span class="calendar-day" ${key === now ? 'aria-current="date"' : ''}
              >${day}</span
            >`;
      })
      .join('');
    q('#calendar-agenda').innerHTML = events.length
      ? events
          .map(
            (e) =>
              /* HTML */ `<button data-event="${e.id}" aria-pressed="${e.id === selected?.id}">
                <span>${eventDate(e)}</span><strong>${e.title}</strong><b aria-hidden="true">↗</b>
              </button>`,
          )
          .join('')
      : '<p>No events listed for this month.</p>' +
        (fallback ? '<button id="next-announced">View club events →</button>' : '');
    root
      .querySelectorAll('[data-event]')
      .forEach((b) => (b.onclick = () => choose(EVENTS.find((e) => e.id === b.dataset.event))));
    if (q('#next-announced'))
      q('#next-announced').onclick = () => {
        selected = fallback;
        [year, month] = parts(selected);
        month--;
        syncUrl();
        draw();
      };
    detail();
  }
  q('#calendar-read').onclick = () => {
    if (!selected) return;
    q('#event-detail').scrollIntoView({ behavior: 'instant', block: 'start' });
    q('#event-detail').focus({ preventScroll: true });
  };
  const shift = (n) => {
    const d = new Date(Date.UTC(year, month + n, 1));
    year = d.getUTCFullYear();
    month = d.getUTCMonth();
    selected = monthEvents()[0] || null;
    syncUrl();
    draw();
  };
  q('#calendar-prev').onclick = () => shift(-1);
  q('#calendar-next').onclick = () => shift(1);
  const dialog = q('#workshop-dialog');
  q('#workshop-request').onclick = () =>
    WORKSHOP_REQUEST_URL ? location.assign(WORKSHOP_REQUEST_URL) : dialog.showModal();
  dialog.querySelector('.dialog-close').onclick = () => dialog.close();
  dialog.onclick = (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        dialog.close();
    }
  };
  draw();
  return () => {
    if (dialog.open) dialog.close();
  };
}
