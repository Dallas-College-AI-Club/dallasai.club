// Disposable local fixture only. Run after npm run build.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { officeFixture } from './helpers/office-fixture.mjs';
import { changeDraft } from '../lib/survey-builder.mjs';
import {
  linkedSurvey,
  privateSurveyToken,
  rememberDevice,
  deviceCookie,
  submitSurvey,
} from '../lib/custom-surveys.mjs';

const f = await officeFixture();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
});
try {
  const id = randomUUID(),
    questionId = randomUUID();
  const definition = {
    template: 'feedback',
    title: 'Lifecycle browser survey',
    intro: 'Local test.',
    audience: 'public',
    permissions: { preview: 'link', answer: 'verified', results: 'admins' },
    durationDays: 30,
    questions: [
      {
        id: questionId,
        title: 'Original preferred time',
        description: '',
        type: 'multiple',
        required: true,
        options: ['Morning', 'Evening'],
      },
    ],
  };
  for (const [action, expectedRevision] of [
    ['save', 0],
    ['publish', 1],
  ])
    await changeDraft(
      f.db,
      { email: 'officer@example.com' },
      { id, action, expectedRevision, definition, requestId: randomUUID() },
    );
  const token = privateSurveyToken(id),
    survey = await linkedSurvey(f.db, token);
  const device = await rememberDevice(f.db, survey, {
    id: 'browser-lifecycle',
    email: 'lifecycle@example.edu',
    name: 'Lifecycle Student',
    emailVerified: true,
  });
  await submitSurvey(
    f.db,
    { headers: { cookie: deviceCookie(survey) + '=' + device.token } },
    token,
    {
      requestId: randomUUID(),
      expectedRevision: 0,
      contentVersion: 'custom-form/1',
      advisorId: device.member.advisor_id,
      consent: 'admins',
      answers: [{ id: questionId, value: [1] }],
    },
  );
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(f.origin + '/test-signin');
  await expect(page.locator('#office')).toBeVisible();
  const manage = async () => {
    await page.goto(f.origin + '/admin/#/surveys/custom/' + id);
    await expect(page.locator('#custom-surveys-root')).toContainText(
      definition.title,
    );
  };
  const confirm = async (label) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.locator('#confirm-dialog [data-confirm]').click();
  };
  await manage();
  const expiration = () => page.locator('.survey-expiration');
  const changeExpiration = async (value) => {
    if ((await expiration().getAttribute('open')) === null)
      await expiration().locator('summary').click();
    await expiration()
      .getByRole('checkbox', { name: 'Never expires', exact: true })
      .setChecked(value === null);
    if (value !== null)
      await expiration()
        .getByLabel('Expiration date and time (Central)', { exact: true })
        .fill(value);
    await expiration()
      .getByRole('button', { name: 'Save expiration', exact: true })
      .click();
  };
  const currentExpiration = async () =>
    (
      await f.db.query(
        'SELECT expires_at FROM club_forms.custom_surveys WHERE id=$1',
        [id],
      )
    ).rows[0].expires_at;
  const deviceDeadline = (
    await f.db.query(
      'SELECT expires_at FROM club_forms.custom_survey_devices WHERE survey_id=$1',
      [id],
    )
  ).rows[0].expires_at;
  // Commit the first change but lose its acknowledgement; retry must reuse it.
  const expirationRequests = [];
  const lifecycleRoute = '**/api/custom-surveys?action=lifecycle';
  await page.route(lifecycleRoute, async (route) => {
    const body = route.request().postDataJSON();
    expirationRequests.push(body);
    if (expirationRequests.length === 1) {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    } else await route.continue();
  });
  await changeExpiration(null);
  await expect(expiration().getByRole('status')).not.toBeEmpty();
  assert.equal(await currentExpiration(), null);
  await expiration()
    .getByRole('button', { name: 'Save expiration', exact: true })
    .click();
  await expect(page.locator('#custom-surveys-root')).toContainText(
    'Never expires',
  );
  await expect(expiration()).not.toHaveAttribute('open', '');
  await page.unroute(lifecycleRoute);
  assert.equal(expirationRequests.length, 2);
  assert.deepEqual(expirationRequests[0], expirationRequests[1]);
  assert.equal(
    (
      await f.db.query(
        "SELECT count(*)::int AS total FROM club_forms.custom_survey_changes WHERE survey_id=$1 AND action='expiration_changed'",
        [id],
      )
    ).rows[0].total,
    1,
  );
  assert.equal(await currentExpiration(), null);
  await page.goto(f.origin + '/admin/#/home');
  await expect(
    page.locator('[aria-labelledby="tile-custom-survey"]'),
  ).toContainText('Never expires');
  await manage();
  assert.equal(
    +new Date(
      (
        await f.db.query(
          'SELECT expires_at FROM club_forms.custom_survey_devices WHERE survey_id=$1',
          [id],
        )
      ).rows[0].expires_at,
    ),
    +new Date(deviceDeadline),
  );
  const noExpiryPage = await context.newPage();
  await noExpiryPage.goto(f.origin + '/surveys/#invite=' + token);
  await expect(noExpiryPage.locator('.survey-deadline')).toHaveText(
    'This survey does not expire.',
  );
  await noExpiryPage.goto(
    f.origin + '/surveys/#invite=' + token + '&preview=1',
  );
  await expect(noExpiryPage.locator('.survey-deadline')).toHaveText(
    'This survey does not expire.',
  );
  await noExpiryPage.close();
  await changeExpiration('2099-07-04T12:30');
  await expect
    .poll(async () => +new Date(await currentExpiration()))
    .toBe(Date.parse('2099-07-04T17:30:00Z'));
  await expect(expiration()).not.toHaveAttribute('open', '');
  await f.db.query(
    'UPDATE club_forms.custom_surveys SET edit_revision=edit_revision+1 WHERE id=$1',
    [id],
  );
  await changeExpiration(null);
  await expect(expiration().getByRole('status')).toContainText('changed');
  assert.equal(
    +new Date(await currentExpiration()),
    Date.parse('2099-07-04T17:30:00Z'),
  );
  // Expired surveys remain manageable and can reopen on the same invitation.
  await f.db.query(
    "UPDATE club_forms.custom_surveys SET expires_at=now()-interval '1 day' WHERE id=$1",
    [id],
  );
  await manage();
  await page.reload();
  await changeExpiration(null);
  await expect(page.locator('#custom-surveys-root')).toContainText(
    'Never expires',
  );
  assert.equal(await currentExpiration(), null);
  await page.goto(f.origin + '/admin/#/surveys');
  const libraryRow = page.locator('details.custom-survey-group').filter({
    has: page.locator(':scope > summary strong').getByText(definition.title, {
      exact: true,
    }),
  });
  await libraryRow.locator(':scope > summary').click();
  await expect(libraryRow.locator('.custom-survey-group-body')).toContainText(
    'Original preferred time',
  );
  await expect(
    libraryRow.getByRole('button', { name: 'Archive survey', exact: true }),
  ).toHaveCount(1);

  // Advisor Studio's welcome, preview and verified question view all accept null.
  await f.db.query(
    'UPDATE club_forms.custom_surveys SET expires_at=NULL WHERE id=$1',
    [f.id],
  );
  const advisorPage = await context.newPage();
  await advisorPage.goto(f.origin + '/surveys/#invite=' + f.token);
  await expect(advisorPage.locator('#survey-expiration')).toHaveText(
    'This survey does not expire.',
  );
  await advisorPage
    .getByRole('button', { name: 'Preview questions · no sign-in needed' })
    .click();
  await expect(advisorPage.locator('.sidebar')).toContainText(
    'This survey does not expire.',
  );
  const advisorSurvey = await linkedSurvey(f.db, f.token);
  const advisor = (
    await f.db.query(
      'SELECT advisor_id,email,display_name FROM club_forms.custom_survey_members WHERE survey_id=$1 LIMIT 1',
      [f.id],
    )
  ).rows[0];
  const advisorDevice = await rememberDevice(f.db, advisorSurvey, {
    id: 'browser-null-expiry-advisor',
    email: advisor.email,
    name: advisor.display_name,
    emailVerified: true,
  });
  await context.addCookies([
    {
      name: deviceCookie(advisorSurvey),
      value: advisorDevice.token,
      url: f.origin,
    },
  ]);
  await advisorPage.goto(f.origin + '/surveys/#invite=' + f.token);
  await advisorPage.getByRole('button', { name: 'Open my questions' }).click();
  await expect(advisorPage.locator('.sidebar')).toContainText(
    'This survey does not expire.',
  );
  await advisorPage.close();
  await manage();
  await confirm('Edit survey');
  await expect(page.locator('.builder-steps')).toBeVisible();
  await page.getByRole('button', { name: '3. Questions', exact: true }).click();
  await page
    .locator('.builder-question')
    .getByLabel('Question', { exact: true })
    .fill('Updated feedback');
  await page
    .locator('.builder-question')
    .getByLabel('Answer type', { exact: true })
    .selectOption('text');
  await page.getByRole('button', { name: '4. Preview', exact: true }).click();
  await expect(page.locator('.builder-panel')).toContainText(
    'Updated feedback',
  );
  await page.getByRole('button', { name: '5. Publish', exact: true }).click();
  await page
    .getByRole('button', { name: 'Publish survey', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Edit survey', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#custom-surveys-root')).toContainText(
    'Original preferred time',
  );
  await expect(page.locator('#custom-surveys-root')).toContainText('Evening');
  const downloaded = page.waitForEvent('download');
  await page
    .locator('#custom-surveys-root')
    .getByRole('button', { name: 'Export CSV', exact: true })
    .click();
  const csv = await readFile(await (await downloaded).path(), 'utf8');
  assert.match(csv, /Original preferred time/);
  assert.match(csv, /Evening/);
  await page
    .getByRole('button', {
      name: 'Download PDF for Lifecycle Student',
      exact: true,
    })
    .click();
  const pdfDownload = page.waitForEvent('download');
  await page
    .locator('.pdf-dialog')
    .getByRole('button', { name: 'Download PDF', exact: true })
    .click();
  const pdf = await readFile(await (await pdfDownload).path());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const pdfContent = Array.from(
    pdf
      .toString('latin1')
      .matchAll(/\/Filter \/FlateDecode[\s\S]*?stream\n([\s\S]*?)\nendstream/g),
    (match) => inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'),
  ).join('\n');
  assert.match(pdfContent, /Original preferred time/);
  assert.match(pdfContent, /Evening/);
  await context.addCookies([
    { name: deviceCookie(survey), value: device.token, url: f.origin },
  ]);
  const publicPage = await context.newPage();
  await publicPage.goto(f.origin + '/surveys/#invite=' + token);
  await publicPage
    .getByRole('button', { name: 'Continue to questions →', exact: true })
    .click();
  const field = publicPage.getByRole('textbox', {
    name: 'Updated feedback *',
    exact: true,
  });
  await expect(field).toHaveValue('');
  await field.fill('Fresh browser feedback');
  await publicPage
    .getByRole('button', { name: 'Review answers →', exact: true })
    .click();
  await publicPage
    .getByRole('checkbox', {
      name: 'I reviewed my answers and agree to share them with club admins.',
    })
    .check();
  await publicPage
    .getByRole('button', { name: 'Submit answers', exact: true })
    .click();
  await expect(
    publicPage.getByText('Your response is saved', { exact: false }),
  ).toBeVisible();
  const saved = (
    await f.db.query(
      'SELECT responses FROM club_forms.custom_survey_responses WHERE survey_id=$1',
      [id],
    )
  ).rows[0];
  assert.equal(saved.responses[0].text, 'Fresh browser feedback');
  await manage();
  await confirm('Archive survey');
  await expect(
    page.getByRole('button', { name: 'Restore survey', exact: true }),
  ).toBeVisible();
  await expect(expiration()).toHaveCount(0);
  await confirm('Restore survey');
  await expect(
    page.getByRole('button', { name: 'Edit survey', exact: true }),
  ).toBeVisible();
  await expect(expiration()).toHaveCount(0);
  assert.equal(
    (
      await f.db.query(
        'SELECT status FROM club_forms.custom_surveys WHERE id=$1',
        [id],
      )
    ).rows[0].status,
    'closed',
  );
  await confirm('Archive survey');
  await expect(
    page.getByRole('button', {
      name: 'Delete response permanently',
      exact: true,
    }),
  ).toBeVisible();
  await confirm('Delete response permanently');
  await expect(
    page.getByRole('button', {
      name: 'Delete response permanently',
      exact: true,
    }),
  ).toHaveCount(0);
  assert.equal(
    (
      await f.db.query(
        'SELECT active FROM club_forms.custom_survey_members WHERE survey_id=$1',
        [id],
      )
    ).rows[0].active,
    true,
  );
  await page
    .getByRole('button', { name: 'Delete survey permanently', exact: true })
    .click();
  await f.db.query(
    'UPDATE club_forms.custom_surveys SET edit_revision=edit_revision+1 WHERE id=$1',
    [id],
  );
  await page.locator('#confirm-dialog [data-confirm]').click();
  await expect(page.locator('#custom-surveys-root')).toContainText('changed');
  assert.equal(
    (
      await f.db.query('SELECT id FROM club_forms.custom_surveys WHERE id=$1', [
        id,
      ])
    ).rows.length,
    1,
  );
  await manage();
  await page.reload();
  await expect(
    page.getByRole('button', {
      name: 'Delete survey permanently',
      exact: true,
    }),
  ).toBeVisible();
  await confirm('Delete survey permanently');
  await expect(page).toHaveURL(/#\/surveys$/);
  assert.equal(
    (
      await f.db.query('SELECT id FROM club_forms.custom_surveys WHERE id=$1', [
        id,
      ])
    ).rows.length,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS survey expiration changes, null-expiry respondent and advisor previews, edit, republish, historical CSV, fresh public answers, archive, closed restore, archived response and survey deletion',
  );
} finally {
  await context.close();
  await browser.close();
  await f.close();
}
