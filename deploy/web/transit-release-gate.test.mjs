import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {TDX,ORIGIN,probeTdx,probePublic,verifiedArrival,buildRemoteCommand,parseRemoteReport,probeRuntime,validateProfile,hasBusShell,verifyOfficialNotice,sanitizedRemoteFailure,failureFromFlyExecError,retryAfterMs,withRateLimitRetry,probeFlyMachine,MACHINE_IDS} from './transit-release-gate.mjs';
const busLoadingHtml = readFileSync(new URL('./fixtures/bus-loading.html', import.meta.url), 'utf8');
const stamp = '2026-10-12T16:00:00Z';
const now = () => Date.parse(stamp);
const sha = 'a'.repeat(40);
const stop = {id:'TXG-test',name:'靜宜大學',city:'Taichung',lat:24.23,lon:120.57};
const arrival = {route:'300',direction:0,status:0,seconds:180,updatedAt:stamp};
const credentials = {clientId:'test-client',clientSecret:'test-credential-not-live'};
function mock({provider=true,stops=[stop],rows=[arrival],page=true,healthRevision=sha,errorStatus,rawTime} = {}) {
  return async (url, init) => {
    assert.equal(new URL(url).origin,provider ? TDX : ORIGIN);
    assert.equal(init.redirect,'error'); assert.equal(init.credentials,'omit');
    if (url.includes('/openid-connect/token')) {
      assert.equal(new URLSearchParams(init.body).get('client_secret'),credentials.clientSecret);
      return errorStatus ? Response.json({secret:'must-not-appear'},{status:errorStatus}) : Response.json({access_token:'test-bearer',expires_in:300});
    }
    if (!provider && url.endsWith('/health/ready')) return Response.json({service:'campus-one-web',status:'ready',legacy:'ready',revision:healthRevision});
    if (!provider && url.endsWith('/bus')) return new Response(page ? busLoadingHtml : 'Old bus page',{headers:{'Content-Type':'text/html','Permissions-Policy':'geolocation=(self)'}});
    const stationQuery = provider ? url.includes('/Stop/City/') : JSON.parse(init.body).action === 'campus';
    if (provider) {
      assert.equal(init.headers.Authorization,'Bearer test-bearer');
      return Response.json(stationQuery ? stops.map(s => ({StopUID:s.id,StopName:{Zh_tw:s.name},StopPosition:{PositionLat:s.lat,PositionLon:s.lon}})) : rows.map(r => ({StopUID:stop.id,RouteName:{Zh_tw:r.route},Direction:r.direction,StopStatus:r.status,EstimateTime:r.seconds,SrcUpdateTime:rawTime ?? r.updatedAt,UpdateTime:stamp})));
    }
    assert.equal(init.headers.Authorization,undefined);
    return Response.json({status:'ready',kind:stationQuery?'stops':'arrivals',...(stationQuery?{stops}:{arrivals:rows}),fetchedAt:stamp});
  };
}
test('provider preflight verifies live-source fields without exposing credentials',async()=>{
  const result=await probeTdx({credentials,fetcher:mock(),now});
  assert.equal(result.ready,true);assert.equal(result.countdownVerified,true);
  for(const secret of ['test-bearer',credentials.clientSecret,credentials.clientId]) assert.ok(!JSON.stringify(result).includes(secret));
});
test('both server credential fields are mandatory before network access',async()=>{
  for(const c of [{},{clientId:'x'},{clientSecret:'x'},{clientId:' ',clientSecret:'x'}]) await assert.rejects(probeTdx({credentials:c,fetcher:()=>assert.fail('must not request')}),/tdx-not-configured/);
});
test('authorization, quota and arbitrary provider errors are sanitized',async()=>{
  for(const [status,code] of [[401,'not-authorized'],[403,'not-authorized'],[429,'rate-limited'],[500,'service-unavailable']]) await assert.rejects(probeTdx({credentials,fetcher:mock({errorStatus:status}),now,rateLimitDelays:[]}),new RegExp(`^Error: ${code}$`));
});
test('station absence, wrong campus and invalid coordinates cannot pass',async()=>{
  for(const stops of [[],[{...stop,name:'別校'}],[{...stop,lat:0}]]) await assert.rejects(probeTdx({credentials,fetcher:mock({stops}),now}),/no-verified-campus-station/);
});
test('empty ETA data is not silently certified',async()=>{
  await assert.rejects(probeTdx({credentials,fetcher:mock({rows:[]}),now}),/no-fresh-directional-arrival/);
});
test('invalid direction, missing time, stale and future source rows cannot pass',()=>{
  for(const change of [{direction:null},{direction:255},{route:''},{updatedAt:null},{updatedAt:'invalid'},{updatedAt:new Date(now()-90000).toISOString()},{updatedAt:new Date(now()+31000).toISOString()},{seconds:null},{seconds:-1},{status:8}]) assert.equal(verifiedArrival({...arrival,...change},now()),null);
});
test('an old source timestamp cannot be refreshed by a new HTTP update timestamp',async()=>{
  await assert.rejects(probeTdx({credentials,fetcher:mock({rawTime:new Date(now()-90000).toISOString()}),now}),/no-fresh-directional-arrival/);
});
test('fresh end-of-service information is distinct from a countdown',async()=>{
  const result=await probeTdx({credentials,fetcher:mock({rows:[{...arrival,status:3,seconds:null}]}),now});
  assert.equal(result.ready,true);assert.equal(result.countdownVerified,false);assert.equal(result.checked[0].arrivals[0].status,3);
});
test('public check accepts the campus loading shell and still verifies live data separately',async()=>{
  const result=await probePublic(sha,{fetcher:mock({provider:false}),now});
  assert.equal(result.ready,true);assert.equal(result.revision,sha);assert.equal(result.physicalDeviceVerified,false);
  assert.equal(result.browserControlsVerified,false);
  assert.equal(result.directionVerified,true);assert.equal(result.sourceFreshnessVerified,true);
});
test('bus shell recognition follows the server marker rather than hydrated route copy',()=>{
  assert.equal(busLoadingHtml.includes('往沙鹿'),false);
  assert.equal(busLoadingHtml.includes('公車與交通'),false);
  assert.equal(hasBusShell(busLoadingHtml),true);
  for(const html of [null,'','<h1>公車與交通</h1>','<div>data-campus-bus-shell="true" 往沙鹿</div>',
    '<div data-campus-bus-shell="false">公車與交通</div>',
    '<div data-campus-bus-shell="true-ish">公車與交通</div>',
    '<div x-data-campus-bus-shell="true">公車與交通</div>',
    '&lt;div data-campus-bus-shell="true"&gt;公車與交通&lt;/div&gt;',
    '<div data-campus-bus-shell="true">公車與交通往沙鹿</div>']) {
    assert.equal(hasBusShell(html),false,JSON.stringify(html));
  }
});
test('an old revision and old bus page stop public certification',async()=>{
  await assert.rejects(probePublic(sha,{fetcher:mock({provider:false,healthRevision:'b'.repeat(40)}),now}),/public-revision-not-ready/);
  await assert.rejects(probePublic(sha,{fetcher:mock({provider:false,page:false}),now}),/new-bus-page-missing/);
});
test('HTML errors and transport failures fail closed',async()=>{
  await assert.rejects(probeTdx({credentials,fetcher:async()=>new Response('login'),now}),/invalid-response/);
  await assert.rejects(probeTdx({credentials,fetcher:async()=>{throw new Error('private-detail');},now}),/network-unavailable/);
});
test('remote command transmits source only and supports shell quoting',()=>{
  const command=buildRemoteCommand('export async function probeRuntime(){return {ready:true,profile:"live-tdx",transitReady:true,provider:"TDX",stationCount:2,directionVerified:true,sourceFreshnessVerified:true}}');
  const output=execFileSync('/bin/sh',['-c',command],{encoding:'utf8'});
  assert.equal(parseRemoteReport(output).ready,true);
  assert.ok(!command.includes(credentials.clientSecret));
});
test('remote stdout is allowlisted and cannot masquerade as a passing check',()=>{
  const good={ready:true,profile:'live-tdx',transitReady:true,provider:'TDX',stationCount:1,directionVerified:true,sourceFreshnessVerified:true,secret:'never-persist'};
  assert.ok(!JSON.stringify(parseRemoteReport('CAMPUS_TRANSIT_PROBE:'+JSON.stringify(good))).includes('never-persist'));
  for(const line of ['', 'CAMPUS_TRANSIT_PROBE:{}','CAMPUS_TRANSIT_PROBE:broken','CAMPUS_TRANSIT_PROBE:{}\nCAMPUS_TRANSIT_PROBE:{}']) assert.throws(()=>parseRemoteReport(line));
});

