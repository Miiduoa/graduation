'use strict';

// Runs the production transit modules with Node's test runner; no live credentials or network.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const ts = createRequire(path.join(root, 'apps/web/package.json'))('typescript');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-transit-'));
process.on('exit', () => fs.rmSync(output, { recursive: true, force: true }));

for (const [source, name] of [
  ['apps/web/src/lib/transit.ts', 'transit'],
  ['apps/web/src/lib/transit-server.ts', 'transit-server'],
  ['apps/web/src/lib/transit-catalog.ts', 'transit-catalog'],
  ['apps/web/src/app/api/transit/route.ts', 'route'],
]) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, source), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: source,
    reportDiagnostics: true,
  });
  assert.equal((result.diagnostics || []).filter((entry) => entry.category === ts.DiagnosticCategory.Error).length, 0);
  fs.writeFileSync(path.join(output, `${name}.js`), result.outputText.replace('"@/lib/transit-server"', '"./transit-server"').replace('"../data/taichung-transit-catalog.json"', JSON.stringify(path.join(root, 'apps/web/src/data/taichung-transit-catalog.json'))));
}
const client = require(path.join(output, 'transit.js'));
const server = require(path.join(output, 'transit-server.js'));
const route = require(path.join(output, 'route.js'));
const NOW = Date.parse('2026-10-12T08:00:00Z');
const at = (offset = 0) => new Date(NOW + offset).toISOString();
const point = { lat: 24.22, lon: 120.58 };
const campusQuery = { action: 'campus', schoolId: 'pu' };
const stop = (id, lat = point.lat, lon = point.lon) => ({
  StopUID: id, StopName: { Zh_tw: '靜宜大學' }, StopPosition: { PositionLat: lat, PositionLon: lon },
});
const arrival = (overrides = {}) => ({
  StopUID: 'TXG123', RouteUID: 'TXG300', SubRouteUID: 'TXG300A', RouteName: { Zh_tw: '300' },
  Direction: 0, StopStatus: 0, EstimateTime: 480, SrcUpdateTime: at(), ...overrides,
});
function service(data = [stop('TXG123')], override = {}) {
  const calls = [];
  let time = NOW;
  const execute = server.createTransitService({
    credentials: () => ({ clientId: 'test-client', clientSecret: 'test-only-secret' }),
    now: () => time,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/openid-connect/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
      return typeof data === 'function' ? data(url, init) : Response.json(data);
    },
    ...override,
  });
  return { execute, calls, tick: (milliseconds) => { time += milliseconds; } };
}

