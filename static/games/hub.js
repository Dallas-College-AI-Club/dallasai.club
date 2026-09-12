import { JOIN_URL } from '../content/club.js';
import { GAMES } from './registry.js';
import { readArcade } from '../storage/games.js';
import { readRun } from '../storage/drive.js';
export function arcadeHeader(title) {
  return /* HTML */ `<header class="arcade-header">
    <a class="arcade-brand" href="index.html" aria-label="Dallas College AI Club — welcome"
      ><img src="assets/club-logo.png" alt="" /><span>DALLAS COLLEGE<b>AI CLUB</b></span></a
    >
    <div class="arcade-header-actions">
      <a class="arcade-home" href="club.html?mode=rankings" data-rankings>Rankings</a
      ><a class="arcade-home" href="club.html?mode=summary" data-game-nav="summary">Club hub ↗</a>
    </div>
  </header>`;
}
export function mountHub(root, { open }) {
  document.body.classList.remove('reading');
  root.className = 'content arcade-page';
  const saves = readArcade(),
    drive = readRun();
  root.innerHTML =
    arcadeHeader() +
    /* HTML */ `<section class="arcade-heading">
        <div>
          <span class="arcade-kicker">DALLAS COLLEGE AI CLUB</span>
          <h1>Explore & Play<span>.</span></h1>
        </div>
      </section>
      <div class="game-library">
        ${GAMES.map((g, i) => {
          const saved = g.id === 'explore' ? drive : saves.games[g.id]?.state,
            canResume = saved && saved.phase !== 'over' && saved.phase !== 'ready';
          return /* HTML */ `<article class="game-card" style="--game-accent:${g.accent}">
            <a
              class="game-cover ${g.type}-cover"
              href="club.html?mode=${g.id}"
              data-game="${g.id}"
              aria-label="${canResume ? 'Continue' : 'Play'} ${g.title}"
              >${g.cover ? /* HTML */ `<img src="${g.cover}" alt="A drive through the Dallas campus world" />` : /* HTML */ `<canvas width="768" height="512" data-cover="${g.id}" aria-hidden="true"></canvas>`}<span
                class="cover-number"
                >0${i + 1}</span
              ><span class="cover-play" aria-hidden="true">↗</span
              ><span class="cover-type"
                >${g.type === 'drive' ? '3D WORLD' : 'RETRO ORIGINAL'}</span
              ></a
            >
            <div class="game-info">
              <span class="arcade-kicker">${g.genre}</span>
              <h2>${g.title}</h2>
              ${g.load ? '<span class="game-wip">Work in progress</span>' : ''}
              <p>${g.description}</p>
              <div class="game-card-bottom">
                <span>${g.controls}</span
                ><a href="club.html?mode=${g.id}" data-game="${g.id}"
                  >${canResume ? 'Continue' : 'Play'} ↗</a
                >
              </div>
              ${saves.games[g.id]?.best ? /* HTML */ `<small class="game-personal-best">Personal best · ${saves.games[g.id].best} points</small>` : ''}
            </div>
          </article>`;
        }).join('')}
      </div>
      <aside class="arcade-footnote">
        <span class="arcade-status-dot" aria-hidden="true"></span>
        <p>Earn club discoveries as you play. Read them whenever you like.</p>
        <span>More games to come</span>
      </aside>
      <aside class="game-maker">
        <div>
          <span>MADE TO KEEP GROWING</span>
          <h2>Want to improve a game or add your own?</h2>
          <p>Bring your ideas, your curiosity, and whatever skills you have.</p>
        </div>
        <a href="${JOIN_URL}" target="_blank" rel="noreferrer">Join the club ↗</a>
      </aside>`;
  root.querySelector('[data-rankings]').onclick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open('rankings');
  };
  let disposed = false;
  for (const game of GAMES) {
    if (!game.load || game.cover) continue;
    game
      .load()
      .then((engine) => {
        if (disposed) return;
        const canvas = root.querySelector(`[data-cover=${game.id}]`);
        if (canvas)
          engine.draw(canvas.getContext('2d'), { ...engine.createState(), ...game.preview });
      })
      .catch(() => {});
  }
  root.querySelectorAll('[data-game]').forEach(
    (a) =>
      (a.onclick = (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        open(a.dataset.game);
      }),
  );
  root.querySelector('[data-game-nav]').onclick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open('summary');
  };
  return () => {
    disposed = true;
    root.classList.remove('arcade-page');
  };
}
