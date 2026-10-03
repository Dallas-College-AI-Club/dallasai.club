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
