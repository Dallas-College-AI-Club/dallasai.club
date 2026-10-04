import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
const screens = path.resolve(site, '../.preview/coladde-checks');
await mkdir(screens, { recursive: true });
const popup = page.locator('#coladde-reveal');
const mark = (id) => page.locator(`[data-coladde="${id}"]`);
const visit = async (mode) => {
  await page.goto(origin + '/club.html?mode=' + mode + '&motion=off');
  await page.waitForFunction(
    () => !document.documentElement.classList.contains('club-booting'),
  );
};
const saved = () =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem('dc-coladde-discoveries-v1') || '[]'),
  );
try {
  await visit('about');
  await mark('footer').scrollIntoViewIfNeeded();
  await mark('footer').hover();
  await expect(popup).toBeVisible();
  await expect(popup).toContainText(
    'Community Of Learners Advancing Dallas College’s Digital Edge',
  );
  assert.deepEqual(await saved(), []);
  assert.ok(
    await page
      .locator('.footer-tagline')
      .evaluate(
        (el) =>
          parseFloat(getComputedStyle(el).fontSize) <
          parseFloat(
            getComputedStyle(document.querySelector('.coladde-wordmark'))
              .fontSize,
          ),
      ),
  );
  await page.screenshot({ path: path.join(screens, 'coladde-footer.png') });
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await visit('play');
  await mark('arcade').click();
  await expect(popup).toContainText('+25 discovery points');
  await page.getByRole('button', { name: 'Close coladde meaning' }).click();
  await expect(popup).toBeHidden();
  await mark('arcade').click();
  await expect(popup).not.toContainText('+25');
  await page.keyboard.press('Escape');
  await page.reload();
  await mark('arcade').click();
  await expect(popup).toContainText('1 of 4');
  await expect(popup).not.toContainText('+25');
  await page.keyboard.press('Escape');
  await visit('snake');
  await page.locator('#game-overlay [data-start]').click();
  await expect(page.locator('#game-pause')).toContainText('Pause');
  await mark('snake').hover();
  await expect(popup).toContainText('2 of 4');
  await expect(page.locator('#game-pause')).toContainText('Resume');
  const score = await page.locator('#game-score-value').textContent();
  await page.screenshot({ path: path.join(screens, 'snake-discovery.png') });
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  assert.equal(await page.locator('#game-score-value').textContent(), score);
  await page.locator('#game-pause').click();
  await expect(page.locator('#game-pause')).toContainText('Pause');
  await visit('ride');
  await page.locator('#game-help').click();
  await mark('ride').click();
  await expect(popup).toContainText('3 of 4');
  await page.keyboard.press('Escape');
  await page.locator('#game-help-close').click();
  await expect(page.locator('#game-instructions')).toBeHidden();
  await visit('explore');
  await page.locator('.ride-panel summary').click();
  await mark('drive').click();
  await expect(popup).toContainText('4 of 4');
  await expect(popup).toContainText('100 discovery points');
  await page.keyboard.press('Control+k');
  await expect(popup).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.section-switcher')).toBeHidden();
  await page.locator('.ride-panel summary').click();
  await expect(page.locator('#renderer-error')).toBeHidden();
  assert.equal((await saved()).length, 4);
  await page.setViewportSize({ width: 320, height: 780 });
  await visit('about');
  await mark('footer').click();
  await expect(popup).toBeVisible();
  const box = await popup.boundingBox();
  assert.ok(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= 320 &&
      box.y + box.height <= 780,
  );
  await page.screenshot({ path: path.join(screens, 'coladde-mobile.png') });
  await page.getByRole('button', { name: 'Close coladde meaning' }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await visit('snake');
  await mark('snake').click();
  await expect(popup).toBeVisible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-library]').click();
  await expect(popup).toBeHidden();
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await touch.newPage();
  phone.on('pageerror', (error) => errors.push(error.message));
  await phone.goto(origin + '/club.html?mode=play');
  await phone.locator('[data-coladde="arcade"]').tap();
  await expect(phone.locator('#coladde-reveal')).toBeVisible();
  await phone.getByRole('button', { name: 'Close coladde meaning' }).tap();
  await expect(phone.locator('#coladde-reveal')).toBeHidden();
  await touch.close();
  const blocked = await browser.newPage();
  blocked.on('pageerror', (error) => errors.push(error.message));
  await blocked.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Storage blocked');
      },
    }),
  );
  await blocked.goto(origin + '/club.html?mode=play');
  await blocked.locator('[data-coladde="arcade"]').click();
  await expect(blocked.locator('#coladde-reveal')).toContainText(
    'For this visit only',
  );
  await blocked.close();
  assert.deepEqual(errors, []);
  assert.deepEqual([...new Set(failed)], []);
  console.log(
    'Coladde passed: four once-only discoveries, reload persistence, game pause/resume, keyboard/hover/touch, narrow layout, navigation, blocked storage.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
