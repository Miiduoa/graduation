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
  ['apps/web/src/lib/transit-replay.ts', 'transit-replay'],
  ['apps/web/src/app/api/transit/route.ts', 'route'],
]) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, source), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: source,
    reportDiagnostics: true,
  });
  assert.equal((result.diagnostics || []).filter((entry) => entry.category === ts.DiagnosticCategory.Error).length, 0);
  fs.writeFileSync(path.join(output, `${name}.js`), result.outputText.replace('"@/lib/transit-server"', '"./transit-server"').replace('"@/lib/transit-replay"', '"./transit-replay"').replace('"../data/taichung-transit-catalog.json"', JSON.stringify(path.join(root, 'apps/web/src/data/taichung-transit-catalog.json'))));
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
test('campus-next is limited to Providence and unknown schools stay invalid', () => {
  assert.deepEqual(server.validateTransitQuery({ action: 'campus-next', schoolId: 'pu' }), { action: 'campus-next', schoolId: 'pu' });
  assert.throws(() => server.validateTransitQuery({ action: 'campus-next', schoolId: 'nthu' }));
  assert.throws(() => server.validateTransitQuery({ action: 'campus-next', schoolId: 'unknown' }));
});
test('campus-next uses one arrival query for the four Providence routes and keeps the 15 second cache', async () => {
  const mock = service((url) => Response.json(url.includes('/StopOfRoute/') ? [] : [
    arrival({ StopUID: 'TXG-GATE', RouteUID: 'TXG162', RouteName: { Zh_tw: '162' }, StopName: { Zh_tw: '靜宜大學(校門)' }, EstimateTime: 180 }),
    arrival({ StopUID: 'TXG-GATE', RouteUID: 'TXG301', RouteName: { Zh_tw: '301' }, StopName: { Zh_tw: '靜宜大學(校門)' }, StopStatus: 3, EstimateTime: null, NextBusTime: at(45 * 60_000) }),
  ]));
  const query = { action: 'campus-next', schoolId: 'pu' };
  const first = await mock.execute(query);
  assert.equal(first.status, 'ready');
  assert.equal(first.kind, 'arrivals');
  const etaUrls = mock.calls.filter((call) => call.url.includes('/EstimatedTimeOfArrival/'));
  assert.equal(etaUrls.length, 1);
  assert.equal(mock.calls.filter((call) => call.url.includes('/Stop/City/')).length, 0);
  const filter = new URL(etaUrls[0].url).searchParams.get('$filter');
  assert.match(filter, /contains\(StopName\/Zh_tw,'靜宜大學'\)/);
  assert.match(filter, /RouteUID eq 'TXG162'/);
  assert.match(filter, /RouteUID eq 'TXG301'/);
  assert.match(filter, /RouteUID eq 'TXG368'/);
  assert.match(filter, /RouteUID eq 'TXG326'/);
  mock.tick(14_999); await mock.execute(query);
  assert.equal(mock.calls.filter((call) => call.url.includes('/EstimatedTimeOfArrival/')).length, 1);
  mock.tick(1); await mock.execute(query);
  assert.equal(mock.calls.filter((call) => call.url.includes('/EstimatedTimeOfArrival/')).length, 2);
  const gate = first.arrivals.find((row) => row.route === '162');
  assert.equal(gate.stopName, '靜宜大學(校門)');
  const scheduled = first.arrivals.find((row) => row.route === '301');
  assert.equal(scheduled.scheduledAt, at(45 * 60_000));
  assert.match(client.arrivalLabel(scheduled, NOW), /表定/);
  assert.match(client.arrivalLabel(scheduled, NOW), /非即時/);
  assert.equal(client.pickCampusNext(first.arrivals, NOW).map((row) => row.route).join(','), '162,301,326,368');
});
test('campus-next without credentials stays unavailable and does not invent times', async () => {
  const mock = service([], { credentials: () => ({}) });
  assert.deepEqual(await mock.execute({ action: 'campus-next', schoolId: 'pu' }), { status: 'unavailable', reason: 'not-configured' });
  assert.equal(mock.calls.length, 0);
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
  assert.equal(client.directionLabel({ ...row, destination: '臺中車站' }), '往 台中車站');
});
test('route stop order gives the real terminus per direction, never the headsign', () => {
  const destinations = server.normalizeRouteDestinations([
    { RouteUID: 'TXG162', SubRouteUID: 'TXG162', Direction: 0, Headsign: '靜宜大學-嘉陽高中-靜宜大學',
      Stops: [{ StopName: { Zh_tw: '靜宜大學主顧聖母堂' } }, { StopName: { Zh_tw: '嘉陽高中' } }] },
    { RouteUID: 'TXG162', SubRouteUID: 'TXG162', Direction: 1,
      Stops: [{ StopName: { Zh_tw: '嘉陽高中' } }, { StopName: { Zh_tw: '靜宜大學主顧聖母堂' } }] },
    { RouteUID: 'TXG999', Direction: 0, Stops: [] },
    { RouteUID: 'TXG998', Direction: null, Stops: [{ StopName: { Zh_tw: '某站' } }] },
  ]);
  assert.equal(destinations.get('TXG162:0'), '嘉陽高中');
  assert.equal(destinations.get('TXG162:1'), '校內');
  assert.equal(destinations.size, 2);
  const [outbound, inbound] = server.normalizeTransitArrivals([
    arrival({ RouteUID: 'TXG162', SubRouteUID: 'TXG162', RouteName: { Zh_tw: '162' }, Direction: 0 }),
    arrival({ RouteUID: 'TXG162', SubRouteUID: 'TXG162', RouteName: { Zh_tw: '162' }, Direction: 1 }),
  ], 'TXG123', destinations);
  assert.equal(client.directionLabel(outbound), '往 嘉陽高中');
  assert.equal(client.directionLabel(inbound), '往 校內');
  // 到站資料自己給的終點優先，站序不能蓋掉它；方向不明時不補。
  const [own] = server.normalizeTransitArrivals([
    arrival({ RouteUID: 'TXG162', Direction: 0, DestinationStopNameZh: '來源終點' }),
    arrival({ RouteUID: 'TXG162', Direction: null }),
  ], 'TXG123', destinations);
  assert.equal(own.destination, '來源終點');
});
test('remaining stops after boarding rewrite campus termini to public headings', () => {
  const outbound = {
    RouteUID: 'TXG162', SubRouteUID: 'TXG162', Direction: 0,
    Stops: [
      { StopUID: 'GATE', StopName: { Zh_tw: '靜宜大學(校門)' } },
      { StopUID: 'YING', StopName: { Zh_tw: '靜宜大學(英才路)' } },
      { StopUID: 'SHA', StopName: { Zh_tw: '沙鹿車站' } },
      { StopUID: 'END', StopName: { Zh_tw: '嘉陽高中' } },
    ],
  };
  const inbound368 = {
    RouteUID: 'TXG368', SubRouteUID: 'TXG368', Direction: 0,
    Stops: [
      { StopUID: 'YING', StopName: { Zh_tw: '靜宜大學(英才路)' } },
      { StopUID: 'GATE', StopName: { Zh_tw: '靜宜大學(校門)' } },
      { StopUID: 'CHAPEL', StopName: { Zh_tw: '靜宜大學主顧聖母堂' } },
    ],
  };
  const outbound368 = {
    RouteUID: 'TXG368', SubRouteUID: 'TXG368', Direction: 1,
    Stops: [
      { StopUID: 'CHAPEL', StopName: { Zh_tw: '靜宜大學主顧聖母堂' } },
      { StopUID: 'HALL', StopName: { Zh_tw: '靜宜大學(會館)' } },
      { StopUID: 'YING', StopName: { Zh_tw: '靜宜大學(英才路)' } },
      { StopUID: 'BUS', StopName: { Zh_tw: '巨業沙鹿站' } },
    ],
  };
  const sequences = server.normalizeRouteSequences([outbound, inbound368, outbound368]);
  const [fromYing] = server.normalizeTransitArrivals([
    arrival({ StopUID: 'YING', RouteUID: 'TXG162', SubRouteUID: 'TXG162', RouteName: { Zh_tw: '162' }, Direction: 0, DestinationStopNameZh: '嘉陽高中', StopName: { Zh_tw: '靜宜大學(英才路)' } }),
  ], 'YING', new Map(), sequences);
  const [fromGate] = server.normalizeTransitArrivals([
    arrival({ StopUID: 'GATE', RouteUID: 'TXG368', SubRouteUID: 'TXG368', RouteName: { Zh_tw: '368' }, Direction: 0, DestinationStopNameZh: '靜宜大學主顧聖母堂', StopName: { Zh_tw: '靜宜大學(校門)' } }),
  ], 'GATE', new Map(), sequences);
  assert.equal(fromYing.destination, '沙鹿火車站');
  assert.equal(fromGate.destination, '校內');
  const inboundStops = sequences.find((row) => row.routeUid === 'TXG368' && row.direction === 0)?.stops.map((stop) => stop.id);
  const outboundStops = sequences.find((row) => row.routeUid === 'TXG368' && row.direction === 1)?.stops.map((stop) => stop.id);
  assert.deepEqual(inboundStops, ['YING', 'GATE', 'CHAPEL']);
  assert.equal(outboundStops.includes('GATE'), false);
  assert.equal(outboundStops.includes('YING'), true);
  assert.equal(server.routesAtCampusStop('GATE', sequences).some((route) => route.name === '368' && route.destination === '校內'), true);
  assert.equal(server.routesAtCampusStop('YING', sequences).some((route) => route.name === '368' && route.destination === '巨業沙鹿站'), true);
});
test('arrivals fill destinations from stop order and keep arrivals when that lookup fails', async () => {
  const stopOrder = (uid, last) => [{ RouteUID: uid, SubRouteUID: uid, Direction: 1, Stops: [{ StopName: { Zh_tw: '起站' } }, { StopName: { Zh_tw: last } }] }];
  const mock = service((url) => {
    if (url.includes('/StopOfRoute/')) return Response.json(stopOrder('TXG300', '靜宜大學主顧聖母堂'));
    return Response.json([arrival({ Direction: 1 })]);
  });
  const result = await mock.execute({ action: 'arrivals', city: 'Taichung', stopId: 'TXG123' });
  assert.equal(result.arrivals[0].destination, '校內');
  assert.equal(client.directionLabel(result.arrivals[0]), '往 校內');
  assert.ok(mock.calls.some((call) => new URL(call.url).pathname.endsWith('/StopOfRoute/City/Taichung') &&
    new URL(call.url).searchParams.get('$filter') === "RouteUID eq 'TXG300'"));
  // 站序快取 6 小時：15 秒後重查到站不應再打站序。
  mock.tick(15_000); await mock.execute({ action: 'arrivals', city: 'Taichung', stopId: 'TXG123' });
  assert.equal(mock.calls.filter((call) => call.url.includes('/StopOfRoute/')).length, 1);
  const failing = service((url) => url.includes('/StopOfRoute/')
    ? new Response('', { status: 500 }) : Response.json([arrival({ Direction: 1 })]));
  const fallback = await failing.execute({ action: 'arrivals', city: 'Taichung', stopId: 'TXG123' });
  assert.equal(fallback.status, 'ready');
  assert.equal(fallback.arrivals[0].destination, '');
  assert.equal(client.directionLabel(fallback.arrivals[0]), '返程（終點未提供）');
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
  // token + campus stops + the four preloaded Providence StopOfRoute queries
  assert.equal(mock.calls.length, 6);
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
  mock.tick(119_999); await mock.execute(campusQuery); assert.equal(mock.calls.length, 6);
  mock.tick(1); await mock.execute(campusQuery); assert.equal(mock.calls.length, 7);
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
  // 首次查詢另含一次站序補終點；15 秒後只有到站重查，站序快取 6 小時不重打。
  mock.tick(15_000); await mock.execute(query); assert.equal(mock.calls.length, 4);
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

// 多人同時查與 TDX 限流：共用快取、合併相同請求，被擋時回最近一份並標當時資料時間。
const etaQuery = (stopId = 'TXG123') => ({ action: 'arrivals', city: 'Taichung', stopId });
test('concurrent viewers of the same stop share one upstream arrival request', async () => {
  const mock = service((url) => Response.json(url.includes('/StopOfRoute/') ? [] : [arrival()]));
  const results = await Promise.all(Array.from({ length: 20 }, () => mock.execute(etaQuery())));
  assert.equal(results.every((result) => result.status === 'ready' && !result.stale), true);
  assert.equal(mock.calls.filter((call) => call.url.includes('/EstimatedTimeOfArrival/')).length, 1);
});
test('campus-next keeps the last copy when TDX is busy, using the same retention window as other arrivals', async () => {
  let limited = false;
  const mock = service((url) => {
    if (limited) return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
    return Response.json(url.includes('/StopOfRoute/') ? [] : [arrival({ RouteName: { Zh_tw: '162' }, StopName: { Zh_tw: '靜宜大學(校門)' } })]);
  });
  const query = { action: 'campus-next', schoolId: 'pu' };
  const first = await mock.execute(query);
  limited = true;
  mock.tick(20_000);
  const busy = await mock.execute(query);
  assert.equal(busy.status, 'ready');
  assert.equal(busy.stale, true);
  assert.equal(busy.fetchedAt, first.fetchedAt);
  const before = mock.calls.length;
  mock.tick(10_000); await mock.execute(query);
  assert.equal(mock.calls.length, before);
});
test('a TDX 429 after the cache expires returns the last arrivals with their original time and stale flag', async () => {
  let limited = false;
  const mock = service((url) => {
    if (limited) return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
    return Response.json(url.includes('/StopOfRoute/') ? [] : [arrival()]);
  });
  const first = await mock.execute(etaQuery());
  assert.equal(first.fetchedAt, at());
  limited = true;
  mock.tick(20_000);
  const busy = await mock.execute(etaQuery());
  assert.equal(busy.status, 'ready');
  assert.equal(busy.stale, true);
  assert.equal(busy.fetchedAt, at(), 'data time is when TDX was really queried, not now');
  assert.equal(busy.arrivals[0].updatedAt, at());
  assert.notEqual(client.arrivalLabel(busy.arrivals[0], NOW + 20_000), '資料待更新');
  // 90 秒規則維持：保留資料超過來源時間 90 秒就不再顯示倒數。
  assert.equal(client.arrivalLabel(busy.arrivals[0], NOW + 90_000), '資料待更新');
  // 封鎖期間不再打 TDX，保護不放寬。
  const before = mock.calls.length;
  mock.tick(10_000); await mock.execute(etaQuery());
  assert.equal(mock.calls.length, before);
});
test('own budget exhaustion also falls back to the last good copy, but never invents data for a new stop', async () => {
  const mock = service((url) => Response.json(url.includes('/StopOfRoute/') ? [] : url.includes('/EstimatedTimeOfArrival/') ? [arrival()] : []));
  await mock.execute(etaQuery());
  for (let i = 0; i < 60; i++) await mock.execute({ action: 'search', city: 'Taichung', text: `stop${i}` });
  mock.tick(20_000);
  const kept = await mock.execute(etaQuery());
  assert.equal(kept.status, 'ready'); assert.equal(kept.stale, true);
  assert.deepEqual(await mock.execute(etaQuery('TXG999')), { status: 'unavailable', reason: 'rate-limited' });
});
test('a kept copy older than the retention window is not served', async () => {
  let limited = false;
  const mock = service((url) => limited ? new Response('', { status: 429 }) : Response.json(url.includes('/StopOfRoute/') ? [] : [arrival()]));
  await mock.execute(etaQuery());
  limited = true;
  mock.tick(server.TRANSIT_STALE_RETENTION_MS + 1);
  assert.deepEqual(await mock.execute(etaQuery()), { status: 'unavailable', reason: 'rate-limited' });
});
test('more simultaneous different stops than the concurrency cap queue briefly instead of failing', async () => {
  let running = 0; let peak = 0;
  const mock = service(async (url) => {
    running += 1; peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return Response.json(url.includes('/StopOfRoute/') ? [] : [arrival({ StopUID: new URL(url).searchParams.get('$filter').slice(11, -1) })]);
  });
  const stops = Array.from({ length: 8 }, (_, index) => `TXG${200 + index}`);
  await mock.execute(etaQuery('TXG100')); // 先取得 token
  const results = await Promise.all(stops.map((id) => mock.execute(etaQuery(id))));
  assert.equal(results.every((result) => result.status === 'ready'), true);
  assert.ok(peak <= 4, `peak concurrency ${peak} must stay within the cap`);
});
test('a queued request that cannot get a slot in time is reported busy rather than overloading TDX', async () => {
  const hang = new Promise(() => {});
  const mock = service((url) => url.includes('/openid-connect/token') ? undefined : hang, { wait: async () => {} });
  const stuck = Array.from({ length: 4 }, (_, index) => mock.execute(etaQuery(`TXG30${index}`)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await mock.execute(etaQuery('TXG399')), { status: 'unavailable', reason: 'rate-limited' });
  assert.equal(mock.calls.filter((call) => call.url.includes('/EstimatedTimeOfArrival/')).length, 4);
  void stuck;
});
test('client keeps the stale marker only when the server sends it', async () => {
  const original = globalThis.fetch;
  try {
    for (const [stale, expected] of [[true, true], [undefined, undefined], ['yes', undefined]]) {
      globalThis.fetch = async () => Response.json({ status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: at(), ...(stale === undefined ? {} : { stale }) });
      const result = await client.queryTransit(etaQuery(), new AbortController().signal);
      assert.equal(result.stale, expected);
      assert.equal(result.fetchedAt, at());
    }
  } finally { globalThis.fetch = original; }
});

// 兩台機器共用快取：集中到第一台處理，主機不在時退回本機，不形成單點故障。
const replay = require(path.join(output, 'transit-replay.js'));
const noHeaders = { get: () => null };
const withHeader = (name, value = 'x') => ({ get: (key) => key.toLowerCase() === name ? value : null });
test('the second machine replays transit queries to the first with a timeout and self fallback', () => {
  const [leader, other] = replay.TRANSIT_LEADER_MACHINES;
  assert.equal(replay.transitReplayHeader(other, noHeaders), `instance=${leader};timeout=3s;fallback=prefer_self`);
  assert.equal(replay.transitReplayHeader(leader, noHeaders), null);
});
test('replayed, fallback and reassigned requests are handled locally so nothing loops', () => {
  const other = replay.TRANSIT_LEADER_MACHINES[1];
  for (const name of ['fly-replay-src', 'fly-replay-failed', 'fly-preferred-instance-unavailable'])
    assert.equal(replay.transitReplayHeader(other, withHeader(name)), null, name);
});
test('outside Fly or on an unknown machine nothing is replayed', () => {
  for (const id of [undefined, '', 'unknownmachine1', 'BAD ID;instance=x']) assert.equal(replay.transitReplayHeader(id, noHeaders), null);
});
test('the route answers a replay before reading the body and still serves locally on the leader or after fallback', async () => {
  const original = process.env.FLY_MACHINE_ID;
  const [leader, other] = replay.TRANSIT_LEADER_MACHINES;
  const make = (extra = {}) => new Request('https://nuni.tw/api/transit', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ action: 'nope' }) });
  try {
    process.env.FLY_MACHINE_ID = other;
    const replayed = await route.POST(make());
    assert.equal(replayed.status, 204);
    assert.equal(replayed.headers.get('fly-replay'), `instance=${leader};timeout=3s;fallback=prefer_self`);
    assert.equal(replayed.headers.get('cache-control'), 'private, no-store');
    assert.equal((await route.POST(make({ 'fly-replay-failed': 'reason=timeout' }))).status, 400);
    process.env.FLY_MACHINE_ID = leader;
    const local = await route.POST(make());
    assert.equal(local.status, 400);
    assert.equal(local.headers.get('fly-replay'), null);
  } finally {
    if (original === undefined) delete process.env.FLY_MACHINE_ID; else process.env.FLY_MACHINE_ID = original;
  }
});
test('Providence route stop orders are preloaded once in the background through the same protections', async () => {
  const stopOrder = (uid) => [{ RouteUID: uid, SubRouteUID: uid, Direction: 1, Stops: [{ StopName: { Zh_tw: '起站' } }, { StopName: { Zh_tw: `${uid}末站` } }] }];
  const mock = service((url) => url.includes('/StopOfRoute/')
    ? Response.json(stopOrder(new URL(url).searchParams.get('$filter').slice(13, -1)))
    : Response.json([arrival({ RouteUID: 'TXG162', SubRouteUID: 'TXG162', Direction: 1 })]),
  { preloadRoutes: server.PROVIDENCE_PRELOAD_ROUTES });
  await mock.execute(campusQuery);
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  const preloaded = mock.calls.filter((call) => call.url.includes('/StopOfRoute/')).map((call) => new URL(call.url).searchParams.get('$filter'));
  assert.deepEqual(preloaded, server.PROVIDENCE_PRELOAD_ROUTES.routeUids.map((uid) => `RouteUID eq '${uid}'`));
  await mock.execute(campusQuery);
  assert.equal(mock.calls.filter((call) => call.url.includes('/StopOfRoute/')).length, preloaded.length, 'preload runs once');
  // 之後查到站直接用預載的 TDX 站序補終點，不再打站序。
  const result = await mock.execute(etaQuery());
  assert.equal(result.arrivals[0].destination, 'TXG162末站');
  assert.equal(mock.calls.filter((call) => call.url.includes('/StopOfRoute/')).length, preloaded.length);
});
test('route stop orders survive a rate limit far longer than arrivals, but arrivals keep the short window', async () => {
  let limited = false;
  const stopOrder = [{ RouteUID: 'TXG300', SubRouteUID: 'TXG300A', Direction: 0, Stops: [{ StopName: { Zh_tw: '起站' } }, { StopName: { Zh_tw: '真終點' } }] }];
  const mock = service((url) => limited ? new Response('', { status: 429 })
    : Response.json(url.includes('/StopOfRoute/') ? stopOrder : [arrival()]));
  await mock.execute(etaQuery());
  limited = true;
  mock.tick(7 * 60 * 60_000); // 站序 6 小時快取已過期，到站保留也已過期
  assert.deepEqual(await mock.execute(etaQuery()), { status: 'unavailable', reason: 'rate-limited' });
  limited = false;
  mock.tick(61_000); // 429 後依預設暫停 60 秒，保護不放寬
  const fresh = await mock.execute(etaQuery());
  assert.equal(fresh.status, 'ready');
  // 到站重新取得、站序再被擋：仍用 24 小時內的最近一份 TDX 站序補終點。
  const mixed = service((url) => url.includes('/StopOfRoute/') ? (limited ? new Response('', { status: 429 }) : Response.json(stopOrder)) : Response.json([arrival({ SrcUpdateTime: new Date(NOW + 7 * 60 * 60_000).toISOString() })]));
  await mixed.execute(etaQuery());
  limited = true;
  mixed.tick(7 * 60 * 60_000);
  const kept = await mixed.execute(etaQuery());
  assert.equal(kept.status, 'ready');
  assert.equal(kept.arrivals[0].destination, '真終點');
  mixed.tick(server.ROUTE_STOPS_RETENTION_MS);
  const expired = await mixed.execute(etaQuery());
  assert.equal(expired.arrivals[0].destination, '');
});
test('preload is skipped without credentials and never blocks the static catalog', async () => {
  const calls = [];
  const execute = server.createTransitService({ credentials: () => ({}), fetcher: async (url) => { calls.push(url); return Response.json([]); },
    now: () => NOW, preloadRoutes: server.PROVIDENCE_PRELOAD_ROUTES });
  assert.equal((await execute(campusQuery)).status, 'ready');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
});
