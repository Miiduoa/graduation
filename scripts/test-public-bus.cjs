const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const ts = createRequire(path.join(root, 'apps/web/package.json'))('typescript');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'public-bus-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
for (const name of ['publicBusStops', 'publicBusServer']) fs.writeFileSync(path.join(tmp, `${name}.js`), ts.transpileModule(
  fs.readFileSync(path.join(root, `apps/web/src/lib/${name}.ts`), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText);
const model = require(path.join(tmp, 'publicBusStops.js'));
const { createPublicBusDirectory } = require(path.join(tmp, 'publicBusServer.js'));
const header = '路線名稱,去返程,往,站序,站點編號,站點名稱,緯度,經度,地址';
const fixture = [header,
  'T1,去程,測試終點,1,A1,測試大學,24.22,120.58,測試地址',
  'T2,返程,另一終點,2,A1,測試大學,24.22,120.58,測試地址',
  'T1,返程,另一終點,3,A2,測試大學,24.221,120.58,道路另一側',
  'T3,去程,終點,4,B1,臺中測試站,24.23,120.58,測試地址',
].join('\r\n');
const stops = model.parsePublicBusStops(fixture);
test('parses BOM, CRLF, quoted commas, quoted newlines and escaped quotes', () => {
  assert.deepEqual(model.parseBusCsv('\ufeffa,b\r\n"one,two","line\n""quote"""\r\n'), [['a','b'],['one,two','line\n"quote"']]);
});
test('rejects incomplete or malformed quoted fields', () => {
  for (const row of ['a,"b', 'a,b"c', '"a"z,b']) assert.throws(() => model.parseBusCsv(row));
});
test('rejects unknown schemas, duplicate headers, incomplete rows and empty datasets', () => {
  for (const csv of ['<html>error</html>', header, header + '\na,b', header + ',地址\na,b', '{}'])
    assert.throws(() => model.parsePublicBusStops(csv));
});
test('retains separate same-named platforms and aggregates actual route/destination pairs', () => {
  assert.equal(stops.length, 3);
  assert.equal(stops[0].routes.length, 2);
  assert.notEqual(stops[0].id, stops[1].id);
  assert.equal(stops[0].routes[1].destination, '另一終點');
});
test('a reused source code with different coordinates is not silently merged', () => {
  const rows = model.parsePublicBusStops(fixture + '\nT4,去程,終點,1,A1,測試大學,24.222,120.58,別處');
  assert.equal(rows.length, 4);
});
test('ignores missing and impossible coordinates, preserving other valid stops', () => {
  const rows = model.parsePublicBusStops(fixture + '\nT5,去程,終點,1,XX,未知,,,地址\nT5,去程,終點,1,YY,未知,91,120,地址');
  assert.equal(rows.length, 3);
});
test('matches 台/臺 and full-width inputs and exact route numbers', () => {
  assert.equal(model.findPublicBusStops(stops, { text: '台中' }).length, 1);
  assert.equal(model.findPublicBusStops(stops, { text: 'Ｔ１' }).length, 2);
  assert.equal(model.findPublicBusStops(stops, { text: 'T' }).length, 0);
});
test('nearby sorting uses exact local distances and radius; it does not guess city', () => {
  const rows = model.findPublicBusStops(stops, { point: { lat: 24.22, lon: 120.58 }, radius: 300 });
  assert.equal(rows.length, 2); assert.equal(rows[0].distance, 0);
  assert.ok(rows[1].distance > 100 && rows[1].distance < 120);
  assert.equal(model.findPublicBusStops(stops, { point: { lat: 25, lon: 121 }, radius: 300 }).length, 0);
});
test('rejects invalid nearby inputs rather than returning the whole directory', () => {
  assert.deepEqual(model.findPublicBusStops(stops, { point: { lat: NaN, lon: 120 }, radius: 300 }), []);
  assert.deepEqual(model.findPublicBusStops(stops, { point: { lat: 24, lon: 120 }, radius: 9999 }), []);
});
test('favorites are bounded deduplicated public identifiers, tolerant of blocked or corrupt storage', () => {
  assert.deepEqual(model.readBusFavorites('{bad'), []);
  assert.deepEqual(model.readBusFavorites('{}'), []);
  assert.deepEqual(model.readBusFavorites('["a","a",null,2,""]'), ['a']);
  assert.equal(model.readBusFavorites(JSON.stringify(Array.from({length:30}, (_, i) => String(i)))).length, 20);
});
test('walking links expose only a public stop, not current user location', () => {
  const url = new URL(model.busStopMapUrl(stops[0]));
  assert.equal(url.hostname, 'www.google.com'); assert.equal(url.searchParams.has('origin'), false);
  assert.equal(url.searchParams.get('travelmode'), 'walking');
  assert.throws(() => model.busStopMapUrl({ lat: NaN, lon: 120 }));
});
test('browser response parsing rejects malformed records and controls the source attribution', () => {
  assert.throws(() => model.parseBusDirectory({ status: 'ready', fetchedAt: 'bad', stops }));
  assert.throws(() => model.parseBusDirectory({ status: 'ready', fetchedAt: new Date().toISOString(), stops: [{}] }));
  const data = model.parseBusDirectory({ status: 'ready', fetchedAt: new Date().toISOString(), stops, source: { official: 'https://evil.invalid' } });
  assert.equal(data.source.official, model.PUBLIC_BUS_SOURCE.official);
});
test('one source fetch serves concurrent users and a six-hour shared static cache', async () => {
  let calls = 0;
  const load = createPublicBusDirectory({ fetcher: async () => { calls++; return new Response(fixture); } });
  const data = await Promise.all(Array.from({length:20}, () => load()));
  assert.equal(calls, 1); assert.equal(data[0].stops.length, 3);
  await load(); assert.equal(calls, 1);
});
test('source errors back off, never manufacture stations, and redact provider details', async () => {
  let calls = 0;
  const load = createPublicBusDirectory({ fetcher: async () => { calls++; throw new Error('private detail'); } });
  await assert.rejects(load(), /source-unavailable/);
  await assert.rejects(load(), /source-unavailable/); assert.equal(calls, 1);
});
test('keeps last-known static data honestly, then expires it after 24 hours', async () => {
  let time = 100000000, fail = false;
  const load = createPublicBusDirectory({ now: () => time, fetcher: async () => {
    if (fail) throw new Error('offline'); return new Response(fixture);
  } });
  const original = await load(); fail = true; time += 7 * 3600000;
  const old = await load(); assert.equal(old.stale, true); assert.equal(old.fetchedAt, original.fetchedAt);
  time += 18 * 3600000; await assert.rejects(load());
});
test('non-CSV success pages are not a working data source', async () => {
  const load = createPublicBusDirectory({ fetcher: async () => new Response('<html>login</html>') });
  await assert.rejects(load());
});
test('official live source smoke: real station catalog, never sample arrival times', { skip: !process.env.CHECK_PUBLIC_BUS_SOURCE }, async () => {
  const data = await createPublicBusDirectory()();
  assert.ok(data.stops.length > 500, 'Unexpectedly small city catalog');
  const campus = model.findPublicBusStops(data.stops, { text: '靜宜' });
  assert.ok(campus.length > 0, 'Official city catalog must include the requested campus');
  console.log(JSON.stringify({ source: data.source.catalog, fetchedAt: data.fetchedAt, stops: data.stops.length,
    campus: campus.slice(0, 4).map(({name,code,lat,lon,routes}) => ({name,code,lat,lon,routes:routes.slice(0,4)})) }));
});
