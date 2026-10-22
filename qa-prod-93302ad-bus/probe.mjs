import { chromium } from '/tmp/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHROME = '/usr/bin/google-chrome-stable';
const BASE = 'https://nuni.tw';
const EXPECTED = '93302ad606d10b8d4097620dc2012e2824d8b3c5';
const GQL = 'https://citybus.taichung.gov.tw/ebus/graphql';
const SEGMENTS = ['往沙鹿', '往市區', '專用道', '往校內'];
const EBUS_ROUTES = [162, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 326, 368, 410, 411, 907];
const EBUS_LABEL = { 410: '310區1', 411: '310區2', 907: '307副' };
const FULL_307 = '八德東大勇路口';
const UNSIGNED = '登入後，這裡會列出近期要處理的課程待辦。';
const UNVERIFIED = '這間店的菜單和價格還沒跟店家核對過，可能跟現場不一樣，目前不能點餐。';
const NEW_EMPTY = '本站還沒接上這間學校的公告。';
const READ_FAIL = '暫時讀不到資料，請稍後再試';
const RETRY = '再試一次';
const CONNECTED_EMPTY = '目前沒有學生日常公告。';
const OLD_SHELF = '這間學校的公告還沒上架。';
const OLD_DOWN = '學校網站暫時連不上，可以先到學校網站看最新消息';
const SCHOOLS = [
  { id: 'pu', name: '靜宜大學' },
  { id: 'ncku', name: '國立成功大學' },
  { id: 'ntpu', name: '國立臺北大學' },
  { id: 'feu', name: '中信科技大學' },
  { id: 'mmc', name: '馬偕醫學大學' },
  { id: 'ntust', name: '國立臺灣科技大學' },
  { id: 'nccu', name: '國立政治大學' },
  { id: 'cycu', name: '中原大學' },
  { id: 'ntu', name: '國立臺灣大學' },
  { id: 'nthu', name: '國立清華大學' },
  { id: 'fju', name: '輔仁大學' },
  { id: 'tmu', name: '臺北醫學大學' },
  { id: 'nchu', name: '國立中興大學' },
  { id: 'tku', name: '淡江大學' },
];

function taipeiNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}
function clockMinutes(hhmm) {
  const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const now = taipeiNow();
  let t = Number(m[1]) * 60 + Number(m[2]);
  const cur = now.getHours() * 60 + now.getMinutes();
  if (t + 12 * 60 < cur) t += 24 * 60;
  return t - cur;
}
function compact(s) {
  return String(s || '').replace(/\s+/g, '');
}

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
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { parseError: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function fetchHealth() {
  const res = await fetch(`${BASE}/health/ready`, { redirect: 'error' });
  return { status: res.status, body: await res.text(), at: new Date().toISOString() };
}

async function fetchEbusBundle() {
  const staticQ = `
    query Q($routeId: Int!, $lang: String!) {
      route(xno: $routeId, lang: $lang) {
        id name description departure destination
        stations { edges { goBack node { id name } } }
      }
    }`;
  const dynQ = `
    query Q($routeId: Int!, $lang: String!) {
      route(xno: $routeId, lang: $lang) {
        estimateTimes {
          edges { node { id sid comeTime goBack isOperationDay etas { isLast busId etaTime } } }
        }
      }
    }`;
  const routes = [];
  for (const routeId of EBUS_ROUTES) {
    const st = await gql(staticQ, { routeId, lang: 'zh' });
    const dy = await gql(dynQ, { routeId, lang: 'zh' });
    const info = st.json?.data?.route;
    const estimates = dy.json?.data?.route?.estimateTimes?.edges || [];
    const byKey = new Map();
    for (const edge of estimates) {
      const n = edge.node;
      byKey.set(`${n.id}:${n.goBack}`, n);
    }
    routes.push({
      routeId,
      label: EBUS_LABEL[routeId] || info?.name || String(routeId),
      departure: info?.departure,
      destination: info?.destination,
      puStops: (info?.stations?.edges || [])
        .filter((e) => /靜宜/.test(e.node?.name || ''))
        .map((e) => ({ goBack: e.goBack, id: e.node.id, name: e.node.name })),
      estimates: estimates.map((e) => e.node),
      byKey,
      at: new Date().toISOString(),
    });
  }
  return routes;
}

async function fetchTdxPu() {
  const url =
    'https://tdx.transportdata.tw/api/basic/v2/Bus/EstimatedTimeOfArrival/City/Taichung' +
    "?$filter=contains(StopName/Zh_tw,'靜宜')&$format=JSON&$top=200";
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const body = await res.text();
  let rows = [];
  try {
    rows = JSON.parse(body);
  } catch {
    rows = [];
  }
  return { status: res.status, count: Array.isArray(rows) ? rows.length : 0, at: new Date().toISOString() };
}

function hitFromRoute(r, stop, gb) {
  const est = r.byKey.get(`${stop.id}:${gb}`);
  const etaMin = est?.etas?.[0]?.etaTime;
  const live = typeof etaMin === 'number';
  return {
    source: 'citybus.taichung.gov.tw/ebus/graphql',
    routeId: r.routeId,
    routeLabel: r.label,
    departure: r.departure,
    destination: r.destination,
    stopId: stop.id,
    stopName: stop.name,
    goBack: gb,
    goBackMeaning: gb === 1 ? `去程（${r.departure}→${r.destination}）` : `返程（朝 ${r.departure}）`,
    comeTime: est?.comeTime || null,
    etaMin: live ? etaMin : null,
    etaBus: est?.etas?.[0]?.busId || null,
    officialText: live ? (etaMin < 2 ? '即將進站／0–1分' : `${etaMin} 分`) : est?.comeTime ? `表定 ${est.comeTime}` : '無即時',
    officialMinutes: live ? etaMin : est?.comeTime ? clockMinutes(est.comeTime) : null,
  };
}

function officialsForRoute(ebusRoutes, routeName, stopHint) {
  const wanted = compact(routeName);
  const candidates = ebusRoutes.filter((r) => {
    const lab = compact(r.label);
    return lab === wanted || lab.startsWith(wanted) || wanted.startsWith(lab);
  });
  const hits = [];
  for (const r of candidates) {
    const stops = r.puStops.filter((s) => {
      if (!stopHint) return true;
      const a = compact(s.name).replace(/[()（）]/g, '');
      const b = compact(stopHint).replace(/[()（）]/g, '');
      return a === b || a.includes(b) || b.includes(a) || /靜宜/.test(s.name);
    });
    const list = stops.length ? stops : r.puStops;
    for (const stop of list) {
      hits.push(hitFromRoute(r, stop, stop.goBack));
    }
  }
  return hits;
}

function headingIntendedGoBack(heading, officialSample) {
  const h = heading || '';
  if (/台中車站|臺中車站/.test(h)) return 1;
  if (/靜宜/.test(h) && !/靜園/.test(h)) return 2;
  if (!officialSample) return null;
  const dest = officialSample.destination || '';
  const dep = officialSample.departure || '';
  const core = h.replace(/^往\s*/, '');
  if (core && dest && (dest.includes(core) || core.includes(dest.replace(/\(.*\)/g, '')))) return 1;
  if (core && dep && (dep.includes(core) || core.includes(dep.replace(/\(.*\)/g, '')))) return 2;
  return null;
}

function nuniMinutes(eta) {
  if (!eta) return { kind: 'missing', minutes: null, text: '' };
  if (eta.kind === 'soon' || eta.text === '進站中') return { kind: 'soon', minutes: 0, text: eta.text };
  if (eta.kind === 'live' && eta.minutes != null) return { kind: 'live', minutes: eta.minutes, text: eta.text };
  if (eta.kind === 'scheduled') return { kind: 'scheduled', minutes: clockMinutes(eta.text.replace('表定', '').trim()), text: eta.text };
  if (eta.kind === 'ended') return { kind: 'ended', minutes: null, text: eta.text };
  if (eta.kind === 'empty') return { kind: 'empty', minutes: null, text: eta.text };
  return { kind: eta.kind, minutes: null, text: eta.text };
}

function liveNuni(row) {
  return row.nuni.kind === 'live' || row.nuni.kind === 'soon';
}

function minuteDiff(a, b) {
  if (a == null || b == null) return null;
  return Math.abs(a - b);
}

function judgeDirectionAware(row, officials) {
  const fails = [];
  if (!officials.length) {
    return { verdict: 'FAIL', fails: ['官方找不到同站同路線'], diff: null, official: null, intendedGoBack: null };
  }
  const intendedGb = headingIntendedGoBack(row.heading, officials[0]);
  const sameStop = (o) => {
    if (!row.stopName) return true;
    const a = compact(o.stopName).replace(/[()（）]/g, '');
    const b = compact(row.stopName).replace(/[()（）]/g, '');
    return a === b || a.includes(b) || b.includes(a) || /靜宜/.test(o.stopName);
  };
  const pool = officials.filter(sameStop);
  const intended = (intendedGb != null ? pool.find((o) => o.goBack === intendedGb) : null) || pool[0] || officials[0];
  const opposite = intendedGb != null ? pool.find((o) => o.goBack !== intendedGb) : pool.find((o) => o.goBack !== intended.goBack);

  if (liveNuni(row)) {
    if (intended.etaMin != null) {
      const diff = minuteDiff(row.nuni.minutes ?? 0, intended.etaMin);
      if (diff != null && diff <= 2) {
        return { verdict: 'PASS', fails, diff, official: intended, intendedGoBack: intendedGb };
      }
    }
    if (opposite?.etaMin != null) {
      const diffOpp = minuteDiff(row.nuni.minutes ?? 0, opposite.etaMin);
      if (diffOpp != null && diffOpp <= 2) {
        fails.push(
          `即時分鐘對上反向（nuni「${row.heading}」${row.nuni.text} 對上 ${opposite.goBackMeaning} ${opposite.officialText}；該向官方是 ${intended.officialText}）。應退表定或改標正確去返程`,
        );
        return { verdict: 'FAIL', fails, diff: diffOpp, official: intended, opposite, intendedGoBack: intendedGb };
      }
    }
    if (intended.etaMin == null) {
      fails.push(`官方此向僅 ${intended.officialText}，nuni 卻顯示即時「${row.nuni.text}」，應退表定`);
      return { verdict: 'FAIL', fails, diff: null, official: intended, intendedGoBack: intendedGb };
    }
    const diff = minuteDiff(row.nuni.minutes ?? 0, intended.etaMin);
    if (diff != null && diff > 2) fails.push(`差 ${diff} 分 > 2`);
    return { verdict: fails.length ? 'FAIL' : 'PASS', fails, diff, official: intended, intendedGoBack: intendedGb };
  }

  if (row.nuni.kind === 'scheduled') {
    return { verdict: 'PASS', fails, diff: null, official: intended, intendedGoBack: intendedGb, note: '表定（方向對不上時的退回）' };
  }
  if (row.nuni.kind === 'ended' && intended.etaMin != null) {
    fails.push('官方有車 nuni 寫今天收班');
    return { verdict: 'FAIL', fails, diff: null, official: intended, intendedGoBack: intendedGb };
  }
  return { verdict: 'PASS', fails, diff: null, official: intended, intendedGoBack: intendedGb };
}

function judge162Inbound(row, officials) {
  const fails = [];
  const yingcai = officials.filter((o) => /英才路/.test(o.stopName) && o.goBack === 2);
  const official = yingcai[0] || officials.find((o) => o.goBack === 2) || officials[0] || null;
  if (!official) return { verdict: 'FAIL', fails: ['官方找不到 162 英才路返程'], diff: null, official: null };
  if (row.stopName && !/英才路/.test(row.stopName)) {
    fails.push(`往校內 162 站名不是英才路（nuni=${row.stopName}）`);
  }
  if (liveNuni(row)) {
    if (official.etaMin == null) {
      fails.push(`官方英才路返程僅 ${official.officialText}，nuni 顯示即時「${row.nuni.text}」，應退表定`);
      return { verdict: 'FAIL', fails, diff: null, official };
    }
    const diff = minuteDiff(row.nuni.minutes ?? 0, official.etaMin);
    if (diff != null && diff > 2) fails.push(`往校內 162 與英才路返程差 ${diff} 分 > 2`);
    return { verdict: fails.length ? 'FAIL' : 'PASS', fails, diff, official };
  }
  if (row.nuni.kind === 'scheduled') {
    return { verdict: fails.length ? 'FAIL' : 'PASS', fails, diff: null, official, note: '表定' };
  }
  return { verdict: fails.length ? 'FAIL' : 'PASS', fails, diff: null, official };
}

function pack(row, j, extra = {}) {
  return {
    segment: extra.segment,
    focus: extra.focus || null,
    stopName: row.stopName,
    route: row.route,
    nuniHeading: row.heading,
    nuniDirection: row.direction,
    nuniText: row.nuni.text,
    nuniKind: row.nuni.kind,
    nuniMinutes: row.nuni.minutes,
    officialStop: j.official?.stopName || null,
    officialRoute: j.official?.routeLabel || null,
    officialDir: j.official?.goBackMeaning || null,
    officialText: j.official?.officialText || null,
    officialMinutes: j.official ? j.official.etaMin ?? j.official.officialMinutes : null,
    intendedGoBack: j.intendedGoBack ?? null,
    oppositeDir: j.opposite?.goBackMeaning || null,
    oppositeText: j.opposite?.officialText || null,
    diff: j.diff,
    verdict: j.verdict,
    fails: j.fails,
    note: j.note || null,
    wrap: row.wrap,
    wait: extra.wait || null,
    ariaLabel: row.ariaLabel || null,
  };
}

async function dumpNuni(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const wait = (
      [...document.querySelectorAll('p,small,span')].map((el) => (el.textContent || '').trim()).find((t) => t.includes('站牌')) || ''
    );
    const rows = [...document.querySelectorAll('[class*="arrivalRow"]')].map((el) => {
      const route = (el.querySelector('[class*="routeBadge"]')?.textContent || '').trim();
      const headingEl = el.querySelector('strong');
      const heading = (headingEl?.textContent || '').trim();
      const etaEl = el.querySelector('[data-kind]');
      const eta = {
        kind: etaEl?.getAttribute('data-kind') || null,
        text: (etaEl?.textContent || '').trim().replace(/\s+/g, ' '),
        minutes: etaEl?.querySelector('[class*="etaNumber"]')
          ? Number((etaEl.querySelector('[class*="etaNumber"]')?.textContent || '').trim())
          : null,
      };
      let wrap = null;
      if (headingEl) {
        const rects = headingEl.getClientRects();
        const cs = getComputedStyle(headingEl);
        wrap = {
          text: heading,
          title: headingEl.getAttribute('title') || null,
          clientWidth: Math.round(headingEl.clientWidth),
          scrollWidth: Math.round(headingEl.scrollWidth),
          clientHeight: Math.round(headingEl.clientHeight),
          lineHeight: cs.lineHeight,
          whiteSpace: cs.whiteSpace,
          textOverflow: cs.textOverflow,
          overflow: cs.overflow,
          wordBreak: cs.wordBreak,
          overflowWrap: cs.overflowWrap,
          rectCount: rects.length,
          truncated: headingEl.scrollWidth - headingEl.clientWidth > 1,
          wrapped: rects.length > 1 || headingEl.clientHeight > 28,
        };
      }
      const badge = el.querySelector('[class*="routeBadge"]');
      const badgeWrap = badge
        ? {
            text: route,
            whiteSpace: getComputedStyle(badge).whiteSpace,
            rectCount: badge.getClientRects().length,
            wrapped: badge.getClientRects().length > 1,
          }
        : null;
      return {
        route,
        heading,
        eta,
        wrap,
        badgeWrap,
        ariaLabel: el.getAttribute('aria-label') || null,
        ariaExpanded: el.getAttribute('aria-expanded'),
        rowText: (el.textContent || '').trim().replace(/\s+/g, ' '),
      };
    });
    return {
      url: location.href,
      wait,
      stamp: (text.match(/讀不到即時資料[^\n]*|\d{1,2}:\d{2} 更新/) || [])[0] || null,
      hasFrom: /從\s*\S/.test(text),
      endpointMissingClosed: text.includes('終點未提供'),
      moreLane: (text.match(/還有\s*\d+\s*班/) || [])[0] || null,
      rows,
    };
  });
}

