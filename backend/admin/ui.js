// DOM helpers shared by the Club Office modules.
import { dateTime, timeAttrs } from './format.js';
import { signedInAgain } from './session.js';
export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
// h('button', { type: 'button', 'aria-pressed': 'true' }, 'Star'): names with
// a dash become attributes, everything else is set as a property. Children
// are appended as nodes or text, so data never becomes markup.
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props))
    if (name.includes('-')) element.setAttribute(name, value);
    else element[name] = value;
  element.append(
    ...children.filter((child) => child !== null && child !== undefined),
  );
  return element;
}
export function button(text, onclick, className = 'secondary') {
  const element = node('button', text, className);
  element.type = 'button';
  element.onclick = onclick;
  return element;
}
// Disables the enabled controls under root while work is in progress. The
// returned function re-enables exactly those controls, once, so controls that
// were already disabled stay disabled.
export function lock(root, selector = 'input,textarea,select,button') {
  const controls = [...root.querySelectorAll(selector)].filter(
    (control) => !control.disabled,
  );
  for (const control of controls) control.disabled = true;
  return () => {
    for (const control of controls.splice(0)) control.disabled = false;
  };
}
// Like lock(), but with aria-disabled, so the focused button keeps focus while
// its request runs. Clicks on those controls are ignored until the returned
// function runs.
export function busy(root, selector = 'button') {
  const controls = [...root.querySelectorAll(selector)].filter(
    (control) =>
      !control.disabled && control.getAttribute('aria-disabled') !== 'true',
  );
  const ignore = (event) => {
    if (!event.target.closest('[aria-disabled="true"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const control of controls) control.setAttribute('aria-disabled', 'true');
  root.setAttribute('aria-busy', 'true');
  root.addEventListener('click', ignore, true);
  return () => {
    for (const control of controls.splice(0))
      control.removeAttribute('aria-disabled');
    root.removeAttribute('aria-busy');
    root.removeEventListener('click', ignore, true);
  };
}
// Moves focus off node before it leaves the page: to the next visible
// [data-focus] in scope, else the previous one, else the nearest
// [data-focus-fallback]. Focus never drops to <body>.
export function focusFallback(node, scope = node.parentElement) {
  const targets = [...scope.querySelectorAll('[data-focus]')].filter(
    (target) => !node.contains(target) && target.getClientRects().length,
  );
  const target =
    targets.find(
      (target) =>
        node.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING,
    ) ||
    targets.findLast(
      (target) =>
        node.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_PRECEDING,
    ) ||
    scope.closest('[data-focus-fallback]') ||
    scope.closest('section')?.querySelector('[data-focus-fallback]');
  target?.focus({ preventScroll: true });
}
// Renders items into container, reusing the child with the same data-key.
// update(node, item) runs only when version(item) changed, so open <details>,
// focus and typed text in unchanged rows survive.
export function keyed(
  container,
  items,
  { key, version = (item) => item.version, create, update = () => {}, empty },
) {
  const existing = new Map();
  for (const child of [...container.children])
    if (child.dataset.key === undefined) child.remove();
    else existing.set(child.dataset.key, child);
  items.forEach((item, index) => {
    const id = String(key(item)),
      v = String(version(item));
    let element = existing.get(id);
    existing.delete(id);
    if (!element) element = create(item);
    else if (element.dataset.v !== v) update(element, item);
    element.dataset.key = id;
    element.dataset.v = v;
    const at = container.children[index] || null;
    if (at === element) return;
    const focused = element.contains(document.activeElement)
      ? document.activeElement
      : null;
    if (container.moveBefore && container.isConnected && element.isConnected)
      container.moveBefore(element, at);
    else container.insertBefore(element, at);
    if (focused && document.activeElement !== focused)
      focused.focus({ preventScroll: true });
  });
  for (const element of existing.values()) {
    if (element.contains(document.activeElement))
      focusFallback(element, container);
    element.remove();
  }
  if (!items.length && empty) container.append(empty());
}
// <time datetime=ISO title='Thu, Oct 2, 11:34 PM CT'>, showing label.
export function time(value, label = dateTime(value)) {
  return h('time', timeAttrs(value), label);
}

// One polite region, #status, always holds the latest message; screen
// readers and the browser tests read it there.
export function announce(text) {
  document.getElementById('status').textContent = text;
}
// Toasts: success and info leave after 6 s (10 s with an action), errors
// and persist toasts stay until dismissed or resolved. Timers pause on hover, while focus is
// inside and while the tab is hidden. The stack is not a live region (its
// text goes to #status) and a toast never takes focus.
const toasts = new Set();
const glyphs = { success: '✓', info: 'i', error: '!' };
export function toast({ type = 'success', text, action, key, persist }) {
  announce(text);
  for (const other of toasts) if (key && other.key === key) other.close();
  const element = h(
    'div',
    { className: 'toast toast-' + type },
    h(
      'span',
      { className: 'toast-glyph', 'aria-hidden': 'true' },
      glyphs[type],
    ),
    h('p', {}, text),
  );
  let timer = null,
    left = action ? 10000 : 6000,
    started = 0;
  const item = { type, key, persist, close };
  function close() {
    clearTimeout(timer);
    toasts.delete(item);
    // Focus on a closing toast goes to the view heading, never <body>.
    if (element.contains(document.activeElement))
      (
        [...document.querySelectorAll('#office h1')].find(
          (heading) => heading.getClientRects().length,
        ) || document.getElementById('main')
      ).focus({ preventScroll: true });
    element.remove();
  }
  item.pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    left -= Date.now() - started;
  };
  item.resume = () => {
    if (type === 'error' || persist || timer || document.hidden) return;
    if (element.matches(':hover, :focus-within')) return;
    started = Date.now();
    timer = setTimeout(close, Math.max(left, 0));
  };
  if (action)
    element.append(
      button(action.label, () => {
        close();
        action.run();
      }),
    );
  element.append(
    h(
      'button',
      {
        type: 'button',
        className: 'icon-btn btn-quiet',
        'aria-label': 'Dismiss',
        onclick: close,
      },
      '×',
    ),
  );
  element.addEventListener('mouseenter', item.pause);
  element.addEventListener('focusin', item.pause);
  element.addEventListener('mouseleave', item.resume);
  element.addEventListener('focusout', () => setTimeout(item.resume));
  toasts.add(item);
  document.getElementById('toasts').append(element);
  // At most three show at once: the oldest success or info toast goes first;
  // errors and persistent toasts stay.
  if (toasts.size > 3)
    [...toasts]
      .find(
        (other) => other !== item && other.type !== 'error' && !other.persist,
      )
      ?.close();
  item.resume();
  return { close };
}
// Closes the toasts with this key, e.g. an error whose cause has cleared.
toast.resolve = (key) => {
  for (const item of toasts) if (item.key === key) item.close();
};
// A section switch clears success and info toasts; errors and persistent
// toasts stay.
toast.dismissPassing = () => {
  for (const item of toasts)
    if (item.type !== 'error' && !item.persist) item.close();
};
document.addEventListener('visibilitychange', () => {
  for (const item of toasts) document.hidden ? item.pause() : item.resume();
});
// The stack's height joins html scroll-padding-bottom, so a toast never
// covers the focused control.
new ResizeObserver(([entry]) =>
  document.documentElement.style.setProperty(
    '--toast-h',
    entry.target.offsetHeight + 'px',
  ),
).observe(document.getElementById('toasts'));

// One shared <dialog> for confirmations that affect other people or cannot
// be undone. Resolves true when confirmed; Escape and Cancel resolve false.
// A danger dialog focuses Cancel first. cancelConfirm() answers no, e.g.
// when the session ends while it is open.
let answer = null;
export const cancelConfirm = () => answer?.(false);
export function confirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'normal',
  trigger = document.activeElement,
}) {
  const dialog = document.getElementById('confirm-dialog'),
    ok = dialog.querySelector('[data-confirm]'),
    cancel = dialog.querySelector('[data-cancel]');
  dialog.querySelector('h2').textContent = title;
  dialog.querySelector('p').textContent = body;
  ok.textContent = confirmLabel;
  ok.className = tone === 'danger' ? 'danger filled' : 'btn-primary';
  cancel.textContent = cancelLabel;
  cancelConfirm();
  return new Promise((resolve) => {
    const finish = (value) => {
      answer = ok.onclick = cancel.onclick = dialog.oncancel = null;
      // Closing returns focus to the trigger; if it has gone, to a neighbour.
      dialog.close();
      if (trigger && !trigger.getClientRects().length)
        focusFallback(trigger, document.getElementById('main'));
      resolve(value);
    };
    ok.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    answer = finish;
    dialog.showModal();
    (tone === 'danger' ? cancel : ok).focus();
  });
}

