import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
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
const db = new PGlite();
await db.exec('CREATE SCHEMA club_forms');
for (const file of [
  '003_club_forms.sql',
  '005_screen_confirmations.sql',
  '007_office_tools.sql',
])
  await db.exec(await readFile(new URL('../' + file, import.meta.url), 'utf8'));
await db.exec(
  await readFile(new URL('../006_event_editor.sql', import.meta.url), 'utf8'),
);
await db.exec(
  await readFile(new URL('../008_event_archive.sql', import.meta.url), 'utf8'),
);
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
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(origin + '/admin/#events');
  // Old appearance choices must fall back cleanly to the new design.
  await page.evaluate(() =>
    localStorage.setItem(
      'club-office-appearance',
      JSON.stringify({ theme: 'garden', font: 'serif', layout: 'comfortable' }),
    ),
  );
  await page.reload();
  assert.equal(
    await page.locator('#office-theme, #office-font, #office-layout').count(),
    0,
  );
  assert.ok(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).fontFamily.includes('Geist'),
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
      'That code could not be verified. Check the latest email, or request a new code.',
      { exact: true },
    )
    .waitFor();
  await page.getByLabel('Sign-in code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await page.getByRole('button', { name: 'New event', exact: true }).click();
  assert.deepEqual(
    await page.locator('[name="category"] option').allTextContents(),
    ['Workshop', 'Meeting', 'Talk', 'Hackathon'],
  );
  for (const [key, value] of Object.entries(workshop)) {
    const input = page.locator('#event-form [name="' + key + '"]');
    if (key === 'category') await input.selectOption(value);
    else if (typeof value === 'boolean') await input.setChecked(value);
    else await input.fill(Array.isArray(value) ? value.join('\n') : value);
  }
  await page.getByText('Manage event types', { exact: true }).click();
  await page.locator('#new-type-name').fill('Study group');
  await page.getByRole('button', { name: 'Add type', exact: true }).click();
  await page
    .getByText('Type is available to all admins.', { exact: true })
    .waitFor();
  assert.equal(
    await page.locator('[name="category"]').inputValue(),
    'Study group',
  );
  await page.locator('[name="category"]').selectOption(workshop.category);
  const image = await sharp({
    create: { width: 400, height: 200, channels: 3, background: '#447799' },
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
      'Uploaded. Add a description for each image, then save your draft.',
      { exact: true },
    )
    .waitFor();
  await page
    .getByLabel('Image 1 description', { exact: true })
    .fill('Workshop illustration');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page
    .getByText('Draft saved. The website has not changed.', { exact: true })
    .waitFor();
  let records = (await db.query('SELECT * FROM club_forms.events')).rows;
  assert.equal(records.length, 1);
  const id = records[0].id;
  assert.equal(records[0].draft.date, '');
  assert.equal(records[0].draft.learningOutcomes.length, 10);
  assert.equal(records[0].draft.agenda.length, 10);
  assert.equal(records[0].published, null);
  assert.equal(records[0].draft.images.length, 1);
  assert.ok(
    await page.evaluate(
      async () => (await document.fonts.load('14px Geist')).length > 0,
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
  assert.equal(
    await page.locator('[name="targetAudience"]').inputValue(),
    workshop.targetAudience,
  );
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page.getByText('Choose a valid event date.', { exact: true }).waitFor();
  assert.equal(
    await page.locator('[name="title"]').inputValue(),
    workshop.title,
  );
  await page.locator('[name="date"]').fill('2099-10-02');
  await page.locator('[name="startTime"]').fill('16:00');
  await page.locator('[name="endTime"]').fill('20:00');
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .getByText(
      'Published. The website will show this event on its next refresh.',
      { exact: true },
    )
    .waitFor();
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
  await publicPage.waitForFunction(
    () => document.querySelector('.event-gallery img')?.naturalWidth > 0,
  );
  await publicPage.locator('#event-rsvp [name="name"]').fill('Keep my details');
  await page.locator('[name="title"]').fill('Private draft title');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page
    .getByText('Draft saved. The website has not changed.', { exact: true })
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
  await page
    .locator('[name="title"]')
    .fill('<img src=x onerror=alert(1)> Safe workshop');
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .getByText(
      'Published. The website will show this event on its next refresh.',
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
  assert.equal(await publicPage.locator('#event-detail img').count(), 1);
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
  await page.locator('[name="registrationOpen"]').uncheck();
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .getByText(
      'Published. The website will show this event on its next refresh.',
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
  assert.equal(await publicPage.locator('#event-rsvp').count(), 0);
  await page.locator('[name="title"]').fill(workshop.title);
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .getByText(
      'Published. The website will show this event on its next refresh.',
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
  await page
    .getByRole('button', { name: 'Archive event', exact: true })
    .click();
  await page
    .getByText(
      'Archived. Content, images, and RSVPs are kept. You can edit this event here or restore it as a draft.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.locator('#archived-events').getAttribute('aria-pressed'),
    'true',
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
  assert.equal(
    await page.locator('[name="title"]').inputValue(),
    workshop.title,
  );
  await page.locator('[name="title"]').fill('Saved in the archive');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page
    .getByText('Changes saved. This event is still archived and private.', {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole('button', { name: 'Restore as draft', exact: true })
    .click();
  await page
    .getByText(
      'Restored as a draft. Review your details, then publish when ready.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.locator('#active-events').getAttribute('aria-pressed'),
    'true',
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
  await page.locator('[name="title"]').fill(workshop.title);
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page
    .getByText(
      'Published. The website will show this event on its next refresh.',
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
  await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await page
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
  assert.equal(await publicPage.locator('#event-rsvp').count(), 0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .waitFor();
  assert.equal(await page.locator('#event-list').textContent(), '');
  await page
    .getByLabel('Email address', { exact: true })
    .fill('officer@example.com');
  await page
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .click();
  await page.getByLabel('Sign-in code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.event-choice').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Passed: four event types, fixed Studio design and office-only logo, workshop entry, private image preview, persistence, publish, public refresh, safe rendering, conflict recovery, archived editing, reload, restore as draft, preserved RSVPs/images, republish, unpublish, sign-out, and mobile layouts.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