test('a single 429 is retried on the same request and can still verify fresh data',async()=>{
  let tokenCalls=0; const sleeps=[];
  const base=mock(); let etaCalls=0;
  const fetcher=async(url,init)=>{
    if(url.includes('/openid-connect/token')) { tokenCalls+=1; if(tokenCalls===1) return Response.json({},{status:429}); }
    if(url.includes('EstimatedTimeOfArrival')) { etaCalls+=1; }
    return base(url,init);
  };
  const result=await probeTdx({credentials,fetcher,now,sleep:async(ms)=>{sleeps.push(ms);},rateLimitDelays:[123,456]});
  assert.equal(result.ready,true); assert.deepEqual(sleeps,[123]); assert.equal(tokenCalls,2); assert.equal(etaCalls,1);
});
test('persistent 429 still fails closed as rate-limited after bounded retries',async()=>{
  const sleeps=[];
  await assert.rejects(probeTdx({credentials,fetcher:mock({errorStatus:429}),now,sleep:async(ms)=>{sleeps.push(ms);},rateLimitDelays:[1,2]}),/rate-limited/);
  assert.deepEqual(sleeps,[1,2]);
});
test('remote failures keep only sanitized codes and never provider or credential detail',()=>{
  assert.equal(sanitizedRemoteFailure(new Error('rate-limited')),'rate-limited');
  assert.equal(sanitizedRemoteFailure(new Error('client-secret-must-not-appear')),'runtime-transit-preflight-failed');
  const failing='export async function probeRuntime(){throw new Error("rate-limited")} export function sanitizedRemoteFailure(e){return e.message==="rate-limited"?"rate-limited":"runtime-transit-preflight-failed"}';
  let execError;
  try { execFileSync('/bin/sh',['-c',buildRemoteCommand(failing)],{encoding:'utf8'}); } catch (error) { execError=error; }
  assert.ok(execError?.stdout?.includes('"reason":"rate-limited"'));
  assert.equal(failureFromFlyExecError(execError),'rate-limited');
});
test('remote ready:false report surfaces its sanitized code through parsing and fly exec errors',()=>{
  const stdout='CAMPUS_TRANSIT_PROBE:'+JSON.stringify({ready:false,reason:'rate-limited'});
  assert.throws(()=>parseRemoteReport(stdout),/rate-limited/);
  assert.equal(failureFromFlyExecError({stdout}),'rate-limited');
  assert.equal(failureFromFlyExecError({stdout:'CAMPUS_TRANSIT_PROBE:'+JSON.stringify({ready:false,reason:'secret-detail'})}),'runtime-transit-preflight-failed');
  assert.equal(failureFromFlyExecError({}),'fly-runtime-probe-failed');
  assert.equal(failureFromFlyExecError({stdout:'not-a-probe'}),'runtime-probe-output-invalid');
});