async function dumpLayout(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const vw = window.innerWidth;
    const overflowing = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.right > vw + 2 && getComputedStyle(el).position !== 'fixed';
    }).slice(0, 12).map((el) => ({
      tag: el.tagName,
      className: String(el.className || '').slice(0, 80),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      right: Math.round(el.getBoundingClientRect().right),
    }));
    const rows = [...document.querySelectorAll('[class*="arrivalRow"]')].map((el) => {
      const badge = el.querySelector('[class*="routeBadge"]');
      const heading = el.querySelector('strong');
      const eta = el.querySelector('[class*="rowEta"], [data-kind]');
      const boxes = [badge, heading, eta].filter(Boolean).map((n) => {
        const r = n.getBoundingClientRect();
        return { t: (n.textContent || '').trim().slice(0, 24), l: r.left, r: r.right, tY: r.top, b: r.bottom };
      });
      const overlap = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const hit = !(a.r <= b.l + 1 || b.r <= a.l + 1 || a.b <= b.tY + 1 || b.b <= a.tY + 1);
          if (hit) overlap.push([a.t, b.t]);
        }
      }
      return {
        route: (badge?.textContent || '').trim(),
        heading: (heading?.textContent || '').trim(),
        badgeNowrap: badge ? getComputedStyle(badge).whiteSpace === 'nowrap' && badge.getClientRects().length === 1 : null,
        headingNowrap: heading ? getComputedStyle(heading).whiteSpace === 'nowrap' : null,
        headingWrapped: heading ? heading.getClientRects().length > 1 || heading.clientHeight > 28 : null,
        overlap,
      };
    });
    const stars = [...document.querySelectorAll('button')].filter((el) => {
      const t = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''} ${el.className || ''}`;
      return /收藏|星|★|☆|saveButton|refreshIcon/.test(t);
    }).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        aria: el.getAttribute('aria-label'),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24),
        className: String(el.className || '').slice(0, 80),
        w: Math.round(r.width),
        h: Math.round(r.height),
        ok: r.width >= 44 && r.height >= 44,
      };
    });
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      clientWidth: doc.clientWidth,
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      horizontalScroll: Math.max(doc.scrollWidth, body.scrollWidth) > doc.clientWidth + 1,
      overflowing,
      rowOverlaps: rows.filter((r) => r.overlap.length),
      badgeWraps: rows.filter((r) => r.badgeNowrap === false),
      headingWraps: rows.filter((r) => r.headingWrapped),
      stars,
      rowCount: rows.length,
    };
  });
}

async function shot(page, dir, name) {
  const path = join(dir, `${name}.png`);
  await page.screenshot({ path, fullPage: true, timeout: 12_000, animations: 'disabled' }).catch(async () => {
    await page.screenshot({ path, fullPage: false, timeout: 5_000, animations: 'disabled' });
  });
  return path;
}

async function expandMore(page) {
  const more = page.locator('summary').filter({ hasText: /還有/ });
  if (await more.count()) await more.first().click().catch(() => {});
  const moreBtn = page.getByRole('button', { name: /還有/ });
  if (await moreBtn.count()) await moreBtn.first().click().catch(() => {});
  await page.waitForTimeout(400);
}

async function open307Panel(page, dir) {
  await expandMore(page);
  const row = page.locator('[class*="arrivalRow"]').filter({ hasText: '307副' }).first();
  const found = (await row.count()) > 0;
  let panel = null;
  if (found) {
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click().catch(() => {});
    await page.waitForTimeout(400);
    panel = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[class*="arrivalRow"]')].find((el) =>
        (el.textContent || '').includes('307副'),
      );
      const wrap = btn?.parentElement;
      const panelEl = wrap?.querySelector('[class*="rowPanel"]');
      const headingEl = btn?.querySelector('strong');
      const heading = (headingEl?.textContent || '').trim();
      const cs = headingEl ? getComputedStyle(headingEl) : null;
      return {
        found: true,
        ariaLabel: btn?.getAttribute('aria-label') || null,
        ariaExpanded: btn?.getAttribute('aria-expanded'),
        heading,
        headingTitle: headingEl?.getAttribute('title') || null,
        headingWhiteSpace: cs?.whiteSpace || null,
        headingTextOverflow: cs?.textOverflow || null,
        headingOverflow: cs?.overflow || null,
        headingRectCount: headingEl ? headingEl.getClientRects().length : null,
        headingHeight: headingEl ? Math.round(headingEl.clientHeight) : null,
        headingTruncated: headingEl ? headingEl.scrollWidth - headingEl.clientWidth > 1 : null,
        headingWrapped: headingEl ? headingEl.getClientRects().length > 1 || headingEl.clientHeight > 28 : null,
        panelText: (panelEl?.textContent || '').trim().replace(/\s+/g, ' '),
        panelHtml: panelEl?.innerHTML || null,
        rowText: (btn?.textContent || '').trim().replace(/\s+/g, ' '),
      };
    });
    await shot(page, dir, 'nuni-307副-panel');
  }
  return { found, panel };
}

function attachStop(row, arrivals) {
  const cands = arrivals.filter((a) => a.route === row.route || String(a.route).startsWith(row.route));
  const byHead = cands.find((a) => {
    const dest = a.destination || '';
    return row.heading && (dest.includes(row.heading.replace(/^往\s*/, '')) || row.heading.includes(dest));
  });
  const a = byHead || cands[0] || null;
  return {
    ...row,
    stopName: a?.stopName || null,
    destination: a?.destination || null,
    direction: a?.direction ?? null,
    seconds: a?.seconds ?? null,
    scheduledAt: a?.scheduledAt || null,
    nuni: nuniMinutes(row.eta),
  };
}

function findRow(rows, pred) {
  return rows.find(pred) || null;
}

async function captureRound(browser, label) {
  const dir = join(ROOT, label);
  mkdirSync(dir, { recursive: true });
  const health = await fetchHealth();
  const context = await browser.newContext({
    locale: 'zh-TW',
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const transit = [];
  const hosts = new Set();
  context.on('request', (req) => {
    try {
      hosts.add(new URL(req.url()).hostname);
    } catch {
      /* ignore */
    }
  });
  context.on('response', async (res) => {
    const req = res.request();
    if (!/nuni\.tw\/api\/transit/.test(req.url())) return;
    if (/api\.nuni\.tw/.test(req.url())) return;
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    transit.push({
      url: req.url(),
      method: req.method(),
      postData: req.postData(),
      status: res.status(),
      fetchedAt: body?.fetchedAt,
      stale: body?.stale === true,
      arrivals: Array.isArray(body?.arrivals) ? body.arrivals : [],
      at: new Date().toISOString(),
    });
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/bus?campus=pu`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(8_000);
  await shot(page, dir, 'nuni-bus-default-390x844');
  const segments = [];
  for (const name of SEGMENTS) {
    const tab = page.getByRole('tab', { name, exact: true });
    if (await tab.count()) {
      await tab.click().catch(() => {});
      await page.waitForTimeout(900);
    }
    await expandMore(page);
    const dump = await dumpNuni(page);
    await shot(page, dir, `nuni-${name}-390x844`);
    segments.push({ name, ...dump });
  }

  const laneTab = page.getByRole('tab', { name: '專用道', exact: true });
  if (await laneTab.count()) await laneTab.click().catch(() => {});
  await page.waitForTimeout(500);
  await expandMore(page);
  const panel307 = await open307Panel(page, dir);

  const arrivals = transit[0]?.arrivals || transit.at(-1)?.arrivals || [];
  const ebus = await fetchEbusBundle();
  const tdx = await fetchTdxPu();
  const comparisons = [];
  const focus = [];
  const spot = [];

  for (const seg of segments) {
    const detailed = (seg.rows || []).map((r) => attachStop(r, arrivals));
    for (const row of detailed) {
      const officials = officialsForRoute(ebus, row.route, row.stopName);
      let j;
      if (seg.name === '往校內' && row.route === '162') j = judge162Inbound(row, officials);
      else j = judgeDirectionAware(row, officials);
      const packed = pack(row, j, { segment: seg.name, wait: seg.wait });
      comparisons.push(packed);
    }
  }

  const laneRows = (segments.find((s) => s.name === '專用道')?.rows || []).map((r) => attachStop(r, arrivals));
  const inboundRows = (segments.find((s) => s.name === '往校內')?.rows || []).map((r) => attachStop(r, arrivals));

  const row300 = findRow(laneRows, (r) => r.route === '300');
  if (row300) {
    const officials = officialsForRoute(ebus, '300', row300.stopName || '靜宜大學(專用道)');
    focus.push(pack(row300, judgeDirectionAware(row300, officials), { segment: '專用道', focus: '300-direction', wait: segments.find((s) => s.name === '專用道')?.wait }));
  } else {
    focus.push({ focus: '300-direction', segment: '專用道', verdict: 'FAIL', fails: ['專用道展開後仍沒有 300'], nuniHeading: null });
  }

  const row162 = findRow(inboundRows, (r) => r.route === '162');
  if (row162) {
    const officials = officialsForRoute(ebus, '162', row162.stopName || '靜宜大學(英才路)');
    focus.push(pack(row162, judge162Inbound(row162, officials), { segment: '往校內', focus: '162-inbound', wait: segments.find((s) => s.name === '往校內')?.wait }));
  } else {
    focus.push({ focus: '162-inbound', segment: '往校內', verdict: 'FAIL', fails: ['往校內沒有 162'], nuniHeading: null });
  }

  const row307 = findRow(laneRows, (r) => r.route === '307副' || r.route.startsWith('307'));
  const wrapOk = row307 && row307.wrap && row307.wrap.wrapped === false && row307.wrap.whiteSpace === 'nowrap';
  const headingSingle = row307 ? /^往\s+\S/.test(row307.heading) && !row307.heading.includes('\n') : false;
  const panelText = panel307.panel?.panelText || '';
  const aria = panel307.panel?.ariaLabel || row307?.ariaLabel || '';
  const ellipsisOk = row307?.wrap?.textOverflow === 'ellipsis' || /…|\.\.\.$/.test(row307?.heading || '') || row307?.wrap?.truncated;
  const fullInPanel = panelText.includes(FULL_307);
  const fullInAria = aria.includes(FULL_307);
  const headingHasFull = (row307?.heading || '').includes(FULL_307) || (row307?.wrap?.title || '').includes(FULL_307);
  const v307fails = [];
  if (!row307) v307fails.push('專用道沒有 307副');
  if (row307?.wrap?.wrapped) v307fails.push('307副「往 ○○」折行');
  if (row307 && row307.wrap?.whiteSpace !== 'nowrap') v307fails.push(`white-space=${row307.wrap?.whiteSpace}`);
  if (row307 && !headingSingle) v307fails.push(`heading 不是單行「往 ○○」：${row307.heading}`);
  if (row307 && (row307.heading.length >= 10 || (row307.wrap?.scrollWidth || 0) > (row307.wrap?.clientWidth || 0)) && !ellipsisOk && row307.wrap?.truncated === false && !/…/.test(row307.heading)) {
    // long heading without visual ellipsis is only fail if it wrapped; already counted
  }
  if (!fullInPanel) v307fails.push(`面板沒有完整站名（panel=${panelText || '無'}）`);
  if (!fullInAria) v307fails.push(`aria-label 沒有完整站名（aria=${aria || '無'}）`);
  focus.push({
    focus: '307-ellipsis-panel',
    segment: '專用道',
    route: row307?.route || null,
    nuniHeading: row307?.heading || null,
    wrap: row307?.wrap || null,
    headingSingle,
    wrapOk,
    ellipsisOk,
    panel: panel307.panel,
    fullInPanel,
    fullInAria,
    headingHasFull,
    verdict: v307fails.length ? 'FAIL' : 'PASS',
    fails: v307fails,
  });

  for (const route of ['306', '302', '310區2']) {
    const row = findRow(laneRows, (r) => r.route === route || r.route.replace(/\s+/g, '') === route);
    if (!row) {
      spot.push({ focus: `spot-${route}`, segment: '專用道', route, verdict: 'FAIL', fails: [`專用道展開後沒有 ${route}`] });
      continue;
    }
    const officials = officialsForRoute(ebus, route, row.stopName || '靜宜大學(專用道)');
    const j = judgeDirectionAware(row, officials);
    const extraFails = [...j.fails];
    if (!liveNuni(row) && (officials.some((o) => o.etaMin != null))) {
      extraFails.push(`${route} 官方有即時但 nuni 已退表定／非即時（${row.nuni.text}）`);
      j.verdict = 'FAIL';
      j.fails = extraFails;
    }
    spot.push(pack(row, j, { segment: '專用道', focus: `spot-${route}` }));
  }

  const off = await context.newPage();
  for (const [route, goback] of [
    [162, 1],
    [162, 2],
    [300, 1],
    [300, 2],
    [302, 1],
    [306, 1],
    [411, 1],
    [907, 1],
  ]) {
    const url = `https://citybus-free.taichung.gov.tw/driving-map?route=${route}${goback === 2 ? '&goback=2' : ''}`;
    await off.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await off.waitForTimeout(1_800);
    const tag = EBUS_LABEL[route] || String(route);
    await shot(off, dir, `official-${tag}-goback${goback}`);
  }

  let layout350 = null;
  if (label === 'round1') {
    await page.setViewportSize({ width: 350, height: 844 });
    await page.waitForTimeout(600);
    const tab = page.getByRole('tab', { name: '專用道', exact: true });
    if (await tab.count()) await tab.click().catch(() => {});
    await expandMore(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    layout350 = {
      busTop: await dumpLayout(page),
    };
    await shot(page, dir, 'nuni-專用道-350');
    const shaTab = page.getByRole('tab', { name: '往沙鹿', exact: true });
    if (await shaTab.count()) await shaTab.click().catch(() => {});
    await page.waitForTimeout(400);
    layout350.往沙鹿 = await dumpLayout(page);
    await shot(page, dir, 'nuni-往沙鹿-350');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    layout350.scrolledExplorer = await dumpLayout(page);
    await shot(page, dir, 'nuni-bus-bottom-350');
    const inbound = page.getByRole('tab', { name: '往校內', exact: true });
    if (await inbound.count()) await inbound.click().catch(() => {});
    await page.waitForTimeout(400);
    layout350.往校內 = await dumpLayout(page);
    await shot(page, dir, 'nuni-往校內-350');
    await page.setViewportSize({ width: 390, height: 844 });
  }

  await context.close();
  const payload = {
    label,
    health,
    capturedAt: new Date().toISOString(),
    taipei: taipeiNow().toISOString(),
    hitApiNuni: [...hosts].some((h) => h === 'api.nuni.tw'),
    hosts: [...hosts].filter((h) => /nuni|citybus|tdx|transportdata/.test(h)),
    transitMeta: transit.map((t) => ({
      url: t.url,
      method: t.method,
      status: t.status,
      fetchedAt: t.fetchedAt,
      stale: t.stale,
      arrivalCount: t.arrivals.length,
      at: t.at,
    })),
    segments,
    focus,
    spot,
    comparisons,
    panel307,
    layout350,
    wrapStill: comparisons.filter((c) => c.wrap?.wrapped).map((c) => ({ segment: c.segment, heading: c.nuniHeading, route: c.route, ...c.wrap })),
    ebusAt: ebus[0]?.at,
    ebusRoutes: ebus.map((r) => ({ routeId: r.routeId, label: r.label, departure: r.departure, destination: r.destination, puStops: r.puStops })),
    tdx,
    failFocus: focus.filter((c) => c.verdict === 'FAIL').length,
    failSpot: spot.filter((c) => c.verdict === 'FAIL').length,
  };
  writeFileSync(join(dir, 'round.json'), JSON.stringify(payload, null, 2));
  return payload;
}

async function dumpAnnouncements(page) {
  return page.evaluate(({ NEW_EMPTY, OLD_SHELF, OLD_DOWN, READ_FAIL, CONNECTED_EMPTY, RETRY }) => {
    const text = document.body?.innerText || '';
    const statusH2 = [...document.querySelectorAll('section h2, h2')].map((el) =>
      (el.textContent || '').trim().replace(/\s+/g, ' '),
    );
    const articles = [...document.querySelectorAll('article')];
    const listed = text.match(/最近\s*(\d+)\s*則/);
    const buttons = [...document.querySelectorAll('button')].map((el) => (el.textContent || '').trim().replace(/\s+/g, ' '));
    return {
      listedCount: listed ? Number(listed[1]) : null,
      articleCount: articles.length,
      emptyLine:
        statusH2.find((t) => [NEW_EMPTY, OLD_SHELF, OLD_DOWN, READ_FAIL, CONNECTED_EMPTY, '沒有符合條件的公告'].includes(t)) || null,
      hasOldShelf: text.includes(OLD_SHELF),
      hasOldDownLong: text.includes(OLD_DOWN),
      hasReadFail: text.includes(READ_FAIL),
      hasNewEmpty: text.includes(NEW_EMPTY),
      hasConnectedEmpty: text.includes(CONNECTED_EMPTY),
      hasRetry: buttons.includes(RETRY),
      snippet: text.slice(0, 700),
    };
  }, { NEW_EMPTY, OLD_SHELF, OLD_DOWN, READ_FAIL, CONNECTED_EMPTY, RETRY });
}

async function captureRegression(browser) {
  const dir = join(ROOT, 'regression');
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    locale: 'zh-TW',
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: true,
  });
  const requests = [];
  context.on('request', (req) => {
    requests.push({ method: req.method(), url: req.url().slice(0, 220) });
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(6_000);
  const home = await page.evaluate(({ UNSIGNED }) => {
    const text = document.body?.innerText || '';
    return {
      url: location.href,
      hasUnsignedText: text.includes(UNSIGNED),
      unsignedSentence: (text.match(/登入後，這裡會列出近期要處理的課程待辦。/) || [])[0] || null,
      snippet: text.slice(0, 1600),
    };
  }, { UNSIGNED });
  await shot(page, dir, 'home');

  await page.goto(`${BASE}/cafeteria?campus=pu`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(6_000);
  const cafeText = await page.locator('body').innerText();
  await shot(page, dir, 'cafeteria-pu');
  const shopHref = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/cafeteria/"]')].find((el) => /\/cafeteria\/[^/?]+/.test(el.href));
    return a?.href || null;
  });
  let shop = null;
  if (shopHref) {
    await page.goto(shopHref, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(4_000);
    const t = await page.locator('body').innerText();
    await shot(page, dir, 'cafeteria-shop-1');
    shop = {
      href: shopHref,
      hasExactUnverified: t.includes(UNVERIFIED),
      unverifiedSentence: (t.match(/這間店的菜單和價格還沒跟店家核對過[^\n]*。/) || [])[0] || null,
      hasAvailable: t.includes('供應中'),
      snippet: t.slice(0, 800),
    };
  }

  const schools = [];
  for (const school of SCHOOLS) {
    await page.goto(`${BASE}/announcements?campus=${school.id}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(8_000);
    const student = await dumpAnnouncements(page);
    await shot(page, dir, `announcements-${school.id}`);
    let all = null;
    const allBtn = page.getByRole('button', { name: '全部公告' });
    if (await allBtn.count()) {
      await allBtn.click().catch(() => {});
      await page.waitForTimeout(800);
      all = await dumpAnnouncements(page);
      await shot(page, dir, `announcements-${school.id}-all`);
    }
    let afterRetry = null;
    if (student.hasRetry && (school.id === 'cycu' || school.id === 'tmu')) {
      const retry = page.getByRole('button', { name: RETRY });
      if (await retry.count()) {
        await retry.click().catch(() => {});
        await page.waitForTimeout(8_000);
        afterRetry = await dumpAnnouncements(page);
        await shot(page, dir, `announcements-${school.id}-retry`);
      }
    }
    schools.push({ id: school.id, expectedName: school.name, student, all, afterRetry });
    console.log('ANN', school.id, student.emptyLine || `articles=${student.articleCount}`, 'retry', student.hasRetry);
  }

  await context.close();
  const payload = {
    home,
    cafeteria: {
      listHasOrderingOff: cafeText.includes('目前還不能線上點餐'),
      listHasUnverified: cafeText.includes('未核對'),
      listHasAvailable: cafeText.includes('供應中'),
      shop,
      snippet: cafeText.slice(0, 800),
    },
    schools,
    hitApiNuni: requests.some((r) => /api\.nuni\.tw/.test(r.url)),
    foodOrImportWrites: requests.filter(
      (r) => r.method !== 'GET' && /nuni\.tw\/v1\/food|nuni\.tw\/.*orders|nuni\.tw\/.*quotes|nuni\.tw\/.*import/.test(r.url),
    ),
  };
  writeFileSync(join(dir, 'regression.json'), JSON.stringify(payload, null, 2));
  return payload;
}

async function main() {
  mkdirSync(ROOT, { recursive: true });
  const health0 = await fetchHealth();
  writeFileSync(join(ROOT, 'health.body'), health0.body + '\n');
  if (!health0.body.includes(EXPECTED)) {
    writeFileSync(join(ROOT, 'ABORT.json'), JSON.stringify({ health0, expected: EXPECTED }, null, 2));
    console.error('ABORT health mismatch', health0.body);
  }
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const round1 = await captureRound(browser, 'round1');
  console.log('ROUND1 focusFails', round1.failFocus, 'spotFails', round1.failSpot, 'health', round1.health.body);
  console.log('sleep 10 minutes');
  await new Promise((r) => setTimeout(r, 10 * 60 * 1000));
  const round2 = await captureRound(browser, 'round2');
  console.log('ROUND2 focusFails', round2.failFocus, 'spotFails', round2.failSpot, 'health', round2.health.body);
  const regression = await captureRegression(browser);
  await browser.close();
  const healthEnd = await fetchHealth();
  const summary = {
    expected: EXPECTED,
    health0,
    healthEnd,
    hitApiNuni: round1.hitApiNuni || round2.hitApiNuni || regression.hitApiNuni,
    round1: {
      at: round1.capturedAt,
      taipei: round1.taipei,
      focus: round1.focus,
      spot: round1.spot,
      wrapStill: round1.wrapStill,
      layout350: round1.layout350,
      panel307: round1.panel307,
      failFocus: round1.failFocus,
      failSpot: round1.failSpot,
    },
    round2: {
      at: round2.capturedAt,
      taipei: round2.taipei,
      focus: round2.focus,
      spot: round2.spot,
      wrapStill: round2.wrapStill,
      panel307: round2.panel307,
      failFocus: round2.failFocus,
      failSpot: round2.failSpot,
    },
    regression: {
      unsigned: regression.home.unsignedSentence,
      cafeteriaOff: regression.cafeteria.listHasOrderingOff,
      unverified: regression.cafeteria.shop?.unverifiedSentence || null,
      schools: regression.schools.map((s) => ({
        id: s.id,
        empty: s.student.emptyLine,
        articles: s.student.articleCount,
        listed: s.student.listedCount,
        retry: s.student.hasRetry,
        oldShelf: s.student.hasOldShelf,
        oldDown: s.student.hasOldDownLong,
        afterRetry: s.afterRetry?.emptyLine || null,
      })),
    },
  };
  writeFileSync(join(ROOT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('DONE', JSON.stringify({ health0: health0.body, healthEnd: healthEnd.body, r1: round1.failFocus, r2: round2.failFocus }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
