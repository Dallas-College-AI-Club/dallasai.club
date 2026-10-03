import definition from '../surveys/advisor-definition.json' with { type: 'json' };
import { RequestError } from './errors.mjs';
export { definition };
const questions = new Map(definition.questions.map((q) => [q.id, q]));
const bad = () => {
  throw new RequestError(400, 'Review the selected answers and try again.');
};
export function closed(value, keys, required = keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    required.some((k) => !Object.hasOwn(value, k))
  )
    bad();
}
function text(value, max = 12000, empty = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim())
  )
    bad();
  return value.trim();
}
function dial(q, answer) {
  if (answer.mode === 'value') {
    closed(answer, ['mode', 'value']);
    const v = answer.value;
    if (!Number.isInteger(v) || v < 0 || v > 100 || v % 5) bad();
    if (v === 50) return q.midpoint;
    if (v === 0) return q.left;
    if (v === 100) return q.right;
    return (
      (Math.abs(v - 50) <= 15
        ? 'Slightly favoring: '
        : Math.abs(v - 50) <= 35
          ? 'More emphasis on: '
          : 'Strongly favoring: ') + (v < 50 ? q.left : q.right)
    );
  }
  if (!q.special.includes(answer.mode)) bad();
  closed(answer, ['mode', 'text'], ['mode']);
  const detail = answer.text === undefined ? '' : text(answer.text, 700, true);
  if (answer.mode === 'not_now' && detail) bad();
  return (
    {
      depends: 'Depends on the situation',
      custom: 'My own arrangement',
      not_now: 'Not this term',
    }[answer.mode] + (detail ? '\n' + detail : '')
  );
}
function responseMeta(item) {
  const q = questions.get(item.questionId);
  if (item.kind === 'comment') {
    const page = definition.chapters
      .slice(0, 4)
      .find((c) => c.id === item.pageId);
    if (
      !page ||
      item.id !== 'note-' + page.id ||
      item.questionId ||
      item.optionId ||
      item.mode !== 'narrative'
    )
      bad();
    return { title: 'My thoughts — ' + page.title, group: page.id };
  }
  if (!q || item.pageId) bad();
  const group =
    definition.chapters.find((c) => [...c.core, ...c.optional].includes(q.id))
      ?.id || 'review';
  if (item.kind === 'question') {
    if (item.id !== 'q-' + q.id || item.optionId || q.type === 'focus_group')
      bad();
    return { q, title: q.title, group };
  }
  if (
    item.kind === 'concern' &&
    q.id === 'concern_focus' &&
    item.id === 'focus-' + item.optionId
  )
    return {
      q,
      title: 'How I would like to help',
      group,
      options: questions.get('concerns').options,
    };
  if (
    item.kind === 'resource' &&
    q.id === 'resources' &&
    item.id === 'resource-' + item.optionId
  )
    return { q, title: 'Possible resource', group, options: q.options };
  bad();
}
export function canonicalResponse(item) {
  const keys = [
    'id',
    'kind',
    'questionId',
    'optionId',
    'pageId',
    'mode',
    'text',
    'wordingReviewed',
    'included',
  ];
  closed(
    item,
    [
      ...keys,
      ...(item.mode === 'structured' ? ['answer', 'customOptions'] : []),
    ],
    ['id', 'kind', 'mode', 'text', 'wordingReviewed', 'included'],
  );
  if (
    item.wordingReviewed !== true ||
    item.included !== true ||
    !['narrative', 'structured'].includes(item.mode)
  )
    bad();
  const meta = responseMeta(item),
    q = meta.q;
  const wording = text(
    item.text,
    item.kind === 'comment'
      ? 700
      : item.questionId === 'ideal_responsibilities'
        ? 2000
        : 12000,
  );
  // Narrative edits deliberately carry no source value or custom label metadata.
  if (item.mode === 'narrative') {
    if (
      item.optionId &&
      !(meta.options || []).some((o) => o.id === item.optionId) &&
      !/^custom_[a-zA-Z0-9_-]{1,100}$/.test(item.optionId)
    )
      bad();
    return { ...item, text: wording, title: meta.title, group: meta.group };
  }
  const a = item.answer;
  if (!a || typeof a !== 'object' || Array.isArray(a)) bad();
  if (!Array.isArray(item.customOptions) || item.customOptions.length > 30)
    bad();
  const options = new Map(
    (meta.options || q.options || []).map((o) => [o.id, o.label]),
  );
  const custom = new Set(),
    used = new Set();
  for (const o of item.customOptions) {
    closed(o, ['id', 'label']);
    if (
      !q.allow_custom ||
      typeof o.id !== 'string' ||
      !/^custom_[a-zA-Z0-9_-]{1,100}$/.test(o.id) ||
      options.has(o.id)
    )
      bad();
    options.set(o.id, text(o.label, 160));
    custom.add(o.id);
  }
  const label = (id) => {
    if (!options.has(id)) bad();
    used.add(id);
    return options.get(id);
  };
  let generated,
    title = meta.title;
  if (item.kind === 'concern') {
    title += ' — ' + label(item.optionId);
    generated = dial(q, a);
  } else if (item.kind === 'resource') {
    title += ' — ' + label(item.optionId);
    closed(a, ['status', 'text'], ['status']);
    if (a.status === 'custom')
      generated =
        text(a.text, 700, true) || 'My own conditions; details to discuss.';
    else {
      if (Object.hasOwn(a, 'text')) bad();
      generated =
        a.status === 'unspecified'
          ? 'Offering conditions not specified yet.'
          : q.statuses.find((s) => s.id === a.status)?.label;
      if (!generated) bad();
    }
  } else if (q.type === 'rank') {
    closed(a, ['mode', 'groups']);
    if (!Array.isArray(a.groups) || a.groups.length > 40) bad();
    if (a.mode === 'rank') {
      const seen = new Set();
      if (!a.groups.length) bad();
      generated = a.groups
        .map((g, i) => {
          if (!Array.isArray(g) || !g.length || g.length > 40) bad();
          const labels = g.map((id) => {
            if (seen.has(id)) bad();
            seen.add(id);
            return label(id);
          });
          return `${i + 1}. ${labels.join(' / ')}${g.length > 1 ? ' (tied)' : ''}`;
        })
        .join('\n');
    } else {
      if (
        a.groups.length ||
        !(q.statuses || ['rank', 'no_order', 'not_now']).includes(a.mode)
      )
        bad();
      generated = {
        no_order: 'No meaningful ordering was expressed.',
        none: 'No additional personal or professional benefit is needed.',
        private: 'Prefers not to answer.',
        not_now:
          q.id === 'concerns'
            ? 'None of these is a priority for me right now.'
            : 'Not a focus this term.',
      }[a.mode];
    }
  } else if (q.type === 'slider') generated = dial(q, a);
  else if (q.type === 'text') {
    closed(a, ['text']);
    generated = text(a.text, q.max_length || 700);
  } else if (q.type === 'weekly') {
    if (a.mode === 'range') {
      closed(a, ['mode', 'min', 'max']);
      if (
        ![a.min, a.max].every(
          (n) =>
            Number.isFinite(n) &&
            n >= 0 &&
            n <= 168 &&
            Math.round(n * 4) === n * 4,
        ) ||
        a.min > a.max
      )
        bad();
      generated = `${a.min}–${a.max} hours per ordinary week, including routine meetings, preparation, messages, and review. Extra event time is discussed separately.`;
    } else if (a.mode === 'custom') {
      closed(a, ['mode', 'text']);
      generated =
        text(a.text, 700, true) || 'A custom arrangement; details to discuss.';
    } else {
      closed(a, ['mode']);
      generated = {
        none: 'No recurring weekly time.',
        case: 'Discuss time for each invitation.',
      }[a.mode];
    }
  } else if (q.type === 'choice') {
    closed(a, ['value']);
    generated = label(a.value);
  } else if (q.type === 'multi_choice') {
    closed(a, ['values']);
    if (
      !Array.isArray(a.values) ||
      !a.values.length ||
      a.values.length > 40 ||
      new Set(a.values).size !== a.values.length ||
      (a.values.length > 1 &&
        (q.exclusive_options || []).some((v) => a.values.includes(v)))
    )
      bad();
    generated = a.values
      .map((v) => {
        const l = label(v);
        return q.id === 'event_contact' && v === 'usual'
          ? 'Use my availability-check route from the second page (refer to that response if shared; otherwise confirm with me).'
          : l;
      })
      .join('\n');
  } else if (q.type === 'resources') {
    closed(a, ['mode', 'items']);
    closed(a.items, []);
    generated = {
      not_now: 'Nothing to offer this term.',
      discuss: 'Discuss possibilities first.',
    }[a.mode];
  } else bad();
  if (
    !generated ||
    generated.trim() !== wording ||
    [...custom].some((id) => !used.has(id))
  )
    bad();
  return { ...item, text: generated.trim(), title, group: meta.group };
}
export function validateSubmission(body, member, others, version) {
  closed(body, [
    'format',
    'contentVersion',
    'advisorId',
    'consent',
    'responses',
    'requestId',
    'expectedRevision',
  ]);
  if (
    body.format !== 'advisor-studio-shared/9' ||
    body.contentVersion !== version ||
    version !== definition.content_version ||
    body.advisorId !== member.advisor_id ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.requestId) ||
    !Number.isInteger(body.expectedRevision) ||
    body.expectedRevision < 0
  )
    bad();
  closed(body.consent, ['reviewed', 'audience']);
  const audience = ['club_officers', ...others.map((m) => m.advisor_id)].sort();
  if (
    body.consent.reviewed !== true ||
    !Array.isArray(body.consent.audience) ||
    JSON.stringify([...body.consent.audience].sort()) !==
      JSON.stringify(audience)
  )
    bad();
  if (
    !Array.isArray(body.responses) ||
    !body.responses.length ||
    body.responses.length > 120 ||
    body.responses.some((r) => !r || typeof r !== 'object') ||
    new Set(body.responses.map((r) => r.id)).size !== body.responses.length
  )
    bad();
  return body.responses
    .map(canonicalResponse)
    .sort((a, b) => a.id.localeCompare(b.id));
}
