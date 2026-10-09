export function defaultFeedbackQuestions() {
  return [
    {
      label: 'What is your school email address?',
      type: 'email',
      required: true,
      options: [],
    },
    {
      label: 'What is your major? (Enter N/A if faculty or staff)',
      type: 'short',
      required: true,
      options: [],
    },
    {
      label: 'What year are you in?',
      type: 'single',
      required: true,
      options: [
        'First Year (Freshman)',
        'Second Year (Sophomore)',
        'Third +',
        'No Degree Plan',
      ],
    },
    {
      label: 'What campus do you primarily attend?',
      type: 'single',
      required: true,
      options: [
        'Richland',
        'El Centro',
        'Eastfield',
        'Cedar Valley',
        'North Lake',
        'Mountain View',
        'Brookhaven',
        'Online Only',
      ],
    },
    {
      label: 'How did you hear about us?',
      type: 'single',
      required: false,
      options: ['Flyer', 'Professor', 'Other student', 'Social Media'],
      allowOther: true,
    },
  ].map((question, index) => ({
    id: '00000000-0000-4000-8000-00000000000' + (index + 1),
    description: '',
    allowOther: false,
    ...question,
  }));
}

export function eventFeedbackState(event, now = Date.now()) {
  const start =
    typeof event?.date === 'string' && event.date.includes('T')
      ? Date.parse(event.date)
      : NaN;
  if (!event?.feedbackEnabled || event.potential || !Number.isFinite(start))
    return { status: 'unavailable', opensAt: null, closesAt: null };
  const end = start + 72 * 60 * 60 * 1000;
  return {
    status: now < start ? 'upcoming' : now < end ? 'open' : 'expired',
    opensAt: new Date(start).toISOString(),
    closesAt: new Date(end).toISOString(),
  };
}

export const eventFeedbackURL = (id) =>
  'https://dallasai.club/club.html?mode=events&event=' +
  encodeURIComponent(id) +
  '&feedback=1';
