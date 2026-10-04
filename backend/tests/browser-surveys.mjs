import { testDatabase } from './helpers/db.mjs';
import { adminHandler } from '../api/admin.mjs';
import { surveysHandler } from '../api/surveys.mjs';
import { formsHandler } from '../api/forms.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventHandler } from '../api/events.mjs';
import { RequestError } from '../lib/errors.mjs';
import { submit } from '../lib/submissions.mjs';
import { liveEvents } from '../lib/events.mjs';
import sharp from 'sharp';
const backend = fileURLToPath(new URL('../', import.meta.url));
const site = path.resolve(backend, '../public');
const screens = path.resolve(backend, '../.preview/event-checks');
const workshop = JSON.parse(
  await readFile(new URL('./fixtures/workshop.json', import.meta.url), 'utf8'),
);
await mkdir(screens, { recursive: true });
const db = await testDatabase();
const authorized = (req) => {
  if (req.headers.cookie?.includes('test-officer=signed-in'))
    return { email: 'officer@example.com' };
  throw new RequestError(401, 'Sign in with an authorized club email address.');
};
const events = eventHandler({
  getDatabase: () => db,
  authorize: authorized,
  originals: [],
  storage: {
    put: async (path, bytes) => {
      imageFiles.set(path, bytes);
      return { pathname: path };
    },
    del: async (path) => imageFiles.delete(path),
    get: async (path) => ({
      statusCode: 200,
      stream: new Blob([imageFiles.get(path)]).stream(),
    }),
  },
  rateLimit: async () => {},
});
const imageFiles = new Map();
process.env.BLOB_READ_WRITE_TOKEN = 'test-only';
const adminAPI = adminHandler({
  authorize: authorized,
  getDatabase: () => db,
  getEvents: () => liveEvents(db, []),
});
const surveyAPI = surveysHandler({
  authorize: authorized,
  getDatabase: () => db,
});
const formsAPI = formsHandler({
  getDatabase: () => db,
  getEvents: () => liveEvents(db, []),
  rateLimit: async () => {},
});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/events') return events(req, res);
  if (url.pathname.startsWith('/api/auth/')) {
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('email-otp/send-verification-otp'))
      return res.end('{"success":true}');
    if (url.pathname.endsWith('sign-in/email-otp')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (body.otp !== '123456') {
        res.statusCode = 400;
        return res.end('{"message":"Invalid code","code":"INVALID_OTP"}');
      }
      res.setHeader(
        'Set-Cookie',
        'test-officer=signed-in; HttpOnly; Path=/; SameSite=Lax',
      );
      return res.end(
        JSON.stringify({ user: { email: 'officer@example.com' } }),
      );
    }
    if (url.pathname.endsWith('sign-out')) {
      res.setHeader('Set-Cookie', 'test-officer=; Max-Age=0; Path=/');
      return res.end('{"success":true}');
    }
    return res.end(
      req.headers.cookie?.includes('test-officer=signed-in')
        ? '{"user":{"email":"officer@example.com"}}'
        : 'null',
    );
  }
  if (url.pathname === '/api/admin') return adminAPI(req, res);
  if (url.pathname === '/api/surveys') return surveyAPI(req, res);
  if (url.pathname === '/api/forms') return formsAPI(req, res);
  const root = url.pathname.startsWith('/admin/')
    ? path.join(backend, 'public')
    : site;
  const file = path.resolve(
    root,
    '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''),
  );
  try {
    if (!file.startsWith(root + path.sep)) throw Error();
    res.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.json')
            ? 'application/json'
            : file.endsWith('.html')
              ? 'text/html'
              : 'application/octet-stream',
    );
    const data = await readFile(file);
    res.end(
      file.endsWith('admin' + path.sep + 'index.html')
        ? data
            .toString()
            .replace(
              'data-site-origin="https://dallasai.club"',
              'data-site-origin="http://127.0.0.1:' +
                server.address().port +
                '"',
            )
        : data,
    );
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
process.env.AUTH_BASE_URL = origin;
process.env.FORMS_ALLOWED_ORIGINS = origin;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});

