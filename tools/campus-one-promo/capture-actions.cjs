// Screen recordings from live nuni.tw. Every interaction is a real Playwright click or keystroke.
// The touch indicator marks the position of the actual subsequent click; it does not replace it.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = __dirname;
const raw = path.join(root, 'interactive');
fs.mkdirSync(raw, { recursive: true });
const BASE = 'https://nuni.tw';

const stories = [
  { id: '01-bus', title: '首頁 → 公車 → 站名搜尋', actions: [
    {kind:'click',name:'從首頁打開公車', selectors:['a[href="/bus"]','a:has-text("公車資訊")'], expect:'/bus'},
    {kind:'click',name:'切換站名搜尋', selectors:['button:has-text("搜尋站名")','[role="tab"]:has-text("搜尋站名")','text=搜尋站名'], optional:true},
    {kind:'type',name:'輸入靜宜大學',selectors:['input[placeholder*="站"]','input[placeholder*="搜尋"]','input[type="search"]','input:visible'],value:'靜宜大學',optional:true},
  ]},
  { id: '02-timetable', title: '首頁 → 課務 → 課表切換', actions: [
    {kind:'click',name:'打開課務課表',selectors:['a[href="/timetable"]','a:has-text("課務")'],expect:'/timetable'},
    {kind:'click',name:'切換一週模式',selectors:['button:has-text("一週")','text=一週'],optional:true},
    {kind:'click',name:'切換單日模式',selectors:['button:has-text("單日")','text=單日'],optional:true},
    {kind:'click',name:'打開新增課程',selectors:['button:has-text("新增課程")','text=新增課程'],optional:true},
  ]},
  { id:'03-search', title:'服務搜尋 → 點擊結果', startRoute:'/search', actions: [
    {kind:'type',name:'搜尋公車服務',selectors:['input[type="search"]','input[name="q"]','input[placeholder*="搜尋"]','input:visible'],value:'公車',optional:true},
    {kind:'click',name:'點選搜尋結果公車',selectors:['a[href="/bus"]','a:has-text("查詢路線與站牌")'],expect:'/bus',optional:true},
  ]},
  { id:'04-campus', title:'首頁 → 校園地圖 → 找地點', actions: [
    {kind:'click',name:'從首頁打開校園地圖',selectors:['a[href="/map"]','a:has-text("校園地圖")'],expect:'/map'},
    {kind:'click',name:'點擊找校園地點',selectors:['a:has-text("找校園地點")','button:has-text("找校園地點")','text=找校園地點'],optional:true},
  ]},
];

