import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { officeFixture } from './helpers/office-fixture.mjs';
import { changeDraft } from '../lib/survey-builder.mjs';
import { privateSurveyToken } from '../lib/custom-surveys.mjs';
import { randomUUID } from 'node:crypto';
const fixture = await officeFixture();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
const failures = [],
  screens = path.resolve(import.meta.dirname, '../../.preview/office-audit');
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
      path: path.join(screens, name.replaceAll(/[^a-z0-9]/gi, '-') + '.png'),
    });
  } finally {
    await context.close();
  }
}
// Session-expiry helpers: a routed 401 ends the session for the page only.
async function expireRoute(page, pattern, method) {
  await page.route(pattern, (route) =>
    method && route.request().method() !== method
      ? route.continue()
      : route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Session expired' }),
        }),
  );
}
async function expectPaused(page) {
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#office')).toBeHidden();
  await expect(page.locator('#office')).toHaveAttribute('inert', '');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('Your session ended');
}
async function signInAgain(page, email) {
  if (email) await page.locator('#login-form [name="email"]').fill(email);
  await page
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .click();
  await page.getByLabel('Sign-in code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function openContact(page) {
  await page
    .locator('#inbox-pane')
    .getByRole('button', { name: 'Contacts & follow-up', exact: true })
    .click();
  const dialog = page.locator('.contact-dialog:not(.submission-dialog)');
  await dialog.getByRole('button', { name: /rsvp@example.edu/ }).click();
  return dialog;
}
async function typeContactNote(page, text) {
  const dialog = await openContact(page);
  await dialog
    .getByLabel('Record a follow-up note', { exact: true })
    .fill(text);
  return dialog;
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
          request.method() === 'POST' && request.url().endsWith('/api/admin'),
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
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    },
  );
  await check(
    'Expired session pauses the office and keeps drafts',
    async (page) => {
      const dialog = await typeContactNote(
        page,
        'Unsaved note kept through sign-in',
      );
      await expireRoute(page, '**/api/surveys?**');
      await dialog
        .getByRole('button', { name: '← All contacts', exact: true })
        .click();
      await expectPaused(page);
      await expect(page.locator('#login-form [name="email"]')).toHaveValue(
        'officer@example.com',
      );
      await expect(page.locator('#login-form [name="email"]')).toHaveAttribute(
        'readonly',
        '',
      );
      // The card already says the session ended; the banner only announces.
      await expect(page.locator('#status')).toHaveClass(/visually-hidden/);
      await expect(page.locator('#reauth-email-hint')).toBeVisible();
      await page.unroute('**/api/surveys?**');
      await page
        .getByRole('button', { name: 'Send sign-in code', exact: true })
        .click();
      await expect(
        page.getByLabel('Sign-in code', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('#change-email')).toBeHidden();
      await page.getByLabel('Sign-in code', { exact: true }).fill('123456');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.locator('#office')).toBeVisible();
      await expect(page.locator('#office')).not.toHaveAttribute('inert');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /rsvp@example.edu/ }).click();
      await expect(
        dialog.getByLabel('Record a follow-up note', { exact: true }),
      ).toHaveValue('Unsaved note kept through sign-in');
      // The reopened dialog still returns focus to the button that opened it.
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => document.activeElement.textContent))
        .toBe('Contacts & follow-up');
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
      await page.getByRole('button', { name: /Remove access for/ }).waitFor();
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
      const answeringLink = await page
        .getByRole('link', {
          name: 'Open private survey ↗',
          exact: true,
        })
        .getAttribute('href');
      await page
        .getByRole('button', { name: 'Close survey', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Cancel closing', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Close survey', exact: true }),
      ).toBeEnabled();
      await page.getByRole('button', { name: /Remove access for/ }).click();
      await page.getByText('Archived respondents', { exact: true }).click();
      await page.getByRole('button', { name: /Restore access for/ }).click();
      await page.getByRole('button', { name: /Remove access for/ }).waitFor();
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
      await page.goto(answeringLink);
      await expect(
        page.getByRole('heading', {
          name: 'Survey unavailable',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText('What makes advising worth your time?', {
          exact: true,
        }),
      ).toHaveCount(0);
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
  await check('Late custom draft cannot redraw after signout', async (page) => {
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
    await page.getByLabel('Custom survey', { exact: true }).selectOption(id);
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
    // Signed out: focus is on the email field, the tabs are reset and the
    // re-auth links take no space.
    await expect(page.locator('#login-form [name="email"]')).toBeFocused();
    await expect(page.locator('#inbox-tab')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#surveys-tab')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.locator('.login-links')).toHaveAttribute('hidden', '');
    const response = page.waitForResponse(
      '**/api/custom-surveys?action=draft&id=' + id,
    );
    release();
    await response;
    await expect(page.locator('#custom-surveys-root')).toBeEmpty();
    await expect(page.locator('#office')).toBeHidden();
  });
  await check('Discarded event edits stay discarded', async (page, dialogs) => {
    await page.locator('#events-tab').click();
    await page.locator('#new-event').click();
    await page.locator('#event-form [name=title]').fill('Unsaved event change');
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
  });
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
    await expect(page.locator('#survey-results .survey-response')).toHaveCount(
      1,
    );
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
    await expect(page.getByLabel('Survey title', { exact: true })).toHaveValue(
      'Keep on same tab',
    );
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
  await check('Contact notes survive closing and reopening', async (page) => {
    await page
      .locator('#inbox-pane')
      .getByRole('button', { name: 'Contacts & follow-up', exact: true })
      .click();
    const dialog = page.locator('.contact-dialog:not(.submission-dialog)');
    await dialog.getByRole('button', { name: /rsvp@example.edu/ }).click();
    await dialog
      .getByLabel('Record a follow-up note', { exact: true })
      .fill('Unsaved follow-up that should not disappear');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page
      .locator('#inbox-pane')
      .getByRole('button', { name: 'Contacts & follow-up', exact: true })
      .click();
    await dialog.getByRole('button', { name: /rsvp@example.edu/ }).click();
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
    await expect(dialog).toContainText('Could not connect to Club Office');
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
  });
  await check(
    'Survey answers survive a lost acknowledgement without duplicate receipts',
    async (page) => {
      const id = randomUUID(),
        questionId = randomUUID(),
        optionalId = randomUUID();
      const definition = {
        template: 'blank',
        title: 'Respondent recovery audit',
        intro: '',
        audience: 'public',
        durationDays: 30,
        permissions: {
          preview: 'link',
          answer: 'verified',
          results: 'admins',
        },
        questions: [
          {
            id: questionId,
            title: 'Your feedback',
            description: '',
            type: 'text',
            required: true,
            options: [],
          },
          {
            id: optionalId,
            title: 'Optional comment',
            description: '',
            type: 'text',
            required: false,
            options: [],
          },
        ],
      };
      for (const [action, expectedRevision] of [
        ['save', 0],
        ['publish', 1],
      ])
        await changeDraft(
          fixture.db,
          { email: 'officer@example.com' },
          {
            id,
            definition,
            action,
            expectedRevision,
            requestId: randomUUID(),
          },
        );
      await page.goto(
        fixture.origin + '/surveys/#invite=' + privateSurveyToken(id),
      );
      await page
        .getByRole('button', {
          name: 'Continue to questions →',
          exact: true,
        })
        .click();
      await page
        .getByRole('textbox', { name: 'Email address', exact: true })
        .fill('recovery@example.com');
      await page
        .getByRole('button', { name: 'Send sign-in code', exact: true })
        .click();
      await page
        .getByRole('textbox', { name: 'Sign-in code', exact: true })
        .fill('123456');
      await page
        .getByRole('button', {
          name: 'Verify and continue',
          exact: true,
        })
        .click();
      await page
        .getByRole('button', { name: 'Review answers →', exact: true })
        .click();
      await expect(page.locator('#main').getByRole('status')).toContainText(
        'Answer the required question',
      );
      await page
        .getByRole('textbox', { name: 'Your feedback *', exact: true })
        .fill('Not answered');
      await page
        .getByRole('textbox', { name: 'Optional comment', exact: true })
        .fill('   ');
      await page
        .getByRole('button', { name: 'Review answers →', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Submit answers', exact: true })
        .click();
      await expect(page.locator('#main').getByRole('status')).toContainText(
        'Confirm',
      );
      await page.getByRole('checkbox').check();
      let dropped = false;
      await page.route('**/api/custom-surveys?action=submit', async (route) => {
        if (dropped) return route.continue();
        dropped = true;
        await route.fetch();
        await route.abort('failed');
      });
      await page
        .getByRole('button', { name: 'Submit answers', exact: true })
        .click();
      await expect(page.locator('#main').getByRole('status')).toContainText(
        'Your answers remain in this tab',
      );
      await page
        .getByRole('button', { name: 'Submit answers', exact: true })
        .click();
      await expect(
        page.getByRole('heading', {
          name: 'Your response is saved',
          exact: true,
        }),
      ).toBeVisible();
      assert.equal(
        (
          await fixture.db.query(
            'SELECT count(*)::int n FROM club_forms.custom_survey_receipts WHERE survey_id=$1',
            [id],
          )
        ).rows[0].n,
        1,
      );
      const stored = (
        await fixture.db.query(
          'SELECT responses FROM club_forms.custom_survey_responses WHERE survey_id=$1',
          [id],
        )
      ).rows[0].responses;
      assert.deepEqual(
        stored.map((answer) => answer.value),
        ['Not answered'],
      );
      await page.reload();
      await page
        .getByRole('button', {
          name: 'Continue to questions →',
          exact: true,
        })
        .click();
      await expect(
        page.getByRole('textbox', {
          name: 'Your feedback *',
          exact: true,
        }),
      ).toHaveValue('Not answered');
    },
  );
  await check(
    'CSV export errors stay in the office and a retry downloads the file',
    async (page) => {
      const exportRoute = '**/api/admin?*export=csv';
      await page.route(exportRoute, (route) =>
        route.fulfill({
          status: 413,
          contentType: 'application/json',
          body: JSON.stringify({
            error:
              'More than 10,000 submissions match. Narrow the filters before exporting.',
          }),
        }),
      );
      await page
        .getByRole('link', { name: 'Export filtered CSV', exact: true })
        .click();
      await expect(page.locator('#status')).toContainText('Narrow the filters');
      await expect(page.locator('#office')).toBeVisible();
      await page.unroute(exportRoute);
      const download = page.waitForEvent('download');
      await page
        .getByRole('link', { name: 'Export filtered CSV', exact: true })
        .click();
      assert.equal(
        (await download).suggestedFilename(),
        'club-submissions.csv',
      );
      await expect(page.locator('#status')).toHaveText('CSV download started.');
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
  await check(
    'Contact profiles consolidate primary identity, retain drafts and clean unused aliases',
    async (page) => {
      await page
        .locator('#inbox-pane')
        .getByRole('button', { name: 'Contacts & follow-up', exact: true })
        .click();
      const dialog = page.locator('.contact-dialog:not(.submission-dialog)');
      await dialog.getByRole('button', { name: /join@example.edu/ }).click();
      await dialog
        .getByLabel('Record a follow-up note', { exact: true })
        .fill('Keep this draft during contact corrections');
      await dialog
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      await dialog
        .getByLabel('Contact name', { exact: true })
        .fill('Corrected profile');
      await dialog
        .getByLabel('Primary email', { exact: true })
        .fill('preferred-profile@example.edu');
      await dialog
        .getByRole('button', { name: 'Save contact changes', exact: true })
        .click();
      await expect(
        dialog.getByRole('heading', {
          name: 'Corrected profile',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByLabel('Record a follow-up note', { exact: true }),
      ).toHaveValue('Keep this draft during contact corrections');
      await dialog
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      await dialog
        .getByLabel('Contact name', { exact: true })
        .fill('Unsaved profile name');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await page
        .locator('#inbox-pane')
        .getByRole('button', { name: 'Contacts & follow-up', exact: true })
        .click();
      await dialog
        .getByRole('button', {
          name: /Corrected profile preferred-profile@example.edu/,
        })
        .click();
      await dialog
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      await expect(
        dialog.getByLabel('Contact name', { exact: true }),
      ).toHaveValue('Unsaved profile name');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      await expect(
        dialog.getByLabel('Contact name', { exact: true }),
      ).toHaveValue('Corrected profile');
      await dialog
        .getByLabel('Primary email', { exact: true })
        .fill('final-profile@example.edu');
      await dialog
        .getByRole('button', { name: 'Save contact changes', exact: true })
        .click();
      await expect(
        dialog.getByText('Primary email: final-profile@example.edu', {
          exact: true,
        }),
      ).toBeVisible();
      await dialog
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      const unused = dialog
        .locator('.contact-alias-row')
        .filter({ hasText: 'preferred-profile@example.edu' });
      await unused
        .getByRole('button', {
          name: 'Remove unused address',
          exact: true,
        })
        .click();
      await unused
        .getByRole('button', { name: 'Cancel removal', exact: true })
        .click();
      await expect(
        unused.getByRole('button', {
          name: 'Remove unused address',
          exact: true,
        }),
      ).toBeEnabled();
      await unused
        .getByRole('button', {
          name: 'Remove unused address',
          exact: true,
        })
        .click();
      await unused
        .getByRole('button', {
          name: 'Confirm remove address',
          exact: true,
        })
        .click();
      await expect(
        dialog.getByText('Other linked emails: join@example.edu', {
          exact: true,
        }),
      ).toBeVisible();
      await dialog
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      await expect(
        dialog
          .locator('.contact-alias-row')
          .filter({ hasText: 'join@example.edu' })
          .getByRole('button', {
            name: 'Remove unused address',
            exact: true,
          }),
      ).toBeDisabled();
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        );
      }
      const canonical = (
        await fixture.db.query(
          "SELECT contact_email FROM club_forms.contact_emails WHERE email='join@example.edu'",
        )
      ).rows[0].contact_email;
      assert.equal(canonical, 'final-profile@example.edu');
      assert.equal(
        (
          await fixture.db.query(
            "SELECT email FROM club_forms.contacts WHERE email='preferred-profile@example.edu'",
          )
        ).rows.length,
        0,
      );
      await dialog
        .locator('.contact-alias-row')
        .filter({ hasText: 'join@example.edu' })
        .getByRole('link', { name: /^Open response:/ })
        .click();
      await expect(dialog).not.toBeVisible();
      await page
        .getByRole('button', { name: 'Edit response', exact: true })
        .click();
      const responseDialog = page.locator('.submission-dialog');
      await responseDialog
        .getByLabel('Email address', { exact: true })
        .fill('final-profile@example.edu');
      await responseDialog
        .getByRole('button', { name: 'Save changes', exact: true })
        .click();
      await expect(page.locator('#status')).toHaveText('Response updated.');
      await page
        .locator('#inbox-pane')
        .getByRole('button', { name: 'Contacts & follow-up', exact: true })
        .click();
      await dialog
        .getByRole('button', {
          name: /Corrected profile final-profile@example.edu/,
        })
        .click();
      await dialog
        .getByRole('button', { name: 'Edit contact', exact: true })
        .click();
      await expect(
        dialog
          .locator('.contact-alias-row')
          .filter({ hasText: 'join@example.edu' })
          .getByRole('button', {
            name: 'Remove unused address',
            exact: true,
          }),
      ).toBeEnabled();
    },
  );
  await check(
    'A poll 401 keeps drafts and drops records after ten minutes',
    async (page) => {
      await page.clock.install();
      await page.reload();
      await page.locator('#office').waitFor();
      const comment = page.locator('#entries .entry textarea').first();
      await page.locator('#entries .entry > summary').first().click();
      await page
        .locator('#entries .entry')
        .first()
        .getByText('Activity & comments', { exact: true })
        .click();
      await comment.fill('Comment kept through sign-in');
      await page.locator('#events-tab').click();
      await page.locator('#new-event').click();
      await page
        .locator('#event-form [name="title"]')
        .fill('Typed before the poll');
      await expireRoute(page, '**/api/admin?**');
      await page.clock.runFor(61000);
      await expectPaused(page);
      await expect(page.locator('#entries .entry')).not.toHaveCount(0);
      await page.clock.runFor(600000);
      await expect(page.locator('#entries .entry')).toHaveCount(0);
      await page.unroute('**/api/admin?**');
      await signInAgain(page);
      await expect(page.locator('#events-pane')).toBeVisible();
      await expect(page.locator('#event-form [name="title"]')).toHaveValue(
        'Typed before the poll',
      );
      await expect(page.locator('#entries .entry')).not.toHaveCount(0);
      await expect(comment).toHaveValue('Comment kept through sign-in');
      await expect(page.locator('#event-list .event-choice')).not.toHaveCount(
        0,
      );
    },
  );
  await check(
    'Save draft that met a 401 is saved once after signing in again',
    async (page) => {
      await page.locator('#events-tab').click();
      await page.locator('#new-event').click();
      await page
        .locator('#event-form [name="title"]')
        .fill('Saved once after re-auth');
      let refused = 0;
      await page.route('**/api/events', (route) =>
        route.request().method() !== 'POST' || refused++
          ? route.continue()
          : route.fulfill({
              status: 401,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Session expired' }),
            }),
      );
      await page
        .getByRole('button', { name: 'Save draft', exact: true })
        .click();
      await expectPaused(page);
      await signInAgain(page);
      await page
        .locator('#event-status')
        .getByText(/^Draft saved successfully/)
        .waitFor();
      assert.equal(refused, 2);
      assert.equal(
        (
          await fixture.db.query(
            "SELECT count(*)::int n FROM club_forms.events WHERE draft->>'title'=$1",
            ['Saved once after re-auth'],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check(
    'A different account discards drafts and waiting requests',
    async (page, dialogs) => {
      const dialog = await typeContactNote(
        page,
        'Discarded with the other account',
      );
      await expireRoute(page, '**/api/surveys?**');
      await dialog
        .getByRole('button', { name: '← All contacts', exact: true })
        .click();
      await expectPaused(page);
      await page
        .getByRole('button', { name: 'Use a different account', exact: true })
        .click();
      assert.equal(dialogs.length, 1);
      assert.match(dialogs[0], /Follow-up note for rsvp@example.edu/);
      await expect(page.locator('#status')).toHaveText(
        'Not saved — signed in as a different account.',
      );
      await expect(page.locator('#login-form [name="email"]')).toHaveValue('');
      await page.unroute('**/api/surveys?**');
      await signInAgain(page, 'second-officer@example.com');
      await expect(page.locator('#identity')).toHaveText(
        'Signed in as second-officer@example.com',
      );
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await openContact(page);
      await expect(
        dialog.getByLabel('Record a follow-up note', { exact: true }),
      ).toHaveValue('');
      assert.equal(dialogs.length, 1);
    },
  );
  await check(
    'Save note & mark reviewed saves both and focuses the next card',
    async (page) => {
      const [first, second] = await page
        .locator('#entries .entry')
        .evaluateAll((cards) => cards.map((card) => card.id));
      const card = page.locator('#' + first),
        id = first.replace('entry-', '');
      await page.locator('#' + first + ' > summary').click();
      await card.getByText('Activity & comments', { exact: true }).click();
      // Spaces alone are not a note.
      await card.getByLabel('Add a comment', { exact: true }).fill('   ');
      await expect(
        card.getByRole('button', { name: 'Mark reviewed', exact: true }),
      ).toBeVisible();
      await card
        .getByLabel('Add a comment', { exact: true })
        .fill('Called them back.');
      let release;
      const held = new Promise((resolve) => (release = resolve));
      await page.route('**/api/admin', async (route) => {
        if (route.request().method() === 'POST') await held;
        await route.continue();
      });
      await card
        .getByRole('button', { name: 'Save note & mark reviewed', exact: true })
        .click();
      // Every button on the card is busy and the note is locked until the
      // request finishes.
      await expect(
        card.locator('button:not([aria-disabled="true"])'),
      ).toHaveCount(0);
      await expect(
        card.getByLabel('Add a comment', { exact: true }),
      ).toBeDisabled();
      release();
      await expect(card).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.activeElement.tagName +
              ' ' +
              document.activeElement.parentElement?.id,
          ),
        )
        .toBe('SUMMARY ' + second);
      const saved = (
        await fixture.db.query(
          `SELECT review_status,(SELECT count(*)::int FROM club_forms.entry_comments c WHERE c.entry_id=e.id AND c.body=$2) AS comments FROM club_forms.entries e WHERE id=$1`,
          [id, 'Called them back.'],
        )
      ).rows[0];
      assert.deepEqual(saved, { review_status: 'reviewed', comments: 1 });
      await fixture.db.query(
        "UPDATE club_forms.entries SET review_status='new' WHERE id=$1",
        [id],
      );
    },
  );
  await check(
    'A stale status names who changed it and refreshes the card',
    async (page) => {
      const { id } = fixture.entries.find((row) => row.kind === 'workshop'),
        card = page.locator('#entry-' + id);
      await page.locator('#entry-' + id + ' > summary').click();
      await fixture.db.query(
        "UPDATE club_forms.entries SET review_status='closed' WHERE id=$1",
        [id],
      );
      await fixture.db.query(
        "INSERT INTO club_forms.audit(actor,entry_id,action) VALUES('other-officer@example.com',$1,'review:closed')",
        [id],
      );
      await card
        .getByRole('button', { name: 'Mark reviewed', exact: true })
        .click();
      await expect(page.locator('#status')).toContainText(
        'other-officer@example.com already',
      );
      await expect(card.locator('.badge')).toHaveText('archived');
      await expect(card).toHaveAttribute('open', '');
      await expect(
        card.getByRole('button', { name: 'Delete permanently', exact: true }),
      ).toBeVisible();
      await fixture.db.query(
        "UPDATE club_forms.entries SET review_status='new' WHERE id=$1",
        [id],
      );
    },
  );
  await check('Editing a response keeps its comment draft', async (page) => {
    const { id } = fixture.entries.find((row) => row.kind === 'subscribe'),
      card = page.locator('#entry-' + id);
    await page.locator('#entry-' + id + ' > summary').click();
    await card.getByText('Activity & comments', { exact: true }).click();
    await card
      .getByLabel('Add a comment', { exact: true })
      .fill('Draft kept through an edit');
    await card
      .getByRole('button', { name: 'Edit response', exact: true })
      .click();
    const dialog = page.locator('.submission-dialog[open]');
    await dialog
      .getByLabel('Full name', { exact: true })
      .fill('Office subscriber edited');
    await dialog
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await expect(page.locator('#status')).toHaveText('Response updated.');
    await expect(card.getByLabel('Add a comment', { exact: true })).toHaveValue(
      'Draft kept through an edit',
    );
  });
  await check(
    'A failed first load shows the load error, not the sign-in form',
    async (page) => {
      await page.route('**/api/admin?**', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'This service is temporarily unavailable.',
            reference: '0a1b2c3d',
          }),
        }),
      );
      await page.reload();
      await expect(page.locator('#load-error')).toBeVisible();
      await expect(page.locator('#load-error h1')).toBeFocused();
      assert.match(
        await page.locator('#load-error-message').textContent(),
        /Retrying in 2 s/,
      );
      await expect(page.locator('#login')).toBeHidden();
      await expect(page.locator('#office')).toBeHidden();
      await page.unroute('**/api/admin?**');
      await page
        .getByRole('button', { name: 'Try again', exact: true })
        .click();
      await expect(page.locator('#office')).toBeVisible();
      await expect(page.locator('#load-error')).toBeHidden();
      await expect(page.locator('#office h1')).toBeFocused();
    },
  );
  await check('A malformed entry link opens the plain inbox', async (page) => {
    await page.goto(fixture.origin + '/admin/?link#entry=not-a-submission');
    await expect(page.locator('#office')).toBeVisible();
    await expect(page.locator('#load-error')).toBeHidden();
    await expect(page.locator('#entries .entry')).not.toHaveCount(0);
    assert.equal(new URL(page.url()).hash, '');
  });
  await check(
    'A non-officer account sees an explanation instead of the sign-in form',
    async (page) => {
      await page.route('**/api/admin?**', (route) =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'This account isn’t set up as a club officer.',
            code: 'not-officer',
          }),
        }),
      );
      await page.reload();
      await expect(page.locator('#not-officer')).toContainText(
        'signed in as officer@example.com',
      );
      await expect(page.locator('#not-officer h1')).toBeFocused();
      await expect(page.locator('#login')).toBeHidden();
      await expect(page.locator('#office')).toBeHidden();
      await page.unroute('**/api/admin?**');
      await page
        .locator('#not-officer')
        .getByRole('button', { name: 'Sign out', exact: true })
        .click();
      await expect(page.locator('#login')).toBeVisible();
      await expect(page.locator('#not-officer')).toBeHidden();
      await expect(page.locator('#login-form [name="email"]')).toBeFocused();
    },
  );
  await check(
    'Focus stays in the inbox after signing in again',
    async (page) => {
      await page.clock.install();
      await page.reload();
      await page.locator('#office').waitFor();
      const [first, second, third] = await page
        .locator('#entries .entry')
        .evaluateAll((cards) => cards.map((card) => card.id));
      const settled = async () => {
        await page.waitForTimeout(300);
        await expect(page.locator('#entries')).toHaveAttribute(
          'aria-busy',
          'false',
        );
      };
      // A poll meets a 401 while a comment is being typed.
      const firstCard = page.locator('#' + first),
        comment = firstCard.getByLabel('Add a comment', { exact: true });
      await page.locator('#' + first + ' > summary').click();
      await firstCard.getByText('Activity & comments', { exact: true }).click();
      await comment.fill('Typing when the poll ran');
      await expireRoute(page, '**/api/admin?**');
      await page.clock.runFor(61000);
      await expectPaused(page);
      await page.unroute('**/api/admin?**');
      await signInAgain(page);
      await settled();
      await expect(comment).toBeFocused();
      // "Save note & mark reviewed" meets a 401.
      const secondCard = page.locator('#' + second);
      await page.locator('#' + second + ' > summary').click();
      await secondCard
        .getByText('Activity & comments', { exact: true })
        .click();
      await secondCard
        .getByLabel('Add a comment', { exact: true })
        .fill('Saved after signing in again');
      await expireRoute(page, '**/api/admin', 'POST');
      await secondCard
        .getByRole('button', { name: 'Save note & mark reviewed', exact: true })
        .click();
      await expectPaused(page);
      await page.unroute('**/api/admin');
      await signInAgain(page);
      await expect(secondCard).toHaveCount(0);
      await settled();
      assert.equal(
        await page.evaluate(
          () =>
            document.activeElement.tagName +
            ' ' +
            document.activeElement.parentElement?.id,
        ),
        'SUMMARY ' + third,
      );
      await fixture.db.query(
        "UPDATE club_forms.entries SET review_status='new' WHERE id=$1",
        [second.replace('entry-', '')],
      );
    },
  );
  await check(
    'Downloads that met a 401 run after signing in again',
    async (page) => {
      const refuse = (count) => (route) =>
        count.n++
          ? route.continue()
          : route.fulfill({
              status: 401,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Session expired' }),
            });
      const inbox = { n: 0 },
        survey = { n: 0 };
      await page.route('**/api/admin?*export=csv', refuse(inbox));
      let download = page.waitForEvent('download', { timeout: 15000 });
      await page
        .getByRole('link', { name: 'Export filtered CSV', exact: true })
        .click();
      await expectPaused(page);
      await signInAgain(page);
      assert.equal(
        (await download).suggestedFilename(),
        'club-submissions.csv',
      );
      await expect(page.locator('#status')).toHaveText('CSV download started.');
      await page.locator('#surveys-tab').click();
      await page.locator('#survey-results .survey-response').first().waitFor();
      await page.route(
        (url) =>
          url.pathname === '/api/surveys' && url.searchParams.has('export'),
        refuse(survey),
      );
      download = page.waitForEvent('download', { timeout: 15000 });
      await page
        .getByRole('button', { name: 'Export matching CSV', exact: true })
        .click();
      await expectPaused(page);
      await signInAgain(page);
      await download;
      await expect(page.locator('#survey-status')).toHaveText(
        'CSV downloaded. It includes all matching responses across every page.',
      );
      assert.deepEqual([inbox.n, survey.n], [2, 2]);
    },
  );
  await check(
    'Sign out and discard asks first and lists the drafts',
    async (page, dialogs, setAccept) => {
      const dialog = await typeContactNote(page, 'Kept unless discarded');
      await expireRoute(page, '**/api/surveys?**');
      await dialog
        .getByRole('button', { name: '← All contacts', exact: true })
        .click();
      await expectPaused(page);
      const discard = page.getByRole('button', {
        name: 'Sign out and discard unsaved work',
        exact: true,
      });
      setAccept(false);
      await discard.click();
      assert.equal(dialogs.length, 1);
      assert.match(dialogs[0], /Follow-up note for rsvp@example.edu/);
      await expect(page.locator('#reauth-note')).toBeVisible();
      setAccept(true);
      await discard.click();
      await expect(page.locator('#reauth-note')).toBeHidden();
      await expect(page.locator('#login-form [name="email"]')).toBeFocused();
      await expect(page.locator('#login-form [name="email"]')).toHaveValue('');
      await page.unroute('**/api/surveys?**');
    },
  );
  await check(
    'A contact edit draft survives a change to the contact',
    async (page) => {
      const dialog = page.locator('.contact-dialog:not(.submission-dialog)'),
        open = async () => {
          await page
            .locator('#inbox-pane')
            .getByRole('button', { name: 'Contacts & follow-up', exact: true })
            .click();
          await dialog
            .getByRole('button', { name: /workshop@example.edu/ })
            .click();
          await dialog
            .getByRole('button', { name: 'Edit contact', exact: true })
            .click();
        };
      await open();
      await dialog
        .getByLabel('Contact name', { exact: true })
        .fill('Draft contact name');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      const bumped = await fixture.db.query(
        "UPDATE club_forms.contacts SET revision=revision+1 WHERE email='workshop@example.edu'",
      );
      assert.equal(bumped.affectedRows, 1);
      await open();
      await expect(
        dialog.getByLabel('Contact name', { exact: true }),
      ).toHaveValue('Draft contact name');
      await expect(dialog).toContainText(
        'This contact changed after you started editing.',
      );
    },
  );
  await check(
    'Details sent again through the website show as a system event',
    async (page) => {
      const { id } = fixture.entries.find((row) => row.kind === 'contribution'),
        commentId = randomUUID(),
        card = page.locator('#entry-' + id);
      await fixture.db.query(
        "INSERT INTO club_forms.entry_comments(id,entry_id,author_email,body) VALUES($1,$2,'website',$3)",
        [
          commentId,
          id,
          'Unverified details submitted through the public website:\nTitle: Revised',
        ],
      );
      await fixture.db.query(
        "INSERT INTO club_forms.audit(actor,entry_id,action,comment_id) VALUES('website',$1,'resubmitted',$2)",
        [id, commentId],
      );
      await page.locator('#entry-' + id + ' > summary').click();
      await card.getByText('Activity & comments', { exact: true }).click();
      const row = card.locator('.activity-item.system-event');
      await expect(row).toContainText(
        'Updated details from the website (unverified)',
      );
      await expect(row.locator('.system-note')).toContainText('Title: Revised');
      await expect(row.locator('.officer-comment')).toHaveCount(0);
    },
  );
  await check(
    'A sign-in as someone else in another tab discards this page’s drafts',
    async (page, dialogs) => {
      const dialog = await typeContactNote(
        page,
        'Written before the other tab signed in',
      );
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await fetch(fixture.origin + '/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'third-officer@example.com',
          otp: '123456',
        }),
      });
      await page.locator('#refresh').click();
      await expect(page.locator('#identity')).toHaveText(
        'Signed in as third-officer@example.com',
      );
      assert.equal(dialogs.length, 1);
      assert.match(dialogs[0], /now signed in as third-officer@example.com/);
      assert.match(dialogs[0], /Follow-up note for rsvp@example.edu/);
      await openContact(page);
      await expect(
        dialog.getByLabel('Record a follow-up note', { exact: true }),
      ).toHaveValue('');
    },
  );
} finally {
  await browser.close();
  await fixture.close();
}
assert.deepEqual(failures, []);
