const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
export function partitionResponses(results) {
  const submitted = results.filter(
    (r) =>
      r.revision &&
      Array.isArray(r.responses) &&
      (r.responses.length ||
        (r.response_definition?.questions?.length &&
          !r.response_definition?.chapters?.length)),
  );
  return {
    active: submitted.filter((r) => r.active !== false),
    archived: submitted.filter((r) => r.active === false),
  };
}
// An answer's place in the survey: chapter by chapter for Advisor Studio,
// question by question for builder surveys. Unknown answers go last.
export function answerRank(definition) {
  const chapters = definition?.chapters || [];
  const order = chapters.length
    ? chapters.flatMap((c) =>
        [...(c.core || []), ...(c.optional || [])]
          .map((id) => 'q-' + id)
          .concat('note-' + c.id),
      )
    : (definition?.questions || []).map((q) => q.id);
  return (a) => {
    let i = order.indexOf(a.id);
    if (i < 0 && a.questionId) i = order.indexOf('q-' + a.questionId);
    return i < 0 ? order.length : i;
  };
}
// How a saved answer reads: a numbered ranking ('1. …' lines), a list of
// chosen options, or text, plus the dial position when there is one. One ''
// line marks each paragraph break (a blank line). The downloads use this so
// they match the screen.
export function answerFormat(answer, definition) {
  const question = definition?.questions?.find(
      (q) => q.id === (answer.questionId ?? answer.id),
    ),
    structured = answer.mode === 'structured' || answer.mode === 'form';
  return {
    kind: !structured
      ? 'text'
      : question?.type === 'rank' && answer.answer?.mode === 'rank'
        ? 'ranked'
        : ['multi_choice', 'multiple'].includes(question?.type)
          ? 'choices'
          : 'text',
    lines: String(answer.text ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line, i, all) =>
          line || (all[i - 1] && all.slice(i + 1).some(Boolean)),
      ),
    dial:
      answer.mode === 'structured' && answer.answer?.mode === 'value'
        ? answer.answer.value
        : undefined,
  };
}
// 'Advisor Studio — Fall 2026' → 'advisor-studio-fall-2026', for file names.
export const fileSlug = (text) =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
export function responseSections(
  results,
  { definition, actions, view = 'active' } = {},
) {
  const root = node('div', undefined, 'response-groups'),
    groups = partitionResponses(results);
  const shown =
    view === 'all'
      ? [...groups.active, ...groups.archived]
      : view === 'archived'
        ? groups.archived
        : groups.active;
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
    if (actions) body.append(actions(result));
    const savedDefinition = result.response_definition || definition;
    const savedRank = answerRank(savedDefinition),
      chapters = savedDefinition?.chapters || [],
      answers = [...result.responses];
    if (!chapters.length)
      for (const question of savedDefinition?.questions || [])
        if (!answers.some((answer) => answer.id === question.id))
          answers.push({
            id: question.id,
            title:
              (question.choiceDate ? question.choiceDate + ' · ' : '') +
              question.title,
          });
    let lastGroup;
    for (const answer of answers.sort((a, b) => savedRank(a) - savedRank(b))) {
      const chapter = chapters.find((c) => c.id === answer.group);
      if (chapter && lastGroup !== chapter.id) {
        body.append(node('h3', chapter.title, 'response-chapter'));
        lastGroup = chapter.id;
      }
      const card = node('section', undefined, 'response-answer');
      card.append(
        node('h4', answer.title),
        node(
          'p',
          answer.text === '' || answer.text == null ? 'No answer' : answer.text,
        ),
      );
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
  if (!shown.length)
    root.append(
      node(
        'p',
        view === 'active'
          ? 'No active respondents have submitted answers yet.'
          : 'No matching saved responses.',
        'response-empty',
      ),
    );
  for (const r of shown) root.append(person(r, shown.length === 1));
  return root;
}
