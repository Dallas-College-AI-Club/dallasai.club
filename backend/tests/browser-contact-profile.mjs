import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { officeFixture } from './helpers/office-fixture.mjs';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
try {
  for (const width of [320, 1440]) {
    const fixture = await officeFixture();
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(fixture.origin + '/test-signin');
      await page.locator('#office').waitFor();
      await page.locator('#contacts-tab').click();
      const pane = page.locator('#contacts-pane');
      await pane
        .getByRole('button', { name: /Office rsvp rsvp@example.edu/ })
        .click();
      await expect(pane.getByRole('heading', { level: 1 })).toHaveText(
        'Contacts',
      );
      await expect(
        pane.getByRole('heading', {
          level: 2,
          name: 'Office rsvp',
          exact: true,
        }),
      ).toBeVisible();
      assert.ok(
        await pane.evaluate((el) => {
          const back = [...el.querySelectorAll('button')].find(
            (button) => button.textContent === '← All contacts',
          );
          const name = el.querySelector('h2');
          const primary = [...el.querySelectorAll('p')].find((p) =>
            p.textContent.startsWith('Primary email:'),
          );
          return (
            Boolean(
              back.compareDocumentPosition(name) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            ) &&
            Boolean(
              name.compareDocumentPosition(primary) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            )
          );
        }),
      );
      await pane
        .getByLabel('Internal notes', { exact: true })
        .fill('Retained officer note');
      await pane
        .getByRole('button', { name: 'Save note', exact: true })
        .click();
      await expect(
        pane.getByText('Retained officer note', { exact: true }),
      ).toBeVisible();
      await pane
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      await pane
        .getByLabel('Contact name', { exact: true })
        .fill('Corrected Member');
      await pane
        .getByLabel('Primary email', { exact: true })
        .fill('preferred@example.edu');
      await pane
        .getByRole('button', { name: 'Save contact changes', exact: true })
        .click();
      await expect(
        pane.getByRole('heading', {
          level: 2,
          name: 'Corrected Member',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        pane.getByText('Primary email: preferred@example.edu', { exact: true }),
      ).toBeVisible();
      await pane
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      const original = pane
        .locator('.contact-alias-row')
        .filter({ hasText: 'rsvp@example.edu' });
      await original
        .getByRole('button', { name: 'Use as primary', exact: true })
        .click();
      await expect(
        pane.getByLabel('Primary email', { exact: true }),
      ).toHaveValue('rsvp@example.edu');
      await expect(
        original.getByRole('button', { name: 'Remove address', exact: true }),
      ).toBeDisabled();
      await pane
        .getByRole('button', { name: 'Save contact changes', exact: true })
        .click();
      await expect(
        pane.getByText('Primary email: rsvp@example.edu', { exact: true }),
      ).toBeVisible();
      await pane
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      await pane
        .locator('.contact-alias-row')
        .filter({ hasText: 'preferred@example.edu' })
        .getByRole('button', { name: 'Use as primary', exact: true })
        .click();
      await pane
        .getByRole('button', { name: 'Save contact changes', exact: true })
        .click();
      await expect(
        pane.getByText('Primary email: preferred@example.edu', { exact: true }),
      ).toBeVisible();
      await pane
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      await expect(
        original.getByRole('button', { name: 'Remove address', exact: true }),
      ).toBeEnabled();
      await original
        .getByRole('button', { name: 'Remove address', exact: true })
        .click();
      assert.ok(await pane.evaluate((el) => el.scrollWidth <= el.clientWidth));
      await original
        .getByRole('button', { name: 'Confirm remove address', exact: true })
        .click();
      await expect(
        pane.getByText('Other linked emails: None', { exact: true }),
      ).toBeVisible();
      await expect(
        pane.getByText('Retained officer note', { exact: true }),
      ).toBeVisible();
      await expect(
        pane.getByRole('link', { name: 'Open submission', exact: true }),
      ).toHaveCount(1);
      await pane
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      await expect(pane.locator('.contact-alias-row')).toHaveCount(1);
      await expect(
        pane.getByRole('button', { name: 'Remove address', exact: true }),
      ).toHaveCount(0);
      assert.ok(await pane.evaluate((el) => el.scrollWidth <= el.clientWidth));
      const rsvp = fixture.entries.find((entry) => entry.kind === 'rsvp');
      assert.equal(
        (
          await fixture.db.query(
            'SELECT email FROM club_forms.entries WHERE id=$1',
            [rsvp.id],
          )
        ).rows[0].email,
        'rsvp@example.edu',
      );
      assert.equal(
        (
          await fixture.db.query(
            'SELECT answers FROM club_forms.survey_responses WHERE entry_id=$1',
            [rsvp.id],
          )
        ).rows[0].answers[0].value,
        'Afternoon',
      );
      assert.deepEqual(errors, []);
      console.log(
        'PASS contact profile name, primary selection, used address removal and retained RSVP at ' +
          width +
          'px',
      );
    } finally {
      await context.close();
      await fixture.close();
    }
  }
} finally {
  await browser.close();
}
