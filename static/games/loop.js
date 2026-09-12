const STEP = 1 / 120;
// Fixed simulation steps keep movement and scoring consistent at 30, 60 or 120 fps.
export function advanceGame(engine, state, elapsed, remainder = 0) {
  if (state.phase !== 'running') return 0;
  let time = remainder + Math.max(0, Math.min(0.25, elapsed));
  while (time + 1e-9 >= STEP && state.phase === 'running') {
    engine.step(state, STEP);
    time -= STEP;
  }
  return state.phase === 'running' ? Math.max(0, time) : 0;
}
