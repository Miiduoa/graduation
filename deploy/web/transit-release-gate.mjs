import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const TDX = 'https://tdx.transportdata.tw';
export const ORIGIN = 'https://nuni.tw';
export const MACHINE_IDS = ['683e513be2d358', '80e447b6140178'];
const CITY = 'Taichung';
const MARKER = 'CAMPUS_TRANSIT_PROBE:';
const FRESH_MS = 90_000;
const LIVE_PROFILE = 'live-tdx';
const LINKS_PROFILE = 'official-links-only';
const CATALOG_PROFILE = 'static-catalog';
const OFFICIAL_LINKS = ['https://citybus-free.taichung.gov.tw/', 'https://citybus.taichung.gov.tw/'];

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' ? v.trim().slice(0, 120) : '';
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v);
class GateError extends Error {}
const fail = (code) => { throw new GateError(code); };
// Only these sanitized codes may cross the Fly Machines exec boundary. They are fixed
// identifiers produced above, never provider response bodies or credential data.
const REMOTE_FAILURE_CODES = new Set(['tdx-not-configured','not-authorized','rate-limited','network-unavailable',
  'service-unavailable','invalid-response','invalid-token-response','no-verified-campus-station',
  'no-fresh-directional-arrival','invalid-station-response','invalid-arrival-response','tdx-credentials-present',
  'tdx-partial-configuration','unknown-transit-profile','runtime-transit-preflight-failed',
  'runtime-probe-output-invalid','runtime-transit-not-ready','runtime-official-links-not-ready']);
export function sanitizedRemoteFailure(error) {
  return REMOTE_FAILURE_CODES.has(error?.message) ? error.message : 'runtime-transit-preflight-failed';
}
export function failureFromFlyExecError(error, profile = LIVE_PROFILE) {
  const stdout = typeof error?.stdout === 'string' ? error.stdout :
    Buffer.isBuffer(error?.stdout) ? error.stdout.toString('utf8') : '';
  if (!stdout) return 'fly-runtime-probe-failed';
  try { parseRemoteReport(stdout, profile); } catch (failure) { return sanitizedRemoteFailure(failure); }
  return 'fly-runtime-probe-failed';
}
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RETRY_AFTER_MS = 120_000;
// Accept only delta-seconds or an HTTP date; anything else falls back to our own delay.
export function retryAfterMs(value, now = Date.now) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const ms = /^\d{1,6}$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : null;
}
// Retry only a 429, for the same single request, a bounded number of times and
// within a total wait budget. The wait honours the server's Retry-After (capped)
// but never goes below our own delay; every other failure stays immediate.
export async function withRateLimitRetry(work, {delays = [], sleep = defaultSleep, maxTotalWaitMs = Infinity, honorRetryAfter = true} = {}) {
  const steps = Array.isArray(delays) ? delays.filter((value) => Number.isFinite(value) && value >= 0) : [];
  let waited = 0;
  for (let attempt = 0; ; attempt += 1) {
    try { return await work(); }
    catch (error) {
      if (error?.message !== 'rate-limited' || attempt >= steps.length) throw error;
      const wait = Math.max(steps[attempt], honorRetryAfter && Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0);
      if (waited + wait > maxTotalWaitMs) throw error;
      waited += wait;
      await sleep(wait);
    }
  }
}

export function validateProfile(profile = LIVE_PROFILE) {
  if (![LIVE_PROFILE, LINKS_PROFILE, CATALOG_PROFILE].includes(profile)) fail('unknown-transit-profile');
  return profile;
}

