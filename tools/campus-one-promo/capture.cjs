// Capture PUBLIC Campus One pages in a fresh, unauthenticated mobile browser.
// Screenshots come from the live origin during this workflow execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const destination = path.join(__dirname, 'capture');
fs.mkdirSync(destination, {recursive:true});
const routes = [
  ['home','https://nuni.tw/'],
  ['timetable','https://nuni.tw/timetable'],
  ['bus','https://nuni.tw/bus'],
  ['map','https://nuni.tw/map'],
  ['social','https://nuni.tw/social'],
  ['search','https://nuni.tw/search?q=%E5%85%AC%E8%BB%8A'],
  ['cafeteria','https://nuni.tw/cafeteria']
];
(async () => {
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  const results = {started_at:new Date().toISOString(),source_commit:process.env.GITHUB_SHA||null,viewport:'393x852 @2x',captures:[]};
  for (const [name,url] of routes) {
    const context = await browser.newContext({
      viewport:{width:393,height:852},deviceScaleFactor:2,
      locale:'zh-TW',timezoneId:'Asia/Taipei',isMobile:true,hasTouch:true,
      reducedMotion:'reduce',colorScheme:'light'
    });
    const page = await context.newPage();
    const row = {name,url,captured_at:new Date().toISOString()};
    try {
      const response = await page.goto(url,{waitUntil:'domcontentloaded',timeout:55000});
      row.status=response?.status()||0;
      await page.waitForTimeout(3800);
      await page.evaluate(() => window.scrollTo(0,0));
      await page.waitForTimeout(450);
      row.title=await page.title();
      row.final_url=page.url();
      row.visible_text=(await page.locator('body').innerText().catch(()=>'')).slice(0,650);
      if (row.status>=400 || row.status===0) throw new Error('Page status '+row.status);
      const filename=path.join(destination,name+'.png');
      await page.screenshot({path:filename,fullPage:false,animations:'disabled',type:'png'});
      row.sha256=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
      row.image_bytes=fs.statSync(filename).size;
      console.log('CAPTURED',name,row.status,row.title,row.image_bytes,row.captured_at);
    } catch(err) {row.error=String(err).slice(0,400);console.log('FAILED',name,row.error)}
    results.captures.push(row);
    await context.close();
  }
  results.finished_at=new Date().toISOString();
  fs.writeFileSync(path.join(destination,'capture.json'),JSON.stringify(results,null,2));
  await browser.close();
  if(!fs.existsSync(path.join(destination,'home.png')))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
