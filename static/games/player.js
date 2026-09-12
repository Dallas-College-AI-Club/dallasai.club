import { gameById } from './registry.js';
import { savedGame, saveGame } from '../storage/games.js';
import { bulletinAt, clubBulletins } from './news.js';
import { arcadeHeader } from './hub.js';
import { advanceGame } from './loop.js';
export function mountGame(root, id, { open }) {
  let disposed = false,
    frame,
    engine,
    state,
    last = 0,
    savedAt = 0,
    uiAt = 0,
    remainder = 0,
    lastPhase = '',
    lastScore = -1,
    checkpoints = -1,
    viewportVisible = true,
    swipe = null,
    toastUntil = 0,
    needsDraw = true;
  const game = gameById(id),
    snake = id === 'snake';
  document.body.classList.remove('reading');
  root.className = 'content arcade-page arcade-player';
  root.innerHTML =
    arcadeHeader() +
    /* HTML */ `<div class="game-titlebar">
        <div>
          <a href="club.html?mode=play" class="all-games" data-library>← All games</a>
          <h1>${game.title}</h1>
        </div>
        <div class="game-score">
          <span>YOUR SCORE</span><strong id="game-score-value">0</strong
          ><small>Best <b id="game-best">${savedGame(id)?.best || 0}</b></small>
        </div>
      </div>
      <section class="retro-console ${game.type}-console" aria-label="${game.title} game">
        <div class="console-top">
          <div class="game-telemetry">
            <span id="game-progress">Getting ready…</span><strong id="game-pace"></strong>
          </div>
          <div>
            <button type="button" id="game-pause" disabled>Pause Ⅱ</button
            ><button
              type="button"
              id="game-help"
              aria-expanded="false"
              aria-controls="game-instructions"
            >
              How to play
            </button>
          </div>
        </div>
        <div class="retro-screen">
          <canvas
            id="retro-canvas"
            width="768"
            height="512"
            tabindex="0"
            role="img"
            aria-label="${game.title} game board. Use your keyboard or the direction buttons to play."
          ></canvas>
          <div class="game-overlay" id="game-overlay">
            <section class="game-prompt"><h2>Getting ready…</h2></section>
          </div>
          <div class="game-touch" aria-label="Touch game controls">
            ${snake ? '<div class="snake-pad"><button disabled data-game-control="up" aria-label="Snake up">↑</button><button disabled data-game-control="left" aria-label="Snake left">←</button><button disabled data-game-control="down" aria-label="Snake down">↓</button><button disabled data-game-control="right" aria-label="Snake right">→</button></div>' : '<div class="bike-pad"><button disabled data-game-control="up" aria-label="Move up a lane">↑ Lane</button><button disabled data-game-control="down" aria-label="Move down a lane">↓ Lane</button></div><button disabled class="bike-boost" data-game-control="boost">Hold to boost</button>'}
          </div>
        </div>
        <div class="reward-toast" id="game-reward" role="status" aria-live="polite"></div>
        <section id="game-instructions" class="game-instructions-panel" hidden>
          <p></p>
          <button class="panel-close" id="game-help-close" aria-label="Close instructions">
            ×
          </button>
        </section>
        <div class="console-bottom">
          <span id="game-save-status">Progress saves on this device</span
          ><button id="game-restart" disabled>New game ↻</button>
        </div>
      </section>
      <details class="game-discoveries" id="game-discoveries">
        <summary>Club discoveries <span id="game-discovery-count">0</span></summary>
        <div id="game-discovery-list"><p>Discoveries you earn will appear here.</p></div>
      </details>`;
  const q = (s) => root.querySelector(s),
    canvas = q('#retro-canvas'),
    ctx = canvas.getContext('2d'),
    overlay = q('#game-overlay'),
    pauseButton = q('#game-pause');
  const save = () => {
    if (!state) return;
    const ok = saveGame(id, state);
    q('#game-best').textContent = savedGame(id)?.best || state.score;
    q('#game-save-status').textContent = ok
      ? 'Saved on this device'
      : 'Session only · Browser storage unavailable';
  };
  const ui = () => {
    if (!state) return;
    if (lastScore !== state.score) {
      q('#game-score-value').textContent = state.score.toLocaleString();
      lastScore = state.score;
    }
    q('#game-progress').textContent = engine.stat(state);
    q('#game-pace').textContent = engine.paceLabel(state);
  };
  const run = () => {
    if (!state) return;
    q('#game-instructions').hidden = true;
    q('#game-help').setAttribute('aria-expanded', 'false');
    state.phase = 'running';
    remainder = 0;
    last = performance.now();
    canvas.focus({ preventScroll: true });
    renderOverlay();
    save();
  };
  const pause = () => {
    if (state?.phase !== 'running') return;
    state.phase = 'paused';
    engine.input(state, 'boost', false);
    remainder = 0;
    save();
    renderOverlay();
  };
  const renderOverlay = () => {
    if (!state || state.phase === lastPhase) return;
    lastPhase = state.phase;
    needsDraw = true;
    const ready = state.phase === 'ready',
      over = state.phase === 'over',
      running = state.phase === 'running';
    q('#game-discoveries').classList.toggle('game-is-running', running);
    for (const b of root.querySelectorAll('[data-game-control]')) b.disabled = !running;
    overlay.hidden = running;
    pauseButton.disabled = false;
    pauseButton.textContent = ready
      ? 'Start game ▶'
      : over
        ? 'Play again ↻'
        : state.phase === 'paused'
          ? 'Resume ▶'
          : 'Pause Ⅱ';
    if (running) return;
    if (over) save();
    overlay.innerHTML = /* HTML */ `<section class="game-prompt">
      <button
        type="button"
        class="panel-close"
        data-dismiss-prompt
        aria-label="${state.phase === 'paused' ? 'Close and resume game' : 'Close game introduction'}"
      >
        ×</button
      ><span class="arcade-kicker"
        >${ready ? game.genre : over ? 'RUN COMPLETE' : 'YOUR GAME IS SAVED'}</span
      >
      <h2>
        ${ready ? game.title : over ? (state.won ? 'Perfect circuit.' : 'One more round?') : 'Ready when you are.'}
      </h2>
      <p>
        ${ready ? (snake ? 'Collect sparks. Build speed. Earn more with every turn.' : 'Change lanes, launch off ramps, and boost for more points.') : over ? `${state.score.toLocaleString()} points · Your best is saved.` : 'Continue from the same spot.'}
      </p>
      <button data-start>
        ${ready ? 'Let’s play' : over ? 'Play again' : 'Continue playing'} →</button
      ><a class="prompt-exit" href="club.html?mode=play">All games ↗</a
      >${ready ? /* HTML */ `<small>${snake ? 'Arrow keys · WASD · Swipe' : '↑ ↓ lanes · Space boost'}</small>` : ''}
    </section>`;
    overlay.querySelector('[data-dismiss-prompt]').onclick = () => {
      if (state.phase === 'paused') run();
      else overlay.hidden = true;
    };
    overlay.querySelector('.prompt-exit').onclick = (e) => {
      e.preventDefault();
      open('play');
    };
    overlay.querySelector('[data-start]').onclick = () => {
      if (over) {
        state = engine.createState();
        checkpoints = -1;
        refreshDiscoveries();
      }
      run();
    };
  };
  const refreshDiscoveries = () => {
    const count = Math.min(state.checkpoints, clubBulletins().length);
    q('#game-discovery-count').textContent = count;
    const list = q('#game-discovery-list');
    list.replaceChildren();
    const close = document.createElement('button');
    close.className = 'panel-close';
    close.setAttribute('aria-label', 'Close club discoveries');
    close.textContent = '×';
    close.onclick = () => {
      q('#game-discoveries').open = false;
      q('#game-discoveries summary').focus({ preventScroll: true });
    };
    list.append(close);
    if (!count) {
      list.insertAdjacentHTML('beforeend', '<p>Discoveries you earn will appear here.</p>');
      return;
    }
    for (let i = 0; i < count; i++) {
      const news = bulletinAt(i),
        read = state.newsRead?.includes(i),
        article = document.createElement('article');
      article.innerHTML = /* HTML */ `<span>${news.label}</span>
        <h2>${news.title}</h2>
        <p>${news.body}</p>
        <button>${read ? news.action + ' ↗' : news.action + ' · +75 points ↗'}</button>`;
      article.querySelector('button').onclick = () => {
        if (!state.newsRead.includes(i)) {
          state.newsRead.push(i);
          state.score += 75;
        }
        pause();
        save();
        open(news.mode, news.article || 0);
      };
      list.append(article);
    }
  };
  const resize = () => {
    if (!snake) {
      const box = canvas.getBoundingClientRect(),
        width = Math.max(480, Math.round((512 * box.width) / Math.max(1, box.height)));
      if (canvas.width !== width) canvas.width = width;
    }
    needsDraw = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  const tick = (now) => {
    if (disposed) return;
    if (state) {
      const active = !document.hidden && viewportVisible;
      if (active) {
        remainder = advanceGame(engine, state, (now - last) / 1000 || 0, remainder);
        if (state.phase === 'running' || needsDraw) {
          engine.draw(ctx, state, state.phase === 'running' ? now : 0);
          needsDraw = false;
        }
      }
      last = now;
      if (state.checkpoints !== checkpoints) {
        if (checkpoints >= 0 && state.checkpoints > checkpoints) {
          const news = bulletinAt(state.checkpoints - 1);
          q('#game-reward').textContent = '+100 · ' + news.title;
          q('#game-reward').classList.add('is-new');
          toastUntil = now + 6500;
          save();
        }
        checkpoints = state.checkpoints;
        refreshDiscoveries();
      }
      if (toastUntil && now > toastUntil) {
        q('#game-reward').textContent = '';
        q('#game-reward').classList.remove('is-new');
        toastUntil = 0;
      }
      renderOverlay();
      if (now - uiAt > 80) {
        ui();
        uiAt = now;
      }
      if (state.phase === 'running' && now - savedAt > 1000) {
        save();
        savedAt = now;
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const key = (e) => {
    if (
      !state ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.target.closest('input,textarea,select,button,a,summary')
    )
      return;
    const map = {
      ArrowUp: 'up',
      w: 'up',
      ArrowDown: 'down',
      s: 'down',
      ArrowLeft: 'left',
      a: 'left',
      ArrowRight: 'right',
      d: 'right',
    };
    if (e.key === 'p' || e.key === 'Escape' || (e.key === ' ' && snake)) {
      if (!e.repeat) {
        e.preventDefault();
        state.phase === 'running' ? pause() : state.phase === 'paused' && run();
      }
      return;
    }
    if (!snake && e.key === ' ') {
      e.preventDefault();
      if (state.phase === 'running') engine.input(state, 'boost', true);
      return;
    }
    const control = map[e.key];
    if (control && state.phase === 'running') {
      e.preventDefault();
      engine.input(state, control, true);
    }
  };
  const keyup = (e) => {
    if (e.key === ' ' && state) engine.input(state, 'boost', false);
  };
  const release = () => {
    if (state) {
      engine.input(state, 'boost', false);
      pause();
    }
  };
  const pagehide = () => {
    release();
    save();
  };
  const hidden = () => {
    if (document.hidden) pagehide();
  };
  document.addEventListener('keydown', key);
  document.addEventListener('keyup', keyup);
  document.addEventListener('club:pause-games', release);
  window.addEventListener('blur', release);
  window.addEventListener('pagehide', pagehide);
  document.addEventListener('visibilitychange', hidden);
  const io = new IntersectionObserver(
    (e) => {
      viewportVisible = e[0].isIntersecting;
      if (!viewportVisible) pause();
    },
    { threshold: 0.15 },
  );
  io.observe(canvas);
  root.querySelectorAll('[data-game-control]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      if (state?.phase !== 'running') return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      engine.input(state, b.dataset.gameControl, true);
      b.classList.add('pressed');
    });
    const off = () => {
      b.classList.remove('pressed');
      if (state && b.dataset.gameControl === 'boost') engine.input(state, 'boost', false);
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'])
      b.addEventListener(event, off);
    if (b.dataset.gameControl === 'boost') {
      b.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && state?.phase === 'running') {
          e.preventDefault();
          engine.input(state, 'boost', true);
          b.classList.add('pressed');
        }
      });
      b.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          off();
        }
      });
    } else
      b.addEventListener('click', (e) => {
        if (e.detail === 0 && state?.phase === 'running') {
          engine.input(state, b.dataset.gameControl, true);
          canvas.focus({ preventScroll: true });
        }
      });
  });
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    swipe = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!swipe || state?.phase !== 'running' || !snake) return;
    const dx = e.clientX - swipe.x,
      dy = e.clientY - swipe.y;
    if (Math.hypot(dx, dy) < 18) return;
    engine.input(
      state,
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up',
    );
    swipe = { x: e.clientX, y: e.clientY };
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    canvas.addEventListener(event, () => (swipe = null));
  for (const a of root.querySelectorAll('[data-library],[data-game-nav],[data-rankings]'))
    a.onclick = (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      open(
        a.hasAttribute('data-library')
          ? 'play'
          : a.hasAttribute('data-rankings')
            ? 'rankings'
            : 'summary',
      );
    };
  pauseButton.onclick = () => {
    if (!state) return;
    if (state.phase === 'running') pause();
    else {
      if (state.phase === 'over') {
        state = engine.createState();
        checkpoints = -1;
        refreshDiscoveries();
      }
      run();
    }
  };
  q('#game-help').onclick = (e) => {
    pause();
    const info = q('#game-instructions');
    info.hidden = !info.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!info.hidden));
    if (!info.hidden) overlay.hidden = true;
  };
  q('#game-help-close').onclick = () => {
    q('#game-instructions').hidden = true;
    q('#game-help').setAttribute('aria-expanded', 'false');
    q('#game-help').focus({ preventScroll: true });
  };
  q('#game-restart').onclick = () => {
    if (!engine) return;
    q('#game-instructions').hidden = true;
    q('#game-help').setAttribute('aria-expanded', 'false');
    state = engine.createState();
    lastPhase = '';
    checkpoints = -1;
    remainder = 0;
    q('#game-reward').textContent = '';
    save();
    refreshDiscoveries();
    renderOverlay();
    ui();
  };
  game
    .load()
    .then((module) => {
      if (disposed) return;
      engine = module;
      state = engine.restore(savedGame(id)?.state);
      q('#game-instructions p').textContent = engine.help;
      q('#game-restart').disabled = false;
      checkpoints = state.checkpoints;
      refreshDiscoveries();
      renderOverlay();
      ui();
      save();
      last = performance.now();
      frame = requestAnimationFrame(tick);
    })
    .catch(() => {
      if (!disposed)
        overlay.innerHTML =
          '<section class="game-prompt"><h2>Couldn’t load the game.</h2><p>Refresh the page to try again.</p></section>';
    });
  return () => {
    disposed = true;
    if (state?.phase === 'running') state.phase = 'paused';
    save();
    cancelAnimationFrame(frame);
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('keydown', key);
    document.removeEventListener('keyup', keyup);
    document.removeEventListener('club:pause-games', release);
    window.removeEventListener('blur', release);
    window.removeEventListener('pagehide', pagehide);
    document.removeEventListener('visibilitychange', hidden);
  };
}
