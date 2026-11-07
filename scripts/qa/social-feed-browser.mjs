import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Real component, query services, SDK and repository rules. Only the application
// identity provider and Next routing/image adapters are replaced; never query results.
const root = process.cwd();
const web = path.join(root, 'apps/web');
const fixture = path.join(web, '.social-feed-browser-fixture');
const dist = path.join(fixture, 'dist');
const browserMode = process.env.FEED_BROWSER_MODE || 'discovery';
assert.ok(['discovery', 'authorization', 'long-list'].includes(browserMode), 'Unknown browser scenario');
const longListMode = browserMode === 'long-list';
const authMode = browserMode === 'authorization';
const output = path.join(root, 'artifacts/campus-feed-browser', browserMode);
const projectId = 'demo-campus-feed-browser';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
assert.match(emulatorHost, /^(?:127\.0\.0\.1|localhost):\d{1,5}$/, 'Refusing non-local Firestore');
assert.ok(!process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT === projectId, 'Demo project required');
const [host, portText] = emulatorHost.split(':');
const port = Number(portText);
assert.ok(port > 0 && port < 65536);
const report = {
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  projectId, emulatorHost, checks: [], flows: [], screenshots: [], errors: [], sourceFiles: {},
  boundary: 'Chromium + production FeedTab/services + real Firebase SDK + local repository rules; synthetic identity and fixtures, not live Auth, GCS, native devices or competitors',
};
await mkdir(output, { recursive: true });
await mkdir(fixture, { recursive: true });
let environment, server, chrome, socket, profile;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label) {
  let last;
  for (let i = 0; i < 150; i++) {
    try { if (await fn()) return; } catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`Timeout: ${label}${last ? ': ' + last.message : ''}`);
}
try {
  const rulesPath = 'backend/firestore/firestore.rules';
  const rules = await readFile(path.join(root, rulesPath), 'utf8');
  report.sourceFiles[rulesPath] = createHash('sha256').update(rules).digest('hex');
  environment = await initializeTestEnvironment({ projectId, firestore: { host, port, rules } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();
    for (const [uid, schoolId] of [['alice','pu'], ['bob','pu'], ['charlie','other']]) {
      batch.set(db.doc(`users/${uid}`), { schoolId, currentSchoolId: schoolId, role: 'student' });
      batch.set(db.doc(`schools/${schoolId}/members/${uid}`), { status: 'active', role: 'student' });
      batch.set(db.doc(`schools/${schoolId}/directory/${uid}`), { uid, displayName: uid === 'bob' ? '一起讀書的同學' : uid, isDiscoverable: true });
      batch.set(db.doc(`schools/${schoolId}/boards/public`), { schoolId, name: '自由討論', type: 'topic' });
    }
    batch.set(db.doc('follows/fol_pu_alice_bob'), { schoolId: 'pu', followerUid: 'alice', targetUid: 'bob', createdAt: new Date() });
    for (let i = 0; i < 245; i++) {
      batch.set(db.doc(`schools/pu/campusPosts/post-${String(i).padStart(3,'0')}`), {
        schoolId: 'pu', boardId: 'public', authorUid: 'bob', anonymous: false,
        title: i === 4 ? '上學期的專題集合' : `校園貼文 ${i}`,
        content: '合成驗收資料：保留搜尋條件，接續找回較舊的校園討論。',
        createdAt: new Date(1700000000000 + Math.floor(i / 7) * 1000), likes: i === 243 ? 1 : 0, likedBy: [],
      });
    }
    batch.set(db.doc('schools/other/campusPosts/other-only'), {
      schoolId: 'other', boardId: 'public', authorUid: 'charlie', anonymous: false,
      title: '另一校的專屬貼文', content: '不得出現在舊校畫面', createdAt: new Date(1700001000000),
    });
    await batch.commit();
  });
  await writeFile(path.join(fixture, 'firebase.ts'), `
import { initializeApp } from 'firebase/app';
import { initializeFirestore, connectFirestoreEmulator, disableNetwork, enableNetwork, getDocsFromCache, collection, query, orderBy, documentId, limit } from 'firebase/firestore';
const clients = new Map();
let uid = 'alice';
function client(id) {
  if (!clients.has(id)) {
    const app = initializeApp({projectId:${JSON.stringify(projectId)},apiKey:'demo-only'}, 'feed-' + id);
    const db = initializeFirestore(app, {experimentalForceLongPolling:true});
    connectFirestoreEmulator(db, ${JSON.stringify(host)}, ${port}, {mockUserToken:{sub:id,user_id:id}});
    clients.set(id,db);
  }
  return clients.get(id);
}
export const getDb = () => client(uid);
export const getAuth = () => ({currentUser:{uid}});
export const setIdentity = (value) => {uid=value;};
export const offline = () => disableNetwork(getDb());
export const online = () => enableNetwork(getDb());
export const cachedCount = async () => (await getDocsFromCache(query(collection(getDb(),'schools/pu/campusPosts'),orderBy('createdAt','desc'),orderBy(documentId(),'desc'),limit(60)))).size;
export const isFirebaseConfigured = () => true;
export const getFunctionsInstance = () => {throw new Error('Functions are outside the feed-read fixture');};
export const getStorage = () => {throw new Error('Storage is outside the feed-read fixture');};
`);
  await writeFile(path.join(fixture, 'identity.ts'), `import {getAuth} from './firebase'; export const useAuth=()=>({user:getAuth().currentUser,loading:false});`);
  await writeFile(path.join(fixture, 'link.tsx'), `import React from 'react'; export default function Link({children,...props}){return <a {...props}>{children}</a>;}`);
  await writeFile(path.join(fixture, 'image.tsx'), `import React from 'react'; export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>;}`);
  await writeFile(path.join(fixture, 'pages.ts'), `
import {fetchCampusPostPage as readPage} from '../src/lib/community/feedPages';
export * from '../src/lib/community/feedPages';
export async function fetchCampusPostPage(schoolId,cursor) {
  const item={schoolId,cursor:cursor?.document?.id??null,started:performance.now()};
  window.__feedRequests.push(item);
  try {
    const page=await readPage(schoolId,cursor);
    item.ids=page.posts.map(p=>p.id); item.elapsedMs=performance.now()-item.started;
    // Optional delivery gate preserves real SDK results for a deterministic focus/scope race.
    if(cursor && window.__holdFeedPage) await new Promise(resolve=>{window.__releaseFeedPage=resolve;});
    return page;
  } catch(error) {item.code=error.code; throw error;}
}
`);
  await writeFile(path.join(fixture, 'entry.tsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {FeedTab} from '../src/app/community/_components/FeedTab';
import {setIdentity,offline,online,cachedCount} from './firebase';
import '../src/app/globals.css';
const params=new URLSearchParams(location.search);
document.documentElement.dataset.theme=params.get('theme')||'light';
window.__feedRequests=[]; window.__holdFeedPage=false;
const root=createRoot(document.getElementById('root'));
window.__feed={offline,online,cachedCount,switchScope:(uid,schoolId)=>{
  setIdentity(uid); root.render(<FeedTab schoolId={schoolId} schoolSearch={'?schoolId='+schoolId}/>);
}};
window.__feed.switchScope('alice','pu'); window.__fixtureToken=location.search;
`);
  const built = await build({
    absWorkingDir: root, entryPoints: [path.join(fixture,'entry.tsx')], outdir: dist,
    bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', target: 'es2022', metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      '@/components/AuthGuard': path.join(fixture,'identity.ts'), '@/lib/firebase': path.join(fixture,'firebase.ts'),
      '@/lib/community/feedPages': path.join(fixture,'pages.ts'),
      'next/link': path.join(fixture,'link.tsx'), 'next/image': path.join(fixture,'image.tsx'),
      '@': path.join(web,'src'), '@campus/shared': path.join(root,'packages/shared'),
    },
    loader: {'.module.css':'local-css','.png':'dataurl','.svg':'dataurl','.woff2':'dataurl','.woff':'dataurl'},
  });
  for (const file of Object.keys(built.metafile.inputs)) {
    if (!file.includes('node_modules') && !file.includes('.social-feed-browser-fixture')) {
      const bytes = await readFile(path.resolve(root,file));
      report.sourceFiles[file] = createHash('sha256').update(bytes).digest('hex');
      const target = path.resolve(output, 'sources', file);
      assert.ok(target.startsWith(path.join(output, 'sources') + path.sep));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
  await writeFile(path.join(dist,'index.html'), `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>校園舊貼文驗收</title><link rel="stylesheet" href="/entry.css"><style>body{margin:0;font-family:system-ui,"Noto Sans CJK TC",sans-serif;background:var(--bg)}main{max-width:760px;margin:auto;padding:12px;min-width:0}.fixture-note{color:var(--muted);font-size:12px}</style></head><body><main><h1>校園動態</h1><p class="fixture-note">隔離驗收 · 合成帳號與資料 · 非正式服務</p><div id="root"></div></main><script type="module" src="/entry.js"></script></body></html>`);
  server = createServer(async (req,res) => {
    try {
      const name = new URL(req.url || '/', 'http://localhost').pathname;
      const file = path.resolve(dist, name === '/' ? 'index.html' : name.slice(1));
      if (!file.startsWith(dist + path.sep)) {res.writeHead(403).end();return;}
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', `default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' http://${emulatorHost}`);
      res.end(await readFile(file));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  profile = await mkdtemp(path.join(os.tmpdir(),'campus-feed-chrome-'));
  const binary = process.env.CHROME_PATH || execFileSync('which',['google-chrome'],{encoding:'utf8'}).trim();
  chrome = spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let chromeLog=''; chrome.stderr.on('data',data=>{chromeLog+=data;});
  let debugPort;
  await until(async()=>{try {debugPort=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];return true;}catch{return false;}},'Chrome start');
  const targets=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0; const pending=new Map();
  socket.addEventListener('message',event=>{
    const data=JSON.parse(String(event.data));
    if(data.id && pending.has(data.id)) {
      const item=pending.get(data.id);pending.delete(data.id);clearTimeout(item.timer);
      if(data.error)item.reject(new Error(JSON.stringify(data.error)));else item.resolve(data.result);
    } else if(data.method==='Runtime.exceptionThrown') report.errors.push(JSON.stringify(data.params.exceptionDetails));
    else if(data.method==='Network.requestWillBeSent') {
      const url=data.params.request.url;
      if(/^https?:/.test(url) && ![origin,`http://${emulatorHost}`].includes(new URL(url).origin)) report.errors.push('External request: '+url);
    }
  });
  function send(method,params={}) {return new Promise((resolve,reject)=>{
    const id=++sequence; const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });}
  async function call(fn,...values) {
    const global=await send('Runtime.evaluate',{expression:'globalThis'});
    if(!global.result?.objectId)throw new Error('Page context unavailable');
    try {
      const data=await send('Runtime.callFunctionOn',{objectId:global.result.objectId,functionDeclaration:fn.toString(),arguments:values.map(value=>({value})),awaitPromise:true,returnByValue:true});
      if(data.exceptionDetails)throw new Error(JSON.stringify(data.exceptionDetails));
      return data.result.value;
    } finally {await send('Runtime.releaseObject',{objectId:global.result.objectId}).catch(()=>{});}
  }
  async function check(name,fn,...values) {
    const actual=await call(fn,...values); const pass=actual===true;
    report.checks.push({name,pass,actual}); console.log('FEED_BROWSER_CHECK',JSON.stringify({name,pass,actual}));
  }
  async function clickButton(label) {
    const point=await call(text=>{
      const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
      if(!button || button.disabled)throw new Error('Button unavailable: '+text);
      button.scrollIntoView({block:'center',behavior:'instant'}); const r=button.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2};
    },label);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  }
  async function key(key,code,virtual) {
    await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual,...(key==='Enter'?{text:'\r'}:{})});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual});
  }
  async function search(text) {
    await call(()=>{const input=document.querySelector('input[type=search]');input.focus();input.select();});
    await send('Input.insertText',{text});
    await until(()=>call(expected=>document.querySelector('input[type=search]')?.value===expected,text),'search update');
  }
  async function focusMore() {
    for(let i=0;i<20;i++) {
      if(await call(()=>document.activeElement?.tagName==='BUTTON' && /載入更多/.test(document.activeElement.textContent)))return;
      await key('Tab','Tab',9);
    }
    throw new Error('Load-more control not keyboard reachable');
  }
  async function awaitCount(count) {
    await until(()=>call(n=>[...document.querySelectorAll('[role=status]')].some(el=>el.textContent.includes('目前載入 '+n+' 則')),count),'loaded count '+count);
  }
  async function snapshot(name) {
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(path.join(output,name),Buffer.from(data,'base64'));report.screenshots.push(name);
  }
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  report.browser=(await send('Browser.getVersion')).product;
  async function begin(token) {
    await send('Page.navigate',{url:origin+'/'+token});
    await until(()=>call(expected=>window.__fixtureToken===expected && document.querySelectorAll('article').length===60,token),'first authorized page');
    await until(()=>call(()=>!document.body.textContent.includes('正在讀取追蹤')),'following read');
  }
  if (!longListMode && !authMode) {
  for(const [width,height,theme] of [[320,720,'light'],[390,844,'light'],[390,844,'dark'],[1366,900,'light']]) {
    const label=width+'-'+theme;
    try {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await begin('?theme='+theme+'&case='+label);
      await clickButton('追蹤');await clickButton('最新');await search('上學期的專題集合');
      const start=Date.now();
      for(const n of [120,180]) {await focusMore();await key('Enter','Enter',13);await awaitCount(n);}
      await check(label+':cache contains the first page',async()=>await window.__feed.cachedCount()===60);
      await call(()=>window.__feed.offline());
      await focusMore();await key('Enter','Enter',13);
      await until(()=>call(()=>document.body.textContent.includes('載入更多貼文失敗，已保留')),'offline retry state');
      await check(label+':offline retains search and loaded count',()=>document.querySelector('input[type=search]').value==='上學期的專題集合' && document.body.textContent.includes('目前載入 180 則'));
      await snapshot(label+'-offline.png');
      await call(()=>window.__feed.online());
      await focusMore();await key('Enter','Enter',13);await awaitCount(240);
      await focusMore();await key('Enter','Enter',13);await awaitCount(245);
      await check(label+':finds the 241st post through the real page service',()=>document.querySelector('article h3')?.textContent==='上學期的專題集合' && document.querySelectorAll('article').length===1);
      await check(label+':last-page keyboard focus remains at the result',()=>document.activeElement?.getAttribute('role')==='status' && document.activeElement.textContent.includes('最後一頁'));
      await check(label+':no horizontal overflow',()=>document.documentElement.scrollWidth<=innerWidth+1);
      await check(label+':sort and followed filter survive',()=>['追蹤','最新'].every(text=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===text && b.getAttribute('aria-pressed')==='true')));
      await snapshot(label+'-found.png');
      const requests=await call(()=>window.__feedRequests);
      report.flows.push({label,elapsedMs:Date.now()-start,loadActivations:5,requests,measurement:'automated scripted interaction including one injected SDK-offline interval; not human timing or competitor comparison'});
      await check(label+':offline retry uses the same cursor',()=>{
        const rows=window.__feedRequests; const denied=rows.findIndex(r=>r.code==='unavailable');
        return denied>=0 && rows[denied].cursor===rows[denied+1]?.cursor;
      });
    } catch(error) {report.errors.push(label+': '+error.message);await snapshot(label+'-failure.png').catch(()=>{});}
  }
  } else if (authMode) {
  // Run authorization and delayed-result races with a fresh SDK session.
  // A long sequence of offline toggles otherwise exhausts emulator long-polling
  // clients in some CI runners before the membership denial can be evaluated.
  // A real authorized result is held after the SDK completes, not replaced with a fake page.
  try {
    await begin('?case=focus-moved');await search('上學期的專題集合');
    for(const n of [120,180,240]) {await focusMore();await key('Enter','Enter',13);await awaitCount(n);}
    await call(()=>{window.__holdFeedPage=true;});await focusMore();await key('Enter','Enter',13);
    await until(()=>call(()=>typeof window.__releaseFeedPage==='function'),'held real result');
    await search('學生正在修改的搜尋');
    await call(()=>{window.__holdFeedPage=false;window.__releaseFeedPage();});await awaitCount(245);
    await check('late result does not steal search focus',()=>document.activeElement===document.querySelector('input[type=search]') && document.activeElement.value==='學生正在修改的搜尋');
  } catch(error) {report.errors.push('focus-moved: '+error.message);}
  try {
    await begin('?case=membership');
    await environment.withSecurityRulesDisabled(async context=>{await context.firestore().doc('schools/pu/members/alice').update({status:'inactive'});});
    await clickButton('載入更多貼文');
    await until(()=>call(()=>document.body.textContent.includes('校籍或貼文存取權限已變更')),'actual rules denial');
    await check('membership denial clears previously displayed posts',()=>document.querySelectorAll('article').length===0 && !document.body.textContent.includes('校園貼文 244'));
    await snapshot('revoked-membership.png');
    await environment.withSecurityRulesDisabled(async context=>{await context.firestore().doc('schools/pu/members/alice').update({status:'active'});});
    await clickButton('重新驗證');await awaitCount(60);
    await check('restored membership can use the same interface',()=>document.querySelectorAll('article').length===60);
    await call(()=>{window.__holdFeedPage=true;});await clickButton('載入更多貼文');
    await until(()=>call(()=>typeof window.__releaseFeedPage==='function'),'held page before scope change');
    await call(()=>window.__feed.switchScope('charlie','other'));
    await until(()=>call(()=>document.querySelector('article h3')?.textContent==='另一校的專屬貼文'),'other school authorized page');
    await call(()=>{window.__holdFeedPage=false;window.__releaseFeedPage();});await sleep(100);
    await check('late previous-school page cannot repopulate the new scope',()=>document.querySelectorAll('article').length===1 && document.querySelector('article h3').textContent==='另一校的專屬貼文' && !document.body.textContent.includes('校園貼文 184'));
  } catch(error) {report.errors.push('authorization: '+error.message);}
  } else {
    // One separate Chrome and SDK session exercises all loaded cards.
    // This avoids keeping the prior offline test's long-polling channels alive.
    try {
      await send('Emulation.setDeviceMetricsOverride',{width:320,height:720,deviceScaleFactor:1,mobile:false});
      await begin('?theme=light&case=long-list');
      await search('上學期的專題集合');
      for (const count of [120,180,240,245]) {
        await focusMore();await key('Enter','Enter',13);await awaitCount(count);
      }
      await check('long-list:old post is found through real SDK pagination',()=>
        document.querySelector('article h3')?.textContent==='上學期的專題集合' && document.querySelectorAll('article').length===1);
      await call(()=>{const input=document.querySelector('input[type=search]');input.focus();input.select();});
      await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
      await until(()=>call(()=>document.querySelector('input[type=search]')?.value==='' && document.querySelectorAll('article').length===245),'all 245 posts visible');
      await check('long-list:clearing search restores all 245 unique cards',()=>{
        const cards=[...document.querySelectorAll('article')];
        return document.querySelector('input[type=search]').value==='' && cards.length===245 &&
          new Set(cards.map(card=>card.querySelector('h3')?.textContent)).size===245;
      });
      await check('long-list:recommendation may reorder same-timestamp posts',()=>
        document.querySelector('article h3')?.textContent==='校園貼文 243');
      await clickButton('最新');
      await check('long-list:latest matches SDK createdAt and document-ID order',()=>{
        const titles=[...document.querySelectorAll('article h3')].map(heading=>heading.textContent);
        return titles.length===245 && titles.every((title,position)=>{
          const index=244-position;
          return title===(index===4?'上學期的專題集合':'校園貼文 '+index);
        });
      });
      await check('long-list:browser can defer offscreen card rendering',()=>{
        const cards=[...document.querySelectorAll('article')];
        return cards.every(card=>{
          const style=getComputedStyle(card);
          return style.contentVisibility==='auto' && style.containIntrinsicBlockSize.includes('320px');
        });
      });
      await call(()=>document.querySelectorAll('article')[244].scrollIntoView({block:'center',behavior:'instant'}));
      await sleep(180);
      await check('long-list:oldest card paints and its post link accepts focus',()=>{
        const card=document.querySelectorAll('article')[244],rect=card.getBoundingClientRect();
        const link=card.querySelector('a[href^="/community/post/"]');
        const hit=document.elementFromPoint(Math.max(1,rect.left+20),Math.min(innerHeight-1,rect.top+20));
        link?.focus({preventScroll:true});
        return rect.height>100 && rect.top<innerHeight && rect.bottom>0 && !!hit &&
          (card===hit || card.contains(hit)) && document.activeElement===link;
      });
      await snapshot('320-long-tail.png');
      await check('long-list:search return is a 44px keyboard control',()=>{
        const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='返回搜尋與篩選');
        return !!button && button.getBoundingClientRect().height>=43.5;
      });
      await clickButton('返回搜尋與篩選');
      await sleep(200);
      const returnDetails = await call(()=>{
        const input=document.querySelector('input[type=search]');
        const rect=input?.getBoundingClientRect();
        return {focused:document.activeElement===input,top:rect?.top,bottom:rect?.bottom,innerHeight,scrollY,
          visibleCards:document.querySelectorAll('article').length,query:input?.value};
      });
      console.info('FEED_SEARCH_RETURN_DIAGNOSTIC',JSON.stringify(returnDetails));
      await check('long-list:one click returns focus and viewport to search without resetting pages',()=>{
        const input=document.querySelector('input[type=search]');
        const rect=input?.getBoundingClientRect();
        return document.activeElement===input && rect && rect.top>=0 && rect.bottom<=innerHeight &&
          input.value==='' && document.querySelectorAll('article').length===245;
      });
      await snapshot('320-long-search-return.png');
      await call(()=>document.querySelectorAll('article')[0].scrollIntoView({block:'center',behavior:'instant'}));
      await sleep(180);
      await check('long-list:first card is readable after scrolling back',()=>{
        const card=document.querySelector('article'),rect=card.getBoundingClientRect();
        return rect.height>100 && rect.top<innerHeight && rect.bottom>0 && !!card.querySelector('h3')?.textContent;
      });
      await check('long-list:no horizontal overflow with all cards',()=>document.documentElement.scrollWidth<=innerWidth+1);
      await snapshot('320-long-return.png');
    } catch(error) {report.errors.push('long-list: '+error.message);await snapshot('long-list-failure.png').catch(()=>{});}
  }
  await writeFile(path.join(output,'chrome.log'),chromeLog);
} catch(error) {report.errors.push(error.stack || String(error));}
finally {
  socket?.close();chrome?.kill('SIGTERM');
  if(server)await new Promise(resolve=>server.close(resolve));
  await environment?.cleanup();
  if(profile)await rm(profile,{recursive:true,force:true}).catch(()=>{});
  await rm(fixture,{recursive:true,force:true});
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
}
const failures=report.checks.filter(row=>!row.pass);
console.log('FEED_BROWSER_SUMMARY',JSON.stringify({sourceHead:report.sourceHead,checks:report.checks.length,failures,errors:report.errors,screenshots:report.screenshots,flows:report.flows.map(({requests,...flow})=>({...flow,pageSizes:requests.filter(r=>r.ids).map(r=>r.ids.length)}))}));
if(report.errors.length || failures.length || report.checks.length<(longListMode ? 8 : authMode ? 4 : 28))process.exitCode=1;
