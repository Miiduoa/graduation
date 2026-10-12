import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {TDX,ORIGIN,probeTdx,probePublic,verifiedArrival,buildRemoteCommand,parseRemoteReport} from './transit-release-gate.mjs';
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
    if (!provider && url.endsWith('/bus')) return new Response(page ? '學校站牌 找我附近 搜尋站名 常用站牌' : 'Old bus page',{headers:{'Content-Type':'text/html','Permissions-Policy':'geolocation=(self)'}});
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
  for(const [status,code] of [[401,'not-authorized'],[403,'not-authorized'],[429,'rate-limited'],[500,'service-unavailable']]) await assert.rejects(probeTdx({credentials,fetcher:mock({errorStatus:status}),now}),new RegExp(`^Error: ${code}$`));
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
test('public check uses only same-origin POST and verifies the exact revision',async()=>{
  const result=await probePublic(sha,{fetcher:mock({provider:false}),now});
  assert.equal(result.ready,true);assert.equal(result.revision,sha);assert.equal(result.physicalDeviceVerified,false);
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
  const command=buildRemoteCommand('export async function probeTdx(){return {ready:true,provider:"TDX",stationCount:2,directionVerified:true,sourceFreshnessVerified:true}}');
  const output=execFileSync('/bin/sh',['-c',command],{encoding:'utf8'});
  assert.equal(parseRemoteReport(output).ready,true);
  assert.ok(!command.includes(credentials.clientSecret));
});
test('remote stdout is allowlisted and cannot masquerade as a passing check',()=>{
  const good={ready:true,provider:'TDX',stationCount:1,directionVerified:true,sourceFreshnessVerified:true,secret:'never-persist'};
  assert.ok(!JSON.stringify(parseRemoteReport('CAMPUS_TRANSIT_PROBE:'+JSON.stringify(good))).includes('never-persist'));
  for(const line of ['', 'CAMPUS_TRANSIT_PROBE:{}','CAMPUS_TRANSIT_PROBE:broken','CAMPUS_TRANSIT_PROBE:{}\nCAMPUS_TRANSIT_PROBE:{}']) assert.throws(()=>parseRemoteReport(line));
});
