import { saveEvent } from '../lib/events.mjs';
import { adminHandler } from '../api/admin.mjs';
import { surveysHandler } from '../api/surveys.mjs';
import { formsHandler } from '../api/forms.mjs';
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
  '009_submission_comments.sql',
  '010_event_surveys.sql',
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
  await saveEvent(
    db,
    {
      action: 'publish',
      id: 'layout-workshop',
      revision: 0,
      event: {
        ...workshop,
        date: '2099-10-02',
        startTime: '16:00',
        endTime: '20:00',
        summary:
          'We plan carefully.\n\n## What to expect\nA practical session with **bold ideas** and *hands-on work*.\n\n- Bring questions\n- Try something new\n\n1. Work together\n2. Share your findings',
      },
    },
    'officer@example.com',
    [],
  );
  await saveEvent(
    db,
    {
      action: 'publish',
      id: 'layout-social',
      revision: 0,
      event: {
        title: 'Potential game night',
        category: 'Social',
        potential: true,
        summary: 'A relaxed evening of games.',
        agenda: [],
        preparation: [],
      },
    },
    'officer@example.com',
    [],
  );
  const poster = await sharp({
    create: {
      width: 800,
      height: 1100,
      channels: 3,
      background: '#527b62',
    },
  })
    .webp()
    .toBuffer();
  const upload = await fetch(origin + '/api/events?upload=1', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      cookie: 'test-officer=signed-in',
    },
    body: JSON.stringify({ content: poster.toString('base64') }),
  });
  assert.equal(upload.status, 200);
  const uploaded = (await upload.json()).image;
  const row = (
    await db.query("SELECT * FROM club_forms.events WHERE id='layout-workshop'")
  ).rows[0];
  await saveEvent(
    db,
    {
      action: 'publish',
      id: row.id,
      revision: row.revision,
      event: { ...row.draft, images: [{ id: uploaded.id, alt: '' }] },
    },
    'officer@example.com',
    [],
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  await context.addCookies([
    { name: 'test-officer', value: 'signed-in', url: origin },
  ]);
  const admin = await context.newPage(),
    errors = [];
  admin.on('pageerror', (e) => errors.push(e.message));
  admin.on('dialog', (d) => d.accept());
  let writes = 0;
  admin.on('request', (r) => {
    if (r.url() === origin + '/api/events' && r.method() === 'POST') writes++;
  });
  await admin.goto(origin + '/admin/#events');
  await admin
    .locator('.event-choice')
    .filter({ hasText: workshop.title })
    .click();
  assert.equal(await admin.locator('#event-form').isVisible(), false);
  await admin.locator('#event-overview').waitFor();
  assert.equal(writes, 0);
  assert.equal(
    await admin
      .locator('#event-overview input,#event-overview textarea')
      .count(),
    0,
  );
  assert.match(
    await admin.locator('#event-overview').textContent(),
    /READ-ONLY/,
  );
  await admin.emulateMedia({ colorScheme: 'dark' });
  await admin.screenshot({
    path: path.join(screens, 'event-read-only-desktop.png'),
    fullPage: true,
  });
  await admin.emulateMedia({ colorScheme: 'light' });
  await admin.locator('#edit-selected-event').click();
  await admin.locator('[name=title]').fill('Accidental unsaved edit');
  await admin.locator('#cancel-event-edit').click();
  assert.equal(await admin.locator('#event-form').isVisible(), false);
  assert.match(
    await admin.locator('#event-overview > h3').textContent(),
    new RegExp('AI'),
  );
  assert.equal(
    (
      await db.query(
        "SELECT draft->>'title' AS title FROM club_forms.events WHERE id='layout-workshop'",
      )
    ).rows[0].title,
    workshop.title,
  );
  assert.equal(writes, 0);
  await admin.locator('#edit-selected-event').click();
  const originalDescription = await admin
    .locator('[name=summary]')
    .inputValue();
  await admin.locator('[name=summary]').fill('Heading\nfirst\nsecond');
  await admin
    .locator('[name=summary]')
    .evaluate((el) => el.setSelectionRange(0, 7));
  await admin
    .getByRole('button', { name: 'Heading in Description', exact: true })
    .click();
  assert.equal(
    await admin.locator('[name=summary]').inputValue(),
    '## Heading\nfirst\nsecond',
  );
  await admin
    .locator('[name=summary]')
    .evaluate((el) => el.setSelectionRange(11, el.value.length));
  await admin
    .getByRole('button', { name: 'Bullets in Description', exact: true })
    .click();
  assert.equal(
    await admin.locator('[name=summary]').inputValue(),
    '## Heading\n- first\n- second',
  );
  await admin
    .getByRole('button', {
      name: 'Numbered list in Description',
      exact: true,
    })
    .click();
  assert.equal(
    await admin.locator('[name=summary]').inputValue(),
    '## Heading\n1. first\n2. second',
  );
  await admin
    .locator('[name=summary]')
    .evaluate((el) => el.setSelectionRange(14, 19));
  await admin
    .getByRole('button', { name: 'Italic in Description', exact: true })
    .click();
  assert.match(await admin.locator('[name=summary]').inputValue(), /\*first\*/);
  await admin.locator('[name=summary]').fill(originalDescription);
  await admin.locator('[name=summary]').evaluate((el) => {
    el.focus();
    el.setSelectionRange(3, 17);
  });
  await admin
    .getByRole('button', { name: 'Bold in Description', exact: true })
    .click();
  assert.match(
    await admin.locator('[name=summary]').inputValue(),
    /\*\*plan carefully\*\*/,
  );
  await admin
    .locator('[name=agenda]')
    .fill(
      '20 minutes · 1. Welcome · Meet the team\n30 minutes · 2. Try AI · Build a small project\n10 minutes · Wrap-up · Share what you learned',
    );
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
  assert.equal(writes, 1);
  assert.equal(await admin.locator('#event-form').isVisible(), false);
  await admin.locator('#edit-selected-event').click();
  await admin.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = admin.frameLocator('#site-preview-frame');
  await preview
    .locator('#event-detail .event-description strong')
    .first()
    .waitFor();
  assert.equal(
    await preview.locator('.event-description strong').first().textContent(),
    'plan carefully',
  );
  await admin
    .getByRole('button', { name: 'Close preview', exact: true })
    .click();
  await admin.reload();
  await admin
    .locator('.event-choice')
    .filter({ hasText: workshop.title })
    .click();
  assert.equal(await admin.locator('#event-form').isVisible(), false);
  assert.equal(
    await admin
      .locator('#event-overview strong')
      .filter({ hasText: 'plan carefully' })
      .count(),
    1,
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(
    'https://dallasai-leaderboard.vercel.app/api/events*',
    async (route) => {
      const response = await fetch(
        origin + '/api/events' + new URL(route.request().url()).search,
      );
      if (new URL(route.request().url()).searchParams.has('image'))
        return route.fulfill({
          status: response.status,
          contentType: 'image/webp',
          body: Buffer.from(await response.arrayBuffer()),
        });
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: await response.text(),
      });
    },
  );
  await page.goto(origin + '/club.html?mode=events&event=layout-workshop');
  await page
    .locator('#event-detail .event-description strong')
    .first()
    .waitFor();
  assert.equal(
    await page.locator('.event-description strong').first().textContent(),
    'plan carefully',
  );
  assert.equal(
    await page
      .locator('.event-agenda-list .agenda-duration')
      .first()
      .textContent(),
    '20 minutes',
  );
  for (const [width, height] of [
    [1440, 1100],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [320, 740],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      'Public overflow at ' + width,
    );
    const potential = await page.locator('#potential-events').boundingBox(),
      calendar = await page.locator('.event-calendar').boundingBox();
    assert.ok(
      potential.y + potential.height <= calendar.y,
      'Potential events above calendar',
    );
    assert.equal(
      await page
        .locator('#event-detail')
        .evaluate((el) => getComputedStyle(el).overflowY),
      'visible',
    );
    assert.equal(
      await page
        .locator('#event-detail')
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
      true,
      'No inner event scrollbar',
    );
    const rsvp = await page.locator('#open-rsvp').boundingBox(),
      description = await page.locator('.event-description').boundingBox();
    assert.ok(rsvp.y < description.y, 'RSVP before long write-up');
    await page
      .locator('#event-detail')
      .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(150);
    const before = await page.evaluate(() => scrollY),
      box = await page.locator('#event-detail').boundingBox();
    await page.mouse.move(
      Math.min(width - 20, box.x + box.width / 2),
      Math.min(height - 30, Math.max(100, box.y + 150)),
    );
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(180);
    assert.ok(
      (await page.evaluate(() => scrollY)) > before,
      'Mouse wheel over event scrolls page at ' + width,
    );
    if ([1440, 390, 320].includes(width))
      await page.screenshot({
        path: path.join(screens, 'event-layout-' + width + '.png'),
        fullPage: true,
      });
    const gallery = page.locator('.event-gallery img');
    await gallery.scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => document.querySelector('.event-gallery img')?.naturalWidth > 0,
    );
    const imageBox = await gallery.boundingBox(),
      detailBox = await page.locator('#event-detail').boundingBox();
    assert.ok(
      imageBox.width >= detailBox.width * (width <= 600 ? 0.9 : 0.45),
      'Poster uses a substantial share of the details width',
    );
    await page.locator('.event-image-open').click();
    await page.locator('.event-image-viewer[open]').waitFor();
    assert.equal(
      await page
        .locator('.event-image-viewer')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    const enlarged = await page
      .locator('.event-image-viewer img')
      .boundingBox();
    assert.ok(
      enlarged.x >= 0 &&
        enlarged.y >= 0 &&
        enlarged.x + enlarged.width <= width + 1 &&
        enlarged.y + enlarged.height <= height + 1,
    );
    await page.keyboard.press('Escape');
    assert.equal(
      await page.locator('.event-image-viewer').getAttribute('open'),
      null,
    );
    assert.equal(await page.locator('#event-going').count(), 0);
    assert.equal(await page.locator('#event-rsvp-action').count(), 1);
    await page.locator('.footer-signature').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const footerWidths = await page
      .locator('.footer-signature')
      .evaluate((el) => {
        const word = el
          .querySelector('.coladde-wordmark')
          .getBoundingClientRect();
        const p = el.querySelector('p').getBoundingClientRect();
        return {
          word: word.width,
          tag: p.width,
          center: Math.abs(word.x + word.width / 2 - p.x - p.width / 2),
        };
      });
    assert.ok(
      footerWidths.tag / footerWidths.word < 1.15 &&
        footerWidths.tag / footerWidths.word > 0.9,
      'Tagline matches wordmark width',
    );
    assert.ok(footerWidths.center < 2, 'Wordmark and tagline are centered');
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: path.join(screens, 'event-polish-' + width + '.png'),
        fullPage: true,
      });
    await admin.setViewportSize({ width, height });
    assert.equal(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      'Office read-only overflow at ' + width,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#potential-events button').click();
  await page
    .locator('#event-detail h2')
    .filter({ hasText: 'Potential game night' })
    .waitFor();
  assert.ok(
    (await page.locator('#event-detail').boundingBox()).y < 150,
    'Mobile selection moves to details',
  );
  await admin.locator('#edit-selected-event').click();
  await admin.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    'Formatting controls fit narrow screen',
  );
  await admin.locator('[name=summary]').scrollIntoViewIfNeeded();
  await admin.screenshot({
    path: path.join(screens, 'formatting-editor-mobile.png'),
  });
  await admin.locator('#cancel-event-edit').click();
  await admin.getByRole('button', { name: 'Sign out', exact: true }).click();
  await admin.locator('#login').waitFor();
  assert.equal(await admin.locator('#event-overview').textContent(), '');
  assert.deepEqual(errors, []);
  console.log(
    'Passed: read-only selection, explicit Edit, cancel without writes, formatting publish/persistence/private preview, natural wheel scrolling over long details, compact prominent potential events, timed agenda, early RSVP, six viewport sizes including phone landscape, and private view clearing.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
