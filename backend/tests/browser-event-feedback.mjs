import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { officeFixture } from './helpers/office-fixture.mjs';
import { saveEvent } from '../lib/events.mjs';
import { defaultFeedbackQuestions } from '../lib/event-feedback-definition.mjs';

const startsAt = Date.parse('2030-10-23T16:00:00-05:00');
let now = startsAt - 1000;
const fixture = await officeFixture({ feedbackNow: () => now });
process.env.FORMS_ALLOWED_ORIGINS = fixture.origin;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
const errors = [];
const screens = path.resolve(
  import.meta.dirname,
  '../../.preview/event-checks',
);
await mkdir(screens, { recursive: true });
try {
  const saved = await saveEvent(
    fixture.db,
    {
      id: fixture.event.id,
      revision: fixture.event.revision,
      action: 'publish',
      event: {
        ...fixture.event.draft,
        date: '2030-10-23',
        startTime: '16:00',
        endTime: '18:00',
        feedbackEnabled: true,
        feedbackQuestions: defaultFeedbackQuestions(),
        checkSharing: false,
      },
    },
    'officer@example.com',
  );
  const admin = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  admin.on('pageerror', (error) => errors.push(error.message));
  await admin.goto(fixture.origin + '/test-signin');
  await admin.locator('#events-tab').click();
  await admin.locator('#event-list .event-choice').click();
  await expect(admin.locator('#event-feedback-overview')).toContainText(
    'Feedback responses (0)',
  );
  await expect(
    admin.getByRole('link', {
      name: 'Create event feedback survey',
      exact: true,
    }),
  ).toHaveCount(0);
  await admin
    .getByRole('button', { name: 'Edit event feedback', exact: true })
    .click();
  await expect(
    admin.getByLabel('Collect event feedback', { exact: true }),
  ).toBeChecked();
  await expect(admin.locator('#feedback-questions > fieldset')).toHaveCount(5);
  await admin
    .locator('#feedback-questions > fieldset')
    .nth(1)
    .getByLabel('Question', { exact: true })
    .fill('What is your major or program?');
  await admin
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await expect(admin.locator('#event-status')).toContainText(
    'Published successfully',
  );
  const publicContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await publicContext.route(
    'https://dallasai-leaderboard.vercel.app/api/**',
    async (route) => {
      const target = new URL(route.request().url());
      const response = await route.fetch({
        url: fixture.origin + target.pathname + target.search,
        headers: {
          ...route.request().headers(),
          origin: fixture.origin,
        },
      });
      await route.fulfill({ response });
    },
  );
  const page = await publicContext.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const authRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/auth')) authRequests.push(request.url());
  });
  await page.clock.setFixedTime(now);
  const eventURL = fixture.origin + '/club.html?mode=events&event=' + saved.id;
  await page.goto(eventURL);
  await expect(page.locator('#open-rsvp')).toBeVisible();
  await expect(page.locator('#event-feedback-action')).toHaveCount(0);
  // Time advances while the event page stays open, before the event ends.
  now = startsAt;
  await page.clock.setFixedTime(now);
  await expect(page.locator('#event-feedback-action')).toBeVisible();
  await expect(page.locator('#open-rsvp, #event-rsvp-action')).toHaveCount(0);
  await page.locator('#event-feedback-action').click();
  await expect(
    page.locator('#event-feedback fieldset.survey-question'),
  ).toHaveCount(5);
  await expect(
    page.locator(
      '#event-feedback [name="name"], #event-feedback [name="consent"]',
    ),
  ).toHaveCount(0);
  await page
    .getByRole('textbox', {
      name: 'What is your school email address?',
      exact: true,
    })
    .fill('guest@gmail.com');
  await page
    .getByRole('textbox', {
      name: 'What is your major or program?',
      exact: true,
    })
    .fill('Computer science');
  await page.getByRole('radio', { name: 'Third +', exact: true }).check();
  await page.getByRole('radio', { name: 'Online Only', exact: true }).check();
  await page.getByRole('radio', { name: 'Other', exact: true }).check();
  await page
    .getByLabel('Other answer', { exact: true })
    .fill('Campus newsletter');
  await page
    .locator('.feedback-dialog')
    .screenshot({ path: path.join(screens, 'feedback-phone.png') });
  assert.equal(
    await page
      .locator('.feedback-dialog')
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
    true,
  );
  // Closing and reopening keeps answers in the tab without authenticating.
  await page
    .getByRole('button', { name: 'Close event feedback', exact: true })
    .click();
  await page.locator('#event-feedback-action').click();
  await expect(
    page.getByRole('textbox', {
      name: 'What is your major or program?',
      exact: true,
    }),
  ).toHaveValue('Computer science');
  await page
    .getByRole('button', { name: 'Submit feedback', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Event feedback received', exact: true }),
  ).toBeVisible();
  assert.deepEqual(authRequests, []);
  const responses = (
    await fixture.db.query(
      'SELECT questions,answers,email FROM club_forms.event_feedback_responses WHERE event_id=$1',
      [saved.id],
    )
  ).rows;
  assert.equal(responses.length, 1);
  assert.equal(responses[0].email, 'guest@gmail.com');
  assert.equal(
    responses[0].questions[1].label,
    'What is your major or program?',
  );
  assert.equal(responses[0].answers[4].other, 'Campus newsletter');
  await admin.reload();
  await admin.locator('#event-list .event-choice').click();
  await admin
    .locator('#event-feedback-overview > details')
    .last()
    .locator(':scope > summary')
    .click();
  await expect(admin.locator('#event-feedback-overview')).toContainText(
    'Feedback responses (1)',
  );
  await admin
    .locator('#event-feedback-overview .response-person > summary')
    .click();
  await expect(admin.locator('#event-feedback-overview')).toContainText(
    'Campus newsletter',
  );
  await admin
    .locator('#event-feedback-overview')
    .screenshot({ path: path.join(screens, 'feedback-office-desktop.png') });
  await expect(
    admin.getByRole('link', { name: 'Download feedback QR', exact: true }),
  ).toHaveAttribute('href', /feedback=1&download=1/);
  // The direct feedback address opens the form immediately, including on a phone.
  await page.goto(eventURL + '&feedback=1');
  await expect(page.locator('#event-feedback')).toBeVisible();
  await page
    .getByRole('button', { name: 'Close event feedback', exact: true })
    .click();
  now = startsAt + 72 * 3600000;
  await page.clock.setFixedTime(now);
  await expect(page.locator('#event-feedback-action')).toHaveCount(0);
  await expect(page.locator('#event-detail')).toContainText(
    'Event feedback has closed.',
  );
  await page.goto(eventURL + '&feedback=1');
  await expect(page.locator('.feedback-dialog')).toContainText(
    'closed 72 hours after',
  );
  await expect(page.locator('#event-feedback')).toHaveCount(0);
  // Old direct links keep their target and show a clear closed state after archival.
  await saveEvent(
    fixture.db,
    {
      action: 'archive',
      id: saved.id,
      revision: (
        await fixture.db.query(
          'SELECT revision FROM club_forms.events WHERE id=$1',
          [saved.id],
        )
      ).rows[0].revision,
    },
    'officer@example.com',
  );
  await page.goto(eventURL + '&feedback=1');
  await expect(page.locator('.feedback-dialog')).toContainText('unavailable');
  await expect(page.locator('#event-feedback')).toHaveCount(0);
  assert.equal(new URL(page.url()).searchParams.get('event'), saved.id);
  await page.goto(
    fixture.origin +
      '/club.html?mode=events&event=missing-feedback-event&feedback=1',
  );
  await expect(page.locator('.feedback-dialog')).toContainText('unavailable');
  assert.equal(
    new URL(page.url()).searchParams.get('event'),
    'missing-feedback-event',
  );
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin
    .locator('#event-feedback-overview')
    .screenshot({ path: path.join(screens, 'feedback-office-phone.png') });
  assert.equal(
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS public feedback start/72h boundary, open-tab switch, phone layout, no authentication, editable defaults, direct link, saved answers and Office event box',
  );
} finally {
  await browser.close();
  await fixture.close();
}
