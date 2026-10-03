const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
export function partitionResponses(results) {
  const submitted = results.filter((r) => r.revision && r.responses?.length);
  return {
    active: submitted.filter((r) => r.active !== false),
    archived: submitted.filter((r) => r.active === false),
  };
}
export function responseSections(
  results,
  { includeArchived = false, definition } = {},
) {
  const root = node('div', undefined, 'response-groups'),
    groups = partitionResponses(results);
  const questions = definition?.questions || [],
    chapters = definition?.chapters || [];
  const order = chapters.length
    ? chapters.flatMap((c) =>
        [...(c.core || []), ...(c.optional || [])]
          .map((id) => 'q-' + id)
          .concat('note-' + c.id),
      )
    : questions.map((q) => q.id);
  const rank = (a) => {
    let i = order.indexOf(a.id);
    if (i < 0 && a.questionId) i = order.indexOf('q-' + a.questionId);
    return i < 0 ? order.length : i;
  };
  function person(result, open) {
    const details = node('details', undefined, 'response-person');
    details.open = open;
    const summary = node('summary');
    summary.append(
      node('strong', result.display_name),
      node(
        'span',
        `${result.responses.length} ${result.responses.length === 1 ? 'answer' : 'answers'} · ${new Date(result.submitted_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Central`,
        'response-meta',
      ),
    );
    details.append(summary);
    const body = node('div', undefined, 'response-body');
    let lastGroup;
    for (const answer of [...result.responses].sort(
      (a, b) => rank(a) - rank(b),
    )) {
      const chapter = chapters.find((c) => c.id === answer.group);
      if (chapter && lastGroup !== chapter.id) {
        body.append(node('h3', chapter.title, 'response-chapter'));
        lastGroup = chapter.id;
      }
      const card = node('section', undefined, 'response-answer');
      card.append(node('h4', answer.title), node('p', answer.text));
      if (answer.mode === 'narrative')
        card.append(node('small', 'Shared wording only', 'response-meta'));
      if (answer.mode === 'structured' && answer.answer?.mode === 'value')
        card.append(
          node(
            'small',
            `Dial position: ${answer.answer.value} of 100.`,
            'response-meta',
          ),
        );
      body.append(card);
    }
    details.append(body);
    return details;
  }
  if (!groups.active.length)
    root.append(
      node(
        'p',
        'No active respondents have submitted answers yet.',
        'response-empty',
      ),
    );
  for (const r of groups.active)
    root.append(person(r, groups.active.length === 1));
  if (includeArchived && groups.archived.length) {
    const archive = node('details', undefined, 'response-archive');
    archive.append(
      node('summary', `Archived responses (${groups.archived.length})`),
      node(
        'p',
        'Saved responses from archived respondents. Their survey access has ended.',
        'response-meta',
      ),
    );
    for (const r of groups.archived) archive.append(person(r, false));
    root.append(archive);
  }
  return root;
}
