import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = process.cwd(), web = path.join(root, 'apps/web');
const fixture = path.join(web, '.credit-deadline-fixture'), dist = path.join(fixture, 'dist');
const output = path.join(root, 'artifacts/credit-deadline-browser');
const report = { sourceHead: process.env.SOURCE_HEAD_SHA || '', checks: [], screenshots: [], errors: [] };
await mkdir(fixture, { recursive: true }); await mkdir(output, { recursive: true });
// Real existing scenario component; only the personal plan is a synthetic fixture.
await writeFile(path.join(fixture, 'entry.tsx'), `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CreditPlanScenarios} from '../src/components/academic/CreditPlanScenarios';
import {emptyCreditPlan} from '@campus/shared/src/creditPlanner';
import '../src/app/globals.css';
const params=new URLSearchParams(location.search);
document.documentElement.dataset.theme=params.get('theme')||'light';
const original={...emptyCreditPlan(),recognized:'112',target:'128',extra:'20',terms:3,
categoryGoals:{...emptyCreditPlan().categoryGoals,required:{recognized:'50',target:'62'}},
courses:[{id:'db',name:'資料庫',credits:6,term:1,category:'required',status:'registered'},
{id:'stat',name:'統計學',credits:6,term:2,category:'required',status:'considering'},
{id:'art',name:'資訊倫理與數位公民：人工智慧應用的責任、隱私與社會影響',credits:4,term:3,category:'general',status:'considering'}],
milestones:[{id:'eng',label:'英文能力門檻',done:false}]};
window.__original=JSON.stringify(original);localStorage.setItem('fixture-plan',window.__original);
function App(){const[plan,setPlan]=useState(original);window.__refresh=()=>setPlan({...plan,recognized:'114'});
window.__plan=plan;return <CreditPlanScenarios plan={plan}/>;}
createRoot(document.getElementById('root')).render(<App/>);
window.__fixtureToken=location.search;
`);
await build({ absWorkingDir: root, entryPoints: [path.join(fixture, 'entry.tsx')], outdir: dist,
  bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@campus/shared': path.join(root, 'packages/shared'), '@': path.join(web, 'src') },
  loader: { '.module.css': 'local-css', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl' },
});
await writeFile(path.join(dist, 'index.html'), '<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>學分期限比較驗收</title><link rel="stylesheet" href="/entry.css"><style>body{margin:0;font-family:system-ui,"Noto Sans CJK TC",sans-serif;background:var(--bg)}main{max-width:1080px;margin:auto;padding:16px}.note{font-size:12px;line-height:1.8;color:var(--muted)}</style></head><body><main><p class="note">Campus One 元件驗收 · 合成規劃，非正式畢業審查</p><div id="root"></div></main><script type="module" src="/entry.js"></script></body></html>');
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url || '/', 'http://localhost').pathname;
    const file = path.resolve(dist, name === '/' ? 'index.html' : name.slice(1));
    if (!file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'");
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), 'credit-deadline-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let chrome, socket;
async function until(fn, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if (await fn()) return; } catch { /* Navigation can replace a context. */ }
    await delay(100);
  }
  throw new Error(`等待失敗：${label}`);
}
try {
  const binary = process.env.CHROME_PATH || execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim();
  chrome = spawn(binary, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let port;
  await until(async () => { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; }, 'Chrome');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let seq = 0; const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id); clearTimeout(timer); pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails.text);
    else if (message.method === 'Network.requestWillBeSent') {
      const url = message.params.request.url;
      if (/^https?:/.test(url) && !url.startsWith(origin + '/')) report.errors.push(`外部請求：${url}`);
    }
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
  }
  // All code is authored functions; selectors, texts and values travel as CDP arguments.
  async function page(fn, ...args) {
    const global = await send('Runtime.evaluate', { expression: 'globalThis' });
    const result = await send('Runtime.callFunctionOn', { objectId: global.result.objectId,
      functionDeclaration: fn.toString(), arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const click = (text) => page(function (text) {
    const element = [...document.querySelectorAll('button,summary')].find((node) => node.textContent.trim().includes(text));
    if (!element || element.disabled) throw new Error('沒有可操作按鈕'); element.click();
  }, text);
  const set = (selector, value) => page(function (selector, value) {
    const element = document.querySelector(selector); if (!element) throw new Error('找不到欄位');
    const type = element.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }, selector, value);
  const has = (text) => page(function (text) { return document.body.innerText.includes(text); }, text);
  async function check(name, fn) { assert.ok(await fn(), name); report.checks.push(name); }
  async function screenshot(name) {
    const metrics = await send('Page.getLayoutMetrics');
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 } });
    await writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name);
  }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  for (const config of [{ w: 320, h: 720, theme: 'light' }, { w: 390, h: 844, theme: 'light' },
    { w: 390, h: 844, theme: 'dark' }, { w: 1440, h: 1000, theme: 'light' }]) {
    const prefix = `${config.w}-${config.theme}`; const query = `?theme=${config.theme}&width=${config.w}`;
    await send('Emulation.setDeviceMetricsOverride', { width: config.w, height: config.h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: origin + '/' + query });
    await until(() => page(function (token) { return window.__fixtureToken === token && !!document.querySelector('summary'); }, query), prefix);
    await page(async function () { await document.fonts.ready; });
    await click('換個修法'); await click('以全部課程開始比較');
    await until(() => has('這個學期前，學分來得及嗎？'), 'deadline');
    const selector = '[aria-label="目標學期比較"] select';
    await set(selector, '2'); await until(() => has('第 2 學期末仍差 4'), 'baseline gap');
    await check(`${prefix}: original and alternative start at four`, () => page(function () {
      return document.querySelector('[aria-label="原規劃期限缺口"] strong').textContent.startsWith('4') &&
        document.querySelector('[aria-label="比較方案期限缺口"] strong').textContent.startsWith('4');
    }));
    await screenshot(`${prefix}-baseline.png`);
    await set('[aria-label="統計學（原第 2 學期）的比較安排"]', '3');
    await until(() => has('第 2 學期末仍差 10'), 'deferred gap');
    await check(`${prefix}: deferred six credits note unscheduled extra before claiming sufficiency`, () => has('含尚未排入學期的其他預計學分後，全部修完總量可達標，但第 2 學期末仍差 10'));
    await check(`${prefix}: unassigned credits excluded`, () => has('其他預計學分 20 尚未排入學期'));
    await check(`${prefix}: future courses excluded`, () => has('2 門排在期限後'));
    await screenshot(`${prefix}-deadline.png`);
    await set('[aria-label="個人每學期負擔提醒"]', '');
    await until(() => has('個人每學期負擔提醒請填'), 'invalid input');
    await check(`${prefix}: invalid input removes previous success`, () => page(function () {
      return !document.querySelector('[aria-label="比較方案期限缺口"]');
    }));
    await set('[aria-label="個人每學期負擔提醒"]', '5');
    await until(() => has('第 2 學期末仍差 10'), 'recovered input');
    await click('核對期限內分類與每學期負擔');
    await check(`${prefix}: capacity shortfall is explicit`, () => has('單看學分量仍放不下 5 學分'));
    await check(`${prefix}: future availability not promised`, () => has('不代表有對應課程可選'));
    await check(`${prefix}: category deficit is six`, () => page(function () {
      const row = document.querySelector('[aria-label="期限內分類缺口"] tbody tr'); return row?.textContent.includes('必修06');
    }));
    await check(`${prefix}: no horizontal overflow`, () => page(function () { return document.documentElement.scrollWidth <= innerWidth; }));
    await check(`${prefix}: form inputs have at least 44px height`, () => page(function () {
      return [...document.querySelectorAll('[aria-label="目標學期比較"] input,[aria-label="目標學期比較"] select')].every(el => el.getBoundingClientRect().height >= 44);
    }));
    await screenshot(`${prefix}-workload.png`);
    await check(`${prefix}: original plan and storage never mutated`, () => page(function () {
      return JSON.stringify(window.__plan) === window.__original && localStorage.getItem('fixture-plan') === window.__original;
    }));
    await page(function () { window.__refresh(); });
    await until(() => has('原規劃已更新'), 'stale source');
    await check(`${prefix}: stale comparison removed`, () => page(function () { return !document.querySelector('[aria-label="目標學期比較"]'); }));
  }
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
} catch (error) { report.errors.push(String(error)); throw error; }
finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  socket?.close(); chrome?.kill(); server.close();
  await rm(fixture, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify({ checks: report.checks.length, screenshots: report.screenshots.length, errors: report.errors.length }));
