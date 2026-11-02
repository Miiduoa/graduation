import assert from 'node:assert/strict';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';
import { build } from 'esbuild';

// Run from the repository root. All account/course data is synthetic. Only the
// local fixture server is reachable; no school, Firebase, or production requests.
const root = process.cwd();
const web = path.join(root, 'apps/web');
const output = path.resolve(process.env.TODAY_BROWSER_OUTPUT || '/tmp/today-browser-evidence');
const fixture = await mkdtemp(path.join(os.tmpdir(), 'today-deadlines-fixture-'));
const dist = path.join(fixture, 'dist');
const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const require = createRequire(import.meta.url);
const report = {
  checksumFormat: 'sha256:<lowercase-hex>',
  generatedAt: new Date().toISOString(),
  sourceHead:
    process.env.SOURCE_HEAD_SHA ||
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scriptHash: hash(await readFile(new URL(import.meta.url))),
  sourceFiles: {},
  checks: [],
  screenshots: [],
  errors: [],
  blockedRequests: [],
  limitations: [
    'Actual StudentToday component, production CSS, and shared date/navigation helpers; synthetic props only.',
    'Next Link is an anchor stub. Unused personal-import hooks throw if called.',
    'Clock updates are delivered through the real component props; the app foreground timer and live authentication require separate integration coverage.',
    '200% text means a 200% root font size. Chromium is covered; native mobile screens and Safari are not.',
  ],
};
let browser;
let server;
await mkdir(output, { recursive: true });

function check(name, passed, details) {
  report.checks.push({ name, passed: !!passed, ...(details === undefined ? {} : { details }) });
}

