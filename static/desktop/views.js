import { COPYRIGHT, SOCIAL_LINKS } from '../content/club.js';
import { PROJECT_LINKS } from '../content/projects.js';
import { apps, latestApps } from './apps.js';
import { icon, aboutIcon, flagIcon } from './icons.js';

export { apps, latestApps } from './apps.js';

const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const page = (mode) => '/club.html?mode=' + encodeURIComponent(mode);
export const safeURL = (value) => {
  if (typeof value !== 'string') return '#';
  try {
    const url = new URL(value, 'https://club.local/');
    return ['http:', 'https:'].includes(url.protocol) ? value : '#';
  } catch {
    return '#';
  }
};
const link = (url, content, className = '') =>
  /* HTML */ `<a
    class="${className}"
    href="${escape(safeURL(url))}"
    ${/^https?:/.test(url) ? ' target="_blank" rel="noopener noreferrer"' : ''}
  >
    ${content}
  </a>`;
const folderItem = (type, title, description, url) =>
  link(
    url,
    /* HTML */ `${icon(type)}
      <span>
        <strong>${escape(title)}</strong>
        <small>${escape(description)}</small>
      </span>
      <span aria-hidden="true">↗</span>`,
    'r95-folder-item',
  );
const buttonLink = (url, label) => link(url, label, 'r95-button r95-default');
const projectMenuLink = ({ label, href, icon: symbol }) =>
  link(
    '/' + href,
    /* HTML */ `${icon(symbol, true)}<span>${escape(label)}</span>`,
    'r95-project-link',
  );
const projectsMenu = () =>
  /* HTML */ `<div class="r95-start-folder">
    <button
      type="button"
      class="r95-start-item r95-start-projects"
      id="r95-start-projects"
      aria-expanded="false"
      aria-controls="r95-project-menu"
    >
      ${icon('folder')}<span>Projects</span>
      <span class="r95-submenu-arrow" aria-hidden="true">▸</span>
    </button>
    <div class="r95-project-menu" id="r95-project-menu" aria-labelledby="r95-start-projects" hidden>
      ${PROJECT_LINKS.map(projectMenuLink).join('')}
      <hr />
      ${link(page('projects'), /* HTML */ `${icon('folder', true)}<span>All projects</span>`, 'r95-project-link')}
    </div>
  </div>`;

function recordingButton(recording, index) {
  return /* HTML */ `
    <button
      type="button"
      data-recording="${index}"
      aria-label="${escape(recording.english + ': ' + recording.label)}"
      aria-pressed="${index === 0}"
      lang="${escape(recording.lang)}"
    >
      ${escape(recording.label)}
    </button>
  `;
}

function replayMarkup(recordings) {
  if (!recordings.length)
    return '<p class="r95-no-recording">The live project is available while a new recorded tour is being prepared.</p>';
  return /* HTML */ `<div class="r95-recording" aria-label="Recorded walkthrough of Major">
    <div class="r95-recording-stage">
      <div class="r95-recording-screen">
        <video
          class="r95-recording-video"
          muted
          playsinline
          preload="metadata"
          disablepictureinpicture
          poster="${escape(safeURL(recordings[0].startPoster))}"
          aria-label="Recorded walkthrough of the real Major chatbot"
        ></video>
      </div>
    </div>
    <div class="r95-recording-languages" aria-label="Choose a conversation language">
      ${recordings.map(recordingButton).join('')}
    </div>
    <div class="r95-recording-caption">
      <button type="button" class="r95-playback" data-playback>Play tour</button>
      <span data-recording-status>Recorded demo</span>
      <span class="r95-recording-language">${escape(recordings[0].english)}</span>
    </div>
  </div>`;
}

