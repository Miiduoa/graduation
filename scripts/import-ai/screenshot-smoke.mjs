// Run against a local Web build with Playwright and its Chromium browser installed.
// The OCR engine reads real PNGs. Only the recognition API response is a fixture.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const { chromium } = createRequire(import.meta.url)('playwright');

const base = new URL(process.env.TIMETABLE_TEST_URL || 'http://127.0.0.1:3100');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Use a local Web build');
const samples = {
  'course-list': [
    ['資料庫系統', 3, 4, 5, 'A301'],
    ['程式設計', 1, 2, 3, 'B202'],
    ['資訊安全', 5, 6, 7, 'C103'],
  ],
  'weekly-grid': [
    ['程式設計', 1, 1, 1, 'B202'],
    ['資料庫系統', 3, 3, 3, 'A301'],
    ['資訊安全', 5, 4, 4, 'C103'],
  ],
};

async function check(browser, name, courses) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  try {
    await page.route(/^https?:/, (route) =>
      new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort(),
    );
    await page.route('**/api/schools', (route) => route.fulfill({ json: { schools: [] } }));
    let requests = 0;
    await page.route('**/api/personal-import/recognize', async (route) => {
      requests++;
      const body = route.request().postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ['columnContext', 'kind', 'text']);
      assert.equal(body.kind, 'timetable');
      const rows = courses.flatMap(([title, dayOfWeek, start, end, location]) => {
        const evidence = body.text.split('\n').find((line) => line.includes(title));
        return evidence
          ? [
              {
                title,
                dayOfWeek,
                startPeriod: String(start),
                endPeriod: String(end),
                location,
                evidence,
              },
            ]
          : [];
      });
      await route.fulfill({
        json: {
          output: JSON.stringify({ complete: true, rows }),
          sourceText: body.text,
          columnContext: body.columnContext,
        },
      });
    });
    await page.goto(new URL('/import?kind=timetable&campus=all', base).href);
    await page.getByLabel('這份資料的學年度', { exact: true }).fill('115');
    await page.getByLabel('學期', { exact: true }).fill('1');
    await page
      .getByLabel('選擇交給 AI 辨識的截圖')
      .setInputFiles(fileURLToPath(new URL('./fixtures/' + name + '.png', import.meta.url)));
    const save = page.getByRole('button', { name: '確認匯入 3 筆', exact: true });
    await save.waitFor({ timeout: 90_000 });
    assert.ok(requests > 0);
    assert.ok(await save.isDisabled());
    await page.getByRole('checkbox', { name: /我已對照來源/ }).check();
    await save.click();
    const key = 'campus.personal-imports.v1:guest:personal';
    await page.waitForFunction(
      (key) => JSON.parse(globalThis.localStorage.getItem(key) || '{}').records?.length === 3,
      key,
    );
    const saved = await page.evaluate(
      (key) => JSON.parse(globalThis.localStorage.getItem(key)).records,
      key,
    );
    assert.deepEqual(
      saved.map((row) => [row.title, row.dayOfWeek, row.startPeriod, row.endPeriod, row.location]),
      courses,
    );
    console.log(name + ' — 3 reviewed courses matched the screenshot');
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.TIMETABLE_CHROMIUM });
  try {
    for (const [name, courses] of Object.entries(samples)) await check(browser, name, courses);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
