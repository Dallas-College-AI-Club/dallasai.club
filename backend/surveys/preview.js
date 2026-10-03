const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
export function renderPreview({ definition, expiresAt }, link) {
  const main = document.querySelector('#main'),
    nav = document.querySelector('#nav');
  document.querySelector('#who').textContent = 'Question preview · read-only';
  const questions = new Map(definition.questions.map((q) => [q.id, q]));
  function page(index) {
    const chapter = definition.chapters[index];
    main.replaceChildren();
    const badge = node(
      'p',
      'Preview · responses are not collected here',
      'eyebrow',
    );
    const title = node('h1', chapter.title);
    title.tabIndex = -1;
    main.append(badge, title, node('p', chapter.intro));
    main.append(
      node(
        'p',
        'Private link expires ' +
          new Date(expiresAt).toLocaleString('en-US', {
            timeZone: 'America/Chicago',
          }) +
          ' Central.',
        'micro',
      ),
    );
    const answer = node('a', 'Answer this survey →');
    answer.href = '/surveys/#' + new URLSearchParams({ invite: link });
    answer.onclick = () => setTimeout(() => location.reload(), 0);
    main.append(answer);
    for (const id of index === 4
      ? ['ideal_responsibilities']
      : [...chapter.core, ...chapter.optional]) {
      const q = questions.get(id),
        section = node('section', undefined, 'question');
      section.append(node('h2', q.title), node('p', q.prompt));
      if (chapter.optional.includes(id))
        section.append(node('p', 'Optional', 'pill'));
      if (q.id === 'priority')
        section.append(
          node(
            'p',
            'Shown when a valid positive weekly time range is entered.',
            'helper',
          ),
        );
      if (q.type === 'rank')
        section.append(
          node(
            'p',
            'Rank any priorities, use ties, or add your own.',
            'helper',
          ),
        );
      if (q.options) {
        const list = node('ul');
        for (const option of q.options) {
          const li = node('li', option.label);
          if (option.description) li.append(node('p', option.description));
          if (option.link) {
            const a = node('a', option.link.label + ' ↗');
            a.href = option.link.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            li.append(a);
          }
          list.append(li);
        }
        section.append(list);
      }
      if (q.left)
        section.append(
          node('p', `${q.left} ↔ ${q.right}`),
          node('p', 'Middle: ' + q.midpoint),
          node(
            'p',
            'Also available: It depends; My own arrangement; Not this term.',
          ),
        );
      if (q.type === 'weekly')
        section.append(
          node(
            'p',
            'Minimum and maximum hours per week, including zero. Alternatively: no recurring weekly time, discuss each invitation, or a custom arrangement.',
          ),
        );
      if (q.type === 'resources')
        section.append(
          node(
            'p',
            'For each resource: ' +
              q.statuses.map((s) => s.label).join('; ') +
              ', or your own conditions. Nothing to offer this term and discuss possibilities are also available.',
          ),
        );
      if (q.context) {
        section.append(node('h3', q.context.title));
        for (const p of q.context.paragraphs || [q.context.body])
          if (p) section.append(node('p', p));
        if (q.context.link) {
          const a = node('a', q.context.link.label + ' ↗');
          a.href = q.context.link.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          section.append(a);
        }
      }
      main.append(section);
    }
    if (chapter.note)
      main.append(
        node('h2', chapter.note),
        node('p', chapter.note_help + ' (Optional)'),
      );
    if (index === 4) {
      main.append(
        node('h2', 'Review each response'),
        node(
          'p',
          'Each answer has two independent, initially unchecked choices: “I reviewed this wording.” and “Include in shared summary.” Only selected, reviewed responses are submitted after confirming the audience. Edited summaries share wording only.',
        ),
        node(
          'p',
          'You can download full personal Word and Markdown copies, including answers you do not share.',
        ),
      );
    }
    for (const b of nav.querySelectorAll('button'))
      b.setAttribute(
        'aria-current',
        Number(b.dataset.page) === index ? 'step' : 'false',
      );
    title.focus({ preventScroll: true });
    main.scrollIntoView({ block: 'start' });
  }
  nav.replaceChildren();
  definition.chapters.forEach((c, i) => {
    const button = node('button', c.title, 'navitem');
    button.dataset.page = i;
    button.onclick = () => page(i);
    nav.append(button);
  });
  page(0);
}