const linksProfile = 'official-links-only';
const shell = '<div data-campus-bus-shell="true" data-campus-bus-spec="v1">公車</div>';
const officialNotice = '<aside data-transit-mode="official-links"><h2>即時到站尚未啟用</h2><a href="https://citybus-free.taichung.gov.tw/" target="_blank">臺中市官方公車查詢 ↗</a></aside>';
function unconfiguredPublic({status=503, body={status:'unavailable',reason:'not-configured'}, contentType='application/json', notice=officialNotice, health={}}={}) {
  return async (url, init) => {
    assert.equal(new URL(url).origin, ORIGIN);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    if (url.endsWith('/health/ready')) return Response.json({service:'campus-one-web',status:'ready',legacy:'ready',revision:sha,...health});
    if (url.endsWith('/bus')) return new Response(shell+notice,{headers:{'Content-Type':'text/html','Permissions-Policy':'geolocation=(self)'}});
    assert.ok(url.endsWith('/api/transit'));
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Origin, ORIGIN);
    assert.deepEqual(JSON.parse(init.body), {action:'campus',schoolId:'pu'});
    return new Response(JSON.stringify(body),{status,headers:{'Content-Type':contentType}});
  };
}
test('profiles are explicit and unknown or empty choices fail before network or runtime access',async()=>{
  assert.equal(validateProfile(), 'live-tdx');
  for (const profile of ['', 'optional', 'LIVE-TDX', null]) {
    assert.throws(()=>validateProfile(profile), /unknown-transit-profile/);
    await assert.rejects(probeRuntime(profile,{credentials:{},fetcher:()=>assert.fail('must not request')}), /unknown-transit-profile/);
    await assert.rejects(probePublic(sha,{profile,fetcher:()=>assert.fail('must not request')}), /unknown-transit-profile/);
    assert.throws(()=>buildRemoteCommand('',profile), /unknown-transit-profile/);
  }
});
test('official links runtime requires complete absence and never requests TDX',async()=>{
  const report=await probeRuntime(linksProfile,{credentials:{},fetcher:()=>assert.fail('must not request')});
  assert.deepEqual(report,{ready:true,profile:linksProfile,mode:'official-links',transitReady:false,credentialsAbsent:true,reason:'not-configured',physicalDeviceVerified:false});
  for (const credentials of [{clientId:'x'}, {clientSecret:'x'}, {clientId:''}, {clientSecret:' '}, {clientId:null}]) {
    await assert.rejects(probeRuntime(linksProfile,{credentials,fetcher:()=>assert.fail('must not request')}), /tdx-partial-configuration/);
  }
  for (const credentials of [{clientId:'x',clientSecret:'y'},{clientId:'',clientSecret:''},{clientId:' ',clientSecret:' '}]) {
    await assert.rejects(probeRuntime(linksProfile,{credentials,fetcher:()=>assert.fail('must not request')}), /tdx-credentials-present/);
  }
});
test('default runtime remains strict and never falls back after a provider failure',async()=>{
  await assert.rejects(probeRuntime(undefined,{credentials:{},fetcher:()=>assert.fail('must not request')}), /tdx-not-configured/);
  await assert.rejects(probeRuntime('live-tdx',{credentials,fetcher:mock({errorStatus:429}),now,rateLimitDelays:[]}), /rate-limited/);
  const report=await probeRuntime('live-tdx',{credentials,fetcher:mock(),now});
  assert.equal(report.transitReady,true);
  assert.equal(report.profile,'live-tdx');
});
test('official links public report distinguishes usable Web from unavailable transit and untested browser controls',async()=>{
  const report=await probePublic(sha,{profile:linksProfile,fetcher:unconfiguredPublic(),now});
  assert.equal(report.webReady,true);
  assert.equal(report.transitReady,false);
  assert.equal(report.serverNoticeVerified,true);
  assert.equal(report.browserControlsVerified,false);
  assert.equal(report.liveArrivalsVerified,false);
  assert.equal(report.officialHref,'https://citybus-free.taichung.gov.tw/');
});
test('links profile rejects wrong health revision and unavailable legacy service',async()=>{
  for (const health of [{revision:'b'.repeat(40)},{legacy:'disabled'},{status:'unavailable'},{service:'other'}]) {
    await assert.rejects(probePublic(sha,{profile:linksProfile,fetcher:unconfiguredPublic({health}),now}), /public-revision-not-ready/);
  }
});
test('links profile cannot convert authorization, provider outages, quotas or fabricated data into success',async()=>{
  for (const status of [200,400,401,403,429,500]) {
    await assert.rejects(probePublic(sha,{profile:linksProfile,fetcher:unconfiguredPublic({status}),now}), /public-transit-not-explicitly-unconfigured/);
  }
  for (const body of [{status:'unavailable',reason:'upstream'},{status:'ready',kind:'stops',stops:[]},{status:'unavailable',reason:'not-configured',arrivals:[]},null]) {
    await assert.rejects(probePublic(sha,{profile:linksProfile,fetcher:unconfiguredPublic({body}),now}), /public-transit-not-explicitly-unconfigured/);
  }
  await assert.rejects(probePublic(sha,{profile:linksProfile,fetcher:unconfiguredPublic({contentType:'text/html'}),now}), /public-transit-not-explicitly-unconfigured/);
  await assert.rejects(probePublic(sha,{fetcher:unconfiguredPublic(),now}), /service-unavailable/);
});
test('links profile requires real server notice and exact official destination rather than arbitrary HTML text',async()=>{
  for (const notice of ['',officialNotice.replace('即時到站尚未啟用','即時到站已啟用'),officialNotice.replace('https://citybus-free.taichung.gov.tw/','https://citybus-free.taichung.gov.tw.evil.example/'),officialNotice.replace('臺中市官方公車查詢','立即開始'),officialNotice.replace('<a href=','<p href=')]) {
    await assert.rejects(probePublic(sha,{profile:linksProfile,fetcher:unconfiguredPublic({notice}),now}), /official-transit-notice-missing/);
  }
  assert.equal(verifyOfficialNotice(officialNotice.replace('https://citybus-free.taichung.gov.tw/','https://citybus.taichung.gov.tw/')),'https://citybus.taichung.gov.tw/');
  assert.equal(hasBusShell('<div>data-campus-bus-shell="true" data-campus-bus-spec="v1" 公車與交通</div>'),false);
  assert.equal(hasBusShell('<div data-campus-bus-shell="true">往沙鹿</div>'),false);
  assert.equal(hasBusShell('<div data-campus-bus-shell="true">公車與交通</div>'),false);
  assert.equal(hasBusShell('<div data-campus-bus-shell="true">公車</div>'),false);
  assert.equal(hasBusShell('<div data-campus-bus-shell="true" data-campus-bus-spec="v1"></div>'),true);
  assert.equal(hasBusShell('<div data-campus-bus-spec="v1" data-campus-bus-shell="true">讀取校園交通資料…</div>'),true);
});
test('remote profile reports cannot be confused or persist arbitrary provider content',()=>{
  const links={ready:true,profile:linksProfile,mode:'official-links',transitReady:false,credentialsAbsent:true,reason:'not-configured',privateDetail:'must-not-persist'};
  const stdout='CAMPUS_TRANSIT_PROBE:'+JSON.stringify(links);
  assert.equal(parseRemoteReport(stdout,linksProfile).transitReady,false);
  assert.ok(!JSON.stringify(parseRemoteReport(stdout,linksProfile)).includes('must-not-persist'));
  assert.throws(()=>parseRemoteReport(stdout),/runtime-transit-not-ready/);
  for (const change of [{profile:'live-tdx'},{transitReady:true},{credentialsAbsent:false},{reason:'upstream'},{mode:'TDX'}]) {
    assert.throws(()=>parseRemoteReport('CAMPUS_TRANSIT_PROBE:'+JSON.stringify({...links,...change}),linksProfile), /runtime-official-links-not-ready/);
  }
});
test('remote source executes the chosen links profile without loading local environment values',()=>{
  const source='export async function probeRuntime(profile){if(profile!=="official-links-only")throw new Error("bad-profile");return {ready:true,profile,mode:"official-links",transitReady:false,credentialsAbsent:true,reason:"not-configured"}}';
  const output=execFileSync('/bin/sh',['-c',buildRemoteCommand(source,linksProfile)],{encoding:'utf8'});
  assert.equal(parseRemoteReport(output,linksProfile).transitReady,false);
});

