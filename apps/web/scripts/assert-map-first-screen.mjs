#!/usr/bin/env node
/**
 * Phone first-screen check for /map: the campus map canvas top must sit
 * inside 390×844 and 350×844 without scrolling. Run against a local Next server.
 *
 *   MAP_PAGE_URL=http://127.0.0.1:3000/map?schoolId=pu node apps/web/scripts/assert-map-first-screen.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.MAP_PAGE_URL || 'http://127.0.0.1:3000/map?schoolId=pu&campus=pu';
const outDir = process.env.MAP_FIRST_SCREEN_OUT || '/tmp/map-first-screen';
const viewports = [
  { name: '390x844', width: 390, height: 844, deviceScaleFactor: 3 },
  { name: '350x844', width: 350, height: 844, deviceScaleFactor: 2 },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const results = [];
for (const viewport of viewports) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-TW',
  });
  await page.route('**/api/schools', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schools: [{ id: 'pu', name: '靜宜大學', status: 'open' }],
      }),
    });
  });
  await page.route('**/api/nuni/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false }),
    });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const map = page.locator('[data-map-canvas="true"]').first();
  await map.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1500);
  const box = await map.boundingBox();
  const sourceOpen = await page.locator('[aria-label="地圖資料來源"] details').evaluate((node) =>
    node instanceof HTMLDetailsElement ? node.open : null,
  );
  const screenshot = `${outDir}/${viewport.name}.png`;
  await page.screenshot({ path: screenshot, fullPage: false });
  const top = box?.y ?? Number.POSITIVE_INFINITY;
  const visible = Boolean(box && box.y >= 0 && box.y < viewport.height && box.y + Math.min(box.height, 240) <= viewport.height);
  results.push({
    viewport: viewport.name,
    mapTop: box?.y ?? null,
    mapHeight: box?.height ?? null,
    sourceCollapsed: sourceOpen === false,
    firstScreen: visible,
    screenshot,
  });
  await page.close();
}

await browser.close();
await writeFile(`${outDir}/result.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
if (results.some((entry) => !entry.firstScreen || !entry.sourceCollapsed)) {
  process.exit(1);
}
