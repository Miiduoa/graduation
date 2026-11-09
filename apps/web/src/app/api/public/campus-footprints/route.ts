import { NextResponse } from 'next/server';
import {
  parseProvidenceOsmFootprints,
  PROVIDENCE_OSM_BUILDING_WAY_IDS,
  type ProvidenceFootprint,
} from '@/app/map/providenceFootprints';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 只向固定的公開 OSM 查已校核的 way ID；沒有使用者控制的 URL／Overpass 查詢。
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const ERROR_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_RESPONSE_BYTES = 500_000;
const query = '[out:json][timeout:12];way(id:' +
  PROVIDENCE_OSM_BUILDING_WAY_IDS.join(',') + ');out geom;';

type Snapshot = { buildings: ProvidenceFootprint[]; fetchedAt: string; validUntil: number };
let cache: Snapshot | null = null;
let pending: Promise<Snapshot> | null = null;
let unavailableUntil = 0;

// Overpass can omit Content-Length or serve compressed responses. Stop reading at the
// decoded byte limit; checking .text().length afterwards would still buffer an
// unbounded upstream response in the Node process.
async function readBoundedResponse(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_RESPONSE_BYTES) {
    throw new Error('OSM response too large');
  }
  if (!response.body) {
    // Covers non-streaming fetch mocks; production Node fetch supplies a stream.
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('OSM response too large');
    }
    return raw;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const segments: string[] = [];
  let size = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { completed = true; break; }
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('OSM response too large');
      segments.push(decoder.decode(value, { stream: true }));
    }
    segments.push(decoder.decode());
    return segments.join('');
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readOsm(): Promise<Snapshot> {
  const url = OVERPASS_ENDPOINT + '?data=' + encodeURIComponent(query);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      // Identify this service to the public Overpass instance per its usage policy.
      'User-Agent': 'nuni-campus-spatial/1.0 (https://nuni.tw)',
    },
  });
  if (!response.ok) throw new Error('OSM service unavailable');
  const raw = await readBoundedResponse(response);
  const buildings = parseProvidenceOsmFootprints(JSON.parse(raw) as unknown);
  if (!buildings.length) throw new Error('No verified building outlines in response');
  const now = Date.now();
  return { buildings, fetchedAt: new Date(now).toISOString(), validUntil: now + REFRESH_MS };
}

export async function GET() {
  const now = Date.now();
  if (cache && cache.validUntil > now) {
    return NextResponse.json({
      schoolId: 'pu', source: 'OpenStreetMap', fetchedAt: cache.fetchedAt,
      stale: false, buildings: cache.buildings,
    }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600' } });
  }
  if (unavailableUntil > now) {
    if (!cache) return NextResponse.json({ error: 'Building outlines temporarily unavailable' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '600' },
    });
  } else {
    try {
      if (!pending) pending = readOsm().finally(() => { pending = null; });
      cache = await pending;
      unavailableUntil = 0;
    } catch {
      unavailableUntil = Date.now() + ERROR_COOLDOWN_MS;
    }
  }
  if (!cache) return NextResponse.json({ error: 'Building outlines temporarily unavailable' }, {
    status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '600' },
  });
  return NextResponse.json({
    schoolId: 'pu', source: 'OpenStreetMap', fetchedAt: cache.fetchedAt,
    stale: cache.validUntil <= Date.now(), buildings: cache.buildings,
  }, {
    // 有舊快照時保留舊輪廓並明示來源日期，不把快取說成最新。
    headers: { 'Cache-Control': cache.validUntil <= Date.now()
      ? 'private, no-store' : 'public, max-age=0, s-maxage=3600' },
  });
}
