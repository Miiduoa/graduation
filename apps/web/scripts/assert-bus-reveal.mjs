#!/usr/bin/env node
/**
 * Production-build check for /bus: clicking a campus row keeps the row and
 * destination below the sticky stop line, and searching 靜宜大學(校門) keeps
 * the heading and 下一班 inside the viewport. Intercepts /api/transit only.
 *
 *   BUS_PAGE_URL=http://127.0.0.1:3000/bus?schoolId=pu node apps/web/scripts/assert-bus-reveal.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : 'playwright'
);

const url = process.env.BUS_PAGE_URL || 'http://127.0.0.1:3000/bus?schoolId=pu&campus=pu';
const outDir = process.env.BUS_REVEAL_OUT || '/tmp/bus-reveal';
const viewports = [
  { name: '390x844', width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
  { name: '350x844', width: 350, height: 844, deviceScaleFactor: 2, mobile: true },
  { name: '1440x1000', width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
];
const themes = ['light', 'dark'];

function nowIso() {
  return new Date().toISOString();
}

function laterMinutes(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function tomorrowNight() {
  const stamp = new Date();
  stamp.setUTCDate(stamp.getUTCDate() + 1);
  stamp.setUTCHours(17, 10, 0, 0);
  return stamp.toISOString();
}

const fetchedAt = nowIso();
const campusNext = {
  status: 'ready',
  kind: 'arrivals',
  fetchedAt,
  arrivals: [
    { id: '368', route: '368', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 50, updatedAt: fetchedAt, stopName: '靜宜大學(英才路)' },
    { id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 180, updatedAt: fetchedAt, stopName: '靜宜大學(英才路)' },
    { id: '301', route: '301', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 720, updatedAt: fetchedAt, stopName: '靜宜大學(英才路)' },
    { id: '326', route: '326', direction: 1, destination: '巨業沙鹿站', status: 0, seconds: null, updatedAt: fetchedAt, stopName: '靜宜大學(英才路)', scheduledAt: laterMinutes(12) },
    { id: 'night', route: '300', direction: 1, destination: '沙鹿火車站', status: 1, seconds: null, updatedAt: fetchedAt, stopName: '靜宜大學(英才路)', scheduledAt: tomorrowNight() },
  ],
  routeStops: [{
    routeUid: 'TXG162', subRouteUid: 'TXG162', routeName: '162', direction: 1,
    stops: [
      { id: 'SHA', name: '沙鹿車站' },
      { id: 'YING', name: '靜宜大學(英才路)' },
      { id: 'GATE', name: '靜宜大學(校門)' },
    ],
  }],
};

const searchStops = {
  status: 'ready',
  kind: 'stops',
  limited: true,
  fetchedAt,
  stops: [
    { id: 'TXG11711', name: '靜宜大學', city: 'Taichung', lat: 24.22497, lon: 120.57703, distance: null },
    { id: 'TXG20091', name: '靜宜大學(校門)', city: 'Taichung', lat: 24.2253, lon: 120.5778, distance: null },
    { id: 'TXG19385', name: '靜宜大學(英才路)', city: 'Taichung', lat: 24.22665, lon: 120.57484, distance: null },
  ],
};

const gateArrivals = {
  status: 'ready',
  kind: 'arrivals',
  fetchedAt,
  arrivals: [
    { id: '301', route: '301', direction: 1, destination: '嘉陽高中', status: 0, seconds: 180, updatedAt: fetchedAt, stopName: '靜宜大學(校門)' },
    { id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 420, updatedAt: fetchedAt, stopName: '靜宜大學(校門)' },
  ],
};

async function fulfillTransit(route) {
  let body = {};
  try { body = route.request().postDataJSON() || {}; } catch { body = {}; }
  if (body.action === 'campus-next') return route.fulfill({ json: campusNext });
  if (body.action === 'search') return route.fulfill({ json: searchStops });
  if (body.action === 'arrivals' && body.stopId === 'TXG20091') return route.fulfill({ json: gateArrivals });
  if (body.action === 'arrivals') {
    return route.fulfill({ json: { status: 'ready', kind: 'arrivals', fetchedAt, arrivals: gateArrivals.arrivals } });
  }
  return route.fulfill({ json: { status: 'unavailable', reason: 'not-configured' } });
}

async function attachFixtures(page) {
  await page.route('**/api/schools', async (route) => {
    await route.fulfill({
      json: { schools: [{ id: 'pu', name: '靜宜大學', status: 'open' }] },
    });
  });
  await page.route('**/api/nuni/**', async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });
  await page.route('**/api/transit', fulfillTransit);
}

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

await mkdir(outDir, { recursive: true });
const results = [];
let react418 = 0;

