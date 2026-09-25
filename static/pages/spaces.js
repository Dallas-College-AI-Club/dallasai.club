import { mountLatest } from './latest.js';
import { projectMockups, mountMockups } from '../projects/concepts.js';
import { eventsMarkup, mountEvents } from './events.js';
import { aboutMarkup, mountAbout } from './about.js';
import { replayMarkup, mountReplay } from '../projects/chatbot.js';
import { JOIN_URL, PROJECT_URL } from '../content/club.js';
import { careerMarkup, mountCareer } from '../projects/career.js';
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
            <h2>Major</h2>
            <p>
              Meet Major, the club’s college planning assistant. Explore degree requirements and
              organize questions before meeting with your Success Coach.
            </p>
            <p>Major helps you prepare. Your Success Coach helps finalize your plan.</p>
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
          <form id="subscribe-form">
            <label for="subscriber-email">Email address</label
            ><input
              id="subscriber-email"
              type="email"
              autocomplete="email"
              required
              placeholder="you@example.com"
            /><label class="subscribe-consent"
              ><input type="checkbox" required /> I would like to receive new articles from The AI
              Review.</label
            ><button type="submit" class="solid-link">Preview subscription →</button>
            <p class="subscription-note">
              Email subscriptions are not available yet. You can preview the signup form; your
              address will not be saved or sent.
            </p>
            <p id="subscribe-status" role="status"></p>
          </form>
        </section>
        <aside class="subscribe-alternative">
          <h2>Follow the club in Teams</h2>
          <p>Get club announcements while email subscriptions are being set up.</p>
          <a class="outline-link" href="${JOIN_URL}" target="_blank" rel="noreferrer"
            >Open Teams ↗</a
          >
          <p><a href="review-feed.xml">Preview RSS feed ↗</a></p>
        </aside>
      </div>`;
    root.querySelector('#subscribe-form').onsubmit = (e) => {
      e.preventDefault();
      root.querySelector('#subscribe-status').textContent =
        'Preview complete. Your address was not saved, and you have not been subscribed.';
    };
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
