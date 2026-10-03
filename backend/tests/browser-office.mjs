import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { officeFixture } from './helpers/office-fixture.mjs';
import { changeDraft } from '../lib/survey-builder.mjs';
import { randomUUID } from 'node:crypto';
const fixture = await officeFixture();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
const failures = [],
  screens = path.resolve(
    import.meta.dirname,
    '../../.preview/office-audit',
  );
await mkdir(screens, { recursive: true });
async function check(name, fn) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [],
    dialogs = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let accept = true;
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await (accept ? dialog.accept() : dialog.dismiss());
  });
  try {
    await page.goto(fixture.origin + '/test-signin');
    await page.locator('#office').waitFor();
    await fn(page, dialogs, (value) => {
      accept = value;
    });
    assert.deepEqual(errors, []);
    console.log('PASS ' + name);
  } catch (error) {
    failures.push(name + ': ' + error.message);
    console.log('FAIL ' + name + ': ' + error.message);
    await page.screenshot({
      path: path.join(
        screens,
        name.replaceAll(/[^a-z0-9]/gi, '-') + '.png',
      ),
    });
  } finally {
    await context.close();
  }
}
try {
  await check(
    'Response edits require discard confirmation and lock during saves',
    async (page, dialogs, setAccept) => {
      const entry = fixture.entries.find((row) => row.kind === 'rsvp');
      await page.locator('#entry-' + entry.id + ' > summary').click();
      await page
        .locator('#entry-' + entry.id)
        .getByRole('button', { name: 'Edit response', exact: true })
        .click();
      const dialog = page.locator('.submission-dialog[open]');
      await dialog
        .getByLabel('Full name', { exact: true })
        .fill('Edited office respondent');
      setAccept(false);
      await page.keyboard.press('Escape');
      assert.equal(dialogs.length, 1);
      await expect(dialog).toBeVisible();
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      await page.route('**/api/admin', async (route) => {
        if (route.request().postDataJSON()?.action !== 'edit-submission')
          return route.continue();
        await gate;
        await route.continue();
      });
      const requested = page.waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url().endsWith('/api/admin'),
      );
      await dialog
        .getByRole('button', { name: 'Save changes', exact: true })
        .click();
      await requested;
      await expect(
        dialog.getByLabel('Full name', { exact: true }),
      ).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      release();
      await expect(dialog).toHaveCount(0);
      assert.equal(
        (
          await fixture.db.query(
            'SELECT name FROM club_forms.entries WHERE id=$1',
            [entry.id],
          )
        ).rows[0].name,
        'Edited office respondent',
      );
      await page
        .locator('#entry-' + entry.id)
        .getByRole('button', { name: 'Edit response', exact: true })
        .click();
      await dialog
        .getByLabel('Full name', { exact: true })
        .fill('Discard this change');
      setAccept(true);
      await dialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
    },
  );
  await check(
    'Expired session closes private dialogs and clears records',
    async (page) => {
      await page
        .locator('#inbox-pane')
        .getByRole('button', { name: 'Contacts & follow-up', exact: true })
        .click();
      await page.locator('.contact-choice').first().waitFor();
      await page.route('**/api/surveys?**', (route) =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Session expired' }),
        }),
      );
      await page.locator('.contact-choice').first().click();
      await expect(page.locator('#login')).toBeVisible();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(page.locator('#entries')).toBeEmpty();
      await expect(page.locator('#status')).toContainText(
        'Your session ended',
      );
    },
  );
  await check(
    'Custom survey create preview publish respondents and close',
    async (page) => {
      await page.locator('#surveys-tab').click();
      await page.locator('#custom-surveys-group').click();
      await page
        .getByRole('button', { name: 'Create custom survey', exact: true })
        .click();
      await page
        .getByLabel('Starting template', { exact: true })
        .selectOption('feedback');
      await page
        .getByLabel('Survey title', { exact: true })
        .fill('Complete office audit survey');
      await page
        .getByRole('button', { name: 'Save and continue →', exact: true })
        .click();
      await page
        .getByRole('button', {
          name: 'Add myself for testing',
          exact: true,
        })
        .click();
      await page
        .getByRole('button', { name: /Remove access for/ })
        .waitFor();
      await page
        .getByRole('button', { name: 'Save and continue →', exact: true })
        .click();
      await expect(page.locator('.builder-panel fieldset')).toHaveCount(3);
      await page
        .getByRole('button', { name: 'Save and continue →', exact: true })
        .click();
      await page.locator('.survey-trial > summary').click();
      await page
        .getByRole('textbox', { name: 'What worked well?', exact: true })
        .fill('PRIVATE PREVIEW ONLY');
      await page
        .getByRole('button', {
          name: 'Preview how results will look',
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog', {
        name: 'Example admin results',
        exact: true,
      });
      await expect(dialog).toContainText('PRIVATE PREVIEW ONLY');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      assert.equal(
        (
          await fixture.db.query(
            'SELECT count(*)::int n FROM club_forms.custom_survey_responses',
          )
        ).rows[0].n,
        0,
      );
      await page
        .getByRole('button', { name: 'Save and continue →', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Publish survey', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Close survey', exact: true })
        .waitFor();
      await page
        .getByRole('button', { name: 'Close survey', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Cancel closing', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Close survey', exact: true }),
      ).toBeEnabled();
      await page
        .getByRole('button', { name: /Remove access for/ })
        .click();
      await page
        .getByText('Archived respondents', { exact: true })
        .click();
      await page
        .getByRole('button', { name: /Restore access for/ })
        .click();
      await page
        .getByRole('button', { name: /Remove access for/ })
        .waitFor();
      await page
        .getByRole('button', { name: 'Close survey', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Confirm close', exact: true })
        .click();
      await page
        .getByText('Survey closed. Saved responses remain available.', {
          exact: true,
        })
        .waitFor();
      assert.equal(
        (
          await fixture.db.query(
            'SELECT status FROM club_forms.custom_surveys WHERE title=$1',
            ['Complete office audit survey'],
          )
        ).rows[0].status,
        'closed',
      );
    },
  );
  await check(
    'Ambiguous save retries the same request without losing the draft',
    async (page) => {
      await page.locator('#surveys-tab').click();
      await page.locator('#custom-surveys-group').click();
      await page
        .getByRole('button', { name: 'Create custom survey', exact: true })
        .click();
      await page
        .getByLabel('Survey title', { exact: true })
        .fill('Saved once after connection loss');
      const requests = [];
      await page.route(
        '**/api/custom-surveys?action=draft-change',
        async (route) => {
          requests.push(route.request().postDataJSON());
          if (requests.length === 1) {
            await route.fetch();
            await route.abort('failed');
          } else await route.continue();
        },
      );
      await page
        .getByRole('button', { name: 'Save and continue →', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Retry the same save', exact: true })
        .waitFor();
      await page.locator('#inbox-tab').click();
      await expect(page.locator('#surveys-pane')).toBeVisible();
      await page
        .getByRole('button', { name: 'Retry the same save', exact: true })
        .click();
      await expect(
        page.getByLabel('Survey title', { exact: true }),
      ).toBeEnabled();
      assert.equal(requests.length, 2);
      assert.equal(requests[0].requestId, requests[1].requestId);
      assert.equal(
        (
          await fixture.db.query(
            'SELECT count(*)::int n FROM club_forms.custom_survey_changes WHERE survey_id=$1',
            [requests[0].id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check(
    'Late custom draft cannot redraw after signout',
    async (page) => {
      const id = randomUUID();
      await changeDraft(
        fixture.db,
        { email: 'officer@example.com' },
        {
          id,
          requestId: randomUUID(),
          expectedRevision: 0,
          action: 'save',
          definition: {
            template: 'blank',
            title: 'Delayed private draft',
            intro: '',
            audience: 'advisors',
            permissions: {
              preview: 'link',
              answer: 'invited',
              results: 'admins',
            },
            durationDays: 30,
            questions: [],
          },
        },
      );
      await page.locator('#surveys-tab').click();
      await page.locator('#custom-surveys-group').click();
      await page
        .getByLabel('Custom survey', { exact: true })
        .selectOption(id);
      await page
        .getByRole('button', {
          name: 'Continue editing draft',
          exact: true,
        })
        .waitFor();
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      await page.route(
        '**/api/custom-surveys?action=draft&id=' + id,
        async (route) => {
          const response = await route.fetch();
          await gate;
          await route.fulfill({ response });
        },
      );
      const requested = page.waitForRequest(
        '**/api/custom-surveys?action=draft&id=' + id,
      );
      await page
        .getByRole('button', {
          name: 'Continue editing draft',
          exact: true,
        })
        .click();
      await requested;
      await page.locator('#signout').click();
      await page.locator('#login').waitFor();
      const response = page.waitForResponse(
        '**/api/custom-surveys?action=draft&id=' + id,
      );
      release();
      await response;
      await expect(page.locator('#custom-surveys-root')).toBeEmpty();
      await expect(page.locator('#office')).toBeHidden();
    },
  );
  await check(
    'Discarded event edits stay discarded',
    async (page, dialogs) => {
      await page.locator('#events-tab').click();
      await page.locator('#new-event').click();
      await page
        .locator('#event-form [name=title]')
        .fill('Unsaved event change');
      await page.locator('#inbox-tab').click();
      assert.equal(dialogs.length, 1);
      await page.locator('#surveys-tab').click();
      assert.equal(
        dialogs.length,
        1,
        'discarding an event should not keep prompting from a hidden form',
      );
      await page.locator('#events-tab').click();
      assert.equal(await page.locator('#event-form').isVisible(), false);
    },
  );
  await check(
    'Custom draft navigation is guarded',
    async (page, dialogs, setAccept) => {
      await page.locator('#surveys-tab').click();
      await page.locator('#custom-surveys-group').click();
      await page
        .getByRole('button', { name: 'Create custom survey', exact: true })
        .click();
      await page
        .getByLabel('Survey title', { exact: true })
        .fill('Unsaved custom draft');
      setAccept(false);
      await page.locator('#events-tab').click();
      assert.equal(
        dialogs.length,
        1,
        'custom draft needs a discard confirmation',
      );
      await expect(
        page.getByLabel('Survey title', { exact: true }),
      ).toHaveValue('Unsaved custom draft');
      setAccept(true);
      await page.locator('#inbox-tab').click();
      await expect(page.locator('#inbox-pane')).toBeVisible();
    },
  );
  await check('Active tabs preserve filters', async (page) => {
    await page.locator('#surveys-tab').click();
    await page.locator('#survey-search').fill('rsvp@example.edu');
    await expect(
      page.locator('#survey-results .survey-response'),
    ).toHaveCount(1);
    await page.locator('#surveys-tab').click();
    await expect(page.locator('#survey-search')).toHaveValue(
      'rsvp@example.edu',
    );
    await page.locator('#custom-surveys-group').click();
    await page
      .getByRole('button', { name: 'Create custom survey', exact: true })
      .click();
    await page
      .getByLabel('Survey title', { exact: true })
      .fill('Keep on same tab');
    await page.locator('#custom-surveys-group').click();
    await expect(
      page.getByLabel('Survey title', { exact: true }),
    ).toHaveValue('Keep on same tab');
  });
  await check('Hash navigation matches the visible tab', async (page) => {
    await page.evaluate(() => {
      location.hash = 'events';
    });
    await expect(page.locator('#events-pane')).toBeVisible();
    await page.evaluate(() => {
      location.hash = 'surveys';
    });
    await expect(page.locator('#surveys-pane')).toBeVisible();
    await page.evaluate(() => {
      location.hash = '';
    });
    await expect(page.locator('#inbox-pane')).toBeVisible();
  });
  await check(
    'Cancelled browser navigation retains custom draft and address',
    async (page, dialogs, setAccept) => {
      await page.locator('#surveys-tab').click();
      await page.locator('#custom-surveys-group').click();
      await page
        .getByRole('button', { name: 'Create custom survey', exact: true })
        .click();
      await page
        .getByLabel('Survey title', { exact: true })
        .fill('Keep this browser draft');
      setAccept(false);
      await page.evaluate(() => {
        location.hash = 'survey=some-entry';
      });
      await expect(page).toHaveURL(/#surveys$/);
      await expect(
        page.getByLabel('Survey title', { exact: true }),
      ).toHaveValue('Keep this browser draft');
      await expect(page.locator('#custom-surveys-root')).toBeVisible();
      assert.equal(dialogs.length, 1);
    },
  );
  await check(
    'Contact notes survive closing and reopening',
    async (page) => {
      await page
        .locator('#inbox-pane')
        .getByRole('button', { name: 'Contacts & follow-up', exact: true })
        .click();
      const dialog = page.locator(
        '.contact-dialog:not(.submission-dialog)',
      );
      await dialog
        .getByRole('button', { name: /rsvp@example.edu/ })
        .click();
      await dialog
        .getByLabel('Record a follow-up note', { exact: true })
        .fill('Unsaved follow-up that should not disappear');
      await dialog
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      await page
        .locator('#inbox-pane')
        .getByRole('button', { name: 'Contacts & follow-up', exact: true })
        .click();
      await dialog
        .getByRole('button', { name: /rsvp@example.edu/ })
        .click();
      await expect(
        dialog.getByLabel('Record a follow-up note', { exact: true }),
      ).toHaveValue('Unsaved follow-up that should not disappear');
      await page.setViewportSize({ width: 390, height: 550 });
      await dialog.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const close = dialog.getByRole('button', {
        name: 'Close',
        exact: true,
      });
      const rect = await close.boundingBox();
      assert.ok(
        rect.y >= 0 && rect.y + rect.height <= 550,
        'Close remains onscreen while contact history scrolls',
      );
      await page.screenshot({
        path: path.join(screens, 'contact-scroll-mobile.png'),
      });
      let count = 0;
      await page.route('**/api/surveys', async (route) => {
        if (route.request().postDataJSON()?.action !== 'contact-note')
          return route.continue();
        if (++count === 1) {
          await route.fetch();
          await route.abort('failed');
        } else await route.continue();
      });
      const save = dialog.getByRole('button', {
        name: 'Save note',
        exact: true,
      });
      await save.click();
      await expect(dialog).toContainText(
        'Could not connect to Club Office',
      );
      await save.click();
      await expect(
        dialog.getByLabel('Record a follow-up note', { exact: true }),
      ).toHaveValue('');
      assert.equal(
        (
          await fixture.db.query(
            'SELECT count(*)::int n FROM club_forms.contact_notes WHERE email=$1',
            ['rsvp@example.edu'],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check('Friendly recovery from a non-JSON error', async (page) => {
    await page.route('**/api/admin?**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'text/html',
        body: '<html>Temporary gateway error</html>',
      }),
    );
    await page.locator('#refresh').click();
    await expect(page.locator('#status')).toContainText(
      /try again|connection|temporarily/i,
    );
    await expect(page.locator('#status')).not.toContainText(
      /JSON|Unexpected token|<html>/,
    );
    await page.unroute('**/api/admin?**');
    await page.locator('#refresh').click();
    await expect(page.locator('#entries .entry')).toHaveCount(6);
  });
  await check(
    'Office layouts fit portrait landscape and dark mode',
    async (page) => {
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        for (const [width, height] of [
          [320, 740],
          [390, 844],
          [844, 390],
          [768, 1024],
          [1440, 1000],
        ]) {
          await page.setViewportSize({ width, height });
          for (const pane of ['inbox', 'events', 'surveys']) {
            await page.locator('#' + pane + '-tab').click();
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              true,
              `${pane} overflows ${width}px`,
            );
          }
          await page.screenshot({
            path: path.join(screens, `office-${width}-${colorScheme}.png`),
          });
        }
      }
    },
  );
} finally {
  await browser.close();
  await fixture.close();
}
assert.deepEqual(failures, []);
