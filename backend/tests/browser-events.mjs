import { testDatabase } from './helpers/db.mjs';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventHandler } from '../api/events.mjs';
import { RequestError } from '../lib/errors.mjs';
import { submit } from '../lib/submissions.mjs';
import { liveEvents } from '../lib/events.mjs';
import { privateSurveyToken, digest } from '../lib/custom-surveys.mjs';
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
let shortLinkFailure = true,
  shortLinkCalls = 0;
const shortAliases = [];
const events = eventHandler({
  getDatabase: () => db,
  authorize: authorized,
  originals: [],
  createShortLink: async (target, alias) => {
    shortLinkCalls++;
    shortAliases.push(alias);
    if (shortLinkFailure)
      throw new RequestError(503, 'Short link temporarily unavailable.');
    if (alias === 'dai-taken-name')
      throw new RequestError(409, 'That short-link path is already in use.');
    if (alias === 'dai-custom-game') return 'https://go.dallasai.club/' + alias;
    return 'https://go.dallasai.club/test-published-event';
  },
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
  if (url.pathname === '/api/admin') {
    try {
      authorized(req);
    } catch {
      res.statusCode = 401;
      return res.end('{"error":"Sign in"}');
    }
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify({
        user: 'officer@example.com',
        entries: [],
        counts: [],
        configured: { uploads: true },
        hasMore: false,
      }),
    );
  }
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
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1365, height: 950 },
  });
  const page = await context.newPage();
  await context.route(
    'https://go.dallasai.club/test-published-event',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<h1>Synthetic published event target</h1>',
      }),
  );
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(origin + '/admin/#events');
  // Old appearance choices must fall back cleanly to the new design.
  await page.evaluate(() =>
    localStorage.setItem(
      'club-office-appearance',
      JSON.stringify({
        theme: 'garden',
        font: 'serif',
        layout: 'comfortable',
      }),
    ),
  );
  await page.reload();
  assert.equal(
    await page.locator('#office-theme, #office-font, #office-layout').count(),
    0,
  );
  assert.ok(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).fontFamily.includes('DM Sans'),
    ),
  );
  await page
    .getByLabel('Email address', { exact: true })
    .fill('officer@example.com');
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  await page
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .click();
  await page.getByLabel('Sign-in code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByText(
      'That code is wrong or has expired. Use the newest email, or send a new code.',
      { exact: true },
    )
    .waitFor();
  await page.getByLabel('Sign-in code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await page.getByRole('button', { name: 'New event', exact: true }).click();
  assert.deepEqual(
    await page.locator('[name="category"] option').allTextContents(),
    ['Workshop', 'Meeting', 'Talk', 'Hackathon', 'Social'],
  );
  for (const [key, value] of Object.entries(workshop)) {
    const input = page.locator('#event-form [name="' + key + '"]');
    if (key === 'category') await input.selectOption(value);
    else if (typeof value === 'boolean') await input.setChecked(value);
    else await input.fill(Array.isArray(value) ? value.join('\n') : value);
  }
  // Enter in a one-line field must not save; Enter in the type name adds it.
  const eventPosts = [];
  const countPost = (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/events'))
      eventPosts.push(request.postDataJSON().action);
  };
  page.on('request', countPost);
  await page.locator('#event-form [name="title"]').press('Enter');
  await page.locator('#event-form [name="location"]').press('Enter');
  await page.locator('#event-form [name="registrationOpen"]').press('Enter');
  await page.waitForTimeout(300);
  assert.deepEqual(eventPosts, [], 'Enter in a one-line field saved the form');
  await page.getByText('Manage event types', { exact: true }).click();
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.locator('#new-type-name').fill('Study group');
  await page.locator('#new-type-name').press('Enter');
  await page
    .getByText('Type is available to all admins.', { exact: true })
    .waitFor();
  assert.deepEqual(eventPosts, ['add-type']);
  page.off('request', countPost);
  assert.equal(
    await page.locator('[name="category"]').inputValue(),
    'Study group',
  );
  await page.locator('[name="category"]').selectOption(workshop.category);
  const image = await sharp({
    create: {
      width: 400,
      height: 200,
      channels: 3,
      background: '#447799',
    },
  })
    .png()
    .toBuffer();
  await page.locator('#event-image-upload').setInputFiles({
    name: 'workshop.png',
    mimeType: 'image/png',
    buffer: image,
  });
  await page
    .getByText(
      'Uploaded. Save your draft to keep these images. Descriptions are optional.',
      { exact: true },
    )
    .waitFor();
  await page
    .getByLabel('Image 1 description (optional)', { exact: true })
    .fill('Workshop illustration');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page
    .locator('#event-status')
    .getByText(
      'Draft saved successfully. These saved changes are private until you publish. Editing is complete.',
      { exact: true },
    )
    .waitFor();
  let records = (await db.query('SELECT * FROM club_forms.events')).rows;
  assert.equal(records.length, 1);
  const id = records[0].id;
  assert.equal(records[0].draft.date, '');
  assert.equal(records[0].draft.learningOutcomes.length, 10);
  assert.equal(records[0].draft.agenda.length, 10);
  assert.equal(records[0].published, null);
  assert.equal(records[0].draft.images.length, 1);
  assert.match(
    await page.locator('#event-updated').textContent(),
    /Last updated by You · /,
  );
  assert.equal(
    await page.locator('#event-updated time').getAttribute('datetime'),
    new Date(records[0].updated_at).toISOString(),
  );
  await page.getByText('Activity history', { exact: true }).click();
  await page.locator('#event-activity-list li').waitFor();
  assert.equal(
    await page.locator('#event-activity-list strong').first().textContent(),
    'Draft saved',
  );
  assert.equal(
    await page
      .locator('#event-activity-list .activity-actor')
      .first()
      .textContent(),
    'By You',
  );
  assert.match(
    await page.locator('#event-activity-list time').first().textContent(),
    / CT$/,
  );
  assert.ok(
    await page.evaluate(
      async () => (await document.fonts.load('14px "DM Sans"')).length > 0,
    ),
  );
  await page.waitForFunction(
    () => document.querySelector('.office-logo')?.naturalWidth > 0,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(screens, 'events-studio.png') });
  await page.setViewportSize({ width: 320, height: 820 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1365, height: 950 });
  assert.ok(
    (await page.locator('.event-list-group').first().textContent()).includes(
      'Drafts',
    ),
  );
  assert.equal(
    (await (await fetch(origin + '/api/events')).json()).events.length,
    0,
  );
  await page.setViewportSize({ width: 1440, height: 1250 });
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page
    .frameLocator('#site-preview-frame')
    .locator('#event-detail h2')
    .filter({ hasText: workshop.title })
    .waitFor();
  assert.equal(
    await page
      .frameLocator('#site-preview-frame')
      .locator('#event-rsvp')
      .count(),
    0,
  );
  const preview = page.frameLocator('#site-preview-frame');
  assert.ok(await preview.locator('.event-calendar').isVisible());
  assert.match(
    await preview.locator('#calendar-agenda').textContent(),
    /no date yet/,
  );
  assert.doesNotMatch(
    await preview.locator('#calendar-month').textContent(),
    /undefined|NaN/,
  );
  await preview
    .locator('.events-layout')
    .evaluate((el) =>
      el.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  await preview.locator('.events-layout').evaluate(async (el) => {
    await Promise.all(
      el.ownerDocument
        .getAnimations()
        .filter((a) => a.effect.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  const calendarBefore = await preview.locator('.event-calendar').boundingBox();
  const panelBefore = await preview.locator('#event-detail').boundingBox();
  assert.ok(panelBefore.x > calendarBefore.x + calendarBefore.width - 2);
  await preview
    .locator('#event-detail')
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  const calendarAfter = await preview.locator('.event-calendar').boundingBox();
  assert.deepEqual(calendarAfter, calendarBefore);
  const gallery = preview.locator('.event-gallery');
  assert.equal(
    await gallery.evaluate((el) => el === el.parentElement.lastElementChild),
    true,
  );
  const previewImage = await gallery.locator('img').boundingBox();
  assert.ok(
    previewImage.width >= panelBefore.width * 0.45 &&
      previewImage.width <= panelBefore.width,
  );
  await page.locator('#site-preview-dialog').screenshot({
    path: path.join(screens, 'preview-calendar-and-image.png'),
  });
  await page.getByRole('button', { name: 'Mobile', exact: true }).click();
  await page
    .frameLocator('#site-preview-frame')
    .locator('#event-detail h2')
    .filter({ hasText: workshop.title })
    .waitFor();
  await page.locator('#site-preview-dialog').screenshot({
    path: path.join(screens, 'workshop-preview.png'),
  });
  await page
    .getByRole('button', { name: 'Close preview', exact: true })
    .click();
  await page.reload();
  assert.equal(
    await page.locator('#office-theme, #office-font, #office-layout').count(),
    0,
  );
  await page
    .getByRole('button', {
      name: new RegExp(workshop.title.replace(/[+]/g, '\\+')),
    })
    .click();
  await page.locator('#edit-selected-event').click();
  assert.equal(
    await page.locator('[name="targetAudience"]').inputValue(),
    workshop.targetAudience,
  );
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page.getByText('Choose a valid event date.', { exact: true }).waitFor();
  assert.equal(
    await page.locator('[name="title"]').inputValue(),
    workshop.title,
  );
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.locator('[name="date"]').fill('2099-10-02');
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.locator('[name="startTime"]').fill('16:00');
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.locator('[name="endTime"]').fill('20:00');
  assert.equal(await page.locator('[name="checkSharing"]').isChecked(), true);
  const tabsBeforePublish = context.pages().length;
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .locator('#event-status')
    .getByText(
      'Published successfully — live on the website. Editing is complete.',
      { exact: true },
    )
    .waitFor();
  await page
    .getByText(
      'Short link could not be created. Use Create short link to try again.',
      { exact: true },
    )
    .waitFor();
  assert.equal((await liveEvents(db, []))[0].id, id);
  await expect.poll(() => context.pages().length).toBe(tabsBeforePublish);
  shortLinkFailure = false;
  await page
    .getByRole('button', { name: 'Create short link', exact: true })
    .click();
  await page
    .getByText('Short link and QR opened in separate tabs for checking.', {
      exact: true,
    })
    .waitFor();
  await expect.poll(() => context.pages().length).toBe(tabsBeforePublish + 2);
  const checks = context.pages().filter((p) => p !== page);
  await expect
    .poll(() =>
      checks.some(
        (p) => p.url() === 'https://go.dallasai.club/test-published-event',
      ),
    )
    .toBe(true);
  await expect
    .poll(() => checks.some((p) => p.url() === origin + '/api/events?qr=' + id))
    .toBe(true);
  for (const check of checks) {
    assert.equal(await check.evaluate(() => window.opener), null);
    if (check.url().includes('?qr='))
      await expect(check.locator('svg')).toBeVisible();
    else
      await expect(
        check.getByRole('heading', {
          name: 'Synthetic published event target',
        }),
      ).toBeVisible();
    await check.close();
  }
  assert.equal(shortLinkCalls, 2);
  await expect(
    page.getByRole('link', { name: 'View published event ↗' }),
  ).toHaveAttribute('href', 'https://go.dallasai.club/test-published-event');
  const publicPage = await context.newPage();
  publicPage.on('pageerror', (e) => errors.push(e.message));
  await publicPage.route(
    'https://dallasai-leaderboard.vercel.app/api/events*',
    async (route) => {
      const result = await fetch(
        origin + '/api/events' + new URL(route.request().url()).search,
      );
      if (new URL(route.request().url()).searchParams.has('image'))
        return route.fulfill({
          status: result.status,
          contentType: 'image/webp',
          body: Buffer.from(await result.arrayBuffer()),
        });
      if (new URL(route.request().url()).searchParams.has('qr'))
        return route.fulfill({
          status: result.status,
          contentType: 'image/svg+xml',
          body: await result.text(),
        });
      return route.fulfill({
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: await result.text(),
      });
    },
  );
  await publicPage.goto(origin + '/club.html?mode=events&event=' + id);
  await publicPage
    .locator('#event-detail h2')
    .filter({ hasText: workshop.title })
    .waitFor();
  await publicPage
    .getByText(workshop.learningOutcomes[9], { exact: true })
    .waitFor();
  assert.ok(await publicPage.locator('.event-calendar').isVisible());
  assert.equal(
    await publicPage
      .locator('.event-gallery')
      .evaluate((el) => el === el.parentElement.lastElementChild),
    true,
  );
  await publicPage.locator('.event-gallery img').scrollIntoViewIfNeeded();
  await publicPage.waitForFunction(
    () => document.querySelector('.event-gallery img')?.naturalWidth > 0,
  );
  await publicPage.locator('#open-rsvp').click();
  await publicPage.locator('#event-rsvp [name="name"]').fill('Keep my details');
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.locator('[name="title"]').fill('Private draft title');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page
    .locator('#event-status')
    .getByText(
      'Draft saved successfully. These saved changes are private until you publish. Editing is complete.',
      { exact: true },
    )
    .waitFor();
  await publicPage.evaluate(async () => {
    const events = await import('/content/events.js');
    await events.refreshEvents();
  });
  assert.equal(
    await publicPage.locator('#event-detail h2').textContent(),
    workshop.title,
  );
  assert.equal(
    await publicPage.locator('#event-rsvp [name="name"]').inputValue(),
    'Keep my details',
  );
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page
    .locator('[name="title"]')
    .fill('<img src=x onerror=alert(1)> Safe workshop');
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .locator('#event-status')
    .getByText(
      'Published successfully — live on the website. Editing is complete.',
      { exact: true },
    )
    .waitFor();
  await publicPage.evaluate(async () => {
    const events = await import('/content/events.js');
    await events.refreshEvents();
  });
  await publicPage
    .locator('#event-detail h2')
    .filter({ hasText: 'Safe workshop' })
    .waitFor();
  // The uploaded event image and its QR are the only images; HTML in a title
  // must remain text, never create another image or event handler.
  assert.equal(await publicPage.locator('#event-detail img').count(), 2);
  assert.equal(
    await publicPage.locator('#event-detail img[onerror]').count(),
    0,
  );
  assert.equal(
    await publicPage.locator('#event-rsvp [name="name"]').inputValue(),
    'Keep my details',
  );
  // Concurrent server edit: a stale editor must preserve its unsaved form.
  await db.query(
    'UPDATE club_forms.events SET revision=revision+1 WHERE id=$1',
    [id],
  );
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.locator('[name="title"]').fill('Keep this unsaved edit');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText(/Another admin updated this event/).waitFor();
  assert.equal(
    await page.locator('[name="title"]').inputValue(),
    'Keep this unsaved edit',
  );
  await page.getByRole('button', { name: 'Refresh list', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('#event-form [name="title"]')
      .value.includes('Safe workshop'),
  );
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.locator('[name="registrationOpen"]').uncheck();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page
    .frameLocator('#site-preview-frame')
    .locator('#event-detail h2')
    .waitFor();
  assert.equal(
    await page
      .frameLocator('#site-preview-frame')
      .locator('.event-sharing, #open-rsvp')
      .count(),
    0,
  );
  await page
    .getByRole('button', { name: 'Close preview', exact: true })
    .click();
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .locator('#event-status')
    .getByText(
      'Published successfully — live on the website. Editing is complete.',
      { exact: true },
    )
    .waitFor();
  await publicPage.evaluate(async () => {
    const events = await import('/content/events.js');
    await events.refreshEvents();
  });
  await publicPage
    .getByText('RSVPs are closed for this event.', { exact: true })
    .waitFor();
  assert.equal(await publicPage.locator('#event-rsvp:visible').count(), 0);
  assert.equal(
    await publicPage
      .locator('#event-detail .event-sharing, #open-rsvp')
      .count(),
    0,
  );
  // A linked, open public feedback survey replaces RSVP only after the event.
  process.env.FORM_TOKEN_SECRET = 'event-feedback-browser-' + 'x'.repeat(40);
  const feedbackId = crypto.randomUUID();
  const feedbackUrl = 'https://tinyurl.com/test-event-feedback';
  await db.query(
    `INSERT INTO club_forms.custom_surveys
      (id,slug,title,content_version,status,link_digest,expires_at,published_at,definition,short_link)
      VALUES($1,$2,'Event feedback','custom-form/1','open',$3,now()+interval '1 day',now(),$4,$5)`,
    [
      feedbackId,
      'feedback-' + feedbackId,
      digest(privateSurveyToken(feedbackId)),
      JSON.stringify({
        eventId: id,
        template: 'feedback',
        audience: 'public',
        permissions: { preview: 'link', answer: 'verified', results: 'admins' },
      }),
      feedbackUrl,
    ],
  );
  const refreshPublicEvents = () =>
    publicPage.evaluate(async () => {
      await (await import('/content/events.js')).refreshEvents();
    });
  await refreshPublicEvents();
  assert.equal(
    await publicPage
      .getByRole('link', { name: 'Event feedback', exact: true })
      .count(),
    0,
  );
  const upcoming = (await liveEvents(db, []))[0];
  for (const unsafeUrl of [
    'http://example.test/feedback',
    'https://owner@example.test/feedback',
    'https://:password@example.test/feedback',
  ]) {
    const malformed = (route) =>
      route.fulfill({
        json: { events: [{ ...upcoming, feedbackUrl: unsafeUrl }] },
      });
    await publicPage.route(
      'https://dallasai-leaderboard.vercel.app/api/events',
      malformed,
    );
    await refreshPublicEvents();
    assert.equal(
      await publicPage.evaluate(
        async () => (await import('/content/events.js')).eventsFresh,
      ),
      false,
    );
    await publicPage.unroute(
      'https://dallasai-leaderboard.vercel.app/api/events',
      malformed,
    );
  }
  await refreshPublicEvents();
  await db.query('UPDATE club_forms.events SET published=$2 WHERE id=$1', [
    id,
    JSON.stringify({
      ...upcoming,
      date: '2000-10-02T16:00:00-05:00',
      end: '2000-10-02T20:00:00-05:00',
    }),
  ]);
  await refreshPublicEvents();
  const feedbackAction = publicPage
    .locator('.event-registration')
    .getByRole('link', { name: 'Event feedback', exact: true });
  await expect(feedbackAction).toHaveAttribute('href', feedbackUrl);
  assert.equal(
    await publicPage.locator('#open-rsvp, #event-rsvp-action').count(),
    0,
  );
  await publicPage.route(feedbackUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Linked event feedback</h1>',
    }),
  );
  await feedbackAction.click();
  await expect(
    publicPage.getByRole('heading', { name: 'Linked event feedback' }),
  ).toBeVisible();
  await publicPage.goto(origin + '/club.html?mode=events&event=' + id);
  await publicPage.locator('#event-feedback-action').waitFor();
  await db.query(
    "UPDATE club_forms.custom_surveys SET status='closed' WHERE id=$1",
    [feedbackId],
  );
  await refreshPublicEvents();
  assert.equal(
    await publicPage
      .getByRole('link', { name: 'Event feedback', exact: true })
      .count(),
    0,
  );
  await db.query('UPDATE club_forms.events SET published=$2 WHERE id=$1', [
    id,
    JSON.stringify(upcoming),
  ]);
  await refreshPublicEvents();
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.locator('[name="title"]').fill(workshop.title);
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .locator('#event-status')
    .getByText(
      'Published successfully — live on the website. Editing is complete.',
      { exact: true },
    )
    .waitFor();
  // Save an actual RSVP in the isolated database, then exercise the full archive cycle.
  const registration = await submit(
    db,
    {
      kind: 'rsvp',
      name: 'Test student',
      email: 'student@example.com',
      consent: true,
      requestId: crypto.randomUUID(),
      eventId: id,
    },
    [{ ...(await liveEvents(db, []))[0], registrationOpen: true }],
  );
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page
    .getByRole('button', { name: 'Archive event', exact: true })
    .click();
  await page
    .locator('#confirm-dialog')
    .getByRole('button', { name: 'Archive event', exact: true })
    .click();
  await page
    .locator('#event-status')
    .getByText(
      'Archived. Content, images, and RSVPs are kept. You can edit this event here or restore it as a draft.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.locator('#archived-events').getAttribute('aria-pressed'),
    'true',
  );
  if (!(await page.locator('#event-activity').evaluate((el) => el.open)))
    await page.getByText('Activity history', { exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('#event-activity-list strong')?.textContent ===
      'Archived',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Publish event', exact: true })
      .isVisible(),
    false,
  );
  assert.equal(
    (await (await fetch(origin + '/api/events')).json()).events.length,
    0,
  );
  const imageId = records[0].draft.images[0].id;
  assert.equal(
    (await fetch(origin + '/api/events?image=' + imageId)).status,
    401,
  );
  await page.reload();
  await page.locator('#archived-events').click();
  await page.locator('.event-choice').click();
  await page.locator('#edit-selected-event').click();
  assert.equal(
    await page.locator('[name="title"]').inputValue(),
    workshop.title,
  );
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.locator('[name="title"]').fill('Saved in the archive');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page
    .locator('#event-status')
    .getByText('Changes saved. This event is still archived and private.', {
      exact: true,
    })
    .waitFor();
  await page.getByText('Activity history', { exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('#event-activity-list strong')?.textContent ===
      'Draft saved',
  );
  assert.ok(
    (
      await page.locator('#event-activity-list strong').allTextContents()
    ).includes('Archived'),
  );
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page
    .getByRole('button', { name: 'Restore as draft', exact: true })
    .click();
  await page
    .locator('#event-status')
    .getByText(
      'Restored as a draft. Review your details, then publish when ready.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.locator('#active-events').getAttribute('aria-pressed'),
    'true',
  );
  await page.waitForFunction(
    () =>
      document.querySelector('#event-activity-list strong')?.textContent ===
      'Restored as draft',
  );
  assert.equal(
    await page.locator('[name="title"]').inputValue(),
    'Saved in the archive',
  );
  assert.equal(
    (await (await fetch(origin + '/api/events')).json()).events.length,
    0,
  );
  assert.equal(
    (
      await db.query('SELECT id FROM club_forms.entries WHERE id=$1', [
        registration.id,
      ])
    ).rows[0].id,
    registration.id,
  );
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page.locator('[name="title"]').fill(workshop.title);
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .locator('#event-status')
    .getByText(
      'Published successfully — live on the website. Editing is complete.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (await fetch(origin + '/api/events?image=' + imageId)).status,
    200,
  );
  await page.setViewportSize({ width: 320, height: 820 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'Admin page overflows narrow screen',
  );
  await page.screenshot({
    path: path.join(screens, 'editor-mobile.png'),
    fullPage: true,
  });
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.reload();
  await publicPage
    .locator('#event-detail h2')
    .filter({ hasText: workshop.title })
    .waitFor();
  await publicPage.waitForTimeout(350);
  assert.ok(
    await publicPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'Calendar overflows narrow screen',
  );
  await publicPage.screenshot({
    path: path.join(screens, 'calendar-mobile.png'),
    fullPage: true,
  });
  if (!(await page.locator('#event-form').isVisible()))
    await page.locator('#edit-selected-event').click();
  // Public changes ask in the shared dialog; Escape cancels and returns
  // focus to the button.
  const unpublish = page.getByRole('button', {
    name: 'Unpublish',
    exact: true,
  });
  await unpublish.click();
  const confirmation = page.locator('#confirm-dialog');
  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.getByRole('button', { name: 'Unpublish event', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(unpublish).toBeFocused();
  assert.equal(
    (await (await fetch(origin + '/api/events')).json()).events.length,
    1,
  );
  await unpublish.click();
  await confirmation
    .getByRole('button', { name: 'Unpublish event', exact: true })
    .click();
  await page
    .locator('#event-status')
    .getByText('Unpublished. Your draft and existing RSVPs are kept.', {
      exact: true,
    })
    .waitFor();
  await publicPage.evaluate(async () => {
    const events = await import('/content/events.js');
    await events.refreshEvents();
  });
  assert.equal(
    (await (await fetch(origin + '/api/events')).json()).events.length,
    0,
  );
  assert.equal(await publicPage.locator('#event-rsvp:visible').count(), 0);
  await page.locator('#account-button').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .waitFor();
  assert.equal(await page.locator('#event-list').textContent(), '');
  assert.equal(await page.locator('#event-activity-list').textContent(), '');
  assert.equal(await page.locator('#event-updated').textContent(), '');
  await page
    .getByLabel('Email address', { exact: true })
    .fill('officer@example.com');
  await page
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .click();
  await page.getByLabel('Sign-in code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.event-choice').waitFor();
  assert.equal(
    shortLinkCalls,
    2,
    'Editing and republishing reuse the saved link',
  );
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await page.locator('[name="title"]').fill('Blocked popup check');
  await page.locator('[name="potential"]').check();
  await page.evaluate(() => {
    window.open = () => null;
  });
  const tabsBeforeBlockedCheck = context.pages().length;
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .getByText(
      'Your browser blocked a check tab. Use View published event and Open event QR to open the checks.',
      { exact: true },
    )
    .waitFor();
  assert.equal(context.pages().length, tabsBeforeBlockedCheck);
  await expect(
    page.getByRole('link', { name: 'View published event ↗' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open event QR ↗' }),
  ).toBeVisible();
  await page
    .getByLabel('Custom short-link name (optional)')
    .fill('dai-custom-game');
  await page
    .getByRole('button', { name: 'Save short link', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'View published event ↗' }),
  ).toHaveAttribute('href', 'https://go.dallasai.club/dai-custom-game');
  await page
    .getByLabel('Custom short-link name (optional)')
    .fill('dai-taken-name');
  await page
    .getByRole('button', { name: 'Save short link', exact: true })
    .click();
  await page
    .getByText('That short-link path is already in use.', { exact: true })
    .waitFor();
  await expect(
    page.getByRole('link', { name: 'View published event ↗' }),
  ).toHaveAttribute('href', 'https://go.dallasai.club/dai-custom-game');
  await page.getByLabel('Custom short-link name (optional)').fill('');
  await page
    .getByRole('button', { name: 'Save short link', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'View published event ↗' }),
  ).toHaveAttribute('href', 'https://go.dallasai.club/test-published-event');
  assert.equal(shortAliases.at(-1), 'dai-blocked-popup-check');
  assert.deepEqual(errors, []);
  console.log(
    'Passed: four event types, fixed Studio design and office-only logo, workshop entry, private image preview, persistence, publish, public refresh, safe rendering, conflict recovery, archived editing, reload, restore as draft, preserved RSVPs/images, republish, unpublish, sign-out, and mobile layouts.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
