import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const backend = fileURLToPath(new URL('../', import.meta.url)),
  site = path.resolve(backend, '../.preview/forms-site'),
  screens = path.resolve(backend, '../.preview/forms-checks');
await mkdir(screens, { recursive: true });
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const root = pathname.startsWith('/admin/')
    ? path.join(backend, 'public')
    : site;
  const target = path.resolve(
    root,
    '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''),
  );
  try {
    if (!target.startsWith(root + path.sep)) throw new Error();
    const data = await readFile(target);
    res.setHeader(
      'Content-Type',
      target.endsWith('.js')
        ? 'text/javascript'
        : target.endsWith('.css')
          ? 'text/css'
          : target.endsWith('.html')
            ? 'text/html'
            : 'application/octet-stream',
    );
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const errors = [],
  received = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(
    'https://dallasai-leaderboard.vercel.app/api/**',
    async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      received.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': origin },
        body: JSON.stringify({
          message:
            'Request received. Check your email for a confirmation link.',
        }),
      });
    },
  );
  const identity = async () => {
    await page.getByLabel('Your name', { exact: true }).fill('Test Student');
    await page
      .getByLabel('Email address', { exact: true })
      .fill('student@example.com');
  };
  await page.goto(origin + '/club.html?mode=join');
  await identity();
  await page
    .locator('#membership-form [name="campus"]')
    .selectOption('Richland');
  await page.getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Join the club', exact: true })
    .click();
  await page
    .getByText('Request received. Check your email for a confirmation link.', {
      exact: true,
    })
    .waitFor();
  assert.equal(received.at(-1).kind, 'join');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screens, 'membership-desktop.png'),
    fullPage: true,
  });
  await page.goto(origin + '/club.html?mode=subscribe');
  await page
    .getByLabel('Email address', { exact: true })
    .fill('reader@example.com');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Subscribe →', exact: true }).click();
  await page.getByRole('button', { name: 'Received', exact: true }).waitFor();
  assert.equal(received.at(-1).kind, 'subscribe');
  await page.goto(origin + '/club.html?mode=events&event=productivity');
  await page.locator('#event-rsvp [name="name"]').fill('Test Student');
  await page.locator('#event-rsvp [name="email"]').fill('student@example.com');
  await page.locator('#event-rsvp [name="consent"]').check();
  await page.locator('#event-rsvp button[type="submit"]').click();
  await page.locator('#event-rsvp .form-success').waitFor();
  assert.equal(received.at(-1).eventId, 'productivity');
  await page.getByRole('button', { name: 'Request a workshop ↗' }).click();
  await page.locator('#workshop-form [name="name"]').fill('Test Student');
  await page
    .locator('#workshop-form [name="email"]')
    .fill('student@example.com');
  await page.getByLabel('Workshop topic', { exact: true }).fill('AI and art');
  await page.locator('#workshop-form [name="consent"]').check();
  await page.getByRole('button', { name: 'Send workshop request' }).click();
  await page.locator('#workshop-form .form-success').waitFor();
  assert.equal(received.at(-1).kind, 'workshop');
  await page.goto(origin + '/club.html?mode=contribute');
  await identity();
  await page.getByLabel('Title', { exact: true }).fill('Test contribution');
  await page.locator('#draft-body').fill('A test draft.');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'draft.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Draft attachment'),
  });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.locator('.form-success').waitFor();
  assert.equal(received.at(-1).files[0].name, 'draft.txt');
  await page.goto(origin + '/club.html?mode=join');
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('heading', { name: 'Join the club', exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screens, 'membership-mobile.png'),
    fullPage: true,
  });
  await page.unroute('https://dallasai-leaderboard.vercel.app/api/**');
  await page.route('https://dallasai-leaderboard.vercel.app/api/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': origin },
      body: JSON.stringify({ error: 'Please try again later.' }),
    }),
  );
  await identity();
  await page
    .locator('#membership-form [name="campus"]')
    .selectOption('Richland');
  await page.getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Join the club', exact: true })
    .click();
  await page.locator('.form-error').waitFor();
  assert.equal(
    await page.getByLabel('Your name', { exact: true }).inputValue(),
    'Test Student',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Join the club', exact: true })
      .isEnabled(),
    true,
  );
  const admin = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  admin.on('pageerror', (error) => errors.push(error.message));
  await admin.route('**/api/auth/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: route.request().url().endsWith('get-session')
        ? 'null'
        : JSON.stringify({
            success: true,
            user: { email: 'officer@example.com', emailVerified: true },
          }),
    }),
  );
  const fixture = {
    user: 'officer@example.com',
    entries: [
      {
        id: 'e68d70fe-7293-47cb-9bbd-a4c7c3b83854',
        kind: 'join',
        name: 'Test Student',
        email: 'student@example.com',
        review_status: 'new',
        state: 'active',
        email_verified: true,
        created_at: '2026-09-20T17:00:00Z',
        data: {
          campus: 'Richland',
          interests: '<img src=x onerror=alert(1)> Learning AI',
        },
        attachments: [],
        pending_emails: 0,
      },
    ],
    counts: [{ kind: 'join', new: 1, total: 1 }],
    queue: { pending: 0, failed: 0 },
    configured: {
      email: true,
      notifications: true,
      newsletter: true,
      uploads: true,
    },
    hasMore: false,
  };
  await admin.route('**/api/admin*', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      fixture.entries[0].review_status = body.status;
      fixture.counts[0].new = 0;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });
  await admin.goto(origin + '/admin/');
  await admin
    .getByLabel('Email address', { exact: true })
    .fill('officer@example.com');
  await admin.getByRole('button', { name: 'Send sign-in code' }).click();
  await admin.getByLabel('Sign-in code', { exact: true }).fill('123456');
  await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
  await admin.getByRole('heading', { name: 'Your club inbox' }).waitFor();
  await admin.locator('#filters [name="kind"]').selectOption('join');
  await admin.getByRole('button', { name: 'Apply', exact: true }).click();
  await admin.getByText('Submission details', { exact: true }).click();
  assert.equal(await admin.locator('.entry img').count(), 0);
  await admin.getByRole('button', { name: 'Mark reviewed' }).click();
  await admin.locator('.badge').filter({ hasText: 'reviewed' }).waitFor();
  await admin.screenshot({
    path: path.join(screens, 'admin-desktop.png'),
    fullPage: true,
  });
  await admin.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await admin.screenshot({
    path: path.join(screens, 'admin-mobile.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'Browser checks passed: five forms, private attachment payload, mobile layouts, recoverable errors, admin sign-in/review, and safe rendering.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
