import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const site = fileURLToPath(new URL('../../public/', import.meta.url));
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'),
    file = path.resolve(
      site,
      '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''),
    );
  try {
    if (!file.startsWith(site)) throw Error();
    const data = await readFile(file);
    const type =
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.jpg': 'image/jpeg',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
      }[path.extname(file)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1365, height: 950 } }),
  errors = [],
  failed = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', (response) => {
  if (response.url().startsWith(origin) && response.status() >= 400)
    failed.push(response.url());
});
try {
  for (const mode of [
    'summary',
    'journal',
    'projects',
    'about',
    'events',
    'join',
    'subscribe',
    'contribute',
    'lab',
    'ethics',
    'compare',
    'drift',
    'play',
    'rankings',
    'ride',
    'snake',
    'explore',
  ]) {
    await page.goto(origin + '/club.html?mode=' + mode + '&motion=off');
    await page.waitForFunction(
      () => !document.documentElement.classList.contains('club-booting'),
    );
    assert.equal(await page.locator('body').getAttribute('data-space'), mode);
    if (mode === 'lab') {
      await page.locator('#train-model').click();
      await page.waitForFunction(
        () =>
          !document
            .querySelector('#training-state')
            .textContent.includes('0 epochs'),
      );
      await page.locator('#reset-model').click();
    }
    if (mode === 'ethics') {
      await page.locator('#even-mix').click();
      assert.equal(await page.locator('#overall-score').textContent(), '75%');
      await page.locator('#reset-mix').click();
      assert.equal(await page.locator('#overall-score').textContent(), '87%');
    }
    if (['ride', 'snake'].includes(mode)) {
      await page.waitForFunction(
        () =>
          !document
            .querySelector('#game-overlay')
            .textContent.includes('Getting ready'),
      );
      await page.locator('#game-help').click();
      assert.ok(await page.locator('#game-instructions').isVisible());
    }
    if (mode === 'explore')
      assert.ok(!(await page.locator('#renderer-error').isVisible()));
  }
  await page.goto(origin + '/club.html?mode=events&event=welcome');
  await page
    .locator('#event-detail h2')
    .filter({ hasText: 'Welcome' })
    .waitFor();
  const month = await page.locator('#calendar-month').textContent();
  await page.locator('#calendar-prev').click();
  assert.notEqual(await page.locator('#calendar-month').textContent(), month);
  await page.keyboard.press('Control+k');
  await page.locator('.section-switcher input').fill('Welcome');
  await page
    .locator('.switcher-results button')
    .filter({ hasText: 'Welcome' })
    .first()
    .click();
  await page
    .locator('#event-detail h2')
    .filter({ hasText: 'Welcome' })
    .waitFor();
  await page.goto(origin + '/club.html?mode=journal');
  await page
    .getByRole('button', { name: 'All articles', exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Club news', exact: true }).count(),
    0,
  );
  assert.equal(await page.getByText('First Post', { exact: true }).count(), 0);
  await page
    .getByRole('button', { name: 'Contribute an article ↗', exact: true })
    .click();
  await page.locator('#draft-form').waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual([...new Set(failed)], []);
  console.log(
    'Site audit passed: 17 routes, AI Lab training/reset, evaluation controls, game loading/help, Dallas Drive startup, calendar, Quick find, and AI Review submission navigation.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
