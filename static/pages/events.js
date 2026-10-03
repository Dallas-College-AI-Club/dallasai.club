import { eventText, eventList, eventAgenda } from '../app/event-format.js';
import { rsvpDialog } from '../app/rsvp-dialog.js';
import { eventImageViewer } from '../app/event-image-viewer.js';
import {
  formFooter,
  identityFields,
  mountForm,
  escapeHTML,
} from '../app/form-client.js';
import {
  ADMIN_URL,
  EVENTS_API_URL,
  eventsFresh,
  refreshEvents,
} from '../content/events.js';
import { questionDialog } from '../app/questions.js';
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
  return [
    ...cells,
    ...Array(Math.ceil(cells.length / 7) * 7 - cells.length).fill(null),
  ];
}
const parts = (e) =>
  (e.date || new Date().toISOString()).slice(0, 10).split('-').map(Number);
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
          <span>Learn something.</span> <span>Meet someone.</span>
          <span>Share your thoughts.</span>
        </h2>
        <p>Workshops, conversations, and time to build together.</p>
      </div>
      <button class="solid-link" id="workshop-request">
        Request a workshop ↗
      </button>
    </div>
    <p id="event-freshness" role="status"></p>
    ${ADMIN_URL ? '<p><a class="outline-link" target="_blank" rel="noopener noreferrer" aria-label="Admin sign in (opens in a new tab)" href="' + escapeHTML(ADMIN_URL) + '">Admin sign in ↗</a></p>' : ''}
    <div class="events-layout">
      <aside class="events-browser" aria-label="Find an event">
        <section
          id="potential-events"
          class="calendar-agenda potential-events"
          hidden
        ></section>
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
          <p class="calendar-key">
            <i></i> Club event <span>All times Central</span>
          </p>
          <div id="calendar-agenda" class="calendar-agenda"></div>
          <button class="calendar-read" id="calendar-read">
            View event details ↓
          </button>
        </section>
      </aside>
      <article
        id="event-detail"
        class="event-detail"
        aria-live="polite"
        tabindex="-1"
      ></article>
    </div>
    <dialog
      class="workshop-dialog"
      id="workshop-dialog"
      aria-labelledby="workshop-heading"
    >
      <div class="dialog-toolbar">
        <button
          type="button"
          class="dialog-close"
          aria-label="Close workshop information"
        >
          ×
        </button>
      </div>
      <span class="tag">SHAPE WHAT WE LEARN</span>
      <h2 id="workshop-heading">What would you like to try?</h2>
      <form id="workshop-form" class="club-form">
        ${identityFields()}
        <label
          >Workshop topic<input name="topic" maxlength="160" required
        /></label>
        <label
          >Tell us more <span>(optional)</span
          ><textarea name="details" maxlength="3000" rows="4"></textarea>
        </label>
        ${formFooter('Send workshop request')}
      </form>
    </dialog>`;
}
export function mountEvents(root) {
  const privatePreview =
    new URLSearchParams(location.search).get('preview') === '1' &&
    window.parent !== window;
  const preventPreviewActions = (event) => {
    if (
      event.target.closest('button,a,form') &&
      !event.target.closest(
        '.calendar-read,.event-calendar-back,.rsvp-dialog,.rsvp-answer-preview,#open-rsvp,#event-rsvp-action',
      )
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  if (privatePreview) {
    document.addEventListener('click', preventPreviewActions, true);
    document.addEventListener('submit', preventPreviewActions, true);
  }
  const questions = questionDialog();
  const stopWorkshop = mountForm(root.querySelector('#workshop-form'), {
    kind: 'workshop',
  });
  const rsvp = rsvpDialog(root, { preview: privatePreview });
  const imageViewer = eventImageViewer();
  const q = (s) => root.querySelector(s),
    requested = new URLSearchParams(location.search).get('event');
  let fallback =
    splitEvents().upcoming[0] || splitEvents().past[0] || EVENTS[0];
  let selected = privatePreview
    ? null
    : EVENTS.find((e) => e.id === requested) || fallback;
  let previewEvent = null;
  let [year, month] = parts(selected || { date: new Date().toISOString() });
  month--;
  const monthEvents = () =>
    (previewEvent
      ? [...EVENTS.filter((e) => e.id !== previewEvent.id), previewEvent]
      : EVENTS
    )
      .filter((e) => {
        if (!e.date) return false;
        const p = parts(e);
        return p[0] === year && p[1] === month + 1;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  const syncUrl = () => {
    if (privatePreview) return;
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
      .forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.event === e.id)),
      );
    detail();
    const panel = q('#event-detail');
    if (innerWidth <= 900 || panel.getBoundingClientRect().top < 0) {
      panel.scrollIntoView({ block: 'start' });
      panel.focus({ preventScroll: true });
    }
  };
  function detail() {
    const panel = q('#event-detail');
    rsvp.update(selected && !eventIsPast(selected) ? selected : null);
    q('#calendar-read').hidden = !selected;
    if (!selected) {
      panel.innerHTML =
        '<p>Select an event from the calendar to see the details.</p>';
      return;
    }
    const past = selected.date ? eventIsPast(selected) : false;
    const canRSVP =
      !past && !privatePreview && selected.registrationOpen !== false;
    panel.innerHTML = /* HTML */ `<button class="event-calendar-back">
        ← Back to calendar
      </button>
      <div class="event-detail-meta">
        <span class="tag">${escapeHTML(selected.category)}</span
        ><span
          >${privatePreview ? 'PRIVATE DRAFT PREVIEW' : past ? 'Past event' : selected.potential ? 'Potential event' : 'Coming up'}</span
        >
      </div>
      <div class="event-detail-date">
        ${selected.date ? eventDate(selected) : 'TBD'}
        <span
          >${selected.date ? parts(selected)[0] + ' · ' + eventTime(selected) : 'Date and time to be decided.'}</span
        >
      </div>
      <h2>${escapeHTML(selected.title)}</h2>
      <div class="event-registration"></div>
      ${selected.potential ? '<p class="potential-notice">Potential event · Share your interest while we plan. Final details and seats are not yet confirmed.</p>' : ''}
      ${selected.targetAudience ? '<section class="event-richtext"><h3>Who is this for?</h3>' + eventText(selected.targetAudience) + '</section>' : ''}
      ${selected.learningOutcomes?.length ? '<section class="event-richtext"><h3>Learning outcomes</h3>' + eventList(selected.learningOutcomes) + '</section>' : ''}
      ${selected.summary ? /* HTML */ `<div class="event-description event-richtext">${eventText(selected.summary)}</div>` : ''}${
        selected.location
          ? /* HTML */ `<div class="event-venue">
              <span>WHERE</span>
              <p>${escapeHTML(selected.location)}</p>
            </div>`
          : ''
      }${
        selected.agenda.length
          ? /* HTML */ `<h3>${past ? 'Meeting details' : 'On the agenda'}</h3>
              ${eventAgenda(selected.agenda)}`
          : past
            ? ''
            : '<h3>More details to come</h3><p>The workshop agenda will be announced here.</p>'
      }${
        selected.preparation.length
          ? /* HTML */ `<h3>Before you come</h3>
              ${eventList(selected.preparation)}`
          : ''
      }
      <div class="event-detail-actions">
        ${selected.meetingUrl ? '<a class="outline-link" target="_blank" rel="noopener" href="' + escapeHTML(selected.meetingUrl) + '">Open meeting link ↗</a>' : ''}
        ${past || privatePreview ? '' : /* HTML */ `${canRSVP ? '<button id="event-rsvp-action" class="solid-link">RSVP for this event</button>' : ''}${selected.date ? '<button id="save-event" class="outline-link">Add to calendar ↓</button>' : ''}`}${privatePreview ? '' : '<button id="ask-event-question" class="outline-link">Ask about this event</button>'}
      </div>`;
    if (q('#ask-event-question'))
      q('#ask-event-question').onclick = () => questions.open(selected);
    if (privatePreview || (!past && selected.registrationOpen !== false)) {
      q('.event-registration').insertAdjacentHTML(
        'beforeend',
        '<button id="open-rsvp" class="solid-link">' +
          (privatePreview ? 'Try RSVP preview' : 'RSVP') +
          (selected.surveyQuestions?.length
            ? ' & answer questions'
            : ' for this event') +
          '</button>',
      );
      q('#open-rsvp').onclick = () => rsvp.open(selected);
    } else if (!privatePreview && !past) {
      panel.insertAdjacentHTML(
        'beforeend',
        '<p>RSVPs are closed for this event.</p>',
      );
    }
    if (selected.images?.length) {
      const gallery = document.createElement('div');
      gallery.className = 'event-gallery';
      selected.images.forEach((image, index) => {
        const figure = document.createElement('figure'),
          img = document.createElement('img');
        img.loading = 'lazy';
        img.src =
          privatePreview &&
          /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(
            image.previewSrc || '',
          )
            ? image.previewSrc
            : EVENTS_API_URL + '?image=' + encodeURIComponent(image.id);
        img.alt = image.alt || selected.title + ' — event image ' + (index + 1);
        if (privatePreview) figure.append(img);
        else {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'event-image-open';
          button.setAttribute('aria-label', 'Enlarge ' + img.alt);
          button.onclick = () => imageViewer.open(img.src, img.alt);
          button.append(img);
          const caption = document.createElement('figcaption');
          caption.textContent = 'Click to enlarge';
          figure.append(button, caption);
        }
        gallery.append(figure);
      });
      panel.append(gallery);
    }
    q('.event-calendar-back').onclick = () => {
      q('.events-browser').scrollIntoView({ block: 'start' });
      q(`[data-event="${selected.id}"]`)?.focus({ preventScroll: true });
    };
    if (q('#event-rsvp-action'))
      q('#event-rsvp-action').onclick = () => rsvp.open(selected);
    const save = q('#save-event');
    if (save)
      save.onclick = () => {
        const a = document.createElement('a'),
          url = URL.createObjectURL(
            new Blob([eventCalendar(selected)], {
              type: 'text/calendar;charset=utf-8',
            }),
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
              aria-label="${eventDate(e)}: ${escapeHTML(e.title)}"
              ${key === now ? 'aria-current="date"' : ''}
            >
              <span>${day}</span><i></i>
            </button>`
          : /* HTML */ `<span
              class="calendar-day"
              ${key === now ? 'aria-current="date"' : ''}
              >${day}</span
            >`;
      })
      .join('');
    q('#calendar-agenda').innerHTML = events.length
      ? events
          .map(
            (e) =>
              /* HTML */ `<button
                data-event="${e.id}"
                aria-pressed="${e.id === selected?.id}"
              >
                <span>${eventDate(e)}</span
                ><strong>${escapeHTML(e.title)}</strong
                ><b aria-hidden="true">↗</b>
              </button>`,
          )
          .join('')
      : '<p>No events listed for this month.</p>' +
        (fallback
          ? '<button id="next-announced">View club events →</button>'
          : '');
    const potential = (
      previewEvent
        ? [...EVENTS.filter((e) => e.id !== previewEvent.id), previewEvent]
        : EVENTS
    ).filter((e) => e.potential && !eventIsPast(e));
    q('#potential-events').hidden = !potential.length;
    q('#potential-events').innerHTML =
      '<span class="potential-eyebrow">HELP PLAN WHAT’S NEXT</span><h2>Potential events</h2><p>Explore an idea and share your interest.</p>' +
      potential
        .map(
          (e) =>
            '<button data-event="' +
            e.id +
            '" aria-pressed="' +
            (selected?.id === e.id) +
            '"><span>' +
            eventDate(e) +
            '</span><strong>' +
            escapeHTML(e.title) +
            '</strong><b aria-hidden="true">↗</b></button>',
        )
        .join('');
    root
      .querySelectorAll('[data-event]')
      .forEach(
        (b) =>
          (b.onclick = () =>
            choose(
              previewEvent?.id === b.dataset.event
                ? previewEvent
                : EVENTS.find((e) => e.id === b.dataset.event),
            )),
      );
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
    q('#event-detail').scrollIntoView({
      behavior: 'instant',
      block: 'start',
    });
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
    WORKSHOP_REQUEST_URL
      ? location.assign(WORKSHOP_REQUEST_URL)
      : dialog.showModal();
  dialog.querySelector('.dialog-close').onclick = () => dialog.close();
  dialog.onclick = (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        dialog.close();
    }
  };
  const freshness = () => {
    if (privatePreview) {
      q('#event-freshness').textContent =
        'Private preview · Try RSVP answers and preview the admin result. Nothing will be submitted or saved.';
      return;
    }
    q('#event-freshness').textContent = eventsFresh
      ? requested && !EVENTS.some((e) => e.id === requested)
        ? 'That event is no longer listed. Browse the calendar for current events.'
        : ''
      : 'Checking the current calendar… If it stays unavailable, please try again shortly.';
  };
  const updated = () => {
    if (privatePreview) return;
    fallback = splitEvents().upcoming[0] || splitEvents().past[0] || EVENTS[0];
    const previous = selected;
    selected =
      EVENTS.find((e) => e.id === (selected?.id || requested)) || fallback;
    if (
      selected &&
      (!previous ||
        previous.id !== selected.id ||
        previous.date !== selected.date)
    ) {
      [year, month] = parts(selected);
      month--;
    }
    syncUrl();
    draw();
    freshness();
  };
  document.addEventListener('club:events-updated', updated);
  document.addEventListener('club:events-status', freshness);
  draw();
  freshness();
  refreshEvents();
  const previewMessage = (event) => {
    const allowed = new Set([
      'https://dallasai-leaderboard.vercel.app',
      'https://dallasai-forms-preview.vercel.app',
    ]);
    if (['localhost', '127.0.0.1'].includes(location.hostname))
      allowed.add(location.origin);
    if (
      !privatePreview ||
      event.source !== parent ||
      !allowed.has(event.origin) ||
      event.data?.type !== 'club:event-preview'
    )
      return;
    const content = event.data.event;
    if (
      !content ||
      typeof content.title !== 'string' ||
      typeof content.date !== 'string' ||
      (content.date && !Number.isFinite(Date.parse(content.date))) ||
      !Array.isArray(content.agenda) ||
      !Array.isArray(content.preparation)
    )
      return;
    selected = previewEvent = content;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    [year, month] = parts(content.date ? content : { date: today });
    month--;
    q('#workshop-request').hidden = true;
    q('#calendar-prev').disabled = q('#calendar-next').disabled = true;
    draw();
    if (!content.date)
      q('#calendar-agenda').innerHTML = '<p>This draft has no date yet.</p>';
    q('.events-layout').scrollIntoView({ block: 'start' });
  };
  if (privatePreview) {
    window.addEventListener('message', previewMessage);
    const allowed = [
      'https://dallasai-leaderboard.vercel.app',
      'https://dallasai-forms-preview.vercel.app',
    ];
    if (['localhost', '127.0.0.1'].includes(location.hostname))
      allowed.push(location.origin);
    for (const origin of allowed)
      parent.postMessage({ type: 'club:preview-ready' }, origin);
  }
  return () => {
    document.removeEventListener('club:events-updated', updated);
    document.removeEventListener('club:events-status', freshness);
    stopWorkshop();
    rsvp.destroy();
    imageViewer.destroy();
    questions.destroy();
    window.removeEventListener('message', previewMessage);
    document.removeEventListener('click', preventPreviewActions, true);
    document.removeEventListener('submit', preventPreviewActions, true);
    if (dialog.open) dialog.close();
  };
}
