export function mountTextFormatting(form) {
  for (const name of [
    'summary',
    'targetAudience',
    'learningOutcomes',
    'agenda',
    'preparation',
    'surveyIntro',
  ]) {
    const input = form.elements.namedItem(name);
    if (!input) continue;
    const label = input.closest('label'),
      caption = label.textContent.trim();
    const lines = ['learningOutcomes', 'agenda', 'preparation'].includes(name);
    input.id ||= 'event-text-' + name;
    label.htmlFor = input.id;
    const editor = document.createElement('div');
    editor.className = 'formatting-editor';
    label.after(editor);
    const toolbar = document.createElement('div');
    toolbar.className = 'formatting-toolbar';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Format ' + caption);
    const hint = document.createElement('p');
    hint.className = 'hint formatting-hint';
    hint.id = input.id + '-hint';
    hint.textContent =
      name === 'agenda'
        ? 'One item per line. Add a duration like “20 minutes · Welcome · Meet the team”.'
        : lines
          ? 'One item per line. Select text to format it; Preview shows the result.'
          : 'Select text to format it. Leave a blank line between paragraphs. Preview shows the result.';
    input.setAttribute('aria-describedby', hint.id);
    editor.append(toolbar, input, hint);
    function apply(style) {
      const original = input.value;
      let start = input.selectionStart,
        end = input.selectionEnd;
      let selected = original.slice(start, end),
        replacement;
      if (style === 'bold' || style === 'italic') {
        const marker = style === 'bold' ? '**' : '*';
        const text = selected || 'text';
        if (
          text.startsWith(marker) &&
          text.endsWith(marker) &&
          text.length > marker.length * 2
        )
          replacement = text.slice(marker.length, -marker.length);
        else replacement = marker + text + marker;
      } else {
        if (end > start && original[end - 1] === '\n') end--;
        start = start === 0 ? 0 : original.lastIndexOf('\n', start - 1) + 1;
        const next = original.indexOf('\n', end);
        end = next === -1 ? original.length : next;
        selected =
          original.slice(start, end) ||
          (style === 'heading' ? 'Heading' : 'List item');
        replacement = selected
          .split('\n')
          .map((line, index) => {
            const content = line.replace(
              /^(?:#{2,3}\s+|[-*]\s+|\d+[.)]\s+)/,
              '',
            );
            return (
              (style === 'heading'
                ? '## '
                : style === 'bullets'
                  ? '- '
                  : String(index + 1) + '. ') + content
            );
          })
          .join('\n');
      }
      if (
        input.maxLength > 0 &&
        original.length - (end - start) + replacement.length > input.maxLength
      ) {
        hint.textContent =
          'This field is at its text limit. Shorten it before adding formatting.';
        return;
      }
      input.setRangeText(replacement, start, end, 'select');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus({ preventScroll: true });
    }
    const options = [
      ['bold', 'Bold'],
      ['italic', 'Italic'],
      ...(!lines
        ? [
            ['heading', 'Heading'],
            ['bullets', 'Bullets'],
            ['numbered', 'Numbered list'],
          ]
        : []),
    ];
    for (const [style, text] of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = text;
      button.setAttribute('aria-label', text + ' in ' + caption);
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () => apply(style);
      toolbar.append(button);
    }
    input.addEventListener('keydown', (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        ['b', 'i'].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        apply(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
      }
    });
  }
}
