import { chromium } from '/tmp/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIR = join(ROOT, 'followup');
mkdirSync(DIR, { recursive: true });
const CHROME = '/usr/bin/google-chrome-stable';
const BASE = 'https://nuni.tw';
const GQL = 'https://citybus.taichung.gov.tw/ebus/graphql';
const FULL = '八德東大勇路口';

async function gql(query, variables) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://citybus.taichung.gov.tw',
      Referer: 'https://citybus.taichung.gov.tw/ebus/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, json: await res.json() };
}

async function ebusRoute(routeId) {
  const staticQ = `query Q($routeId: Int!, $lang: String!) { route(xno: $routeId, lang: $lang) { id name departure destination stations { edges { goBack node { id name } } } } }`;
  const dynQ = `query Q($routeId: Int!, $lang: String!) { route(xno: $routeId, lang: $lang) { estimateTimes { edges { node { id sid comeTime goBack etas { busId etaTime } } } } } }`;
  const st = await gql(staticQ, { routeId, lang: 'zh' });
  const dy = await gql(dynQ, { routeId, lang: 'zh' });
  const info = st.json?.data?.route;
  const estimates = dy.json?.data?.route?.estimateTimes?.edges || [];
  const pu = (info?.stations?.edges || []).filter((e) => /靜宜/.test(e.node?.name || ''));
  const byStop = pu.map((e) => {
    const est = estimates.map((x) => x.node).find((n) => n.id === e.node.id && n.goBack === e.goBack);
    const etaMin = est?.etas?.[0]?.etaTime;
    return {
      goBack: e.goBack,
      stop: e.node.name,
      stopId: e.node.id,
      comeTime: est?.comeTime || null,
      etaMin: typeof etaMin === 'number' ? etaMin : null,
      text: typeof etaMin === 'number' ? `${etaMin} 分` : est?.comeTime ? `表定 ${est.comeTime}` : '無即時',
    };
  });
  return { routeId, name: info?.name, departure: info?.departure, destination: info?.destination, pu: byStop, at: new Date().toISOString() };
}

async function main() {
  const health = await (await fetch(`${BASE}/health/ready`)).text();
  const ebus411 = await ebusRoute(411);
  const ebus310 = await ebusRoute(310);
  const ebus907 = await ebusRoute(907);
  const ebus300 = await ebusRoute(300);
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({
    locale: 'zh-TW',
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/bus?campus=pu`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(8_000);
  const tab = page.getByRole('tab', { name: '專用道', exact: true });
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(600);
  const more = page.locator('summary').filter({ hasText: /還有/ });
  if (await more.count()) await more.first().click().catch(() => {});
  const moreBtn = page.getByRole('button', { name: /還有/ });
  if (await moreBtn.count()) await moreBtn.first().click().catch(() => {});
  await page.waitForTimeout(400);

  const longRow = page.locator('[class*="arrivalRow"]').filter({ hasText: '307副' }).filter({ hasText: '八德' }).first();
  const foundLong = (await longRow.count()) > 0;
  let panel = null;
  if (foundLong) {
    await longRow.scrollIntoViewIfNeeded();
    await longRow.click();
    await page.waitForTimeout(500);
    panel = await page.evaluate((FULL) => {
      const btn = [...document.querySelectorAll('[class*="arrivalRow"]')].find((el) =>
        (el.textContent || '').includes('307副') && (el.textContent || '').includes('八德'),
      );
      const wrap = btn?.parentElement;
      const panelEl = wrap?.querySelector('[class*="rowPanel"]');
      const headingEl = btn?.querySelector('strong');
      const cs = headingEl ? getComputedStyle(headingEl) : null;
      const heading = (headingEl?.textContent || '').trim();
      const aria = btn?.getAttribute('aria-label') || '';
      const panelText = (panelEl?.textContent || '').trim().replace(/\s+/g, ' ');
      return {
        heading,
        title: headingEl?.getAttribute('title') || null,
        whiteSpace: cs?.whiteSpace,
        textOverflow: cs?.textOverflow,
        rectCount: headingEl ? headingEl.getClientRects().length : null,
        height: headingEl ? Math.round(headingEl.clientHeight) : null,
        truncated: headingEl ? headingEl.scrollWidth - headingEl.clientWidth > 1 : null,
        wrapped: headingEl ? headingEl.getClientRects().length > 1 || headingEl.clientHeight > 28 : null,
        ariaLabel: aria,
        panelText,
        panelHtml: panelEl?.innerHTML || null,
        fullInHeading: heading.includes(FULL),
        fullInAria: aria.includes(FULL),
        fullInPanel: panelText.includes(FULL),
        fullInTitle: (headingEl?.getAttribute('title') || '').includes(FULL),
      };
    }, FULL);
    await page.screenshot({ path: join(DIR, '307副-八德-panel-390.png'), fullPage: true, animations: 'disabled' });
  }

  await page.setViewportSize({ width: 350, height: 844 });
  await page.waitForTimeout(400);
  if (foundLong) {
    await longRow.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(DIR, '307副-八德-panel-350.png'), fullPage: false, animations: 'disabled' });
  }
  const schoolStops = page.getByRole('button', { name: '學校站牌' });
  if (await schoolStops.count()) await schoolStops.click();
  await page.waitForTimeout(800);
  const layout = await page.evaluate(() => {
    const doc = document.documentElement;
    const stars = [...document.querySelectorAll('button')].filter((el) => {
      const t = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''} ${el.className || ''}`;
      return /收藏|星|★|☆|saveButton|refreshIcon/.test(t);
    }).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        aria: el.getAttribute('aria-label'),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
        ok: r.width >= 44 && r.height >= 44,
      };
    });
    const badges = [...document.querySelectorAll('[class*="routeBadge"]')].map((el) => ({
      text: (el.textContent || '').trim(),
      nowrap: getComputedStyle(el).whiteSpace === 'nowrap',
      wrapped: el.getClientRects().length > 1,
    }));
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      horizontalScroll: Math.max(doc.scrollWidth, document.body.scrollWidth) > doc.clientWidth + 1,
      scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
      stars,
      badgeWraps: badges.filter((b) => b.wrapped || !b.nowrap),
    };
  });
  await page.screenshot({ path: join(DIR, 'school-stops-350.png'), fullPage: true, animations: 'disabled' });

  await browser.close();
  const out = {
    health,
    at: new Date().toISOString(),
    ebus411,
    ebus310,
    ebus907,
    ebus300,
    foundLong,
    panel,
    layout350: layout,
  };
  writeFileSync(join(DIR, 'followup.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    health,
    foundLong,
    fullInAria: panel?.fullInAria,
    fullInPanel: panel?.fullInPanel,
    wrapped: panel?.wrapped,
    truncated: panel?.truncated,
    stars: layout.stars,
    horizontalScroll: layout.horizontalScroll,
    ebus411: ebus411.pu,
    ebus310: ebus310.pu,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
