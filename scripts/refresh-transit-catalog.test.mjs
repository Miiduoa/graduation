import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTaichungCatalog, parseCatalogCsv, refreshTransitCatalog, CATALOG_PATH } from './refresh-transit-catalog.mjs';

const HEADER = '路線名稱,去返程,往,站序,站點編號,站點名稱,緯度,經度,地址';
const DATE = '2026-10-18T02:47:36.436Z';
const row = (values = {}) => ({
  路線名稱: '300', 去返程: '去', 往: '臺中車站', 站序: '1', 站點編號: '498',
  站點名稱: '靜宜大學', 緯度: '24.227', 經度: '120.575', 地址: '臺中市', ...values,
});
const csvRow = (item) => Object.values(item).map((value) => `"${value.replaceAll('"', '""')}"`).join(',');
const csv = (rows) => Buffer.from(`${HEADER}\r\n${rows.map(csvRow).join('\r\n')}\r\n`);

test('parses repeated BOM, CRLF, commas, escaped quotes and newlines inside quoted fields', () => {
  const input = `\uFEFF\uFEFF${HEADER}\r\n${csvRow(row({ 地址: '中路, "一號"\n巷內' }))}\r\n`;
  const parsed = parseCatalogCsv(input);
  assert.equal(parsed.rows[0].地址, '中路, "一號"\n巷內');
  assert.equal(parsed.droppedIncompleteLastRow, 0);
});

test('rejects error documents, wrong columns, malformed and nonfinal unterminated quoting', () => {
  for (const input of ['<html>error</html>', '{}', HEADER, `${HEADER}\nwrong,columns`,
    `${HEADER}\n"300","去`, `${HEADER}\n${csvRow(row())}\n"300","bad"quote`])
    assert.throws(() => parseCatalogCsv(input));
});

test('excludes and discloses only an incomplete final address record, without repairing it', () => {
  const input = `${HEADER}\n${csvRow(row())}\n${csvRow(row({ 站點名稱: '未完成站' })).slice(0, -1)}`;
  const result = buildTaichungCatalog(Buffer.from(input), DATE);
  assert.equal(result.metadata.sourceRowCount, 2);
  assert.equal(result.metadata.acceptedRowCount, 1);
  assert.equal(result.metadata.droppedIncompleteLastRow, 1);
  assert.deepEqual(result.stops.map((stop) => stop.name), ['靜宜大學']);
  assert.throws(() => parseCatalogCsv(`${input}\n"next row"`));
});

test('deduplicates identical route records but preserves direction, exact position and route destination', () => {
  const entries = [row(), row(), row({ 路線名稱: '301' }), row({ 往: '清水' }),
    row({ 去返程: '返' }), row({ 緯度: '24.2271' }), row({ 站點編號: '' })];
  const result = buildTaichungCatalog(csv(entries), DATE);
  assert.equal(result.stops.length, 4);
  assert.equal(result.stops.reduce((count, stop) => count + stop.routes.length, 0), 6);
  assert.ok(result.stops.every((stop) => /^TCOD_[A-Za-z0-9_-]{1,75}$/.test(stop.id)));
  assert.deepEqual(result.stops, buildTaichungCatalog(csv([...entries].reverse()), DATE).stops);
});

test('rejects missing/zero/swapped/nonfinite coordinates and unsupported direction instead of inventing data', () => {
  for (const fields of [{ 緯度: '' }, { 緯度: 'NaN' }, { 緯度: '0' }, { 緯度: '120', 經度: '24' },
    { 去返程: '' }, { 往: '' }, { 路線名稱: '' }, { 站點名稱: '' }])
    assert.throws(() => buildTaichungCatalog(csv([row(fields)]), DATE));
  assert.throws(() => buildTaichungCatalog(Buffer.from([0xff]), DATE));
});

test('accepts 200 routes per stop and rejects 201 to match Web, App and release validation', () => {
  const entries = Array.from({ length: 201 }, (_, index) => row({ 路線名稱: `route-${index}` }));
  assert.equal(buildTaichungCatalog(csv(entries.slice(0, 200)), DATE).stops[0].routes.length, 200);
  assert.throws(() => buildTaichungCatalog(csv(entries), DATE), /Too many routes for a stop/);
});

test('a failed, HTML or small replacement cannot overwrite the installed snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'campus-transit-catalog-'));
  const outputPath = join(directory, 'catalog.json');
  await writeFile(outputPath, 'existing verified snapshot');
  try {
    for (const response of [new Response('no', { status: 503 }), new Response('<html>no</html>', { headers: { 'content-type': 'text/html' } }),
      new Response(csv([row()])), new Response('no', { headers: { 'content-length': String(20 * 1024 * 1024) } })]) {
      await assert.rejects(refreshTransitCatalog({ fetcher: async () => response, outputPath }));
      assert.equal(await readFile(outputPath, 'utf8'), 'existing verified snapshot');
    }
  } finally { await rm(directory, { recursive: true }); }
});

test('bundled snapshot retains source evidence and all rows satisfy Web/Mobile display constraints', async () => {
  const { metadata, stops } = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  assert.equal(metadata.source, 'taichung-open-data');
  assert.match(metadata.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(metadata.sourceRowCount, metadata.acceptedRowCount + metadata.droppedIncompleteLastRow);
  assert.equal(metadata.stopCount, stops.length);
  assert.ok(stops.length > 1000);
  assert.equal(new Set(stops.map((stop) => stop.id)).size, stops.length);
  for (const stop of stops) {
    assert.match(stop.id, /^TCOD_[A-Za-z0-9_-]{1,75}$/);
    assert.ok(stop.name.length > 0 && stop.name.length <= 120);
    assert.ok(Number.isFinite(stop.lat) && Number.isFinite(stop.lon));
    assert.ok(stop.routes.length > 0 && stop.routes.length <= 200);
    for (const route of stop.routes) {
      assert.ok(route.name.length > 0 && route.name.length <= 120);
      assert.ok(['去', '返'].includes(route.direction));
      assert.ok(route.destination.length > 0 && route.destination.length <= 120);
    }
  }
});
