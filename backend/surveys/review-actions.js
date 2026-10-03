export function markAllResponses(fields, review, flag) {
  if (!['reviewed', 'included'].includes(flag))
    throw Error('Unknown review action.');
  let count = 0;
  for (const field of fields) {
    if (!field.stale && field.text.trim() && !field.archived) {
      review[field.id][flag] = true;
      count++;
    }
  }
  return count;
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