const catalogProfile='static-catalog';
const catalogStop={...stop,id:'TCOD_1',source:'taichung-open-data',catalogDate:stamp,distance:null,
  routes:[{name:'300',direction:'去',destination:'靜宜大學'}]};
const catalogNotice='<aside data-transit-mode="static-catalog">臺中站牌可查詢，班次時間請至官方網站確認<a href="https://citybus.taichung.gov.tw/">臺中市官方公車查詢</a></aside>';
function catalogPublic({stops=[catalogStop],notice=catalogNotice,arrivals={status:'unavailable',reason:'not-configured'},arrivalStatus=503,wrongNearby=false,fetchedAt=stamp}={}) {
  return async(url,init)=>{
    assert.equal(new URL(url).origin,ORIGIN);
    assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
    if(url.endsWith('/health/ready')) return Response.json({service:'campus-one-web',status:'ready',legacy:'ready',revision:sha});
    if(url.endsWith('/bus')) return new Response(shell+notice,{headers:{'Content-Type':'text/html','Permissions-Policy':'geolocation=(self)'}});
    const query=JSON.parse(init.body);
    if(query.action==='arrivals')return Response.json(arrivals,{status:arrivalStatus});
    if(query.city==='Taipei')return Response.json({status:'unavailable',reason:'not-configured'},{status:503});
    return Response.json({status:'ready',kind:'stops',stops:query.action==='nearby'?stops.map(row=>({...row,distance:wrongNearby?301:0})):stops,limited:false,fetchedAt});
  };
}
test('catalog runtime needs absent credentials and cannot be confused with a live arrival proof',async()=>{
  const report=await probeRuntime(catalogProfile,{credentials:{},fetcher:()=>assert.fail('no provider request')});
  assert.equal(report.mode,catalogProfile);assert.equal(report.transitReady,false);
  assert.equal(parseRemoteReport('CAMPUS_TRANSIT_PROBE:'+JSON.stringify(report),catalogProfile).credentialsAbsent,true);
  assert.throws(()=>parseRemoteReport('CAMPUS_TRANSIT_PROBE:'+JSON.stringify(report)),/runtime-transit-not-ready/);
  await assert.rejects(probeRuntime(catalogProfile,{credentials:{clientId:'x'}}),/tdx-partial-configuration/);
});
test('catalog public verification checks real source shape, campus/search/nearby and unavailable arrivals independently',async()=>{
  const report=await probePublic(sha,{profile:catalogProfile,fetcher:catalogPublic(),now});
  assert.equal(report.stationCatalogReady,true);assert.equal(report.liveArrivalsVerified,false);
  assert.equal(report.nearbyVerified,true);assert.equal(report.catalogDate,stamp);
  assert.equal(report.transitReady,false);assert.equal(report.physicalDeviceVerified,false);
});
test('catalog certification rejects missing metadata, wrong city, duplicate IDs, stale snapshots and fabricated arrivals',async()=>{
  for(const stops of [[],[{...catalogStop,source:'TDX'}],[{...catalogStop,id:'TCOD_'}],[{...catalogStop,catalogDate:'2026-02-31T00:00:00Z'}],[{...catalogStop,city:'Taipei'}],
    [{...catalogStop,catalogDate:null}],[{...catalogStop,catalogDate:new Date(now()-181*86400_000).toISOString()}],
    [{...catalogStop,catalogDate:new Date(now()+31_000).toISOString()}],[{...catalogStop,routes:[]}],[catalogStop,catalogStop]])
    await assert.rejects(probePublic(sha,{profile:catalogProfile,fetcher:catalogPublic({stops}),now}),/static-catalog-(station-invalid|not-ready)/);
  await assert.rejects(probePublic(sha,{profile:catalogProfile,fetcher:catalogPublic({wrongNearby:true}),now}),/static-catalog-nearby-mismatch/);
  await assert.rejects(probePublic(sha,{profile:catalogProfile,fetcher:catalogPublic({arrivalStatus:200,arrivals:{status:'ready',kind:'arrivals',arrivals:[]}}),now}),/static-catalog-response-invalid/);
  await assert.rejects(probePublic(sha,{profile:catalogProfile,fetcher:catalogPublic({arrivals:{status:'unavailable',reason:'upstream'}}),now}),/static-catalog-unavailable-state-invalid/);
  await assert.rejects(probePublic(sha,{profile:catalogProfile,fetcher:catalogPublic({notice:catalogNotice.replace('https://citybus.taichung.gov.tw/','https://evil.example/')}),now}),/static-catalog-notice-missing/);
});

