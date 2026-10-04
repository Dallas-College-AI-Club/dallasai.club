// DOM helpers shared by the Club Office modules.
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