// A disclosure button for a positioned panel of plain buttons and links.
// Escape or a click outside closes it and returns focus to the button; the
// arrow keys move between items.
export function menu(trigger, panel) {
  const items = () =>
    [...panel.querySelectorAll('a[href], button')].filter(
      (item) => item.getClientRects().length,
    );
  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) items()[0]?.focus();
  }
  trigger.addEventListener('click', () => toggle());
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      toggle(false);
      trigger.focus();
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const list = items(),
      at = list.indexOf(document.activeElement);
    list[
      (at + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length
    ]?.focus();
  });
  document.addEventListener('click', (event) => {
    if (
      panel.hidden ||
      panel.contains(event.target) ||
      trigger.contains(event.target)
    )
      return;
    toggle(false);
    // A click on nothing in particular returns focus to the button.
    if (
      [document.body, document.getElementById('main')].includes(
        document.activeElement,
      )
    )
      trigger.focus();
  });
  // Focus leaving the menu closes it, so it never stays open behind focus.
  // Focus that lands on nothing in particular (a click on plain content)
  // goes back to the button.
  panel.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (panel.hidden || panel.contains(next) || next === trigger) return;
    if (!next && !document.hasFocus()) return;
    toggle(false);
    if (!next || next === document.getElementById('main')) trigger.focus();
  });
  // Following a link closes the menu.
  panel.addEventListener('click', (event) => {
    if (event.target.closest('a[href]')) toggle(false);
  });
  return { close: () => toggle(false) };
}