test('catalog proof rejects missing or stale response timestamps that the App cannot consume',async()=>{
  for(const fetchedAt of [null,'invalid',new Date(now()-301_000).toISOString()])
    await assert.rejects(probePublic(sha,{profile:catalogProfile,fetcher:catalogPublic({fetchedAt}),now}),/static-catalog-not-ready/);
});

// The public server answers 429 with Retry-After while the shared TDX key is cooling down.
function publicWith429({failTimes=1,retryAfter='60',onAction='campus',status=429}={}) {
  const base=mock({provider:false}); let failures=0; const calls=[];
  const fetcher=async(url,init)=>{
    if(url.endsWith('/api/transit')) {
      const action=JSON.parse(init.body).action; calls.push(action);
      if(action===onAction && failures<failTimes) {
        failures+=1;
        return Response.json({status:'unavailable',reason:'rate-limited'},{status,headers:retryAfter===null?{}:{'Retry-After':retryAfter}});
      }
    }
    return base(url,init);
  };
  return {fetcher,calls};
}
test('public check waits out a 429 using Retry-After and still verifies the same request',async()=>{
  const sleeps=[]; const {fetcher,calls}=publicWith429();
  const result=await probePublic(sha,{fetcher,now,sleep:async(ms)=>{sleeps.push(ms);}});
  assert.equal(result.ready,true); assert.deepEqual(sleeps,[60_000]);
  assert.deepEqual(calls,['campus','campus','arrivals']);
});
test('public check uses its own delay when Retry-After is missing or shorter, and retries arrivals too',async()=>{
  const sleeps=[]; const {fetcher}=publicWith429({retryAfter:null,onAction:'arrivals'});
  assert.equal((await probePublic(sha,{fetcher,now,sleep:async(ms)=>{sleeps.push(ms);}})).ready,true);
  assert.deepEqual(sleeps,[30_000]);
  const short=[]; const second=publicWith429({retryAfter:'1'});
  await probePublic(sha,{fetcher:second.fetcher,now,sleep:async(ms)=>{short.push(ms);}});
  assert.deepEqual(short,[30_000]);
});
test('a provider-chosen Retry-After is capped so a release cannot hang',async()=>{
  const sleeps=[]; const {fetcher}=publicWith429({retryAfter:'99999'});
  await probePublic(sha,{fetcher,now,sleep:async(ms)=>{sleeps.push(ms);},maxRateLimitWaitMs:1_000_000});
  assert.deepEqual(sleeps,[120_000]);
});
test('persistent public 429 fails closed as rate-limited within the bounded attempts and total wait',async()=>{
  const sleeps=[]; const {fetcher,calls}=publicWith429({failTimes:99});
  await assert.rejects(probePublic(sha,{fetcher,now,sleep:async(ms)=>{sleeps.push(ms);}}),/^Error: rate-limited$/);
  assert.deepEqual(sleeps,[60_000,60_000,60_000]); assert.equal(calls.length,4);
  const budget=[]; const tight=publicWith429({failTimes:99});
  await assert.rejects(probePublic(sha,{fetcher:tight.fetcher,now,sleep:async(ms)=>{budget.push(ms);},maxRateLimitWaitMs:100_000}),/rate-limited/);
  assert.deepEqual(budget,[60_000]);
});
test('the total wait budget is shared across every public request',async()=>{
  const base=mock({provider:false}); const seen=new Map(); const sleeps=[];
  const fetcher=async(url,init)=>{
    if(url.endsWith('/api/transit')) {
      const action=JSON.parse(init.body).action; const n=(seen.get(action)??0)+1; seen.set(action,n);
      if(n===1) return Response.json({status:'unavailable',reason:'rate-limited'},{status:429,headers:{'Retry-After':'60'}});
    }
    return base(url,init);
  };
  await assert.rejects(probePublic(sha,{fetcher,now,sleep:async(ms)=>{sleeps.push(ms);},maxRateLimitWaitMs:90_000}),/rate-limited/);
  assert.deepEqual(sleeps,[60_000]);
});
test('other public failures are never retried',async()=>{
  const sleeps=[]; const {fetcher,calls}=publicWith429({status:503});
  await assert.rejects(probePublic(sha,{fetcher,now,sleep:async(ms)=>{sleeps.push(ms);}}),/service-unavailable/);
  assert.deepEqual(sleeps,[]); assert.deepEqual(calls,['campus']);
});
test('Retry-After parsing accepts seconds or HTTP dates only and is capped',()=>{
  assert.equal(retryAfterMs('60'),60_000);
  assert.equal(retryAfterMs(' 0 '),0);
  assert.equal(retryAfterMs('99999'),120_000);
  assert.equal(retryAfterMs(new Date(now()+45_000).toUTCString(),now),45_000);
  for (const value of [null,undefined,'',' ','-5','1.5','soon',new Date(now()-1000).toUTCString()]) assert.equal(retryAfterMs(value,now),null);
});
test('the in-machine TDX probe keeps fixed delays and ignores a provider Retry-After',async()=>{
  const base=mock(); let tokenCalls=0; const sleeps=[];
  const fetcher=async(url,init)=>{
    if(url.includes('/openid-connect/token')&&++tokenCalls===1) return Response.json({},{status:429,headers:{'Retry-After':'300'}});
    return base(url,init);
  };
  assert.equal((await probeTdx({credentials,fetcher,now,sleep:async(ms)=>{sleeps.push(ms);},rateLimitDelays:[123]})).ready,true);
  assert.deepEqual(sleeps,[123]);
});
test('rate-limit retry helper rethrows non-429 errors immediately',async()=>{
  let calls=0;
  await assert.rejects(withRateLimitRetry(async()=>{calls+=1; throw new Error('not-authorized');},{delays:[1,1],sleep:async()=>assert.fail('must not wait')}),/not-authorized/);
  assert.equal(calls,1);
});


