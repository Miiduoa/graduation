export const PUBLIC_BUS_SOURCE = {
  name: '臺中市政府交通局',
  catalog: 'https://data.gov.tw/dataset/81555',
  download: 'https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=da150269-0aed-48fc-954c-087e100090ec',
  official: 'https://citybus-free.taichung.gov.tw/driving-map',
} as const;
export type BusPoint = { lat: number; lon: number };
export type PublicBusStop = BusPoint & {
  id: string; code: string; name: string; address: string;
  routes: { name: string; direction: string; destination: string }[];
};
export type PublicBusDirectory = {
  status: 'ready'; fetchedAt: string; stale: boolean; stops: PublicBusStop[];
  source: typeof PUBLIC_BUS_SOURCE;
};
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isBusPoint = (v: unknown): v is BusPoint & Record<string, unknown> => record(v) &&
  typeof v.lat === 'number' && Number.isFinite(v.lat) && Math.abs(v.lat) <= 90 &&
  typeof v.lon === 'number' && Number.isFinite(v.lon) && Math.abs(v.lon) <= 180;
export const normalizeBusName = (v: string) => v.normalize('NFKC').replaceAll('台', '臺').replace(/\s+/g, '').toLocaleLowerCase();

/** RFC-style CSV parsing. Quoted commas/newlines and escaped quotes remain within the field. */
export function parseBusCsv(input: string): string[][] {
  if (input.length > 12_000_000) throw new Error('dataset-too-large');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const text = input.replace(/^\uFEFF/, '');
  function finishField() { row.push(field.trim()); field = ''; closed = false; }
  function finishRow() {
    finishField();
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > 100_000) throw new Error('too-many-rows');
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') {
      finishRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (closed || char === '"') throw new Error('invalid-csv');
    else field += char;
    if (field.length > 2048 || row.length > 24) throw new Error('invalid-csv');
  }
  if (quoted) throw new Error('incomplete-csv');
  if (field || row.length || closed) finishRow();
  return rows;
}

export function parsePublicBusStops(input: string): PublicBusStop[] {
  const [header, ...rows] = parseBusCsv(input);
  const names = ['路線名稱', '去返程', '往', '站序', '站點編號', '站點名稱', '緯度', '經度', '地址'];
  if (!header || new Set(header).size !== header.length || names.some((name) => !header.includes(name)))
    throw new Error('unrecognized-stop-schema');
  const indexes = Object.fromEntries(names.map((name) => [name, header.indexOf(name)]));
  const stops = new Map<string, PublicBusStop>();
  for (const row of rows) {
    if (row.length !== header.length) throw new Error('incomplete-stop-row');
    const value = (key: string) => row[indexes[key]];
    const code = value('站點編號'), name = value('站點名稱'), route = value('路線名稱');
    const latText = value('緯度'), lonText = value('經度');
    const point = { lat: Number(latText), lon: Number(lonText) };
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(code) || !name || name.length > 120 || !route || route.length > 120 ||
        !latText || !lonText || !isBusPoint(point) || point.lat < 21 || point.lat > 26 || point.lon < 119 || point.lon > 123) continue;
    // A source code alone must not collapse platforms when their coordinates or names differ.
    const id = `${code}:${point.lat}:${point.lon}:${name}`;
    const entry = stops.get(id) ?? { id, code, name, address: value('地址').slice(0, 240), ...point, routes: [] };
    const direction = value('去返程').slice(0, 40), destination = value('往').slice(0, 120);
    if (!entry.routes.some((item) => item.name === route && item.direction === direction && item.destination === destination))
      entry.routes.push({ name: route, direction, destination });
    stops.set(id, entry);
  }
  if (!stops.size || stops.size > 20_000) throw new Error('invalid-stop-count');
  return [...stops.values()].map((stop) => ({ ...stop, routes: stop.routes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true })) }));
}

export function busDistance(a: BusPoint, b: BusPoint): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return Math.round(12_742_000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h)))));
}
export function findPublicBusStops(stops: PublicBusStop[], { text = '', point, radius = 600, saved }: {
  text?: string; point?: BusPoint; radius?: number; saved?: string[];
}) {
  if (point && (!isBusPoint(point) || ![300, 600, 1000, 2000].includes(radius))) return [];
  const term = normalizeBusName(text);
  return stops.map((stop) => ({ ...stop, distance: point ? busDistance(point, stop) : null }))
    .filter((stop) => (!saved || saved.includes(stop.id)) &&
      (!term || normalizeBusName(stop.name).includes(term) || stop.routes.some((route) => normalizeBusName(route.name) === term)) &&
      (stop.distance === null || stop.distance <= radius))
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0) || a.name.localeCompare(b.name, 'zh-Hant') || a.id.localeCompare(b.id));
}
export function readBusFavorites(raw: string | null): string[] {
  try {
    const rows: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(rows) ? [...new Set(rows.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 240))].slice(0, 20) : [];
  } catch { return []; }
}
export function busStopMapUrl(stop: BusPoint): string {
  if (!isBusPoint(stop)) throw new Error('invalid-stop-position');
  return `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lon}&travelmode=walking`;
}
export function parseBusDirectory(value: unknown): PublicBusDirectory {
  if (!record(value) || value.status !== 'ready' || typeof value.fetchedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.fetchedAt)) || !Array.isArray(value.stops) || !value.stops.length || value.stops.length > 20_000)
    throw new Error('invalid-directory');
  const valid = value.stops.every((stop) => record(stop) && isBusPoint(stop) &&
    typeof stop.id === 'string' && typeof stop.code === 'string' && typeof stop.name === 'string' && typeof stop.address === 'string' &&
    Array.isArray(stop.routes) && stop.routes.every((route) => record(route) && typeof route.name === 'string' &&
      typeof route.direction === 'string' && typeof route.destination === 'string'));
  if (!valid) throw new Error('invalid-directory');
  return { status: 'ready', fetchedAt: value.fetchedAt, stale: value.stale === true, stops: value.stops as PublicBusStop[], source: PUBLIC_BUS_SOURCE };
}