export async function probeRuntime(profile = LIVE_PROFILE, options = {}) {
  validateProfile(profile);
  if (profile === LIVE_PROFILE) return { ...await probeTdx(options), profile, transitReady: true };
  const credentials = options.credentials ?? { clientId: process.env.TDX_CLIENT_ID, clientSecret: process.env.TDX_CLIENT_SECRET };
  // Even an empty or whitespace-only configured variable is not an absent credential.
  const configured = [credentials.clientId, credentials.clientSecret].map((value) => value !== undefined);
  if (configured.some(Boolean)) fail(configured.every(Boolean) ? 'tdx-credentials-present' : 'tdx-partial-configuration');
  return { ready: true, profile, mode: profile === CATALOG_PROFILE ? 'static-catalog' : 'official-links', transitReady: false,
    credentialsAbsent: true, reason: 'not-configured', physicalDeviceVerified: false };
}

async function json(url, init = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, { ...init, cache: 'no-store', redirect: 'error',
      credentials: 'omit', signal: AbortSignal.timeout(10_000) });
  } catch { fail('network-unavailable'); }
  if (response.status === 429) {
    const error = new GateError('rate-limited');
    error.retryAfterMs = retryAfterMs(response.headers.get('retry-after'));
    throw error;
  }
  if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'not-authorized' : 'service-unavailable');
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
  fetcher = fetch, now = Date.now, sleep = defaultSleep, rateLimitDelays = [20_000, 40_000] } = {}) {
  const {clientId, clientSecret} = credentials;
  if (!text(clientId) || !text(clientSecret)) fail('tdx-not-configured');
  // TDX limits each API key, and every Web machine shares that quota with the
  // public server. Retry only a 429, on the same already-issued token and for
  // the same single request; other failures stay fail-closed and immediate.
  // Inside a machine the whole probe must finish within the Fly Machines exec timeout, so
  // keep the fixed delays here rather than a provider-chosen Retry-After.
  const callJson = (url, init) => withRateLimitRetry(() => json(url, init, fetcher),
    {delays: rateLimitDelays, sleep, honorRetryAfter: false});
  const auth = await callJson(`${TDX}/auth/realms/TDXConnect/protocol/openid-connect/token`, {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret}).toString(),
  });
  if (!record(auth) || typeof auth.access_token !== 'string' || !auth.access_token ||
      !Number.isFinite(auth.expires_in) || auth.expires_in <= 0) fail('invalid-token-response');
  const headers = {Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json'};
  const request = (path, filter, top) => callJson(`${TDX}/api/basic/v2/Bus/${path}/City/${CITY}?${new URLSearchParams({
    '$filter': filter, '$top': String(top), '$format': 'JSON'})}`, {headers});
  const stops = stopsFrom(await request('Stop', "contains(StopName/Zh_tw,'靜宜大學')", 32), true);
  return collect(stops, (stopId) => request('EstimatedTimeOfArrival', `StopUID eq '${stopId}'`, 200), true, now);
}