test('the complete runtime module fits a small exec request and runs after in-memory decompression',()=>{
  const source=readFileSync(new URL('./transit-release-gate.mjs',import.meta.url),'utf8');
  const command=buildRemoteCommand(source,catalogProfile);
  assert.ok(Buffer.byteLength(JSON.stringify({cmd:command,timeout:300})) < 12*1024,
    'keep the real module comfortably below the observed exec payload rejection size');
  const env={...process.env};
  delete env.TDX_CLIENT_ID; delete env.TDX_CLIENT_SECRET;
  const stdout=execFileSync('/bin/sh',['-c',command],{encoding:'utf8',env});
  const report=parseRemoteReport(stdout,catalogProfile);
  assert.equal(report.ready,true);
  assert.equal(report.credentialsAbsent,true);
});
test('a module that fails to load still reports a sanitized marker instead of empty stdout',()=>{
  let execError;
  try { execFileSync('/bin/sh',['-c',buildRemoteCommand('this is not javascript {',catalogProfile)],{encoding:'utf8'}); }
  catch (error) { execError=error; }
  assert.ok(execError);
  assert.equal(failureFromFlyExecError(execError,catalogProfile),'runtime-transit-preflight-failed');
  assert.ok(String(execError.stdout||'').includes('CAMPUS_TRANSIT_PROBE:'));
  assert.ok(!String(execError.stdout||'').includes('this is not javascript'));
});

