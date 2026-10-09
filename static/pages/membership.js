import { JOIN_URL, eventDate, splitEvents } from '../content/club.js';
import { eventsFresh } from '../content/events.js';
import {
  escapeHTML,
  formFooter,
  identityFields,
  mountForm,
} from '../app/form-client.js';
export function renderMembership(root) {
  root.innerHTML = `<header class="space-masthead"><h1>Join the club</h1></header><div class="club-form-layout"><section><h2 data-form-intro>Find your people. Build something together.</h2><p data-form-intro>Tell us a little about yourself. All experience levels are welcome.</p><form class="club-form" id="membership-form">${identityFields()}
    <label>Campus<select name="campus" required><option value="">Choose your campus</option>${['Brookhaven', 'Cedar Valley', 'Eastfield', 'El Centro', 'Mountain View', 'North Lake', 'Richland', 'Other / community'].map((x) => `<option>${x}</option>`).join('')}</select></label>
    <label>What would you like to explore? <span>(optional)</span><textarea name="interests" rows="4" maxlength="1500" placeholder="Projects, workshops, questions, or ideas…"></textarea></label>
    ${formFooter('Join the club', 'I would like to join the Dallas College AI Club and receive messages about my membership.')}</form></section>
    <aside hidden><h2>Would you like to join an event?</h2><p>See what’s coming up, or help shape what we do next.</p><div class="membership-events"></div><p><a href="club.html?mode=events">Browse all events ↗</a></p><p>Want new articles by email? <a href="club.html?mode=subscribe">Subscribe to The AI Review</a>.</p></aside></div>`;
  const email = root.querySelector('[name="email"]');
  email.placeholder = 'you@student.dallascollege.edu';
  email.setAttribute('aria-label', 'Email address');
  email.pattern = String.raw`[^\s@]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*(?:[dD][cC][cC][cC][dD]|[dD][aA][lL][lL][aA][sS][cC][oO][lL][lL][eE][gG][eE])\.[eE][dD][uU]`;
  email.title =
    'Use a Dallas College email address ending in dallascollege.edu or dcccd.edu.';
  const emailHint = document.createElement('span');
  emailHint.textContent = email.title;
  email.after(emailHint);
  const updateEvents = () => {
    const upcoming = eventsFresh ? splitEvents().upcoming : [];
    root.querySelector('.membership-events').innerHTML = [
      [upcoming.find((event) => event.date && !event.potential), 'Next event'],
      [upcoming.find((event) => event.potential), 'Potential event'],
    ]
      .filter(([event]) => event)
      .map(
        ([event, label]) =>
          `<div class="membership-event"><p class="membership-event-label">${label} · ${escapeHTML(eventDate(event))}</p><h3><a href="club.html?mode=events&event=${encodeURIComponent(event.id)}">${escapeHTML(event.title)} ↗</a></h3></div>`,
      )
      .join('');
  };
  document.addEventListener('club:events-status', updateEvents);
  const stop = mountForm(root.querySelector('form'), {
    kind: 'join',
    onSuccess: () => {
      const done = root.querySelector('.form-confirmation button');
      const actions = document.createElement('div');
      actions.className = 'membership-actions';
      actions.innerHTML = `<a class="solid-link teams-link" href="${JOIN_URL}" target="_blank" rel="noreferrer">Open Teams ↗</a>`;
      done.before(actions);
      actions.append(done);
      updateEvents();
      root.querySelector('aside').hidden = false;
    },
  });
  return () => {
    stop();
    document.removeEventListener('club:events-status', updateEvents);
  };
}
