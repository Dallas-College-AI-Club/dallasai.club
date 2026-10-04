import { confirmations } from '../api/forms.mjs';
import { chromium, expect } from '@playwright/test';
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
  executablePath: process.env.CHROME_PATH,
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
      if (new URL(route.request().url()).pathname === '/api/events')
        return route.fulfill({
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': origin },
          body: JSON.stringify({
            events: JSON.parse(
              await readFile(
                path.join(backend, 'generated/events.json'),
                'utf8',
              ),
            ).map((e) =>
              e.id === 'productivity'
                ? { ...e, date: '2099-10-02', end: null }
                : e,
            ),
          }),
        });
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
          message: confirmations[received.at(-1).kind],
        }),
      });
    },
  );
  const identity = async () => {
    await page
      .getByLabel('Your full name', { exact: true })
      .fill('Test Student');
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
    .getByText(
      'Your club signup has been received. Welcome to the Dallas College AI Club!',
      {
        exact: true,
      },
    )
    .waitFor();
  assert.equal(received.at(-1).kind, 'join');
  assert.equal(await page.locator('#membership-form input').count(), 0);
  assert.ok(
    await page
      .locator('.form-confirmation h2')
      .evaluate((el) => el === document.activeElement),
  );
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
  await page
    .getByRole('heading', {
      name: 'Subscription request received',
      exact: true,
    })
    .waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForURL('**mode=journal');
  assert.equal(received.at(-1).kind, 'subscribe');
  await page.goto(origin + '/club.html?mode=events&event=productivity');
  await page.locator('#open-rsvp').click();
  await page.locator('#event-rsvp [name="name"]').fill('Test Student');
  await page.locator('#event-rsvp [name="email"]').fill('student@example.com');
  await page.locator('#event-rsvp [name="consent"]').check();
  await page.locator('#event-rsvp button[type="submit"]').click();
  await page.locator('#event-rsvp .form-success').waitFor();
  assert.equal(received.at(-1).eventId, 'productivity');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.ok(
    await page
      .locator('#open-rsvp')
      .evaluate((el) => el === document.activeElement),
  );
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
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#workshop-dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Request a workshop ↗' }).click();
  assert.equal(
    await page.locator('#workshop-form [name=topic]').inputValue(),
    '',
  );
  await page.keyboard.press('Escape');
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
  assert.equal(await page.locator('#draft-form input').count(), 0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForURL('**mode=journal');
  await page.goto(origin + '/club.html?mode=events&event=productivity');
  await page
    .getByRole('button', { name: 'Ask about this event', exact: true })
    .click();
  const question = page.locator('dialog[open] form');
  await question.locator('[name="name"]').fill('Test Student');
  await question.locator('[name="email"]').fill('student@example.com');
  await question
    .locator('[name="message"]')
    .fill('Where can I find the materials?');
  await question.locator('[name="consent"]').check();
  await question
    .getByRole('button', { name: 'Send question', exact: true })
    .click();
  await question.locator('.form-success').waitFor();
  assert.equal(received.at(-1).kind, 'question');
  assert.equal(received.at(-1).eventId, 'productivity');
  await page.screenshot({
    path: path.join(screens, 'question-confirmation.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('dialog[open]').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Ask the club', exact: true }).click();
  assert.equal(
    await page.locator('dialog[open] [name="subject"]').inputValue(),
    '',
  );
  await page
    .getByRole('button', { name: 'Close question form', exact: true })
    .click();
  // A short mobile viewport reproduces the offscreen close button from the report.
  await page.setViewportSize({ width: 320, height: 480 });
  await page.getByRole('button', { name: 'Ask the club', exact: true }).click();
  await page.locator('dialog[open]').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const closeBox = await page
    .getByRole('button', { name: 'Close question form' })
    .boundingBox();
  assert.ok(closeBox.y >= 0 && closeBox.y + closeBox.height <= 480);
  const mobileQuestion = page.locator('dialog[open] form');
  await mobileQuestion.locator('[name=name]').fill('Mobile Student');
  await mobileQuestion.locator('[name=email]').fill('mobile@example.com');
  await mobileQuestion.locator('[name=subject]').fill('Short screen question');
  await mobileQuestion
    .locator('[name=message]')
    .fill('Testing an accessible confirmation.');
  await mobileQuestion.locator('[name=consent]').check();
  await mobileQuestion
    .getByRole('button', { name: 'Send question', exact: true })
    .click();
  await mobileQuestion.locator('.form-confirmation').waitFor();
  assert.equal(await mobileQuestion.locator('input,textarea').count(), 0);
  const doneBox = await page
    .getByRole('button', { name: 'Close', exact: true })
    .boundingBox();
  assert.ok(doneBox.y >= 0 && doneBox.y + doneBox.height <= 480);
  assert.ok(
    await page
      .getByRole('button', { name: 'Close', exact: true })
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(r.x + r.width / 2, r.bottom - 2),
        );
      }),
  );
  await page.screenshot({
    path: path.join(screens, 'question-confirmation-mobile.png'),
    fullPage: false,
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('dialog[open]').waitFor({ state: 'hidden' });
  await page.keyboard.press('Control+k');
  await page.locator('.section-switcher').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const searchClose = await page
    .getByRole('button', { name: 'Close quick find' })
    .boundingBox();
  assert.ok(searchClose.y >= 0 && searchClose.y + searchClose.height <= 480);
  await page.getByRole('button', { name: 'Close quick find' }).click();
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
    await page.getByLabel('Your full name', { exact: true }).inputValue(),
    'Test Student',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Join the club', exact: true })
      .isEnabled(),
    true,
  );
  // Invalid success responses never replace the user's input; retries reuse the request ID.
  await page.unroute('https://dallasai-leaderboard.vercel.app/api/**');
  const retries = [];
  let invalidResponse = true;
  await page.route(
    'https://dallasai-leaderboard.vercel.app/api/forms',
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
      retries.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': origin },
        contentType: 'application/json',
        body: invalidResponse
          ? '{}'
          : JSON.stringify({ message: confirmations.join }),
      });
    },
  );
  await page
    .getByRole('button', { name: 'Join the club', exact: true })
    .click();
  await page
    .getByText(
      'We could not confirm receipt. Your information is still here; please try again.',
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.locator('.form-confirmation').count(), 0);
  assert.equal(
    await page.getByLabel('Your full name', { exact: true }).inputValue(),
    'Test Student',
  );
  invalidResponse = false;
  await page
    .getByRole('button', { name: 'Join the club', exact: true })
    .click();
  await page.locator('.form-confirmation').waitFor();
  assert.equal(retries.length, 2);
  assert.equal(retries[0].requestId, retries[1].requestId);
  await page.locator('#membership-form').evaluate((el) => el.requestSubmit());
  assert.equal(retries.length, 2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.form-confirmation').waitFor({ state: 'hidden' });
  const admin = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  admin.on('pageerror', (error) => errors.push(error.message));
  await admin.addInitScript(() => {
    window.testAlerts = [];
    window.Notification = class {
      static permission = 'granted';
      static async requestPermission() {
        return 'granted';
      }
      constructor(title, options) {
        window.testAlerts.push({ title, ...options });
      }
    };
  });
  // Like the real server: the admin API answers 401 until a code signs in.
  let testSignedIn = false;
  await admin.route('**/api/auth/**', (route) => {
    if (route.request().url().endsWith('/sign-in/email-otp'))
      testSignedIn = true;
    return route.fulfill({
      contentType: 'application/json',
      body:
        route.request().url().endsWith('get-session') && !testSignedIn
          ? 'null'
          : JSON.stringify({
              success: true,
              user: { email: 'officer@example.com', emailVerified: true },
            }),
    });
  });
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
    counts: [
      { kind: 'join', new: 1, total: 1 },
      { kind: 'subscribe', new: 1, total: 1 },
    ],
    queue: { pending: 0, failed: 0 },
    configured: {
      uploads: true,
    },
    hasMore: false,
    events: [{ id: 'future', title: 'Upcoming workshop', date: '2099-01-01' }],
  };
  const activity = [];
  let failComment = false,
    slowReview = null,
    staleLoad = null;
  const postedComments = [];
  await admin.route('**/api/admin*', async (route) => {
    if (!testSignedIn)
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"Sign in again."}',
      });
    if (new URL(route.request().url()).searchParams.has('history'))
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ activity, nextBefore: null }),
      });
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (body.action === 'comment') {
        postedComments.push(body);
        if (failComment)
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Please retry.' }),
          });
        activity.unshift({
          id: String(activity.length + 1),
          actor: 'officer@example.com',
          created_at: '2026-10-02T22:00:00Z',
          action: 'comment-added',
          comment: body.comment,
        });
        return route.fulfill({
          contentType: 'application/json',
          body: '{"comment":{}}',
        });
      }
      fixture.entries[0].review_status = body.status;
      fixture.counts[0].new = body.status === 'new' ? 1 : 0;
      activity.unshift({
        id: String(activity.length + 1),
        actor: 'officer@example.com',
        created_at: '2026-10-02T22:00:00Z',
        action: 'review:' + body.status,
        comment: null,
      });
    }
    const params = new URL(route.request().url()).searchParams;
    // The background poll: counts only.
    if (params.get('counts') === '1')
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          user: fixture.user,
          counts: fixture.counts,
          latest: fixture.counts
            .map((row) => row.latest)
            .filter(Boolean)
            .sort()
            .at(-1),
          arrived: 0,
          arrivedInView: 0,
          asOf: new Date().toISOString(),
          configured: fixture.configured,
        }),
      });
    if (slowReview && params.get('status') === 'reviewed') {
      const hold = slowReview;
      slowReview = null;
      hold.arrived();
      await hold.response;
    }
    const entries = fixture.entries.filter(
      (entry) =>
        (!params.get('status') ||
          entry.review_status === params.get('status')) &&
        (!params.get('kind') || entry.kind === params.get('kind')),
    );
    // Read now; a held response then arrives after later changes.
    const body = JSON.stringify({ ...fixture, entries });
    if (staleLoad) {
      const hold = staleLoad;
      staleLoad = null;
      hold.arrived();
      await hold.response;
    }
    await route.fulfill({ contentType: 'application/json', body });
  });
  await admin.goto(origin + '/admin/');
  await admin
    .getByLabel('Email address', { exact: true })
    .fill('officer@example.com');
  await admin
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .click();
  await admin.getByLabel('Sign-in code', { exact: true }).fill('123456');
  await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
  await admin.locator('#inbox-pane').waitFor();
  testSignedIn = true;
  await expect(admin.locator('[data-inbox-status="new"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  assert.equal(await admin.locator('select[name="status"]').count(), 0);
  // The inbox explainers live in Help, not above the list.
  assert.equal(
    await admin.locator('#inbox-pane .submission-sources').count(),
    0,
  );
  await admin.locator('#help-tab').click();
  await admin
    .getByRole('heading', { name: 'How people reach the inbox', exact: true })
    .waitFor();
  assert.equal(await admin.locator('.submission-sources li').count(), 7);
  for (const target of ['join', 'subscribe', 'contribute', 'events', 'about'])
    assert.ok(
      await admin
        .locator('.submission-sources a[href$="mode=' + target + '"]')
        .count(),
    );
  await admin
    .getByText('stored in the club’s Neon database', { exact: false })
    .waitFor();
  await admin.locator('#inbox-tab').click();
  await admin
    .locator('#counts')
    .getByText('Newsletter', { exact: true })
    .waitFor();
  await admin.locator('#entries .entry > summary').click();
  await admin.getByText('Received in club inbox', { exact: true }).waitFor();
  assert.equal(await admin.locator('input[type="password"]').count(), 0);
  assert.equal(await admin.locator('#filters [name="search"]').count(), 0);
  await admin.locator('#filters [name="kind"]').selectOption('rsvp');
  await admin.getByLabel('Event', { exact: true }).selectOption('future');
  await admin.waitForFunction(() =>
    document.querySelector('#export').href.includes('eventId=future'),
  );
  await admin.locator('#filters [name="kind"]').selectOption('join');
  await admin.locator('#entries .entry > summary').click();
  await admin.getByText('Submission details', { exact: true }).click();
  assert.equal(await admin.locator('.entry img').count(), 0);
  await admin.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(admin.locator('#entries .entry')).toHaveCount(0);
  // Counts and the title follow an officer's own change without a Refresh.
  await expect(admin).toHaveTitle('(1) Inbox · Club Office');
  await expect(admin.locator('#counts .count strong').first()).toHaveText('0');
  await admin.locator('[data-inbox-status="reviewed"]').click();
  await admin.locator('#entries .entry').waitFor();
  if (!(await admin.locator('#entries .entry').evaluate((el) => el.open)))
    await admin.locator('#entries .entry > summary').click();
  await admin.locator('.badge').filter({ hasText: 'reviewed' }).waitFor();
  await admin
    .getByRole('button', { name: 'Archive submission', exact: true })
    .click();
  await expect(admin.locator('#entries .entry')).toHaveCount(0);
  await admin.locator('[data-inbox-status="closed"]').click();
  await admin.locator('#entries .entry').waitFor();
  if (!(await admin.locator('#entries .entry').evaluate((el) => el.open)))
    await admin.locator('#entries .entry > summary').click();
  await admin.locator('.badge').filter({ hasText: 'archived' }).waitFor();
  await expect(admin.locator('#export')).toHaveAttribute(
    'href',
    /status=closed/,
  );
  await admin.getByText('Activity & comments', { exact: true }).click();
  await admin.getByRole('button', { name: 'Mark new', exact: true }).click();
  await expect(admin.locator('#entries .entry')).toHaveCount(0);
  await expect(admin).toHaveTitle('(2) Inbox · Club Office');
  await admin.locator('[data-inbox-status="new"]').click();
  await admin.locator('#entries .entry').waitFor();
  if (!(await admin.locator('#entries .entry').evaluate((el) => el.open)))
    await admin.locator('#entries .entry > summary').click();
  await admin.locator('.badge').filter({ hasText: 'new' }).waitFor();
  // Reopening an entry is not an arrival.
  await expect(admin.locator('#arrivals')).toBeHidden();
  await admin.getByText('Activity & comments', { exact: true }).click();
  await admin
    .getByText('Visible to all authorized club admins.', { exact: false })
    .waitFor();
  const timeline = admin.locator('.submission-timeline');
  await timeline.getByText('Marked reviewed', { exact: true }).waitFor();
  await timeline.getByText('Archived', { exact: true }).waitFor();
  await admin
    .getByLabel('Add a comment', { exact: true })
    .fill('Follow up tomorrow. <img src=x onerror=alert(1)>');
  await admin.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(admin.locator('#entries')).toHaveAttribute('aria-busy', 'false');
  assert.equal(
    await admin.getByLabel('Add a comment', { exact: true }).inputValue(),
    'Follow up tomorrow. <img src=x onerror=alert(1)>',
  );
  failComment = true;
  await admin.getByRole('button', { name: 'Add comment', exact: true }).click();
  await admin
    .getByText('Could not confirm the comment was saved.', { exact: false })
    .waitFor();
  failComment = false;
  await admin.getByRole('button', { name: 'Add comment', exact: true }).click();
  await admin
    .getByText('Comment saved with this entry.', { exact: false })
    .waitFor();
  await admin.locator('.officer-comment').waitFor();
  assert.equal(postedComments[0].commentId, postedComments[1].commentId);
  assert.equal(await admin.locator('.officer-comment img').count(), 0);
  assert.equal(
    await admin.locator('.officer-comment').textContent(),
    'Follow up tomorrow. <img src=x onerror=alert(1)>',
  );
  assert.ok(
    (await admin.locator('.submission-timeline').textContent()).includes(
      'Fri, Oct 2, 5:00 PM CT',
    ),
  );
  // A load that read the counts before this officer's change, but returns
  // after it, is read again instead of being taken as an arrival.
  let loadArrived, releaseLoad;
  const loadHeld = new Promise((resolve) => {
    loadArrived = resolve;
  });
  staleLoad = {
    arrived: loadArrived,
    response: new Promise((resolve) => {
      releaseLoad = resolve;
    }),
  };
  await admin.getByRole('button', { name: 'Refresh', exact: true }).click();
  await loadHeld;
  await admin
    .getByRole('button', { name: 'Archive submission', exact: true })
    .click();
  await admin
    .getByText('Submission moved to Archived.', { exact: false })
    .waitFor();
  releaseLoad();
  await expect(admin).toHaveTitle('(1) Inbox · Club Office');
  await expect(admin.locator('#entries')).toHaveAttribute('aria-busy', 'false');
  await expect(admin.locator('#arrivals')).toBeHidden();
  await expect(admin.locator('#entries .entry')).toHaveCount(0);
  await admin.locator('[data-inbox-status="closed"]').click();
  await admin.locator('#entries .entry').waitFor();
  if (!(await admin.locator('#entries .entry').evaluate((el) => el.open)))
    await admin.locator('#entries .entry > summary').click();
  await admin.locator('.badge').filter({ hasText: 'archived' }).waitFor();
  await expect(admin.locator('#export')).toHaveAttribute(
    'href',
    /status=closed/,
  );
  await admin.getByText('Activity & comments', { exact: true }).click();
  await admin.locator('.officer-comment').waitFor();

  let arrived, release;
  const pendingRequest = new Promise((resolve) => {
    arrived = resolve;
  });
  slowReview = {
    arrived,
    response: new Promise((resolve) => {
      release = resolve;
    }),
  };
  await admin.locator('[data-inbox-status="reviewed"]').click();
  await pendingRequest;
  await admin.locator('[data-inbox-status="new"]').click();
  release();
  await expect(admin.locator('#export')).toHaveAttribute('href', /status=new/);
  await expect(admin.locator('#entries .entry')).toHaveCount(0);
  await expect(admin.locator('#entries')).toHaveAttribute('aria-busy', 'false');
  const alertsSwitch = admin.getByRole('switch', {
    name: 'Browser alerts',
    exact: true,
  });
  await admin.locator('#account-button').click();
  await alertsSwitch.click();
  await expect(alertsSwitch).toHaveAttribute('aria-checked', 'true');
  await admin.reload();
  await admin.locator('#inbox-pane').waitFor();
  await expect(admin.locator('#enable-alerts')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // A newer submission time alerts; Refresh also checks the counts.
  fixture.counts[0].latest = '2099-01-01T00:00:00Z';
  await admin.getByRole('button', { name: 'Refresh', exact: true }).click();
  await admin.waitForFunction(() => window.testAlerts.length === 1);
  await admin.locator('#account-button').click();
  await alertsSwitch.click();
  await expect(alertsSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(admin.locator('#notification-status')).toHaveText(
    'Pop-ups while this tab is open. Email alerts aren’t available.',
  );
  await admin.keyboard.press('Escape');
  fixture.counts[0].latest = '2099-01-02T00:00:00Z';
  const polled = admin.waitForResponse((response) =>
    response.url().includes('counts=1'),
  );
  await admin.getByRole('button', { name: 'Refresh', exact: true }).click();
  await polled;
  assert.equal(await admin.evaluate(() => window.testAlerts.length), 1);
  assert.equal(
    await admin.locator('#office-theme, #office-font, #office-layout').count(),
    0,
  );
  await admin.reload();
  await admin.locator('#inbox-pane').waitFor();
  await expect(admin.locator('#enable-alerts')).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(admin.locator('#entries .entry')).toHaveCount(0);
  await admin.goto(origin + '/admin/#entry=' + fixture.entries[0].id);
  await expect(admin.locator('[data-inbox-status="closed"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await admin.locator('#entries .entry').waitFor();
  if (!(await admin.locator('#entries .entry').evaluate((el) => el.open)))
    await admin.locator('#entries .entry > summary').click();
  await admin.locator('.badge').filter({ hasText: 'archived' }).waitFor();
  await admin.emulateMedia({ colorScheme: 'dark' });
  await admin.waitForFunction(() =>
    document
      .querySelector('.office-logo')
      .currentSrc.includes('club-office-logo-dark.png'),
  );
  await admin.waitForFunction(
    () => document.querySelector('.office-logo').complete,
  );
  await admin.getByText('Activity & comments', { exact: true }).click();
  await admin.locator('.officer-comment').waitFor();
  await admin.screenshot({
    path: path.join(screens, 'admin-dark.png'),
    fullPage: true,
  });
  await admin.emulateMedia({ colorScheme: 'light' });
  await admin.waitForFunction(() =>
    document
      .querySelector('.office-logo')
      .currentSrc.endsWith('/club-office-logo.png'),
  );
  await admin.screenshot({
    path: path.join(screens, 'admin-desktop.png'),
    fullPage: true,
  });
  await admin.setViewportSize({ width: 320, height: 844 });
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
    'Browser checks passed: six forms, question dialogs, attachments, RSVP event filtering/export, Studio office, mobile layouts, recoverable errors, admin sign-in/review, and safe rendering.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
