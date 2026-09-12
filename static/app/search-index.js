import { articles } from '../content/articles.js';
import { articleUrl } from '../content/article-links.js';
import { EVENTS, eventDate } from '../content/club.js';
import { GAMES } from '../games/registry.js';
import { LAB_AREAS, LAB_CASES } from '../content/lab-cases.js';
import { PROJECT_LINKS } from '../content/projects.js';
const page = (id, title, description) => ({
  id: 'page-' + id,
  title,
  description,
  category: 'Section',
  href: 'club.html?mode=' + id,
});
const sections = [
  page('summary', 'Latest', 'The latest from across the club'),
  page('journal', 'The AI Review', 'Student essays, reflections, and research notes'),
  page('lab', 'AI Lab', 'Questions from your field and four hands-on experiments'),
  page('projects', 'Projects', 'Working demos, projects in development, and concepts'),
  page('events', 'Events', 'Upcoming workshops and meeting history'),
  page('about', 'About the club', 'Our vision, learning paths, and co-advisors'),
  page('play', 'Explore & Play', 'Choose a game and discover the club'),
  page('subscribe', 'Subscribe to The AI Review', 'Follow the publication'),
  page('rankings', 'Rankings', 'Top ten scores for each game'),
];
sections.find((e) => e.id === 'page-about').keywords =
  'join Teams membership contact David Bracewell PhD professor Russ Pearlman JD';
sections.find((e) => e.id === 'page-summary').keywords = 'news updates announcements';
export const SEARCH_ENTRIES = [
  ...sections,
  {
    id: 'lab-fields',
    title: 'AI decisions in your field',
    description:
      'Explore work scenarios from Dallas College’s seven schools, weigh tradeoffs and find a project to try.',
    category: 'AI Lab activity',
    keywords: [
      ...LAB_AREAS.map((area) => [area.school, ...area.programs].join(' ')),
      ...LAB_CASES.map((c) => [c.field, c.title, c.contribution].join(' ')),
    ].join(' '),
    href: 'club.html?mode=lab#lab-field-guide',
  },
  ...articles.map((a) => ({
    id: 'article-' + a.slug,
    title: a.title,
    description: a.abstract,
    category: 'AI Review article',
    keywords: [a.category, a.section, ...a.headings, ...a.paragraphs, ...a.references.flat()].join(
      ' ',
    ),
    href: articleUrl(a),
  })),
  ...PROJECT_LINKS.map(({ id, title, description, href }) => ({
    id: 'project-' + id,
    title,
    description,
    category: 'Project',
    href,
  })),
  ...EVENTS.slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({
      id: 'event-' + e.id,
      title: e.title,
      description: eventDate(e) + ' ' + e.date.slice(0, 4) + ' · ' + (e.summary || e.category),
      category: 'Event',
      keywords: [
        e.date,
        e.category,
        e.location,
        ...e.agenda,
        ...e.preparation,
        new Intl.DateTimeFormat('en-US', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(e.date.slice(0, 10))),
      ].join(' '),
      href: e.url,
    })),
  ...[
    ['lab', 'Train a model', 'Train a neural network and inspect its predictions.'],
    ['ethics', 'Check its answers', 'Change the test mix and compare accuracy across groups.'],
    [
      'compare',
      'Compare AI tools',
      'Use a weighted rubric to score tools against what matters to you.',
    ],
    [
      'drift',
      'Spot AI going off track',
      'Check instructions, format, and prompt injection in an AI response.',
    ],
  ].map(([mode, title, description]) => ({
    id: 'experiment-' + mode,
    title,
    description,
    category: 'AI Lab experiment',
    href: 'club.html?mode=' + mode,
  })),
  ...GAMES.map((g) => ({
    id: 'game-' + g.id,
    title: g.title,
    description: g.description,
    category: 'Game',
    href: 'club.html?mode=' + g.id,
  })),
];
const normalize = (s) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const indexedEntries = SEARCH_ENTRIES.map((entry, index) => ({
  entry,
  index,
  title: normalize(entry.title),
  category: normalize(entry.category),
  description: normalize(entry.description),
  keywords: normalize(entry.keywords || ''),
}));
export function searchClub(query) {
  const phrase = normalize(query);
  if (!phrase) return sections;
  const terms = phrase
    .split(/\s+/)
    .map((term) =>
      ['articles', 'projects', 'events', 'games', 'experiments', 'meetings'].includes(term)
        ? term.slice(0, -1)
        : term,
    );
  return indexedEntries
    .map(({ entry, index, title, category, description, keywords }) => {
      const all = [title, category, description, keywords].join(' ');
      if (!terms.every((term) => all.includes(term))) return null;
      const score =
        (title === phrase ? 200 : title.includes(phrase) ? 100 : 0) +
        terms.reduce(
          (sum, term) =>
            sum +
            (title.includes(term)
              ? 20
              : category.includes(term)
                ? 8
                : description.includes(term)
                  ? 4
                  : 1),
          0,
        );
      return { entry, score, index };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.entry);
}
