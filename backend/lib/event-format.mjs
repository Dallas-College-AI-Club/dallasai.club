const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );
// A deliberately small text format: never accept HTML, images, or executable links.
export function eventInline(value, depth = 0) {
  const text = String(value ?? '');
  if (depth > 3) return escape(text);
  const tokens = /\*\*([^\n]+?)\*\*|\*([^*\n]+?)\*/g;
  let html = '',
    offset = 0;
  for (const match of text.matchAll(tokens)) {
    html += escape(text.slice(offset, match.index));
    const tag = match[1] === undefined ? 'em' : 'strong';
    html +=
      '<' +
      tag +
      '>' +
      eventInline(match[1] ?? match[2], depth + 1) +
      '</' +
      tag +
      '>';
    offset = match.index + match[0].length;
  }
  return html + escape(text.slice(offset));
}
export function eventText(value) {
  const lines = String(value ?? '')
    .replaceAll('\r\n', '\n')
    .split('\n');
  let html = '',
    paragraph = [],
    list = '';
  function flush() {
    if (paragraph.length)
      html +=
        '<p>' +
        paragraph.map((line) => eventInline(line)).join('<br>') +
        '</p>';
    paragraph = [];
  }
  function closeList() {
    if (list) html += '</' + list + '>';
    list = '';
  }
  for (const line of lines) {
    const heading = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    const item = /^(?:([-*])\s+|\d+[.)]\s+)(.+)$/.exec(line.trim());
    if (!line.trim()) {
      flush();
      closeList();
    } else if (heading) {
      flush();
      closeList();
      const tag = heading[1].length === 2 ? 'h3' : 'h4';
      html += '<' + tag + '>' + eventInline(heading[2]) + '</' + tag + '>';
    } else if (item) {
      flush();
      const type = item[1] ? 'ul' : 'ol';
      if (list !== type) {
        closeList();
        list = type;
        html += '<' + list + '>';
      }
      html += '<li>' + eventInline(item[2]) + '</li>';
    } else {
      closeList();
      paragraph.push(line);
    }
  }
  flush();
  closeList();
  return html;
}
export function eventList(values) {
  return (
    '<ul>' +
    values
      .map(
        (value) =>
          '<li>' +
          eventInline(value.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '')) +
          '</li>',
      )
      .join('') +
    '</ul>'
  );
}
export function eventAgenda(values) {
  return (
    '<ol class="event-agenda-list">' +
    values
      .map((value, index) => {
        const duration =
          /^\s*(\d+(?:[.,]\d+)?\s*(?:minutes?|mins?|hours?|hrs?))\s*[·—–:|]\s*(.+)$/i.exec(
            value,
          );
        const content = (duration ? duration[2] : value).replace(
          /^\s*(?:[-*]|\d+[.)])\s+/,
          '',
        );
        const [title, ...description] = content.split(/\s+·\s+/);
        return (
          '<li><span class="agenda-duration">' +
          (duration
            ? escape(duration[1])
            : String(index + 1).padStart(2, '0')) +
          '</span><div><strong>' +
          eventInline(title) +
          '</strong>' +
          (description.length
            ? '<p>' + eventInline(description.join(' · ')) + '</p>'
            : '') +
          '</div></li>'
        );
      })
      .join('') +
    '</ol>'
  );
}

export function eventPlainText(value) {
  return String(value ?? '')
    .replace(
      /\*\*([^\n]+?)\*\*|\*([^*\n]+?)\*/g,
      (_, bold, italic) => bold ?? italic,
    )
    .replace(/^#{2,3}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
// These options represent the entire answer, including when Other is offered.
export const exclusiveSurveyChoice = (value, question) =>
  question?.exclusiveOption !== undefined
    ? value === question.options[question.exclusiveOption]
    : /^(any of (these|the above)$|none\b|not sure\b)/i.test(
        String(value).trim(),
      );
