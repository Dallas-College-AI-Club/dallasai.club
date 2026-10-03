// DOM helpers shared by the Club Office modules.
export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
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
