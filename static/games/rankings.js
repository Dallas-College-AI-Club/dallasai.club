import { GAMES } from './registry.js';
import { arcadeHeader } from './hub.js';
import { readArcade } from '../storage/games.js';
import { readRun } from '../storage/drive.js';

const scoreFor = (id) =>
  id === 'explore' ? readRun()?.score?.points || 0 : readArcade().games[id]?.state?.score || 0;
// Shared rankings stay disabled until the separately reviewed Worker integration is ready.
export function mountRankings(root, { open, apiBaseURL = '' }) {
  let disposed = false,
    request = 0,
    saving = false,
    identity = {};
  try {
    const saved = JSON.parse(localStorage.getItem('dc-drive-player') || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      if (typeof saved.nickname === 'string') identity.nickname = saved.nickname;
      if (typeof saved.id === 'string' && /^[a-f0-9-]{36}$/i.test(saved.id)) identity.id = saved.id;
    }
  } catch {
    // Rankings remain usable without a saved player identity.
  }
  const last = readArcade().last,
    initial = GAMES.some((g) => g.id === last) ? last : 'explore';
  root.className = 'content arcade-page rankings-page';
  root.innerHTML =
    arcadeHeader() +
    /* HTML */ `<div class="game-titlebar">
        <div>
          <a href="club.html?mode=play" class="all-games" data-library>← All games</a>
          <h1>Rankings</h1>
        </div>
        <span class="ranking-limit">TOP 10</span>
      </div>
      <section class="ranking-board">
        <div class="ranking-filters">
          <label
            >Game<select id="rank-game">
              ${GAMES.map((g) => /* HTML */ `<option value="${g.id}" ${g.id === initial ? 'selected' : ''}>${g.title}</option>`).join('')}
            </select></label
          ><button id="rank-refresh">Refresh</button>
        </div>
        <p class="ranking-context" id="rank-context"></p>
        <div class="ranking-table-wrap">
          <table class="ranking-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Player</th>
                <th scope="col">Score</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody id="rank-rows"></tbody>
          </table>
        </div>
        <p id="rank-empty" role="status">Loading rankings…</p>
      </section>
      <section class="ranking-submit">
        <div>
          <h2>Your latest run</h2>
          <p><strong id="rank-my-score">0</strong> points · <span id="rank-my-game"></span></p>
          <small id="rank-help">Save under your nickname. Dates use Central Time.</small>
        </div>
        <form id="rank-submit">
          <label for="rank-nickname">Nickname</label>
          <div>
            <input
              id="rank-nickname"
              minlength="2"
              maxlength="20"
              required
              autocomplete="nickname"
              placeholder="Your nickname"
            /><button id="rank-save">Save score</button>
          </div>
          <p id="rank-status" role="status"></p>
        </form>
      </section>`;
  const q = (s) => root.querySelector(s),
    game = q('#rank-game'),
    empty = q('#rank-empty');
  q('#rank-nickname').value = identity.nickname || '';
  const updateScore = () => {
    const score = scoreFor(game.value);
    q('#rank-my-score').textContent = score.toLocaleString();
    q('#rank-my-game').textContent = GAMES.find((g) => g.id === game.value).title;
    q('#rank-save').disabled = !apiBaseURL || score < 1 || saving;
  };
  const refresh = async () => {
    const ticket = ++request;
    updateScore();
    q('#rank-context').textContent =
      GAMES.find((g) => g.id === game.value).title + ' · Top 10 · Best score per player';
    q('#rank-rows').replaceChildren();
    empty.hidden = false;
    if (!apiBaseURL) {
      empty.textContent =
        'Shared rankings are coming later. Your game progress stays on this device.';
      return;
    }
    empty.textContent = 'Loading rankings…';
    try {
      const response = await fetch(
        apiBaseURL + '/leaderboard?' + new URLSearchParams({ game: game.value }),
      );
      if (!response.ok) throw Error();
      const data = await response.json();
      if (disposed || ticket !== request) return;
      for (const [i, row] of data.entries.slice(0, 10).entries()) {
        const tr = document.createElement('tr');
        for (const value of [
          String(i + 1).padStart(2, '0'),
          row.nickname,
          row.score.toLocaleString(),
          row.date,
        ]) {
          const td = document.createElement('td');
          td.textContent = value;
          tr.append(td);
        }
        q('#rank-rows').append(tr);
      }
      empty.hidden = data.entries.length > 0;
      empty.textContent = 'No scores for this game yet.';
    } catch {
      if (disposed || ticket !== request) return;
      empty.textContent = 'Rankings are unavailable. Please try again.';
    }
  };
  game.onchange = refresh;
  q('#rank-refresh').onclick = refresh;
  q('#rank-submit').onsubmit = async (e) => {
    e.preventDefault();
    if (saving || !apiBaseURL) return;
    const nickname = q('#rank-nickname').value.trim(),
      score = scoreFor(game.value),
      selected = game.value;
    if (!/^[\p{L}\p{N} _.-]{2,20}$/u.test(nickname)) {
      q('#rank-status').textContent =
        'Use 2–20 letters, numbers, spaces, dots, dashes or underscores.';
      return;
    }
    if (!score) return;
    saving = true;
    q('#rank-save').disabled = true;
    try {
      identity.id ||= crypto.randomUUID();
      const response = await fetch(apiBaseURL + '/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: identity.id, nickname, game: selected, score }),
      });
      if (!response.ok) throw Error();
      identity.nickname = nickname;
      try {
        localStorage.setItem('dc-drive-player', JSON.stringify(identity));
      } catch {
        // Rankings remain usable without a saved player identity.
      }
      if (disposed) return;
      q('#rank-status').textContent = 'Score saved for ' + nickname + '.';
      if (game.value === selected) {
        await refresh();
      }
    } catch {
      if (!disposed) q('#rank-status').textContent = 'Could not save. Please try again.';
    } finally {
      saving = false;
      if (!disposed) updateScore();
    }
  };
  root.querySelector('#rank-submit').hidden = !apiBaseURL;
  if (!apiBaseURL)
    root.querySelector('#rank-help').textContent = 'Your progress is saved in this browser.';
  for (const a of root.querySelectorAll('[data-game-nav],[data-library],[data-rankings]'))
    a.onclick = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      open(
        a.hasAttribute('data-library')
          ? 'play'
          : a.hasAttribute('data-rankings')
            ? 'rankings'
            : 'summary',
      );
    };
  refresh();
  return () => {
    disposed = true;
    request++;
  };
}