test('runtime probe uses the existing Machines API target and token without SSH or a shell on the runner',()=>{
  const command=buildRemoteCommand('export async function probeRuntime(){return {ready:true,profile:"static-catalog",mode:"static-catalog",transitReady:false,credentialsAbsent:true,reason:"not-configured"}}',catalogProfile);
  const calls=[];
  const execute=(file,args,options)=>{
    calls.push({file,args,options});
    // The local fixture interprets the command as the remote shell would.
    const stdout=execFileSync('/bin/sh',['-c',args.at(-1)],{encoding:'utf8'});
    // fly-go omits exit_code=0 and an empty stderr from its JSON response.
    return JSON.stringify({stdout});
  };
  for (const machine of MACHINE_IDS) {
    const report=probeFlyMachine(machine,command,catalogProfile,execute);
    assert.equal(report.machineId,machine);
    assert.equal(report.credentialsAbsent,true);
  }
  assert.equal(calls.length,2);
  for (let i=0;i<calls.length;i+=1) {
    assert.equal(calls[i].file,'flyctl');
    assert.deepEqual(calls[i].args,['machine','exec',MACHINE_IDS[i],'--app','nuni-web','--timeout','300','--json',command]);
    assert.equal(calls[i].options.timeout,310_000);
    assert.deepEqual(calls[i].options.stdio,['ignore','pipe','pipe']);
    assert.equal(calls[i].options.env,undefined);
  }
});
test('machine transport rejects other targets and preserves sanitized failure behavior',()=>{
  const forbidden=()=>assert.fail('must not execute');
  assert.throws(()=>probeFlyMachine('other','command',catalogProfile,forbidden),/unexpected-machine-target/);
  assert.throws(()=>probeFlyMachine(MACHINE_IDS[0],'command','other',forbidden),/unknown-transit-profile/);
  for (const [error,code] of [
    [{stdout:'CAMPUS_TRANSIT_PROBE:{"ready":false,"reason":"rate-limited"}'},'rate-limited'],
    [{stdout:'CAMPUS_TRANSIT_PROBE:{"ready":false,"reason":"private-value"}',stderr:'private-value'},'runtime-transit-preflight-failed'],
    [{stderr:'private-value'},'fly-runtime-probe-failed'],
  ]) assert.throws(()=>probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,()=>{throw error;}),new RegExp(`^Error: ${code}$`));
  assert.throws(()=>probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,()=> 'arbitrary-output'),/runtime-probe-output-invalid/);
});

