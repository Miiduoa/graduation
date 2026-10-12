import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const TDX = 'https://tdx.transportdata.tw';
export const ORIGIN = 'https://nuni.tw';
export const MACHINE_IDS = ['683e513be2d358', '80e447b6140178'];
const CITY = 'Taichung';
const MARKER = 'CAMPUS_TRANSIT_PROBE:';
const FRESH_MS = 90_000;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' ? v.trim().slice(0, 120) : '';
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v);
class GateError extends Error {}
const fail = (code) => { throw new GateError(code); };

async function json(url, init = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, { ...init, cache: 'no-store', redirect: 'error',
      credentials: 'omit', signal: AbortSignal.timeout(10_000) });
  } catch { fail('network-unavailable'); }
  if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'not-authorized' :
    response.status === 429 ? 'rate-limited' : 'service-unavailable');
  if (!response.headers.get('content-type')?.includes('application/json')) fail('invalid-response');
  try { return await response.json(); } catch { fail('invalid-response'); }
}

export function verifiedArrival(row, now) {
  if (!record(row) || !text(row.route) || ![0, 1].includes(row.direction) ||
      ![0, 1, 2, 3, 4].includes(row.status)) return null;
  const timestamp = typeof row.updatedAt === 'string' ? Date.parse(row.updatedAt) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now + 30_000 || now - timestamp >= FRESH_MS) return null;
  if (row.status === 0 && !(typeof row.seconds === 'number' && Number.isFinite(row.seconds) && row.seconds >= 0)) return null;
  return { route: text(row.route), direction: row.direction, status: row.status,
    seconds: row.status === 0 ? row.seconds : null, updatedAt: new Date(timestamp).toISOString() };
}

function stopsFrom(rows, provider) {
  if (!Array.isArray(rows)) fail('invalid-station-response');
  const seen = new Set();
  return rows.map((row) => provider ? { id: row?.StopUID, name: text(row?.StopName?.Zh_tw),
    city: CITY, lat: row?.StopPosition?.PositionLat, lon: row?.StopPosition?.PositionLon } : row)
    .filter((row) => {
      if (!record(row) || !id(row.id) || row.city !== CITY || !text(row.name).includes('靜宜大學') ||
          !Number.isFinite(row.lat) || row.lat < 20 || row.lat > 27 ||
          !Number.isFinite(row.lon) || row.lon < 118 || row.lon > 123 || seen.has(row.id)) return false;
      seen.add(row.id); return true;
    }).slice(0, 16).map((row) => ({id: row.id, name: text(row.name), city: CITY, lat: row.lat, lon: row.lon}));
}

async function collect(stops, queryArrivals, provider, now) {
  if (!stops.length) fail('no-verified-campus-station');
  const checked = [];
  for (const stop of stops.slice(0, 3)) {
    const rows = await queryArrivals(stop.id);
    if (!Array.isArray(rows)) fail('invalid-arrival-response');
    const valid = rows.filter((row) => !provider || row?.StopUID === stop.id).map((row) => provider ? {
      route: row?.RouteName?.Zh_tw ?? row?.RouteName?.En,
      direction: row?.Direction, status: row?.StopStatus, seconds: row?.EstimateTime,
      updatedAt: row?.SrcUpdateTime || row?.UpdateTime,
    } : row).map((row) => verifiedArrival(row, now())).filter(Boolean);
    checked.push({stopId: stop.id, receivedCount: rows.length, freshCount: valid.length, arrivals: valid.slice(0, 12)});
    if (valid.length) return {ready: true, provider: 'TDX', checkedAt: new Date(now()).toISOString(),
      stationCount: stops.length, stops, checked, directionVerified: true, sourceFreshnessVerified: true,
      countdownVerified: valid.some((row) => row.status === 0), physicalDeviceVerified: false};
  }
  fail('no-fresh-directional-arrival');
}

export async function probeTdx({ credentials = {clientId: process.env.TDX_CLIENT_ID, clientSecret: process.env.TDX_CLIENT_SECRET},
  fetcher = fetch, now = Date.now } = {}) {
  const {clientId, clientSecret} = credentials;
  if (!text(clientId) || !text(clientSecret)) fail('tdx-not-configured');
  const auth = await json(`${TDX}/auth/realms/TDXConnect/protocol/openid-connect/token`, {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret}).toString(),
  }, fetcher);
  if (!record(auth) || typeof auth.access_token !== 'string' || !auth.access_token ||
      !Number.isFinite(auth.expires_in) || auth.expires_in <= 0) fail('invalid-token-response');
  const headers = {Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json'};
  const request = (path, filter, top) => json(`${TDX}/api/basic/v2/Bus/${path}/City/${CITY}?${new URLSearchParams({
    '$filter': filter, '$top': String(top), '$format': 'JSON'})}`, {headers}, fetcher);
  const stops = stopsFrom(await request('Stop', "contains(StopName/Zh_tw,'靜宜大學')", 32), true);
  return collect(stops, (stopId) => request('EstimatedTimeOfArrival', `StopUID eq '${stopId}'`, 200), true, now);
}