// The public server guards the shared TDX key and answers 429 with Retry-After
// (60 s) right after the in-machine probes spend that quota. Waiting it out is
// the only honest option: no bypass header, the public limit is never relaxed.
export async function probePublic(expectedRevision, {fetcher = fetch, now = Date.now, profile = LIVE_PROFILE,
  sleep = defaultSleep, rateLimitDelays = [30_000, 60_000, 60_000], maxRateLimitWaitMs = 240_000} = {}) {
  validateProfile(profile);
  if (!/^[a-f0-9]{40}$/.test(expectedRevision ?? '')) fail('exact-revision-required');
  let budgetLeft = Number.isFinite(maxRateLimitWaitMs) && maxRateLimitWaitMs >= 0 ? maxRateLimitWaitMs : 0;
  const retryPublic = (work) => withRateLimitRetry(work, {delays: rateLimitDelays, maxTotalWaitMs: budgetLeft,
    sleep: async (ms) => { budgetLeft -= ms; await sleep(ms); }});
  const health = await json(`${ORIGIN}/health/ready`, {}, fetcher);
  if (health?.service !== 'campus-one-web' || health.status !== 'ready' || health.legacy !== 'ready' ||
      health.revision !== expectedRevision) fail('public-revision-not-ready');
  let page;
  try { page = await fetcher(`${ORIGIN}/bus`, {cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10_000)}); }
  catch { fail('public-page-unavailable'); }
  if (page.status !== 200 || !page.headers.get('content-type')?.includes('text/html') ||
      !/geolocation=\(self\)/.test(page.headers.get('permissions-policy') ?? '')) fail('public-page-not-ready');
  const html = await page.text();
  if (!hasBusShell(html)) fail('new-bus-page-missing');
  if (profile === CATALOG_PROFILE) return probeStaticCatalog(expectedRevision, html, fetcher, now);
  if (profile === LINKS_PROFILE) {
    const officialHref = verifyOfficialNotice(html);
    let response;
    try {
      response = await fetcher(`${ORIGIN}/api/transit`, {method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN},
        body:JSON.stringify({action:'campus',schoolId:'pu'}),cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10_000)});
    } catch { fail('public-transit-unavailable-check-failed'); }
    if (response.status !== 503 || !response.headers.get('content-type')?.includes('application/json')) fail('public-transit-not-explicitly-unconfigured');
    let body;
    try { body = await response.json(); } catch { fail('public-transit-not-explicitly-unconfigured'); }
    if (!record(body) || body.status !== 'unavailable' || body.reason !== 'not-configured' ||
        Object.keys(body).length !== 2) fail('public-transit-not-explicitly-unconfigured');
    return { ready:true, webReady:true, profile, mode:'official-links', transitReady:false, reason:'not-configured',
      origin:ORIGIN, revision:expectedRevision, checkedAt:new Date(now()).toISOString(), officialHref,
      serverNoticeVerified:true, browserControlsVerified:false, liveArrivalsVerified:false, physicalDeviceVerified:false };
  }
  const query = async (body, kind) => {
    const result = await retryPublic(() => json(`${ORIGIN}/api/transit`, {method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN},body:JSON.stringify(body)},fetcher));
    if (result?.status !== 'ready' || result.kind !== kind) fail('public-transit-not-ready');
    return result[kind];
  };
  const stops = stopsFrom(await query({action:'campus',schoolId:'pu'},'stops'), false);
  const report = await collect(stops, (stopId) => query({action:'arrivals',city:CITY,stopId},'arrivals'), false, now);
  return {...report, profile, transitReady:true, browserControlsVerified:false, origin:ORIGIN, revision:expectedRevision};
}