const successfulMachineStdout='CAMPUS_TRANSIT_PROBE:'+JSON.stringify({ready:true,profile:catalogProfile,
  mode:catalogProfile,transitReady:false,credentialsAbsent:true,reason:'not-configured'})+'\n';

test('machine JSON accepts actual omitted-zero and explicit-zero success without persisting stderr',()=>{
  for (const fields of [{},{exit_code:0},{exit_code:0,stderr:''},{stderr:'private-value'}]) {
    const result=probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,
      ()=>JSON.stringify({stdout:successfulMachineStdout,...fields}));
    assert.equal(result.ready,true);
    assert.equal(result.machineId,MACHINE_IDS[0]);
    assert.ok(!JSON.stringify(result).includes('private-value'));
    assert.equal(Object.hasOwn(result,'stderr'),false);
  }
});

test('a successful marker cannot override a nonzero remote exit code',()=>{
  for (const exit_code of [1,9,137,-1]) {
    assert.throws(()=>probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,
      ()=>JSON.stringify({exit_code,stdout:successfulMachineStdout,stderr:'private-value'})),
    /^Error: fly-runtime-probe-failed$/);
  }
});

test('machine transport refuses malformed JSON, wrong response shapes and noninteger exit codes',()=>{
  const replies=[null,[],{},'private-value',0,
    {stdout:null},{stdout:0},{stdout:{}},{stdout:['CAMPUS_TRANSIT_PROBE:']},
    {stdout:successfulMachineStdout,stderr:null},{stdout:successfulMachineStdout,stderr:{}},
    {stdout:successfulMachineStdout,exitCode:0},
    {stdout:successfulMachineStdout,extra:'private-value'},
    ...[null,false,true,'0',0.5,{},[]].map(exit_code=>({stdout:successfulMachineStdout,exit_code}))];
  for (const reply of replies) {
    assert.throws(()=>probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,()=>JSON.stringify(reply)),
      /^Error: runtime-probe-output-invalid$/);
  }
  for (const reply of ['', '{', successfulMachineStdout, 'Exit code: 1\n'+successfulMachineStdout,
    JSON.stringify({stdout:successfulMachineStdout})+'\n'+JSON.stringify({stdout:successfulMachineStdout})]) {
    assert.throws(()=>probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,()=>reply),
      /^Error: runtime-probe-output-invalid$/);
  }
});

test('machine JSON requires one valid stdout report and never accepts a stderr success marker',()=>{
  for (const stdout of ['', 'private-value', successfulMachineStdout+successfulMachineStdout,
    'CAMPUS_TRANSIT_PROBE:{"ready":true}\n']) {
    assert.throws(()=>probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,
      ()=>JSON.stringify({stdout,stderr:successfulMachineStdout})),
    /^Error: runtime-(?:probe-output-invalid|official-links-not-ready)$/);
  }
});

test('Machines API transport retries only fly-runtime-probe-failed and then succeeds',()=>{
  const waits=[]; let calls=0;
  const execute=()=>{
    calls+=1;
    if (calls<3) throw {stderr:'private-value'};
    return JSON.stringify({stdout:successfulMachineStdout});
  };
  const report=probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,execute,{
    retries:2,retryDelays:[11,22],wait:(ms)=>waits.push(ms),
  });
  assert.equal(report.ready,true);
  assert.equal(calls,3);
  assert.deepEqual(waits,[11,22]);
});
test('transport retries never wait for sanitized application failures',()=>{
  let calls=0;
  assert.throws(()=>probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,()=>{
    calls+=1;
    throw {stdout:'CAMPUS_TRANSIT_PROBE:'+JSON.stringify({ready:false,reason:'rate-limited'})};
  },{retries:2,retryDelays:[1],wait:()=>assert.fail('must not wait')}),/^Error: rate-limited$/);
  assert.equal(calls,1);
});

test('remote failure JSON retains only allowlisted reasons and never reveals either stderr stream',()=>{
  for (const [reason,code] of [['rate-limited','rate-limited'],['private-value','runtime-transit-preflight-failed']]) {
    assert.throws(()=>probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,()=>JSON.stringify({exit_code:1,
      stdout:'CAMPUS_TRANSIT_PROBE:'+JSON.stringify({ready:false,reason}),stderr:'private-value'})),
    (error)=>error.message===code && !String(error).includes('private-value'));
  }
  assert.throws(()=>probeFlyMachine(MACHINE_IDS[0],'command',catalogProfile,()=>{throw {stderr:successfulMachineStdout+'private-value'};}),
    /^Error: fly-runtime-probe-failed$/);
});