// Fetches a file, such as a CSV export, and saves it. A 401 waits for the
// officer to sign in again, then repeats the request. Failures throw an
// Error whose message is meant for the officer. Resolves false, saving
// nothing, when isCurrent() says the request is stale (e.g. signed out).
export async function download(
  url,
  filename,
  { container = document.body, isCurrent = () => true } = {},
) {
  const get = () =>
    fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
  let response;
  try {
    response = await get();
    if (response.status === 401) {
      await signedInAgain();
      response = await get();
    }
  } catch (error) {
    if (error.kind) throw error;
    throw new Error(
      'Couldn’t download the CSV. Check your connection and try again.',
    );
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(
      result?.error || 'Couldn’t export these records. Please try again.',
    );
  }
  if (!response.headers.get('content-type')?.startsWith('text/csv'))
    throw new Error(
      'The export service is temporarily unavailable. Please try again.',
    );
  const blob = await response.blob().catch(() => {
    throw new Error(
      'Couldn’t download the CSV. Check your connection and try again.',
    );
  });
  if (!isCurrent()) return false;
  const link = h('a', {
    href: URL.createObjectURL(blob),
    download: filename,
    hidden: true,
  });
  container.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  return true;
}
// Copies text; resolves false when the browser refuses, so the caller can
// show the text to copy by hand.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
