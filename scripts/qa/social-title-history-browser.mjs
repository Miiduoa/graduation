import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

// No production account, bucket or search database is used by this fixture.
const root = process.cwd();
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
assert.match(host, /^(127\.0\.0\.1|localhost):[0-9]{1,5}$/, 'Only a local Firestore emulator is allowed');
const projectId = 'demo-campus-title-search';
if (process.env.GCLOUD_PROJECT) assert.equal(process.env.GCLOUD_PROJECT, projectId);
const [hostname, port] = host.split(':');
const web = path.join(root, 'apps/web');
const fixture = path.join(web, '.title-history-browser-fixture');
const output = path.join(root, 'artifacts/campus-title-history');
const dist = path.join(fixture, 'dist');
const report = {
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  boundary: 'Real product component, service, Firebase SDK and localhost rules; mockUserToken identity and Next Link/router adapters. SDK network disabling, not OS disconnection. Not native-device, cloud or full-text verification.',
  fixture: { newerNonmatches: 1000, olderMatches: 45, pageSize: 20 },
  checks: [], errors: [], externalRequests: [], screenshots: [], flows: [], sourceFiles: [],
};
let environment, server, chrome, socket, profile;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, attempts = 120) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { if (await fn()) return; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}${last ? ': ' + String(last) : ''}`);
}
await mkdir(output, { recursive: true });
await mkdir(fixture, { recursive: true });
try {
  environment = await initializeTestEnvironment({ projectId, firestore: {
    host: hostname, port: Number(port),
    rules: await readFile(path.join(root, 'backend/firestore/firestore.rules'), 'utf8'),
  } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const rows = [
      ['users/alice', { schoolId: 'pu', status: 'active' }],
      ['users/charlie', { schoolId: 'other', status: 'active' }],
      ['schools/pu/members/alice', { status: 'active', role: 'student' }],
      ['schools/other/members/charlie', { status: 'active', role: 'student' }],
    ];
    for (let i = 0; i < 1000; i += 1) rows.push([`schools/pu/campusPosts/recent-${i}`, {
      schoolId: 'pu', title: `近期活動 ${i}`, content: '二手書只出現在內文',
      createdAt: new Date(1800000000000 + i * 1000), anonymous: false, authorUid: 'alice',
    }]);
    for (let i = 0; i < 45; i += 1) rows.push([`schools/pu/campusPosts/old-${String(i).padStart(3, '0')}`, {
      schoolId: 'pu', title: i === 44 ? '二手書📚' : `二手書 ${String(Math.floor(i / 3)).padStart(2, '0')}｜資料庫與資訊管理課本`,
      content: '上學期留下的課本，書況與交付方式請開啟貼文核對。',
      anonymous: true, authorUid: 'do-not-render-this-id', createdAt: new Date(1600000000000),
    }]);
    rows.push(['schools/other/campusPosts/private', {
      schoolId: 'other', title: '二手書 他校', content: '另一校內容', anonymous: false,
    }]);
    for (let offset = 0; offset < rows.length; offset += 400) {
      const batch = db.batch();
      for (const [name, data] of rows.slice(offset, offset + 400)) batch.set(db.doc(name), data);
      await batch.commit();
    }
  });

  await writeFile(path.join(fixture, 'firebase.ts'), `
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, disableNetwork, enableNetwork } from 'firebase/firestore';
const app=initializeApp({projectId:${JSON.stringify(projectId)},apiKey:'fixture-only',appId:'fixture-only'});
const db=getFirestore(app);
connectFirestoreEmulator(db,${JSON.stringify(hostname)},${Number(port)},{mockUserToken:{sub:'alice',user_id:'alice'}});
export function getDb(){return db;}
export async function offline(value){if(value)await disableNetwork(db);else await enableNetwork(db);}
`);
  await writeFile(path.join(fixture, 'identity.ts'), `export function useAuth(){return {user:{uid:'alice'},loading:false};}`);
  await writeFile(path.join(fixture, 'link.tsx'), `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>;}`);
  await writeFile(path.join(fixture, 'observed-search.ts'), `
import {searchCampusPostTitles as real,confirmCampusPostTitleOpen as realConfirm,parseTitlePrefix} from '../src/lib/community/titleSearch';
export {parseTitlePrefix};
export const calls=[];
export const opens=[];
export async function confirmCampusPostTitleOpen(school,id) {
 const entry={school,id};opens.push(entry);
 try{entry.available=await realConfirm(school,id);return entry.available;}
 catch(error){entry.error=error?.code??'unknown';throw error;}
}
export async function searchCampusPostTitles(school,prefix,cursor){
 const call={school,prefix,cursor:cursor?.document.id??null};calls.push(call);
 try{const result=await real(school,prefix,cursor);call.returned=result.posts.length;call.ids=result.posts.map(p=>p.id);return result;}
 catch(error){call.error=error?.code??'unknown';throw error;}
}
`);
  await writeFile(path.join(fixture, 'navigation.ts'), `
