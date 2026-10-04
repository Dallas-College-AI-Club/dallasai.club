export function sameChoice(q, own, peer) {
  if (
    !['choice', 'multi_choice'].includes(q?.type) ||
    own.mode !== 'structured' ||
    peer?.mode !== 'structured' ||
    own.stale ||
    own.empty
  )
    return false;
  const values = (answer) =>
    q.type === 'choice' ? [answer?.value] : answer?.values || [];
  const a = values(own.answer),
    b = values(peer.answer);
  // Custom option IDs belong to their author; "usual" refers to another answer.
  return (
    a.length > 0 &&
    a.every((id) => id !== 'usual' && q.options.some((o) => o.id === id)) &&
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  );
}
export function toggleAllResponses(fields, review, flag, added) {
  if (!['reviewed', 'included'].includes(flag))
    throw Error('Unknown review action.');
  let count = 0;
  const undo = added.size > 0;
  if (undo) {
    for (const id of added) {
      if (review[id]?.[flag]) {
        review[id][flag] = false;
        count++;
      }
    }
    added.clear();
    return { count, undo };
  }
  for (const field of fields) {
    if (
      !field.stale &&
      field.text.trim() &&
      !field.archived &&
      !review[field.id][flag]
    ) {
      review[field.id][flag] = true;
      added.add(field.id);
      count++;
    }
  }
  return { count, undo };
}
export function fullResponseFilename(
  formName,
  respondentName,
  extension,
  date = new Date(),
) {
  if (!['docx', 'md'].includes(extension))
    throw Error('Unsupported export format.');
  const part = (value, fallback) =>
    String(value || fallback)
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
      .trim()
      .replace(/[\s_.]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70) || fallback;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${part(formName, 'Survey')}-full-response_${part(respondentName, 'Respondent')}_${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}-CT.${extension}`;
}
