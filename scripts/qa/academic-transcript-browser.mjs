import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// 驗收實際成績頁與樣式；僅以合成資料取代登入、校務讀取及其他分頁。
const root = process.cwd();
const web = path.join(root, 'apps/web');
const output = path.join(root, 'artifacts/academic-transcript-browser');
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(path.join(web, '.transcript-browser-'));
const profile = await mkdtemp(path.join(os.tmpdir(), 'transcript-chrome-'));
const downloads = path.join(output, 'downloads');
const dist = path.join(fixture, 'dist');
await mkdir(downloads, { recursive: true });
const report = {
  sourceHead: process.env.SOURCE_HEAD_SHA || '',
  checkout: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: '實際成績頁＋合成資料；不是校方登入或 Safari／原生 App 驗收',
  checks: [], screenshots: [], errors: [],
};
let server, chrome, socket;
const pending = new Map();
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, name) {
  let last;
  for (let i = 0; i < 100; i++) {
    try { if (await check()) return; } catch (error) { last = error; }
    await pause(100);
  }
  throw new Error(`${name}未完成${last ? `：${last.message}` : ''}`);
}
try {
  await writeFile(path.join(fixture, 'academic.tsx'), `import React, {createContext, useContext} from 'react';
export const SnapshotContext = createContext(null);
export function AcademicPage({children,title}) {const snapshot=useContext(SnapshotContext);return <main><h1>{title}</h1>{children(snapshot)}</main>;}`);
  await writeFile(path.join(fixture, 'navigation.ts'), `export const useSearchParams=()=>new URLSearchParams(location.search);`);
  await writeFile(path.join(fixture, 'tabs.tsx'), `export const GradesTabs=()=>null;export const isGradesFeedbackTab=()=>false;`);
  await writeFile(path.join(fixture, 'feedback.tsx'), `export const StudentGradesPage=()=>null;`);
  await writeFile(path.join(fixture, 'entry.tsx'), `
import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import GradesPage from '../src/app/grades/page';
import {SnapshotContext} from './academic';
import '../src/app/globals.css';
const params=new URLSearchParams(location.search);
document.documentElement.dataset.theme=params.get('theme')||'light';
const rows=Array.from({length:85},(_,i)=>({id:'fixture-'+i,semester:i<45?'1151':'1142',
 courseName:i===0?'資料庫管理與資料倫理：跨領域專題的規劃、協作與成果檢驗':'合成課程'+i,
 courseNameEn:i===0?'DATABASE SYSTEMS':'COURSE '+i,class:'資管測試班',
 courseType:i%2?'選修':'必修',credits:i===0?0.5:3,score:i===0?0:i===1?'Pass':i===2?'':80}));
const snapshot={fetchedAt:'2026-10-28T00:00:00.000Z',records:{grades:rows,semesters:['1142','1151'],allSemesters:['1142','1151'],summary:{}}};
function Fixture(){const [current,setCurrent]=useState(snapshot);useEffect(()=>{window.__replaceSnapshot=setCurrent;window.__fixtureToken=location.search;},[]);return <SnapshotContext.Provider value={current}><GradesPage/></SnapshotContext.Provider>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
`);
  await build({
    absWorkingDir: root, entryPoints: [path.join(fixture, 'entry.tsx')], outdir: dist,
    bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      '@/components/academic/AcademicPage': path.join(fixture, 'academic.tsx'),
      '@/components/academic/GradesTabs': path.join(fixture, 'tabs.tsx'),
      '@/features/nuni/StudentGrades': path.join(fixture, 'feedback.tsx'),
      'next/navigation': path.join(fixture, 'navigation.ts'),
      '@': path.join(web, 'src'), '@campus/shared': path.join(root, 'packages/shared'),
    },
    loader: { '.module.css': 'local-css', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl' },
  });
  await writeFile(path.join(dist, 'index.html'), `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>成績頁瀏覽器驗收</title><link rel="stylesheet" href="/entry.css"><style>body{margin:0;background:var(--bg);font-family:system-ui,"Noto Sans CJK TC",sans-serif}main{max-width:1080px;margin:auto;padding:16px;box-sizing:border-box}.fixture-note{padding:8px 16px;font-size:12px}</style></head><body><p class="fixture-note">瀏覽器驗收 · 全部為合成成績，沒有連線校方</p><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`);
  const allowed = new Map([['/', 'index.html'], ['/entry.js', 'entry.js'], ['/entry.css', 'entry.css']]);
  server = createServer(async (req, res) => {
    try {
      const file = allowed.get(new URL(req.url || '/', 'http://localhost').pathname);
      if (!file) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'");
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
      res.end(await readFile(path.join(dist, file)));
    } catch { res.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const binary = process.env.CHROME_PATH || execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim();
  chrome = spawn(binary, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
  let port;
  await until(async () => { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); }, 'Chrome 啟動');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => item.type === 'page');
  assert.ok(target, '沒有可用的驗收分頁');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  socket.addEventListener('message', event => {
    const data = JSON.parse(String(event.data));
    if (data.id && pending.has(data.id)) {
      const request = pending.get(data.id); pending.delete(data.id); clearTimeout(request.timer);
      if (data.error) request.reject(new Error(JSON.stringify(data.error))); else request.resolve(data.result);
    } else if (data.method === 'Runtime.exceptionThrown') {
      report.errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    } else if (data.method === 'Network.requestWillBeSent') {
      const url = data.params.request.url;
      if (/^https?:/.test(url) && !url.startsWith(origin + '/')) report.errors.push(`非預期外部請求：${url}`);
    }
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 逾時：${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
  }
  // 測試函式固定，文字與選擇器以 arguments 傳值，不拼接成可執行程式。
  async function inPage(fn, ...values) {
    assert.equal(typeof fn, 'function');
    const global = await send('Runtime.evaluate', { expression: 'globalThis' });
    assert.ok(global.result?.objectId, '瀏覽器環境尚未就緒');
    const objectId = global.result.objectId;
    try {
      const result = await send('Runtime.callFunctionOn', { objectId, functionDeclaration: fn.toString(),
        arguments: values.map(value => ({ value })), awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    } finally { await send('Runtime.releaseObject', { objectId }).catch(() => {}); }
  }
  async function click(selector, text = null) {
    const point = await inPage((query, label) => {
      const node = [...document.querySelectorAll(query)].find(item => label === null || item.textContent.trim() === label);
      if (!node || node.disabled) throw new Error('找不到可操作的控制項');
      node.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, selector, text);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await pause(80);
  }
  async function check(name, fn, ...values) {
    assert.equal(await inPage(fn, ...values), true, name); report.checks.push(name);
  }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  for (const [width, height, theme] of [[320,720,'light'],[390,844,'light'],[390,844,'dark'],[768,1024,'light'],[1440,1000,'light']]) {
    const label = `${width}-${theme}`;
    const token = `?theme=${theme}&width=${width}`;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: origin + '/' + token });
    await until(() => inPage(expected => window.__fixtureToken === expected && document.querySelectorAll('[aria-label="成績明細"] > li').length === 40, token), '成績頁載入');
    await check(`${label}:沒有水平溢位`, () => document.documentElement.scrollWidth <= innerWidth + 1);
    await check(`${label}:控制項至少44px`, () => [...document.querySelectorAll('button,input,select')].filter(node => node.checkVisibility()).every(node => node.getBoundingClientRect().height >= 43.5));
    await check(`${label}:符合與展開筆數分開呈現`, () => document.body.textContent.includes('符合 85 筆 · 已顯示 40 筆'));
    await inPage(() => scrollTo({ top: 0, behavior: 'instant' }));
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const screenshot = `${label}.png`;
    await writeFile(path.join(output, screenshot), Buffer.from(data, 'base64')); report.screenshots.push(screenshot);
    await click('input[type="search"]');
    await send('Input.insertText', { text: 'ＤＡＴＡＢＡＳＥ' });
    await until(() => inPage(() => document.querySelectorAll('[aria-label="成績明細"] > li').length === 1), '全形英文搜尋');
    report.checks.push(`${label}:全形英文搜尋實際輸入`);
    await check(`${label}:搜尋結果保留零分與小數學分`, () => {
      const row = document.querySelector('[aria-label="成績明細"] > li');
      return row.textContent.includes('0.5 學分') && row.lastElementChild.textContent.trim() === '0分';
    });
    await click('button', '清除篩選');
    await click('button', '再顯示 40 筆成績');
    await check(`${label}:展開至80筆`, () => document.querySelectorAll('[aria-label="成績明細"] > li').length === 80);
    await click('button', '再顯示 5 筆成績');
    await check(`${label}:展開至85筆`, () => document.querySelectorAll('[aria-label="成績明細"] > li').length === 85);
    await click('input[type="search"]'); await send('Input.insertText', { text: '不存在的課程' });
    await until(() => inPage(() => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === '匯出符合條件的 0 筆 CSV' && node.disabled)), '空結果禁止匯出');
    report.checks.push(`${label}:空結果禁止匯出`);
    await click('button', '清除篩選');
    await check(`${label}:清除篩選回到40筆`, () => document.querySelectorAll('[aria-label="成績明細"] > li').length === 40);
  }
  await click('button', '匯出符合條件的 85 筆 CSV');
  let downloaded;
  await until(async () => {
    downloaded = (await readdir(downloads)).find(name => name.endsWith('.csv'));
    return Boolean(downloaded);
  }, '瀏覽器下載 CSV');
  const csv = await readFile(path.join(downloads, downloaded), 'utf8');
  assert.ok(csv.startsWith('\uFEFF'), 'CSV 應提供 UTF-8 BOM');
  assert.equal(csv.trimEnd().split('\r\n').length, 86, '匯出全部85筆，不限畫面40筆');
  assert.ok(csv.includes('"0.5","0"'), '零分與小數學分不得改寫');
  assert.ok(csv.includes('"Pass"'), '保留文字成績');
  assert.ok(csv.includes('非正式成績單或畢業審核'), '保留資料界線');
  report.checks.push('Chrome 實際下載85筆CSV、UTF-8 BOM、零分、小數與文字成績');
  assert.deepEqual(report.errors, [], '沒有瀏覽器例外或外部資料請求');
  report.success = true;
} catch (error) {
  report.success = false; report.errors.push(error.stack || String(error)); process.exitCode = 1;
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  socket?.close();
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const ended = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill('SIGTERM'); await Promise.race([ended, pause(3000)]);
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill('SIGKILL'); await Promise.race([ended, pause(3000)]);
    }
  }
  if (server) await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await rm(fixture, { recursive: true, force: true });
  // Chrome 子程序可能仍在收尾寫入；只重試暫存清理，不重跑或略過驗收。
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(JSON.stringify({ success: report.success, checks: report.checks.length, screenshots: report.screenshots.length, errors: report.errors }, null, 2));
}