export function hasBusShell(html) {
  if (typeof html !== 'string') return false;
  // SSR of /bus is a Suspense fallback: the client title「公車」and segment
  // labels are not in the first HTML. Require the server wrapper itself.
  // The previous shell (data-campus-bus-shell only) must not pass.
  const open = html.match(/<[^>]+data-campus-bus-shell=["']true["'][^>]*>/g) ?? [];
  return open.some((tag) => /\sdata-campus-bus-spec=["']v1["']/.test(tag));
}

export function verifyOfficialNotice(html) {
  const notices = [...html.matchAll(/<aside\b[^>]*data-transit-mode=["']official-links["'][^>]*>([\s\S]*?)<\/aside>/g)];
  for (const [, content] of notices) {
    if (!content.includes('即時到站尚未啟用') || !content.includes('臺中市官方公車查詢')) continue;
    for (const href of OFFICIAL_LINKS) {
      const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`<a\\b[^>]*href=["']${escaped}["'][^>]*>臺中市官方公車查詢(?:[^<]*)<\\/a>`).test(content)) return href;
    }
  }
  fail('official-transit-notice-missing');
}

async function probeStaticCatalog(revision, html, fetcher, now) {
  const notice = html.match(/<aside\b[^>]*data-transit-mode=["']static-catalog["'][^>]*>([\s\S]*?)<\/aside>/)?.[1];
  if (!notice?.includes('臺中站牌可查詢，班次時間請至官方網站確認') ||
      !/<a\b[^>]*href=["']https:\/\/citybus\.taichung\.gov\.tw\/["'][^>]*>/.test(notice)) fail('static-catalog-notice-missing');
  const request = async (query, expectedStatus = 200) => {
    let response;
    try { response = await fetcher(`${ORIGIN}/api/transit`, {method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN},
      body:JSON.stringify(query),cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10_000)}); }
    catch { fail('static-catalog-request-failed'); }
    if (response.status !== expectedStatus || !response.headers.get('content-type')?.includes('application/json')) fail('static-catalog-response-invalid');
    try { return await response.json(); } catch { fail('static-catalog-response-invalid'); }
  };
  const validateStops = (body) => {
    if (body?.status !== 'ready' || body.kind !== 'stops' || !Array.isArray(body.stops) ||
        body.stops.length < 1 || body.stops.length > 16 || typeof body.limited !== 'boolean' ||
        typeof body.fetchedAt !== 'string' || !Number.isFinite(Date.parse(body.fetchedAt)) ||
        Math.abs(now() - Date.parse(body.fetchedAt)) > 5 * 60_000) fail('static-catalog-not-ready');
    const seen = new Set();
    for (const stop of body.stops) {
      const date = Date.parse(stop?.catalogDate);
      if (!id(stop?.id) || !/^TCOD_[A-Za-z0-9_-]+$/.test(stop.id) || seen.has(stop.id) ||
          stop.city !== CITY || !text(stop.name) || stop.source !== 'taichung-open-data' ||
          !Number.isFinite(stop.lat) || stop.lat < 20 || stop.lat > 27 ||
          !Number.isFinite(stop.lon) || stop.lon < 118 || stop.lon > 123 ||
          typeof stop.catalogDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(stop.catalogDate) ||
          !Number.isFinite(date) || new Date(date).toISOString().replace('.000Z', 'Z') !== stop.catalogDate.replace('.000Z', 'Z') ||
          date > now() + 30_000 || now() - date > 180 * 86400_000 ||
          !Array.isArray(stop.routes) || !stop.routes.length || stop.routes.length > 200 || !stop.routes.every(route =>
            record(route) && typeof route.name === 'string' && text(route.name) && route.name.length <= 120 &&
            typeof route.direction === 'string' && route.direction.length <= 40 &&
            typeof route.destination === 'string' && route.destination.length <= 120)) fail('static-catalog-station-invalid');
      seen.add(stop.id);
    }
    return body.stops;
  };
  const campus = validateStops(await request({action:'campus',schoolId:'pu'}));
  if (!campus.every(stop => stop.name.includes('靜宜大學'))) fail('static-catalog-campus-mismatch');
  const search = validateStops(await request({action:'search',city:CITY,text:'靜宜大學'}));
  if (JSON.stringify(search) !== JSON.stringify(campus)) fail('static-catalog-search-mismatch');
  const first = campus[0];
  const nearby = validateStops(await request({action:'nearby',city:CITY,lat:first.lat,lon:first.lon,radius:300}));
  if (!nearby.every(stop => Number.isFinite(stop.distance) && stop.distance >= 0 && stop.distance <= 300) ||
      !nearby.some(stop => stop.id === first.id)) fail('static-catalog-nearby-mismatch');
  for (const query of [{action:'arrivals',city:CITY,stopId:first.id},{action:'search',city:'Taipei',text:'靜宜大學'}]) {
    const body = await request(query, 503);
    if (body?.status !== 'unavailable' || body.reason !== 'not-configured' || Object.keys(body).length !== 2)
      fail('static-catalog-unavailable-state-invalid');
  }
  return {ready:true,webReady:true,profile:CATALOG_PROFILE,mode:'static-catalog',transitReady:false,
    stationCatalogReady:true,provider:'taichung-open-data',revision,origin:ORIGIN,checkedAt:new Date(now()).toISOString(),
    stationCount:campus.length,catalogDate:first.catalogDate,campusSearchVerified:true,nearbyVerified:true,
    serverNoticeVerified:true,liveArrivalsVerified:false,browserControlsVerified:false,physicalDeviceVerified:false};
}

export function buildRemoteCommand(source, profile = LIVE_PROFILE) {
  validateProfile(profile);
  // The full source exceeds the Machines exec request limit. Transfer it compressed
  // and restore the exact module in memory, without files or additional packages.
  const compressedSource = gzipSync(source).toString('base64');
  const program = `import("node:zlib").then(({gunzipSync})=>import("data:text/javascript;base64,"+gunzipSync(Buffer.from(${JSON.stringify(compressedSource)},"base64")).toString("base64"))).then(async(m)=>{try{const r=await m.probeRuntime(${JSON.stringify(profile)});console.log(${JSON.stringify(MARKER)}+JSON.stringify(r))}catch(e){console.log(${JSON.stringify(MARKER)}+JSON.stringify({ready:false,reason:m.sanitizedRemoteFailure(e)}));process.exitCode=1}}).catch(()=>{console.log(${JSON.stringify(MARKER)}+JSON.stringify({ready:false,reason:"runtime-transit-preflight-failed"}));process.exitCode=1})`;
  return `node --input-type=module -e '${program.replaceAll("'", "'\\''")}'`;
}

export function parseRemoteReport(stdout, profile = LIVE_PROFILE) {
  validateProfile(profile);
  const lines = stdout.split(/\r?\n/).filter((line) => line.startsWith(MARKER));
  if (lines.length !== 1) fail('runtime-probe-output-invalid');
  let value;
  try { value = JSON.parse(lines[0].slice(MARKER.length)); } catch { fail('runtime-probe-output-invalid'); }
  if (value?.ready === false) fail(sanitizedRemoteFailure({message: value.reason}));
  if (profile === LINKS_PROFILE || profile === CATALOG_PROFILE) {
    const mode = profile === CATALOG_PROFILE ? 'static-catalog' : 'official-links';
    if (value?.ready !== true || value.profile !== profile || value.mode !== mode || value.transitReady !== false ||
        value.credentialsAbsent !== true || value.reason !== 'not-configured') fail('runtime-official-links-not-ready');
    return {ready:true,profile,mode,transitReady:false,credentialsAbsent:true,reason:'not-configured',physicalDeviceVerified:false};
  }
  if (value?.ready !== true || value.profile !== profile || value.transitReady !== true || value.provider !== 'TDX' || value.directionVerified !== true ||
      value.sourceFreshnessVerified !== true || !Number.isInteger(value.stationCount) || value.stationCount < 1)
    fail('runtime-transit-not-ready');
  // Never persist arbitrary stdout or provider fields from a remote process.
  return {ready:true,profile,transitReady:true,provider:'TDX',stationCount:value.stationCount,directionVerified:true,
    sourceFreshnessVerified:true,countdownVerified:value.countdownVerified === true,physicalDeviceVerified:false};
}

export function probeFlyMachine(machineId, command, profile = LIVE_PROFILE, execute = execFileSync, options = {}) {
  validateProfile(profile);
  if (!MACHINE_IDS.includes(machineId)) fail('unexpected-machine-target');
  const retries = Number.isInteger(options.retries) && options.retries >= 0 ? options.retries : 0;
  const delays = Array.isArray(options.retryDelays) ? options.retryDelays : [];
  const wait = typeof options.wait === 'function' ? options.wait : () => {};
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return readFlyMachineReport(machineId, command, profile, execute);
    } catch (error) {
      lastError = error;
      if (error?.message !== 'fly-runtime-probe-failed' || attempt >= retries) throw error;
      const delay = delays[attempt];
      if (Number.isFinite(delay) && delay > 0) wait(delay);
    }
  }
  throw lastError;
}

function readFlyMachineReport(machineId, command, profile, execute) {
  let stdout;
  try {
    // Use the existing deployment token through the Machines API. SSH would
    // create an additional certificate for a read-only runtime probe.
    stdout = execute('flyctl',['machine','exec',machineId,'--app','nuni-web','--timeout','300','--json',command],
      {encoding:'utf8',timeout:310_000,maxBuffer:256*1024,stdio:['ignore','pipe','pipe']});
  } catch (error) { fail(failureFromFlyExecError(error, profile)); }
  let result;
  if (typeof stdout !== 'string') fail('runtime-probe-output-invalid');
  try { result = JSON.parse(stdout); } catch { fail('runtime-probe-output-invalid'); }
  if (!record(result) || typeof result.stdout !== 'string' ||
      Object.keys(result).some((key) => !['stdout','stderr','exit_code'].includes(key)) ||
      (Object.hasOwn(result, 'stderr') && typeof result.stderr !== 'string') ||
      (Object.hasOwn(result, 'exit_code') && !Number.isInteger(result.exit_code))) fail('runtime-probe-output-invalid');
  // flyctl's JSON response uses Go's omitempty: a successful zero exit is
  // omitted. Its own CLI exit code does not reflect a remote command failure.
  // Never accept a success marker from a command that exited unsuccessfully.
  if (Object.hasOwn(result, 'exit_code') && result.exit_code !== 0)
    fail(failureFromFlyExecError({stdout: result.stdout}, profile));
  return {machineId,...parseRemoteReport(result.stdout, profile)};
}

async function main() {
  const [mode, input, output] = process.argv.slice(2);
  const profile = validateProfile(process.env.TRANSIT_RELEASE_PROFILE);
  await mkdir('release-evidence',{recursive:true});
  if (mode === 'public') {
    const report = await probePublic(process.env.EXPECTED_RELEASE_SHA, {profile});
    await writeFile('release-evidence/transit-public.json',JSON.stringify(report,null,2)+'\n');
    console.log(profile === LIVE_PROFILE ? 'Verified the expected public revision, campus stations and fresh directional transit data.' :
      profile === CATALOG_PROFILE ? 'Verified the expected revision, static campus/search/nearby stations and explicit unavailable arrivals.' :
      'Verified the expected Web revision and official links. Live transit remains unavailable.');
    return;
  }
  if (mode === 'fly') {
    if (!process.env.FLY_API_TOKEN) fail('fly-deploy-credential-missing');
    const rows = JSON.parse(await readFile(input,'utf8'));
    if (!Array.isArray(rows) || rows.length !== MACHINE_IDS.length ||
        new Set(rows.map((row) => row?.id)).size !== MACHINE_IDS.length ||
        !rows.every((row) => MACHINE_IDS.includes(row?.id) && row.state === 'started')) fail('unexpected-machine-target');
    const command = buildRemoteCommand(await readFile(new URL(import.meta.url),'utf8'), profile);
    const reports = [];
    const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    // Rolling deploys clear machine leases immediately before verification. A single
    // Machines exec miss becomes fly-runtime-probe-failed with empty stdout; retry only
    // that transport failure, never application codes such as rate-limited.
    for (const row of rows) reports.push(probeFlyMachine(row.id, command, profile, execFileSync, {
      retries: 2, retryDelays: [3_000, 7_000], wait,
    }));
    await writeFile(output ?? 'release-evidence/transit-preflight.json',JSON.stringify({checkedAt:new Date().toISOString(),profile,transitReady:profile === LIVE_PROFILE,machines:reports},null,2)+'\n');
    console.log(profile === LIVE_PROFILE ? 'Verified TDX inside every existing Web machine; credential values never left the machines.' : 'Verified both TDX variables are absent inside every existing Web machine; live transit remains unavailable.');
    return;
  }
  fail('expected-public-or-fly-mode');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  console.error(error instanceof GateError ? error.message : 'transit-release-check-failed');
  process.exitCode = 1;
});