export function renderViews(data) {
  const event = data.event,
    article = data.article;
  const major = data.projects.find((p) => p.id === 'major');
  return {
    events: {
      menu: link(page('events'), '<u>C</u>alendar'),
      body: event
        ? /* HTML */ `<div class="r95-event-content">
            <div class="r95-event-top">
              <div class="r95-date">
                <span>${escape(event.month.toUpperCase())}</span>
                <strong>${escape(event.day)}</strong>
              </div>
              <div>
                <span class="r95-kicker">UP NEXT</span>
                <p>${escape(event.when)}</p>
              </div>
            </div>
            <h3>${escape(event.title)}</h3>
            <p>${escape(event.summary)}</p>
            <div class="r95-event-action">
              ${buttonLink(event.url, 'View event →')}<span>${escape(event.category)}</span>
            </div>
          </div>`
        : /* HTML */ `<div class="r95-event-content">
            <span class="r95-kicker">CLUB CALENDAR</span>
            <h3>More good things are coming.</h3>
            <p>
              There are no upcoming events on the calendar yet. Explore what we’ve been learning
              together.
            </p>
            ${buttonLink(page('events'), 'Explore past meetings →')}
          </div>`,
      footer: event ? 'Next on the club calendar' : 'No upcoming events',
    },
    major: {
      menu: link(page('projects'), '<u>P</u>rojects') + link(data.links.major, 'Open <u>M</u>ajor'),
      body: /* HTML */ `<div class="r95-address">
          <span>Address</span>
          <span class="r95-address-field">${icon('folder', true)} My Club / Projects / Major</span>
        </div>
        <div class="r95-major-content">
          <div class="r95-major-heading">
            <div>
              <span class="r95-kicker">${escape(major?.label || 'CLUB PROJECT')}</span>
              <h3>${escape(major?.title || 'Major')}</h3>
            </div>
            ${buttonLink(data.links.major, 'Try Major ↗')}
          </div>
          <p>${escape(major?.body || 'Explore the club’s live project.')}</p>
          ${replayMarkup(data.recordings)}
        </div>`,
      footer: data.recordings.length
        ? `Actual recording · ${data.recordings.length} languages`
        : 'Live project available',
    },
    journal: {
      menu:
        link(page('journal'), '<u>A</u>ll articles') +
        link(page('subscribe'), '<u>S</u>ubscribe to The AI Review'),
      body: article
        ? /* HTML */ `<div class="r95-notepad">
            <div class="r95-note-meta">
              <span>${escape(article.category.toUpperCase())}</span>
              <span>${article.minutes} MIN READ</span>
            </div>
            ${link(article.url, /* HTML */ `<h3>${escape(article.title)}</h3>`)}
            <p>${escape(article.abstract)}</p>
            ${link(article.url, 'Read the article →', 'r95-read')}
          </div>`
        : '<div class="r95-notepad"><h3>A new edition is on its way.</h3><p>Check back for the club’s next article.</p></div>',
      footer: article?.edition || 'No articles available',
    },
    lab: {
      menu: '',
      body: /* HTML */ `<div class="r95-app-intro">
          ${icon('lab')}
          <div>
            <span class="r95-kicker">TRY IT YOURSELF</span>
            <h3>What happens if…?</h3>
            <p>Explore the club’s current experiments.</p>
          </div>
        </div>
        <div class="r95-lab-screen">
          <span>C:\\AI_CLUB&gt; experiments</span>
          <div class="r95-experiment-links">
            ${data.experiments.map((e) => link(page(e.mode), '&gt; ' + escape(e.action))).join('')}
          </div>
        </div>
        <div class="r95-app-action">${buttonLink(page('lab'), 'Open AI Lab →')}</div>`,
      footer: `${data.experiments.length} experiments · ${data.practiceCount} practice cases`,
    },
    projects: {
      menu: link(page('projects'), 'All projects'),
      body: /* HTML */ `<div class="r95-folder-heading">Explore what we’re building.</div>
        <div class="r95-folder-list">
          ${data.projects.map((p) => folderItem(p.id === 'major' ? 'computer' : 'folder', p.title, p.body, p.id === 'major' ? data.links.major : page(p.mode))).join('')}
        </div>`,
      footer: `${data.projects.length} projects`,
    },
    games: {
      menu: link(page('play'), 'All games'),
      body: /* HTML */ `<div class="r95-folder-heading">Take a little detour.</div>
        <div class="r95-folder-list">
          ${data.games.map((g) => folderItem('games', g.title, g.description, page(g.id))).join('')}
        </div>`,
      footer: `${data.games.length} games`,
    },
    join: {
      menu: '',
      body: /* HTML */ `<div class="r95-welcome">
        <img src="assets/club95-logo.svg" alt="Dallas College AI Club" width="282" height="84" />
        <h3>Curiosity looks good on you.</h3>
        <p>
          Come learn, build, and explore AI with us.<br />Start with a question. Find your people.
        </p>
        <div>
          ${buttonLink(data.links.join, 'Join us on Teams ↗')}
          ${link(page('about'), 'About the club', 'r95-button')}
        </div>
      </div>`,
      footer: 'Everyone starts somewhere. Start here.',
    },
  };
}
function windowMarkup(app, view) {
  const hidden = !latestApps.includes(app.id);
  return /* HTML */ `<section
    class="r95-window r95-${app.id}"
    id="r95-${app.id}"
    data-window="${app.id}"
    data-state="${hidden ? 'closed' : 'open'}"
    aria-labelledby="r95-title-${app.id}"
    ${hidden ? 'hidden' : ''}
  >
    <header class="r95-titlebar">
      <h2 id="r95-title-${app.id}" tabindex="0" aria-describedby="window-help">
        ${icon(app.type, true)}<span>${app.title}</span>
      </h2>
      <div class="r95-window-controls">
        <button type="button" data-window-action="minimize" aria-label="Minimize ${app.name}">
          <span class="r95-min-glyph" aria-hidden="true"></span>
        </button>
        <button type="button" data-window-action="maximize" aria-label="Maximize ${app.name}">
          <span class="r95-max-glyph" aria-hidden="true"></span>
        </button>
        <button type="button" data-window-action="close" aria-label="Close ${app.name}">
          <span class="r95-close-glyph" aria-hidden="true"></span>
        </button>
      </div>
    </header>
    <nav class="r95-window-menu" aria-label="${app.name} links" ${view.menu ? '' : 'hidden'}>
      ${view.menu}
    </nav>
    <div class="r95-window-body">${view.body}</div>
    <footer class="r95-statusbar">
      <span>${escape(view.footer)}</span>
      <button
        class="r95-resize"
        type="button"
        aria-label="Resize ${app.name}"
        aria-describedby="resize-help"
      ></button>
    </footer>
  </section>`;
}

