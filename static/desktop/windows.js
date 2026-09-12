import { apps, latestApps } from './apps.js';
import {
  clampBox,
  fitsDesktop,
  initialLayout,
  TASKBAR_HEIGHT,
  WINDOW_MINIMUM,
  MAJOR_MINIMUM,
} from './layout.js';
import { mountStartMenu } from './start-menu.js';
export { clampBox, fitsDesktop, initialLayout } from './layout.js';

const CLOCK_INTERVAL_MS = 15_000;
const KEYBOARD_STEP = 10;
const LARGE_KEYBOARD_STEP = 30;
const clockFormat = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Chicago',
});

export function mountDesktop(root) {
  const shell = root.querySelector('.r95-shell');
  const workspace = root.querySelector('.r95-workspace');
  const windows = [...root.querySelectorAll('[data-window]')];
  const tasks = [...root.querySelectorAll('[data-task]')];
  const icons = [...root.querySelectorAll('[data-open]')];
  const desktopToggle = root.querySelector('.r95-show-desktop');
  const compact = () => shell.classList.contains('is-flowing');
  const area = () => ({ width: workspace.clientWidth, height: workspace.clientHeight });
  const get = (id) => windows.find((w) => w.dataset.window === id);
  const name = (w) => apps.find((a) => a.id === w.dataset.window).name;
  const minimumSize = (w) => (w.dataset.window === 'major' ? MAJOR_MINIMUM : WINDOW_MINIMUM);
  const fitWindow = (w, box) => clampBox(box, area(), minimumSize(w));
  const startMenu = mountStartMenu(root);
  let active = 'events',
    z = 10,
    gesture = null,
    desktopWindows = null,
    arranged = true;
  const announce = (message) => {
    root.querySelector('.r95-announcement').textContent = message;
  };
  const setBox = (w, box) => {
    Object.entries(box).forEach(([k, v]) => {
      w.style[k] = v + 'px';
    });
  };
  const boxOf = (w) => ({
    left: w.offsetLeft,
    top: w.offsetTop,
    width: w.offsetWidth,
    height: w.offsetHeight,
  });
  const sync = () => {
    windows.forEach((w) =>
      w.classList.toggle('is-active', !w.hidden && w.dataset.window === active),
    );
    tasks.forEach((t) => {
      const w = get(t.dataset.task);
      t.hidden = w.dataset.state === 'closed';
      t.setAttribute('aria-pressed', String(!w.hidden && active === t.dataset.task));
    });
    icons.forEach((i) =>
      i.setAttribute(
        'aria-pressed',
        String(!get(i.dataset.open).hidden && i.dataset.open === active),
      ),
    );
    const empty = windows.every((w) => w.hidden);
    shell.classList.toggle('is-empty', empty);
    desktopToggle.setAttribute('aria-pressed', String(empty));
    desktopToggle.setAttribute('aria-label', empty ? 'Restore open windows' : 'Show desktop');
  };
  const front = (w) => {
    if (w.hidden) return;
    active = w.dataset.window;
    w.style.zIndex = String(++z);
    sync();
  };
  const focusTitle = (w) => {
    w.querySelector('h2').focus({ preventScroll: !compact() });
    if (compact()) w.scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  const open = (id) => {
    const w = get(id);
    w.hidden = false;
    w.dataset.state = 'open';
    front(w);
    focusTitle(w);
    startMenu.close();
    announce(name(w) + ' selected.');
  };
  const hide = (w, state) => {
    w.hidden = true;
    w.dataset.state = state;
    w.querySelector('video')?.pause();
    active =
      windows.filter((x) => !x.hidden).sort((a, b) => +b.style.zIndex - +a.style.zIndex)[0]?.dataset
        .window || '';
    sync();
    const target =
      state === 'minimized'
        ? tasks.find((t) => t.dataset.task === w.dataset.window)
        : icons.find((i) => i.dataset.open === w.dataset.window);
    target.focus({ preventScroll: true });
    announce(name(w) + ' ' + state + '.');
  };
  const setMaximized = (w, maximized) => {
    w.classList.toggle('is-maximized', maximized);
    w.querySelector('[data-window-action="maximize"]').setAttribute(
      'aria-label',
      (maximized ? 'Restore ' : 'Maximize ') + name(w),
    );
  };
  const maximize = (w) => {
    if (compact()) return;
    arranged = false;
    setMaximized(w, !w.classList.contains('is-maximized'));
    front(w);
  };
  const layout = () => {
    // Use viewport dimensions, not the current page scrollbar, so rotating or
    // resizing reaches the same arrangement as opening the page at that size.
    const flowing = !fitsDesktop(window.innerWidth, window.innerHeight - TASKBAR_HEIGHT);
    const changed = flowing !== compact();
    shell.classList.toggle('is-flowing', flowing);
    if (changed) {
      arranged = true;
      windows.forEach((w) => setMaximized(w, false));
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    root.querySelector('.r95-desktop-heading span').textContent = flowing
      ? 'Scroll for more. Select an icon to jump.'
      : 'Make yourself at home.';
    root.querySelector('#window-help').textContent = flowing
      ? 'Windows follow the page as you scroll. Select a desktop icon or taskbar app to jump to it. Arrange restores the latest updates.'
      : 'Drag the title bar to move. With the title focused, use arrow keys to move, Shift for larger steps, or Enter to maximize. Escape closes Start.';
    if (compact()) return;
    if (arranged) {
      const boxes = initialLayout(workspace.clientWidth, workspace.clientHeight);
      windows.forEach((w) => setBox(w, boxes[w.dataset.window]));
      shell.style.setProperty('--content-left', boxes.events.left + 'px');
    } else {
      windows.forEach((w) => {
        const normal = Object.fromEntries(
          ['left', 'top', 'width', 'height'].map((k) => [k, parseFloat(w.style[k]) || 0]),
        );
        setBox(w, fitWindow(w, normal));
      });
    }
  };
  const arrange = () => {
    arranged = true;
    windows.forEach((w) => {
      if (latestApps.includes(w.dataset.window)) {
        w.hidden = false;
        w.dataset.state = 'open';
      } else if (!w.hidden) {
        w.hidden = true;
        w.dataset.state = 'minimized';
      }
      setMaximized(w, false);
    });
    layout();
    front(get('events'));
    startMenu.close();
    focusTitle(get('events'));
    announce('Windows arranged: Events, Project Explorer, The AI Review, then AI Lab.');
  };
  const click = (e) => {
    const opener = e.target.closest('[data-open]');
    if (opener) return open(opener.dataset.open);
    const task = e.target.closest('[data-task]');
    if (task) {
      const w = get(task.dataset.task);
      return !compact() && !w.hidden && active === task.dataset.task
        ? hide(w, 'minimized')
        : open(task.dataset.task);
    }
    const control = e.target.closest('[data-window-action]');
    if (control) {
      const w = control.closest('[data-window]');
      return control.dataset.windowAction === 'maximize'
        ? maximize(w)
        : hide(w, control.dataset.windowAction === 'close' ? 'closed' : 'minimized');
    }
    if (e.target.closest('[data-arrange]')) return arrange();
    if (e.target.closest('.r95-show-desktop')) {
      const showing = windows.some((w) => !w.hidden);
      if (showing) desktopWindows = windows.filter((w) => !w.hidden);
      windows.forEach((w) => {
        if (showing && !w.hidden) {
          w.hidden = true;
          w.dataset.state = 'minimized';
          w.querySelector('video')?.pause();
        } else if (
          !showing &&
          w.dataset.state === 'minimized' &&
          (!desktopWindows || desktopWindows.includes(w))
        ) {
          w.hidden = false;
          w.dataset.state = 'open';
        }
      });
      if (!showing) desktopWindows = null;
      sync();
    }
  };
  const key = (e) => {
    if (e.defaultPrevented) return;
    const title = e.target.closest('.r95-titlebar h2');
    const handle = e.target.closest('.r95-resize');
    if ((!title && !handle) || compact()) return;
    const w = e.target.closest('[data-window]');
    if (title && e.key === 'Enter') {
      maximize(w);
      e.preventDefault();
      return;
    }
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) ||
      w.classList.contains('is-maximized')
    )
      return;
    const box = boxOf(w),
      step = e.shiftKey ? LARGE_KEYBOARD_STEP : KEYBOARD_STEP;
    arranged = false;
    const horizontal = ['ArrowLeft', 'ArrowRight'].includes(e.key);
    const delta = ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -step : step;
    box[handle ? (horizontal ? 'width' : 'height') : horizontal ? 'left' : 'top'] += delta;
    if (handle) {
      box.width = Math.min(box.width, area().width - box.left);
      box.height = Math.min(box.height, area().height - box.top);
    }
    setBox(w, fitWindow(w, box));
    e.preventDefault();
  };
  const focus = (e) => {
    const w = e.target.closest('[data-window]');
    if (w && w.dataset.window !== active) front(w);
  };
  const beginGesture = (e) => {
    if (gesture) return;
    const w = e.target.closest('[data-window]');
    if (w) front(w);
    const handle = e.target.closest('.r95-resize');
    const bar = e.target.closest('.r95-titlebar');
    if (
      (!handle && (!bar || e.target.closest('button'))) ||
      compact() ||
      !w ||
      w.classList.contains('is-maximized') ||
      e.button !== 0
    )
      return;
    const target = handle || bar;
    gesture = {
      w,
      target,
      resize: !!handle,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      box: boxOf(w),
    };
    target.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const updateGesture = (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    arranged = false;
    const { w, box, resize, x, y } = gesture;
    let next;
    if (resize)
      next = {
        ...box,
        width: Math.min(area().width - box.left, box.width + e.clientX - x),
        height: Math.min(area().height - box.top, box.height + e.clientY - y),
      };
    else next = { ...box, left: box.left + e.clientX - x, top: box.top + e.clientY - y };
    setBox(w, fitWindow(w, next));
  };
  const endGesture = (e) => {
    if (e && e.pointerId !== gesture?.id) return;
    const current = gesture;
    gesture = null;
    if (current?.target.hasPointerCapture(current.id))
      current.target.releasePointerCapture(current.id);
  };
  const doubleClick = (e) => {
    if (e.target.closest('.r95-titlebar') && !e.target.closest('button'))
      maximize(e.target.closest('[data-window]'));
  };
  const resize = () => {
    endGesture();
    layout();
    startMenu.reposition();
  };
  const clock = () => {
    const now = new Date(),
      time = root.querySelector('.r95-clock time');
    time.dateTime = now.toISOString();
    time.textContent = clockFormat.format(now);
  };
  const listeners = {
    click,
    keydown: key,
    focusin: focus,
    pointerdown: beginGesture,
    pointermove: updateGesture,
    pointerup: endGesture,
    pointercancel: endGesture,
    lostpointercapture: endGesture,
    dblclick: doubleClick,
  };
  Object.entries(listeners).forEach(([type, handler]) => shell.addEventListener(type, handler));
  window.addEventListener('resize', resize);
  layout();
  front(get('events'));
  clock();
  const timer = setInterval(clock, CLOCK_INTERVAL_MS);
  return () => {
    endGesture();
    startMenu.destroy();
    clearInterval(timer);
    Object.entries(listeners).forEach(([type, handler]) =>
      shell.removeEventListener(type, handler),
    );
    window.removeEventListener('resize', resize);
  };
}