export const routes=[];
export function useRouter(){return {push:(href)=>{routes.push(href);}};}
`);
  await writeFile(path.join(fixture, 'entry.tsx'), `
import React from 'react';import {createRoot} from 'react-dom/client';
import {TitleHistorySearch} from '../src/app/community/_components/TitleHistorySearch';
import {offline} from './firebase';import {calls,opens} from './observed-search';import {routes} from './navigation';
import '../src/app/globals.css';
const params=new URLSearchParams(location.search);document.documentElement.dataset.theme=params.get('theme')||'light';
const root=createRoot(document.getElementById('root'));
root.render(<TitleHistorySearch schoolId="pu"/>);
window.__history={offline,calls,opens,routes,school:(value)=>root.render(<TitleHistorySearch schoolId={value}/>)};
window.__fixtureToken=location.search;
`);
  const bundled = await build({
    absWorkingDir: root, entryPoints: [path.join(fixture, 'entry.tsx')], outdir: dist,
    bundle: true, metafile: true, platform: 'browser', format: 'esm', jsx: 'automatic', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      '@/components/AuthGuard': path.join(fixture, 'identity.ts'),
      '@/lib/firebase': path.join(fixture, 'firebase.ts'),
      '@/lib/community/titleSearch': path.join(fixture, 'observed-search.ts'),
      'next/link': path.join(fixture, 'link.tsx'),
      'next/navigation': path.join(fixture, 'navigation.ts'), '@': path.join(web, 'src'),
      '@campus/shared': path.join(root, 'packages/shared'),
    },
    loader: { '.module.css': 'local-css', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl' },
  });
  for (const name of Object.keys(bundled.metafile.inputs).filter((name) => /^(apps\/web\/src|packages\/shared\/src)\//.test(name))) {
    const bytes = await readFile(path.join(root, name));
    report.sourceFiles.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') });
    const saved = path.join(output, 'sources', name);
    await mkdir(path.dirname(saved), { recursive: true }); await writeFile(saved, bytes);
  }
  await writeFile(path.join(dist, 'index.html'), `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>校園舊貼文標題搜尋驗收</title><link rel="stylesheet" href="/entry.css"><style>body{margin:0;background:var(--bg);font-family:system-ui,"Noto Sans CJK TC",sans-serif}main{max-width:920px;margin:auto;padding:16px}h1{font-size:24px}.fixture-note{font-size:12px;color:var(--muted)}</style></head><body><main><p class="fixture-note">測試帳號與合成資料 · 非正式校園內容</p><h1>找回校園舊貼文</h1><div id="root"></div></main><script type="module" src="/entry.js"></script></body></html>`);
  server = createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      const name = parsed.pathname === '/' ? 'index.html' : parsed.pathname.slice(1);
      const file = path.resolve(dist, name);
      if (!file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(file);
      res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' http://${host}`);
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
      res.end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  profile = await mkdtemp(path.join(os.tmpdir(), 'title-history-chrome-'));
  const binary = process.env.CHROME_PATH || execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim();
  chrome = spawn(binary, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run',
    '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: ['ignore','ignore','pipe'] });
  let chromeLog = ''; chrome.stderr.on('data', (chunk) => { chromeLog += chunk.toString(); });
  let chromePort;
  await until(async () => {
    try { chromePort = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return true; }
    catch { return false; }
  }, 'Chrome startup', 300);
  report.browserVersion = await (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).json();
  const targets = await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json();
  const target = targets.find((item) => item.type === 'page'); assert.ok(target);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0; const waiting = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && waiting.has(message.id)) {
      const item = waiting.get(message.id); waiting.delete(message.id); clearTimeout(item.timeout);
      if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails);
    else if (message.method === 'Network.requestWillBeSent') {
      const url = message.params.request.url;
      if (/^https?:/.test(url) && new URL(url).origin !== origin && new URL(url).origin !== `http://${host}`)
        report.externalRequests.push(url);
    }
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      waiting.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function call(fn, ...values) {
    const global = await send('Runtime.evaluate', { expression: 'globalThis', returnByValue: false });
    const objectId = global.result?.objectId; assert.ok(objectId);
    try {
      const result = await send('Runtime.callFunctionOn', { objectId,
        functionDeclaration: fn.toString(), arguments: values.map((value) => ({ value })),
        awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    } finally { await send('Runtime.releaseObject', { objectId }).catch(() => {}); }
  }
  async function check(label, fn, ...values) {
    const pass = await call(fn, ...values); report.checks.push({ label, pass: pass === true });
    assert.equal(pass, true, label);
  }
  async function click(text) {
    const point = await call((label) => {
      const el = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
      if (!el || el.getAttribute('aria-disabled') === 'true') throw new Error('Button unavailable: ' + label);
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, text);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function clickFirstResult() {
    const point = await call(() => {
      const link = document.querySelector('article a');
      if (!link) throw new Error('Missing a historical result link');
      link.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = link.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function type(value) {
    await call(() => { const field = document.querySelector('input[type="search"]'); field.focus(); field.select(); });
    await send('Input.insertText', { text: value });
  }
  async function count(expected) {
    try {
      await until(() => call((size) => document.querySelectorAll('article').length === size &&
        !document.querySelector('button[aria-busy="true"]'), expected), `${expected} search cards`);
    } catch (error) {
      const state = await call(() => ({
        cards: document.querySelectorAll('article').length,
        notice: document.querySelector('[role="status"]')?.textContent,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent),
        calls: window.__history?.calls,
        url: location.href,
      })).catch((cause) => ({ captureError: String(cause) }));
      throw new Error(`${String(error)}; UI state=${JSON.stringify(state)}`);
    }
  }
  async function screenshot(name) {
    await call(() => window.scrollTo({ top: 0, behavior: 'instant' })); await delay(80);
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name);
  }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  async function begin(width, height, theme, suffix = '') {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const token = `?width=${width}&theme=${theme}&run=${suffix}`;
    await send('Page.navigate', { url: origin + '/' + token });
    await until(() => call((expected) => window.__fixtureToken === expected && Boolean(document.querySelector('input[type="search"]')), token), 'search editor');
  }
  for (const [width, height, theme] of [[320,720,'light'],[390,844,'dark'],[1366,900,'light']]) {
    const label = `${width}-${theme}`;
    await begin(width, height, theme);
    await check(`${label}: no read before submit`, () => window.__history.calls.length === 0);
    await type('二手書'); await click('搜尋歷史標題'); await count(20);
    await check(`${label}: directly finds history in one indexed request`, () => {
      const calls = window.__history.calls;
      return calls.length === 1 && calls[0].returned === 20 && calls[0].ids.every((id) => id.startsWith('old-'));
    });
    await check(`${label}: scope and anonymous identity preserved`, () =>
      [...document.querySelectorAll('article a')].every((link) => new URL(link.href).searchParams.get('schoolId') === 'pu') &&
      !document.body.textContent.includes('do-not-render-this-id') && document.querySelectorAll('article img').length === 0);
    await check(`${label}: no horizontal overflow and usable hit targets`, () =>
      document.documentElement.scrollWidth <= window.innerWidth + 1 &&
      [...document.querySelectorAll('button,input,article a')].every((el) => el.getBoundingClientRect().height >= 43.5));
    await screenshot(`${label}-found.png`);
    await call(() => window.__history.offline(true));
    await click('載入更多符合的標題');
    await until(() => call(() => document.body.textContent.includes('下一頁讀取失敗')), 'offline retry');
    await check(`${label}: offline keeps cards and search`, () => document.querySelectorAll('article').length === 20 &&
      document.querySelector('input').value === '二手書' && window.__history.calls.at(-1).error === 'unavailable');
    await screenshot(`${label}-offline.png`);
    await call(() => window.__history.offline(false)); await click('重試下一頁'); await count(40);
    await check(`${label}: retries the exact failed cursor`, () => window.__history.calls[1].cursor === window.__history.calls[2].cursor);
    await click('載入更多符合的標題'); await count(45);
    await check(`${label}: last page has unique IDs including emoji suffix`, () => {
      const links = [...document.querySelectorAll('article a')];
      return new Set(links.map((link) => link.href)).size === 45 && links.some((link) => link.textContent === '二手書📚');
    });
    await check(`${label}: final page preserves keyboard focus`, () => document.activeElement?.getAttribute('role') === 'status');
    await check(`${label}: focused summary is visible without scrolling through the list`, () => {
      const bounds = document.activeElement.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
    });
    const ax = await send('Accessibility.getFullAXTree');
    assert.ok(ax.nodes.some((node) => node.role?.value === 'searchbox' && node.name?.value === '標題開頭'));
    report.checks.push({ label: `${label}: searchbox has an accessible name`, pass: true });
    report.flows.push({ label, calls: await call(() => window.__history.calls),
      completed: true, note: 'Automated flow, not human time/success-rate measurement' });
    await click('清除');
    await check(`${label}: clear returns input focus without another read`, () =>
      document.querySelectorAll('article').length === 0 && document.activeElement?.tagName === 'INPUT' && window.__history.calls.length === 4);
  }

  await begin(320, 720, 'light', 'revocation');
  await type('二手書'); await click('搜尋歷史標題'); await count(20);
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' });
  });
  await click('載入更多符合的標題');
  await until(() => call(() => document.body.textContent.includes('先前結果已清除')), 'revoked access');
  await check('revocation clears old cards and focuses the recovery region', () =>
    document.querySelectorAll('article').length === 0 && document.activeElement?.getAttribute('role') === 'alert');
  await screenshot('320-revoked.png');
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('schools/pu/members/alice').update({ status: 'active' });
  });
  await click('重新驗證並搜尋'); await count(20);
  await check('restored membership can search again from first page', () => window.__history.calls.at(-1).cursor === null);
  await call(() => window.__history.school('other'));
  await until(() => call(() => document.querySelector('input').value === ''), 'scope change');
  await type('二手書'); await click('搜尋歷史標題');
  await until(() => call(() => document.body.textContent.includes('先前結果已清除')), 'cross school rejected');
  await check('another school is denied without disclosing its matching post', () =>
    document.querySelectorAll('article').length === 0 && !document.body.textContent.includes('二手書 他校'));
  // Actual Chromium click -> real component -> real SDK -> repository rules.
  // Navigation is observed through a route adapter, not a full PostDetail page.
  await begin(390, 844, 'light', 'open-verified');
  await type('二手書'); await click('搜尋歷史標題'); await count(20);
  await clickFirstResult();
  await until(() => call(() => window.__history.routes.length === 1), 'authorized result navigation');
  await check('390: a normal result click performs fresh server confirmation before navigation', () =>
    window.__history.opens.length === 1 && window.__history.opens[0].available === true &&
    window.__history.routes[0].includes('/community/post/old-'));
  report.flows.push({ label: 'web-confirm-open', completed: true, note: 'Actual SDK and rules, router callback adapter only' });

  await begin(320, 720, 'light', 'deleted-opening');
  await type('二手書'); await click('搜尋歷史標題'); await count(20);
  const missingId = await call(() => new URL(document.querySelector('article a').href).pathname.split('/').at(-1));
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`schools/pu/campusPosts/${missingId}`).delete();
  });
  await clickFirstResult();
  await until(() => call(() => document.body.textContent.includes('已從搜尋結果移除')), 'deleted result rejected');
  await check('320: deleted post cannot navigate and its stale card disappears', () =>
    window.__history.routes.length === 0 && window.__history.opens.length === 1 &&
    window.__history.opens[0].available === false && document.querySelectorAll('article').length === 19);
  await check('320: deleted result restores keyboard focus to the live status', () =>
    document.activeElement?.getAttribute('role') === 'status');

  await begin(320, 720, 'light', 'offline-opening');
  await type('二手書'); await click('搜尋歷史標題'); await count(20);
  await call(() => window.__history.offline(true));
  await clickFirstResult();
  await until(() => call(() => document.body.textContent.includes('暫時無法向伺服器確認')), 'offline open');
  await check('320: offline link stays on the list without an unauthorized navigation', () =>
    window.__history.routes.length === 0 && window.__history.opens[0].error === 'unavailable' &&
    document.querySelectorAll('article').length === 20);
  await call(() => window.__history.offline(false));
  await clickFirstResult();
  await until(() => call(() => window.__history.routes.length === 1), 'offline opening retry');
  await check('320: retry confirms from server before opening', () =>
    window.__history.opens.length === 2 && window.__history.opens[1].available === true);

  assert.equal(report.errors.length, 0, 'Browser exceptions');
  assert.equal(report.externalRequests.length, 0, 'Unexpected external requests');
  await writeFile(path.join(output, 'chrome.log'), chromeLog);
} catch (error) {
  report.errors.push(String(error.stack || error)); process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.info('TITLE_HISTORY_BROWSER', JSON.stringify({ head: report.sourceHead,
    passed: report.checks.filter((row) => row.pass).length, checks: report.checks.length,
    errors: report.errors, externalRequests: report.externalRequests, screenshots: report.screenshots }));
  socket?.close(); chrome?.kill('SIGTERM');
  if (server) await new Promise((resolve) => server.close(resolve));
  await environment?.cleanup();
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(fixture, { recursive: true, force: true });
}
