import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATASET_URL = 'https://data.gov.tw/dataset/81555';
export const DOWNLOAD_URL = 'https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=da150269-0aed-48fc-954c-087e100090ec';
export const CATALOG_PATH = fileURLToPath(new URL('../apps/web/src/data/taichung-transit-catalog.json', import.meta.url));
const HEADERS = ['路線名稱', '去返程', '往', '站序', '站點編號', '站點名稱', '緯度', '經度', '地址'];
const MAX_BYTES = 15 * 1024 * 1024;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Strict CSV parser: quoted commas/newlines and escaped quotes are data, not separators. */
export function parseCatalogCsv(input) {
  const text = input.replace(/^\uFEFF+/, '');
  if (/^\s*</.test(text)) throw new Error('Expected CSV, received HTML/XML');
  const rows = [];
  let row = [], field = '', quoted = false, closedQuote = false;
  const pushField = () => { row.push(field); field = ''; closedQuote = false; };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else field += char;
    } else if (char === ',') pushField();
    else if (char === '\n' || char === '\r') {
      pushRow();
      if (char === '\r' && text[i + 1] === '\n') i += 1;
    } else if (char === '"' && field === '' && !closedQuote) quoted = true;
    else {
      if (closedQuote || char === '"') throw new Error('Malformed CSV quoting');
      field += char;
    }
  }
  // The official 2026-10-18 file ends inside the final address field. Exclude that
  // incomplete record rather than inventing its terminator or treating it as valid.
  // Any earlier field, embedded newline, or other quote error remains fatal.
  const droppedIncompleteLastRow = quoted && row.length === HEADERS.length - 1 && !/[\r\n]/.test(field) ? 1 : 0;
  if (quoted && !droppedIncompleteLastRow) throw new Error('Unterminated CSV quote');
  if (!droppedIncompleteLastRow && (row.length || field || closedQuote)) pushRow();
  const headers = rows.shift()?.map((value) => value.trim());
  if (!headers || headers.length !== HEADERS.length || !HEADERS.every((name, i) => headers[i] === name))
    throw new Error('Unexpected official CSV columns');
  if (!rows.length) throw new Error('Official CSV contains no stops');
  const records = rows.map((values, i) => {
    if (values.length !== HEADERS.length) throw new Error(`CSV row ${i + 2} has ${values.length} columns`);
    return Object.fromEntries(HEADERS.map((name, index) => [name, values[index].trim()]));
  });
  return { rows: records, droppedIncompleteLastRow };
}

export function buildTaichungCatalog(bytes, downloadedAt) {
  if (bytes.byteLength > MAX_BYTES) throw new Error('Official CSV exceeds size limit');
  if (!Number.isFinite(Date.parse(downloadedAt))) throw new Error('Invalid download timestamp');
  const catalogDate = new Date(downloadedAt).toISOString();
  const { rows, droppedIncompleteLastRow } = parseCatalogCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const name = row['站點名稱'], route = row['路線名稱'], direction = row['去返程'], destination = row['往'];
    const lat = Number(row['緯度']), lon = Number(row['經度']);
    // Includes cross-boundary municipal routes, while rejecting zero/swapped/non-Taiwan coordinates.
    if (![name, route, destination].every((value) => value && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value)) ||
      !['去', '返'].includes(direction) || !row['緯度'] || !row['經度'] ||
      !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 20 || lat > 27 || lon < 118 || lon > 123)
      throw new Error(`Invalid stop or route at CSV row ${index + 2}`);
    // The official stop number is not unique by direction/position and is sometimes empty.
    // Retain exact numeric coordinates and route-relative direction; never merge by name alone.
    const key = JSON.stringify([row['站點編號'], name, lat, lon, direction]);
    if (!groups.has(key)) groups.set(key, {
      id: `TCOD_${sha256(key).slice(0, 40)}`, name, lat, lon, routes: new Map(),
    });
    const stop = groups.get(key);
    stop.routes.set(JSON.stringify([route, direction, destination]), { name: route, direction, destination });
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const stops = [...groups.values()].map((stop) => ({
    ...stop,
    routes: [...stop.routes.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
  })).sort((a, b) => compare(a.id, b.id));
  if (new Set(stops.map((stop) => stop.id)).size !== stops.length) throw new Error('Catalog ID collision');
  if (stops.some((stop) => stop.routes.length > 200)) throw new Error('Too many routes for a stop');
  return {
    metadata: {
      source: 'taichung-open-data', catalogDate, datasetUrl: DATASET_URL, downloadUrl: DOWNLOAD_URL,
      provider: '臺中市政府交通局', license: '政府資料開放授權條款-第1版',
      licenseUrl: 'https://data.gov.tw/license', updateFrequency: '不定期更新',
      sourceSha256: sha256(bytes), sourceBytes: bytes.byteLength,
      sourceRowCount: rows.length + droppedIncompleteLastRow, acceptedRowCount: rows.length,
      droppedIncompleteLastRow, stopCount: stops.length,
      note: '靜態站牌與經過路線快照；catalogDate 是下載時間，不是公車動態更新時間。',
    },
    stops,
  };
}

export async function refreshTransitCatalog({ fetcher = fetch, outputPath = CATALOG_PATH, now = () => new Date() } = {}) {
  const response = await fetcher(DOWNLOAD_URL, {
    headers: { Accept: 'text/csv, application/octet-stream;q=0.9' },
    redirect: 'error', signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Official CSV download failed: HTTP ${response.status}`);
  if (/html|xml|json/i.test(response.headers.get('content-type') ?? '')) throw new Error('Official download returned an error document');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Official CSV exceeds size limit');
  const chunks = [];
  let size = 0;
  if (!response.body) throw new Error('Official download has no body');
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new Error('Official CSV exceeds size limit');
    chunks.push(chunk);
  }
  const catalog = buildTaichungCatalog(Buffer.concat(chunks), now().toISOString());
  // A sample, truncated download or drastic source change must be reviewed, never silently deployed.
  if (catalog.metadata.sourceRowCount < 10_000 || catalog.metadata.stopCount < 1_000)
    throw new Error('Official snapshot is unexpectedly small; existing catalog preserved');
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  // One stop per line keeps the snapshot reasonably small and makes updates reviewable.
  const json = `{"metadata":${JSON.stringify(catalog.metadata)},"stops":[\n${catalog.stops.map((stop) => JSON.stringify(stop)).join(',\n')}\n]}\n`;
  await writeFile(temporary, json, { flag: 'wx' });
  await rename(temporary, outputPath);
  return catalog.metadata;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshTransitCatalog().then((metadata) => console.log(JSON.stringify(metadata, null, 2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
