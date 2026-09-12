export function touchVector(dx, dy, r = 40) {
  const length = Math.hypot(dx, dy),
    scale = length > r ? r / length : 1,
    x = (dx * scale) / r,
    y = (dy * scale) / r;
  return {
    steer: Math.abs(x) < 0.12 ? 0 : -x,
    throttle: Math.abs(y) < 0.12 ? 0 : -y,
    x: x * r,
    y: y * r,
  };
}
export function mountTouchDrive(world) {
  const stage = world.canvas.parentElement,
    controls = document.createElement('div');
  controls.className = 'touch-drive';
  controls.innerHTML =
    '<div class="touch-stick" tabindex="0" role="group" aria-label="Driving joystick. Drag up to drive, down to reverse, and sideways to steer. Arrow keys also work."><span class="stick-axis" aria-hidden="true">↑<i>← &nbsp; →</i>↓</span><span class="stick-thumb" aria-hidden="true"></span></div><span class="stick-label">Drag to drive</span><button class="touch-brake" aria-label="Hold to brake">Brake</button>';
  stage.append(controls);
  const stick = controls.querySelector('.touch-stick'),
    thumb = controls.querySelector('.stick-thumb'),
    brake = controls.querySelector('.touch-brake');
  let pointer = null;
  const clear = () => {
    pointer = null;
    world.driveInput = null;
    world.keys = {};
    thumb.style.transform = 'translate(0,0)';
    stick.classList.remove('engaged');
  };
  const move = (e) => {
    const r = stick.getBoundingClientRect(),
      v = touchVector(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    world.driveInput = { throttle: v.throttle, steer: v.steer };
    thumb.style.transform = `translate(${v.x}px,${v.y}px)`;
  };
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pointer = e.pointerId;
    stick.setPointerCapture(pointer);
    world.startDriving();
    stick.classList.add('engaged');
    move(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer) return;
    e.preventDefault();
    move(e);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    stick.addEventListener(name, clear);
  brake.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    brake.setPointerCapture(e.pointerId);
    clear();
    world.keys[' '] = true;
    world.speed = 0;
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    brake.addEventListener(name, () => delete world.keys[' ']);
  stick.addEventListener('keydown', (e) => {
    const mapping = { ArrowUp: 'w', ArrowDown: 's', ArrowLeft: 'a', ArrowRight: 'd' };
    if (mapping[e.key]) {
      e.preventDefault();
      world.startDriving();
      world.keys[mapping[e.key]] = true;
    }
  });
  stick.addEventListener('keyup', clear);
  window.addEventListener('blur', clear);
  document.addEventListener('club:search', (e) => {
    if (e.detail?.open) clear();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear();
  });
  new MutationObserver(() => {
    if (document.body.dataset.space !== 'explore') {
      clear();
      setExpanded(false);
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['data-space'] });
  const full = document.createElement('button');
  full.className = 'drive-expand';
  full.textContent = 'Expand view';
  full.setAttribute('aria-pressed', 'false');
  stage.append(full);
  const setExpanded = (active) => {
    document.body.classList.toggle('immersive-drive', active);
    full.textContent = active ? 'Exit full view' : 'Expand view';
    full.setAttribute('aria-pressed', String(active));
    world.resize();
  };
  full.onclick = () => setExpanded(!document.body.classList.contains('immersive-drive'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('immersive-drive')) full.click();
  });
  return clear;
}
