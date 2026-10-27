import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// 只執行實際元件＋合成資料，不載入 Firebase、校務連線或正式帳號。
const root = process.cwd();
const web = path.join(root, 'apps/web');
const fixture = path.join(web, '.credit-review-fixture');
const output = path.join(root, 'artifacts/credit-review-browser');
const dist = path.join(fixture, 'dist');
const report = { sourceHead: process.env.SOURCE_HEAD_SHA || '', checks: [], screenshots: [], errors: [] };
await mkdir(fixture, { recursive: true }); await mkdir(output, { recursive: true });
const authStub = `export function useAuth(){return {user:{uid:'fixture-student'},loading:false,error:null};}
export function getAuth(){return {currentUser:window.__fixtureOwner===null?null:{uid:window.__fixtureOwner}};}`;
await writeFile(path.join(fixture, 'identity.ts'), authStub);
await writeFile(path.join(fixture, 'link.tsx'), `import React from 'react'; export default function Link({children,...props}){return <a {...props}>{children}</a>;}`);
await writeFile(path.join(fixture, 'entry.tsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CreditTranscriptReview } from '../src/components/academic/CreditTranscriptReview';
import { creditPlanStorageKey, emptyCreditPlan } from '../src/lib/creditPlanner';
import '../src/app/globals.css';
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
window.__fixtureOwner = 'fixture-student';
const plan = {...emptyCreditPlan(),recognized:'3',target:'128',courses:[{id:'future-db',name:'資料庫系統',credits:3,term:1,category:'required',status:'registered'}]};
window.__fixtureKey = creditPlanStorageKey('fixture-student','pu');
localStorage.clear(); localStorage.setItem(window.__fixtureKey,JSON.stringify(plan));
const grade = (id,name,semester,credits,score,type) => ({id,courseName:name,courseNameEn:'',class:'',semester,credits,score,courseType:type});
const rows = params.get('case') === 'empty' ? [] : [
 grade('one','資料庫系統','1141',3,85,'系必修'),
 grade('two','資訊倫理與數位公民：人工智慧應用的責任、隱私與社會影響','1142',2.5,'通過','通識'),
 grade('three','統計學','1131',3,50,'必修'),grade('four','統計學','1141',3,80,'必修'),
 grade('five','尚未評分的課程','1151',3,'','選修')
];
const snapshot={ownerUid:'fixture-student',schoolId:'pu',fetchedAt:new Date().toISOString(),records:{grades:rows,semesters:['1131','1141','1142','1151'],allSemesters:[],summary:{}}};
createRoot(document.getElementById('root')).render(<CreditTranscriptReview snapshot={snapshot}/>);
window.__fixtureReady=true; window.__fixtureToken=location.search;
`);
await build({
  absWorkingDir: root, entryPoints: [path.join(fixture, 'entry.tsx')], outdir: dist,
  bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    '@/components/AuthGuard': path.join(fixture, 'identity.ts'), '@/lib/firebase': path.join(fixture, 'identity.ts'),
    'next/link': path.join(fixture, 'link.tsx'), '@': path.join(web, 'src'),
    '@campus/shared': path.join(root, 'packages/shared'),
  },
  loader: { '.module.css': 'local-css', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl' },
});
await writeFile(path.join(dist, 'index.html'), `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>成績核對元件驗收</title><link rel="stylesheet" href="/entry.css"><style>body{margin:0;background:var(--bg);font-family:system-ui,"Noto Sans CJK TC",sans-serif}main{max-width:1080px;margin:auto;padding:16px}.fixture-note{font-size:12px;color:var(--muted);margin:12px 0}</style></head><body><main><p class="fixture-note">元件驗收 · 合成成績，不是正式校務資料</p><div id="root"></div></main><script type="module" src="/entry.js"></script></body></html>`);
const server = createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url || '/', 'http://localhost');
    const name = parsed.pathname === '/' ? 'index.html' : parsed.pathname.slice(1);
    const file = path.resolve(dist, name);
    if (!file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'");
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let chrome, socket;
const profile = await mkdtemp(path.join(os.tmpdir(), 'credit-review-chrome-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label) {
  let last;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if (await fn()) return; } catch (failure) { last = failure; }
    await delay(100);
  }
  throw new Error(`等待失敗：${label}${last ? ': ' + String(last) : ''}`);
}
try {
  const binary = process.env.CHROME_PATH || execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim();
  chrome = spawn(binary, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run',
    '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; chrome.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  let port;
  await until(async () => { try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return true; } catch { return false; } }, 'Chrome 啟動');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page'); assert.ok(page, '找不到測試分頁');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0; const waiting = new Map();
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(String(event.data));
    if (data.id && waiting.has(data.id)) {
      const { resolve, reject, timeout } = waiting.get(data.id); waiting.delete(data.id); clearTimeout(timeout);
      if (data.error) reject(new Error(JSON.stringify(data.error))); else resolve(data.result);
    } else if (data.method === 'Runtime.exceptionThrown') report.errors.push(data.params.exceptionDetails.text);
    else if (data.method === 'Network.requestWillBeSent') {
      const url = data.params.request.url;
      if (/^https?:/.test(url) && !url.startsWith(origin + '/')) report.errors.push(`禁止的外部請求：${url}`);
    }
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP 逾時：${method}`)); }, 15000);
      waiting.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
    });
  }
  // 程式與資料分開：函式本體固定，文字／selector 透過 CDP arguments 傳值。
  // 不將按鈕文字、網址參數或其他資料插入待執行的 JavaScript 字串。
  async function callInPage(fn, ...values) {
    assert.equal(typeof fn, 'function', '只能執行測試內定義的函式');
    const global = await send('Runtime.evaluate', { expression: 'globalThis', returnByValue: false });
    if (global.exceptionDetails || !global.result.objectId) throw new Error('瀏覽器執行環境尚未就緒');
    const objectId = global.result.objectId;
    try {
      const result = await send('Runtime.callFunctionOn', {
        objectId, functionDeclaration: fn.toString(),
        arguments: values.map((value) => ({ value })), awaitPromise: true, returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    } finally {
      // 換頁時物件可能已隨舊 context 釋放，不讓清理失敗蓋過原操作結果。
      await send('Runtime.releaseObject', { objectId }).catch(() => {});
    }
  }
  async function click(kind, value) {
    const point = await callInPage((type, text) => {
      if (type !== 'button' && type !== 'selector') throw new Error('不支援的測試選取方式');
      const el = type === 'button'
        ? [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
        : document.querySelector(text);
      if (!el || el.disabled) throw new Error('找不到可操作元件');
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, kind, value);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await delay(80);
  }
  async function check(name, fn, ...values) { assert.equal(await callInPage(fn, ...values), true, name); report.checks.push(name); }
  async function screenshot(name) {
    await callInPage(() => window.scrollTo({ top: 0, behavior: 'instant' })); await delay(120);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(output, name), Buffer.from(data, 'base64')); report.screenshots.push(name);
  }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  for (const [width, height, theme] of [[320,720,'light'],[390,844,'light'],[390,844,'dark'],[1440,1000,'light']]) {
    const label = `${width}-${theme}`;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const token = `?theme=${theme}&viewport=${width}`;
    await send('Page.navigate', { url: `${origin}/${token}` });
    await until(() => callInPage((expected) => window.__fixtureToken === expected &&
      Boolean(document.querySelector('[aria-label="已修學分核對工作區"]')), token), '元件載入');
    await click('button', '60 分'); await click('button', '選取建議課程');
    await check(`${label}:選取兩筆無重複通過成績`, () => document.querySelectorAll('input[type=checkbox]:checked').length === 2);
    await check(`${label}:已選門檻收合且仍可調整`, () => [...document.querySelectorAll('details')]
      .some((node) => node.querySelector('summary')?.textContent.includes('參考及格門檻') && !node.open));
    await check(`${label}:選取頁無水平溢位`, () => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await check(`${label}:觸控按鈕高度`, () => [...document.querySelectorAll('button')]
      .filter((node) => node.checkVisibility()).every((node) => node.getBoundingClientRect().height >= 43.5));
    await screenshot(`${label}-selection.png`);
    await click('button', '預覽套用差異');
    await check(`${label}:確認前尚未寫入`, () => JSON.parse(localStorage.getItem(window.__fixtureKey)).recognized === '3');
    await check(`${label}:未決重複安排禁止送出`, () => [...document.querySelectorAll('button')]
      .find((node) => node.textContent.trim() === '確認套用到個人規劃')?.disabled === true);
    await check(`${label}:預覽無水平溢位`, () => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await screenshot(`${label}-preview.png`);
    await click('selector', 'input[type=radio]');
    await click('selector', 'input[type=checkbox]');
    await click('button', '確認套用到個人規劃');
    await until(() => callInPage(() => Boolean(document.querySelector('[aria-label="已修學分核對結果"]'))), '保存回執');
    await check(`${label}:僅套用5.5學分且移除已修安排`, () => {
      const p = JSON.parse(localStorage.getItem(window.__fixtureKey));
      return p.recognized === '5.5' && p.courses.length === 0 && p.target === '128';
    });
    await screenshot(`${label}-saved.png`);
  }
  await send('Page.navigate', { url: `${origin}/?case=empty` });
  await until(() => callInPage(() => document.body.textContent.includes('目前沒有可核對的成績')), '空資料提示');
  await check('空來源不清零原規劃', () => JSON.parse(localStorage.getItem(window.__fixtureKey)).recognized === '3');
  const probe = '核對測試\");window.__creditInjected=true;//';
  await callInPage((label) => {
    const node = document.createElement('button');
    node.id = 'credit-security-probe'; node.textContent = label;
    node.onclick = () => { window.__creditProbeClicks = (window.__creditProbeClicks || 0) + 1; };
    document.body.append(node);
  }, probe);
  await click('button', probe);
  await check('含引號與程式片段的按鈕文字只當作資料', () =>
    window.__creditProbeClicks === 1 && window.__creditInjected === undefined);
  await callInPage(() => document.getElementById('credit-security-probe')?.remove());
  assert.deepEqual(report.errors, [], '瀏覽器出現例外或非本機請求');
  await writeFile(path.join(output, 'chrome.log'), logs);
  console.log(JSON.stringify({ passed: report.checks.length, screenshots: report.screenshots.length, sourceHead: report.sourceHead }));
} catch (error) {
  report.errors.push(error instanceof Error ? error.stack : String(error));
  console.error(error); process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  socket?.close(); chrome?.kill('SIGTERM'); server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(fixture, { recursive: true, force: true }).catch(() => {});
}