try {
  await writeFile(
    path.join(fixture, 'hooks.ts'),
    `
export function usePersonalImportScope(){throw new Error('Unused fixture hook was called');}
export function usePersonalTodayRecords(){throw new Error('Unused fixture hook was called');}
`,
  );
  await writeFile(
    path.join(fixture, 'link.tsx'),
    `
import React from 'react';
export default function Link({children,prefetch,replace,scroll,...props}){return <a {...props}>{children}</a>;}
`,
  );
  const componentPath = path.join(web, 'src/components/today/StudentToday.tsx');
  const stylesheetPath = path.join(web, 'src/app/globals.css');
  const fontStylesheet = process.env.TODAY_FONT_CSS;
  if (fontStylesheet)
    report.fixtureFontStylesheet = {
      path: fontStylesheet,
      sha256: hash(await readFile(fontStylesheet)),
    };
  await writeFile(
    path.join(fixture, 'entry.tsx'),
    `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { StudentToday } from ${JSON.stringify(componentPath)};
import ${JSON.stringify(stylesheetPath)};
${fontStylesheet ? `import ${JSON.stringify(fontStylesheet)};` : ''}
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.style.fontSize = params.get('text') === '200' ? '200%' : '100%';
const midnight = new Date('2026-12-31T23:50:00+08:00');
const task = (id,title,dueAt,extra={}) => ({id,title,courseName:'資訊管理專題：跨校資料整合、資訊倫理與應用實作',courseId:'fixture-course',dueAt:dueAt === null ? null : Date.parse(dueAt),href:'/course/fixture-course#assignment-' + id,...extra});
const longTitle = '資訊管理專題成果與跨校課程資料整合：AccessibilityAndCrossCampusDeadlineReview2027';
const tomorrow = task('tomorrow',longTitle,'2027-01-01T00:10:00+08:00');
const base = {
  scopeKey:'fixture-student-a:pu',now:midnight,updatedAt:midnight,unsigned:false,skeleton:false,
  classes:[{id:'class-a',title:'資訊倫理與資料視覺化：跨校整合專題成果工作坊',location:'管理大樓 M302',startAt:Date.parse('2026-12-31T08:10:00+08:00'),endAt:Date.parse('2026-12-31T10:00:00+08:00'),courseId:'fixture-course'}],
  todos:[tomorrow,task('overdue','資料庫系統作業：等待補交確認','2026-12-30T23:59:00+08:00'),task('future','跨年後的學期報告','2027-01-03T18:30:00+08:00'),task('unset','尚未公布期限的成果附件',null)],
  timetableStatus:'ready',todosError:'',lmsUnconnected:false,onRetryTimetable:()=>{},onRetryTodos:()=>{},
  importHref:'/import?kind=timetable&campus=pu',weekHref:'/timetable?campus=pu',timetableHref:'/timetable?campus=pu'
};
const cases = {
  overview:{},
  tomorrow:{classes:[],todos:[tomorrow]},
  imminent:{classes:[],now:new Date('2026-12-31T23:59:00+08:00'),todos:[task('imminent','即將截止的資料庫練習','2026-12-31T23:59:30+08:00')]},
  hours:{classes:[],todos:[task('hours','跨夜的專題報告','2027-01-01T01:10:00+08:00')]},
  future:{classes:[],todos:[task('future','跨年後的學期報告','2027-01-03T18:30:00+08:00')]},
  overdue:{classes:[],now:new Date('2027-01-01T00:11:00+08:00'),todos:[tomorrow]},
  oldOverdue:{classes:[],now:new Date('2027-01-03T00:11:00+08:00'),todos:[tomorrow]},
  platform:{classes:[],todos:[task('original','平台作業原始入口','2027-01-01T00:10:00+08:00',{courseId:'cw_00000000-0000-0000-0000-000000000001',href:'/classroom/course/cw_00000000-0000-0000-0000-000000000001#assignment-original'})]},
};
const reactRoot=createRoot(document.getElementById('root'));
let current;
function render(name='overview',patch={}){
  if (!(name in cases)) throw new Error('Unknown synthetic case');
  current={...base,...cases[name],...patch};
  flushSync(()=>reactRoot.render(<StudentToday {...current}/>));
}
window.__todayFixture={
  render,
  setNow(instant){current={...current,now:new Date(instant)};flushSync(()=>reactRoot.render(<StudentToday {...current}/>));},
  switchScope(){
    render('overview',{scopeKey:'fixture-student-b:nthu',classes:[],todos:[1,2,3,4].map(i=>task('b-'+i,'乙同學專屬作業 '+i,'2027-01-01T00:1'+i+':00+08:00',{courseName:'乙同學的課程',href:'/course/only-b#assignment-b-'+i}))});
  },
};
render();
window.__todayFixture.ready=true;
`,
  );

  await build({
    absWorkingDir: root,
    entryPoints: [path.join(fixture, 'entry.tsx')],
    outdir: dist,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    nodePaths: [path.join(root, 'node_modules'), path.join(web, 'node_modules')],
    alias: {
      '@/lib/usePersonalImports': path.join(fixture, 'hooks.ts'),
      '@/lib/usePersonalTodayRecords': path.join(fixture, 'hooks.ts'),
      'next/link': path.join(fixture, 'link.tsx'),
      '@': path.join(web, 'src'),
      '@campus/shared': path.join(root, 'packages/shared'),
    },
    loader: {
      '.module.css': 'local-css',
      '.png': 'dataurl',
      '.svg': 'dataurl',
      '.woff2': 'dataurl',
      '.woff': 'dataurl',
    },
    plugins: [
      {
        name: 'record-compiled-source',
        setup(buildContext) {
          buildContext.onLoad({ filter: /\.(tsx?|css)$/ }, async ({ path: filename }) => {
            if (
              !filename.startsWith(root + path.sep) ||
              filename.includes(`${path.sep}node_modules${path.sep}`)
            )
              return;
            const contents = await readFile(filename);
            report.sourceFiles[path.relative(root, filename)] = hash(contents);
            const loader = filename.endsWith('.module.css')
              ? 'local-css'
              : path.extname(filename).slice(1);
            return { contents, loader, resolveDir: path.dirname(filename) };
          });
        },
      },
    ],
  });
  report.bundleHashes = {
    js: hash(await readFile(path.join(dist, 'entry.js'))),
    css: hash(await readFile(path.join(dist, 'entry.css'))),
  };
  await writeFile(
    path.join(dist, 'index.html'),
    `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Today deadline component verification</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/entry.css"><style>body{margin:0;background:var(--bg)}main{max-width:1080px;margin:auto;padding:16px}.fixture-note{font-size:.7rem;color:var(--muted);margin:0 0 16px}</style></head><body><main><p class="fixture-note">元件驗收 · 合成課程與作業</p><div id="root"></div></main><script type="module" src="/entry.js"></script></body></html>`,
  );
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const resolved = path.resolve(dist, filename);
      if (!resolved.startsWith(dist + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const bytes = await readFile(resolved);
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
      );
      res.setHeader(
        'Content-Type',
        resolved.endsWith('.js')
          ? 'text/javascript'
          : resolved.endsWith('.css')
            ? 'text/css'
            : 'text/html; charset=utf-8',
      );
      res.end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let playwright;
  if (process.env.PLAYWRIGHT_MODULE_PATH) playwright = require(process.env.PLAYWRIGHT_MODULE_PATH);
  else {
    try {
      playwright = require('playwright');
    } catch {
      const runtime =
        process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ||
        '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
      playwright = await import(pathToFileURL(path.join(runtime, 'playwright/index.mjs')).href);
    }
  }
  browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: [
      '--no-sandbox',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ],
  });
  report.browserVersion = browser.version();
  const context = await browser.newContext({ timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) await route.continue();
    else {
      report.blockedRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    }
  });
  await context.routeWebSocket('**/*', (socket) => {
    report.blockedRequests.push(socket.url());
    socket.close();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text());
  });
  const load = async (width = 390, theme = 'light', textSize = 100) => {
    await page.setViewportSize({ width, height: width >= 1000 ? 1000 : 844 });
    await page.goto(`${origin}/?theme=${theme}&text=${textSize}`);
    await page.waitForSelector('[data-testid="student-today"]');
    await page.waitForFunction(() => globalThis.__todayFixture?.ready);
    await page.evaluate(() => globalThis.document.fonts.ready);
  };
  const render = async (name, patch = {}) => {
    await page.evaluate(({ name, patch }) => globalThis.__todayFixture.render(name, patch), {
      name,
      patch,
    });
    await page.waitForFunction(
      () =>
        !globalThis.document
          .querySelector('[data-testid="next-action"]')
          ?.className.includes('fadeOut'),
    );
  };
  const actionText = () => page.getByTestId('next-action').innerText();

  for (const width of [320, 390, 1440]) {
    for (const theme of ['light', 'dark']) {
      for (const textSize of [100, 200]) {
        await load(width, theme, textSize);
        const label = `${width}-${theme}-${textSize}%`;
        const layout = await page.evaluate(() => {
          const { innerWidth, document, getComputedStyle } = globalThis;
          return {
            viewport: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            textSize: getComputedStyle(document.documentElement).fontSize,
            theme: document.documentElement.dataset.theme,
            overflow: [...document.querySelectorAll('[data-testid="student-today"] *')]
              .flatMap((el) => {
                const r = el.getBoundingClientRect();
                return r.width && (r.right > innerWidth + 1 || r.left < -1)
                  ? [
                      {
                        selector: el.tagName.toLowerCase() + '.' + [...el.classList].join('.'),
                        text: el.textContent.slice(0, 120),
                        x: r.x,
                        right: r.right,
                      },
                    ]
                  : [];
              })
              .slice(0, 8),
          };
        });
        check(
          `${label}: no horizontal overflow with long course and task names`,
          layout.scrollWidth <= width + 1,
          layout,
        );
        check(
          `${label}: tomorrow is not labelled today`,
          (await actionText()).includes('明天截止') && !(await actionText()).includes('今天截止'),
        );
        const targets = await page
          .getByTestId('student-today')
          .locator('a,button')
          .evaluateAll((els) =>
            els
              .filter((el) => el.checkVisibility())
              .map((el) => ({
                text: el.textContent.trim(),
                height: el.getBoundingClientRect().height,
              })),
          );
        check(
          `${label}: actionable targets are at least 44px high`,
          targets.every((target) => target.height >= 43.5),
          targets,
        );
        if (
          (width === 390 && theme === 'light' && textSize === 100) ||
          (width === 320 && theme === 'dark' && textSize === 200)
        ) {
          const filename = `${width}-${theme}-${textSize}pct.png`;
          await page.screenshot({ path: path.join(output, filename), fullPage: true });
          report.screenshots.push(filename);
        }
      }
    }
  }

  await load();
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const { document, getComputedStyle } = globalThis;
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      shadow: style.boxShadow,
    };
  });
  check(
    'keyboard Tab reaches an action with a visible focus indicator',
    focused.tag === 'A' &&
      focused.focusVisible &&
      ((focused.outlineStyle !== 'none' && parseFloat(focused.outlineWidth) > 0) ||
        focused.shadow !== 'none'),
    focused,
  );
  const more = page.getByRole('button', { name: '還有 1 件', exact: true });
  for (
    let i = 0;
    i < 20 && !(await more.evaluate((el) => el === globalThis.document.activeElement));
    i++
  )
    await page.keyboard.press('Tab');
  check(
    'keyboard can reach the additional tasks control',
    await more.evaluate((el) => el === globalThis.document.activeElement),
  );
  await page.keyboard.press('Enter');
  check(
    'Enter expands tasks and updates aria-expanded',
    (await page
      .getByRole('button', { name: '收起待辦', exact: true })
      .getAttribute('aria-expanded')) === 'true' &&
      (await page.getByTestId('today-work-list').locator('a').count()) === 4,
  );

  const switched = await page.evaluate(() => {
    const { document } = globalThis;
    globalThis.__todayFixture.switchScope();
    return {
      text: document.querySelector('[data-testid="student-today"]').textContent,
      items: document.querySelectorAll('[data-testid="today-work-list"] a').length,
      expanded: document
        .querySelector('button[aria-controls="today-work-items"]')
        ?.getAttribute('aria-expanded'),
    };
  });
  check(
    'scope change immediately removes prior account content and resets expanded state',
    !switched.text.includes('AccessibilityAndCrossCampusDeadlineReview2027') &&
      !switched.text.includes('尚未公布期限的成果附件') &&
      switched.text.includes('乙同學專屬作業 1') &&
      switched.items === 3 &&
      switched.expanded === 'false',
    switched,
  );

  await load();
  await render('tomorrow');
  check(
    'year-crossing midnight deadline includes tomorrow and 20 remaining minutes',
    (await actionText()).includes('明天 00:10 截止・還剩 20 分鐘'),
  );
  check(
    'school task submission retains the original assignment anchor',
    (await page.getByRole('link', { name: '去繳交', exact: true }).getAttribute('href')) ===
      '/course/fixture-course#assignment-tomorrow-submit',
  );
  await page.evaluate(() => globalThis.__todayFixture.setNow('2027-01-01T00:01:00+08:00'));
  check(
    'same task updates at Taipei midnight without remounting the page',
    (await actionText()).includes('今天截止') &&
      (await actionText()).includes('今天 00:10 截止・還剩 9 分鐘') &&
      !(await actionText()).includes('明天截止'),
  );
  await render('imminent');
  check(
    'sub-minute deadline is not rounded up to one hour',
    (await actionText()).includes('不到 1 分鐘') && !(await actionText()).includes('還剩 1 小時'),
  );
  await render('hours');
  check(
    'hours and remaining minutes are preserved',
    (await actionText()).includes('明天 01:10 截止・還剩 1 小時 20 分鐘'),
  );
  await render('future');
  check(
    'future deadline includes its cross-year date and weekday',
    (await actionText()).includes('2027/1/3 週日 18:30 截止') &&
      !(await actionText()).includes('今天截止'),
  );
  await render('overdue');
  check(
    'past deadline is labelled overdue without a future countdown',
    (await actionText()).includes('已逾期') && !(await actionText()).includes('還剩'),
  );
  await render('oldOverdue');
  check(
    'overdue duration remains explicit for older assignments',
    (await actionText()).includes('已逾期 2 天'),
  );
  await render('platform');
  const platformHref =
    '/classroom/course/cw_00000000-0000-0000-0000-000000000001#assignment-original';
  check(
    'platform assignment retains its original detail and submission href',
    (await page.getByRole('link', { name: '去繳交', exact: true }).getAttribute('href')) ===
      platformHref &&
      (await page.getByTestId('next-action').locator('a').first().getAttribute('href')) ===
        platformHref,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await render('imminent');
  const motion = await page.getByTestId('next-action').evaluate((el) => ({
    duration: globalThis.getComputedStyle(el).transitionDuration,
    opacity: globalThis.getComputedStyle(el).opacity,
  }));
  check(
    'reduced motion reduces the task-card fade to at most 1ms',
    motion.duration.split(',').every((duration) => parseFloat(duration) <= 0.001) &&
      motion.opacity === '1',
    motion,
  );

  check(
    'no external HTTP or WebSocket request was attempted',
    report.blockedRequests.length === 0,
    report.blockedRequests,
  );
  check('no uncaught browser error or console error', report.errors.length === 0, [
    ...report.errors,
  ]);
  const changedSources = [];
  for (const [filename, compiledHash] of Object.entries(report.sourceFiles)) {
    if (hash(await readFile(path.join(root, filename))) !== compiledHash)
      changedSources.push(filename);
  }
  check(
    'tested source files did not change during verification',
    changedSources.length === 0,
    changedSources,
  );
  assert.ok(
    report.sourceFiles['apps/web/src/components/today/StudentToday.tsx'],
    'Actual StudentToday source was not bundled',
  );
  assert.ok(
    report.sourceFiles['apps/web/src/components/today/StudentToday.module.css'],
    'Actual StudentToday stylesheet was not bundled',
  );
  assert.ok(
    report.sourceFiles['apps/web/src/app/globals.css'],
    'Actual global stylesheet was not bundled',
  );
} catch (error) {
  report.errors.push(error instanceof Error ? error.stack : String(error));
} finally {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await rm(fixture, { recursive: true, force: true });
  report.summary = {
    passed: report.checks.filter((c) => c.passed).length,
    failed: report.checks.filter((c) => !c.passed).length,
    errors: report.errors.length,
  };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const evidenceFiles = ['report.json', ...report.screenshots];
  const evidenceHashes = {};
  for (const filename of evidenceFiles)
    evidenceHashes[filename] = hash(await readFile(path.join(output, filename)));
  await writeFile(
    path.join(output, 'manifest.json'),
    JSON.stringify(
      {
        checksumFormat: report.checksumFormat,
        generatedAt: report.generatedAt,
        sourceHead: report.sourceHead,
        scriptHash: report.scriptHash,
        sourceFiles: report.sourceFiles,
        bundleHashes: report.bundleHashes,
        evidenceHashes,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      ...report.summary,
      report: path.join(output, 'report.json'),
      screenshots: report.screenshots,
    }),
  );
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
