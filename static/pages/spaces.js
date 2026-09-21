import { mountLatest } from './latest.js';
import { projectMockups, mountMockups } from '../projects/concepts.js';
import { eventsMarkup, mountEvents } from './events.js';
import { aboutMarkup, mountAbout } from './about.js';
import { replayMarkup, mountReplay } from '../projects/chatbot.js';
import { JOIN_URL, PROJECT_URL } from '../content/club.js';
import { careerMarkup, mountCareer } from '../projects/career.js';
import { formFooter, mountForm } from '../app/form-client.js';
export const spaceHeader = (name, action = '') =>
  /* HTML */ `<header class="space-masthead">
    <div class="space-title-row">
      <h1>${name}</h1>
      ${action}
    </div>
  </header>`;
export function renderSpace(root, id, { open }) {
  root.classList.add('space-page');
  let dispose = () => {};
  if (id === 'about') {
    root.innerHTML = aboutMarkup();
    mountAbout(root);
  } else if (id === 'summary') {
    dispose = mountLatest(root);
  } else if (id === 'projects') {
    root.innerHTML =
      spaceHeader(
        'Projects',
        /* HTML */ `<a class="outline-link" href="${JOIN_URL}" target="_blank" rel="noreferrer"
          >Build with us ↗</a
        >`,
      ) +
      /* HTML */ `<section class="project-feature" id="success-coach" tabindex="-1">
          ${replayMarkup()}
          <div class="project-feature-copy">
            <span class="tag">01 / WORKING DEMO</span>
            <h2>Success Coach</h2>
            <p>
              Meet Major, the club’s college planning assistant. Ask about your degree and plan your
              next semester.
            </p>
            <a class="solid-link" href="${PROJECT_URL}" target="_blank" rel="noreferrer"
              >Try the live demo ↗</a
            >
          </div>
        </section>
        <div class="section-label projects-secondary">
          <h2>In development</h2>
          <span>Built around student needs</span>
        </div>
        ${careerMarkup()}
        <div class="section-label projects-secondary concepts-heading">
          <h2>Ideas in motion</h2>
          <span>Interactive studies and ideas to develop</span>
        </div>
        ${projectMockups()}`;
    const stopReplay = mountReplay(root),
      stopCareer = mountCareer(root),
      stopConcepts = mountMockups(root);
    dispose = () => {
      stopReplay();
      stopCareer();
      stopConcepts();
    };
  } else if (id === 'events') {
    root.innerHTML = eventsMarkup();
    dispose = mountEvents(root);
  } else if (id === 'subscribe') {
    root.innerHTML =
      spaceHeader('Subscribe') +
      /* HTML */ `<div class="subscribe-layout">
        <section>
          <h2>The AI Review, by email.</h2>
          <form id="subscribe-form" class="club-form">
            <label for="subscriber-email">Email address</label
            ><input
              id="subscriber-email"
              name="email"
              type="email"
              autocomplete="email"
              required
              placeholder="you@example.com"
            />${formFooter('Subscribe →','I would like to receive new articles from The AI Review. I can unsubscribe at any time.')}
          </form>
        </section>
        <aside class="subscribe-alternative">
          <h2>Follow the club in Teams</h2>
          <p>Join the conversation and get club announcements in Teams.</p>
          <a class="outline-link" href="${JOIN_URL}" target="_blank" rel="noreferrer"
            >Open Teams ↗</a
          >
          <p><a href="review-feed.xml">Follow the RSS feed ↗</a></p>
        </aside>
      </div>`;
    dispose = mountForm(root.querySelector('#subscribe-form'), { kind:'subscribe' });
  }
  root.querySelectorAll('[data-space]').forEach((b) => (b.onclick = () => open(b.dataset.space)));
  root
    .querySelectorAll('[data-article]')
    .forEach((b) => (b.onclick = () => open('article', b.dataset.article)));
  return () => {
    dispose();
    root.classList.remove('space-page');
  };
}
