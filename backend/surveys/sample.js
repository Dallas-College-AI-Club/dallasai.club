import { mountAdvisor } from './advisor-ui.js';

// Fictional drafts only. This module has no API or storage writer.
const samples = [
  {
    answers: {
      ideal_responsibilities: {
        text: 'I would enjoy mentoring small student teams and reviewing their prototypes. Officers can run the weekly logistics and bring project scope or outside partnerships to me first.',
      },
      spark: { mode: 'rank', groups: [['build'], ['learning']] },
      weekly: { mode: 'range', min: 1, max: 2 },
      busy_route: { values: ['teams', 'email'] },
      event_types: { mode: 'rank', groups: [['code_review'], ['showcase']] },
      event_notice: { value: 'two' },
      meeting_frequency: { value: 'fortnightly' },
      meeting_format: { value: 'teams' },
    },
    notes: {
      spark:
        'I would love to see a small student project develop over the term, with time to reflect on what the team learned.',
    },
  },
  {
    answers: {
      ideal_responsibilities: {
        text: 'I would like to connect students with industry perspectives and coach presentations. I can support occasional workshops; officers should own scheduling and routine communication.',
      },
      spark: { mode: 'rank', groups: [['learning'], ['build']] },
      weekly: { mode: 'range', min: 2, max: 3 },
      busy_route: { values: ['email', 'teams'] },
      event_types: { mode: 'rank', groups: [['industry'], ['showcase']] },
      event_notice: { value: 'two' },
      meeting_frequency: { value: 'monthly' },
      meeting_format: { value: 'teams' },
      resources: {
        mode: 'select',
        items: { materials: 'custom' },
        details: {
          materials:
            'Happy to discuss possibilities for a specific student project.',
        },
      },
    },
    notes: {
      spark:
        'I would find it rewarding to see students become comfortable presenting their work to people outside the club.',
    },
  },
];

export function renderSample({ definition }) {
  const params = new URLSearchParams(location.hash.slice(1));
  const people = definition.respondents;
  const index = Math.max(
    0,
    people.findIndex((p) => p.id === params.get('sample')),
  );
  const person = people[index],
    peer = people[1 - index];
  const other = samples[1 - index];
  const questions = new Map(definition.questions.map((q) => [q.id, q]));
  const responses = Object.entries(other.answers).flatMap(([id, answer]) => {
    const question = questions.get(id);
    const group =
      definition.chapters.find((chapter) =>
        [...chapter.core, ...chapter.optional].includes(id),
      )?.id || 'review';
    const label = (value) => question.options.find((o) => o.id === value).label;
    if (question.type === 'resources')
      return Object.keys(answer.items).map((optionId) => ({
        id: 'resource-' + optionId,
        questionId: id,
        optionId,
        kind: 'resource',
        group,
        mode: 'narrative',
        title: 'Possible resource — ' + label(optionId),
        text: answer.details[optionId],
      }));
    const structured = ['choice', 'multi_choice'].includes(question.type);
    const text =
      answer.text ||
      (answer.groups
        ? answer.groups
            .map((g, i) => `${i + 1}. ${g.map(label).join(' / ')}`)
            .join('\n')
        : question.type === 'weekly'
          ? `${answer.min}–${answer.max} hours per ordinary week, including routine meetings, preparation, messages, and review. Extra event time is discussed separately.`
          : (answer.values || [answer.value]).map(label).join('\n'));
    return {
      id: 'q-' + id,
      questionId: id,
      kind: 'question',
      group,
      mode: structured ? 'structured' : 'narrative',
      title: question.title,
      text,
      ...(structured ? { answer } : {}),
    };
  });
  responses.push({
    id: 'note-spark',
    kind: 'comment',
    pageId: 'spark',
    group: 'spark',
    mode: 'narrative',
    title: 'My thoughts — Find your sparks',
    text: other.notes.spark,
  });
  const bootstrap = {
    definition,
    advisorId: person.id,
    survey: { title: 'Advisor Studio sample' },
    results: [{ advisor_id: peer.id, active: true, responses }],
  };
  document.title = 'Admin sample · Advisor Studio';
  document.querySelector('#survey-tools').hidden = false;
  document.querySelector('#survey-signout').hidden = true;
  document.querySelector('#restart').hidden = true;

  const welcome = document.querySelector('#main .welcome').cloneNode(true);
  welcome.querySelector('.auth-panel').remove();
  welcome.querySelector('h1').id = 'title';
  welcome.querySelector('h1').tabIndex = -1;
  const choose = document.createElement('p');
  choose.className = 'fine';
  choose.textContent =
    'Choose a sample respondent to try their survey. Switching starts a fresh sample.';
  const choices = document.createElement('div');
  choices.className = 'people';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'Sample respondent');
  for (const p of people) {
    const button = document.createElement('button');
    button.className = 'person';
    button.textContent = p.name;
    button.dataset.samplePerson = p.id;
    button.setAttribute('aria-pressed', String(p.id === person.id));
    choices.append(button);
  }
  welcome.querySelector('.start-guide').before(choose, choices);
  const footer = document.createElement('div');
  footer.className = 'footer';
  footer.innerHTML =
    '<button id="begin" class="primary">Start sample survey →</button>';
  welcome.append(footer);

  const bar = document.createElement('section');
  bar.className = 'sample-bar';
  bar.setAttribute('aria-label', 'Sample preview controls');
  bar.innerHTML =
    '<div><strong>Admin sample · Fictional responses</strong><p>Test every page and submission. Nothing is saved or sent.</p></div><div class="chiprow"><button id="reset-sample">Reset sample</button><a href="/admin/#/surveys/custom">Back to survey</a></div>';
  document.querySelector('header').after(bar);
  document.querySelector('#reset-sample').onclick = () => {
    location.hash = new URLSearchParams({ sample: person.id });
    location.reload();
  };
  document.addEventListener('click', (event) => {
    const id = event.target.closest('[data-sample-person]')?.dataset
      .samplePerson;
    if (!id) return;
    if (id === person.id) document.querySelector('#begin').click();
    else {
      location.hash = new URLSearchParams({ sample: id, step: 'questions' });
      location.reload();
    }
  });
  let revision = 0;
  mountAdvisor(
    bootstrap,
    {
      submit: async () => ({ revision: ++revision, id: 'local-sample' }),
    },
    { sample: samples[index], welcomeHTML: welcome.outerHTML },
  );
  if (params.get('step') === 'review')
    document.querySelector('[data-nav="4"]').click();
  if (params.get('step') === 'questions')
    document.querySelector('#begin').click();
}