for (const viewport of viewports) {
  for (const theme of themes) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      locale: 'zh-TW',
      colorScheme: theme,
    });
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('Minified React error #418') || text.includes('Hydration failed')) react418 += 1;
    });
    page.on('pageerror', (error) => {
      if (String(error).includes('#418')) react418 += 1;
    });
    await attachFixtures(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByTestId('campus-approach').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(400);

    const firstScreen = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="campus-arrival-block"]');
      const rect = row?.getBoundingClientRect();
      return {
        rowTop: rect?.top ?? null,
        rowVisible: Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight),
        fakeLast: document.body.innerText.includes('今天收班'),
        nightLabel: document.body.innerText.includes('夜間公車'),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        background: getComputedStyle(document.body).backgroundColor,
      };
    });

    const fourStates = {
      arriving: await page.getByTestId('campus-approach').getAttribute('data-status'),
    };
    await page.getByRole('button', { name: /301 往 沙鹿火車站/ }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="campus-approach"]')?.getAttribute('data-status') === 'far');
    fourStates.far = await page.getByTestId('campus-approach').getAttribute('data-status');
    await page.getByRole('button', { name: /326 / }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="campus-approach"]')?.getAttribute('data-status') === 'scheduled');
    fourStates.scheduled = await page.getByTestId('campus-approach').getAttribute('data-status');
    const scheduledHasBus = await page.getByTestId('campus-approach-bus').count();
    const click162 = page.getByRole('button', { name: /162 往 沙鹿火車站/ });
    await click162.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="campus-approach"]')?.getAttribute('data-status') === 'soon');
    fourStates.soon = await page.getByTestId('campus-approach').getAttribute('data-status');
    await page.waitForTimeout(900);
    const afterClick = await page.evaluate(() => {
      const cover = [...document.querySelectorAll('[data-sticky-cover="true"]')]
        .map((node) => {
          const style = getComputedStyle(node);
          if (style.position !== 'sticky' && style.position !== 'fixed') return 0;
          const stuckTop = Number.parseFloat(style.top);
          const top = Number.isFinite(stuckTop) ? stuckTop : 0;
          return top + node.getBoundingClientRect().height;
        })
        .reduce((max, bottom) => Math.max(max, bottom), 0);
      const row = [...document.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') || '').includes('162 往 沙鹿火車站'));
      const block = row?.closest('[data-testid="campus-arrival-block"]');
      const panel = block?.querySelector('[data-testid="opened-route-panel"]');
      const nav = document.querySelector('[data-campus-navigation="true"] nav');
      const navTop = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight;
      const blockBox = block?.getBoundingClientRect();
      const panelBox = panel?.getBoundingClientRect();
      const approach = document.querySelector('[data-testid="campus-approach"]');
      return {
        cover,
        navTop,
        status: approach?.getAttribute('data-status') ?? null,
        blockTop: blockBox?.top ?? null,
        blockBottom: blockBox?.bottom ?? null,
        panelTop: panelBox?.top ?? null,
        panelBottom: panelBox?.bottom ?? null,
        rowClear: Boolean(blockBox && blockBox.top >= cover - 1 && blockBox.bottom <= navTop + 1),
        panelClear: Boolean(panelBox && panelBox.top >= cover - 1 && panelBox.bottom <= navTop + 1),
      };
    });
    await page.screenshot({ path: `${outDir}/${viewport.name}-${theme}-click-162.png`, fullPage: false });

    await page.getByRole('button', { name: '搜尋站名' }).click();
    await page.getByLabel('站名或學校名稱').fill('靜宜大學');
    await page.getByRole('button', { name: '尋找站牌' }).click();
    await page.getByRole('button', { name: /02\s*靜宜大學\(校門\)/ }).click();
    await page.getByRole('heading', { name: '靜宜大學(校門)' }).waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByText('下一班', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(900);
    const afterSearch = await page.evaluate(() => {
      const title = document.querySelector('#transit-arrivals-title');
      const next = [...document.querySelectorAll('p')].find((node) => node.textContent?.includes('下一班'));
      const nav = document.querySelector('[data-campus-navigation="true"] nav');
      const navTop = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight;
      const titleBox = title?.getBoundingClientRect();
      const nextBox = next?.getBoundingClientRect();
      return {
        titleTop: titleBox?.top ?? null,
        nextTop: nextBox?.top ?? null,
        titleVisible: Boolean(titleBox && titleBox.top >= 0 && titleBox.bottom <= navTop + 1),
        nextVisible: Boolean(nextBox && nextBox.top >= 0 && nextBox.bottom <= navTop + 1),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        background: getComputedStyle(document.body).backgroundColor,
      };
    });
    await page.screenshot({ path: `${outDir}/${viewport.name}-${theme}-search-gate.png`, fullPage: false });

    results.push({
      viewport: viewport.name,
      theme,
      firstScreen: firstScreen.rowVisible,
      overflow: firstScreen.overflow || afterSearch.overflow,
      background: afterSearch.background,
      click162: afterClick,
      searchGate: afterSearch,
      nightLabel: firstScreen.nightLabel,
      fakeLast: firstScreen.fakeLast,
      fourStates,
      scheduledHasBus,
      ok: firstScreen.rowVisible
        && !firstScreen.overflow
        && !afterSearch.overflow
        && !firstScreen.fakeLast
        && fourStates.arriving === 'arriving'
        && fourStates.soon === 'soon'
        && fourStates.far === 'far'
        && fourStates.scheduled === 'scheduled'
        && scheduledHasBus === 0
        && afterClick.rowClear
        && afterClick.panelClear
        && afterSearch.titleVisible
        && afterSearch.nextVisible
        && (theme === 'light' || afterSearch.background === 'rgb(0, 0, 0)'),
    });
    await page.close();
  }
}

await browser.close();
await writeFile(`${outDir}/result.json`, JSON.stringify({ react418, results }, null, 2));
console.log(JSON.stringify({ react418, results }, null, 2));
if (react418 !== 0 || results.some((entry) => !entry.ok)) process.exit(1);