test('rejects untrusted cities, coordinates, identifiers and query shapes before requesting TDX', async () => {
  const mock = service();
  for (const value of [null, [], {}, { action: 'campus', schoolId: '__proto__' },
    { action: 'search', city: '__proto__', text: '靜宜' }, { action: 'search', city: 'Taichung', text: 'x' },
    { action: 'search', city: 'Taichung', text: 'x\ninvalid' },
    { action: 'arrivals', city: 'Taichung', stopId: "x' or 1 eq 1" },
    { action: 'nearby', city: 'Taichung', lat: NaN, lon: 120, radius: 600 },
    { action: 'nearby', city: 'Taichung', lat: 91, lon: 120, radius: 600 },
    { action: 'nearby', city: 'Taichung', lat: 24, lon: 181, radius: 600 },
    { action: 'nearby', city: 'Taichung', lat: '24', lon: 120, radius: 600 },
    { action: 'nearby', city: 'Taichung', lat: 24, lon: 120, radius: 6000 },
  ]) assert.deepEqual(await mock.execute(value), { status: 'unavailable', reason: 'invalid-query' });
  assert.equal(mock.calls.length, 0);
});
test('campus lookup uses the registered school and unknown schools do not silently become Providence', () => {
  assert.deepEqual(server.validateTransitQuery(campusQuery), campusQuery);
  assert.throws(() => server.validateTransitQuery({ action: 'campus', schoolId: 'unknown' }));
  assert.equal(client.isCity('toString'), false);
});
test('same-named stops on opposite sides remain separate and invalid positions are excluded', () => {
  const rows = [stop('TXG123'), stop('TXG124'), stop('TXG123'), stop('TXG999', 999), { StopName: { Zh_tw: '靜宜大學' } }];
  assert.deepEqual(server.normalizeTransitStops(rows, 'Taichung', campusQuery).map((row) => row.id), ['TXG123', 'TXG124']);
});
test('nearby recommendations are sorted by actual distance, excluding stops outside the requested radius', () => {
  const query = { action: 'nearby', city: 'Taichung', ...point, radius: 300 };
  const rows = server.normalizeTransitStops([stop('far', 24.23), stop('middle', 24.221), stop('nearest')], 'Taichung', query);
  assert.deepEqual(rows.map((row) => row.id), ['nearest', 'middle']);
  assert.equal(rows[0].distance, 0);
  assert.ok(rows[1].distance > 100 && rows[1].distance < 120);
});
test('distance labels are approximate and never fabricate a walking duration', () => {
  assert.equal(client.distanceMetres(point, point), 0);
  assert.equal(client.formatDistance(0), '約 10 公尺');
  assert.equal(client.formatDistance(113), '約 110 公尺');
  assert.equal(client.formatDistance(1300), '約 1.3 公里');
});
test('source timestamps, not a fresh HTTP response, decide whether an estimate can be shown', () => {
  const [fresh] = server.normalizeTransitArrivals([arrival()], 'TXG123');
  assert.equal(client.arrivalLabel(fresh, NOW), '約 8 分鐘');
  assert.equal(client.arrivalLabel(fresh, NOW + 60_000), '約 7 分鐘');
  assert.equal(client.arrivalLabel(fresh, NOW + 90_000), '資料待更新');
  assert.equal(client.arrivalLabel({ ...fresh, updatedAt: at(30_001) }, NOW), '資料待更新');
  assert.equal(client.arrivalLabel({ ...fresh, updatedAt: null }, NOW), '資料待更新');
});
test('unknown or passed estimates never become misleading imminent-arrival labels', () => {
  const [fresh] = server.normalizeTransitArrivals([arrival({ EstimateTime: 0 })], 'TXG123');
  assert.equal(client.arrivalLabel(fresh, NOW), '即將到站');
  assert.equal(client.arrivalLabel(fresh, NOW + 31_000), '等待更新');
  for (const seconds of [null, -10, Infinity, NaN]) assert.equal(client.arrivalLabel({ ...fresh, seconds }, NOW), '暫無到站預估');
});
test('each stop status remains distinct, including no service today', () => {
  const [fresh] = server.normalizeTransitArrivals([arrival()], 'TXG123');
  const labels = { 1: '尚未發車', 2: '交管不停靠', 3: '末班車已駛離', 4: '今日未營運' };
  for (const [status, label] of Object.entries(labels)) assert.equal(client.arrivalLabel({ ...fresh, status: Number(status) }, NOW), label);
});
test('filters exact StopUID and retains direction/subroute identity instead of mixing platforms', () => {
  const rows = server.normalizeTransitArrivals([
    arrival(), arrival({ Direction: 1 }), arrival({ SubRouteUID: 'variant' }), arrival({ StopUID: 'other' }),
  ], 'TXG123');
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((row) => row.id)).size, 3);
});
test('newer source data wins over an old or timestamp-less duplicate', () => {
  const rows = server.normalizeTransitArrivals([
    arrival({ EstimateTime: 400 }), arrival({ EstimateTime: 999, SrcUpdateTime: at(-60_000) }),
    arrival({ EstimateTime: 999, SrcUpdateTime: '', UpdateTime: '' }),
  ], 'TXG123');
  assert.equal(rows[0].seconds, 400);
});
test('does not invent a destination from a generic route headsign', () => {
  const [row] = server.normalizeTransitArrivals([arrival({ HeadSign: 'A－B' })], 'TXG123');
  // 來源沒有給終點時不編造目的地，也不拿通用路線牌充當終點；
  // 標示必須明講終點未提供，讓學生知道要再核對車頭方向。
  assert.equal(row.destination, '');
  assert.equal(client.directionLabel(row), '去程（終點未提供）');
  assert.equal(client.directionLabel({ ...row, direction: 1 }), '返程（終點未提供）');
  assert.equal(client.directionLabel({ ...row, direction: null }), '方向未提供');
  assert.ok(!client.directionLabel(row).includes('A－B'));
  assert.ok(!client.directionLabel(row).includes('往'));
  assert.equal(client.directionLabel({ ...row, destination: '臺中車站' }), '往 臺中車站');
});
test('saved stops tolerate corruption, deduplicate, cap size, and strip location-derived distance', () => {
  assert.deepEqual(client.readSavedStops('{broken'), []);
  assert.deepEqual(client.readSavedStops('{}'), []);
  const entries = Array.from({ length: 20 }, (_, index) => ({ id: `TXG${index}`, name: '站牌', city: 'Taichung', ...point, distance: 42, userPosition: point }));
  const saved = client.readSavedStops(JSON.stringify([entries[0], entries[0], ...entries]));
  assert.equal(saved.length, 16);
  assert.equal(saved[0].distance, null);
  assert.equal(Object.hasOwn(saved[0], 'userPosition'), false);
});
test('walking link contains only the public station location, never an origin or API key', () => {
  const link = new URL(client.stopMapUrl({ ...point, city: 'Taichung', id: 'a', name: 'b', distance: 20 }));
  assert.equal(link.hostname, 'www.google.com');
  assert.equal(link.searchParams.get('travelmode'), 'walking');
  assert.equal(link.searchParams.has('origin'), false);
  assert.equal(link.searchParams.has('key'), false);
});
test('absent credentials use verified Taichung catalog without network; other cities and arrivals remain unavailable', async () => {
  const mock = service([], { credentials: () => ({}) });
  const result = await mock.execute(campusQuery);
  assert.equal(result.status, 'ready');
  assert.equal(result.kind, 'stops');
  assert.ok(result.stops.length > 0);
  assert.ok(result.stops.every(row => row.source === 'taichung-open-data' && row.id.startsWith('TCOD_') && row.name.includes('靜宜大學') && row.routes.length));
  assert.deepEqual(await mock.execute({ action:'search', city:'Taichung', text:'靜宜大學' }), result);
  assert.deepEqual(await mock.execute({ action:'search', city:'Taipei', text:'靜宜大學' }), { status:'unavailable', reason:'not-configured' });
  const first = result.stops[0];
  const nearby = await mock.execute({action:'nearby',city:'Taichung',lat:first.lat,lon:first.lon,radius:300});
  assert.ok(nearby.stops.some(row => row.id === first.id));
  assert.ok(nearby.stops.every(row => row.distance >= 0 && row.distance <= 300));
  assert.deepEqual(await mock.execute({action:'arrivals',city:'Taichung',stopId:first.id}), {status:'unavailable',reason:'not-configured'});
  assert.equal(mock.calls.length, 0);
});
test('static catalog IDs are never forwarded to TDX even after credentials are configured', async () => {
  const mock = service();
  assert.deepEqual(await mock.execute({action:'arrivals',city:'Taichung',stopId:'TCOD_valid'}), {status:'unavailable',reason:'not-configured'});
  assert.equal(mock.calls.length, 0);
});
test('partial or blank credentials do not silently select static mode', async () => {
  for (const credentials of [{clientId:'x'}, {clientSecret:'x'}, {clientId:'',clientSecret:''}]) {
    const mock=service([], {credentials:()=>credentials});
    assert.deepEqual(await mock.execute(campusQuery),{status:'unavailable',reason:'not-configured'});
    assert.equal(mock.calls.length,0);
  }
});
test('OAuth single-flight and query cache collapse concurrent requests without exposing credentials', async () => {
  const mock = service();
  const results = await Promise.all(Array.from({ length: 8 }, () => mock.execute(campusQuery)));
  assert.equal(mock.calls.length, 2);
  assert.equal(results.every((result) => result.status === 'ready'), true);
  assert.equal(JSON.stringify(results).includes('test-only-secret'), false);
  assert.equal(mock.calls[0].init.method, 'POST');
  assert.equal(new URL(mock.calls[0].url).search, '');
  assert.equal(mock.calls[1].init.headers.Authorization, 'Bearer test-token');
  assert.equal(mock.calls[1].init.redirect, 'error');
});
test('stop cache expires and OAuth is renewed before token expiry', async () => {
  const mock = service();
  await mock.execute(campusQuery);
  mock.tick(119_999); await mock.execute(campusQuery); assert.equal(mock.calls.length, 2);
  mock.tick(1); await mock.execute(campusQuery); assert.equal(mock.calls.length, 3);
  mock.tick(3_420_001); await mock.execute(campusQuery);
  assert.equal(mock.calls.filter((call) => call.url.includes('/openid-connect/token')).length, 2);
});
test('nearby cache coordinates are rounded, padded, and actual distances are calculated per request', async () => {
  const mock = service();
  const result = await mock.execute({ action: 'nearby', city: 'Taichung', ...point, radius: 600 });
  const url = new URL(mock.calls[1].url);
  assert.equal(url.pathname, '/api/basic/v2/Bus/Stop/City/Taichung');
  assert.equal(url.searchParams.get('$spatialFilter'), 'nearby(StopPosition,24.220,120.580,760)');
  assert.equal(result.stops[0].distance, 0);
});
test('search escapes OData literals and uses only the fixed TDX origin', async () => {
  const mock = service();
  await mock.execute({ action: 'search', city: 'Taichung', text: "O'Brien" });
  const url = new URL(mock.calls[1].url);
  assert.equal(url.origin, 'https://tdx.transportdata.tw');
  assert.equal(url.searchParams.get('$filter'), "contains(StopName/Zh_tw,'O''Brien')");
});
test('truncated station results are marked as partial instead of claiming complete coverage', async () => {
  const mock = service(Array.from({ length: 20 }, (_, index) => stop(`TXG${index}`)));
  const result = await mock.execute(campusQuery);
  assert.equal(result.stops.length, 16);
  assert.equal(result.limited, true);
});
test('a valid empty upstream result stays empty; a malformed payload is unavailable', async () => {
  assert.equal((await service([]).execute(campusQuery)).stops.length, 0);
  assert.deepEqual(await service({ message: 'wrong shape' }).execute(campusQuery), { status: 'unavailable', reason: 'upstream' });
});
test('429 responses apply backoff instead of a retry storm', async () => {
  const mock = service(() => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
  assert.equal((await mock.execute(campusQuery)).reason, 'rate-limited');
  assert.equal((await mock.execute(campusQuery)).reason, 'rate-limited');
  assert.equal(mock.calls.length, 2);
  mock.tick(120_001); await mock.execute(campusQuery);
  assert.equal(mock.calls.length, 3);
});
test('401 invalidates the cached token for the next request', async () => {
  let count = 0;
  const mock = service(() => ++count === 1 ? new Response('', { status: 401 }) : Response.json([]));
  assert.equal((await mock.execute(campusQuery)).reason, 'upstream');
  assert.equal((await mock.execute(campusQuery)).status, 'ready');
  assert.equal(mock.calls.filter((call) => call.url.includes('/openid-connect/token')).length, 2);
});
test('upstream failures are redacted rather than returning credential or provider error details', async () => {
  const mock = service(null, { fetcher: async () => { throw new Error('sensitive internal detail'); } });
  assert.deepEqual(await mock.execute(campusQuery), { status: 'unavailable', reason: 'upstream' });
});
test('request budget bounds uncached upstream calls', async () => {
  const mock = service([]);
  for (let i = 0; i < 60; i++) await mock.execute({ action: 'search', city: 'Taichung', text: `stop${i}` });
  assert.ok(mock.calls.length <= 60);
  assert.equal((await mock.execute({ action: 'search', city: 'Taichung', text: 'one more' })).reason, 'rate-limited');
});
test('arrival queries use exact StopUID with a shorter cache and still preserve old source timestamps', async () => {
  const mock = service([arrival({ SrcUpdateTime: at(-120_000) })]);
  const query = { action: 'arrivals', city: 'Taichung', stopId: 'TXG123' };
  const result = await mock.execute(query);
  assert.equal(new URL(mock.calls[1].url).searchParams.get('$filter'), "StopUID eq 'TXG123'");
  assert.equal(client.arrivalLabel(result.arrivals[0], NOW), '資料待更新');
  mock.tick(15_000); await mock.execute(query); assert.equal(mock.calls.length, 3);
});
test('POST enforces content type, cross-site rejection, malformed JSON and a bounded body', async () => {
  const request = (body, headers = {}) => new Request('https://campus.example/api/transit', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body,
  });
  assert.equal((await route.POST(request('{}', { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await route.POST(request('{}', { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await route.POST(request('{bad'))).status, 400);
  assert.equal((await route.POST(request('x'.repeat(2049)))).status, 413);
  const invalid = await route.POST(request('{}'));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('cache-control'), 'private, no-store');
});