function desktopShortcut(app) {
  return /* HTML */ `
    <button
      type="button"
      class="r95-desktop-icon"
      data-open="${app.id}"
      aria-controls="r95-${app.id}"
      aria-pressed="false"
    >
      ${icon(app.type)}
      <span>${app.name}</span>
    </button>
  `;
}

function taskButton(app) {
  return /* HTML */ `
    <button
      type="button"
      class="r95-button r95-task"
      data-task="${app.id}"
      aria-label="${app.name}"
      title="${app.name}"
      aria-controls="r95-${app.id}"
      aria-pressed="false"
      ${latestApps.includes(app.id) ? '' : 'hidden'}
    >
      ${icon(app.type, true)}
      <span>${app.name}</span>
    </button>
  `;
}

function startMenuMarkup(data) {
  const items = apps
    .filter((a) => a.id !== 'join')
    .map((a) =>
      a.id === 'projects'
        ? projectsMenu()
        : link(
            a.id === 'major' ? data.links.major : page(a.page),
            /* HTML */ `${icon(a.type)}<span>${a.name}</span> <span aria-hidden="true">↗</span>`,
            'r95-start-item',
          ),
    )
    .join('');
  return /* HTML */ `<div class="r95-start-menu" id="r95-start-menu" hidden>
    <div class="r95-start-stripe">AI Club<span>95</span></div>
    <nav aria-label="Start pages">
      <div class="r95-start-welcome">Dallas College AI Club<small>Explore the club</small></div>
      ${items}
      <hr />
      ${link(page('about'), /* HTML */ `${flagIcon}<span>About Club</span>`, 'r95-start-item')}
      ${link(data.links.join, /* HTML */ `${icon('mail')}<span>Join us on Teams</span>`, 'r95-start-item')}
    </nav>
  </div>`;
}

export function desktopMarkup(data, views) {
  return /* HTML */ `<div class="r95-shell">
    <div class="r95-desktop" aria-label="Dallas College AI Club desktop">
      <h1 class="r95-desktop-heading">Latest from the club<span>Make yourself at home.</span></h1>
      <nav class="r95-desktop-icons" aria-label="Desktop apps">
        ${link(page('about'), /* HTML */ `${aboutIcon}<span>Go to<br />website ↗</span>`, 'r95-desktop-icon r95-about-shortcut')}
        ${apps.map(desktopShortcut).join('')}
      </nav>
      <div class="r95-workspace">${apps.map((a) => windowMarkup(a, views[a.id])).join('')}</div>
      <div class="r95-wallpaper">
        <img src="assets/club95-logo.svg" alt="Dallas College AI Club" width="282" height="84" />
        <span>Made of curiosity. Powered by people.</span>
        <footer class="r95-club-footer">
          <nav aria-label="Follow the club">
            ${SOCIAL_LINKS.map(({ label, href }) => link(href, escape(label) + ' ↗')).join('')}
          </nav>
          <small>${escape(COPYRIGHT)}</small>
        </footer>
      </div>
      <div class="r95-empty-note">
        <p>Your club. Your desktop.</p>
        <button type="button" class="r95-button" data-arrange>Reopen latest updates</button>
      </div>
    </div>
    <footer class="r95-taskbar">
      <button
        type="button"
        class="r95-button r95-start"
        aria-expanded="false"
        aria-controls="r95-start-menu"
      >
        <img src="assets/club95-mark.svg" width="22" height="22" alt="" /><strong>Start</strong>
      </button>
      <span class="r95-taskbar-divider" aria-hidden="true"></span>
      <button
        type="button"
        class="r95-button r95-show-desktop"
        aria-label="Show desktop"
        aria-pressed="false"
        title="Show desktop"
      >
        ${icon('computer', true)}
      </button>
      <div class="r95-tasks" aria-label="Open windows">${apps.map(taskButton).join('')}</div>
      <button
        type="button"
        class="r95-button r95-arrange"
        data-arrange
        aria-label="Arrange windows"
        title="Arrange windows for this screen"
      >
        <span class="r95-arrange-glyph" aria-hidden="true"></span>
        <span>Arrange</span>
      </button>
      <div class="r95-clock">
        <span
          class="r95-tray-dot"
          role="img"
          aria-label="Club content loaded"
          data-freshness
        ></span>
        <time aria-label="Current time in Dallas"></time>
      </div>
      ${startMenuMarkup(data)}
    </footer>
    <p class="sr-only" id="window-help"></p>
    <p class="sr-only" id="resize-help">
      Drag the corner to resize. With the corner focused, use arrow keys to resize.
    </p>
    <p class="sr-only r95-announcement" role="status"></p>
  </div>`;
}
