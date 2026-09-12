const KEY = 'dc-arcade-v1';
export function readArcade(storage) {
  try {
    const s = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY));
    return s?.version === 1 && s.games && !Array.isArray(s.games) && typeof s.games === 'object'
      ? s
      : { version: 1, games: {}, last: null };
  } catch {
    return { version: 1, games: {}, last: null };
  }
}
export function saveGame(id, state, storage) {
  try {
    const target = storage ?? globalThis.localStorage,
      s = readArcade(target);
    s.last = id;
    s.games[id] = {
      state: JSON.parse(JSON.stringify(state)),
      best: Math.max(s.games[id]?.best || 0, Number(state.score) || 0),
      updated: Date.now(),
    };
    target.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
export function markGame(id, storage) {
  try {
    const target = storage ?? globalThis.localStorage,
      s = readArcade(target);
    s.last = id;
    target.setItem(KEY, JSON.stringify(s));
  } catch {
    // The current page still works when the last-game preference cannot be saved.
  }
}
export function savedGame(id) {
  return readArcade().games[id] || null;
}
