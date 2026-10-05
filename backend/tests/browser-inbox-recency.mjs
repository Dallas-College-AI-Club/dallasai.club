import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { officeFixture } from './helpers/office-fixture.mjs';
const fixture = await officeFixture();
await fixture.db.query(
  `INSERT INTO club_forms.custom_survey_responses(survey_id,advisor_id,revision,responses)
  VALUES($1,'pearlman',1,'[{"id":"note","text":"Recently received answer"}]')`,
  [fixture.id],
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
try {
  const page = await browser.newPage();
  await page.goto(fixture.origin + '/test-signin');
  await page.goto(fixture.origin + '/admin/#/home');
  await expect(page.getByText("What's new", { exact: true })).toBeVisible();
  await page.goto(fixture.origin + '/admin/#/inbox');
  await expect(
    page.getByRole('button', { name: 'Upcoming & New', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Mark reviewed', exact: true }),
  ).toHaveCount(0);
  const response = page
    .locator('#entries .entry')
    .filter({ hasText: 'Advisor Studio' });
  await response.locator(':scope > summary').click();
  await expect(
    response.getByRole('link', { name: 'View survey and response' }),
  ).toBeVisible();
  let release, seen;
  const gate = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (seen = resolve));
  await page.route('**/api/custom-surveys?action=members*', async (route) => {
    const savedResponse = await route.fetch();
    seen();
    await gate;
    await route.fulfill({ response: savedResponse });
  });
  const mutations = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('action=member-change')
    )
      mutations.push(request.postDataJSON());
  });
  await response.getByRole('button', { name: 'Archive response' }).click();
  await started;
  await page.locator('#account-button').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Send sign-in code', exact: true }),
  ).toBeVisible();
  const membersReceived = page.waitForResponse((reply) =>
    reply.url().includes('/api/custom-surveys?action=members'),
  );
  release();
  await membersReceived;
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.deepEqual(
    mutations,
    [],
    'An old session replayed its archive action after sign-out',
  );
  await expect(page.locator('#entries')).toBeEmpty();
  await expect(
    page.locator('.toast-error').filter({
      hasText: 'Not saved — signed in as a different account.',
    }),
  ).toHaveCount(0);
  console.log(
    'Passed: survey Inbox summary, recency tabs, no reviewed action, and sign-out cancels pending archive intent.',
  );
} finally {
  await browser.close();
  await fixture.close();
}