try {
  const context = await browser.newContext({
    viewport: { width: 1365, height: 950 },
  });
  await context.addCookies([
    { name: 'test-officer', value: 'signed-in', url: origin },
  ]);
  const admin = await context.newPage();
  const errors = [];
  admin.on('pageerror', (e) => errors.push(e.message));
  admin.on('dialog', (d) => d.accept());
  await admin.goto(origin + '/admin/#events');
  await admin.getByRole('button', { name: 'New event', exact: true }).click();
  await admin.locator('[name=title]').fill('Potential social survey');
  await admin.locator('[name=category]').selectOption('Social');
  assert.equal(await admin.locator('[name=requireEduEmail]').isChecked(), true);
  await admin.locator('[name=potential]').check();
  await admin.locator('[name=surveyIntro]').fill('Test survey introduction.');
  for (const [type, label, required, options, other] of [
    ['text', 'Friend name', false, [], false],
    ['single', 'Which day?', true, ['Friday', 'Saturday'], true],
    ['multiple', 'Which games?', true, ['Cards', 'Puzzles'], true],
  ]) {
    await admin.locator('#add-survey-question').click();
    let box = admin.locator('.survey-editor-question').last();
    await box.getByLabel('Question', { exact: true }).fill(label);
    await box.getByLabel('Answer type').selectOption(type);
    box = admin.locator('.survey-editor-question').last();
    await box.getByLabel('Required answer').setChecked(required);
    if (type !== 'text') {
      await box.getByLabel('Answer options').fill(options.join('\n'));
      await box.getByLabel('Allow an Other answer').setChecked(other);
    }
  }
  // Choice order supports keyboard buttons and pointer dragging without losing text.
  const choiceBox = admin.locator('.survey-editor-question').last();
  await choiceBox
    .getByRole('button', { name: 'Move choice 2 up', exact: true })
    .click();
  assert.equal(
    await choiceBox.getByLabel('Answer choice 1', { exact: true }).inputValue(),
    'Puzzles',
  );
  await choiceBox
    .getByRole('button', { name: 'Drag choice 1 to reorder', exact: true })
    .dragTo(choiceBox.locator('.survey-option-row').nth(1));
  assert.equal(
    await choiceBox.getByLabel('Answer choice 1', { exact: true }).inputValue(),
    'Cards',
  );
  let previewSubmits = 0;
  admin.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/forms'))
      previewSubmits++;
  });
  await admin.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = admin.frameLocator('#site-preview-frame');
  await preview.locator('#open-rsvp').click();
  await preview
    .getByLabel('Friend name', { exact: true })
    .fill('Preview answer only');
  await preview.getByLabel('Friday', { exact: true }).check();
  await preview.getByLabel('Cards', { exact: true }).check();
  await preview
    .getByRole('button', { name: 'Preview admin result', exact: true })
    .click();
  await preview.locator('.rsvp-answer-preview[open]').waitFor();
  assert.match(
    await preview.locator('.rsvp-answer-preview').textContent(),
    /Preview answer only/,
  );
  assert.match(
    await preview.locator('.rsvp-answer-preview').textContent(),
    /not been submitted or saved/,
  );
  assert.equal(previewSubmits, 0);
  assert.equal(
    (await db.query('SELECT count(*)::int AS count FROM club_forms.entries'))
      .rows[0].count,
    0,
  );
  await preview
    .getByRole('button', { name: 'Back to preview', exact: true })
    .click();
  await preview.getByLabel('Saturday', { exact: true }).check();
  await preview
    .getByRole('button', { name: 'Preview admin result', exact: true })
    .click();
  assert.match(
    await preview.locator('.rsvp-answer-preview').textContent(),
    /Saturday/,
  );
  await admin
    .getByRole('button', { name: 'Close preview', exact: true })
    .click();
  // Preview locks the form while it runs. Unlocking must not enable the
  // reorder buttons that were already disabled at the ends of the list.
  assert.equal(
    await choiceBox
      .getByRole('button', { name: 'Move choice 1 up', exact: true })
      .isDisabled(),
    true,
  );
  await admin.getByRole('button', { name: 'Save draft', exact: true }).click();
  await admin
    .locator('#event-status')
    .getByText(
      'Draft saved successfully. These saved changes are private until you publish. Editing is complete.',
      { exact: true },
    )
    .waitFor();
  const stored = (await db.query('SELECT * FROM club_forms.events')).rows[0];
  assert.equal(stored.draft.surveyQuestions.length, 3);
  assert.equal((await liveEvents(db, [])).length, 0);
  await admin.reload();
  await admin.locator('.event-choice').click();
  await admin.locator('#edit-selected-event').click();
  assert.equal(await admin.locator('.survey-editor-question').count(), 3);
  await admin
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await admin
    .locator('#event-status')
    .getByText(
      'Published successfully — live on the website. Editing is complete.',
      { exact: true },
    )
    .waitFor();
  const live = (await liveEvents(db, []))[0];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(
    'https://dallasai-leaderboard.vercel.app/api/events*',
    async (route) => {
      const response = await fetch(origin + '/api/events');
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: await response.text(),
      });
    },
  );
  let submissions = 0;
  await page.route(
    'https://dallasai-leaderboard.vercel.app/api/forms',
    async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      submissions++;
      const response = await fetch(origin + '/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: route.request().postData(),
      });
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: await response.text(),
      });
    },
  );
  await page.goto(origin + '/club.html?mode=events&event=' + live.id);
  await page.locator('#potential-events button').waitFor();
  assert.doesNotMatch(
    await page.locator('#potential-events').textContent(),
    /TBD|Explore an idea/,
  );
  assert.equal(await page.locator('#save-event').count(), 0);
  await page.locator('#open-rsvp').click();
  await page.locator('#event-rsvp [name=name]').fill('Browser survey test');
  await page.locator('#event-rsvp [name=email]').fill('someone@gmail.com');
  await page
    .getByLabel('Friend name', { exact: true })
    .fill('<img src=x onerror=alert(1)> Friend');
  await page.getByLabel('Friday', { exact: true }).check();
  await page.getByLabel('Cards', { exact: true }).check();
  await page
    .locator('[data-question="' + live.surveyQuestions[2].id + '"]')
    .getByLabel('Other', { exact: true })
    .check();
  await page
    .locator('[data-question="' + live.surveyQuestions[2].id + '"]')
    .getByLabel('Other answer')
    .fill('Chess');
  await page.locator('#event-rsvp [name=consent]').check();
  await page.locator('#event-rsvp button[type=submit]').click();
  assert.equal(submissions, 0, 'Non-edu email must fail in the browser');
  assert.equal(
    await page
      .locator('#event-rsvp [name=email]')
      .evaluate((el) => el.validity.patternMismatch),
    true,
  );
  await page
    .locator('#event-rsvp [name=email]')
    .fill('Member23@Student.DallasCollege.edu');
  await page.evaluate(async () => {
    await (await import('/content/events.js')).refreshEvents();
  });
  assert.equal(
    await page.getByLabel('Friend name', { exact: true }).inputValue(),
    '<img src=x onerror=alert(1)> Friend',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page
      .locator('.rsvp-dialog')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.screenshot({
    path: path.join(screens, 'survey-rsvp-mobile.png'),
  });
  await page.locator('#event-rsvp button[type=submit]').click();
  await page
    .getByRole('heading', { name: 'RSVP received', exact: true })
    .waitFor();
  assert.equal(submissions, 1);
  assert.match(
    await page.locator('.form-success').textContent(),
    /not confirmed/,
  );
  let response = (await db.query('SELECT * FROM club_forms.survey_responses'))
    .rows[0];
  assert.equal(response.answers.length, 3);
  assert.deepEqual(response.answers[2].value, ['Cards', '__other__']);
  assert.equal(response.answers[2].other, 'Chess');
  const entryId = response.entry_id;
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#open-rsvp').click();
  assert.equal(
    await page.getByLabel('Friend name', { exact: true }).inputValue(),
    '',
  );
  await page.getByRole('button', { name: 'Close RSVP', exact: true }).click();
  await admin.locator('#inbox-tab').click();
  await admin.locator('#refresh').click();
  await admin.locator('#entry-' + entryId + ' > summary').click();
  assert.match(
    await admin.locator('#entries').textContent(),
    /Potential social survey · Date TBD/,
  );
  assert.doesNotMatch(await admin.locator('#entries').textContent(), /Chess/);
  await admin.getByRole('button', { name: 'View survey answers' }).click();
  await admin.locator('#survey-results .survey-response').waitFor();
  assert.match(
    await admin.locator('#survey-results').textContent(),
    /Other: Chess/,
  );
  assert.match(
    await admin.locator('#survey-results').textContent(),
    /member23@student.dallascollege.edu/,
  );
  assert.match(
    await admin.locator('#survey-results').textContent(),
    /Date TBD/,
  );
  assert.equal(await admin.locator('#survey-results img').count(), 0);
  await admin.reload();
  await admin.locator('#survey-results .survey-response').waitFor();
  await admin.screenshot({
    path: path.join(screens, 'survey-results-desktop.png'),
    fullPage: true,
  });
  await admin.setViewportSize({ width: 320, height: 820 });
  assert.equal(
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await admin.screenshot({
    path: path.join(screens, 'survey-results-mobile.png'),
    fullPage: true,
  });
  await admin.locator('#survey-view').selectOption('active');
  await admin.locator('#survey-results .survey-response').waitFor();
  assert.equal(
    await admin
      .locator('#survey-results .survey-response')
      .getAttribute('open'),
    null,
  );
  await admin.locator('#survey-results .survey-response > summary').click();
  // Starring patches the card in place: scroll, open card and focus stay.
  const starButton = admin.getByRole('button', { name: '☆ Star', exact: true });
  await starButton.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const scrolled = await admin.evaluate(() => scrollY);
  assert.ok(scrolled > 0);
  await starButton.click();
  await admin.getByText('Response starred.', { exact: true }).waitFor();
  assert.equal(
    await admin.evaluate(() => document.activeElement.textContent),
    '★ Unstar',
  );
  assert.equal(await admin.evaluate(() => scrollY), scrolled);
  assert.equal(
    await admin
      .locator('#survey-results .survey-response')
      .evaluate((el) => el.open),
    true,
  );
  await admin.locator('#survey-starred').check();
  await admin.locator('#survey-results .survey-response').waitFor();
  await admin.locator('#survey-results .survey-response > summary').click();
  await admin.getByRole('button', { name: 'Archive', exact: true }).click();
  await admin
    .getByText('Response archived. Find it under Archived to restore it.', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await admin.locator('#survey-results .survey-response').count(),
    0,
  );
  await admin.locator('#survey-view').selectOption('archived');
  await admin.locator('#survey-results .survey-response > summary').click();
  await admin.getByRole('button', { name: 'Restore', exact: true }).click();
  await admin
    .getByText('Response restored to Active.', { exact: true })
    .waitFor();
  await admin.locator('#survey-view').selectOption('active');
  await admin.locator('#survey-search').fill('Member23@Student');
  await admin.locator('#survey-results .survey-response').waitFor();
  await admin
    .getByRole('button', { name: 'Compile event summary', exact: true })
    .click();
  await admin
    .getByRole('heading', {
      name: '1 matching response · all pages',
      exact: true,
    })
    .waitFor();
  assert.match(
    await admin.locator('.survey-report').textContent(),
    /Cards — 1 \(100%\)/,
  );
  const reportDialog = admin.getByRole('dialog', {
    name: 'Compiled answers',
    exact: true,
  });
  await reportDialog.waitFor();
  assert.equal(
    await admin.locator('#event-surveys-root .survey-report').count(),
    0,
  );
  for (const [width, height] of [
    [320, 740],
    [768, 1024],
    [1440, 950],
  ]) {
    await admin.setViewportSize({ width, height });
    const bounds = await reportDialog.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= width &&
        bounds.y + bounds.height <= height,
    );
    assert.equal(
      await reportDialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    assert.equal(
      await reportDialog
        .locator('.survey-report')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    await admin.screenshot({
      path: path.join(screens, 'compiled-popup-' + width + '.png'),
    });
  }
  const downloading = admin.waitForEvent('download');
  await reportDialog
    .getByRole('button', { name: 'Export CSV', exact: true })
    .click();
  const download = await downloading;
  const csv = await readFile(await download.path(), 'utf8');
  assert.match(csv, /member23@student.dallascollege.edu/);
  assert.match(csv, /Other: Chess/);
  await reportDialog
    .getByText(
      'CSV downloaded. It includes all matching responses across every page.',
      { exact: true },
    )
    .waitFor();
  await reportDialog
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  assert.equal(await reportDialog.isVisible(), false);
  assert.equal(await admin.locator('.survey-report').textContent(), '');
  assert.match(
    await admin.evaluate(() => document.activeElement.textContent),
    /^Compile (event )?summary$/,
  );
  // Closing while the server is still compiling must not reopen or retain private results.
  let releaseSummary;
  const gate = new Promise((resolve) => (releaseSummary = resolve));
  const matchSummary = (url) =>
    url.pathname === '/api/surveys' && url.searchParams.has('summary');
  await admin.route(matchSummary, async (route) => {
    await gate;
    await route.continue();
  });
  const requested = admin.waitForRequest((request) =>
    new URL(request.url()).searchParams.has('summary'),
  );
  await admin
    .getByRole('button', { name: 'Compile summary', exact: true })
    .click();
  await requested;
  await admin.keyboard.press('Escape');
  const finished = admin.waitForResponse((response) =>
    new URL(response.url()).searchParams.has('summary'),
  );
  releaseSummary();
  await finished;
  await admin.waitForTimeout(100);
  assert.equal(await reportDialog.isVisible(), false);
  assert.equal(await admin.locator('.survey-report').textContent(), '');
  assert.equal(
    await admin.evaluate(() =>
      document.documentElement.classList.contains('survey-report-open'),
    ),
    false,
  );
  await admin.unroute(matchSummary);
  await admin
    .getByRole('button', { name: 'Compile summary', exact: true })
    .click();
  await reportDialog
    .getByRole('heading', {
      name: '1 matching response · all pages',
      exact: true,
    })
    .waitFor();
  await admin.keyboard.press('Escape');
  assert.equal(await admin.locator('.survey-report').textContent(), '');
  await admin.setViewportSize({ width: 320, height: 820 });

  await admin.locator('#survey-results .survey-response > summary').click();
  await admin
    .getByRole('button', { name: 'Contact history', exact: true })
    .click();
  // A person's history opens on the Contacts tab; the address names no one.
  await admin.locator('#contacts-pane').waitFor();
  assert.match(admin.url(), /#\/contacts$/);
  await admin
    .locator('.contact-note-form textarea')
    .fill('Called to confirm the preferred date.');
  await admin.getByRole('button', { name: 'Save note', exact: true }).click();
  await admin.getByText('Follow-up note saved.', { exact: true }).waitFor();
  assert.match(
    await admin.locator('#contacts-pane').textContent(),
    /Called to confirm/,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS count FROM club_forms.contact_notes',
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    await admin
      .locator('#contacts-pane')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await admin.screenshot({
    path: path.join(screens, 'contact-history-mobile.png'),
  });
  // Contacts are managed through the same authenticated interface an officer uses.
  for (const [email, name] of [
    ['e0000001@student.dcccd.edu', 'Full Name Alias'],
    ['untouched@example.edu', 'Unrelated Member'],
  ]) {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO club_forms.entries(id,kind,email,name,dedupe_key,data) VALUES($1::uuid,'question',$2,$3,$1::text,'{"question":"Contact history test"}')`,
      [id, email, name],
    );
  }
  const contacts = admin.locator('#contacts-pane');
  await contacts
    .getByRole('button', { name: 'Merge with another contact', exact: true })
    .click();
  await contacts
    .getByLabel('Find the contact to keep', { exact: true })
    .fill('e0000001');
  await contacts
    .getByRole('button', { name: 'Find merge candidates', exact: true })
    .click();
  await contacts.getByRole('button', { name: /Full Name Alias/ }).click();
  await contacts
    .getByRole('button', { name: 'Confirm merge', exact: true })
    .click();
  await contacts
    .getByText(
      'Contacts merged. Both email addresses now open the same history.',
      { exact: true },
    )
    .waitFor();
  assert.match(
    await contacts.textContent(),
    /member23@student.dallascollege.edu/,
  );
  assert.match(await contacts.textContent(), /e0000001@student.dcccd.edu/);
  for (const [width, height] of [
    [320, 820],
    [768, 1024],
    [1440, 950],
  ]) {
    await admin.setViewportSize({ width, height });
    assert.equal(
      await contacts.evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    await admin.screenshot({
      path: path.join(screens, 'merged-contacts-' + width + '.png'),
    });
  }
  await contacts
    .getByRole('button', { name: 'Delete contact', exact: true })
    .click();
  await contacts
    .getByRole('button', { name: 'Confirm delete contact', exact: true })
    .click();
  await contacts
    .getByText(
      'Contact deleted from the directory. Submissions and notes are preserved.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM club_forms.survey_responses'))
      .rows[0].n,
    1,
  );
  await contacts
    .getByLabel('Show contacts', { exact: true })
    .selectOption('deleted');
  await contacts.getByRole('button', { name: /Full Name Alias/ }).click();
  await contacts
    .getByRole('button', { name: 'Restore contact', exact: true })
    .click();
  await contacts
    .getByText('Contact restored to Active.', { exact: true })
    .waitFor();
  // Mark as test deletes in one step, after a warning with the counts. It is
  // the filled red action; Delete contact can be restored, so it is neutral.
  const markTest = contacts.getByRole('button', {
    name: 'Mark as test',
    exact: true,
  });
  assert.match(await markTest.getAttribute('class'), /\bdanger filled\b/);
  assert.doesNotMatch(
    await contacts
      .getByRole('button', { name: 'Delete contact', exact: true })
      .getAttribute('class'),
    /danger/,
  );
  await markTest.click();
  const warning = contacts.locator('.contact-confirmation');
  await warning
    .getByRole('heading', {
      name: 'Mark as test and delete permanently?',
      exact: true,
    })
    .waitFor();
  assert.match(
    await warning.textContent(),
    /2 submissions, 1 event survey response, 0 officer comments, 0 website notes, 1 follow-up note, 0 attachments and 2 linked email addresses\. This cannot be undone\./,
  );
  const purge = contacts.getByRole('button', {
      name: 'Delete test contact permanently',
      exact: true,
    }),
    confirmEmail = contacts.getByLabel('Type the primary email to confirm', {
      exact: true,
    }),
    description = () =>
      confirmEmail.evaluate(
        (el) =>
          document.getElementById(el.getAttribute('aria-describedby'))
            .textContent,
      );
  assert.equal(await purge.isDisabled(), true);
  assert.equal(
    await description(),
    'Type e0000001@student.dcccd.edu to turn on “Delete test contact permanently”.',
  );
  // Any letter case matches.
  await confirmEmail.fill(' E0000001@Student.DCCCD.edu ');
  assert.equal(await purge.isDisabled(), false);
  assert.equal(await description(), '');
  // Another officer comments after the warning opened: nothing is deleted.
  await db.query(
    `INSERT INTO club_forms.entry_comments(id,entry_id,author_email,body) SELECT gen_random_uuid(),id,'other@example.com','Late comment' FROM club_forms.entries WHERE email='e0000001@student.dcccd.edu'`,
  );
  await purge.click();
  await contacts
    .getByText(
      'This contact changed. Refresh its history and review the action again.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM club_forms.entries')).rows[0]
      .n,
    3,
  );
  await contacts
    .getByLabel('Show contacts', { exact: true })
    .selectOption('active');
  await contacts.getByRole('button', { name: /Full Name Alias/ }).click();
  await markTest.click();
  assert.match(await warning.textContent(), / 1 officer comment, /);
  await confirmEmail.fill('e0000001@student.dcccd.edu');
  await purge.click();
  await contacts
    .getByText('Test contact and all linked records permanently deleted.', {
      exact: true,
    })
    .waitFor();
  await admin.waitForFunction(
    () =>
      !document
        .querySelector('#entries')
        .textContent.includes('Browser survey test'),
  );
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM club_forms.survey_responses'))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM club_forms.contact_notes'))
      .rows[0].n,
    0,
  );
  assert.deepEqual(
    (await db.query('SELECT email FROM club_forms.entries')).rows.map(
      (r) => r.email,
    ),
    ['untouched@example.edu'],
  );
  assert.deepEqual(
    (await db.query('SELECT email FROM club_forms.contacts')).rows.map(
      (r) => r.email,
    ),
    ['untouched@example.edu'],
  );
  assert.doesNotMatch(
    JSON.stringify(
      (await db.query('SELECT actor,action FROM club_forms.audit')).rows,
    ),
    /member23|e0000001|dallascollege|dcccd/,
  );
  await contacts
    .getByLabel('Show contacts', { exact: true })
    .selectOption('active');
  await admin.locator('#surveys-tab').click();
  await admin.locator('#survey-search').fill('no-such-person');
  await admin
    .getByText(
      '0 matching saved responses. Expand a person to read answers or manage their response.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await admin.locator('#survey-results .survey-response').count(),
    0,
  );
  await admin
    .getByRole('button', { name: 'Contacts & follow-up', exact: true })
    .click();
  await admin
    .getByRole('button', { name: 'Search contacts', exact: true })
    .click();
  await admin.locator('.contact-choice').waitFor();
  await admin.locator('#surveys-tab').click();
  const anonymous = await fetch(origin + '/api/surveys');
  assert.equal(anonymous.status, 401);
  await admin.locator('#account-button').click();
  await admin.getByRole('button', { name: 'Sign out', exact: true }).click();
  await admin.locator('#login').waitFor();
  assert.equal(await admin.locator('#survey-results').textContent(), '');
  assert.deepEqual(errors, []);
  console.log(
    'Passed: Social default, configurable edu policy, question builder, private draft and publish, TBD calendar, RSVP popup, browser/server persistence, Other and multiple choices, Inbox basic details, protected Surveys with all answers, reload, XSS, mobile, and sign-out clearing.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