export async function probePublic(expectedRevision, {fetcher = fetch, now = Date.now} = {}) {
  if (!/^[a-f0-9]{40}$/.test(expectedRevision ?? '')) fail('exact-revision-required');
  const health = await json(`${ORIGIN}/health/ready`, {}, fetcher);
  if (health?.service !== 'campus-one-web' || health.status !== 'ready' || health.legacy !== 'ready' ||
      health.revision !== expectedRevision) fail('public-revision-not-ready');
  let page;
  try { page = await fetcher(`${ORIGIN}/bus`, {cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10_000)}); }
  catch { fail('public-page-unavailable'); }
  if (page.status !== 200 || !page.headers.get('content-type')?.includes('text/html') ||
      !/geolocation=\(self\)/.test(page.headers.get('permissions-policy') ?? '')) fail('public-page-not-ready');
  const html = await page.text();
  if (!['學校站牌','找我附近','搜尋站名','常用站牌'].every((label) => html.includes(label))) fail('new-bus-page-missing');
  const query = async (body, kind) => {
    const result = await json(`${ORIGIN}/api/transit`, {method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN},body:JSON.stringify(body)},fetcher);
    if (result?.status !== 'ready' || result.kind !== kind) fail('public-transit-not-ready');
    return result[kind];
  };
  const stops = stopsFrom(await query({action:'campus',schoolId:'pu'},'stops'), false);
  const report = await collect(stops, (stopId) => query({action:'arrivals',city:CITY,stopId},'arrivals'), false, now);
  return {...report, origin:ORIGIN, revision:expectedRevision};
}

export function buildRemoteCommand(source) {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const program = `import(${JSON.stringify(moduleUrl)}).then(m=>m.probeTdx()).then(r=>console.log(${JSON.stringify(MARKER)}+JSON.stringify(r))).catch(()=>{console.log(${JSON.stringify(MARKER)}+JSON.stringify({ready:false,reason:'runtime-transit-preflight-failed'}));process.exitCode=1})`;
  return `node --input-type=module -e '${program.replaceAll("'", "'\\''")}'`;
}

export function parseRemoteReport(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.startsWith(MARKER));
  if (lines.length !== 1) fail('runtime-probe-output-invalid');
  let value;
  try { value = JSON.parse(lines[0].slice(MARKER.length)); } catch { fail('runtime-probe-output-invalid'); }
  if (value?.ready !== true || value.provider !== 'TDX' || value.directionVerified !== true ||
      value.sourceFreshnessVerified !== true || !Number.isInteger(value.stationCount) || value.stationCount < 1)
    fail('runtime-transit-not-ready');
  // Never persist arbitrary stdout or provider fields from a remote process.
  return {ready:true,provider:'TDX',stationCount:value.stationCount,directionVerified:true,
    sourceFreshnessVerified:true,countdownVerified:value.countdownVerified === true,physicalDeviceVerified:false};
}

async function main() {
  const [mode, input] = process.argv.slice(2);
  await mkdir('release-evidence',{recursive:true});
  if (mode === 'public') {
    const report = await probePublic(process.env.EXPECTED_RELEASE_SHA);
    await writeFile('release-evidence/transit-public.json',JSON.stringify(report,null,2)+'\n');
    console.log('Verified the expected public revision, campus stations and fresh directional transit data.');
    return;
  }
  if (mode === 'fly') {
    if (!process.env.FLY_API_TOKEN) fail('fly-deploy-credential-missing');
    const rows = JSON.parse(await readFile(input,'utf8'));
    if (!Array.isArray(rows) || rows.length !== MACHINE_IDS.length ||
        new Set(rows.map((row) => row?.id)).size !== MACHINE_IDS.length ||
        !rows.every((row) => MACHINE_IDS.includes(row?.id) && row.state === 'started')) fail('unexpected-machine-target');
    const command = buildRemoteCommand(await readFile(new URL(import.meta.url),'utf8'));
    const reports = [];
    for (const row of rows) {
      let stdout;
      try {
        stdout = execFileSync('flyctl',['ssh','console','--app','nuni-web','--machine',row.id,'--quiet','--command',command],
          {encoding:'utf8',timeout:90_000,maxBuffer:256*1024,stdio:['ignore','pipe','pipe']});
      } catch { fail('fly-runtime-probe-failed'); }
      reports.push({machineId:row.id,...parseRemoteReport(stdout)});
    }
    await writeFile('release-evidence/transit-preflight.json',JSON.stringify({checkedAt:new Date().toISOString(),machines:reports},null,2)+'\n');
    console.log('Verified TDX inside every existing Web machine; credential values never left the machines.');
    return;
  }
  fail('expected-public-or-fly-mode');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  console.error(error instanceof GateError ? error.message : 'transit-release-check-failed');
  process.exitCode = 1;
});