async function target(page, selectors) {
  // Many mobile pages keep invisible duplicate links inside closed nav drawers.
  // Click ONLY genuinely visible onscreen elements, not the first CSS match.
  for (const s of selectors) {
    try {
      const matches = page.locator(s);
      const count = Math.min(await matches.count(), 30);
      for (let i = 0; i < count; i++) {
        const loc = matches.nth(i);
        if (await loc.isVisible() && await loc.isEnabled()) {
          return {loc, selector:s+' [visible #'+i+'/'+count+']'};
        }
      }
    } catch (_) {}
  }
  return null;
}
async function smoothTo(page, loc) {
  try {
    await loc.evaluate(el => el.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'}),{timeout:4500});
    await page.waitForTimeout(580);
  } catch (_) { await loc.scrollIntoViewIfNeeded({timeout:3500}).catch(()=>{}); }
}
async function tapSignal(page, loc) {
  const bb = await loc.boundingBox();
  if (bb) {
    const x = Math.min(390,Math.max(2,bb.x+bb.width/2));
    const y = Math.min(849,Math.max(2,bb.y+bb.height/2));
    await page.evaluate(([xx,yy])=>window.__campusTapCue?.(xx,yy),[x,y]).catch(()=>{});
    await page.waitForTimeout(260);
  }
}
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

(async () => {
  const started_at = new Date().toISOString();
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  const report = {
    type:'real_live_browser_interaction_video',origin:BASE,started_at,
    branch:process.env.GITHUB_REF_NAME || null,commit:process.env.GITHUB_SHA || null,
    viewport:'393 x 852 CSS px / 786 x 1704 video',chapters:[]
  };
  for (const story of stories) {
    const context = await browser.newContext({
      viewport:{width:393,height:852}, deviceScaleFactor:2,
      isMobile:true,hasTouch:true,locale:'zh-TW',timezoneId:'Asia/Taipei',
      colorScheme:'light',
      recordVideo:{dir:raw,size:{width:786,height:1704}}
    });
    const page = await context.newPage();
    const chapter = {id:story.id,title:story.title,started_at:new Date().toISOString(),steps:[],valid_clicks:0};
    await page.addInitScript(() => {
      window.__campusTapCue = (x,y) => {
        const wrap=document.createElement('div');
        wrap.setAttribute('data-tap-highlight','true');
        wrap.style.cssText='position:fixed;left:'+(x-29)+'px;top:'+(y-29)+'px;width:58px;height:58px;border:3px solid #0F7C6B;background:rgba(96,224,179,.28);box-shadow:0 0 0 9px rgba(96,224,179,.13);border-radius:50%;z-index:2147483647;pointer-events:none;';
        (document.body||document.documentElement).appendChild(wrap);
        wrap.animate([{opacity:1,transform:'scale(.82)'},{opacity:.3,transform:'scale(1.35)'},{opacity:0,transform:'scale(1.7)'}],{duration:850,easing:'ease-out'}).onfinish=()=>wrap.remove();
      };
    });
    try {
      const response = await page.goto(BASE+(story.startRoute||'/'),{waitUntil:'domcontentloaded',timeout:55000});
      if (!response || response.status() >= 400) throw Error('Live homepage status: '+response?.status());
      await page.waitForTimeout(1550);
      chapter.home_status=response.status();
      chapter.home_title=await page.title();
      for (const act of story.actions) {
        const step={name:act.name,kind:act.kind,started_at:new Date().toISOString(),url_before:page.url()};
        try {
          const selected=await target(page,act.selectors);
          if (!selected) throw new Error('No visible matching element');
          step.selector=selected.selector;
          const loc=selected.loc;
          await smoothTo(page,loc);
          await tapSignal(page,loc);
          if(act.kind==='click') {
            await loc.click({timeout:8500});
            chapter.valid_clicks++;
          } else {
            await loc.click({timeout:8500});
            chapter.valid_clicks++;
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.press('Backspace');
            await loc.pressSequentially(act.value,{delay:120,timeout:18000});
            step.typed=act.value;
          }
          if (act.expect) await page.waitForURL(u=>u.pathname===act.expect,{timeout:10000}).catch(()=>{});
          await page.waitForTimeout(act.expect?800:850);
          step.url_after=page.url();
          step.ok= !act.expect || new URL(step.url_after).pathname===act.expect;
          if(!step.ok) step.note='URL did not reach expected route '+act.expect;
          step.visible_excerpt=(await page.locator('main').first().innerText().catch(()=>page.locator('body').innerText().catch(()=>''))).slice(0,420);
          if(!step.ok && !act.optional) throw new Error(step.note);
        } catch (e) {
          step.ok=false; step.error=String(e).slice(0,250);
          console.log('ACTION PROBLEM',story.id,act.name,step.error);
          if (!act.optional) chapter.critical_failure=true;
        }
        chapter.steps.push(step);
        if(chapter.critical_failure) break;
      }
      await page.waitForTimeout(800);
      chapter.final_url=page.url();
      const screen=path.join(raw,story.id+'-end.png');
      await page.screenshot({path:screen,fullPage:false}).catch(()=>{});
      if(fs.existsSync(screen))chapter.screenshot_sha256=digest(screen);
    } catch(err) {
      chapter.error=String(err).slice(0,500);console.log('SCENE ERROR',story.id,chapter.error);
    } finally {
      const sourceVideo=await page.video()?.path().catch(()=>null);
      await context.close();
      if(sourceVideo && fs.existsSync(sourceVideo)) {
        const targetVideo=path.join(raw,story.id+'.webm');
        fs.copyFileSync(sourceVideo,targetVideo);
        chapter.video_file=path.relative(root,targetVideo);
        chapter.video_bytes=fs.statSync(targetVideo).size;
        chapter.video_sha256=digest(targetVideo);
      }
      report.chapters.push(chapter);
      console.log('CHAPTER',story.id,'clicks',chapter.valid_clicks,'steps',chapter.steps.map(s=>s.name+':'+s.ok).join(' | '),'url',chapter.final_url);
    }
  }
  await browser.close();
  report.finished_at=new Date().toISOString();
  fs.writeFileSync(path.join(raw,'click_log.json'),JSON.stringify(report,null,2));
  const valid=report.chapters.filter(c=>c.valid_clicks>0 && c.video_bytes>5000 && !c.critical_failure);
  const clicks=valid.reduce((sum,c)=>sum+c.valid_clicks,0);
  console.log('VERIFIED LIVE INTERACTIVE CHAPTERS:',valid.length,'REAL CLICKS:',clicks);
  if(valid.length<3 || clicks<5) throw Error('Not enough verified real click sequences; will not publish a screenshot-only or fictitious video');
})().catch(e=>{console.error(e);process.exitCode=1});
